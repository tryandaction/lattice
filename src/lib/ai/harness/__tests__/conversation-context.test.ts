import { describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { cloudHarnessWorkspaceSpec, prepareHarnessConversationContext, harnessAnswerEvent } from '../conversation-context';
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
    const result = await prepareHarnessConversationContext({ text: '总结本文', history: [{ role: 'user', content: '讨论鲁棒性' }, { role: 'assistant', content: '已讨论第一部分' }], paths: ['paper.md'], execute });
    expect(execute).toHaveBeenCalledWith('lattice.sources.read', { path: 'paper.md', maxChars: 24000, maxUnits: 6 }, undefined);
    expect(result.reads).toEqual([read]);
    expect(result.prompt).toContain('讨论鲁棒性');
    expect(result.prompt).toContain('Synthetic paper finding.');
    expect(result.prompt).toContain('unread sections');
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
