import type { CloudLibrarySourceProvider, CloudLibraryResource } from '@/lib/shared-library/source-provider';
import type { Item } from '@/lib/shared-library/domain';
import { cloudResourceFile, openCloudAgentDocumentSourceFromResource, type CloudAgentSourceSelection } from './cloud-source';
import type { AgentSourceSelection } from './source-index';
import type { AgentDocumentSource } from './document-source';

export interface CloudDirectoryScopeSelection extends CloudAgentSourceSelection {
  /** Stable, human-readable path component used by the resumable directory manifest. */
  path: string;
}
export interface CloudDirectoryScope {
  version: 1;
  providerScope: string;
  selections: CloudDirectoryScopeSelection[];
}
export interface CloudDirectoryResearchAdapter {
  rootHandle: FileSystemDirectoryHandle;
  workspaceKey: string;
  selections: AgentSourceSelection[];
  isCurrent: () => boolean;
  openSource: (file: File, path: string, signal?: AbortSignal) => Promise<AgentDocumentSource>;
  cloud: CloudDirectoryScope;
}

const parentId = (item: Item) => typeof item.metadata.parentItemId === 'string' ? item.metadata.parentItemId : undefined;
function assertCurrent(provider: CloudLibrarySourceProvider, scope: string, isCurrent: () => boolean, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (provider.scope !== scope || !isCurrent()) throw new Error('云目录连接、账号或访问权限已变化，已停止续读。');
}
function validCloudName(name: string) {
  if (!name || name === '.' || name === '..' || /[\u0000-\u001f/\\]/u.test(name) || /^[a-z][a-z\d+.-]*:/iu.test(name)) {
    throw new Error('云目录包含无效文件名，未继续读取。');
  }
}
function readablePathName(item: Item) {
  const name = item.canonicalName;
  if (item.kind === 'folder' || /\.[a-z\d]{1,10}$/iu.test(name)) return name;
  const extension: Record<string, string> = { pdf: '.pdf', markdown: '.md', notebook: '.ipynb', docx: '.docx', pptx: '.pptx', code: '.txt', web_snapshot: '.html' };
  return name + (extension[item.kind] ?? '');
}
function disambiguatedNames(items: readonly Item[]): Map<string, string> {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const pathName = readablePathName(item);
    validCloudName(pathName);
    const group = groups.get(pathName) ?? [];
    group.push(item); groups.set(pathName, group);
  }
  const names = new Map<string, string>();
  for (const [name, group] of groups) {
    if (group.length === 1) { names.set(group[0].id, name); continue; }
    const extensionIndex = name.lastIndexOf('.');
    const stem = extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
    const extension = extensionIndex > 0 ? name.slice(extensionIndex) : '';
    for (const item of group) names.set(item.id, `${stem}--${encodeURIComponent(item.id)}${extension}`);
  }
  return names;
}
function sameSelection(a: CloudAgentSourceSelection, b: CloudAgentSourceSelection) {
  return a.libraryId === b.libraryId && a.itemId === b.itemId && a.kind === b.kind;
}

/**
 * Presents a cloud folder as an authorized, read-only directory handle so the
 * same durable manifest, per-file checkpoints and hierarchical reader work for
 * local and shared-library folders. Paths remain readable; item IDs and the
 * provider permission scope are separately bound into the checkpoint.
 */
