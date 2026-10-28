// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { githubItemLink, importGitHubFile, pullGitHubItem, publishGitHubItem, type GitHubWorkspaceController } from '../github-workspace';
import type { Item } from '../domain';
import type { TransportRequest } from '../remote-repository';
import type { GitHubConnection } from '../github';

const sourceSha = 'a'.repeat(40), pulledSha = 'b'.repeat(40), publishedSha = 'c'.repeat(40);
const connection: GitHubConnection = { id: 'connection', libraryId: 'library', repositoryId: 88, installationId: 77, owner: 'research', name: 'notes', fullName: 'research/notes', branch: 'main', private: true, connectedAt: '', lastSyncedAt: '', stale: false };
function item(name = 'notes.md', linked = true): Item {
  return { id: 'item', libraryId: 'library', kind: 'markdown', title: name, canonicalName: name, currentVersionId: 'version-1', metadata: linked ? { github: { repositoryId: 88, path: name, sha: sourceSha, branch: 'main' } } : {}, status: 'active', createdBy: 'actor', createdAt: '', updatedAt: '' };
}
function fixture(items: Item[] = [], options: { pending?: boolean; conflict?: boolean; remoteVersion?: string; changeDuringRead?: boolean } = {}) {
  const snapshot = { items, outbox: [] as Array<{ id: string; libraryId: string; itemId: string; kind: 'request'; state: 'pending'; createdAt: string }> };
  const calls: TransportRequest[] = []; let sequence = 0;
  const createItem: GitHubWorkspaceController['createItem'] = vi.fn(async (input, content) => {
    const result: Item = { id: `created-${++sequence}`, libraryId: input.libraryId, title: input.name, canonicalName: input.name, kind: input.kind, metadata: { ...input.metadata, ...(input.parentItemId ? { parentItemId: input.parentItemId } : {}) }, status: 'active', currentVersionId: content ? 'created-version' : undefined, createdBy: 'actor', createdAt: '', updatedAt: '' };
    snapshot.items.push(result); snapshot.outbox.push({ id: `q-${sequence}`, libraryId: 'library', itemId: result.id, kind: 'request', state: 'pending', createdAt: '' }); return result;
  });
  const save: GitHubWorkspaceController['save'] = vi.fn(async (_libraryId, itemId, _content, expectedVersionId) => {
    const target = snapshot.items.find(candidate => candidate.id === itemId)!; if (target.currentVersionId !== expectedVersionId) throw new Error('version changed');
    target.currentVersionId = 'version-2'; snapshot.outbox.push({ id: 'content', libraryId: 'library', itemId, kind: 'request', state: 'pending', createdAt: '' }); return 'version-2';
  });
  const updateMetadata: GitHubWorkspaceController['updateMetadata'] = vi.fn(async (_libraryId, itemId, patch, expectedVersionId) => {
    const target = snapshot.items.find(candidate => candidate.id === itemId)!; if (expectedVersionId && target.currentVersionId !== expectedVersionId) throw new Error('version changed');
    target.metadata = { ...target.metadata, ...patch }; snapshot.outbox.push({ id: 'metadata', libraryId: 'library', itemId, kind: 'request', state: 'pending', createdAt: '' });
  });
  const controller: GitHubWorkspaceController = {
    getSnapshot: () => snapshot, createItem, save, updateMetadata,
    async request<T>(input: TransportRequest): Promise<T> {
      calls.push(input);
      if (input.path.endsWith('/github')) return connection as T;
      if (input.path.startsWith('/v1/items/')) return { ...snapshot.items.find(candidate => candidate.id === input.path.split('/').at(-1)), ...(options.remoteVersion ? { currentVersionId: options.remoteVersion } : {}) } as T;
      if (input.path.endsWith('/github/file') && input.method === 'GET') {
        if (options.changeDuringRead) snapshot.items[0].currentVersionId = 'concurrent-version';
        return { path: input.query!.path, sha: pulledSha, content: Buffer.from('# remote content').toString('base64'), encoding: 'base64', size: 16, branch: 'main' } as T;
      }
      if (input.path.endsWith('/github/file') && input.method === 'PUT') { if (options.conflict) throw new Error('GitHub SHA conflict'); return { path: 'notes.md', sha: publishedSha, commitSha: 'commit', branch: 'main' } as T; }
      throw new Error(`Unexpected ${input.method} ${input.path}`);
    },
    readContent: vi.fn(async () => ({ kind: 'text' as const, text: '# local content', mimeType: 'text/markdown', updatedAt: '' })),
    sync: vi.fn(async () => { if (!options.pending) snapshot.outbox = []; }), refreshLibrary: vi.fn(async () => undefined),
  };
  return { controller, snapshot, calls, createItem, save, updateMetadata };
}
describe('GitHub cloud workspace file workflow', () => {
  it('imports nested files through durable folder creation and records the exact repository source SHA', async () => {
    const f = fixture(); const result = await importGitHubFile(f.controller, 'library', connection, 'papers/2026/notes.md');
    expect(result.synced).toBe(true); expect(f.snapshot.items.map(value => value.canonicalName)).toEqual(['papers', '2026', 'notes.md']);
    expect(f.snapshot.items[1].metadata.parentItemId).toBe(f.snapshot.items[0].id);
    expect(githubItemLink(result.item)).toEqual({ repositoryId: 88, path: 'papers/2026/notes.md', sha: pulledSha, branch: 'main' });
  });
  it('refuses a same-name manual file instead of overwriting or attaching it to GitHub', async () => {
    const f = fixture([item('notes.md', false)]);
    await expect(importGitHubFile(f.controller, 'library', connection, 'notes.md')).rejects.toThrow(); expect(f.createItem).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
  });
  it('reports pending import persistence without claiming that cloud synchronization completed', async () => {
    const f = fixture([], { pending: true }); expect((await importGitHubFile(f.controller, 'library', connection, 'notes.md')).synced).toBe(false); expect(f.snapshot.outbox).not.toHaveLength(0);
  });
  it('rejects target local outbox edits before pulling', async () => {
    const f = fixture([item()]); f.snapshot.outbox.push({ id: 'pending', libraryId: 'library', itemId: 'item', kind: 'request', state: 'pending', createdAt: '' });
    await expect(pullGitHubItem(f.controller, 'library', 'item', 'version-1')).rejects.toThrow(); expect(f.save).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0);
  });
  it('rejects a changed cloud version before modifying local content', async () => {
    const f = fixture([item()], { remoteVersion: 'remote-version' });
    await expect(pullGitHubItem(f.controller, 'library', 'item', 'version-1')).rejects.toThrow(); expect(f.save).not.toHaveBeenCalled();
  });
  it('rejects local version changes while GitHub content is being fetched', async () => {
    const f = fixture([item()], { changeDuringRead: true });
    await expect(pullGitHubItem(f.controller, 'library', 'item', 'version-1')).rejects.toThrow(); expect(f.save).not.toHaveBeenCalled();
  });
  it('pulls into the existing linked item with expected Lattice version and updates the source baseline durably', async () => {
    const f = fixture([item()]); const result = await pullGitHubItem(f.controller, 'library', 'item', 'version-1');
    expect(result.item.id).toBe('item'); expect(result.synced).toBe(true); expect(f.save).toHaveBeenCalledWith('library', 'item', expect.objectContaining({ kind: 'text', text: '# remote content' }), 'version-1');
    expect(githubItemLink(result.item)?.sha).toBe(pulledSha);
  });
  it('publishes the stored source SHA without fetching a newer GitHub baseline', async () => {
    const f = fixture([item()]); const result = await publishGitHubItem(f.controller, 'library', 'item', 'version-1');
    expect(result.sha).toBe(publishedSha); expect(result.synced).toBe(true);
    const publish = f.calls.find(input => input.method === 'PUT')!; expect(publish.body).toMatchObject({ expectedSha: sourceSha });
    expect(f.calls.some(input => input.method === 'GET' && input.path.endsWith('/github/file'))).toBe(false); expect(githubItemLink(result.item)?.sha).toBe(publishedSha);
  });
  it('retains the old source baseline when GitHub refuses publication', async () => {
    const f = fixture([item()], { conflict: true }); await expect(publishGitHubItem(f.controller, 'library', 'item', 'version-1')).rejects.toThrow('GitHub SHA conflict');
    expect(githubItemLink(f.snapshot.items[0])?.sha).toBe(sourceSha); expect(f.updateMetadata).not.toHaveBeenCalled();
  });
  it('refuses to publish local edits that have not synchronized to Lattice', async () => {
    const f = fixture([item()]); f.snapshot.outbox.push({ id: 'pending', libraryId: 'library', itemId: 'item', kind: 'request', state: 'pending', createdAt: '' });
    await expect(publishGitHubItem(f.controller, 'library', 'item', 'version-1')).rejects.toThrow(); expect(f.calls).toHaveLength(0);
  });
});
