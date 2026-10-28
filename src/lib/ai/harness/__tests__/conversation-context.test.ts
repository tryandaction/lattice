import { describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { cloudHarnessWorkspaceSpec, prepareHarnessConversationContext, harnessAnswerEvent, harnessDocumentCoverage, buildHarnessDocumentContinuationPrompt, runHarnessDocumentReadingLoop } from '../conversation-context';
import type { AgentSourceRead } from '@/lib/ai/source-index';

const read: AgentSourceRead = {
  snapshot: { path: 'paper.md', sourceId: 'paper', workspaceKey: 'work', version: 'v1', kind: 'markdown', totalUnits: 2, unitLabel: 'section' },
  chunks: [{ path: 'paper.md', sourceId: 'paper', version: 'v1', unit: 1, locator: 'paper.md#section=1', text: 'Synthetic paper finding.', startOffset: 0, endOffset: 24, completeUnit: true }],
  complete: false, readUnits: [1], pendingUnits: [2], unreadableUnits: [], scannedChars: 24,
};

describe('harness conversation context', () => {
  it('shares only active scoped preference memories, never treating remembered findings as verified excerpts', async () => {
    const { createAgentMemoryEntry } = await import('@/lib/ai/agent-memory');
    const make = (id: string, patch: Record<string, unknown> = {}) => ({ ...createAgentMemoryEntry({ id, scope: 'workspace', workspaceKey: 'A', title: id, content: id + ' memory preference', source: { label: 'User request' }, candidateKind: 'preference', pinned: true }), ...patch });
    const result = await prepareHarnessConversationContext({ text: '解释结果', history: [], paths: [], execute: vi.fn(), workspaceKey: 'A', conversationId: 'conversation-A',
      memories: [make('KEEP_SCOPED'), make('OTHER_WORKSPACE', { workspaceKey: 'B' }), make('DISABLED', { status: 'disabled' }), make('DELETED', { status: 'deleted' }), make('FINDING', { candidateKind: 'finding' }), make('OTHER_CONVERSATION', { scope: 'conversation', conversationId: 'conversation-B' }), make('UNSCOPED', { workspaceKey: undefined }), make('USER_PREF', { scope: 'user', workspaceKey: undefined })] });
    expect(result.prompt).toContain('KEEP_SCOPED');
    expect(result.prompt).toContain('USER_PREF');
    for (const excluded of ['OTHER_WORKSPACE', 'DISABLED', 'DELETED', 'FINDING', 'OTHER_CONVERSATION', 'UNSCOPED']) expect(result.prompt).not.toContain(excluded);
    expect(result.prompt).toContain('not document evidence');
    expect(result.reads).toEqual([]);
  });

  it('greets without reading an active or previously discussed private document', async () => {
    const execute = vi.fn().mockResolvedValue(read);
    const result = await prepareHarnessConversationContext({ text: 'hi', history: [], paths: ['paper.md'], execute });
    expect(execute).not.toHaveBeenCalled();
    expect(result.reads).toEqual([]);
    expect(result.prompt).not.toContain('Synthetic paper');
    expect(result.prompt).not.toContain('paper.md');
    expect(result.prompt).toContain('hi');
  });
  it('primes source revisions through the actual tool runtime for later PDF child proposals', async () => {
    const execute = vi.fn().mockResolvedValue(read);
    const result = await prepareHarnessConversationContext({ text: '详细讲解本文', history: [{ role: 'user', content: '讨论鲁棒性' }, { role: 'assistant', content: '已讨论第一部分' }], paths: ['paper.md'], execute });
    expect(execute).toHaveBeenCalledWith('lattice.sources.read', { path: 'paper.md', maxChars: 120000, maxUnits: 64 }, undefined);
    expect(result.reads).toEqual([read]);
    expect(result.prompt).toContain('讨论鲁棒性');
    expect(result.prompt).toContain('Synthetic paper finding.');
    expect(result.prompt).toContain('unread sections');
    expect(result.prompt).toContain('Full-document reading is required');
  });
  it('reads the entire explicitly requested PDF instead of priming only six pages', async () => {
    const pages = Array.from({ length: 22 }, (_, index) => index + 1);
    const fullRead: AgentSourceRead = {
      snapshot: { path: 'paper.pdf', sourceId: 'paper', workspaceKey: 'work', version: 'v1', kind: 'pdf', totalUnits: 22, unitLabel: 'page' },
      chunks: pages.map(page => ({ path: 'paper.pdf', sourceId: 'paper', version: 'v1', unit: page, locator: `paper.pdf#page=${page}`,
        text: `FULL_REPORT_PAGE_${page}_METHODS_RESULTS`, startOffset: 0, endOffset: 36, completeUnit: true })),
      complete: true, readUnits: pages, pendingUnits: [], unreadableUnits: [], scannedChars: 22 * 36,
    };
    const execute = vi.fn().mockResolvedValue(fullRead);
    const result = await prepareHarnessConversationContext({ text: '请完整阅读并详细讲解这份报告。', history: [], paths: ['paper.pdf'], execute });
    expect(execute).toHaveBeenCalledWith('lattice.sources.read', { path: 'paper.pdf', maxChars: 120000, maxUnits: 64 }, undefined);
    expect(result.prompt).toContain('FULL_REPORT_PAGE_22_METHODS_RESULTS');
    expect(result.prompt).toContain('read every pending page or section');
  });
  it('merges page reads by source revision and reports unread pages before the harness can claim completion', () => {
    const pages = Array.from({ length: 22 }, (_, index) => index + 1);
    const firstBatch: AgentSourceRead = {
      ...read,
      snapshot: { ...read.snapshot, path: 'paper.pdf', kind: 'pdf', totalUnits: 22, unitLabel: 'page' },
      chunks: pages.slice(0, 6).map(page => ({ path: 'paper.pdf', sourceId: 'paper', version: 'v1', unit: page, locator: `paper.pdf#page=${page}`,
        text: `Synthetic page ${page}.`, startOffset: 0, endOffset: 18, completeUnit: true })),
      complete: false, readUnits: pages.slice(0, 6), pendingUnits: pages.slice(6), unreadableUnits: [], scannedChars: 108,
    };
    const secondBatch: AgentSourceRead = {
      ...firstBatch, chunks: pages.slice(6).map(page => ({ path: 'paper.pdf', sourceId: 'paper', version: 'v1', unit: page, locator: `paper.pdf#page=${page}`,
        text: `Synthetic page ${page}.`, startOffset: 0, endOffset: 18, completeUnit: true })),
      complete: false, readUnits: pages.slice(6), pendingUnits: pages.slice(0, 6), scannedChars: 288,
    };
    expect(harnessDocumentCoverage(['paper.pdf'], [firstBatch])).toEqual([expect.objectContaining({ path: 'paper.pdf', totalUnits: 22,
      readUnits: pages.slice(0, 6), pendingUnits: pages.slice(6), complete: false })]);
    expect(harnessDocumentCoverage(['paper.pdf'], [firstBatch, secondBatch])).toEqual([expect.objectContaining({ path: 'paper.pdf', totalUnits: 22,
      readUnits: pages, pendingUnits: [], complete: true })]);
    const changed = { ...secondBatch, snapshot: { ...secondBatch.snapshot, version: 'v2' }, chunks: secondBatch.chunks.map(chunk => ({ ...chunk, version: 'v2' })) };
    expect(harnessDocumentCoverage(['paper.pdf'], [firstBatch, changed])).toEqual([expect.objectContaining({ complete: false, versionChanged: true })]);
    const followup = buildHarnessDocumentContinuationPrompt('详细讲解报告', harnessDocumentCoverage(['paper.pdf'], [firstBatch]));
    expect(followup).toContain('pending 7-22');
    expect(followup).toContain('version v1');
    expect(followup).toContain('详细讲解报告');
  });
  it('continues from the exact pending PDF pages and only returns a final answer after all 22 are read', async () => {
    const pages = Array.from({ length: 22 }, (_, index) => index + 1);
    const readPages = (selected: number[]): AgentSourceRead => ({
      snapshot: { path: 'report.pdf', sourceId: 'report', workspaceKey: 'work', version: 'revision-1', kind: 'pdf', totalUnits: 22, unitLabel: 'page' },
      chunks: selected.map(page => ({ path: 'report.pdf', sourceId: 'report', version: 'revision-1', unit: page, locator: `report.pdf#page=${page}`,
        text: `REPORT_PAGE_${page}_REAL_SYNTHETIC_EVIDENCE`, startOffset: 0, endOffset: 36, completeUnit: true })),
      complete: selected.length === 22, readUnits: selected, pendingUnits: pages.filter(page => !selected.includes(page)), unreadableUnits: [], scannedChars: selected.length * 36,
    });
    const prompts: string[] = [];
    const result = await runHarnessDocumentReadingLoop({ query: '请详细讲解报告的原理、实验方法和结果。', paths: ['report.pdf'], initialPrompt: 'Initial source prompt',
      sendTurn: async (prompt, { turn, recordReads }) => {
        prompts.push(prompt);
        if (turn === 0) { recordReads([readPages(pages.slice(0, 6))]); return 'Preliminary opening-page draft'; }
        expect(prompt).toContain('pending 7-22');
        expect(prompt).toContain('Original user request');
        recordReads([readPages(pages.slice(6))]);
        return 'Final report synthesis';
      },
    });
    expect(prompts).toHaveLength(2);
    expect(result.turns).toBe(2);
    expect(result.complete).toBe(true);
    expect(result.coverage).toEqual([expect.objectContaining({ readUnits: pages, pendingUnits: [], complete: true })]);
    expect(result.text).toBe('Final report synthesis');
    expect(result.turns).toBe(2);
  });
  it('does not return a partial full-paper answer as complete when the read loop makes no progress', async () => {
    const partial: AgentSourceRead = { ...read, snapshot: { ...read.snapshot, path: 'report.pdf', kind: 'pdf', totalUnits: 22, unitLabel: 'page' } };
    const sendTurn = vi.fn().mockImplementation(async (_prompt, { recordReads }) => { recordReads([partial]); return 'Opening-only draft'; });
    const result = await runHarnessDocumentReadingLoop({ query: '请详细讲解报告的原理、实验方法和结果。', paths: ['report.pdf'], initialPrompt: 'Initial', sendTurn });
    expect(result.complete).toBe(false);
    expect(result.text).toBe('Opening-only draft');
    expect(result.coverage[0]).toMatchObject({ readUnits: [1], totalUnits: 22, complete: false });
    expect(result.turns).toBe(2);
    expect(sendTurn).toHaveBeenCalledTimes(2);
  });
  it('does not erase older repeated questions while removing only the just-added request', async () => {
    const result = await prepareHarnessConversationContext({ text: '总结本文', paths: [], history: [{ role: 'user', content: '总结本文' }, { role: 'assistant', content: '先前已完成的摘要' }, { role: 'user', content: '总结本文' }], execute: vi.fn() });
    expect(result.prompt).toContain('先前已完成的摘要');
    expect(result.prompt.match(/总结本文/g)).toHaveLength(2);
  });
  it('propagates permission or revision failures before issuing the model request', async () => {
    await expect(prepareHarnessConversationContext({ text: '总结本文', paths: ['paper.md'], history: [], execute: vi.fn().mockRejectedValue(new Error('permission revoked')) })).rejects.toThrow('permission revoked');
  });
  it('checks cancellation between source reads', async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => { controller.abort(); return read; });
    await expect(prepareHarnessConversationContext({ text: '比较两篇', paths: ['paper.md', 'second.md'], history: [], execute, signal: controller.signal })).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('isolates cloud working directories by provider/account and library without exposing those identities as paths', async () => {
    vi.stubGlobal('crypto', webcrypto);
    try {
      const scope = JSON.stringify(['managed', 'https://api.example.com', 'https://db.example.com', 'test-user']);
      const first = await cloudHarnessWorkspaceSpec(scope, 'library-a');
      expect(first).toMatch(/^lattice-cloud:[a-f0-9]{64}$/u);
      expect(await cloudHarnessWorkspaceSpec(scope, 'library-a')).toBe(first);
      expect(await cloudHarnessWorkspaceSpec(scope, 'library-b')).not.toBe(first);
      expect(await cloudHarnessWorkspaceSpec(scope + '-new-user', 'library-a')).not.toBe(first);
      await expect(cloudHarnessWorkspaceSpec(undefined, 'library-a')).rejects.toThrow(/账号/u);
    } finally { vi.unstubAllGlobals(); }
  });
  it('streams only answer deltas and replaces the final snapshot, keeping commentary in the execution trace', () => {
    expect(harnessAnswerEvent({ kind: 'commentary', text: '正在读取' })).toBeNull();
    expect(harnessAnswerEvent({ kind: 'delta', text: '结论' })).toEqual({ mode: 'append', text: '结论' });
    expect(harnessAnswerEvent({ kind: 'delta', phase: 'commentary', text: '进度' })).toBeNull();
    expect(harnessAnswerEvent({ kind: 'message', phase: 'final_answer', text: '完整结论' })).toEqual({ mode: 'replace', text: '完整结论' });
  });
});
