import { describe, expect, it, vi } from 'vitest';
import type { AgentDocumentSource } from '../document-source';
import { getMessageText, type AiMessage } from '../types';
import { runDirectoryResearch, type DirectoryResearchCheckpoint } from '../directory-research';
import { estimateTokens } from '../token-estimator';

function workspace(count: number, size = 4) {
  const files = new Map(Array.from({ length: count }, (_, i) => [`paper-${String(i).padStart(3, '0')}.md`, new File(['data'], `paper-${i}.md`, { lastModified: 10 })]));
  const root = { name: 'synthetic', kind: 'directory', queryPermission: async () => 'granted',
    getFileHandle: vi.fn(async (name: string) => {
      if (!files.has(name)) throw new DOMException('Missing', 'NotFoundError');
      return { kind: 'file', name, getFile: async () => {
        const file = files.get(name)!;
        return Object.assign(file, size === 4 ? {} : { size });
      } };
    }), getDirectoryHandle: async () => { throw new DOMException('Missing', 'NotFoundError'); },
    async *values() { for (const name of files.keys()) yield { name, kind: 'file', getFile: async () => files.get(name)! }; },
  } as unknown as FileSystemDirectoryHandle;
  return { root, files };
}
function syntheticOpen(_file: File, path: string): Promise<AgentDocumentSource> {
  return Promise.resolve({ path, version: `${path}|v1`, kind: 'markdown', unitLabel: 'section', totalUnits: 1,
    readUnit: async () => ({ text: `Finding from ${path}.`, status: 'text' }), close: async () => {} });
}
function generate(messages: AiMessage[]) {
  const body = JSON.parse(getMessageText(messages.at(-1)!.content));
  return Promise.resolve({ text: JSON.stringify(body.units
    ? { summary: `Read ${body.units.map((x: { path: string }) => x.path).join(', ')}.`, findings: [] }
    : { summary: `Combined ${body.nodes.map((x: { summary: string }) => x.summary).join(' / ')}`.slice(0, 1200) }) });
}
const selections = [{ kind: 'folder' as const, path: '.' }];
describe('durable whole-directory research', () => {
  it('analyzes beyond 100 files one source at a time and retains the last file', async () => {
    const { root } = workspace(101);
    const opened: string[] = [];
    let active = 0, peak = 0;
    const result = await runDirectoryResearch({ rootHandle: root, workspaceKey: 'synthetic', selections, task: 'Read every paper', query: 'Read every paper',
      openSource: async (file, path) => { opened.push(path); const source = await syntheticOpen(file, path); active++; peak = Math.max(peak, active); return { ...source, close: async () => { active--; await source.close(); } }; }, generate, maxCalls: 128, onCheckpoint: async () => {} });
    expect(result.complete).toBe(true);
    expect(result.checkpoint.coverage).toHaveLength(101);
    expect(result.checkpoint.coverage.at(-1)?.readUnits).toEqual([1]);
    expect(opened).toContain('paper-100.md');
    expect(result.directory.files.filter(x => x.status === 'complete')).toHaveLength(101);
    expect(result.directory.reductions.length).toBeGreaterThan(0);
    expect(result.context.prompt).toContain('101');
    expect(peak).toBe(1);
    expect(active).toBe(0);
  });

  it('does not apply a cumulative directory byte limit and marks an oversized single file as a gap', async () => {
    const { root } = workspace(3);
    const get = vi.mocked(root.getFileHandle);
    get.mockImplementation(async name => ({ kind: 'file', name, getFile: async () => ({ name, size: name === 'paper-001.md' ? 40_000_000 : 20_000_000, lastModified: 10 }) as File }) as FileSystemFileHandle);
    const openSource = vi.fn(syntheticOpen);
    const result = await runDirectoryResearch({ rootHandle: root, workspaceKey: 'synthetic', selections, task: 'read', query: 'read', openSource, generate, onCheckpoint: async () => {} });
    expect(openSource.mock.calls.map(x => x[1])).toEqual(['paper-000.md', 'paper-002.md']);
    expect(result.directory.files.find(x => x.path === 'paper-001.md')?.status).toBe('failed');
    expect(result.complete).toBe(false);
    expect(result.context.truncated).toBe(true);
    expect(result.checkpoint.coverage).toHaveLength(2);
  });

  it('uses one shared request budget and resumes from committed progress without rereading analyzed units', async () => {
    const { root } = workspace(4);
    let checkpoint: DirectoryResearchCheckpoint | undefined;
    const first = await runDirectoryResearch({ rootHandle: root, workspaceKey: 'synthetic', selections, task: 'read', query: 'read', openSource: syntheticOpen,
      generate, maxCalls: 2, onCheckpoint: async state => { checkpoint = state; } });
    expect(first.resumable).toBe(true);
    expect(checkpoint?.files.filter(x => x.status === 'complete')).toHaveLength(2);
    const reads: string[] = [];
    const next = await runDirectoryResearch({ rootHandle: root, workspaceKey: 'synthetic', selections, task: 'read', query: 'read', checkpoint,
      openSource: async (file, path) => { const source = await syntheticOpen(file, path); return { ...source, readUnit: async unit => { reads.push(path); return source.readUnit(unit); } }; },
      generate, maxCalls: 5, onCheckpoint: async () => {} });
    expect(next.complete).toBe(true);
    expect(reads).toEqual(['paper-002.md', 'paper-003.md']);
  });

  it('does not open the next file after a checkpoint failure or revoked scope', async () => {
    const { root } = workspace(3);
    const openSource = vi.fn(syntheticOpen);
    await expect(runDirectoryResearch({ rootHandle: root, workspaceKey: 'synthetic', selections, task: 'read', query: 'read', openSource, generate,
      onCheckpoint: async state => { if (state.files.some(x => x.checkpoint?.completedBatches)) throw new Error('Storage full'); } })).rejects.toThrow('Storage full');
    expect(openSource).toHaveBeenCalledTimes(1);
    openSource.mockClear();
    let current = true;
    await expect(runDirectoryResearch({ rootHandle: root, workspaceKey: 'synthetic', selections, task: 'read', query: 'read', openSource, generate,
      isCurrent: () => current, onCheckpoint: async state => { if (state.files.some(x => x.checkpoint?.completedBatches)) current = false; } })).rejects.toThrow(/scope|授权|工作区/i);
    expect(openSource).toHaveBeenCalledTimes(1);
  });

  it('continues beyond a file with unreadable units and reports its gap', async () => {
    const { root } = workspace(2);
    const result = await runDirectoryResearch({ rootHandle: root, workspaceKey: 'synthetic', selections, task: 'read', query: 'read',
      openSource: async (file, path) => { const source = await syntheticOpen(file, path); return path === 'paper-000.md'
        ? { ...source, readUnit: async () => ({ text: '', status: 'unreadable', reason: 'parse_failed' }) } : source; },
      generate, onCheckpoint: async () => {} });
    expect(result.directory.files.map(x => x.status)).toEqual(['failed', 'complete']);
    expect(result.complete).toBe(false);
    expect(result.resumable).toBe(false);
  });

  it('budgets hierarchical reduction messages as well as document batches', async () => {
    const { root } = workspace(12);
    const result = await runDirectoryResearch({ rootHandle: root, workspaceKey: 'synthetic', selections, task: 'read', query: 'read', openSource: syntheticOpen,
      maxInputTokens: 3600, onCheckpoint: async () => {}, generate: async messages => {
        expect(estimateTokens(messages.map(message => getMessageText(message.content)).join('\n'))).toBeLessThanOrEqual(3600);
        const input = JSON.parse(getMessageText(messages.at(-1)!.content));
        return { text: JSON.stringify(input.units ? { summary: '中文观测摘要'.repeat(210), findings: [] } : { summary: '合成摘要'.repeat(50) }) };
      } });
    expect(result.complete).toBe(true);
  });

  it('rejects corrupted reduction dependencies rather than claiming invented batch coverage', async () => {
    const { root } = workspace(10);
    const first = await runDirectoryResearch({ rootHandle: root, workspaceKey: 'synthetic', selections, task: 'read', query: 'read', openSource: syntheticOpen, generate, onCheckpoint: async () => {} });
    const checkpoint = structuredClone(first.directory);
    checkpoint.reductions[0].children = ['unrelated'];
    checkpoint.reductions[0].batches = 999;
    checkpoint.reductions[0].firstPath = 'outside-secret.md';
    await expect(runDirectoryResearch({ rootHandle: root, workspaceKey: 'synthetic', selections, task: 'read', query: 'read', openSource: syntheticOpen, generate, checkpoint, onCheckpoint: async () => {} })).rejects.toThrow(/checkpoint|cache/i);
  });

  it('invalidates same-metadata changed bytes and discovers additions/removals after reopening', async () => {
    const { root, files } = workspace(2);
    const openSource = async (file: File, path: string) => { const source = await syntheticOpen(file, path); return { ...source, version: path + '|' + await file.text() }; };
    const first = await runDirectoryResearch({ rootHandle: root, workspaceKey: 'synthetic', selections, task: 'read', query: 'read', openSource, generate, onCheckpoint: async () => {} });
    files.set('paper-000.md', new File(['edit'], 'paper-000.md', { lastModified: 10 }));
    files.delete('paper-001.md'); files.set('paper-002.md', new File(['more'], 'paper-002.md', { lastModified: 10 }));
    const analyzed: string[] = [];
    const next = await runDirectoryResearch({ rootHandle: root, workspaceKey: 'synthetic', selections, task: 'read', query: 'read', checkpoint: first.directory,
      openSource, generate: async messages => { const body = JSON.parse(getMessageText(messages.at(-1)!.content)); if (body.units) analyzed.push(...body.units.map((x: { path: string }) => x.path)); return generate(messages); }, onCheckpoint: async () => {} });
    expect(next.complete).toBe(true);
    expect(analyzed).toEqual(['paper-000.md', 'paper-002.md']);
    expect(next.directory.removedPaths).toEqual(['paper-001.md']);
    expect(next.checkpoint.sources.map(x => x.path)).toEqual(['paper-000.md', 'paper-002.md']);
  });

  it('stops on non-DOM permission failures rather than silently reading the next file', async () => {
    const { root } = workspace(3);
    const openSource = vi.fn(async (_file: File, _path: string): Promise<AgentDocumentSource> => { throw new Error('File permission denied'); });
    await expect(runDirectoryResearch({ rootHandle: root, workspaceKey: 'synthetic', selections, task: 'read', query: 'read', openSource, generate, onCheckpoint: async () => {} })).rejects.toThrow(/permission/i);
    expect(openSource).toHaveBeenCalledTimes(1);
  });

  it('retains long-page offsets across the whole-directory request budget', async () => {
    const { root } = workspace(1);
    const text = 'Long source sentence with its measured coefficient. '.repeat(800);
    const make = async (file: File, path: string) => ({ ...await syntheticOpen(file, path), readUnit: async () => ({ text, status: 'text' as const }) });
    let firstOffset = 0;
    const first = await runDirectoryResearch({ rootHandle: root, workspaceKey: 'synthetic', selections, task: 'read', query: 'read', openSource: make, generate,
      maxInputTokens: 1500, maxCalls: 1, onCheckpoint: async () => {} });
    firstOffset = first.directory.files[0].checkpoint!.sources[0].offsets['1'];
    expect(firstOffset).toBeGreaterThan(0);
    const resumed = await runDirectoryResearch({ rootHandle: root, workspaceKey: 'synthetic', selections, task: 'read', query: 'read', openSource: make, checkpoint: first.directory,
      maxInputTokens: 1500, maxCalls: 128, onCheckpoint: async () => {}, generate: async messages => {
        const input = JSON.parse(getMessageText(messages.at(-1)!.content));
        if (input.units && firstOffset) { expect(input.units[0].from).toBe(firstOffset); firstOffset = 0; }
        return generate(messages);
      } });
    expect(resumed.complete).toBe(true);
    expect(resumed.checkpoint.coverage[0].readUnits).toEqual([1]);
  });

  it('makes fair progress beyond a costly completed prefix across time-budget resumes', async () => {
    const { root } = workspace(6);
    let now = 0, checkpoint: DirectoryResearchCheckpoint | undefined;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const analyzed: string[] = [];
    try {
      for (let turn = 0; turn < 6; turn++) {
        await runDirectoryResearch({ rootHandle: root, workspaceKey: 'synthetic', selections, task: 'read', query: 'read', checkpoint,
          maxDurationMs: 5, openSource: async (file, path) => { now += 2; return syntheticOpen(file, path); },
          generate: async messages => { const body = JSON.parse(getMessageText(messages.at(-1)!.content)); if (body.units) analyzed.push(body.units[0].path); return generate(messages); },
          onCheckpoint: async state => { checkpoint = state; } }).catch(error => { expect(String(error)).toMatch(/time budget/i); });
        if (checkpoint?.phase === 'ready') break;
      }
      expect(new Set(analyzed).size).toBe(6);
      expect(checkpoint?.files.every(file => file.status === 'complete')).toBe(true);
    } finally { clock.mockRestore(); }
  });

  it('keeps unsupported discovered files visible as gaps instead of declaring the entire selection analyzed', async () => {
    const root = new (await import('./fixtures/source-workspace')).SourceTestDirectory('synthetic');
    const { SourceTestFile } = await import('./fixtures/source-workspace');
    root.add(new SourceTestFile('paper.md', 'Synthetic document.'));
    const unsupported = root.add(new SourceTestFile('raw.custom', 'Unsupported synthetic bytes.'));
    const result = await runDirectoryResearch({ rootHandle: root.handle(), workspaceKey: 'synthetic', selections, task: 'Read all files', query: 'Read all files', openSource: syntheticOpen, generate, onCheckpoint: async () => {} });
    expect(result.directory.files.find(file => file.path === 'raw.custom')?.status).toBe('failed');
    expect(result.complete).toBe(false);
    expect(result.context.prompt).toContain('raw.custom');
    expect(result.context.truncated).toBe(true);
    // Metadata discovery reads are permitted; no content extractor is invoked for raw.custom.
    expect(unsupported.reads).toBeGreaterThan(0);
  });

  it('resumes the normalized checkpoint objective after a task with trailing whitespace', async () => {
    const { root } = workspace(2);
    const first = await runDirectoryResearch({ rootHandle: root, workspaceKey: 'synthetic', selections, task: ' read all papers \n', query: ' read all papers \n',
      maxCalls: 1, openSource: syntheticOpen, generate, onCheckpoint: async () => {} });
    const [task, query] = JSON.parse(first.checkpoint.queryKey);
    const result = await runDirectoryResearch({ rootHandle: root, workspaceKey: 'synthetic', selections, task, query, checkpoint: first.directory,
      openSource: syntheticOpen, generate, onCheckpoint: async () => {} });
    expect(result.complete).toBe(true);
  });

  it('retains a bounded evidence failure as a file gap and continues valid neighboring files', async () => {
    const { root } = workspace(2);
    const result = await runDirectoryResearch({ rootHandle: root, workspaceKey: 'synthetic', selections, task: 'read', query: 'read', openSource: syntheticOpen,
      generate: async messages => {
        const body = JSON.parse(getMessageText(messages.at(-1)!.content));
        return body.units?.[0].path === 'paper-000.md' ? { text: 'invalid batch JSON' } : generate(messages);
      }, onCheckpoint: async () => {} });
    expect(result.directory.files.map(file => file.status)).toEqual(['failed', 'complete']);
    expect(result.directory.files[0].checkpoint?.coverage[0].readUnits).toEqual([]);
    expect(result.directory.files[1].checkpoint?.coverage[0].readUnits).toEqual([1]);
    expect(result.complete).toBe(false);
    expect(result.context.truncated).toBe(true);
    expect(result.directory.calls).toBe(3);
  });
});
