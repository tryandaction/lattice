import { beginDesktopDropImport, isDesktopDirectoryHandle, type DesktopDropImport } from './desktop-file-system';

export const EXPLORER_ENTRY_MIME = 'application/x-lattice-explorer-entry';
export type DroppedEntry = FileSystemFileHandle | FileSystemDirectoryHandle;
export type ExplorerEntryDrop = { path: string; kind: FileSystemHandleKind };

export function parseExplorerEntryDrop(data: Pick<DataTransfer, 'getData'>): ExplorerEntryDrop | null {
  try {
    const parsed = JSON.parse(data.getData(EXPLORER_ENTRY_MIME) || data.getData('text/plain')) as ExplorerEntryDrop;
    return typeof parsed.path === 'string' && parsed.path && (parsed.kind === 'file' || parsed.kind === 'directory') ? parsed : null;
  } catch { return null; }
}

export function hasInternalEntryDrop(data: Pick<DataTransfer, 'types'>): boolean {
  return Array.from(data.types ?? []).includes(EXPLORER_ENTRY_MIME);
}
export function hasExternalFileDrop(data: DataTransfer): boolean {
  return !hasInternalEntryDrop(data) && (Array.from(data.types ?? []).includes('Files') || data.files?.length > 0);
}
function fromFile(file: File): FileSystemFileHandle {
  return { name: file.name, kind: 'file', getFile: async () => file } as FileSystemFileHandle;
}
type LegacyEntry = { name: string; isFile: boolean; isDirectory: boolean;
  file: (success: (file: File) => void, failure: (error: Error) => void) => void;
  createReader: () => { readEntries: (success: (entries: LegacyEntry[]) => void, failure: (error: Error) => void) => void } };
function fromLegacy(entry: LegacyEntry): DroppedEntry {
  if (entry.isFile) return { name: entry.name, kind: 'file', getFile: () => new Promise<File>((resolve, reject) => entry.file(resolve, reject)) } as FileSystemFileHandle;
  return { name: entry.name, kind: 'directory', async *values() {
    const reader = entry.createReader();
    while (true) {
      const batch = await new Promise<LegacyEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) return;
      for (const child of batch) yield fromLegacy(child);
    }
  } } as unknown as FileSystemDirectoryHandle;
}

/** Call during drop, before yielding: Chromium protects drag items after this tick. */
export function captureExternalDrop(data: DataTransfer): Promise<DroppedEntry[]> {
  const items = Array.from(data.items ?? []).filter(item => item.kind === 'file');
  if (!items.length) return Promise.resolve(Array.from(data.files ?? []).map(fromFile));
  const pending = items.map(item => {
    const candidate = item as unknown as { getAsFileSystemHandle?: () => Promise<DroppedEntry | null>; webkitGetAsEntry?: () => LegacyEntry | null };
    const legacy = candidate.webkitGetAsEntry?.();
    const file = item.getAsFile?.();
    const fallback = () => legacy ? fromLegacy(legacy) : file ? fromFile(file) : null;
    try { return candidate.getAsFileSystemHandle?.().then(handle => handle ?? fallback(), () => fallback()) ?? Promise.resolve(fallback()); }
    catch { return Promise.resolve(fallback()); }
  });
  return Promise.all(pending).then(entries => entries.filter((entry): entry is DroppedEntry => Boolean(entry)));
}

