import { describe, expect, it, vi } from 'vitest';
import type { CloudLibraryResource, CloudLibrarySourceProvider } from '@/lib/shared-library/source-provider';
import type { Item } from '@/lib/shared-library/domain';
import { createCloudDirectoryResearchAdapter } from '../cloud-directory-source';
import { runDirectoryResearch, type DirectoryResearchCheckpoint } from '../directory-research';
import type { ResearchAgentPlannerGenerate } from '../research-agent-llm-planner';
import { getMessageText } from '../types';
import { SharedLibraryError } from '@/lib/shared-library/errors';
import { discoverDirectoryManifest } from '../directory-manifest';

const libraryId = 'synthetic-library';
const rootId = 'synthetic-folder-root';
const paperCount = 101;

function makeCloudProvider() {
  const items: Item[] = [{ id: rootId, libraryId, kind: 'folder', canonicalName: 'Shared research', title: 'Shared research', status: 'active', metadata: {}, createdBy: 'synthetic-actor', createdAt: '2026-10-22T00:00:00.000Z', updatedAt: '2026-10-22T00:00:00.000Z' } as Item];
  const content = new Map<string, string>();
  for (let index = 0; index < paperCount; index += 1) {
    const id = `synthetic-paper-${String(index).padStart(3, '0')}`;
    items.push({ id, libraryId, kind: 'markdown', canonicalName: `paper-${String(index).padStart(3, '0')}.md`, title: `Paper ${index}`, status: 'active', metadata: { parentItemId: rootId, sizeBytes: 128 }, currentVersionId: `version-${index}`, contentHash: `hash-${index}`, createdBy: 'synthetic-actor', createdAt: '2026-10-22T00:00:00.000Z', updatedAt: '2026-10-22T00:00:00.000Z' } as Item);
    content.set(id, `CLOUD_PAPER_${String(index).padStart(3, '0')} contains a synthetic measured coefficient of ${index + 10}.`);
  }
  let providerScope = 'synthetic-account:viewer';
  let readCount = 0;
  const provider: CloudLibrarySourceProvider = {
    get scope() { return providerScope; },
    async list(requestedLibraryId, parentItemId, signal) {
      signal?.throwIfAborted();
      if (requestedLibraryId !== libraryId) throw new Error('wrong synthetic library');
      return items.filter(item => item.libraryId === libraryId && item.status === 'active' && item.metadata.parentItemId === parentItemId);
    },
    async read(requestedLibraryId, itemId, signal) {
      signal?.throwIfAborted(); readCount += 1;
      const item = items.find(candidate => candidate.libraryId === requestedLibraryId && candidate.id === itemId && candidate.status === 'active');
      if (!item) throw new Error('Cloud resource missing.');
      const text = content.get(itemId);
      const resource: CloudLibraryResource = { id: `lattice-cloud:synthetic:${libraryId}:${item.id}`, libraryId, itemId,
        versionId: item.currentVersionId, name: item.canonicalName, kind: item.kind, path: `cloud://${item.id}`, role: 'viewer',
        content: text === undefined ? null : { kind: 'text', mimeType: 'text/markdown', text, updatedAt: item.updatedAt } };
      return resource;
    },
    async search() { return { results: [] }; },
    async save() { throw new Error('read-only synthetic provider'); },
  };
  return { provider, items, content, get readCount() { return readCount; }, changeScope: () => { providerScope += ':rotated'; } };
}

function deterministicGenerate(): ResearchAgentPlannerGenerate {
  return async messages => {
    const system = getMessageText(messages[0]?.content ?? '');
    if (system.includes('Read the supplied document fragments')) {
      const payload = JSON.parse(getMessageText(messages.at(-1)?.content ?? '{}')) as { units?: Array<{ passages?: Array<{ text?: string }> }> };
      const source = payload.units?.flatMap(unit => unit.passages ?? []).map(passage => passage.text ?? '').join('\n') ?? '';
      expect(source).toMatch(/CLOUD_PAPER_\d{3}/u);
      return { text: JSON.stringify({ summary: 'Read the selected synthetic cloud paper.', findings: [] }), finishReason: 'stop' };
    }
    if (system.includes('Summarize ALL supplied research notes')) return { text: JSON.stringify({ summary: 'All supplied child notes are represented in this synthetic cloud summary.' }), finishReason: 'stop' };
    throw new Error('Unexpected synthetic cloud research request.');
  };
}

