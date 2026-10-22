import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixturePages = vi.hoisted(() => ({ pages: [] as string[], visited: [] as number[] }));
vi.mock('@/lib/storage-adapter', () => ({ getStorageAdapter: () => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn(), clear: vi.fn() }) }));
vi.mock('@/lib/pdf-js-document-loader', () => ({ loadPdfJsDocument: async () => ({ numPages: fixturePages.pages.length, destroy: async () => {} }) }));
vi.mock('@/lib/pdf-page-text-cache', () => ({ getPdfPageSearchText: async (_document: unknown, page: number) => { fixturePages.visited.push(page); return fixturePages.pages[page - 1]; } }));

import { runResearchAgent, type ResearchAgentRunInput } from '../ai/research-agent';
import { createLatticeHarnessToolRuntime } from '../ai/harness/lattice-source-tools';
import { createAuthorizedSourceIndex } from '../ai/source-index';
import { SourceTestDirectory, SourceTestFile } from '../ai/__tests__/fixtures/source-workspace';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import { getMessageText, type AiMessage } from '../ai/types';
import { validateAnswerCitations } from '../ai/citation-validation';
import { bindConversationSources } from '../ai/conversation-source-binding';
import { documentContinuationForReply, resolveResearchContinuation } from '../ai/conversation-task-context';
import { createAgentSession } from '../ai/agent-session';
import type { ChatMessage } from '@/stores/ai-chat-store';
import { assertValidAnswerCitations } from '../ai/citation-validation';

const core = ['context-pack', 'evidence-resolve', 'synthesize-answer'].map(id => ({ id, title: id, description: id }));
const readFirst = { id: 'read-first', title: 'Read initial pages', description: 'Read source', toolName: 'lattice.sources.read' as const, toolArgs: { path: 'paper.pdf', units: [1, 2], maxUnits: 2, maxChars: 5000 } };
const messageText = (messages: AiMessage[]) => messages.map(message => getMessageText(message.content)).join('\n');
const quote = 'BB1 is a composite pulse sequence that compensates pulse amplitude errors.';

function fixture() {
  const root = new SourceTestDirectory('workspace');
  root.add(new SourceTestFile('paper.pdf', '%PDF synthetic'));
  const unrelated = root.add(new SourceTestFile('other.pdf', '%PDF unrelated'));
  const sourceSelections = [{ kind: 'file' as const, path: 'paper.pdf' }];
  const runtime = createLatticeHarnessToolRuntime({ kind: 'local', root: root.handle(), workspaceKey: 'A',
    index: createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: sourceSelections }), getActivePath: () => 'paper.pdf' });
  const execute = vi.fn(runtime.execute);
  return { execute, unrelated, input: { task: 'BB1是什么？', query: 'BB1是什么？', filePath: 'paper.pdf',
    apiToolRuntime: { ...runtime, execute, sourceSelections }, workspaceKey: 'A',
    includeWorkspaceSummary: false, suggestMemory: false, compact: false } as ResearchAgentRunInput };
}

