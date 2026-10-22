import type { CloudLibraryResource, CloudLibrarySourceProvider } from '@/lib/shared-library/source-provider';
import { getCloudWorkspaceSnapshot } from '@/lib/cloud-workspace-host';
import { getAgentDocumentVersion, openAgentDocumentSource, type AgentDocumentSource } from './document-source';
import type { EvidenceRef } from './types';
import type { AgentSourceSnapshot } from './source-index';
import { isAgentDocumentPath } from './document-source';
import type { Item } from '@/lib/shared-library/domain';

export interface CloudAgentSourceSnapshot extends AgentSourceSnapshot {
  cloudIdentity: NonNullable<EvidenceRef['cloudIdentity']>;
  providerScope?: string;
}
export interface CloudAgentSourceSelection { libraryId: string; itemId: string; kind: 'file' | 'folder' }
export function buildCloudSourceSelectionMention(selection: CloudAgentSourceSelection): string {
  return `@${selection.kind === 'folder' ? 'cloud-folder' : 'cloud'}:${encodeURIComponent(selection.libraryId)}:${encodeURIComponent(selection.itemId)}`;
}
function cloudSelectionMentions(query: string): { selections: CloudAgentSourceSelection[]; invalid: string[] } {
  const selections: CloudAgentSourceSelection[] = [], invalid: string[] = [];
  for (const match of query.matchAll(/@(cloud-folder|cloud):([^\s@]*)/g)) {
    try {
      const parts = match[2].replace(/[，。；,;]+$/, '').split(':');
      if (parts.length !== 2) throw new Error('Invalid cloud selection.');
      const [libraryId, itemId] = parts.map(part => decodeURIComponent(part));
      if (!libraryId || !itemId || /[\u0000-\u001f]/u.test(libraryId + itemId)) throw new Error('Invalid cloud selection.');
      selections.push({ kind: match[1] === 'cloud-folder' ? 'folder' : 'file', libraryId, itemId });
    } catch { invalid.push(match[0]); }
  }
  return { selections: selections.filter((selection, index) => selections.findIndex(other => other.libraryId === selection.libraryId && other.itemId === selection.itemId && other.kind === selection.kind) === index), invalid: [...new Set(invalid)] };
}
export function parseCloudSourceSelections(query: string): CloudAgentSourceSelection[] { return cloudSelectionMentions(query).selections; }
export function invalidCloudSourceSelectionMentions(query: string): string[] { return cloudSelectionMentions(query).invalid; }
export function cloudAgentWorkspaceKey(resource: CloudLibraryResource): string { return `cloud:${resource.libraryId}`; }
function abort(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException('Cloud source cancelled', 'AbortError'); }
function bound(value: number | undefined, fallback: number, maximum: number) { return Number.isFinite(value) ? Math.max(1, Math.min(maximum, Math.floor(value!))) : fallback; }
export function cloudResourceFile(resource: CloudLibraryResource): File {
  if (!resource.content) throw new Error('Cloud source has no readable content.');
  const content = resource.content;
  return new File([content.kind === 'text' ? content.text : content.data], resource.name, { type: content.mimeType });
}
async function cloudVersion(resource: CloudLibraryResource, file: File, signal?: AbortSignal) {
  return `${resource.versionId ?? 'unversioned'}|${await getAgentDocumentVersion(file, resource.id, signal)}`;
}
export async function verifyCloudAgentCitation(input: {
  provider: CloudLibrarySourceProvider; identity: NonNullable<EvidenceRef['cloudIdentity']>; signal?: AbortSignal;
}): Promise<CloudLibraryResource> {
  const { provider, identity, signal } = input;
  const scope = provider.scope;
  abort(signal);
  const resource = await provider.read(identity.libraryId, identity.itemId, signal);
  abort(signal);
  if (provider.scope !== scope || resource.id !== identity.resourceId || resource.libraryId !== identity.libraryId ||
    resource.itemId !== identity.itemId || resource.role !== identity.role || resource.versionId !== identity.versionId ||
    await cloudVersion(resource, cloudResourceFile(resource), signal) !== identity.version) {
    throw new Error('云来源的权限或版本已变化，请重新选择来源后生成引用。');
  }
  return resource;
}
export async function captureCloudAgentDocumentSources(input: {
  provider: CloudLibrarySourceProvider; resource: CloudLibraryResource; signal?: AbortSignal; maxBytes?: number; isCurrent?: () => boolean;
}): Promise<{ sources: AgentDocumentSource[]; snapshots: CloudAgentSourceSnapshot[] }> {
  const providerScope = input.provider.scope;
  const check = () => { abort(input.signal); if (input.provider.scope !== providerScope || input.isCurrent && !input.isCurrent()) throw new Error('Cloud provider permission scope changed.'); };
  check();
  const resource = await input.provider.read(input.resource.libraryId, input.resource.itemId, input.signal);
  check();
  if (resource.id !== input.resource.id || resource.libraryId !== input.resource.libraryId || resource.itemId !== input.resource.itemId) throw new Error('Cloud source account or connection scope changed.');
  const file = cloudResourceFile(resource);
  if (file.size > bound(input.maxBytes, 32_000_000, 128_000_000)) throw new Error('Cloud source exceeds extraction byte budget.');
  const source = await openCloudAgentDocumentSourceFromResource({ ...input, resource, file, providerScope });
  const snapshot: CloudAgentSourceSnapshot = { workspaceKey: cloudAgentWorkspaceKey(resource), sourceId: resource.id,
    permissionScope: `role:${resource.role}`, providerScope, path: resource.id, version: source.version,
    totalUnits: source.totalUnits, unitLabel: source.unitLabel, kind: source.kind, cloudIdentity: source.cloudIdentity! };
  return { sources: [source], snapshots: [snapshot] };
}