function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Drop cancelled', 'AbortError');
}
async function occupied(target: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try { await target.getFileHandle(name); return true; }
  catch (error) { if ((error as DOMException)?.name === 'TypeMismatchError') return true;
    if ((error as DOMException)?.name !== 'NotFoundError') throw error; }
  try { await target.getDirectoryHandle(name); return true; }
  catch (error) { if ((error as DOMException)?.name === 'TypeMismatchError') return true;
    if ((error as DOMException)?.name !== 'NotFoundError') throw error; }
  return false;
}
async function uniqueName(target: FileSystemDirectoryHandle, name: string, kind: FileSystemHandleKind) {
  const dot = kind === 'file' ? name.lastIndexOf('.') : -1;
  const base = dot > 0 ? name.slice(0, dot) : name, extension = dot > 0 ? name.slice(dot) : '';
  let value = name, counter = 1;
  while (await occupied(target, value)) value = `${base} (${counter++})${extension}`;
  return value;
}
async function snapshotDroppedDirectory(source: FileSystemDirectoryHandle, signal?: AbortSignal): Promise<FileSystemDirectoryHandle> {
  // Enumerate before creating a destination. Browser OS handles cannot compare
  // identities with Tauri adapters; a snapshot also prevents recursive copying
  // when an external folder happens to contain the destination directory.
  const children: DroppedEntry[] = [];
  for await (const child of source.values()) {
    cancelled(signal);
    children.push(child.kind === 'directory' ? await snapshotDroppedDirectory(child, signal) : fromFile(await child.getFile()));
  }
  return { name: source.name, kind: 'directory', async *values() { yield* children; } } as unknown as FileSystemDirectoryHandle;
}
async function prepareDropped(source: DroppedEntry, target: FileSystemDirectoryHandle, signal?: AbortSignal): Promise<DroppedEntry> {
  cancelled(signal);
  if (source.kind !== 'directory') return source;
  let intoSelf = false;
  try { intoSelf = Boolean(source.isSameEntry && await source.isSameEntry(target)) || Boolean(source.resolve && await source.resolve(target)); }
  catch (error) { if (!(error instanceof TypeError)) throw error; }
  if (intoSelf) throw new Error('Cannot copy a folder into itself or its descendant');
  return snapshotDroppedDirectory(source, signal);
}
async function copyDropped(source: DroppedEntry, target: FileSystemDirectoryHandle, signal?: AbortSignal): Promise<string> {
  cancelled(signal);
  if (!source.name || source.name === '.' || source.name === '..' || /[\/\\\u0000]/u.test(source.name)) throw new Error('Invalid dropped entry name');
  // Reading can take arbitrarily long. Choose a name only after acquiring the source snapshot.
  const file = source.kind === 'file' ? await source.getFile() : null;
  cancelled(signal);
  const name = await uniqueName(target, source.name, source.kind);
  cancelled(signal);
  // Browser FSA create:true is not exclusive. A returned handle is NOT proof of
  // ownership: reject visible content and never delete it on failure or cancel.
  if (file) {
    const handle = await target.getFileHandle(name, { create: true });
    const initial = await handle.getFile();
    if (initial.size !== 0) throw new Error(`Import target was claimed by another process: ${name}`);
    cancelled(signal);
    const writable = await handle.createWritable({ keepExistingData: true, mode: 'exclusive' } as FileSystemCreateWritableOptions);
    try {
      const beforeWrite = await handle.getFile();
      if (beforeWrite.size !== 0 || beforeWrite.lastModified !== initial.lastModified) throw new Error(`Import target changed before writing: ${name}`);
      cancelled(signal); await writable.write(file); cancelled(signal);
      const beforeCommit = await handle.getFile();
      if (beforeCommit.size !== 0 || beforeCommit.lastModified !== initial.lastModified) throw new Error(`Import target changed before committing: ${name}`);
      await writable.close();
    } catch (error) {
      try { await writable.abort?.(); } catch { /* Keep unknown-owned entries; never remove by name. */ }
      throw error;
    }
  } else {
    const directory = await target.getDirectoryHandle(name, { create: true });
    for await (const _entry of directory.values()) throw new Error(`Import target was claimed by another process: ${name}`);
    for await (const child of (source as FileSystemDirectoryHandle).values()) await copyDropped(child as DroppedEntry, directory, signal);
  }
  return name;
}

async function stageDropped(source: DroppedEntry, stage: DesktopDropImport, path: string[], signal?: AbortSignal): Promise<void> {
  cancelled(signal);
  if (source.kind === 'directory') {
    if (path.length) await stage.write(path, 'directory');
    for await (const child of source.values()) await stageDropped(child, stage, [...path, child.name], signal);
    return;
  }
  const file = await source.getFile();
  const chunkSize = 1024 * 1024;
  for (let offset = 0; offset < file.size || offset === 0; offset += chunkSize) {
    const bytes = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer());
    cancelled(signal);
    await stage.write(path, 'file', bytes, offset > 0);
  }
}

async function copyDroppedDesktop(source: DroppedEntry, target: FileSystemDirectoryHandle, signal?: AbortSignal): Promise<string> {
  const stage = await beginDesktopDropImport(target, source.kind);
  let committed = false;
  try {
    await stageDropped(source, stage, [], signal);
    cancelled(signal);
    // Commit is the linearization point. A later cancel cannot undo a committed import.
    const name = await stage.commit(source.name);
    committed = true;
    return name;
  } finally {
    // Rust abort only owns the private stage token; it cannot remove final output.
    if (!committed) await stage.abort();
  }
}

export async function importDroppedEntries(target: FileSystemDirectoryHandle, sources: DroppedEntry[], signal?: AbortSignal) {
  cancelled(signal);
  const imported: Array<{ name: string; kind: FileSystemHandleKind }> = [], errors: string[] = [];
  const desktop = isDesktopDirectoryHandle(target);
  let containerName: string | undefined;
  let browserTarget: FileSystemDirectoryHandle | undefined;
  for (const source of sources) {
    cancelled(signal);
    try {
      let prepared = await prepareDropped(source, target, signal);
      if (!desktop) {
        if (prepared.kind === 'file') prepared = fromFile(await prepared.getFile());
        cancelled(signal);
        if (!browserTarget) {
          // FSA has no exclusive create or compare-and-swap close. Never write
          // source names in the user's existing namespace: isolate this whole
          // import under an unpredictable, newly checked UUID container.
          const candidate = `Lattice Import ${crypto.randomUUID()}`;
          if (await occupied(target, candidate)) throw new Error('Browser import container already exists');
          cancelled(signal);
          const directory = await target.getDirectoryHandle(candidate, { create: true });
          for await (const _entry of directory.values()) throw new Error('Browser import container is not empty');
          containerName = candidate; browserTarget = directory;
        }
      }
      imported.push({ name: await (desktop ? copyDroppedDesktop(prepared, target, signal) : copyDropped(prepared, browserTarget!, signal)), kind: source.kind });
    } catch (error) {
      if (signal?.aborted) throw error;
      errors.push(`${source.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { imported, errors, ...(containerName ? { containerName } : {}) };
}