describe('resumable cloud directory research', () => {
  it('does not read content while discovering names and never retains stale bytes after a later source edit', async () => {
    const fixture = makeCloudProvider();
    const adapter = await createCloudDirectoryResearchAdapter({ provider: fixture.provider, selections: [{ libraryId, itemId: rootId, kind: 'folder' }], isCurrent: () => true });
    const folder = await adapter.rootHandle.getDirectoryHandle('Shared research');
    const names = []; for await (const entry of folder.values()) names.push(entry.name);
    expect(names).toHaveLength(paperCount);
    expect(fixture.readCount).toBe(1);
    const handle = await folder.getFileHandle('paper-000.md');
    const before = await handle.getFile();
    fixture.content.set('synthetic-paper-000', 'CLOUD_PAPER_000 changed after the first read.');
    fixture.items.find(item => item.id === 'synthetic-paper-000')!.currentVersionId = 'changed-revision';
    const after = await handle.getFile();
    expect(await after.text()).not.toBe(await before.text());
    const opened = await adapter.openSource(after, 'Shared research/paper-000.md');
    try {
      expect(opened.cloudIdentity?.versionId).toBe('changed-revision');
      expect((await opened.readUnit(1)).text).toContain('changed after');
    } finally { await opened.close(); }
  });

  it('retains cloud version metadata in the durable manifest without reading file bodies', async () => {
    const fixture = makeCloudProvider();
    const adapter = await createCloudDirectoryResearchAdapter({ provider: fixture.provider, selections: [{ libraryId, itemId: rootId, kind: 'folder' }] });
    const manifest = await discoverDirectoryManifest({ ...adapter, onCheckpoint: async () => {} });
    expect(manifest.complete).toBe(true);
    expect(manifest.files).toHaveLength(paperCount);
    expect(manifest.files[0].sourceRevision).toContain('version-0');
    expect(manifest.files[0].sourceRevision).toContain('hash-0');
    expect(fixture.readCount).toBe(1);
  });

  it('stops a revoked cloud access immediately instead of treating authorization loss as one bad file', async () => {
    const fixture = makeCloudProvider();
    const read = fixture.provider.read;
    fixture.provider.read = async (lib, item, signal) => {
      if (item !== rootId) throw new SharedLibraryError({ code: 'FORBIDDEN', status: 403, message: '成员资格已撤销' });
      return read(lib, item, signal);
    };
    const adapter = await createCloudDirectoryResearchAdapter({ provider: fixture.provider, selections: [{ libraryId, itemId: rootId, kind: 'folder' }], isCurrent: () => true });
    let calls = 0;
    await expect(runDirectoryResearch({ ...adapter, task: 'Read cloud papers.', query: 'Summarize the papers.', generate: async (messages, options) => { calls++; return deterministicGenerate()(messages, options); },
      onCheckpoint: async () => {} })).rejects.toThrow(/撤销|权限|授权/u);
    expect(calls).toBe(0);
  });

  it('does not reuse old source findings after the cloud version changes with unchanged file metadata', async () => {
    const fixture = makeCloudProvider();
    fixture.items.splice(2);
    const selection = { libraryId, itemId: rootId, kind: 'folder' as const };
    const firstAdapter = await createCloudDirectoryResearchAdapter({ provider: fixture.provider, selections: [selection], isCurrent: () => true });
    const first = await runDirectoryResearch({ ...firstAdapter, task: 'read', query: 'explain', generate: deterministicGenerate(), onCheckpoint: async () => {} });
    const oldVersion = first.directory.files[0].snapshot!.version;
    fixture.content.set('synthetic-paper-000', 'CLOUD_PAPER_000 now reports coefficient 999.');
    fixture.items[1].currentVersionId = 'version-changed';
    const adapter = await createCloudDirectoryResearchAdapter({ provider: fixture.provider, selections: [selection], checkpoint: first.directory.cloud, isCurrent: () => true });
    let sawNewContent = false;
    const result = await runDirectoryResearch({ ...adapter, checkpoint: first.directory, task: 'read', query: 'explain', generate: async (messages, options) => {
      sawNewContent ||= messages.some(message => getMessageText(message.content).includes('coefficient 999'));
      return deterministicGenerate()(messages, options);
    }, onCheckpoint: async () => {} });
    expect(result.complete).toBe(true);
    expect(result.directory.files[0].snapshot!.version).not.toBe(oldVersion);
    expect(result.directory.files[0].snapshot!.cloudIdentity?.versionId).toBe('version-changed');
    expect(sawNewContent).toBe(true);
  });

  it('requeues an earlier completed cloud file when its revision changes between paused turns with unchanged date and size', async () => {
    const fixture = makeCloudProvider();
    fixture.items.splice(4);
    const selection = { libraryId, itemId: rootId, kind: 'folder' as const };
    const initialAdapter = await createCloudDirectoryResearchAdapter({ provider: fixture.provider, selections: [selection], isCurrent: () => true });
    const first = await runDirectoryResearch({ ...initialAdapter, task: 'read', query: 'explain', generate: deterministicGenerate(), maxCalls: 1, onCheckpoint: async () => {} });
    expect(first.resumable).toBe(true);
    expect(first.directory.files[0].status).toBe('complete');
    fixture.items[1].currentVersionId = 'new-v2';
    fixture.items[1].contentHash = 'new-hash-2';
    fixture.content.set('synthetic-paper-000', 'CLOUD_PAPER_000 changed during the pause, new coefficient 888.');
    const adapter = await createCloudDirectoryResearchAdapter({ provider: fixture.provider, checkpoint: first.directory.cloud, isCurrent: () => true });
    let sawNew = false;
    const next = await runDirectoryResearch({ ...adapter, checkpoint: first.directory, task: 'read', query: 'explain', maxCalls: 10,
      generate: async (messages, options) => { sawNew ||= messages.some(message => getMessageText(message.content).includes('coefficient 888')); return deterministicGenerate()(messages, options); },
      onCheckpoint: async () => {} });
    expect(next.complete).toBe(true);
    expect(sawNew).toBe(true);
    expect(next.directory.files.find(file => file.snapshot?.cloudIdentity?.itemId === 'synthetic-paper-000')?.snapshot?.cloudIdentity?.versionId).toBe('new-v2');
  });

  it.each(['version', 'hash'] as const)('invalidates a paused completed source when only its listed %s changes', async changedField => {
    const fixture = makeCloudProvider(); fixture.items.splice(4);
    const firstAdapter = await createCloudDirectoryResearchAdapter({ provider: fixture.provider, selections: [{ libraryId, itemId: rootId, kind: 'folder' }] });
    const first = await runDirectoryResearch({ ...firstAdapter, task: 'read', query: 'explain', generate: deterministicGenerate(), maxCalls: 1, onCheckpoint: async () => {} });
    if (changedField === 'version') fixture.items[1].currentVersionId = 'replacement-revision';
    else fixture.items[1].contentHash = 'replacement-hash';
    fixture.content.set('synthetic-paper-000', 'CLOUD_PAPER_000 new coefficient 777.');
    const adapter = await createCloudDirectoryResearchAdapter({ provider: fixture.provider, checkpoint: first.directory.cloud });
    let analyzedNew = false;
    const next = await runDirectoryResearch({ ...adapter, checkpoint: first.directory, task: 'read', query: 'explain', maxCalls: 10,
      generate: async (messages, options) => { analyzedNew ||= messages.some(message => getMessageText(message.content).includes('coefficient 777')); return deterministicGenerate()(messages, options); },
      onCheckpoint: async () => {} });
    expect(next.complete).toBe(true); expect(analyzedNew).toBe(true);
    expect(next.directory.files[0].snapshot!.version).not.toBe(first.directory.files[0].snapshot!.version);
    expect(next.directory.files[0].sourceRevision).not.toBe(first.directory.files[0].sourceRevision);
  });

  it('does not restart completed cloud metadata rounds forever when nested discovery consumes the time budget', async () => {
    const fixture = makeCloudProvider(), papers = fixture.items.slice(1, 6);
    fixture.items.splice(1);
    for (let index = 0; index < papers.length; index++) {
      const id = `nested-folder-${index}`;
      fixture.items.push({ ...fixture.items[0], id, canonicalName: `nested-${index}`, metadata: { parentItemId: rootId } });
      papers[index].metadata = { ...papers[index].metadata, parentItemId: id };
      fixture.items.push(papers[index]);
    }
    let now = 0, checkpoint: DirectoryResearchCheckpoint | undefined;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const list = fixture.provider.list;
    fixture.provider.list = async (...args) => { now += 2; return list(...args); };
    let reads = 0, result;
    try {
      for (let turn = 0; turn < 60; turn++) {
        const adapter = await createCloudDirectoryResearchAdapter({ provider: fixture.provider,
          selections: [{ libraryId, itemId: rootId, kind: 'folder' }], ...(checkpoint ? { checkpoint: checkpoint.cloud } : {}) });
        result = await runDirectoryResearch({ ...adapter, task: 'read', query: 'explain', checkpoint, maxCalls: 48, maxDurationMs: 5,
          generate: async (messages, options) => { if (getMessageText(messages[0].content).includes('Read the supplied')) reads++; return deterministicGenerate()(messages, options); },
          onCheckpoint: async value => { checkpoint = structuredClone(value); } }).catch(error => {
          expect(String(error)).toMatch(/budget/iu); return undefined;
        });
        if (result?.complete) break;
      }
      expect(reads).toBe(5);
      expect(result?.complete, JSON.stringify({ phase: checkpoint?.phase, queue: checkpoint?.pendingValidation, files: checkpoint?.files.map(file => file.status) })).toBe(true);
    } finally { clock.mockRestore(); }
  });

  it('rejects a cycle in a malformed cloud folder graph before recursively listing it', async () => {
    const fixture = makeCloudProvider();
    const list = fixture.provider.list;
    fixture.provider.list = async (lib, parent, signal) => parent === rootId
      ? [{ ...fixture.items[0], metadata: { parentItemId: rootId } }] : list(lib, parent, signal);
    const adapter = await createCloudDirectoryResearchAdapter({ provider: fixture.provider, selections: [{ libraryId, itemId: rootId, kind: 'folder' }], isCurrent: () => true });
    const folder = await adapter.rootHandle.getDirectoryHandle('Shared research');
    const entries = async () => { const all = []; for await (const entry of folder.values()) all.push(entry); return all; };
    await expect(entries()).rejects.toThrow(/cycle|循环|目录/u);
  });

  it('retains the cloud item identity when two siblings share the same visible name', async () => {
    const fixture = makeCloudProvider();
    fixture.items.splice(3);
    fixture.items[1].canonicalName = fixture.items[2].canonicalName = 'same.md';
    const adapter = await createCloudDirectoryResearchAdapter({ provider: fixture.provider, selections: [{ libraryId, itemId: rootId, kind: 'folder' }], isCurrent: () => true });
    const result = await runDirectoryResearch({ ...adapter, task: 'read', query: 'explain', generate: deterministicGenerate(), onCheckpoint: async () => {} });
    expect(result.complete).toBe(true);
    expect(new Set(result.directory.files.map(file => file.path)).size).toBe(2);
    expect(new Set(result.directory.files.map(file => file.snapshot!.cloudIdentity!.itemId)).size).toBe(2);
  });

  it('deduplicates identical selected roots instead of presenting duplicate virtual paths', async () => {
    const fixture = makeCloudProvider(); fixture.items.splice(3);
    const selection = { libraryId, itemId: rootId, kind: 'folder' as const };
    const adapter = await createCloudDirectoryResearchAdapter({ provider: fixture.provider, selections: [selection, selection] });
    expect(adapter.selections).toHaveLength(1);
    expect(adapter.cloud.selections).toHaveLength(1);
    const result = await runDirectoryResearch({ ...adapter, task: 'read', query: 'read', generate: deterministicGenerate(), onCheckpoint: async () => {} });
    expect(result.complete).toBe(true); expect(result.directory.files).toHaveLength(2);
  });

  it('rejects overlapping selected folder roots when the same cloud item would be exposed twice', async () => {
    const fixture = makeCloudProvider(); fixture.items.splice(2);
    const childId = 'selected-child-folder';
    fixture.items.push({ ...fixture.items[0], id: childId, canonicalName: 'Child', metadata: { parentItemId: rootId } });
    fixture.items[1].metadata = { parentItemId: childId, sizeBytes: 128 };
    const adapter = await createCloudDirectoryResearchAdapter({ provider: fixture.provider, selections: [
      { libraryId, itemId: rootId, kind: 'folder' }, { libraryId, itemId: childId, kind: 'folder' },
    ] });
    await expect(runDirectoryResearch({ ...adapter, task: 'read', query: 'read', generate: deterministicGenerate(), onCheckpoint: async () => {} }))
      .rejects.toThrow(/overlap|重叠/u);
  });

  it('allocates globally unique aliases when a duplicate-name suffix matches another real filename', async () => {
    const fixture = makeCloudProvider(); fixture.items.splice(4);
    fixture.items[1].canonicalName = fixture.items[2].canonicalName = 'same.md';
    fixture.items[3].canonicalName = 'same--synthetic-paper-000.md';
    const adapter = await createCloudDirectoryResearchAdapter({ provider: fixture.provider, selections: [{ libraryId, itemId: rootId, kind: 'folder' }] });
    const folder = await adapter.rootHandle.getDirectoryHandle('Shared research');
    const names = []; for await (const handle of folder.values()) names.push(handle.name);
    expect(new Set(names).size).toBe(3);
    const result = await runDirectoryResearch({ ...adapter, task: 'read', query: 'read', generate: deterministicGenerate(), onCheckpoint: async () => {} });
    expect(result.complete).toBe(true); expect(result.directory.files).toHaveLength(3);
    expect(new Set(result.directory.files.map(file => file.snapshot?.cloudIdentity?.itemId)).size).toBe(3);
  });

  it('reads 101 cloud files in shared-budget batches and retains the provider and item-version scope across resume', async () => {
    const fixture = makeCloudProvider();
    const selection = { libraryId, itemId: rootId, kind: 'folder' as const };
    let checkpoint: DirectoryResearchCheckpoint | undefined;
    let result;
    let calls = 0;
    for (let turn = 0; turn < 5; turn += 1) {
      const adapter = await createCloudDirectoryResearchAdapter({ provider: fixture.provider, selections: [selection],
        ...(checkpoint ? { checkpoint: checkpoint.cloud } : {}), isCurrent: () => true });
      result = await runDirectoryResearch({ ...adapter, task: 'Read every paper in the shared cloud folder.', query: 'Explain all synthetic measurements.',
        generate: async (messages, options) => { calls += 1; return deterministicGenerate()(messages, options); }, checkpoint, maxCalls: 48, maxDurationMs: 120_000,
        onCheckpoint: async next => { checkpoint = structuredClone(next); } });
      if (!result.resumable) break;
    }

    expect(result).toBeDefined();
    expect(result!.complete, JSON.stringify({ resumable: result!.resumable, phase: result!.directory.phase,
      files: result!.directory.files.length, completeFiles: result!.directory.files.filter(file => file.status === 'complete').length,
      failedFiles: result!.directory.files.filter(file => file.status === 'failed').map(file => file.error),
      discoveryComplete: result!.directory.manifest?.complete, pending: result!.directory.pendingValidation?.length,
      calls: result!.directory.calls, reductions: result!.directory.reductions.length })).toBe(true);
    expect(result!.directory.phase).toBe('ready');
    expect(result!.directory.files).toHaveLength(paperCount);
    expect(result!.directory.files.every(file => file.status === 'complete')).toBe(true);
    expect(result!.directory.cloud).toMatchObject({ providerScope: 'synthetic-account:viewer', selections: [{ libraryId, itemId: rootId, kind: 'folder' }] });
    expect(result!.directory.files.every(file => file.snapshot?.cloudIdentity?.libraryId === libraryId
      && file.snapshot.cloudIdentity.role === 'viewer' && file.snapshot.providerScope === 'synthetic-account:viewer')).toBe(true);
    expect(result!.directory.files.map(file => file.snapshot?.cloudIdentity?.itemId)).toEqual(expect.arrayContaining(Array.from({ length: paperCount }, (_, i) => `synthetic-paper-${String(i).padStart(3, '0')}`)));
    expect(result!.directory.reductions.length).toBeGreaterThan(0);
    expect(calls).toBeGreaterThan(paperCount);
    expect(calls).toBeLessThanOrEqual(48 * 5);
    expect(fixture.readCount).toBeGreaterThanOrEqual(paperCount);
  });

  it('refuses a provider scope change before using a saved cloud folder checkpoint', async () => {
    const fixture = makeCloudProvider();
    const selection = { libraryId, itemId: rootId, kind: 'folder' as const };
    const adapter = await createCloudDirectoryResearchAdapter({ provider: fixture.provider, selections: [selection], isCurrent: () => true });
    const initial = await runDirectoryResearch({ ...adapter, task: 'Read the cloud folder.', query: 'Explain the papers.', generate: deterministicGenerate(), maxCalls: 1,
      onCheckpoint: async () => {} });
    fixture.changeScope();
    await expect(createCloudDirectoryResearchAdapter({ provider: fixture.provider, selections: [selection], checkpoint: initial.directory.cloud, isCurrent: () => true }))
      .rejects.toThrow(/scope|权限|授权/i);
  });
});
