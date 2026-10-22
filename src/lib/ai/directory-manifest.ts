import { isDesktopDirectoryHandle, isDesktopFileHandle, invalidateDesktopDirCache, readDesktopFileMetadata } from '@/lib/desktop-file-system';
import { isAgentDocumentPath, isWorkspaceInstructionPath } from './document-source';
import { resolveAuthorizedDocumentLocation } from './document-source-capture';
import { isSensitiveCredentialPath, type AgentSourceSelection } from './source-index';

export interface DirectoryManifestFile {
  path: string; size: number; lastModified: number; supported: boolean;
  /** Provider metadata hint for invalidation, never proof of content reading. */
  sourceRevision?: string;
  /** A metadata failure is a visible unread file, never an omitted success. */
  metadataError?: string;
}
export interface DirectoryManifestEntry {
  name: string; kind: 'file' | 'directory';
  size?: number; lastModified?: number; supported?: boolean; metadataError?: string; sourceRevision?: string;
}
export interface DirectoryManifestCheckpoint {
  version: 1; workspaceKey: string; selections: AgentSourceSelection[]; roots: AgentSourceSelection[];
  files: DirectoryManifestFile[];
  directories: Array<{ path: string; entries: DirectoryManifestEntry[] }>;
  pendingDirectories: string[]; complete: boolean; revision: number;
  /** Changes relative to the checkpoint supplied to this invocation, not cumulative history. */
  changedPaths: string[]; removedPaths: string[];
  /** Path-based progress within one observation round; optional for older v1 manifests. */
  verification?: { generation: number; pendingPaths: string[]; next: 'verify' | 'discover' };
}
export interface DiscoverDirectoryManifestInput {
  rootHandle: FileSystemDirectoryHandle; workspaceKey: string; selections: readonly AgentSourceSelection[];
  checkpoint?: DirectoryManifestCheckpoint; signal?: AbortSignal; isCurrent?: () => boolean;
  /** Explicitly starts a new observation round. Incomplete checkpoints otherwise resume their saved round. */
  refresh?: boolean;
  /** Cooperative work budget; unlike cancellation, false saves and returns resumable state. */
  shouldContinue?: () => boolean;
  /** Counts both verification and newly discovered directory scans; never caps the whole task. */
  maxDirectoriesPerRun?: number;
  onCheckpoint: (checkpoint: DirectoryManifestCheckpoint) => Promise<void> | void;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const join = (parent: string, name: string) => parent ? `${parent}/${name}` : name;
const within = (path: string, parent: string) => !parent || path === parent || path.startsWith(parent + '/');
const missing = (error: unknown) => error instanceof DOMException && ['NotFoundError', 'TypeMismatchError'].includes(error.name);
function validRelative(path: string, allowRoot = false) {
  return (allowRoot && path === '') || Boolean(path && !/^[a-z][a-z\d+.-]*:|^\/|[\\\u0000-\u001f]/iu.test(path)
    && path.split('/').every(part => part && part !== '.' && part !== '..'));
}
function validName(name: string) { return validRelative(name) && !name.includes('/'); }
function authorizationFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (error instanceof DOMException && ['NotAllowedError', 'SecurityError', 'AbortError'].includes(error.name))
    || /permission|access denied|unauthori[sz]ed|authorization|not allowed|权限|撤权|未授权|拒绝访问|无权/iu.test(message);
}
function excluded(path: string, kind: 'file' | 'directory', explicit = false): boolean {
  const name = path.split('/').at(-1) ?? '';
  return isSensitiveCredentialPath(path) || (!explicit && (name.startsWith('.') || (kind === 'file' ? isWorkspaceInstructionPath(path)
    : ['node_modules', 'dist', 'build', 'target', 'cache'].includes(name.toLowerCase()))));
}
function selectionKey(selections: readonly AgentSourceSelection[]) {
  return JSON.stringify([...new Map(selections.map(item => [`${item.kind}:${item.path}`, item])).values()]
    .sort((a, b) => compare(a.kind + ':' + a.path, b.kind + ':' + b.path)));
}
function normalizedFolder(root: FileSystemDirectoryHandle, path: string): { path: string; absolute: boolean } {
  let value = path.trim().replace(/\\/g, '/').replace(/\/+$/u, '');
  if (!value || value === '.') return { path: '', absolute: false };
  if (/[\u0000-\u001f]/u.test(value) || value.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid directory discovery path.');
  const absolute = /^[a-z]:\//iu.test(value) || value.startsWith('/');
  if (absolute) {
    const parent = (root as FileSystemDirectoryHandle & { fullPath?: string }).fullPath?.replace(/\\/g, '/').replace(/\/+$/u, '');
    const windows = Boolean(parent && (/^[a-z]:\//iu.test(parent) || parent.startsWith('//')));
    const a = windows ? value.toLowerCase() : value, b = windows ? parent?.toLowerCase() : parent;
    if (!b || (a !== b && !a.startsWith(b + '/'))) throw new Error('Directory is outside the authorized workspace.');
    value = value.slice(parent!.length).replace(/^\//u, '');
  }
  if (!validRelative(value, true)) throw new Error('Invalid directory discovery path.');
  return { path: value, absolute };
}

/** A durable manifest, not a filesystem snapshot or proof that file content was read. */
export async function discoverDirectoryManifest(input: DiscoverDirectoryManifestInput): Promise<DirectoryManifestCheckpoint> {
  const { rootHandle: root } = input;
  const missingAt = new WeakMap<object, string>();
  const check = async () => {
    input.signal?.throwIfAborted();
    if (input.isCurrent && !input.isCurrent()) throw new Error('Directory discovery workspace or authorization changed.');
    if (root.queryPermission && await root.queryPermission({ mode: 'read' }) !== 'granted') throw new Error('Directory discovery permission revoked.');
    input.signal?.throwIfAborted();
    if (input.isCurrent && !input.isCurrent()) throw new Error('Directory discovery workspace or authorization changed.');
  };
  const canonical = async (path: string) => {
    let handle = root;
    let currentPath = '';
    for (const part of path.split('/').filter(Boolean)) {
      await check();
      if (isDesktopDirectoryHandle(handle)) invalidateDesktopDirCache(handle.fullPath);
      currentPath = join(currentPath, part);
      try { handle = await handle.getDirectoryHandle(part); }
      catch (error) { if (missing(error) && error && typeof error === 'object') missingAt.set(error, currentPath); throw error; }
    }
    await check();
    return handle;
  };
  const folder = async (path: string) => {
    const value = normalizedFolder(root, path);
    if (value.absolute || !value.path || (value.path !== root.name && !value.path.startsWith(root.name + '/'))) {
      await canonical(value.path); return value.path;
    }
    // Root-prefixed explorer paths and same-name children must never be guessed.
    const paths = [value.path, value.path === root.name ? '' : value.path.slice(root.name.length + 1)];
    const matches: string[] = [];
    for (const candidate of paths) {
      try { await canonical(candidate); matches.push(candidate); }
      catch (error) { if (!missing(error)) throw error; }
    }
    if (matches.length !== 1) throw new Error(matches.length ? 'Directory path is ambiguous within the authorized workspace.' : 'Selected directory is missing.');
    return matches[0];
  };
  await check();
  if (!input.workspaceKey || !input.selections.length) throw new Error('Directory discovery requires an authorized workspace and selections.');
  const selections: AgentSourceSelection[] = JSON.parse(selectionKey(input.selections.map(item => {
    if (!item || !['file', 'folder'].includes(item.kind) || typeof item.path !== 'string') throw new Error('Invalid directory discovery selection.');
    return { kind: item.kind, path: item.path.trim().replace(/\\/g, '/').replace(/\/+$/u, '') || (item.kind === 'folder' ? '.' : '') };
  })));
  if (input.checkpoint && (input.checkpoint.version !== 1 || input.checkpoint.workspaceKey !== input.workspaceKey
    || selectionKey(input.checkpoint.selections) !== selectionKey(selections))) throw new Error('Directory discovery checkpoint scope changed.');
  const roots: AgentSourceSelection[] = [];
  for (const selection of selections) {
    await check();
    const path = selection.kind === 'folder' ? await folder(selection.path) : (await resolveAuthorizedDocumentLocation(root, selection.path)).path;
    if (excluded(path, selection.kind === 'folder' ? 'directory' : 'file', true)) throw new Error('Credential and secret paths are excluded from directory discovery.');
    roots.push({ kind: selection.kind, path });
  }
  if (input.checkpoint && selectionKey(input.checkpoint.roots) !== selectionKey(roots)) throw new Error('Directory discovery selection identity changed.');
  const authorized = (path: string, kind: 'file' | 'directory') => roots.some(item => item.kind === 'folder' ? within(path, item.path) : kind === 'file' && path === item.path);
  const state: DirectoryManifestCheckpoint = input.checkpoint ? clone(input.checkpoint) : {
    version: 1, workspaceKey: input.workspaceKey, selections, roots, files: [], directories: [], pendingDirectories: [], complete: false, revision: 0, changedPaths: [], removedPaths: [],
  };
  if (!Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.files) || !Array.isArray(state.directories)
    || !Array.isArray(state.pendingDirectories) || state.files.some(file => !file || !validRelative(file.path) || !authorized(file.path, 'file') || !Number.isFinite(file.size) || file.size < 0 || !Number.isFinite(file.lastModified))
    || state.files.some(file => file.sourceRevision !== undefined && typeof file.sourceRevision !== 'string')
    || state.directories.some(dir => !dir || !validRelative(dir.path, true) || !authorized(dir.path, 'directory') || !Array.isArray(dir.entries)
      || dir.entries.some(entry => !entry || !validName(entry.name) || !['file', 'directory'].includes(entry.kind)
        || entry.sourceRevision !== undefined && typeof entry.sourceRevision !== 'string'))
    || new Set(state.files.map(file => file.path)).size !== state.files.length || new Set(state.directories.map(dir => dir.path)).size !== state.directories.length
    || state.pendingDirectories.some(path => !validRelative(path, true) || !authorized(path, 'directory'))
    || state.verification && (!Number.isSafeInteger(state.verification.generation) || state.verification.generation < 1
      || !['verify', 'discover'].includes(state.verification.next) || !Array.isArray(state.verification.pendingPaths)
      || state.verification.pendingPaths.some(path => !validRelative(path, true) || !authorized(path, 'directory'))
      || new Set(state.verification.pendingPaths).size !== state.verification.pendingPaths.length)) throw new Error('Invalid directory discovery checkpoint.');
  // Rebuild reachability from real roots; untrusted persisted pending cursors do not grant access.
  const before = new Map(state.files.map(file => [file.path, file]));
  const explicit = new Map<string, DirectoryManifestFile>();
  const records = new Map(state.directories.map(dir => [dir.path, dir]));
  const refresh = input.refresh ?? Boolean(input.checkpoint?.complete);
  if (!state.verification || refresh) state.verification = { generation: (state.verification?.generation ?? 0) + 1,
    pendingPaths: [...records.keys()].sort((a, b) => a.split('/').length - b.split('/').length || compare(a, b)),
    next: state.pendingDirectories.length ? 'discover' : 'verify' };
  const verification = state.verification;
  const awaitingRevalidation = new Set(verification.pendingPaths);
  function rebuild() {
    const reachable = new Set(roots.filter(item => item.kind === 'folder').map(item => item.path));
    const files = new Map(explicit);
    const queue = [...reachable].sort(compare);
    for (let i = 0; i < queue.length; i++) {
      const record = records.get(queue[i]);
      if (!record) continue;
      for (const entry of record.entries) {
        const path = join(record.path, entry.name);
        if (excluded(path, entry.kind)) continue;
        if (entry.kind === 'directory') { if (!reachable.has(path)) { reachable.add(path); queue.push(path); } }
        else files.set(path, { path, size: entry.size ?? 0, lastModified: entry.lastModified ?? 0, supported: Boolean(entry.supported),
          ...(entry.sourceRevision !== undefined ? { sourceRevision: entry.sourceRevision } : {}), ...(entry.metadataError ? { metadataError: entry.metadataError } : {}) });
      }
    }
    for (const path of records.keys()) if (!reachable.has(path)) { records.delete(path); awaitingRevalidation.delete(path); }
    for (const path of awaitingRevalidation) if (!records.has(path)) awaitingRevalidation.delete(path);
    state.directories = [...records.values()].sort((a, b) => compare(a.path, b.path));
    state.files = [...files.values()].sort((a, b) => compare(a.path, b.path));
    state.pendingDirectories = [...reachable].filter(path => !records.has(path)).sort(compare);
    verification.pendingPaths = [...awaitingRevalidation];
    state.complete = state.pendingDirectories.length === 0 && awaitingRevalidation.size === 0;
    state.changedPaths = state.files.filter(file => JSON.stringify(file) !== JSON.stringify(before.get(file.path))).map(file => file.path);
    const current = new Set(state.files.map(file => file.path));
    state.removedPaths = [...before.keys()].filter(path => !current.has(path)).sort(compare);
  }
  const publish = async () => { rebuild(); state.revision++; await check(); await input.onCheckpoint(clone(state)); await check(); };
  const metadata = async (path: string, handle: FileSystemFileHandle): Promise<DirectoryManifestFile> => {
    await check();
    let size = 0, lastModified = 0, metadataError: string | undefined, sourceRevision: string | undefined;
    try {
      const cloudMetadata = (handle as FileSystemFileHandle & { getCloudMetadata?: () => Promise<{ size: number; lastModified: number; sourceRevision?: string }> }).getCloudMetadata;
      if (cloudMetadata) { const stat = await cloudMetadata.call(handle); size = stat.size; lastModified = stat.lastModified; sourceRevision = stat.sourceRevision; }
      else if (isDesktopFileHandle(handle)) { const stat = await readDesktopFileMetadata(handle.fullPath); size = stat.size; lastModified = stat.modifiedMs ?? 0; }
      else { const file = await handle.getFile(); size = file.size; lastModified = file.lastModified; }
    } catch (error) {
      if (authorizationFailure(error)) throw error;
      metadataError = error instanceof Error ? error.name : 'MetadataError';
    }
    await check();
    return { path, size, lastModified, supported: isAgentDocumentPath(path), ...(sourceRevision !== undefined ? { sourceRevision } : {}), ...(metadataError ? { metadataError } : {}) };
  };
  for (const selection of roots.filter(item => item.kind === 'file')) {
    await check();
    const location = await resolveAuthorizedDocumentLocation(root, selection.path);
    explicit.set(selection.path, await metadata(selection.path, location.handle));
  }
  const scan = async (path: string, kind: 'verify' | 'discover') => {
    await check();
    let handle: FileSystemDirectoryHandle;
    try { handle = await canonical(path); }
    catch (error) {
      // Reopen the entire real parent chain before using a persisted path. A
      // removed directory invalidates its descendants; it is not an empty scan.
      if (!missing(error)) throw error;
      const removed = error && typeof error === 'object' ? missingAt.get(error) ?? path : path;
      if (roots.some(item => item.kind === 'folder' && within(item.path, removed))) throw error;
      for (const candidate of records.keys()) if (within(candidate, removed)) { records.delete(candidate); awaitingRevalidation.delete(candidate); }
      const parts = removed.split('/'), name = parts.pop()!;
      const parent = records.get(parts.join('/'));
      if (parent) parent.entries = parent.entries.filter(entry => entry.name !== name);
      awaitingRevalidation.delete(path);
      verification.next = kind === 'verify' ? 'discover' : 'verify';
      await publish();
      return;
    }
    if (isDesktopDirectoryHandle(handle)) invalidateDesktopDirCache(handle.fullPath);
    const entries: DirectoryManifestEntry[] = [];
    for await (const item of handle.values()) {
      await check();
      if (!validName(item.name) || !['file', 'directory'].includes(item.kind)) throw new Error('Invalid directory entry.');
      const itemPath = join(path, item.name);
      if (excluded(itemPath, item.kind)) continue;
      if (item.kind === 'directory') entries.push({ name: item.name, kind: 'directory' });
      else { const { path: _path, ...data } = await metadata(itemPath, item as FileSystemFileHandle); entries.push({ name: item.name, kind: 'file', ...data }); }
    }
    await check();
    records.set(path, { path, entries: entries.sort((a, b) => compare(a.name, b.name)) });
    awaitingRevalidation.delete(path);
    verification.next = kind === 'verify' ? 'discover' : 'verify';
    await publish();
  };
  // Persist round membership before work. A deadline after a saved scan must not
  // restart verification at the first old directory in the next invocation.
  await publish();
  const maxDirectories = Number.isFinite(input.maxDirectoriesPerRun) ? Math.max(1, Math.floor(input.maxDirectoriesPerRun!)) : 64;
  for (let visited = 0; visited < maxDirectories && !state.complete; visited++) {
    await check();
    if (input.shouldContinue && !input.shouldContinue()) break;
    const verify = verification.pendingPaths[0], discover = state.pendingDirectories[0];
    const kind = verification.next === 'verify' && verify !== undefined || discover === undefined ? 'verify' : 'discover';
    const path = kind === 'verify' ? verify : discover;
    if (path === undefined) break;
    await scan(path, kind);
  }
  await check();
  return clone(state);
}