export async function createCloudDirectoryResearchAdapter(input: {
  provider: CloudLibrarySourceProvider;
  selections?: readonly CloudAgentSourceSelection[];
  checkpoint?: CloudDirectoryScope;
  signal?: AbortSignal;
  isCurrent?: () => boolean;
}): Promise<CloudDirectoryResearchAdapter> {
  const providerScope = input.provider.scope;
  if (!providerScope) throw new Error('云目录连接没有可核验的权限身份，不能开始持久化阅读。');
  const isCurrent = input.isCurrent ?? (() => true);
  const check = (signal?: AbortSignal) => assertCurrent(input.provider, providerScope, isCurrent, signal);
  const checkpoint = input.checkpoint;
  if (checkpoint && (checkpoint.version !== 1 || checkpoint.providerScope !== providerScope || !Array.isArray(checkpoint.selections))) {
    throw new Error('云目录检查点所属的账号或权限范围已变化，请重新选择目录。');
  }
  const requested = input.selections ?? checkpoint?.selections.map(({ libraryId, itemId, kind }) => ({ libraryId, itemId, kind })) ?? [];
  if (!requested.length || requested.some(selection => !selection.libraryId || !selection.itemId || !['folder', 'file'].includes(selection.kind))) {
    throw new Error('请先选择要读取的云端文件夹或文件。');
  }
  if (new Set(requested.map(selection => selection.libraryId)).size !== 1) throw new Error('一次云目录阅读必须属于同一个共享库。');
  if (checkpoint && (checkpoint.selections.length !== requested.length
    || checkpoint.selections.some((saved, index) => !sameSelection(saved, requested[index])))) {
    throw new Error('云目录检查点的原始选择已变化，请从原任务恢复或重新选择来源。');
  }
  check(input.signal);

  const rootItems: Item[] = [];
  const persistedSelections: CloudDirectoryScopeSelection[] = [];
  for (let index = 0; index < requested.length; index += 1) {
    const selection = requested[index];
    const saved = checkpoint?.selections[index];
    const resource = await input.provider.read(selection.libraryId, selection.itemId, input.signal);
    check(input.signal);
    if (resource.libraryId !== selection.libraryId || resource.itemId !== selection.itemId
      || (selection.kind === 'folder') !== (resource.kind === 'folder')) throw new Error('云目录的原始资源身份已变化，请重新选择来源。');
    const path = saved?.path ?? resource.name;
    validCloudName(path);
    rootItems.push({ id: selection.itemId, libraryId: selection.libraryId, kind: resource.kind, canonicalName: path,
      title: path, status: 'active', metadata: {}, currentVersionId: resource.versionId, createdAt: '', updatedAt: resource.content?.updatedAt ?? '' } as Item);
    persistedSelections.push({ ...selection, path });
  }
  const rootNames = disambiguatedNames(rootItems);
  for (const selection of persistedSelections) selection.path = rootNames.get(selection.itemId)!;
  const fileResources = new WeakMap<File, CloudLibraryResource>();
  const listChildren = async (libraryId: string, folderId: string, signal?: AbortSignal) => {
    check(signal);
    const items = await input.provider.list(libraryId, folderId, signal);
    check(signal);
    if (items.some(item => item.libraryId !== libraryId || parentId(item) !== folderId || item.status !== 'active')) {
      throw new Error('云库返回了不属于授权目录的条目，已停止读取。');
    }
    return items;
  };
  // FileSystem handles require methods to be stable objects; build each handle
  // with a closure over itself to preserve same-entry behavior in Web APIs.
  const makeFileHandle = (item: Item, name: string, signal?: AbortSignal): FileSystemFileHandle => {
    validCloudName(name);
    const methods = {
      kind: 'file' as const, name,
      async getFile() {
        check(signal);
        const resource = await input.provider.read(item.libraryId, item.id, signal);
        check(signal);
        if (resource.libraryId !== item.libraryId || resource.itemId !== item.id || resource.kind === 'folder') throw new Error('云文件身份已变化，不能将其作为原文读取。');
        const file = cloudResourceFile(resource); fileResources.set(file, resource); return file;
      },
      async getCloudMetadata() {
        check(signal);
        const size = [item.metadata.sizeBytes, item.metadata.size, item.metadata.fileSize].find(value => Number.isFinite(value) && Number(value) >= 0);
        return { size: size === undefined ? 0 : Number(size), lastModified: Date.parse(item.updatedAt) || 0,
          // Listing metadata only invalidates cached work; actual bytes, role
          // and provider scope are still verified when opening/reading a source.
          sourceRevision: JSON.stringify([item.libraryId, item.id, item.currentVersionId ?? null, item.contentHash ?? null]) };
      },
      async createWritable() { throw new Error('Cloud research sources are read-only.'); },
      async isSameEntry(other: FileSystemHandle) { return other === handle; },
      async queryPermission() { check(signal); return 'granted'; }, async requestPermission() { check(signal); return 'granted'; },
    };
    const handle = methods as unknown as FileSystemFileHandle;
    return handle;
  };

  const makeDirectoryHandle = (libraryId: string, folderId: string, name: string, signal?: AbortSignal, ancestors: readonly string[] = [folderId]): FileSystemDirectoryHandle => {
    validCloudName(name);
    const makeEntries = async () => {
      const items = await listChildren(libraryId, folderId, signal);
      const names = disambiguatedNames(items);
      return items.map(item => {
        if (item.kind === 'folder') {
          if (ancestors.includes(item.id)) throw new Error('Cloud folder cycle detected; directory reading stopped.');
          return makeDirectoryHandle(libraryId, item.id, names.get(item.id)!, signal, [...ancestors, item.id]);
        }
        return makeFileHandle(item, names.get(item.id)!, signal);
      });
    };
    const handle = {
      kind: 'directory' as const, name,
      async queryPermission() { check(signal); return 'granted'; }, async requestPermission() { check(signal); return 'granted'; },
      async getDirectoryHandle(childName: string) {
        const children = await listChildren(libraryId, folderId, signal); const names = disambiguatedNames(children);
        const matches = children.filter(item => item.kind === 'folder' && names.get(item.id) === childName);
        if (matches.length !== 1) throw new DOMException('Cloud directory not found or ambiguous.', 'NotFoundError');
        if (ancestors.includes(matches[0].id)) throw new Error('Cloud folder cycle detected; directory reading stopped.');
        return makeDirectoryHandle(libraryId, matches[0].id, childName, signal, [...ancestors, matches[0].id]);
      },
      async getFileHandle(childName: string) {
        const children = await listChildren(libraryId, folderId, signal); const names = disambiguatedNames(children);
        const matches = children.filter(item => item.kind !== 'folder' && names.get(item.id) === childName);
        if (matches.length !== 1) throw new DOMException('Cloud file not found or ambiguous.', 'NotFoundError');
        return makeFileHandle(matches[0], childName, signal);
      },
      async *values() { yield* await makeEntries(); },
      async *keys() { for (const entry of await makeEntries()) yield entry.name; },
      async *entries() { for (const entry of await makeEntries()) yield [entry.name, entry] as [string, FileSystemHandle]; },
      [Symbol.asyncIterator]() { return this.values(); },
      async removeEntry() { throw new Error('Cloud research sources are read-only.'); },
      async resolve(possibleDescendant: FileSystemHandle) { return possibleDescendant === handle ? [] : null; },
      async isSameEntry(other: FileSystemHandle) { return other === handle; },
    };
    return handle as unknown as FileSystemDirectoryHandle;
  };
  // The synthetic root has selected resources as children; each ordinary folder
  // still resolves to its cloud item ID and exposes no local filesystem access.
  const rootEntries = () => {
    check(input.signal);
    return persistedSelections.map(selection => {
      const item = rootItems.find(candidate => candidate.id === selection.itemId)!;
      return item.kind === 'folder' ? makeDirectoryHandle(item.libraryId, item.id, selection.path, input.signal) : makeFileHandle(item, selection.path, input.signal);
    });
  };
  const rootMethods = {
    name: 'cloud-workspace', kind: 'directory' as const,
    async getDirectoryHandle(name: string) {
      check(input.signal);
      const matches = persistedSelections.filter(selection => selection.kind === 'folder' && selection.path === name);
      if (matches.length !== 1) throw new DOMException('Cloud selected directory missing or ambiguous.', 'NotFoundError');
      const selection = matches[0]; return makeDirectoryHandle(selection.libraryId, selection.itemId, selection.path, input.signal);
    },
    async getFileHandle(name: string) {
      check(input.signal);
      const matches = persistedSelections.filter(selection => selection.kind === 'file' && selection.path === name);
      if (matches.length !== 1) throw new DOMException('Cloud selected file missing or ambiguous.', 'NotFoundError');
      const selection = matches[0], item = rootItems.find(candidate => candidate.id === selection.itemId)!;
      return makeFileHandle(item, selection.path, input.signal);
    },
    async *values() { yield* rootEntries(); },
    async *keys() { for (const entry of rootEntries()) yield entry.name; },
    async *entries() { for (const entry of rootEntries()) yield [entry.name, entry] as [string, FileSystemHandle]; },
    [Symbol.asyncIterator]() { return this.values(); },
    async queryPermission() { check(input.signal); return 'granted'; },
    async requestPermission() { check(input.signal); return 'granted'; },
    async removeEntry() { throw new Error('Cloud research sources are read-only.'); },
    async resolve(possibleDescendant: FileSystemHandle) { return possibleDescendant === rootHandle ? [] : null; },
    async isSameEntry(other: FileSystemHandle) { return other === rootHandle; },
  };
  const rootHandle = rootMethods as unknown as FileSystemDirectoryHandle;

  const cloud: CloudDirectoryScope = { version: 1, providerScope,
    selections: persistedSelections.map(selection => ({ ...selection })) };
  const folderSelections = persistedSelections.map(selection => ({ kind: selection.kind, path: selection.path } as AgentSourceSelection));
  return { rootHandle, workspaceKey: `cloud:${requested[0].libraryId}`, selections: folderSelections,
    cloud, isCurrent: () => { try { check(input.signal); return true; } catch { return false; } },
    openSource: async (file, _path, signal) => {
      check(signal);
      const resource = fileResources.get(file);
      if (!resource) throw new Error('云目录文件已脱离本次授权读取，拒绝使用缓存正文。');
      return openCloudAgentDocumentSourceFromResource({ provider: input.provider, resource, file, fileName: _path, providerScope,
        signal, isCurrent: () => { try { check(signal); return true; } catch { return false; } } });
    } };
}