/** Open a cloud source already read by its authorized handle; avoid downloading its bytes a second time. */
export async function openCloudAgentDocumentSourceFromResource(input: {
  provider: CloudLibrarySourceProvider; resource: CloudLibraryResource; file: File; fileName?: string; signal?: AbortSignal;
  isCurrent?: () => boolean; providerScope?: string;
}): Promise<AgentDocumentSource> {
  const providerScope = input.providerScope ?? input.provider.scope;
  const check = () => { abort(input.signal); if (input.provider.scope !== providerScope || input.isCurrent && !input.isCurrent()) throw new Error('Cloud provider permission scope changed.'); };
  check();
  const resource = input.resource;
  const file = input.file;
  if (!file.size && !resource.content) throw new Error('Cloud source has no readable content.');
  const version = await cloudVersion(resource, file, input.signal);
  const opened = await openAgentDocumentSource(file, input.fileName ?? resource.name, input.signal);
  const cloudIdentity: NonNullable<EvidenceRef['cloudIdentity']> = { resourceId: resource.id, libraryId: resource.libraryId, itemId: resource.itemId,
    versionId: resource.versionId, version, role: resource.role, name: resource.name };
  let closed = false;
  const source: AgentDocumentSource = { path: resource.id, version, kind: opened.kind, unitLabel: opened.unitLabel, totalUnits: opened.totalUnits, cloudIdentity,
    providerScope,
    async readUnit(unit, signal) {
      if (closed) return { text: '', status: 'unreadable', reason: 'source_closed' };
      abort(signal); check();
      // No snapshot or search snippet can bypass a fresh provider access check.
      const fresh = await input.provider.read(resource.libraryId, resource.itemId, signal);
      abort(signal); check();
      if (fresh.id !== resource.id || fresh.role !== resource.role || await cloudVersion(fresh, cloudResourceFile(fresh), signal) !== version) {
        return { text: '', status: 'unreadable', reason: 'cloud_source_permission_or_revision_changed' };
      }
      const result = await opened.readUnit(unit, signal);
      check();
      const fragment = result.locator?.split('#', 2)[1];
      return { ...result, locator: `${resource.id}${fragment ? '#' + fragment : ''}` };
    },
    async close() { if (!closed) { closed = true; await opened.close(); } },
  };
  try { check(); } catch (error) { await source.close(); throw error; }
  return source;
}
export async function captureActiveCloudAgentDocumentSources(options: { signal?: AbortSignal; maxBytes?: number } = {}) {
  const host = getCloudWorkspaceSnapshot();
  if (!host.active || !host.provider || !host.resource) return null;
  return captureCloudAgentDocumentSources({ ...options, provider: host.provider, resource: host.resource,
    isCurrent: () => { const current = getCloudWorkspaceSnapshot(); return current.active && current.provider === host.provider && current.resource?.id === host.resource?.id; } });
}
export async function captureSelectedCloudAgentDocumentSources(input: {
  provider: CloudLibrarySourceProvider; selections: readonly CloudAgentSourceSelection[]; signal?: AbortSignal;
  maxFiles?: number; maxTotalBytes?: number; maxFolders?: number; maxEntries?: number; concurrency?: number; isCurrent?: () => boolean;
}): Promise<{ sources: AgentDocumentSource[]; snapshots: CloudAgentSourceSnapshot[] }> {
  const providerScope = input.provider.scope, hostBound = getCloudWorkspaceSnapshot().provider === input.provider;
  const isCurrent = input.isCurrent ?? (() => !hostBound || getCloudWorkspaceSnapshot().provider === input.provider && getCloudWorkspaceSnapshot().active);
  const check = () => { abort(input.signal); if (!isCurrent() || input.provider.scope !== providerScope) throw new Error('Cloud provider permission scope changed.'); };
  const maxFiles = bound(input.maxFiles, 100, 500), maxFolders = bound(input.maxFolders, 1000, 4096), maxEntries = bound(input.maxEntries, 5000, 20_000);
  const maxBytes = bound(input.maxTotalBytes, 32_000_000, 128_000_000);
  const selected: Array<{ libraryId: string; itemId: string }> = [], seen = new Set<string>();
  const visitedFolders = new Set<string>();
  let listedEntries = 0;
  const add = (libraryId: string, itemId: string) => {
    const key = JSON.stringify([libraryId, itemId]);
    if (!seen.has(key)) { seen.add(key); selected.push({ libraryId, itemId }); }
    if (selected.length > maxFiles) throw new Error(`选定云目录超过 ${maxFiles} 文件读取预算，请分页检索并选择相关文件。`);
  };
  async function walk(libraryId: string, itemId: string) {
    check(); const key = JSON.stringify([libraryId, itemId]);
    if (visitedFolders.has(key)) return;
    if (visitedFolders.size >= maxFolders) throw new Error(`选定云目录超过 ${maxFolders} 目录发现预算，请分页检索后缩小选择范围。`);
    visitedFolders.add(key);
    const items: Item[] = await input.provider.list(libraryId, itemId, input.signal);
    check();
    for (const item of items) {
      if (++listedEntries > maxEntries) throw new Error(`选定云目录超过 ${maxEntries} 条目发现预算，请分页检索后缩小选择范围。`);
      if (item.libraryId !== libraryId || item.status !== 'active') continue;
      if (item.kind === 'folder') await walk(libraryId, item.id);
      else if (isAgentDocumentPath(item.canonicalName) || ['pdf', 'markdown', 'notebook', 'docx', 'pptx'].includes(item.kind)) add(libraryId, item.id);
    }
  }
  check();
  for (const selection of input.selections) {
    if (selection.kind === 'folder') await walk(selection.libraryId, selection.itemId);
    else add(selection.libraryId, selection.itemId);
  }
  const sources: AgentDocumentSource[] = [], snapshots: CloudAgentSourceSnapshot[] = [];
  let totalBytes = 0;
  const concurrency = bound(input.concurrency, 3, 4);
  try {
    for (let offset = 0; offset < selected.length; offset += concurrency) {
      check();
      const batch = await Promise.allSettled(selected.slice(offset, offset + concurrency).map(async selection => {
        const resource = await input.provider.read(selection.libraryId, selection.itemId, input.signal);
        check();
        const bytes = cloudResourceFile(resource).size; totalBytes += bytes;
        if (totalBytes > maxBytes) throw new Error('选定云文件超过内容提取字节预算，请缩小范围或分页检索。');
        return captureCloudAgentDocumentSources({ provider: input.provider, resource, signal: input.signal, maxBytes: bytes || 1, isCurrent });
      }));
      for (const result of batch) if (result.status === 'fulfilled') { sources.push(...result.value.sources); snapshots.push(...result.value.snapshots); }
      const failure = batch.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    }
    check();
    return { sources, snapshots };
  } catch (error) { await Promise.allSettled(sources.map(source => source.close())); throw error; }
}
export async function validateCloudAgentSourceSnapshots(input: {
  provider: CloudLibrarySourceProvider | null; snapshots: readonly CloudAgentSourceSnapshot[]; signal?: AbortSignal;
}): Promise<{ valid: CloudAgentSourceSnapshot[]; invalid: Array<{ path: string; reason: 'changed' | 'scope' | 'permission' | 'missing' }> }> {
  const valid: CloudAgentSourceSnapshot[] = [], invalid: Array<{ path: string; reason: 'changed' | 'scope' | 'permission' | 'missing' }> = [];
  for (const snapshot of input.snapshots) {
    abort(input.signal);
    if (!input.provider) { invalid.push({ path: snapshot.path, reason: 'permission' }); continue; }
    if (input.provider.scope !== snapshot.providerScope) { invalid.push({ path: snapshot.path, reason: 'scope' }); continue; }
    try {
      const current = await input.provider.read(snapshot.cloudIdentity.libraryId, snapshot.cloudIdentity.itemId, input.signal);
      abort(input.signal);
      if (current.id !== snapshot.cloudIdentity.resourceId) invalid.push({ path: snapshot.path, reason: 'scope' });
      else if (current.role !== snapshot.cloudIdentity.role) invalid.push({ path: snapshot.path, reason: 'permission' });
      else if (await cloudVersion(current, cloudResourceFile(current), input.signal) !== snapshot.version) invalid.push({ path: snapshot.path, reason: 'changed' });
      else valid.push(snapshot);
    } catch (error) { if (input.signal?.aborted) throw error; invalid.push({ path: snapshot.path, reason: error instanceof Error && /missing|not found|不存在/i.test(error.message) ? 'missing' : 'permission' }); }
  }
  return { valid, invalid };
}
