import type { CloudLibraryWorkspaceController } from './cloud-workspace';
import type { Item } from './domain';
import type { AnnotationItem } from '@/types/universal-annotation';
import { buildFileFingerprint } from '@/lib/file-identity';
import { loadPdfItemManifest } from '@/lib/pdf-item';
import { deserializeAnnotationFileWithValidation, generateFileId, getAnnotationFilePath, resolveAnnotationFileCandidates } from '@/lib/universal-annotation-storage';
import { fromLegacyAnnotation } from './annotation-adapter';
import { cloudContentFromBytes, cloudFileKind } from './file-content';
import { defaultSha256Hex } from './blob-store';
import { resolveAnnotationRegistryMatch } from '@/lib/annotation-registry';

export interface LocalWorkspaceUploadEntry {
  path: string;
  storagePath?: string;
  name?: string;
  kind: 'file' | 'directory';
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
}
export interface LocalPdfUploadBundle {
  file: File;
  sourcePath: string;
  sourceSha256: string;
  binding: 'fingerprint' | 'legacy-path';
  documentId: string;
  annotations: AnnotationItem[];
  children: Array<{ relativePath: string; kind: 'file' | 'directory'; file?: File }>;
  warnings: string[];
}
export interface LocalWorkspaceUploadResult { items: Item[]; annotationsImported: number; warnings: string[] }
const MAX_ENTRIES = 2000;
const DEFAULT_MAX_FILE_BYTES = 200 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 512 * 1024 * 1024;
function check(signal?: AbortSignal) { signal?.throwIfAborted(); }
function relativePath(path: string): string {
  const value = path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (/^[a-z]:|^\/|[\u0000-\u001f]/iu.test(value) || value.split('/').some(part => part === '..' || part === '.')) throw new Error(`上传路径必须在已选择工作区内：${path}`);
  return value;
}
async function fileAt(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle> {
  const parts = relativePath(path).split('/'), name = parts.pop()!;
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part);
  return directory.getFileHandle(name);
}
function missing(error: unknown) { return error instanceof DOMException && ['NotFoundError', 'TypeMismatchError'].includes(error.name); }
async function snapshotFile(handle: FileSystemFileHandle, signal?: AbortSignal, maxFileBytes = DEFAULT_MAX_FILE_BYTES): Promise<File> {
  check(signal);
  const file = await handle.getFile();
  if (file.size > maxFileBytes) throw new Error(`文件超过当前连接单文件限额 ${maxFileBytes} bytes：${file.name}`);
  const bytes = await file.arrayBuffer();
  check(signal);
  return new File([bytes], file.name, { type: file.type, lastModified: file.lastModified });
}
export async function collectLocalPdfUploadBundle(input: { rootHandle: FileSystemDirectoryHandle; pdfPath: string; pdfHandle?: FileSystemFileHandle; storagePath?: string; signal?: AbortSignal; maxFileBytes?: number; maxTotalBytes?: number }): Promise<LocalPdfUploadBundle> {
  check(input.signal);
  const sourcePath = relativePath(input.storagePath ?? input.pdfPath);
  const handle = input.pdfHandle ?? await fileAt(input.rootHandle, sourcePath);
  const file = await snapshotFile(handle, input.signal, input.maxFileBytes);
  const sourceSha256 = await defaultSha256Hex(await file.arrayBuffer());
  const bundle: LocalPdfUploadBundle = { file, sourcePath, sourceSha256, documentId: generateFileId(sourcePath), binding: 'legacy-path', annotations: [], children: [], warnings: [] };
  // Fingerprint this exact frozen File; no second getFile() can swap the uploaded bytes.
  const fingerprint = await buildFileFingerprint({ getFile: async () => file } as FileSystemFileHandle);
  const manifest = await loadPdfItemManifest(input.rootHandle, generateFileId(sourcePath), sourcePath);
  const registry = await resolveAnnotationRegistryMatch({ fileFingerprint: fingerprint.fingerprint, versionFingerprint: fingerprint.versionFingerprint, canonicalPath: null });
  const verifiedAliases = registry.aliases.filter(alias => fingerprint.fingerprint && fingerprint.versionFingerprint && alias.fileFingerprint === fingerprint.fingerprint && alias.versionFingerprint === fingerprint.versionFingerprint);
  bundle.documentId = manifest.fileFingerprint || manifest.versionFingerprint ? manifest.itemId : verifiedAliases.length && registry.documentId ? registry.documentId : manifest.itemId;
  check(input.signal);
  let itemDirectory: FileSystemDirectoryHandle | undefined;
  try {
    itemDirectory = input.rootHandle;
    for (const part of relativePath(manifest.itemFolderPath).split('/')) itemDirectory = await itemDirectory.getDirectoryHandle(part);
  } catch (error) { if (!missing(error)) throw error; itemDirectory = undefined; }
  // Unversioned legacy sidecars must match the exact path-derived id; a basename suffix alone is ambiguous.
  const exactPathId = resolveAnnotationFileCandidates(file.name, sourcePath)[0];
  const candidates = [...new Set([manifest.itemId, exactPathId, ...verifiedAliases.map(alias => alias.fileId)])];
  const sidecars: Array<{ path: string; text: string }> = [];
  for (const id of candidates) {
    const path = getAnnotationFilePath(id);
    try { const sidecar = await (await fileAt(input.rootHandle, path)).getFile(); if (sidecar.size > 16 * 1024 * 1024) throw new Error('批注文件超过 16 MiB 读取限额'); sidecars.push({ path, text: await sidecar.text() }); }
    catch (error) { if (!missing(error)) bundle.warnings.push(`无法读取批注 ${path}：${error instanceof Error ? error.message : String(error)}`); }
  }
  if (!itemDirectory && !sidecars.length) return bundle;
  if (manifest.fileFingerprint && manifest.fileFingerprint !== fingerprint.fingerprint || manifest.versionFingerprint && manifest.versionFingerprint !== fingerprint.versionFingerprint) {
    bundle.warnings.push(`${file.name} 的本地批注/子文件版本指纹已变化，已仅上传 PDF 原文件；请在本地重新打开原版本后重试。`);
    return bundle;
  }
  if (manifest.fileFingerprint && manifest.versionFingerprint || verifiedAliases.length) bundle.binding = 'fingerprint';
  const annotationIds = new Set<string>();
  for (const sidecar of sidecars) {
    try {
      const raw: unknown = JSON.parse(sidecar.text);
      if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { annotations?: unknown }).annotations)) throw new Error('批注文件格式无效');
      const envelope = raw as Record<string, unknown> & { annotations: unknown[] };
      if (envelope.documentId && envelope.documentId !== bundle.documentId && envelope.documentId !== exactPathId) throw new Error('批注文件身份与 PDF 不一致');
      if (envelope.annotations.length > 10_000) throw new Error('批注超过 10000 条导入限额');
      for (const [index, candidate] of envelope.annotations.entries()) {
        const id = candidate && typeof candidate === 'object' && 'id' in candidate ? String(candidate.id) : String(index + 1);
        const parsed = deserializeAnnotationFileWithValidation(JSON.stringify({ ...envelope, annotations: [candidate] }));
        const annotation = parsed.file?.annotations[0];
        if (!annotation || annotation.target.type !== 'pdf') { bundle.warnings.push(`批注 ${id} 格式不受支持，未导入（${sidecar.path}）。`); continue; }
        if (!annotationIds.has(annotation.id)) { annotationIds.add(annotation.id); bundle.annotations.push(annotation); }
      }
    } catch (error) { bundle.warnings.push(`批注 ${sidecar.path} 未导入：${error instanceof Error ? error.message : String(error)}`); }
  }
  let bytes = file.size;
  async function walk(directory: FileSystemDirectoryHandle, prefix: string) {
    check(input.signal);
    const entries: FileSystemHandle[] = [];
    for await (const entry of directory.values()) {
      if (entries.length + bundle.children.length >= MAX_ENTRIES) throw new Error('PDF 子文件超过上传条目预算，请缩小范围。');
      if (entry.name !== 'manifest.json' && entry.name !== '_overview.md') entries.push(entry);
    }
    entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1));
    for (const entry of entries) {
      const path = relativePath(prefix ? `${prefix}/${entry.name}` : entry.name);
      if (entry.kind === 'directory') { bundle.children.push({ relativePath: path, kind: 'directory' }); await walk(entry as FileSystemDirectoryHandle, path); }
      else {
        const child = await snapshotFile(entry as FileSystemFileHandle, input.signal, input.maxFileBytes);
        bytes += child.size;
        if (bytes > (input.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES)) throw new Error(`PDF 及子文件超过本次上传 ${input.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES} bytes 总读取预算，请缩小范围。`);
        bundle.children.push({ relativePath: path, kind: 'file', file: child });
      }
    }
  }
  if (itemDirectory) await walk(itemDirectory, '');
  check(input.signal);
  return bundle;
}
export async function uploadLocalWorkspaceEntries(input: { rootHandle: FileSystemDirectoryHandle; entries: readonly LocalWorkspaceUploadEntry[]; controller: Pick<CloudLibraryWorkspaceController, 'createItem' | 'createAnnotation' | 'userId'> & { connection?: { maxFileBytes: number } }; libraryId: string; parentItemId?: string; signal?: AbortSignal; maxTotalBytes?: number }): Promise<LocalWorkspaceUploadResult> {
  check(input.signal);
  const result: LocalWorkspaceUploadResult = { items: [], annotationsImported: 0, warnings: [] };
  type Planned = { key: string; name: string; parent?: string; file?: File; pdf?: LocalPdfUploadBundle };
  const plan: Planned[] = [];
  const maxFileBytes = input.controller.connection?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = input.maxTotalBytes ?? Math.max(DEFAULT_MAX_TOTAL_BYTES, maxFileBytes);
  let bytes = 0;
  function add(item: Planned) {
    bytes += item.file?.size ?? 0;
    if (plan.length >= MAX_ENTRIES || bytes > maxTotalBytes) throw new Error(`选定文件超过 ${MAX_ENTRIES} 条目或 ${maxTotalBytes} bytes 本次上传预算，请选择更小的文件夹。`);
    plan.push(item);
  }
  async function collect(entry: LocalWorkspaceUploadEntry, parent?: string) {
    check(input.signal);
    const storagePath = relativePath(entry.storagePath ?? entry.path);
    const name = entry.name ?? entry.handle.name;
    if (!name || /[\\/\u0000-\u001f]/u.test(name) || name === '.' || name === '..') throw new Error('上传名称必须是单个文件名。');
    const key = `${plan.length}:${storagePath}`;
    if (entry.kind === 'directory') {
      add({ key, name, parent });
      const children: FileSystemHandle[] = [];
      for await (const child of (entry.handle as FileSystemDirectoryHandle).values()) {
        if (children.length + plan.length >= MAX_ENTRIES) throw new Error('选定文件夹超过上传条目预算。');
        if (child.name === '.lattice' || child.name === '.git' || child.name === 'node_modules') continue;
        children.push(child);
      }
      children.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1));
      for (const child of children) await collect({ path: storagePath ? `${storagePath}/${child.name}` : child.name, kind: child.kind, handle: child as FileSystemFileHandle | FileSystemDirectoryHandle }, key);
    } else if (/\.pdf$/iu.test(name)) {
      const pdf = await collectLocalPdfUploadBundle({ rootHandle: input.rootHandle, pdfPath: storagePath, pdfHandle: entry.handle as FileSystemFileHandle, signal: input.signal, maxFileBytes, maxTotalBytes });
      add({ key, name, parent, file: pdf.file, pdf }); result.warnings.push(...pdf.warnings);
      const parents = new Map([['', key]]);
      for (const child of pdf.children) {
        const split = child.relativePath.lastIndexOf('/'), directory = split < 0 ? '' : child.relativePath.slice(0, split);
        const childKey = `${key}/${child.relativePath}`;
        add({ key: childKey, name: child.relativePath.slice(split + 1), parent: parents.get(directory) ?? key, file: child.file });
        if (child.kind === 'directory') parents.set(child.relativePath, childKey);
      }
    } else add({ key, name, parent, file: await snapshotFile(entry.handle as FileSystemFileHandle, input.signal, maxFileBytes) });
  }
  for (const entry of input.entries) await collect(entry);
  const uploaded = new Map<string, Item>();
  for (const entry of plan) {
    check(input.signal);
    const content = entry.file ? cloudContentFromBytes(entry.name, await entry.file.arrayBuffer(), entry.file.type, new Date(entry.file.lastModified).toISOString()) : undefined;
    const item = await input.controller.createItem({ libraryId: input.libraryId, name: entry.name, kind: entry.file ? cloudFileKind(entry.name, entry.file.type) : 'folder', parentItemId: entry.parent ? uploaded.get(entry.parent)?.id : input.parentItemId }, content);
    uploaded.set(entry.key, item); result.items.push(item);
    if (entry.pdf?.annotations.length) {
      if (!item.currentVersionId) throw new Error('PDF 上传未生成版本，批注尚未导入，请重试。');
      for (const annotation of entry.pdf.annotations) {
        check(input.signal);
        const adapted = fromLegacyAnnotation(annotation, { itemId: item.id, versionId: item.currentVersionId });
        await input.controller.createAnnotation(input.libraryId, { itemId: item.id, versionId: item.currentVersionId, kind: adapted.kind, target: adapted.target, style: adapted.style, quote: adapted.quote, geometry: adapted.geometry,
          body: { ...adapted.body, importedFromLocal: { annotationId: annotation.id, author: annotation.author, createdAt: annotation.createdAt, sourceSha256: entry.pdf.sourceSha256, binding: entry.pdf.binding, documentId: entry.pdf.documentId } } });
        result.annotationsImported++;
      }
    }
  }
  check(input.signal);
  return result;
}
