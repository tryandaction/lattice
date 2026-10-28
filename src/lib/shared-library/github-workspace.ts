import type { Item, ItemKind } from './domain';
import type { SharedLibraryItemContent } from './content-store';
import type { CloudWorkspaceSnapshot } from './cloud-workspace';
import type { TransportRequest } from './remote-repository';
import type { GitHubConnection, GitHubFile, GitHubPublishResult } from './github';
import { decodeGitHubFile, encodeGitHubFile } from './github';
import { cloudContentFromBytes, cloudFileKind } from './file-content';

export interface GitHubItemLink { repositoryId: number; path: string; sha: string; branch: string }
export interface GitHubWorkspaceResult { item: Item; synced: boolean }
/** Small controller boundary allows tests without substituting its durable queue. */
export interface GitHubWorkspaceController {
  getSnapshot(): Pick<CloudWorkspaceSnapshot, 'items' | 'outbox'>;
  createItem(input: { libraryId: string; name: string; kind: ItemKind; parentItemId?: string; metadata?: Record<string, unknown> }, content?: SharedLibraryItemContent, expectedParentVersion?: string): Promise<Item>;
  save(libraryId: string, itemId: string, content: SharedLibraryItemContent, expectedVersionId?: string): Promise<string | undefined>;
  updateMetadata(libraryId: string, itemId: string, patch: Record<string, unknown>, expectedVersionId?: string): Promise<unknown>;
  request<T>(input: TransportRequest): Promise<T>;
  readContent(libraryId: string, itemId: string): Promise<SharedLibraryItemContent | null>;
  sync(): Promise<void>;
  refreshLibrary(libraryId: string): Promise<unknown>;
}
export function githubItemLink(item: Pick<Item, 'metadata'>): GitHubItemLink | null {
  const value = item.metadata.github;
  if (!value || typeof value !== 'object') return null;
  const link = value as Partial<GitHubItemLink>;
  if (!Number.isSafeInteger(link.repositoryId) || Number(link.repositoryId) <= 0 || typeof link.path !== 'string' || typeof link.branch !== 'string' || !link.branch || typeof link.sha !== 'string' || !/^[a-f0-9]{40,64}$/.test(link.sha)) return null;
  try { safePath(link.path); } catch { return null; }
  return { repositoryId: link.repositoryId!, path: link.path, sha: link.sha, branch: link.branch };
}
function safePath(path: string): string {
  if (!path || path.startsWith('/') || path.length > 1000 || path.includes(String.fromCharCode(92)) || Array.from(path).some(character => character.charCodeAt(0) < 32) || path.split('/').some(part => !part || part === '.' || part === '..' || part === '.git')) throw new Error('GitHub 文件路径不安全。');
  return path;
}
const basePath = (libraryId: string): string => `/v1/libraries/${encodeURIComponent(libraryId)}/github`;
function currentItem(controller: GitHubWorkspaceController, libraryId: string, itemId: string): Item {
  const item = controller.getSnapshot().items.find(value => value.id === itemId && value.libraryId === libraryId && value.status === 'active');
  if (!item) throw new Error('GitHub 关联文件不存在或已失效。');
  return item;
}
function ready(controller: GitHubWorkspaceController, libraryId: string, itemId: string, expectedVersionId: string): Item {
  const item = currentItem(controller, libraryId, itemId);
  if (controller.getSnapshot().outbox.some(entry => entry.libraryId === libraryId && entry.itemId === itemId)) throw new Error('该文件存在待同步编辑或冲突，请先完成云库同步。');
  if (!expectedVersionId || item.currentVersionId !== expectedVersionId) throw new Error('云库文件版本已变化，请重新打开后操作。');
  return item;
}
async function verifyVersion(controller: GitHubWorkspaceController, libraryId: string, itemId: string, expectedVersionId: string): Promise<Item> {
  ready(controller, libraryId, itemId, expectedVersionId);
  const remote = await controller.request<Item>({ method: 'GET', path: `/v1/items/${encodeURIComponent(itemId)}` });
  if (remote.id !== itemId || remote.libraryId !== libraryId || remote.status !== 'active' || remote.currentVersionId !== expectedVersionId) throw new Error('云端文件版本已变化，请刷新后重试。');
  return ready(controller, libraryId, itemId, expectedVersionId);
}
async function verifyConnection(controller: GitHubWorkspaceController, libraryId: string, repositoryId: number, branch: string): Promise<GitHubConnection> {
  const connection = await controller.request<GitHubConnection | null>({ method: 'GET', path: basePath(libraryId) });
  if (!connection || connection.libraryId !== libraryId || connection.repositoryId !== repositoryId || connection.branch !== branch) throw new Error('GitHub 仓库连接或分支已变化，请重新连接后操作。');
  return connection;
}
async function readSource(controller: GitHubWorkspaceController, libraryId: string, path: string, branch: string, repositoryId: number): Promise<GitHubFile> {
  const file = await controller.request<GitHubFile>({ method: 'GET', path: `${basePath(libraryId)}/file`, query: { path: safePath(path) } });
  if (file.path !== path || file.branch !== branch || file.repositoryId !== undefined && file.repositoryId !== repositoryId || file.encoding !== 'base64' || !/^[a-f0-9]{40,64}$/.test(file.sha)) throw new Error('GitHub 文件来源与请求不一致。');
  return file;
}
function sourceContent(file: GitHubFile): SharedLibraryItemContent {
  const bytes = decodeGitHubFile(file);
  if (bytes.byteLength > 1_000_000) throw new Error('GitHub 单文件导入最多支持 1 MB。');
  return cloudContentFromBytes(file.path, bytes.buffer, 'application/octet-stream', new Date().toISOString());
}
async function settle(controller: GitHubWorkspaceController, libraryId: string, itemId: string): Promise<GitHubWorkspaceResult> {
  await controller.sync();
  const synced = !controller.getSnapshot().outbox.some(entry => entry.libraryId === libraryId && entry.itemId === itemId);
  if (synced) await controller.refreshLibrary(libraryId);
  return { item: structuredClone(currentItem(controller, libraryId, itemId)), synced };
}
/** Import is explicit; same-named manual files are never silently linked/replaced. */
export async function importGitHubFile(controller: GitHubWorkspaceController, libraryId: string, connection: GitHubConnection, path: string): Promise<GitHubWorkspaceResult> {
  safePath(path);
  await controller.refreshLibrary(libraryId);
  await verifyConnection(controller, libraryId, connection.repositoryId, connection.branch);
  const linked = controller.getSnapshot().items.filter(item => { const link = githubItemLink(item); return item.libraryId === libraryId && item.status === 'active' && link?.repositoryId === connection.repositoryId && link.path === path; });
  if (linked.length > 1) throw new Error('发现重复 GitHub 来源关联，请先整理重复条目。');
  if (linked.length) return pullGitHubItem(controller, libraryId, linked[0].id, linked[0].currentVersionId ?? '');
  const file = await readSource(controller, libraryId, path, connection.branch, connection.repositoryId);
  const content = sourceContent(file); const parts = path.split('/'); const name = parts.pop()!; let parentItemId: string | undefined;
  for (const folderName of parts) {
    const folder = controller.getSnapshot().items.find(item => item.libraryId === libraryId && item.status !== 'trashed' && item.canonicalName === folderName && (item.metadata.parentItemId ?? undefined) === parentItemId);
    if (folder && (folder.kind !== 'folder' || folder.status !== 'active')) throw new Error('导入路径与现有手工文件或归档目录冲突。');
    parentItemId = folder?.id ?? (await controller.createItem({ libraryId, name: folderName, kind: 'folder', parentItemId })).id;
  }
  const occupied = controller.getSnapshot().items.some(item => item.libraryId === libraryId && item.status !== 'trashed' && item.canonicalName === name && (item.metadata.parentItemId ?? undefined) === parentItemId);
  if (occupied) throw new Error('目标目录存在同名手工文件，未覆盖；请先改名。');
  const created = await controller.createItem({ libraryId, name, kind: cloudFileKind(name, content.mimeType), parentItemId, metadata: { github: { repositoryId: connection.repositoryId, path, sha: file.sha, branch: file.branch } satisfies GitHubItemLink } }, content);
  return settle(controller, libraryId, created.id);
}
/** Pull guards both local pending work and the current persisted Lattice version. */
export async function pullGitHubItem(controller: GitHubWorkspaceController, libraryId: string, itemId: string, expectedVersionId: string): Promise<GitHubWorkspaceResult> {
  const initial = ready(controller, libraryId, itemId, expectedVersionId); const source = githubItemLink(initial);
  if (!source) throw new Error('此文件没有有效的 GitHub 来源关联。');
  await verifyVersion(controller, libraryId, itemId, expectedVersionId);
  await verifyConnection(controller, libraryId, source.repositoryId, source.branch);
  const file = await readSource(controller, libraryId, source.path, source.branch, source.repositoryId);
  await verifyVersion(controller, libraryId, itemId, expectedVersionId);
  const latest = githubItemLink(currentItem(controller, libraryId, itemId));
  if (JSON.stringify(latest) !== JSON.stringify(source)) throw new Error('文件的 GitHub 来源已变化，请重新打开。');
  const savedVersion = await controller.save(libraryId, itemId, sourceContent(file), expectedVersionId);
  await controller.updateMetadata(libraryId, itemId, { github: { ...source, sha: file.sha } }, savedVersion ?? expectedVersionId);
  return settle(controller, libraryId, itemId);
}
/** Publishes only a fully synced Lattice version against its stored source SHA. */
export async function publishGitHubItem(controller: GitHubWorkspaceController, libraryId: string, itemId: string, expectedVersionId: string, message?: string): Promise<GitHubWorkspaceResult & { sha: string; commitSha: string }> {
  const initial = ready(controller, libraryId, itemId, expectedVersionId); const source = githubItemLink(initial);
  if (!source) throw new Error('发布前必须先导入或拉取文件，建立 GitHub SHA 基线。');
  await verifyVersion(controller, libraryId, itemId, expectedVersionId);
  await verifyConnection(controller, libraryId, source.repositoryId, source.branch);
  const content = await controller.readContent(libraryId, itemId);
  if (!content) throw new Error('云库当前版本没有可发布的文件内容。');
  const bytes = content.kind === 'text' ? new TextEncoder().encode(content.text) : new Uint8Array(content.data);
  if (bytes.byteLength > 1_000_000) throw new Error('GitHub 单文件发布最多支持 1 MB。');
  await verifyVersion(controller, libraryId, itemId, expectedVersionId);
  const latest = githubItemLink(currentItem(controller, libraryId, itemId));
  if (JSON.stringify(latest) !== JSON.stringify(source)) throw new Error('文件的 GitHub SHA 基线已变化，请重新打开。');
  // Never query GitHub for a fresh SHA here: doing so would mask remote edits.
  const published = await controller.request<GitHubPublishResult>({ method: 'PUT', path: `${basePath(libraryId)}/file`, body: { path: source.path, content: encodeGitHubFile(bytes), expectedSha: source.sha, expectedRepositoryId: source.repositoryId, expectedBranch: source.branch, ...(message ? { message } : {}) } });
  if (published.path !== source.path || published.branch !== source.branch || published.repositoryId !== undefined && published.repositoryId !== source.repositoryId || !/^[a-f0-9]{40,64}$/.test(published.sha)) throw new Error('GitHub 返回的发布确认与源文件不一致。');
  await controller.updateMetadata(libraryId, itemId, { github: { ...source, sha: published.sha } }, expectedVersionId);
  return { ...await settle(controller, libraryId, itemId), sha: published.sha, commitSha: published.commitSha };
}