describe('bounded research recovery and continuation', () => {
  beforeEach(() => {
    useAgentSessionStore.setState({ sessions: [], activeSessionId: null });
    fixturePages.pages = Array.from({ length: 20 }, (_, i) => `Introduction and unrelated experimental background on page ${i + 1}. `.repeat(20));
    fixturePages.pages[11] = quote + ' The correction pulses are applied around different phase axes.';
    fixturePages.visited = [];
  });

  it('finds a concept on page 12 after an irrelevant first two pages and binds its original passage', async () => {
    const state = fixture();
    const generateAnswer = vi.fn(async (messages: AiMessage[]) => {
      const prompt = messageText(messages);
      expect(prompt).toContain(quote);
      const token = prompt.match(/\[p\.12\]\((citation:[^)]+)\)/)?.[1];
      expect(token).toBeTruthy();
      return { text: `BB1通过复合脉冲补偿幅度误差。[p.12](${token?.split('?')[0]}?quote=${encodeURIComponent(quote)})` };
    });
    const result = await runResearchAgent({ ...state.input, planSteps: [...core, readFirst], requireAnswer: true, generateAnswer });
    expect(state.execute.mock.calls.map(call => call[0])).toEqual(['lattice.sources.read', 'lattice.sources.search']);
    expect(state.execute.mock.calls[1][1]).toMatchObject({ query: 'BB1', maxFiles: 1, maxUnits: 32 });
    expect(result.answer).toContain('[p.12]');
    expect(validateAnswerCitations(result.answer, result.promptContext.evidenceRefs)).toMatchObject({ validCount: 1, issues: [] });
    expect(result.documentReading).toBeUndefined();
    expect(generateAnswer).toHaveBeenCalledTimes(1);
    expect(state.unrelated.reads).toBe(0);
  });

  it('uses local bounded recovery for a partial concept search without paying for a redundant replan', async () => {
    const state = fixture();
    const generatePlan = vi.fn(async () => ({ text: JSON.stringify({ steps: [...core,
      { id: 'search-concept', title: 'Search BB1', description: 'Search first units', toolName: 'lattice.sources.search', toolArgs: { query: 'BB1', paths: ['paper.pdf'], maxFiles: 1, maxUnits: 8, maxChars: 5000 } },
    ] }) }));
    const result = await runResearchAgent({ ...state.input, generatePlan, requireAnswer: true,
      generateAnswer: async messages => {
        expect(messageText(messages)).toContain(quote);
        return { text: 'BB1补偿幅度误差，证据来自已读取的第12页。' };
      } });
    expect(result.answer).toContain('BB1');
    expect(generatePlan).toHaveBeenCalledTimes(1);
    expect(state.execute.mock.calls.length).toBeGreaterThan(1);
    expect(state.execute.mock.calls.length).toBeLessThanOrEqual(8);
    expect(state.execute.mock.calls.every(call => call[0] === 'lattice.sources.search')).toBe(true);
    const continuationArgs = state.execute.mock.calls.slice(1).map(call => call[1] as Record<string, unknown>);
    for (const args of continuationArgs) expect(args).toMatchObject({ query: 'BB1', paths: ['paper.pdf'], cursor: expect.any(Number), maxUnits: 8, maxChars: 5000 });
    expect(new Set(continuationArgs.map(args => args.cursor)).size).toBe(continuationArgs.length);
    expect(fixturePages.visited).toContain(12);
    expect(state.unrelated.reads).toBe(0);
  });

  it('searches the exact source then reads bounded structural pages when planning omitted all reads', async () => {
    const state = fixture();
    const result = await runResearchAgent({ ...state.input, task: '单比特门实现方案', query: '单比特门实现方案',
      generatePlan: async () => ({ text: JSON.stringify({ steps: core }) }), maxObservationReplans: 0, maxReadToolSteps: 2,
      requireAnswer: true, generateAnswer: async messages => {
        expect(messageText(messages)).toContain('background on page 10.');
        return { text: '已读取有限结构页；以下通识说明与本文证据范围分开。' };
      } });
    expect(result.session.status).toBe('completed');
    expect(state.execute.mock.calls.map(call => call[0])).toEqual(['lattice.sources.search', 'lattice.sources.read']);
    expect(state.execute.mock.calls[0][1]).toMatchObject({ query: '单比特门', paths: ['paper.pdf'], maxFiles: 1 });
    expect(state.execute.mock.calls[1][1]).toMatchObject({ path: 'paper.pdf', units: [10, 20, 1], maxUnits: 3, maxChars: 6000, expectedVersion: expect.any(String) });
    expect(fixturePages.visited).toEqual([...Array.from({ length: 20 }, (_, i) => i + 1), 10, 20, 1]);
    expect(state.unrelated.reads).toBe(0);
  });

  it('continues beyond a completed search of only the first eight pages when the concept was not found', async () => {
    const state = fixture();
    const result = await runResearchAgent({ ...state.input, planSteps: [...core,
      { id: 'initial-search', title: 'Search bounded pages', description: 'Locate the concept', toolName: 'lattice.sources.search', toolArgs: { query: 'BB1', paths: ['paper.pdf'], maxFiles: 1, maxUnits: 8, maxChars: 40000 } }],
      maxReadToolSteps: 2, requireAnswer: true, generateAnswer: async messages => {
        const prompt = messageText(messages);
        expect(prompt).toContain(quote);
        const token = prompt.match(/\[p\.12\]\((citation:[^)]+)\)/)?.[1];
        return { text: 'BB1补偿脉冲幅度误差。[p.12](' + token + ')' };
      } });
    expect(result.answer).toContain('[p.12]');
    expect(validateAnswerCitations(result.answer, result.promptContext.evidenceRefs).issues).toEqual([]);
    expect(state.execute).toHaveBeenCalledTimes(2);
    expect(state.execute.mock.calls.map(call => call[0])).toEqual(['lattice.sources.search', 'lattice.sources.search']);
    expect(state.execute.mock.calls[1][1]).toMatchObject({ query: 'BB1', paths: ['paper.pdf'], cursor: expect.any(Number), maxUnits: 8 });
    expect(fixturePages.visited).toContain(12);
    expect(fixturePages.visited.filter(page => page === 1)).toHaveLength(1);
    expect(state.unrelated.reads).toBe(0);
  });

  it('executes a real source search attached to context-pack without a redundant paid replan once evidence is ready', async () => {
    const state = fixture();
    const generatePlan = vi.fn(async () => ({ text: JSON.stringify({ steps: [
      { id: 'context-pack', title: 'Locate BB1 passages in the authorized source', description: 'Search the captured PDF for literal BB1', toolName: 'lattice.sources.search', toolArgs: { query: 'BB1', maxUnits: 20, maxFiles: 1, maxChars: 40000 } },
      { id: 'evidence-resolve', title: 'Resolve evidence', description: 'Resolve original passages', toolName: 'evidence.resolve', toolArgs: { query: 'BB1', maxContextTokens: 2000 } },
      { id: 'synthesize-answer', title: 'Explain BB1', description: 'Use the real evidence', toolName: 'evidence.resolve', toolArgs: { query: 'BB1', maxContextTokens: 1500 } },
    ] }) }));
    const result = await runResearchAgent({ ...state.input, generatePlan, requireAnswer: true, generateAnswer: async messages => {
      const token = messageText(messages).match(/\[p\.12\]\((citation:[^)]+)\)/)?.[1];
      return { text: 'BB1补偿幅度误差。[p.12](' + token + ')' };
    } });
    expect(result.session.status).toBe('completed');
    expect(generatePlan).toHaveBeenCalledTimes(1);
    expect(state.execute.mock.calls.map(call => call[0])).toEqual(['lattice.sources.search']);
    expect(result.toolObservations[0].stepId).not.toContain('recover');
    expect(validateAnswerCitations(result.answer, result.promptContext.evidenceRefs)).toMatchObject({ validCount: 1, issues: [] });
  });

  it('validates a real quote beyond the former 800-character evidence preview', async () => {
    const state = fixture();
    fixturePages.pages[0] = 'Unrelated introduction. '.repeat(50) + quote;
    const generateAnswer = vi.fn(async (messages: AiMessage[]) => {
      const prompt = messageText(messages);
      const token = prompt.match(/\[p\.1\]\((citation:[^)]+)\)/)?.[1];
      return { text: `BB1补偿幅度误差。[p.1](${token?.split('?')[0]}?quote=${encodeURIComponent(quote)})` };
    });
    const result = await runResearchAgent({ ...state.input, planSteps: [...core, readFirst], generateAnswer, requireAnswer: true });
    expect(generateAnswer).toHaveBeenCalledTimes(1);
    expect(validateAnswerCitations(result.answer, result.promptContext.evidenceRefs).issues).toEqual([]);
    expect(state.execute).toHaveBeenCalledTimes(1);
  });

  it('recovers one transient source failure without losing the available original passage', async () => {
    const state = fixture();
    fixturePages.pages[0] = quote;
    state.execute.mockRejectedValueOnce(new Error('Temporary source read failure'));
    const result = await runResearchAgent({ ...state.input, query: '第1页提到BB1吗？', planSteps: [...core, { ...readFirst, toolArgs: { ...readFirst.toolArgs, units: [1], maxUnits: 1 } }],
      requireAnswer: true, generateAnswer: async messages => {
        const token = messageText(messages).match(/\[p\.1\]\((citation:[^)]+)\)/)?.[1];
        return { text: `第1页提到了BB1。[p.1](${token})` };
      } });
    expect(result.session.status).toBe('completed');
    expect(result.toolResults.map(item => item.status)).toEqual(['failed', 'completed']);
    expect(state.execute.mock.calls.map(call => call[0])).toEqual(['lattice.sources.read', 'lattice.sources.read']);
    expect(state.execute.mock.calls[1][1]).toMatchObject({ path: 'paper.pdf', units: [1], maxUnits: 1 });
    expect(validateAnswerCitations(result.answer, result.promptContext.evidenceRefs)).toMatchObject({ validCount: 1, issues: [] });
    expect(state.unrelated.reads).toBe(0);
  });

  it('stops after one failed recovery instead of retrying without a bound', async () => {
    const state = fixture(), generateAnswer = vi.fn(async () => ({ text: 'Unsupported conclusion' }));
    state.execute.mockRejectedValue(new Error('Temporary source read failure'));
    await expect(runResearchAgent({ ...state.input, planSteps: [...core, readFirst], generateAnswer, requireAnswer: true })).rejects.toThrow('Temporary source read failure');
    expect(state.execute).toHaveBeenCalledTimes(2);
    expect(generateAnswer).not.toHaveBeenCalled();
  });

  it('does not spend beyond the total tool budget when a transient read fails', async () => {
    const state = fixture();
    state.execute.mockRejectedValue(new Error('Temporary source read failure'));
    await expect(runResearchAgent({ ...state.input, planSteps: [...core, readFirst], maxReadToolSteps: 1 })).rejects.toThrow('Temporary source read failure');
    expect(state.execute).toHaveBeenCalledTimes(1);
  });

  it('preserves verified early-page text when a later bounded search and its one recovery fail', async () => {
    const state = fixture(), execute = state.execute.getMockImplementation()!;
    fixturePages.pages[0] = quote;
    state.execute.mockImplementation(async (name, args, signal) => {
      if (name === 'lattice.sources.search') throw new Error('Temporary source read failure');
      return execute(name, args, signal);
    });
    const result = await runResearchAgent({ ...state.input, planSteps: [...core, readFirst,
      { id: 'search-more', title: 'Search further', description: 'Search remaining passages', toolName: 'lattice.sources.search', toolArgs: { query: 'BB1', maxFiles: 1, maxUnits: 32, maxChars: 120000 } }],
      generateAnswer: async messages => {
        const token = messageText(messages).match(/\[p\.1\]\((citation:[^)]+)\)/)?.[1];
        return { text: '已读第1页说明BB1用于补偿幅度误差。[p.1](' + token + ')' };
      }, requireAnswer: true });
    expect(result.answer).toContain('BB1用于补偿幅度误差');
    expect(result.answer).toContain('补充读取未成功');
    expect(validateAnswerCitations(result.answer, result.promptContext.evidenceRefs)).toMatchObject({ validCount: 1, issues: [] });
    expect(state.execute.mock.calls.map(call => call[0])).toEqual(['lattice.sources.read', 'lattice.sources.search', 'lattice.sources.search']);
    expect(state.unrelated.reads).toBe(0);
  });

  it.each(['Workspace source permission revoked.', 'Source changed; select or reread its current revision.', 'Source path is outside the authorized selection.'])('does not recover across an authorization or identity failure: %s', async error => {
    const state = fixture();
    state.execute.mockRejectedValue(new Error(error));
    await expect(runResearchAgent({ ...state.input, planSteps: [...core, readFirst] })).rejects.toThrow(error);
    expect(state.execute).toHaveBeenCalledTimes(1);
  });

  it('repairs an unsupported whole-document completion claim before exposing the answer', async () => {
    const state = fixture(), onAnswerDelta = vi.fn();
    const generateAnswer = vi.fn(async () => ({ text: generateAnswer.mock.calls.length === 1 ? '我已阅读完整篇论文，可以确认全文未提及BB1。' : '本次仅核查了前2页，尚不能判断其余页面是否提及BB1。' }));
    const result = await runResearchAgent({ ...state.input, planSteps: [...core, readFirst], maxReadToolSteps: 1, generateAnswer, requireAnswer: true, onAnswerDelta });
    expect(result.answer).toBe('本次仅核查了前2页，尚不能判断其余页面是否提及BB1。');
    expect(onAnswerDelta).toHaveBeenCalledTimes(1);
    expect(onAnswerDelta).toHaveBeenCalledWith(result.answer);
  });

  it.each(['我已读完前2页，后续页面尚未读取。', '不能宣称已通读全文，现有证据仅来自前2页。', 'I have not read the entire paper. Only the first two pages are available.'])('allows an honest partial-coverage statement: %s', async answer => {
    const state = fixture();
    const result = await runResearchAgent({ ...state.input, planSteps: [...core, readFirst], maxReadToolSteps: 1,
      requireAnswer: true, generateAnswer: async () => ({ text: answer }) });
    expect(result.answer).toBe(answer);
  });

  it('does not treat a full search scan as having supplied every page to answer synthesis', async () => {
    const state = fixture();
    const generateAnswer = vi.fn(async () => ({ text: generateAnswer.mock.calls.length === 1 ? '我已通读全文，BB1定义见第12页。' : '检索在第12页找到BB1定义，回答依据已提供的相关摘录。' }));
    const result = await runResearchAgent({ ...state.input, planSteps: [...core, readFirst], generateAnswer, requireAnswer: true });
    expect(result.answer).toBe('检索在第12页找到BB1定义，回答依据已提供的相关摘录。');
  });

  it('respects an explicit page scope and the total tool budget', async () => {
    const state = fixture();
    const result = await runResearchAgent({ ...state.input, task: '第1页提到BB1吗？', query: '第1页提到BB1吗？', planSteps: [...core, readFirst], maxReadToolSteps: 1 });
    expect(state.execute).toHaveBeenCalledTimes(1);
    expect(result.promptContext.evidenceRefs.every(ref => !ref.anchor?.page || ref.anchor.page <= 2)).toBe(true);
  });

  it('does not expose rejected citation drafts or encoded protocol URLs to the answer surface', async () => {
    const state = fixture(), onAnswerDelta = vi.fn();
    const invalid = `Unsupported claim [p.2](citation:invented?quote=${encodeURIComponent('乱码和编造原文')}).`;
    const generateAnswer = vi.fn(async () => ({ text: invalid }));
    await expect(runResearchAgent({ ...state.input, planSteps: [...core, readFirst], generateAnswer, onAnswerDelta, requireAnswer: true })).rejects.toThrow('引文校验未通过');
    expect(onAnswerDelta).not.toHaveBeenCalled();
    try { assertValidAnswerCitations(invalid, []); } catch (error) {
      expect((error as Error).message).not.toContain('citation:');
      expect((error as Error).message).not.toContain('%');
    }
  });

  it('resumes the most recent paused reading checkpoint without crossing a newer task', () => {
    const session = { ...createAgentSession({ profile: 'research', task: 'Read paper' }), id: 'paused', status: 'cancelled' as const,
      documentResearch: { status: 'paused' as const, workspaceKey: 'A', checkpoint: { version: 1 as const, queryKey: '["Read paper","BB1是什么？"]',
        sources: [{ path: 'paper.pdf', version: 'v1', totalUnits: 20, completedUnits: [1, 2], offsets: {} }], summaries: [], findings: [], completedBatches: 0,
        coverage: [{ path: 'paper.pdf', kind: 'pdf' as const, unitLabel: 'page' as const, totalUnits: 20, readUnits: [1, 2], pendingUnits: [3, 4], emptyUnits: [], unreadableUnits: [] }] } } };
    const messages: ChatMessage[] = [{ id: 'q', role: 'user', content: 'BB1是什么？', timestamp: 1 },
      { id: 'a', role: 'assistant', content: '本次已读取部分，检查点已保存。', timestamp: 2, agentResult: { sessionId: 'paused' } }];
    expect(documentContinuationForReply('做', messages, () => session)).toEqual({ sourceSessionId: 'paused', documentResume: true });
    expect(documentContinuationForReply('做', [...messages, { id: 'new', role: 'user', content: '解释Python', timestamp: 3 }], () => session)).toBeUndefined();
    expect(resolveResearchContinuation('好', [{ role: 'user', content: 'BB1是什么' }, { role: 'assistant', content: '这是已经完成的回答。' }])).toBeUndefined();
    expect(resolveResearchContinuation('谢谢', [{ role: 'user', content: 'BB1是什么' }, { role: 'assistant', content: '下一步继续检索。' }])).toBeUndefined();
  });

  it.each(['做', '继续', '好'])('carries the preceding paper objective and clear next action into planning for %s', async acknowledgement => {
    const state = fixture();
    const history: AiMessage[] = [{ role: 'user', content: 'BB1是什么？' }, { role: 'assistant', content: '已读取前2页；下一步我会检索论文剩余页面中的BB1定义并解释。' }];
    const generatePlan = vi.fn(async (messages: AiMessage[]) => {
      expect(messageText(messages)).toContain('BB1是什么');
      expect(messageText(messages)).toContain('检索论文剩余页面中的BB1');
      return { text: JSON.stringify({ steps: [...core, readFirst] }) };
    });
    await runResearchAgent({ ...state.input, task: acknowledgement, query: acknowledgement, history, generatePlan });
    expect(generatePlan).toHaveBeenCalled();
    const binding = bindConversationSources({ query: acknowledgement,
      messages: [{ id: 'q', role: 'user', content: 'BB1是什么？', timestamp: 1 }, { id: 'a', role: 'assistant', content: String(history[1].content), timestamp: 2, documentContext: { paths: ['paper.pdf'], workspaceKey: 'A' } }],
      localWorkspaceKey: 'A', activeLocalPath: 'other.pdf', activeCloud: false });
    expect(binding.referentPaths).toEqual(['paper.pdf']);
  });
});
