import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessageText, type AiMessage } from '../ai/types';

const storage = {
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
};

vi.mock('@/lib/storage-adapter', () => ({
  getStorageAdapter: () => storage,
}));

import {
  buildResearchAgentApprovalSummary,
  finalizeResearchAgentApprovedArtifacts,
  reconcileResearchAgentPendingApprovals,
  runResearchAgent,
} from '../ai/research-agent';
import {
  approveAgentToolRequest,
  createAgentToolSession,
  executeAgentTool,
} from '../ai/agent-tool-broker';
import { useAiWorkbenchStore } from '@/stores/ai-workbench-store';
import { useAgentMemoryStore } from '@/stores/agent-memory-store';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import { getWorkspaceIndex } from '../ai/workspace-indexer';
import { buildCitationContracts } from '../ai/citation-contract';
import { estimateTokens } from '../ai/token-estimator';
import { createAgentMemoryEntry } from '../ai/agent-memory';

describe('research-agent', () => {
  it('records planner response diagnostics even when the model returned no plan text', async () => {
    const result = await runResearchAgent({ task: 'Explain supplied text', content: 'Synthetic text supplied directly by the user.', compact: false, suggestMemory: false,
      generatePlan: async () => ({ text: '', finishReason: 'length', responseDiagnostics: { protocol: 'anthropic-messages', mode: 'response', blockTypes: ['thinking'], visibleCharacters: 0, stopReason: 'max_tokens' } }),
      generateAnswer: async () => ({ text: 'Synthetic text explanation.', finishReason: 'stop' }) });
    expect(result.session.trace).toContainEqual(expect.objectContaining({ metadata: expect.objectContaining({ responseProtocol: 'anthropic-messages', responseBlockTypes: 'thinking', responseVisibleCharacters: 0, responseStopReason: 'max_tokens' }) }));
  });
  it('keeps empty-output recovery within the configured ceiling and records content-free diagnostics', async () => {
    const budgets: number[] = [];
    const diagnostics = { protocol: 'anthropic-messages' as const, mode: 'response' as const, blockTypes: ['thinking'],
      visibleCharacters: 0, stopReason: 'max_tokens', finishReason: 'length' as const,
      usage: { promptTokens: 600, completionTokens: 1000, totalTokens: 1600, reasoningTokens: 1000 } };
    const result = await runResearchAgent({ task: 'Explain supplied evidence', content: 'Source evidence',
      answerMaxTokens: 500, answerRecoveryMaxTokens: 1200, suggestMemory: false, compact: false,
      generateAnswer: async (_messages, options) => {
        budgets.push(options.maxTokens!);
        return budgets.length === 1 ? { text: '', finishReason: 'length', responseDiagnostics: diagnostics }
          : { text: 'A complete supported explanation.', finishReason: 'stop' };
      } });
    expect(budgets).toEqual([500, 1200]);
    expect(result.session.trace).toContainEqual(expect.objectContaining({ metadata: expect.objectContaining({
      stage: 'synthesis.response', responseProtocol: 'anthropic-messages', responseBlockTypes: 'thinking', responseVisibleCharacters: 0,
      responseStopReason: 'max_tokens', responseReasoningTokens: 1000,
    }) }));
  });

  it('retains empty-response diagnostics when no visible answer can be recovered', async () => {
    await expect(runResearchAgent({ sessionId: 'empty-response-diagnostics', task: 'Explain', content: 'Source evidence',
      suggestMemory: false, compact: false, generateAnswer: async () => ({ text: '', finishReason: 'stop',
        responseDiagnostics: { protocol: 'anthropic-messages', mode: 'response', blockTypes: ['thinking'], visibleCharacters: 0, stopReason: 'end_turn' },
      }) })).rejects.toThrow('未返回可见回答');
    const session = useAgentSessionStore.getState().getSession('empty-response-diagnostics');
    expect(session?.status).toBe('failed');
    expect(session?.trace.filter(event => event.metadata?.stage === 'synthesis.response')).toHaveLength(2);
  });
  it('retains the first synthesis segment and appends its continuation before declaring the task complete', async () => {
    const generateAnswer = vi.fn().mockResolvedValueOnce({ text: 'Incomplete explanation', finishReason: 'length' }).mockResolvedValueOnce({ text: 'A complete supported explanation.', finishReason: 'stop' });
    const result = await runResearchAgent({ task: 'Analyze', content: 'Original evidence', generateAnswer, suggestMemory: false, compact: false });
    expect(generateAnswer).toHaveBeenCalledTimes(2);
    expect(result.answer).toContain('Incomplete explanation');
    expect(result.answer).toContain('A complete supported explanation.');
    expect(result.answer.indexOf('Incomplete explanation')).toBeLessThan(result.answer.indexOf('A complete supported explanation.'));
    expect(generateAnswer.mock.calls[1][0]).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'assistant', content: 'Incomplete explanation' })]));
  });
  it('repairs unbound final citations and supplies the rejected answer to the repair turn', async () => {
    const invalid = 'Unsupported citation [p.3](citation:invented).';
    const generateAnswer = vi.fn().mockResolvedValueOnce({ text: invalid }).mockResolvedValueOnce({ text: '当前材料不足以核实该论点，缺少第三页对应原文。' });
    const result = await runResearchAgent({ task: 'Analyze', content: 'Original evidence', generateAnswer, suggestMemory: false, compact: false });
    expect(generateAnswer).toHaveBeenCalledTimes(2);
    expect(generateAnswer.mock.calls[1][0]).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'assistant', content: invalid })]));
    expect(result.answer).toContain('不足以核实');
  });

  it('does not complete an agent answer whose citations remain invalid after repair', async () => {
    const generateAnswer = vi.fn().mockResolvedValue({ text: '[p.3](citation:invented)' });
    await expect(runResearchAgent({ task: 'Analyze', content: 'Original evidence', generateAnswer, suggestMemory: false, compact: false })).rejects.toThrow('引文校验未通过');
    expect(generateAnswer).toHaveBeenCalledTimes(2);
  });
  it('rejects a final repair that removes the broken citation without correcting its claim', async () => {
    const generateAnswer = vi.fn().mockResolvedValueOnce({ text: 'The measured value is 58 G [p.3](citation:invented).' }).mockResolvedValueOnce({ text: 'The measured value is 58 G.' });
    await expect(runResearchAgent({ task: 'Analyze', content: 'Original evidence', generateAnswer, suggestMemory: false, compact: false })).rejects.toThrow('仅删除');
  });

  it('budgets the complete final synthesis messages including citation menus for a long Chinese paper', async () => {
    const pages = Array.from({ length: 40 }, (_, index) => `第${index + 1}页的唯一实验结果：${'测量误差经过独立校准后保持稳定。'.repeat(23)}`);
    const source = { path: '中文论文.pdf', kind: 'pdf' as const, version: 'hash', unitLabel: 'page' as const, totalUnits: pages.length,
      readUnit: vi.fn(async (unit: number) => ({ text: pages[unit - 1], status: 'text' as const })), close: vi.fn(async () => {}) };
    let synthesisTokens = 0;
    const generateAnswer = vi.fn(async (messages: AiMessage[]) => {
      if (getMessageText(messages[0].content).startsWith('Read the supplied document fragments')) {
        const batch = JSON.parse(getMessageText(messages[1].content));
        return { text: JSON.stringify({ summary: '本批实验结果均经过独立校准。'.repeat(50), findings: batch.units.flatMap((unit: { id: string; passages: Array<{ passageId?: string; text: string }> }) => {
          const passage = unit.passages.find(item => item.passageId && item.text.includes('唯一实验结果'));
          return passage ? [{ sourceId: unit.id, passageId: passage.passageId, reason: '用于核对校准后的实验结果。'.repeat(45), importance: 2 }] : [];
        }) }) };
      }
      synthesisTokens = estimateTokens(messages.map(message => getMessageText(message.content)).join('\n'));
      return { text: '全文已逐批分析；结论由经过核验的原文支持。' };
    });
    const result = await runResearchAgent({ task: '阅读全文', query: '阅读全文', documentSources: [source], requireAnswer: true, generateAnswer, suggestMemory: false, compact: false });
    expect(result.documentReading?.complete).toBe(true);
    expect(result.documentReading?.findings).toHaveLength(40);
    expect(synthesisTokens).toBeGreaterThan(0);
    expect(synthesisTokens).toBeLessThanOrEqual(12000 - 450);
    expect(result.promptContext.evidenceRefs.some(ref => ref.anchor?.page === 40)).toBe(true);
  });
  it('persists document progress and continues the same session without re-reading completed pages', async () => {
    const pages = Array.from({ length: 27 }, (_, index) => `Important result on page ${index + 1}. ` + 'Supporting data. '.repeat(140));
    const makeSource = () => ({ path: 'paper.pdf', kind: 'pdf' as const, version: 'content-hash', unitLabel: 'page' as const, totalUnits: pages.length,
      readUnit: vi.fn(async (unit: number) => ({ text: pages[unit - 1], status: 'text' as const })), close: vi.fn(async () => {}) });
    const generateAnswer = vi.fn(async (messages: AiMessage[]) => {
      if (getMessageText(messages[0].content).startsWith('Read the supplied document fragments')) {
        const batch = JSON.parse(getMessageText(messages[1].content));
        return { text: JSON.stringify({ summary: 'Measured source results.', findings: batch.units.flatMap((unit: { id: string; passages: Array<{ passageId?: string; text: string }> }) => {
          const passage = unit.passages.find(item => item.passageId && /Important result on page \d+\./.test(item.text));
          return passage ? [{ sourceId: unit.id, passageId: passage.passageId, reason: 'Relevant experimental result' }] : [];
        }) }) };
      }
      return { text: 'The full document was analyzed; its final page reports an important result.' };
    });
    const first = await runResearchAgent({ sessionId: 'read-doc', task: 'Read all', query: 'Read all', documentSources: [makeSource()], documentMaxCalls: 1, requireAnswer: true, generateAnswer, suggestMemory: false, compact: false });
    expect(first.documentReading?.resumable).toBe(true);
    expect(first.session.status).not.toBe('completed');
    expect(storage.set).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ sessions: expect.arrayContaining([expect.objectContaining({ documentResearch: expect.any(Object) })]) }));
    const completed = first.documentReading!.coverage[0].readUnits;
    expect(completed.length).toBeGreaterThan(0);
    useAgentSessionStore.getState().resumeDocumentSession(first.sessionId);
    const source = makeSource();
    const result = await runResearchAgent({ sessionId: first.sessionId, task: 'Read all', query: 'Read all', documentSources: [source], requireAnswer: true, generateAnswer, suggestMemory: false, compact: false });
    expect(result.sessionId).toBe(first.sessionId);
    expect(result.documentReading?.complete).toBe(true);
    expect(result.documentReading?.coverage[0].readUnits).toHaveLength(27);
    for (const page of completed) expect(source.readUnit.mock.calls.some(([unit]) => unit === page)).toBe(false);
    expect(result.promptContext.evidenceRefs.some(ref => ref.anchor?.page === 27)).toBe(true);
    expect(result.session.status).toBe('completed');
  });

  it('continues all 22 pages after mixed evidence failures and passes explicit gaps into synthesis', async () => {
    const pages = Array.from({ length: 22 }, (_, index) => `Page ${index + 1} uniquely reports Ω = ${index + 1} and measured pulse fidelity for this experiment.`);
    const source = { path: 'paper.pdf', kind: 'pdf' as const, version: 'mixed-content-hash', unitLabel: 'page' as const, totalUnits: pages.length,
      readUnit: vi.fn(async (unit: number) => ({ text: pages[unit - 1], status: 'text' as const })), close: vi.fn(async () => {}) };
    let synthesisPrompt = '';
    const result = await runResearchAgent({ sessionId: 'mixed-evidence', task: '全文阅读并标记证据缺口', query: 'read all', documentSources: [source], requireAnswer: true, suggestMemory: false, compact: false, generateAnswer: async (messages: AiMessage[]) => {
      if (getMessageText(messages[0].content).startsWith('Read the supplied document fragments')) {
        const batch = JSON.parse(getMessageText(messages[1].content));
        const verified = batch.units.slice(0, 7).flatMap((unit: { id: string; passages: Array<{ passageId?: string }> }) => {
          const passage = unit.passages.find(item => item.passageId);
          return passage ? [{ sourceId: unit.id, passageId: passage.passageId, reason: 'Direct experimental evidence.' }] : [];
        });
        return { text: JSON.stringify({ summary: 'Unverified summary that must not reach synthesis.', findings: [...verified, { sourceId: 'invented', quote: 'No source supports this invented sentence.', reason: 'Unsupported.' }] }) };
      }
      synthesisPrompt = messages.map(message => getMessageText(message.content)).join('\n');
      return { text: '已阅读全文22页，但部分证据未通过原文校验并已排除；保留的原文可支持后续分析。' };
    } });
    expect(result.documentReading?.coverage[0].readUnits).toEqual(Array.from({ length: 22 }, (_, index) => index + 1));
    expect(result.documentReading?.findings.some(finding => finding.unit === 22)).toBe(true);
    expect(result.documentReading?.findings.every(finding => pages.includes(finding.quote))).toBe(true);
    expect(result.documentReading?.complete).toBe(true);
    expect(result.documentReading?.evidenceComplete).toBe(false);
    expect(result.documentReading!.evidenceIssues.length).toBeGreaterThan(0);
    expect(result.session.documentResearch?.checkpoint.evidenceIssues).toEqual(result.documentReading?.evidenceIssues);
    expect(synthesisPrompt).toContain('Evidence gaps:');
    expect(synthesisPrompt).not.toContain('Unverified summary that must not reach synthesis.');
    expect(synthesisPrompt).not.toContain('No source supports this invented sentence.');
    expect(result.answer).toContain('未通过原文校验');
    expect(result.session.status).toBe('completed');
  });

  it('does not synthesize a successful answer when every document finding fails verification', async () => {
    const source = { path: 'paper.pdf', kind: 'pdf' as const, version: 'invalid-content-hash', unitLabel: 'page' as const, totalUnits: 22,
      readUnit: async (unit: number) => ({ text: `Page ${unit} contains a unique experimental observation.`, status: 'text' as const }), close: vi.fn(async () => {}) };
    let synthesisCalls = 0;
    await expect(runResearchAgent({ sessionId: 'invalid-evidence', task: 'read all', query: 'read all', documentSources: [source], requireAnswer: true, suggestMemory: false, compact: false, generateAnswer: async (messages: AiMessage[]) => {
      if (getMessageText(messages[0].content).startsWith('Read the supplied document fragments')) return { text: JSON.stringify({ summary: 'Fabricated summary.', findings: [{ sourceId: 'invented', quote: 'Entirely invented evidence.', reason: 'Unsupported.' }] }) };
      synthesisCalls++;
      return { text: 'This must not be generated.' };
    } })).rejects.toThrow(/validation failed/i);
    const session = useAgentSessionStore.getState().getSession('invalid-evidence');
    expect(synthesisCalls).toBe(0);
    expect(session?.status).toBe('failed');
    expect(session?.documentResearch?.checkpoint.coverage[0].readUnits).toEqual([]);
    expect(session?.documentResearch?.checkpoint.findings).toEqual([]);
  });

  it('repairs an invalid final response once before accepting the output', async () => {
    const generateAnswer = vi.fn().mockResolvedValueOnce({ text: 'invalid' }).mockResolvedValueOnce({ text: 'Valid supported answer.' });
    const result = await runResearchAgent({ task: 'Analyze', content: 'Original evidence', generateAnswer,
      validateAnswer: answer => { if (answer === 'invalid') throw new Error('Missing required result format'); }, suggestMemory: false, compact: false });
    expect(result.answer).toBe('Valid supported answer.');
    expect(generateAnswer).toHaveBeenCalledTimes(2);
    expect(result.session.trace.some(event => event.metadata?.stage === 'synthesis.repair')).toBe(true);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useAgentSessionStore.setState({
      sessions: [],
      activeSessionId: null,
    });
    useAgentMemoryStore.setState({
      entries: [],
      loaded: true,
    });
    useAiWorkbenchStore.setState({
      drafts: [],
      proposals: [],
      highlightedProposalId: null,
    });
    const workspaceIndex = getWorkspaceIndex();
    workspaceIndex.files.clear();
    workspaceIndex.lastFullIndex = 0;
    workspaceIndex.version = 0;
  });

  it('runs the main research flow through context pack, memory, evidence, answer, trace, and compaction', async () => {
    useAgentMemoryStore.getState().addMemory({
      id: 'memory-main-1',
      scope: 'project',
      title: 'Synthesis style',
      content: 'Always ground conclusions in cited workspace context.',
      source: {
        label: 'Project rule',
        locator: 'project://rules',
      },
      pinned: true,
      now: 100,
    });

    const result = await runResearchAgent({
      sessionId: 'research-session-1',
      contextPackId: 'research-pack-1',
      now: 300,
      task: 'Compare Alpha evidence',
      filePath: 'notes/alpha.md',
      content: '# Alpha\nThe result improves evidence grounding and reproducibility.',
      selection: 'The result improves evidence grounding.',
      query: 'What does Alpha improve?',
      workspaceKey: 'lattice-research',
      workspaceIndex: {
        files: new Map([
          ['notes/alpha.md', {
            path: 'notes/alpha.md',
            name: 'alpha.md',
            extension: '.md',
            size: 160,
            summary: 'Alpha note summary.',
            headings: ['Alpha'],
            lastModified: 200,
          }],
        ]),
        lastFullIndex: 200,
        version: 7,
      },
      compact: true,
      maxTraceEvents: 6,
      retainRecentEvents: 3,
    });

    expect(result.sessionId).toBe('research-session-1');
    expect(result.contextPack.id).toBe('research-pack-1');
    expect(result.contextPack.budget.maxTokens).toBe(4000);
    expect(result.contextPack.budget.bySource.active_file).toBe(1200);
    expect(result.contextPack.sections.map((section) => section.source)).toEqual(
      expect.arrayContaining(['selection', 'active_file', 'memory', 'workspace_chunk']),
    );
    expect(result.promptContext.evidenceRefs.map((ref) => ref.locator)).toContain('notes/alpha.md');
    expect(result.answer).toContain('尚未生成答复');
    expect(result.answer).not.toContain('Task:');
    expect(result.answer).not.toContain('The result improves');
    expect(result.planSteps).toEqual([
      expect.objectContaining({ id: 'context-pack', status: 'completed' }),
      expect.objectContaining({
        id: 'resolve-lattice-path-identity',
        status: 'completed',
        toolName: 'lattice.resolvePathIdentity',
      }),
      expect.objectContaining({ id: 'evidence-resolve', status: 'completed', toolName: 'evidence.resolve' }),
      expect.objectContaining({ id: 'synthesize-answer', status: 'completed' }),
      expect.objectContaining({ id: 'compact-session', status: 'completed' }),
    ]);
    expect(result.toolObservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 'resolve-lattice-path-identity',
          toolName: 'lattice.resolvePathIdentity',
          status: 'completed',
          preview: expect.stringContaining('notes/alpha.md'),
        }),
      ]),
    );
    expect(result.memorySnapshotIds).toEqual(['memory-main-1']);
    expect(result.workspaceSummary).toMatchObject({
      workspaceKey: 'lattice-research',
      indexVersion: 7,
    });
    expect(result.artifactResults).toEqual([]);
    expect(result.memorySuggestionResults).toEqual([]);
    expect(result.approvalSummary).toMatchObject({
      status: 'none',
      totalApprovals: 0,
      pendingApprovals: 0,
      completedApprovals: 0,
    });
    expect(result.session).toMatchObject({
      status: 'completed',
      contextPackId: 'research-pack-1',
      memorySnapshotIds: ['memory-main-1'],
    });
    expect(result.session.compactions[0]).toMatchObject({
      id: 'research-session-1:compaction',
    });
    expect(result.session.trace.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['session_started', 'context_resolved', 'planning', 'completed']),
    );
    expect(result.session.trace.find((event) => event.id === 'research-session-1:compaction:event')).toMatchObject({
      metadata: expect.objectContaining({
        compactionId: 'research-session-1:compaction',
        sourceEventKinds: expect.stringContaining('tool_result'),
      }),
    });
    expect(result.contextPack.omittedSummary).toMatchObject({
      preview: expect.any(String),
      semanticPreview: expect.any(String),
      recoveryHintsPreview: expect.any(String),
    });
    expect(result.contextPack.omittedSummary.recoveryHints.length).toBeLessThanOrEqual(5);
  });

  it('continues an ordinary research answer when memory retrieval is unavailable', async () => {
    const queryMemories = vi.spyOn(useAgentMemoryStore.getState(), 'queryMemories').mockImplementation(() => {
      throw new Error('memory storage unavailable');
    });

    const result = await runResearchAgent({
      sessionId: 'research-memory-fallback',
      task: 'Answer without memory',
      filePath: 'notes/fallback.md',
      content: 'Evidence remains available without memory.',
      query: 'What remains available?',
      compact: false,
      generateAnswer: async () => ({ text: 'Answer generated without memory.' }),
    });

    expect(result.answer).toContain('without memory');
    expect(result.memorySnapshotIds).toEqual([]);
    expect(result.planWarnings.join(' ')).toContain('memory');
    queryMemories.mockRestore();
  });

  it('loads persisted memory before querying it without requiring the memory panel', async () => {
    const saved = createAgentMemoryEntry({ id: 'persisted-style', scope: 'user', title: 'Explanation style', content: 'Explain with a short derivation.', source: { label: 'User preference' }, now: Date.now() });
    useAgentMemoryStore.setState({ entries: [], loaded: false, persistenceError: null });
    storage.get.mockResolvedValueOnce({ entries: [saved] });
    const result = await runResearchAgent({ task: 'Explain a concept', content: 'Supplied evidence.', compact: false, suggestMemory: false });
    expect(result.memorySnapshotIds).toContain('persisted-style');
  });

  it('does not consume in-memory context after persisted memory loading fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const saved = createAgentMemoryEntry({ id: 'unverified-memory', scope: 'user', title: 'Unavailable prior context', content: 'Do not consume this after loading fails.', source: { label: 'Saved context' }, now: Date.now() });
    useAgentMemoryStore.setState({ entries: [saved], loaded: false, persistenceError: null });
    storage.get.mockRejectedValueOnce(new Error('Synthetic memory load failure'));
    const result = await runResearchAgent({ task: 'Explain a concept', content: 'Supplied evidence.', compact: false, suggestMemory: false });
    expect(result.memorySnapshotIds).toEqual([]);
    expect(result.planWarnings.join(' ')).toContain('memory');
    consoleError.mockRestore();
  });

  it('uses the injected answer generator for a direct answer instead of returning the audit context dump', async () => {
    const result = await runResearchAgent({
      sessionId: 'research-session-direct-answer',
      now: 301,
      task: 'Explain Alpha',
      query: 'What does Alpha improve?',
      content: '# Alpha\nThe result improves evidence grounding and reproducibility.',
      selection: 'The result improves evidence grounding.',
      generateAnswer: async () => ({
        text: 'Conclusion: Alpha improves evidence grounding and reproducibility.\n\nExample: compare the cited result with the original note.',
      }),
      compact: false,
    });

    expect(result.answer).toContain('Alpha improves evidence grounding and reproducibility.');
    expect(result.answer).not.toContain('Context pack:');
    expect(result.answer).not.toContain('Memory snapshot:');
  });

  it('keeps multi-page context but requires targeted passage citations in the answer', async () => {
    const generateAnswer = vi.fn(async (_messages: AiMessage[]) => ({ text: 'Evidence-backed answer.' }));
    const result = await runResearchAgent({
      sessionId: 'research-inline-citations', task: 'Compare measurements', query: 'measurement',
      filePath: 'measurements.pdf',
      content: Array.from({ length: 8 }, (_, index) => `--- Page ${index + 1} ---\nMeasurement ${index + 1}: verified result.`).join('\n'),
      compact: false, generateAnswer,
    });
    const contracts = buildCitationContracts(result.promptContext.evidenceRefs);
    expect(contracts.length).toBeGreaterThan(6);
    const messages = generateAnswer.mock.calls[0][0];
    expect(getMessageText(messages[0].content)).toContain('immediately after');
    expect(getMessageText(messages[0].content)).toContain('Do not list all available sources or context pages');
    expect(getMessageText(messages[0].content)).toContain('A PDF page without a passage anchor is context, not a precise citation');
    const sourceTable = getMessageText(messages[1].content);
    for (const contract of contracts) {
      expect(sourceTable).toContain(`citation:${contract.stableId}?quote=URL_ENCODED_EXACT_QUOTE`);
      expect(sourceTable).not.toContain(`(citation:${contract.stableId})`);
    }
  });

  it('fails synthesis without exposing context or creating artifacts when the provider fails', async () => {
    await expect(runResearchAgent({
      sessionId: 'research-session-answer-fallback',
      now: 302,
      task: 'Explain Alpha',
      query: 'What does Alpha improve?',
      content: '# Alpha\nThe result improves evidence grounding and reproducibility.',
      selection: 'The result improves evidence grounding.',
      generateAnswer: async () => {
        throw new Error('answer provider unavailable');
      },
      compact: false,
      suggestMemory: true,
    })).rejects.toThrow('answer provider unavailable');

    const session = useAgentSessionStore.getState().getSession('research-session-answer-fallback')!;
    expect(session.status).toBe('failed');
    expect(session.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'research-session-answer-fallback:synthesis-failed',
        kind: 'planning',
        metadata: expect.objectContaining({
          errorCategory: 'provider',
          errorStage: 'synthesis.answer',
        }),
      }),
    ]));
    expect(session.trace.some((event) => event.id === 'research-session-answer-fallback:synthesis')).toBe(false);
    expect(useAgentMemoryStore.getState().entries).toHaveLength(0);
    expect(useAiWorkbenchStore.getState().drafts).toHaveLength(0);
  });

  it('rejects empty synthesis and records failure instead of a successful fallback', async () => {
    await expect(runResearchAgent({
      sessionId: 'research-empty-answer', task: 'Explain the result', content: 'PRIVATE SOURCE CONTEXT',
      generateAnswer: async () => ({ text: '   ' }), compact: false,
    })).rejects.toMatchObject({ reason: 'no_progress' });
    expect(useAgentSessionStore.getState().getSession('research-empty-answer')?.status).toBe('failed');
  });

  it('validates generated workflow output before completing synthesis or executing approved artifacts', async () => {
    const validateAnswer = vi.fn(() => { throw new Error('No verified annotation quotes'); });
    await expect(runResearchAgent({
      sessionId: 'research-invalid-artifact', task: 'Highlight the key findings',
      filePath: 'paper.pdf', content: '--- Page 4 ---\nVerified experimental finding.',
      requireAnswer: true, compact: false, suggestMemory: true,
      generateAnswer: async () => ({ text: '{"annotations":[]}' }), validateAnswer,
      artifacts: { approvedByUser: true, draft: { type: 'paper_note', title: 'Invalid annotation', content: 'Must not be written', sourceRefs: [] } },
    })).rejects.toThrow('No verified annotation quotes');
    expect(validateAnswer).toHaveBeenCalledWith('{"annotations":[]}', expect.objectContaining({ prompt: expect.stringContaining('Verified experimental finding.') }), [
      expect.objectContaining({ toolName: 'lattice.resolvePathIdentity', status: 'completed', sessionId: 'research-invalid-artifact' }),
    ]);
    const session = useAgentSessionStore.getState().getSession('research-invalid-artifact')!;
    expect(session.status).toBe('failed');
    expect(session.trace.some((event) => event.metadata?.planStepId === 'synthesize-answer' && event.metadata?.planStepStatus === 'completed')).toBe(false);
    expect(session.trace.some((event) => event.tool?.toolName === 'workbench.createDraft')).toBe(false);
    expect(useAiWorkbenchStore.getState().drafts).toHaveLength(0);
    expect(useAgentMemoryStore.getState().entries).toHaveLength(0);
  });

  it('does not invent a selection from the beginning of a whole document', async () => {
    const generateAnswer = vi.fn(async () => ({ text: 'The result is supported.' }));
    const result = await runResearchAgent({
      task: 'Read this paper', filePath: 'paper.pdf',
      content: '[PDF context coverage]\n--- Page 3 ---\nThe result is supported.',
      generateAnswer, compact: false,
    });
    expect(result.promptContext.nodes.some((node) => node.kind === 'selection')).toBe(false);
  });

  it('requires a model on production calls and never returns collected source text', async () => {
    await expect(runResearchAgent({
      sessionId: 'research-required-answer', task: 'Read the paper', content: 'PRIVATE SOURCE CONTEXT',
      requireAnswer: true, compact: false,
    })).rejects.toThrow('generation is unavailable');
    expect(useAgentSessionStore.getState().getSession('research-required-answer')?.status).toBe('failed');
  });

  it('rejects an internal prompt echo as a failed answer', async () => {
    await expect(runResearchAgent({
      sessionId: 'research-echo-answer', task: 'Read the paper', content: 'PRIVATE SOURCE CONTEXT',
      generateAnswer: async () => ({ text: 'Task: Read the paper\nQuestion: Read the paper\nPRIVATE SOURCE CONTEXT' }),
      compact: false,
    })).rejects.toThrow('internal context');
    expect(useAgentSessionStore.getState().getSession('research-echo-answer')?.status).toBe('failed');
  });

  it('never restores an audit preview as the source or answer for a production run', async () => {
    const store = useAgentSessionStore.getState();
    const sessionId = 'research-production-preview';
    store.createSession({ id: sessionId, profile: 'research', task: 'Explain the result' });
    store.appendTrace(sessionId, {
      id: `${sessionId}:old-evidence`, kind: 'planning', timestamp: 1, message: 'Old evidence',
      metadata: { planStepId: 'evidence-resolve', planStepStatus: 'completed', toolName: 'evidence.resolve', resolvedPromptPreview: 'OLD AUDIT PREVIEW' },
    });
    store.appendTrace(sessionId, {
      id: `${sessionId}:synthesis`, kind: 'planning', timestamp: 2, message: 'Old synthesis',
      metadata: { answerPreview: 'Task: Old prompt dump', answerLength: 5000 },
    });
    const generateAnswer = vi.fn(async (_messages: AiMessage[]) => ({ text: 'The new measurement is 60 G.' }));
    const result = await runResearchAgent({
      sessionId, filePath: 'paper.pdf', task: 'Explain the new measurement',
      content: '--- Page 4 ---\nThe new measurement is 60 G.',
      requireAnswer: true, generateAnswer, compact: false,
    });
    expect(generateAnswer).toHaveBeenCalledOnce();
    expect(result.answer).toBe('The new measurement is 60 G.');
    expect(getMessageText(generateAnswer.mock.calls[0][0][1].content)).toContain('The new measurement is 60 G.');
    expect(result.promptContext.prompt).not.toContain('OLD AUDIT PREVIEW');
    expect(result.answer).not.toContain('Restored synthesis preview');
  });

  it('passes workflow output requirements to synthesis without leaking them as a result', async () => {
    const generateAnswer = vi.fn(async (_messages: AiMessage[]) => ({ text: 'A concise reading note.' }));
    const result = await runResearchAgent({
      task: 'Read this paper', content: 'Real evidence.',
      answerInstructions: 'Write the note in Chinese with Methods and Open questions sections.',
      generateAnswer, compact: false,
    });
    expect(getMessageText(generateAnswer.mock.calls[0][0][0].content)).toContain('Write the note in Chinese');
    expect(result.answer).toBe('A concise reading note.');
  });

  it('supplies referenced PDF pages and Markdown passages to the actual answer prompt', async () => {
    const generateAnswer = vi.fn(async (_messages: AiMessage[]) => ({ text: 'Both sources agree.' }));
    const result = await runResearchAgent({
      task: 'Compare the sources', query: 'Compare measurement', filePath: 'active.pdf',
      content: '--- Page 12 ---\nThe active measurement is 58 G.',
      references: [
        { path: 'second.pdf', content: '--- Page 4 ---\nThe second measurement is 60 G.' },
        { path: 'notes/comparison.md', content: '# Comparison\nThe difference is 2 G.' },
      ],
      generateAnswer, requireAnswer: true, compact: false,
    });
    const prompt = getMessageText(generateAnswer.mock.calls[0][0][1].content);
    expect(prompt).toContain('The second measurement is 60 G.');
    expect(prompt).toContain('The difference is 2 G.');
    expect(result.promptContext.evidenceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ locator: 'second.pdf#page=4', preview: expect.stringContaining('60 G') }),
      expect.objectContaining({ locator: 'notes/comparison.md', preview: expect.stringContaining('2 G') }),
    ]));
    expect(result.promptContext.evidenceRefs.some((ref) => ref.locator === 'second.pdf#page=12')).toBe(false);
    expect([...result.contextPack.sections, ...result.contextPack.omitted].some((item) => item.content.includes('The second measurement is 60 G.'))).toBe(true);
  });

  it('cancels synthesis without creating a completed result or memory', async () => {
    const controller = new AbortController();
    await expect(runResearchAgent({
      sessionId: 'research-cancelled-answer', task: 'Read this paper', content: 'Real evidence.',
      plannerSignal: controller.signal, suggestMemory: true, compact: false,
      generateAnswer: async () => {
        controller.abort();
        return { text: 'Late model result.' };
      },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(useAgentSessionStore.getState().getSession('research-cancelled-answer')?.status).toBe('cancelled');
    expect(useAgentMemoryStore.getState().entries).toHaveLength(0);
  });

  it('applies named context budget profiles to the generated context pack', async () => {
    const result = await runResearchAgent({
      sessionId: 'research-session-chat-budget',
      now: 310,
      task: 'Explain Alpha briefly',
      content: '# Alpha\nAlpha improves evidence grounding.',
      selection: 'Alpha improves evidence grounding.',
      contextBudgetProfileId: 'chat',
      compact: false,
    });

    expect(result.contextPack.budget.maxTokens).toBe(3200);
    expect(result.contextPack.budget.bySource.memory).toBe(500);
    expect(result.session.contextPackId).toBe(result.contextPack.id);
  });

  it('records effective memory read filters in research trace metadata', async () => {
    useAgentMemoryStore.getState().addMemory({
      id: 'memory-filtered-1',
      scope: 'workspace',
      title: 'Workspace filtered memory Alpha',
      content: 'Use filtered memory context for Alpha workspace research.',
      source: {
        label: 'Workspace memory',
      },
      workspaceKey: 'workspace-alpha',
      candidateKind: 'finding',
      now: 120,
    });
    useAgentMemoryStore.getState().addMemory({
      id: 'memory-filtered-2',
      scope: 'workspace',
      title: 'Recent unrelated memory',
      content: 'Prefer concise export summaries for lecture slides.',
      source: {
        label: 'Workspace memory',
      },
      workspaceKey: 'workspace-alpha',
      now: 220,
    });
    useAgentMemoryStore.getState().addMemory({
      id: 'memory-filtered-3',
      scope: 'workspace',
      title: 'Filtered memory evidence',
      content: 'Filtered memory context should be prioritized when the task asks about filtered memory.',
      source: {
        label: 'Workspace memory',
      },
      workspaceKey: 'workspace-alpha',
      candidateKind: 'finding',
      now: 180,
    });

    const result = await runResearchAgent({
      sessionId: 'research-session-memory-filter',
      now: 330,
      task: 'Use filtered memory research finding',
      content: '# Alpha\nFiltered memory context.',
      selection: 'Filtered memory context.',
      memoryQuery: {
        scopes: ['workspace', 'conversation'],
        workspaceKey: 'workspace-alpha',
        conversationId: 'conversation-alpha',
        limit: 2,
      },
      compact: false,
    });

    expect(result.memorySnapshotIds).toEqual(['memory-filtered-1', 'memory-filtered-3']);
    expect(result.answer).not.toContain('Memory health:');
    expect(JSON.stringify(result.session.trace)).toContain('memory-filtered-1:weak:review');
    expect(result.session.trace.find((event) => event.id === 'research-session-memory-filter:context-pack')).toMatchObject({
      metadata: expect.objectContaining({
        memoryCount: 2,
        memoryQueryScopes: 'workspace,conversation',
        memoryQueryWorkspaceKey: 'workspace-alpha',
        memoryQueryConversationId: 'conversation-alpha',
        memoryQueryLimit: 2,
        memoryCandidateCount: 3,
        memoryRankingQueryPreview: expect.stringContaining('Use filtered memory research finding'),
        memoryRankedPreview: expect.stringMatching(/memory-filtered-1.*kind:finding|kind:finding.*memory-filtered-1/),
        memoryLifecycleSummary: 'weak=2',
        memoryLifecyclePreview: expect.stringContaining('memory-filtered-1:weak:review'),
        omittedContextRecoveryHints: expect.any(String),
      }),
    });
    expect(result.session.trace.find((event) => event.id === 'research-session-memory-filter:memory-snapshot')).toMatchObject({
      metadata: expect.objectContaining({
        memoryCount: 2,
        memoryIdsPreview: 'memory-filtered-1,memory-filtered-3',
        memoryQueryScopes: 'workspace,conversation',
        memoryQueryWorkspaceKey: 'workspace-alpha',
        memoryQueryConversationId: 'conversation-alpha',
        memoryQueryLimit: 2,
        memoryCandidateCount: 3,
        memoryRankedPreview: expect.stringMatching(/memory-filtered-1.*kind:finding|kind:finding.*memory-filtered-1/),
        memoryLifecycleSummary: 'weak=2',
        memoryLifecyclePreview: expect.stringContaining('memory-filtered-1:weak:review'),
      }),
    });
  });

  it('adds optional model omitted summaries to planner context and trace with safe fallback', async () => {
    const planner = vi.fn(async () => ({
      text: JSON.stringify({
        steps: [
          { id: 'context-pack', title: 'Build context pack', type: 'context' },
          { id: 'evidence-resolve', title: 'Resolve evidence', type: 'tool', tool: 'evidence.resolve' },
          { id: 'synthesize-answer', title: 'Synthesize answer', type: 'synthesis' },
        ],
      }),
    }));
    const generateOmittedSummary = vi.fn(async () => 'Model omitted summary: Beta and Gamma context were omitted but should guide follow-up reads.');

    const generated = await runResearchAgent({
      sessionId: 'research-session-model-omitted-summary',
      contextPackId: 'research-pack-model-omitted-summary',
      now: 335,
      task: 'Summarize Alpha with omitted context',
      content: '# Alpha\nAlpha included.',
      selection: 'Alpha included.',
      query: 'How should omitted context be handled?',
      workspaceKey: 'workspace-model-summary',
      workspaceIndex: {
        files: new Map([
          ['notes/beta.md', {
            path: 'notes/beta.md',
            name: 'beta.md',
            extension: '.md',
            size: 200,
            summary: 'Beta omitted context should be summarized.',
            headings: ['Beta'],
            lastModified: 300,
          }],
          ['notes/gamma.md', {
            path: 'notes/gamma.md',
            name: 'gamma.md',
            extension: '.md',
            size: 220,
            summary: 'Gamma omitted context should be recovered.',
            headings: ['Gamma'],
            lastModified: 301,
          }],
        ]),
        lastFullIndex: 301,
        version: 9,
      },
      contextBudget: {
        maxTokens: 160,
        bySource: {
          selection: 80,
          active_file: 40,
          workspace_chunk: 30,
          memory: 10,
        },
      },
      compact: false,
      generatePlan: planner,
      generateOmittedSummary,
    });

    expect(generateOmittedSummary).toHaveBeenCalledWith(expect.objectContaining({
      contextPackId: 'research-pack-model-omitted-summary',
      omittedContextCount: expect.any(Number),
      omittedAutoSummary: expect.stringContaining('workspace_chunk'),
    }));
    expect(generated.plannerPrompt).toContain('Omitted context model summary');
    expect(generated.plannerPrompt).toContain('Model omitted summary: Beta and Gamma context were omitted');
    expect(generated.answer).toContain('尚未生成答复');
    expect(generated.answer).not.toContain('Model omitted summary:');
    expect(generated.session.trace.find((event) => event.id === 'research-session-model-omitted-summary:context-pack')).toMatchObject({
      metadata: expect.objectContaining({
        omittedContextModelSummary: 'Model omitted summary: Beta and Gamma context were omitted but should guide follow-up reads.',
        omittedContextModelSummaryStatus: 'generated',
        omittedContextModelSummaryWarning: null,
        omittedContextModelSummaryQualityStatus: expect.stringMatching(/healthy|partial|weak/),
        omittedContextModelSummaryQualityScore: expect.any(Number),
        omittedContextModelSummaryQualitySummary: expect.stringContaining('score='),
      }),
    });

    const failed = await runResearchAgent({
      sessionId: 'research-session-model-omitted-summary-fallback',
      contextPackId: 'research-pack-model-omitted-summary-fallback',
      now: 336,
      task: 'Fallback omitted summary',
      content: '# Alpha\nAlpha included.',
      selection: 'Alpha included.',
      query: 'Handle omitted fallback',
      workspaceKey: 'workspace-model-summary-fallback',
      workspaceIndex: {
        files: new Map([
          ['notes/delta.md', {
            path: 'notes/delta.md',
            name: 'delta.md',
            extension: '.md',
            size: 200,
            summary: 'Delta omitted context should remain deterministic on failure.',
            headings: ['Delta'],
            lastModified: 302,
          }],
        ]),
        lastFullIndex: 302,
        version: 10,
      },
      contextBudget: {
        maxTokens: 120,
        bySource: {
          selection: 60,
          active_file: 30,
          workspace_chunk: 20,
          memory: 10,
        },
      },
      compact: false,
      generatePlan: planner,
      generateOmittedSummary: vi.fn(async () => {
        throw new Error('summary provider offline');
      }),
    });

    expect(failed.plannerPrompt).not.toContain('Omitted context model summary');
    expect(failed.session.trace.find((event) => event.id === 'research-session-model-omitted-summary-fallback:context-pack')).toMatchObject({
      metadata: expect.objectContaining({
        omittedContextModelSummary: null,
        omittedContextModelSummaryStatus: 'failed',
        omittedContextModelSummaryWarning: expect.stringContaining('summary provider offline'),
        omittedContextModelSummaryQualityStatus: 'failed',
        omittedContextModelSummaryQualityScore: 0,
        omittedContextModelSummaryQualitySummary: 'failed / generation_failed',
        omittedContextAutoSummary: expect.any(String),
      }),
    });
  });

  it('can generate memory candidates as approval-gated writes without silently saving them', async () => {
    const result = await runResearchAgent({
      sessionId: 'research-session-memory-suggestion',
      now: 320,
      task: 'Capture reusable Alpha finding',
      generateAnswer: async () => ({ text: 'Alpha improves evidence grounding and reproducibility.' }),
      filePath: 'notes/alpha.md',
      content: '# Alpha\nAlpha improves evidence grounding for reading notes.',
      selection: 'Alpha improves evidence grounding for reading notes.',
      query: 'What reusable finding should be remembered?',
      workspaceKey: 'workspace-memory',
      compact: false,
      suggestMemory: true,
    });

    expect(result.memorySuggestionResults).toEqual([
      expect.objectContaining({
        status: 'requires_approval',
        toolName: 'memory.write',
      }),
    ]);
    expect(result.approvalSummary).toMatchObject({
      status: 'waiting_approval',
      totalApprovals: 1,
      pendingApprovals: 1,
      pendingToolNames: ['memory.write'],
    });
    expect(result.session.trace.find((event) => event.id === 'research-session-memory-suggestion:memory-suggestion-evaluated')).toMatchObject({
      metadata: expect.objectContaining({
        memorySuggestionStatus: 'accepted',
        memorySuggestionReasonCode: 'accepted',
        memorySuggestionConfidence: expect.any(Number),
        memorySuggestionPolicyDecision: expect.stringMatching(/approve|review/),
        memorySuggestionPolicySummary: expect.stringContaining('adjusted='),
        memorySuggestionPolicyReasons: expect.any(String),
        memorySuggestionCandidateKind: 'finding',
        memorySuggestionScope: 'workspace',
        memorySuggestionContextPackId: result.contextPack.id,
        memorySuggestionOmittedContextCount: expect.any(Number),
        memorySuggestionApplicability: expect.stringContaining('Workspace: workspace-memory'),
        memorySuggestionEvidenceSummary: expect.stringContaining(result.contextPack.id),
        memorySuggestionCaution: 'Approve only if this finding should influence future research runs in the shown scope.',
        memorySuggestionAnswerPreview: expect.stringContaining('Alpha improves evidence grounding and reproducibility.'),
      }),
    });
    const pendingApproval = result.session.pendingApprovals.find((approval) => approval.toolName === 'memory.write');
    expect(pendingApproval?.request.args).toMatchObject({
      review: {
        candidateKind: 'finding',
        applicability: expect.stringContaining('Workspace: workspace-memory'),
        evidenceSummary: expect.stringContaining(result.contextPack.id),
        policySummary: expect.stringContaining('adjusted='),
        policyReasons: expect.any(Array),
        caution: 'Approve only if this finding should influence future research runs in the shown scope.',
      },
    });
    expect(useAgentMemoryStore.getState().entries).toHaveLength(0);
    expect(result.session.status).toBe('waiting_approval');

    const approvalId = result.memorySuggestionResults[0]?.approvalRequestId;
    expect(approvalId).toBeTruthy();
    const approved = await approveAgentToolRequest(approvalId!);

    expect(approved).toMatchObject({
      status: 'completed',
      toolName: 'memory.write',
    });
    expect(useAgentMemoryStore.getState().entries).toEqual([
      expect.objectContaining({
        scope: 'workspace',
        title: expect.stringContaining('What reusable finding'),
        candidateKind: 'finding',
        content: expect.stringContaining('Finding: Alpha improves evidence grounding and reproducibility.'),
        source: expect.objectContaining({
          fingerprint: expect.stringMatching(/^mem-src-/),
        }),
        status: 'active',
      }),
    ]);
    expect(useAgentMemoryStore.getState().entries[0]?.content).toContain('Context pack:');
    const memoryId = useAgentMemoryStore.getState().entries[0]?.id;
    expect(useAgentSessionStore.getState().getSession(result.sessionId)?.memorySnapshotIds).toContain(memoryId);

    const reconciled = reconcileResearchAgentPendingApprovals({
      sessionId: result.sessionId,
      planSteps: result.planSteps,
      compact: false,
    });
    expect(reconciled.finalized).toBe(true);
    expect(reconciled.session.status).toBe('completed');
    expect(reconciled.planSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'memory-write', status: 'completed' }),
      ]),
    );
  });

  it('skips duplicate memory candidates with traceable reasons', async () => {
    useAgentMemoryStore.getState().addMemory({
      id: 'memory-duplicate-alpha',
      scope: 'workspace',
      title: 'Markdown Research: What reusable finding should be remembered?',
      content: 'Alpha improves evidence grounding for reading notes.',
      source: {
        label: 'Research Agent suggestion',
        locator: 'agent-session://older-run',
      },
      workspaceKey: 'workspace-memory',
      now: 100,
    });

    const result = await runResearchAgent({
      sessionId: 'research-session-memory-duplicate',
      now: 320,
      task: 'Capture reusable Alpha finding',
      generateAnswer: async () => ({ text: 'Alpha improves evidence grounding and reproducibility.' }),
      filePath: 'notes/alpha.md',
      content: '# Alpha\nAlpha improves evidence grounding for reading notes.',
      selection: 'Alpha improves evidence grounding for reading notes.',
      query: 'What reusable finding should be remembered?',
      workflowTitle: 'Markdown Research',
      workspaceKey: 'workspace-memory',
      compact: false,
      suggestMemory: true,
    });

    const evaluationTrace = result.session.trace.find((event) =>
      event.id === 'research-session-memory-duplicate:memory-suggestion-evaluated',
    );

    expect(result.memorySuggestionResults).toEqual([]);
    expect(result.approvalSummary.status).toBe('none');
    expect(useAgentMemoryStore.getState().entries).toHaveLength(1);
    expect(evaluationTrace).toMatchObject({
      metadata: expect.objectContaining({
        memorySuggestionStatus: 'skipped',
        memorySuggestionReasonCode: 'duplicate_title',
        memorySuggestionReason: expect.any(String),
        memorySuggestionDuplicateMemoryId: 'memory-duplicate-alpha',
      }),
    });
  });

  it('keeps draft creation approval-gated for research runs', async () => {
    const result = await runResearchAgent({
      sessionId: 'research-session-draft',
      now: 400,
      task: 'Create a reading note draft',
      filePath: 'notes/beta.md',
      content: '# Beta\nDraftable finding.',
      selection: 'Draftable finding.',
      compact: true,
      artifacts: {
        draft: {
          type: 'paper_note',
          title: 'Beta Reading Note',
          sourceRefs: [],
          content: 'Evidence-backed note body.',
          targetPath: 'AI Drafts/Beta Reading Note.md',
        },
      },
    });

    expect(result.artifactResults[0]).toMatchObject({
      status: 'requires_approval',
      toolName: 'workbench.createDraft',
    });
    expect(result.planSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'context-pack', status: 'completed' }),
        expect.objectContaining({ id: 'evidence-resolve', status: 'completed' }),
        expect.objectContaining({ id: 'synthesize-answer', status: 'completed' }),
        expect.objectContaining({ id: 'create-draft', status: 'blocked', toolName: 'workbench.createDraft' }),
        expect.objectContaining({ id: 'compact-session', status: 'pending' }),
      ]),
    );
    expect(result.session.status).toBe('waiting_approval');
    expect(result.session.pendingApprovals[0]).toMatchObject({
      status: 'pending',
      toolName: 'workbench.createDraft',
    });
    expect(result.approvalSummary).toMatchObject({
      status: 'waiting_approval',
      totalApprovals: 1,
      pendingApprovals: 1,
      completedApprovals: 0,
      pendingToolNames: ['workbench.createDraft'],
    });
    expect(result.session.compactions).toEqual([]);
    expect(result.session.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'planning',
          metadata: expect.objectContaining({
            planStepId: 'create-draft',
            planStepStatus: 'blocked',
          }),
        }),
      ]),
    );
    expect(useAiWorkbenchStore.getState().drafts).toEqual([]);
  });

  it('finalizes a paused research run after approved artifact tools complete', async () => {
    const paused = await runResearchAgent({
      sessionId: 'research-session-draft-resume',
      now: 450,
      task: 'Create and resume a reading note draft',
      filePath: 'notes/resume.md',
      content: '# Resume\nArtifact approval should resume cleanly.',
      selection: 'Artifact approval should resume cleanly.',
      compact: true,
      artifacts: {
        draft: {
          type: 'paper_note',
          title: 'Resume Reading Note',
          sourceRefs: [],
          content: 'Approved note body.',
          targetPath: 'AI Drafts/Resume Reading Note.md',
        },
      },
    });

    const approvalId = paused.artifactResults[0]?.approvalRequestId;
    expect(approvalId).toBeTruthy();

    const beforeApproval = finalizeResearchAgentApprovedArtifacts({
      sessionId: 'research-session-draft-resume',
      planSteps: paused.planSteps,
      compact: true,
      now: 460,
    });
    expect(beforeApproval).toMatchObject({
      finalized: false,
      compacted: false,
      pendingApprovalIds: [approvalId],
    });
    expect(beforeApproval.session.status).toBe('waiting_approval');

    const approved = await approveAgentToolRequest(approvalId!);
    expect(approved.status).toBe('completed');
    expect(useAiWorkbenchStore.getState().drafts[0]).toMatchObject({
      title: 'Resume Reading Note',
      status: 'draft',
    });

    const finalized = finalizeResearchAgentApprovedArtifacts({
      sessionId: 'research-session-draft-resume',
      planSteps: paused.planSteps,
      compact: true,
      maxTraceEvents: 8,
      retainRecentEvents: 4,
      now: 470,
    });

    expect(finalized).toMatchObject({
      finalized: true,
      compacted: true,
      completedApprovalIds: [approvalId],
      pendingApprovalIds: [],
      failedApprovalIds: [],
    });
    expect(finalized.planSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'create-draft', status: 'completed' }),
        expect.objectContaining({ id: 'compact-session', status: 'completed' }),
      ]),
    );
    expect(finalized.session.status).toBe('completed');
    expect(finalized.session.result).toContain('Research agent completed after 1 approved artifact tool');
    expect(finalized.session.compactions[0]).toMatchObject({
      id: 'research-session-draft-resume:compaction',
    });
    expect(finalized.session.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'planning',
          metadata: expect.objectContaining({
            planStepId: 'create-draft',
            planStepStatus: 'completed',
          }),
        }),
        expect.objectContaining({ kind: 'completed' }),
      ]),
    );
  });

  it('reconciles non-artifact approved tools without rerunning research work', async () => {
    const sessionId = createAgentToolSession({
      profile: 'research',
      task: 'Run approved code and reconcile the research session',
      title: 'Code approval reconciliation',
    });
    const blocked = await executeAgentTool({
      name: 'runner.runCode',
      args: { language: 'javascript', code: '2 + 2' },
    }, {
      sessionId,
      runCode: async () => ({ output: '4' }),
    });

    expect(blocked.status).toBe('requires_approval');
    useAgentSessionStore.getState().appendTrace(sessionId, {
      id: `${sessionId}:synthesis`,
      kind: 'planning',
      timestamp: 470,
      message: 'Prepared research synthesis from context pack, memory, and resolved evidence.',
      metadata: {
        answerLength: 38,
        answerPreview: 'Approved run has prior synthesis.',
      },
    });
    const beforeApproval = reconcileResearchAgentPendingApprovals({
      sessionId,
      compact: true,
      now: 480,
    });
    expect(beforeApproval).toMatchObject({
      finalized: false,
      pendingApprovalIds: [blocked.approvalRequestId],
      completedApprovalIds: [],
    });
    expect(beforeApproval.session.status).toBe('waiting_approval');

    const approved = await approveAgentToolRequest(blocked.approvalRequestId!, {
      runCode: async () => ({ output: '4' }),
    });
    expect(approved).toMatchObject({
      status: 'completed',
      resultPreview: '4',
      resultMetadata: expect.objectContaining({
        resultKind: 'runner.runCode',
        outputPreview: '4',
      }),
    });

    const reconciled = reconcileResearchAgentPendingApprovals({
      sessionId,
      compact: true,
      maxTraceEvents: 8,
      retainRecentEvents: 4,
      now: 490,
    });

    expect(reconciled).toMatchObject({
      finalized: true,
      compacted: true,
      pendingApprovalIds: [],
      completedApprovalIds: [blocked.approvalRequestId],
      reconciledApprovalIds: [blocked.approvalRequestId],
      failedApprovalIds: [],
    });
    expect(reconciled.planSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'run-code', status: 'completed', toolName: 'runner.runCode' }),
        expect.objectContaining({ id: 'compact-session', status: 'completed' }),
      ]),
    );
    expect(reconciled.session.status).toBe('completed');
    expect(reconciled.session.result).toContain('Research agent completed after 1 approved tool and restored synthesis context');
    expect(reconciled.session.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'planning',
          metadata: expect.objectContaining({
            planStepId: 'run-code',
            planStepStatus: 'completed',
            toolName: 'runner.runCode',
            approvalId: blocked.approvalRequestId,
            resultPreview: '4',
            restoredSynthesisPreview: 'Approved run has prior synthesis.',
          }),
        }),
        expect.objectContaining({
          kind: 'tool_result',
          metadata: expect.objectContaining({
            resultKind: 'runner.runCode',
            resultPreview: '4',
          }),
        }),
        expect.objectContaining({ kind: 'completed' }),
      ]),
    );
  });

  it('uses valid planner output as a custom research plan', async () => {
    const result = await runResearchAgent({
      sessionId: 'research-session-planner-output',
      now: 500,
      task: 'Use planner output',
      filePath: 'notes/gamma.md',
      content: '# Gamma\nPlanner output should shape the run.',
      selection: 'Planner output should shape the run.',
      compact: false,
      continuation: {
        sourceSessionId: 'source-session-gamma',
        compactionId: 'source-compaction-gamma',
        sourceSummary: 'Gamma compacted summary.',
      },
      plannerOutput: JSON.stringify({
        steps: [
          {
            id: 'context-pack',
            title: 'Collect Gamma context',
            description: 'Collect the Gamma context pack.',
          },
          {
            id: 'evidence-resolve',
            title: 'Resolve Gamma evidence',
            description: 'Resolve evidence through Tool Broker.',
            toolName: 'evidence.resolve',
          },
          {
            id: 'synthesize-answer',
            title: 'Synthesize Gamma answer',
            description: 'Write the grounded Gamma synthesis.',
          },
        ],
      }),
    });

    expect(result.planSource).toBe('custom');
    expect(result.planWarnings).toEqual([]);
    expect(result.planSteps).toEqual([
      expect.objectContaining({ id: 'context-pack', title: 'Collect Gamma context', status: 'completed' }),
      expect.objectContaining({ id: 'evidence-resolve', title: 'Resolve Gamma evidence', status: 'completed' }),
      expect.objectContaining({ id: 'synthesize-answer', title: 'Synthesize Gamma answer', status: 'completed' }),
    ]);
    expect(result.session.trace.find((event) => event.id === 'research-session-planner-output:plan-created')).toMatchObject({
      metadata: expect.objectContaining({
        agentKind: 'research_agent',
        planSource: 'custom',
        planWarningCount: 0,
        continuationSourceSessionId: 'source-session-gamma',
        continuationCompactionId: 'source-compaction-gamma',
        continuationSourceSummary: 'Gamma compacted summary.',
      }),
    });
    expect(result.continuation).toMatchObject({
      sourceSessionId: 'source-session-gamma',
      compactionId: 'source-compaction-gamma',
    });
  });

  it('reports unsupported scheduled execution without leaving an impossible approval', async () => {
    const result = runResearchAgent({
      sessionId: 'research-session-scheduled-plan',
      now: 510,
      task: 'Schedule a digest',
      filePath: 'notes/scheduled.md',
      content: 'Schedule a digest from this note.',
      compact: false,
      plannerOutput: JSON.stringify({ steps: [
        { id: 'context-pack', title: 'Collect context', description: 'Collect context.' },
        { id: 'evidence-resolve', title: 'Resolve evidence', description: 'Resolve evidence.' },
        { id: 'schedule-task', title: 'Schedule digest', description: 'Create an approved recurring digest.', toolName: 'schedule_task', toolArgs: { title: 'Daily digest', prompt: 'Summarize notes', schedule: { kind: 'interval', everyMs: 60000 } } },
        { id: 'synthesize-answer', title: 'Write answer', description: 'Write answer.' },
      ] }),
    });

    await expect(result).rejects.toThrow('Scheduled AI execution is unavailable in this version.');
    const session = useAgentSessionStore.getState().getSession('research-session-scheduled-plan');
    expect(session?.status).toBe('failed');
    expect(session?.pendingApprovals).toEqual([]);
    expect(session?.error).toContain('unavailable in this version');
  });

  it('restores continuation evidence and recovery hints into the next context pack', async () => {
    const store = useAgentSessionStore.getState();
    store.createSession({
      id: 'source-session-recovery',
      profile: 'research',
      task: 'Recover prior Alpha research',
      title: 'Alpha recovery source',
      evidenceRefs: [
        {
          kind: 'file',
          label: 'Alpha retained source',
          locator: 'notes/alpha-retained.md',
        },
      ],
      now: 520,
    });
    store.appendTrace('source-session-recovery', {
      id: 'source-session-recovery:context-pack',
      kind: 'planning',
      timestamp: 521,
      message: 'Built previous context pack.',
      metadata: {
        omittedContextAutoSummary: 'workspace_chunk: 1 omitted item / 620 tokens / labels=Alpha omitted detail / keywords=alpha, result / examples=Alpha omitted detail: omitted result detail',
        omittedContextRecoveryHints: 'workspace_chunk: Alpha omitted detail @ notes/alpha-omitted.md (620 tokens) - omitted result detail',
        omittedContextRecoveryPriority: 'workspace_chunk: Alpha omitted detail @ notes/alpha-omitted.md score=123 (priority=80,source=workspace_chunk,tokens=620,locator)',
        omittedContextRecoveryPlan: '1. read_indexed_context | workspace_chunk: Alpha omitted detail @ notes/alpha-omitted.md | reason=budget_limited:workspace_chunk | score=123 | preview=omitted result detail',
        omittedContextModelSummary: 'Model summary: Alpha omitted detail supports the next recovery read.',
        omittedContextSemanticPreview: 'workspace_chunk: Alpha omitted semantic preview',
      },
    });
    store.appendTrace('source-session-recovery', {
      id: 'source-session-recovery:tool-result',
      kind: 'tool_result',
      timestamp: 522,
      message: 'Resolved prior evidence.',
      evidenceRefs: [
        {
          kind: 'file',
          label: 'Alpha compacted evidence',
          locator: 'notes/alpha-compacted.md',
        },
      ],
    });
    store.appendTrace('source-session-recovery', {
      id: 'source-session-recovery:planning-extra',
      kind: 'planning',
      timestamp: 523,
      message: 'Planned prior recovery step.',
    });
    store.appendTrace('source-session-recovery', {
      id: 'source-session-recovery:context-extra',
      kind: 'context_resolved',
      timestamp: 524,
      message: 'Resolved extra prior context.',
    });
    store.compactSession('source-session-recovery', {
      id: 'source-compaction-recovery',
      summary: 'Alpha prior research was compacted with omitted recovery hints.',
      maxTraceEvents: 3,
      retainRecentEvents: 1,
      now: 530,
    });

    const planner = vi.fn(async () => ({
      text: JSON.stringify({
        steps: [
          { id: 'context-pack', title: 'Build context pack', type: 'context' },
          { id: 'evidence-resolve', title: 'Resolve evidence', type: 'tool', tool: 'evidence.resolve' },
          { id: 'synthesize-answer', title: 'Synthesize answer', type: 'synthesis' },
        ],
      }),
    }));

    const result = await runResearchAgent({
      sessionId: 'research-session-continuation-recovery',
      now: 540,
      task: 'Continue Alpha research',
      filePath: 'notes/alpha-next.md',
      content: '# Alpha Next\nContinue the next step.',
      selection: 'Continue the next step.',
      explicitEvidenceRefs: [
        {
          kind: 'file',
          label: 'Current explicit evidence',
          locator: 'notes/current.md',
        },
      ],
      continuation: {
        sourceSessionId: 'source-session-recovery',
        compactionId: 'source-compaction-recovery',
        sourceSummary: 'Alpha compacted summary from chat.',
      },
      compact: false,
      suggestMemory: true,
      generatePlan: planner,
    });

    expect(result.contextPack.evidenceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ locator: 'notes/current.md' }),
        expect.objectContaining({ locator: 'notes/alpha-retained.md' }),
        expect.objectContaining({ locator: 'notes/alpha-compacted.md' }),
      ]),
    );
    expect(result.contextPack.prompt).toContain('Continuation recovery context');
    expect(result.contextPack.prompt).toContain('Alpha prior research was compacted with omitted recovery hints.');
    expect(result.contextPack.prompt).toContain('Prior omitted auto summary: workspace_chunk: 1 omitted item');
    expect(result.contextPack.prompt).toContain('Prior omitted model summary: Model summary: Alpha omitted detail supports the next recovery read.');
    expect(result.contextPack.prompt).toContain('Alpha omitted detail');
    expect(result.plannerPrompt).toContain('Recovered omitted hints: workspace_chunk: Alpha omitted detail');
    expect(result.plannerPrompt).toContain('Recovered omitted recovery priority: workspace_chunk: Alpha omitted detail');
    expect(result.plannerPrompt).toContain('Recovered omitted recovery plan: 1. read_indexed_context');
    expect(result.contextPack.prompt).toContain('Prior omitted semantic preview: workspace_chunk: Alpha omitted semantic preview');
    expect(result.planSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'recover-omitted-context-1',
          status: 'completed',
          toolName: 'workspace.readIndexedContext',
          toolArgs: {
            paths: ['notes/alpha-omitted.md'],
          },
        }),
      ]),
    );
    expect(result.toolObservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 'recover-omitted-context-1',
          toolName: 'workspace.readIndexedContext',
          status: 'completed',
          purpose: 'recovery_read',
          recoveryLocator: 'notes/alpha-omitted.md',
        }),
      ]),
    );
    expect(result.answer).not.toContain('Recovered omitted context digest:');
    expect(result.answer).toContain('尚未生成答复');
    expect(result.session.trace.find((event) => event.id === 'research-session-continuation-recovery:observation-replan')).toMatchObject({
      metadata: expect.objectContaining({
        observationCount: 2,
        recoveryObservationCount: 1,
        recoveryObservationLocatorsPreview: 'notes/alpha-omitted.md',
        recoveryQualityStatus: 'weak',
        recoveryQualitySummary: 'weak / planned=1 / observed=1 / covered=1 / lowValue=1',
        observationsPreview: expect.stringContaining('purpose=recovery_read, locator=notes/alpha-omitted.md'),
      }),
    });
    expect(result.session.trace.find((event) => event.id === 'research-session-continuation-recovery:synthesis')).toMatchObject({
      metadata: expect.objectContaining({
        recoveryObservationCount: 1,
        recoveryObservationLocatorsPreview: 'notes/alpha-omitted.md',
        recoveryObservationPreview: expect.stringContaining('workspace.readIndexedContext @ notes/alpha-omitted.md'),
        recoveredContextDigestSummary: 'Recovered omitted context: 1 read / completed=1 / useful=0 / lowValue=1 / locators=notes/alpha-omitted.md',
        recoveredContextDigestAnswerPreview: expect.stringContaining('workspace.readIndexedContext @ notes/alpha-omitted.md'),
        recoveredContextUsefulCount: 0,
        recoveredContextLowValueCount: 1,
        recoveryQualityStatus: 'weak',
        recoveryQualitySummary: 'weak / planned=1 / observed=1 / covered=1 / lowValue=1',
      }),
    });
    expect(result.session.trace.find((event) => event.id === 'research-session-continuation-recovery:memory-suggestion-evaluated')).toMatchObject({
      metadata: expect.objectContaining({
        memorySuggestionStatus: 'accepted',
        memorySuggestionRecoveryObservationCount: 1,
        memorySuggestionRecoveryObservationPreview: expect.stringContaining('workspace.readIndexedContext @ notes/alpha-omitted.md'),
        memorySuggestionRecoveredContextDigest: 'Recovered omitted context: 1 read / completed=1 / useful=0 / lowValue=1 / locators=notes/alpha-omitted.md',
      }),
    });
    expect(result.memorySuggestionResults).toEqual([
      expect.objectContaining({
        status: 'requires_approval',
        toolName: 'memory.write',
      }),
    ]);
    expect(result.session.trace.find((event) => event.id === 'research-session-continuation-recovery:plan-created')).toMatchObject({
      metadata: expect.objectContaining({
        continuationRecoverySummary: 'Alpha prior research was compacted with omitted recovery hints.',
        continuationRecoveredEvidenceCount: 2,
        continuationRecoveryHintsPreview: 'workspace_chunk: Alpha omitted detail @ notes/alpha-omitted.md (620 tokens) - omitted result detail',
        continuationRecoveryPriorityPreview: 'workspace_chunk: Alpha omitted detail @ notes/alpha-omitted.md score=123 (priority=80,source=workspace_chunk,tokens=620,locator)',
        continuationRecoveryPlanPreview: '1. read_indexed_context | workspace_chunk: Alpha omitted detail @ notes/alpha-omitted.md | reason=budget_limited:workspace_chunk | score=123 | preview=omitted result detail',
        continuationRecoveryAutoSummaryPreview: 'workspace_chunk: 1 omitted item / 620 tokens / labels=Alpha omitted detail / keywords=alpha, result / examples=Alpha omitted detail: omitted result detail',
        continuationRecoveryModelSummaryPreview: 'Model summary: Alpha omitted detail supports the next recovery read.',
        continuationRecoveryReadPathCount: 1,
        continuationRecoveryReadPathsPreview: 'notes/alpha-omitted.md',
        continuationRecoverySemanticPreview: 'workspace_chunk: Alpha omitted semantic preview',
      }),
    });
    expect(result.session.trace.find((event) => event.id === 'research-session-continuation-recovery:continuation-recovery-read-plan')).toMatchObject({
      metadata: expect.objectContaining({
        continuationRecoveryReadPathCount: 1,
        continuationRecoveryReadPathsPreview: 'notes/alpha-omitted.md',
        continuationRecoveryPlanPreview: '1. read_indexed_context | workspace_chunk: Alpha omitted detail @ notes/alpha-omitted.md | reason=budget_limited:workspace_chunk | score=123 | preview=omitted result detail',
        continuationRecoveryAutoSummaryPreview: 'workspace_chunk: 1 omitted item / 620 tokens / labels=Alpha omitted detail / keywords=alpha, result / examples=Alpha omitted detail: omitted result detail',
        continuationRecoveryModelSummaryPreview: 'Model summary: Alpha omitted detail supports the next recovery read.',
      }),
    });
    expect(result.session.trace.find((event) => event.id === 'research-session-continuation-recovery:context-pack')).toMatchObject({
      metadata: expect.objectContaining({
        continuationRecoveryIncluded: true,
        continuationRecoveredEvidenceCount: 2,
        continuationRecoveryHintsPreview: 'workspace_chunk: Alpha omitted detail @ notes/alpha-omitted.md (620 tokens) - omitted result detail',
        continuationRecoveryPriorityPreview: 'workspace_chunk: Alpha omitted detail @ notes/alpha-omitted.md score=123 (priority=80,source=workspace_chunk,tokens=620,locator)',
        continuationRecoveryPlanPreview: '1. read_indexed_context | workspace_chunk: Alpha omitted detail @ notes/alpha-omitted.md | reason=budget_limited:workspace_chunk | score=123 | preview=omitted result detail',
        continuationRecoveryAutoSummaryPreview: 'workspace_chunk: 1 omitted item / 620 tokens / labels=Alpha omitted detail / keywords=alpha, result / examples=Alpha omitted detail: omitted result detail',
        continuationRecoveryModelSummaryPreview: 'Model summary: Alpha omitted detail supports the next recovery read.',
        continuationRecoverySemanticPreview: 'workspace_chunk: Alpha omitted semantic preview',
      }),
    });
  });

  it('executes readonly planner tool steps through the controlled tool loop', async () => {
    const result = await runResearchAgent({
      sessionId: 'research-session-tool-loop',
      now: 550,
      task: 'Use planned readonly tools',
      filePath: 'notes/tool-loop.md',
      content: '# Tool Loop\nAlpha evidence should be searched before synthesis.',
      selection: 'Alpha evidence should be searched before synthesis.',
      query: 'Alpha evidence',
      compact: false,
      plannerOutput: JSON.stringify({
        steps: [
          {
            id: 'context-pack',
            title: 'Collect context',
            description: 'Collect context.',
          },
          {
            id: 'workspace-search',
            title: 'Search workspace',
            description: 'Search for related indexed context.',
            toolName: 'workspace.search',
            toolArgs: {
              query: 'Alpha evidence',
              limit: 3,
            },
          },
          {
            id: 'evidence-resolve',
            title: 'Resolve evidence',
            description: 'Resolve evidence.',
            toolName: 'evidence.resolve',
            toolArgs: {
              maxContextTokens: 1200,
            },
          },
          {
            id: 'synthesize-answer',
            title: 'Synthesize answer',
            description: 'Write answer.',
          },
        ],
      }),
    });

    expect(result.toolResults).toEqual([
      expect.objectContaining({
        status: 'completed',
        toolName: 'workspace.search',
        resultPreview: 'No matching indexed files.',
      }),
    ]);
    expect(result.toolObservations).toEqual([
      expect.objectContaining({
        stepId: 'workspace-search',
        toolName: 'workspace.search',
        status: 'completed',
        preview: 'No matching indexed files.',
      }),
    ]);
    expect(result.planSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'workspace-search', status: 'completed', toolName: 'workspace.search' }),
        expect.objectContaining({ id: 'evidence-resolve', status: 'completed', toolName: 'evidence.resolve' }),
      ]),
    );
    expect(result.answer).not.toContain('Planned tool results:');
    expect(result.answer).toContain('尚未生成答复');
    expect(result.session.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_requested',
          tool: expect.objectContaining({
            toolName: 'workspace.search',
            argumentsPreview: expect.stringContaining('"limit":3'),
          }),
        }),
        expect.objectContaining({
          kind: 'planning',
          metadata: expect.objectContaining({
            planStepId: 'workspace-search',
            planStepStatus: 'completed',
            toolName: 'workspace.search',
            resultPreview: 'No matching indexed files.',
          }),
        }),
        expect.objectContaining({
          kind: 'tool_result',
          metadata: expect.objectContaining({
            resultKind: 'workspace.search',
            resultPreview: 'No matching indexed files.',
          }),
        }),
        expect.objectContaining({
          id: 'research-session-tool-loop:synthesis',
          metadata: expect.objectContaining({
            toolObservationCount: 1,
            toolObservationsPreview: expect.stringContaining('workspace-search:workspace.search:completed'),
          }),
        }),
        expect.objectContaining({
          kind: 'tool_requested',
          tool: expect.objectContaining({
            toolName: 'evidence.resolve',
            argumentsPreview: expect.stringContaining('"maxContextTokens":1200'),
          }),
        }),
      ]),
    );
  });

  it('restores completed read-tool observations from trace and skips duplicate execution', async () => {
    const store = useAgentSessionStore.getState();
    store.createSession({
      id: 'research-session-restored-observation',
      profile: 'research',
      task: 'Resume read tool observation',
      now: 545,
    });
    store.appendTrace('research-session-restored-observation', {
      id: 'research-session-restored-observation:prior-search-completed',
      kind: 'planning',
      timestamp: 546,
      message: 'Plan step completed: Search restored workspace.',
      metadata: {
        planStepId: 'workspace-search',
        planStepStatus: 'completed',
        toolName: 'workspace.search',
        resultPreview: 'Restored workspace search preview.',
      },
    });

    const result = await runResearchAgent({
      sessionId: 'research-session-restored-observation',
      now: 550,
      task: 'Resume read tool observation',
      filePath: 'notes/restored.md',
      content: '# Restored\nUse the restored observation.',
      selection: 'Use the restored observation.',
      query: 'Restored observation',
      compact: false,
      plannerOutput: JSON.stringify({
        steps: [
          {
            id: 'context-pack',
            title: 'Collect context',
            description: 'Collect context.',
          },
          {
            id: 'workspace-search',
            title: 'Search restored workspace',
            description: 'This completed read step should be restored.',
            toolName: 'workspace.search',
            toolArgs: {
              query: 'Should not execute',
              limit: 3,
            },
          },
          {
            id: 'evidence-resolve',
            title: 'Resolve evidence',
            description: 'Resolve evidence.',
            toolName: 'evidence.resolve',
          },
          {
            id: 'synthesize-answer',
            title: 'Synthesize answer',
            description: 'Write answer.',
          },
        ],
      }),
    });

    expect(result.toolResults).toEqual([]);
    expect(result.toolObservations).toEqual([
      expect.objectContaining({
        stepId: 'workspace-search',
        toolName: 'workspace.search',
        status: 'completed',
        preview: 'Restored workspace search preview.',
        metadataPreview: expect.stringContaining('restored=true'),
      }),
    ]);
    expect(result.session.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Skipped completed plan step from restored observation: Search restored workspace.',
          metadata: expect.objectContaining({
            planStepId: 'workspace-search',
            planStepStatus: 'completed',
            toolName: 'workspace.search',
            resultPreview: 'Restored workspace search preview.',
          }),
        }),
      ]),
    );
    expect(result.session.trace).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_requested',
          tool: expect.objectContaining({
            toolName: 'workspace.search',
          }),
        }),
      ]),
    );
  });

  it('restores completed evidence context from trace and skips duplicate evidence resolution', async () => {
    const store = useAgentSessionStore.getState();
    store.createSession({
      id: 'research-session-restored-evidence',
      profile: 'research',
      task: 'Resume evidence context',
      now: 555,
    });
    store.appendTrace('research-session-restored-evidence', {
      id: 'research-session-restored-evidence:evidence-completed',
      kind: 'planning',
      timestamp: 556,
      message: 'Completed plan step: Resolve evidence.',
      evidenceRefs: [
        {
          kind: 'file',
          label: 'restored.md',
          locator: 'notes/restored.md',
        },
      ],
      metadata: {
        planStepId: 'evidence-resolve',
        planStepStatus: 'completed',
        toolName: 'evidence.resolve',
        resultPreview: '1 context node, 1 evidence ref.',
        resolvedPromptPreview: 'Restored evidence prompt preview.',
        resolvedContextNodeCount: 1,
        resolvedEvidenceCount: 1,
      },
    });

    const result = await runResearchAgent({
      sessionId: 'research-session-restored-evidence',
      now: 560,
      task: 'Resume evidence context',
      filePath: 'notes/restored-evidence.md',
      content: '# Restored Evidence\nThis should use restored evidence.',
      selection: 'This should use restored evidence.',
      query: 'Restored evidence',
      compact: false,
      plannerOutput: JSON.stringify({
        steps: [
          {
            id: 'context-pack',
            title: 'Collect context',
            description: 'Collect context.',
          },
          {
            id: 'evidence-resolve',
            title: 'Resolve evidence',
            description: 'This completed evidence step should be restored.',
            toolName: 'evidence.resolve',
            toolArgs: {
              query: 'Should not resolve again',
            },
          },
          {
            id: 'synthesize-answer',
            title: 'Synthesize answer',
            description: 'Write answer.',
          },
        ],
      }),
    });

    expect(result.promptContext.prompt).toContain('[Restored evidence context from prior Research Agent trace]');
    expect(result.promptContext.prompt).toContain('Restored evidence prompt preview.');
    expect(result.promptContext.evidenceRefs).toEqual([
      expect.objectContaining({ locator: 'notes/restored.md' }),
    ]);
    expect(result.answer).not.toContain('Restored evidence prompt preview.');
    expect(result.session.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Skipped completed plan step from restored evidence context: Resolve evidence.',
          metadata: expect.objectContaining({
            planStepId: 'evidence-resolve',
            planStepStatus: 'completed',
            toolName: 'evidence.resolve',
            restored: true,
            resolvedEvidenceCount: 1,
          }),
        }),
      ]),
    );
    const evidenceResolveRequests = result.session.trace.filter((event) =>
      event.kind === 'tool_requested' &&
      event.tool?.toolName === 'evidence.resolve',
    );
    expect(evidenceResolveRequests).toEqual([]);
  });

  it('restores completed synthesis from trace and skips duplicate answer synthesis', async () => {
    const store = useAgentSessionStore.getState();
    store.createSession({
      id: 'research-session-restored-synthesis',
      profile: 'research',
      task: 'Resume synthesis answer',
      now: 565,
    });
    store.appendTrace('research-session-restored-synthesis', {
      id: 'research-session-restored-synthesis:evidence-completed',
      kind: 'planning',
      timestamp: 566,
      message: 'Completed plan step: Resolve evidence.',
      evidenceRefs: [
        {
          kind: 'file',
          label: 'synthesis.md',
          locator: 'notes/synthesis.md',
        },
      ],
      metadata: {
        planStepId: 'evidence-resolve',
        planStepStatus: 'completed',
        toolName: 'evidence.resolve',
        resultPreview: '1 context node, 1 evidence ref.',
        resolvedPromptPreview: 'Synthesis evidence prompt preview.',
        resolvedContextNodeCount: 1,
        resolvedEvidenceCount: 1,
      },
    });
    store.appendTrace('research-session-restored-synthesis', {
      id: 'research-session-restored-synthesis:synthesis',
      kind: 'planning',
      timestamp: 567,
      message: 'Prepared research synthesis from context pack, memory, and resolved evidence.',
      evidenceRefs: [
        {
          kind: 'file',
          label: 'synthesis.md',
          locator: 'notes/synthesis.md',
        },
      ],
      metadata: {
        resolvedEvidenceCount: 1,
        answerLength: 42,
        answerPreview: 'Previously generated synthesis answer.',
      },
    });

    const result = await runResearchAgent({
      sessionId: 'research-session-restored-synthesis',
      now: 570,
      task: 'Resume synthesis answer',
      filePath: 'notes/synthesis.md',
      content: '# Synthesis\nThis should restore synthesis.',
      selection: 'This should restore synthesis.',
      query: 'Restored synthesis',
      compact: false,
      plannerOutput: JSON.stringify({
        steps: [
          {
            id: 'context-pack',
            title: 'Collect context',
            description: 'Collect context.',
          },
          {
            id: 'evidence-resolve',
            title: 'Resolve evidence',
            description: 'Restore evidence.',
            toolName: 'evidence.resolve',
          },
          {
            id: 'synthesize-answer',
            title: 'Synthesize answer',
            description: 'This completed synthesis should be restored.',
          },
        ],
      }),
    });

    expect(result.answer).toBe([
      '[Restored synthesis preview from prior Research Agent trace]',
      'Previously generated synthesis answer.',
    ].join('\n'));
    expect(result.session.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Skipped completed plan step from restored synthesis: Synthesize answer.',
          metadata: expect.objectContaining({
            planStepId: 'synthesize-answer',
            planStepStatus: 'completed',
            restored: true,
            answerPreview: expect.stringContaining('Previously generated synthesis answer.'),
          }),
        }),
        expect.objectContaining({
          id: 'research-session-restored-synthesis:synthesis',
          metadata: expect.objectContaining({
            restored: true,
            answerPreview: expect.stringContaining('Previously generated synthesis answer.'),
          }),
        }),
      ]),
    );
  });

  it('fails controlled read-tool loops that exceed the configured step limit', async () => {
    await expect(runResearchAgent({
      sessionId: 'research-session-tool-limit',
      now: 560,
      task: 'Limit planned readonly tools',
      filePath: 'notes/tool-limit.md',
      content: '# Tool Limit\nAlpha and Beta evidence should not run forever.',
      selection: 'Alpha and Beta evidence should not run forever.',
      query: 'Alpha Beta evidence',
      compact: false,
      maxReadToolSteps: 1,
      plannerOutput: JSON.stringify({
        steps: [
          {
            id: 'context-pack',
            title: 'Collect context',
            description: 'Collect context.',
          },
          {
            id: 'workspace-search-alpha',
            title: 'Search Alpha',
            description: 'Search for Alpha context.',
            toolName: 'workspace.search',
            toolArgs: {
              query: 'Alpha',
              limit: 1,
            },
          },
          {
            id: 'workspace-search-beta',
            title: 'Search Beta',
            description: 'Search for Beta context.',
            toolName: 'workspace.search',
            toolArgs: {
              query: 'Beta',
              limit: 1,
            },
          },
          {
            id: 'evidence-resolve',
            title: 'Resolve evidence',
            description: 'Resolve evidence.',
            toolName: 'evidence.resolve',
          },
          {
            id: 'synthesize-answer',
            title: 'Synthesize answer',
            description: 'Write answer.',
          },
        ],
      }),
    })).rejects.toThrow('Research agent read-tool step limit exceeded (1).');

    const session = useAgentSessionStore.getState().getSession('research-session-tool-limit');
    expect(session?.status).toBe('failed');
    expect(session?.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'planning',
          metadata: expect.objectContaining({
            planStepId: 'workspace-search-beta',
            planStepStatus: 'failed',
            resultPreview: 'Research agent read-tool step limit exceeded (1).',
          }),
        }),
        expect.objectContaining({
          kind: 'error',
          message: 'Research agent read-tool step limit exceeded (1).',
        }),
      ]),
    );
  });

  it('aborts after planner generation without creating a partial session', async () => {
    const controller = new AbortController();
    const generatePlan = vi.fn(async () => {
      controller.abort();
      return {
        text: JSON.stringify({
          steps: [
            {
              id: 'context-pack',
              title: 'Collect abort context',
              description: 'Collect context.',
            },
            {
              id: 'evidence-resolve',
              title: 'Resolve abort evidence',
              description: 'Resolve evidence.',
              toolName: 'evidence.resolve',
            },
            {
              id: 'synthesize-answer',
              title: 'Synthesize abort answer',
              description: 'Write answer.',
            },
          ],
        }),
      };
    });

    await expect(runResearchAgent({
      sessionId: 'research-session-abort-before-session',
      now: 570,
      task: 'Abort after planner',
      filePath: 'notes/abort.md',
      content: '# Abort\nAbort after planner.',
      selection: 'Abort after planner.',
      compact: false,
      generatePlan,
      plannerSignal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });

    expect(useAgentSessionStore.getState().getSession('research-session-abort-before-session')).toBeNull();
  });

  it('cancels an active research session when the signal aborts after session creation', async () => {
    let abortChecks = 0;
    const signal = {
      get aborted() {
        abortChecks += 1;
        return abortChecks >= 3;
      },
    } as AbortSignal;

    await expect(runResearchAgent({
      sessionId: 'research-session-abort-active',
      now: 576,
      task: 'Abort active session',
      filePath: 'notes/abort-active.md',
      content: '# Abort Active\nAbort active session.',
      selection: 'Abort active session.',
      compact: false,
      plannerSignal: signal,
      plannerOutput: JSON.stringify({
        steps: [
          {
            id: 'context-pack',
            title: 'Collect context',
            description: 'Collect context.',
          },
          {
            id: 'evidence-resolve',
            title: 'Resolve evidence',
            description: 'Resolve evidence.',
            toolName: 'evidence.resolve',
          },
          {
            id: 'synthesize-answer',
            title: 'Synthesize answer',
            description: 'Write answer.',
          },
        ],
      }),
    })).rejects.toMatchObject({ name: 'AbortError' });

    const session = useAgentSessionStore.getState().getSession('research-session-abort-active');
    expect(session?.status).toBe('cancelled');
    expect(session?.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'cancelled',
          message: 'Research agent run was cancelled.',
        }),
      ]),
    );
  });

  it('falls back to the default plan when planner output is invalid', async () => {
    const result = await runResearchAgent({
      sessionId: 'research-session-planner-fallback',
      now: 600,
      task: 'Fallback planner output',
      filePath: 'notes/delta.md',
      content: '# Delta\nInvalid planner output should not block the run.',
      selection: 'Invalid planner output should not block the run.',
      compact: false,
      plannerOutput: 'Inspect the note and summarize it.',
    });

    expect(result.planSource).toBe('fallback');
    expect(result.planWarnings).toEqual(['Planner output did not contain a JSON object.']);
    expect(result.planSteps).toEqual([
      expect.objectContaining({ id: 'context-pack', status: 'completed' }),
      expect.objectContaining({
        id: 'resolve-lattice-path-identity',
        status: 'completed',
        toolName: 'lattice.resolvePathIdentity',
      }),
      expect.objectContaining({ id: 'evidence-resolve', status: 'completed' }),
      expect.objectContaining({ id: 'synthesize-answer', status: 'completed' }),
    ]);
    expect(result.session.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'research-session-planner-fallback:plan-warnings',
          message: expect.stringContaining('fell back to defaults'),
          metadata: expect.objectContaining({
            planSource: 'fallback',
            planWarningCount: 1,
          }),
        }),
      ]),
    );
  });

  it('uses an injected planner generator when no explicit plan or planner output is provided', async () => {
    const generatePlan = vi.fn(async () => ({
      text: JSON.stringify({
        steps: [
          {
            id: 'context-pack',
            title: 'Collect injected context',
            description: 'Collect context from injected planner.',
          },
          {
            id: 'evidence-resolve',
            title: 'Resolve injected evidence',
            description: 'Resolve evidence from injected planner.',
            toolName: 'evidence.resolve',
          },
          {
            id: 'synthesize-answer',
            title: 'Synthesize injected answer',
            description: 'Write answer from injected planner.',
          },
        ],
      }),
    }));

    const result = await runResearchAgent({
      sessionId: 'research-session-generate-plan',
      now: 700,
      task: 'Use injected planner',
      filePath: 'notes/epsilon.md',
      content: '# Epsilon\nInjected planner should shape the plan.',
      selection: 'Injected planner should shape the plan.',
      compact: false,
      generatePlan,
      plannerModel: 'planner-model',
      plannerTemperature: 0.1,
      plannerMaxTokens: 700,
      plannerHints: 'Workflow: Reading Note (reading-note)\nAllowed tools: evidence.resolve',
      workflowId: 'reading-note',
      workflowTitle: 'Reading Note',
      continuation: {
        sourceSessionId: 'source-session-epsilon',
        compactionId: 'source-compaction-epsilon',
        sourceSummary: 'Epsilon compacted summary.',
      },
    });

    expect(generatePlan).toHaveBeenCalledOnce();
    expect(result.planSource).toBe('custom');
    expect(result.plannerPrompt).toContain('Use injected planner');
    expect(result.plannerPrompt).toContain('Workflow: Reading Note (reading-note)');
    expect(result.plannerPrompt).toContain('Continuation context: Continue from session: source-session-epsilon');
    expect(result.plannerPrompt).toContain('Compaction: source-compaction-epsilon');
    expect(result.plannerRawOutput).toContain('Collect injected context');
    expect(result.workflowId).toBe('reading-note');
    expect(result.workflowTitle).toBe('Reading Note');
    expect(result.answer).toContain('尚未生成答复');
    expect(result.answer).not.toContain('Workflow output:');
    expect(result.session.trace.find((event) => event.id === 'research-session-generate-plan:plan-created')).toMatchObject({
      metadata: expect.objectContaining({
        agentKind: 'research_agent',
        plannerPromptPreview: expect.stringContaining('You are planning a Lattice Research Agent run'),
        plannerRawOutputPreview: expect.stringContaining('Collect injected context'),
        workflowId: 'reading-note',
        workflowTitle: 'Reading Note',
        continuationSourceSessionId: 'source-session-epsilon',
        continuationCompactionId: 'source-compaction-epsilon',
      }),
    });
    expect(result.planSteps).toEqual([
      expect.objectContaining({ id: 'context-pack', title: 'Collect injected context', status: 'completed' }),
      expect.objectContaining({ id: 'evidence-resolve', title: 'Resolve injected evidence', status: 'completed' }),
      expect.objectContaining({ id: 'synthesize-answer', title: 'Synthesize injected answer', status: 'completed' }),
    ]);
  });

  it('replans pending steps once from tool observations before resolving evidence', async () => {
    const generatePlan = vi.fn(async (messages: AiMessage[]) => {
      const prompt = getMessageText(messages.find((message) => message.role === 'user')?.content ?? '');
      if (prompt.includes('Tool observations:')) {
        return {
          text: JSON.stringify({
            steps: [
              {
                id: 'context-pack',
                title: 'Collect observed context',
                description: 'Already collected context.',
              },
              {
                id: 'workspace-search',
                title: 'Search observed workspace',
                description: 'Already searched workspace.',
                toolName: 'workspace.search',
                toolArgs: {
                  query: 'Alpha observed',
                  limit: 2,
                },
              },
              {
                id: 'evidence-resolve',
                title: 'Resolve observed Alpha evidence',
                description: 'Resolve evidence using the observed Alpha query.',
                toolName: 'evidence.resolve',
                toolArgs: {
                  query: 'Alpha observed follow-up',
                  maxContextTokens: 1500,
                },
              },
              {
                id: 'synthesize-answer',
                title: 'Synthesize observed Alpha answer',
                description: 'Write answer after observing tool results.',
              },
              {
                id: 'new-read-step',
                title: 'Ignored extra read step',
                description: 'This new step should not be appended in the bounded replan.',
                toolName: 'workspace.search',
                toolArgs: {
                  query: 'Should not execute',
                  limit: 1,
                },
              },
            ],
          }),
        };
      }

      return {
        text: JSON.stringify({
          steps: [
            {
              id: 'context-pack',
              title: 'Collect initial context',
              description: 'Collect context first.',
            },
            {
              id: 'workspace-search',
              title: 'Search workspace first',
              description: 'Search before resolving evidence.',
              toolName: 'workspace.search',
              toolArgs: {
                query: 'Alpha initial',
                limit: 2,
              },
            },
            {
              id: 'evidence-resolve',
              title: 'Resolve initial evidence',
              description: 'Resolve initial evidence.',
              toolName: 'evidence.resolve',
            },
            {
              id: 'synthesize-answer',
              title: 'Synthesize initial answer',
              description: 'Write initial answer.',
            },
          ],
        }),
      };
    });

    const result = await runResearchAgent({
      sessionId: 'research-session-observation-replan',
      now: 720,
      task: 'Use observation replan',
      filePath: 'notes/observation.md',
      content: '# Observation\nAlpha observed follow-up should be used.',
      selection: 'Alpha observed follow-up should be used.',
      query: 'Alpha initial',
      compact: false,
      generatePlan,
    });

    expect(generatePlan).toHaveBeenCalledTimes(2);
    expect(result.plannerPrompt).toContain('Tool observations:');
    expect(result.plannerPrompt).toContain('resultSchema={schemaStatus=');
    expect(result.plannerPrompt).toContain('metrics=items=');
    expect(result.plannerRawOutput).toContain('Resolve observed Alpha evidence');
    expect(result.planSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'workspace-search', status: 'completed', title: 'Search workspace first' }),
        expect.objectContaining({ id: 'evidence-resolve', status: 'completed', title: 'Resolve observed Alpha evidence' }),
        expect.objectContaining({ id: 'synthesize-answer', status: 'completed', title: 'Synthesize observed Alpha answer' }),
      ]),
    );
    expect(result.planSteps.some((step) => step.id === 'new-read-step')).toBe(false);
    expect(result.session.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'research-session-observation-replan:observation-replan',
          metadata: expect.objectContaining({
            observationCount: 1,
            updatedStepIds: expect.stringContaining('evidence-resolve'),
            ignoredStepIds: 'new-read-step',
            observationsPreview: expect.stringContaining('workspace-search'),
          }),
        }),
        expect.objectContaining({
          kind: 'tool_requested',
          tool: expect.objectContaining({
            toolName: 'evidence.resolve',
            argumentsPreview: expect.stringContaining('Alpha observed follow-up'),
          }),
        }),
      ]),
    );
    const replanEvent = result.session.trace.find((event) => event.id === 'research-session-observation-replan:observation-replan');
    expect(replanEvent?.metadata?.observationsPreview).toEqual(expect.stringContaining('workspace-search'));
    expect(replanEvent?.metadata?.observationsPreview).toEqual(expect.stringContaining('resultSchema={schemaStatus='));
  });

  it('runs bounded multi-iteration observe-plan-act replans when enabled', async () => {
    const generatePlan = vi.fn(async (messages: AiMessage[]) => {
      const prompt = getMessageText(messages.find((message) => message.role === 'user')?.content ?? '');
      const observationPromptCount = prompt.includes('Tool observations:') ? generatePlan.mock.calls.length : 0;

      if (prompt.includes('Tool observations:') && observationPromptCount >= 3) {
        return {
          text: JSON.stringify({
            steps: [
              {
                id: 'context-pack',
                title: 'Collect multi context',
                description: 'Context already collected.',
              },
              {
                id: 'workspace-search-alpha',
                title: 'Search Alpha workspace',
                description: 'Already searched Alpha.',
                toolName: 'workspace.search',
                toolArgs: { query: 'Alpha multi initial', limit: 2 },
              },
              {
                id: 'workspace-search-beta',
                title: 'Search Beta workspace',
                description: 'Already searched Beta.',
                toolName: 'workspace.search',
                toolArgs: { query: 'Beta multi follow-up', limit: 2 },
              },
              {
                id: 'evidence-resolve',
                title: 'Resolve multi-observed evidence',
                description: 'Resolve after two observation rounds.',
                toolName: 'evidence.resolve',
                toolArgs: {
                  query: 'Beta multi final evidence',
                  maxContextTokens: 1800,
                },
              },
              {
                id: 'synthesize-answer',
                title: 'Synthesize multi-observed answer',
                description: 'Answer after two observation rounds.',
              },
            ],
          }),
        };
      }

      if (prompt.includes('Tool observations:')) {
        return {
          text: JSON.stringify({
            steps: [
              {
                id: 'context-pack',
                title: 'Collect multi context',
                description: 'Context already collected.',
              },
              {
                id: 'workspace-search-alpha',
                title: 'Search Alpha workspace',
                description: 'Already searched Alpha.',
                toolName: 'workspace.search',
                toolArgs: { query: 'Alpha multi initial', limit: 2 },
              },
              {
                id: 'workspace-search-beta',
                title: 'Search Beta workspace',
                description: 'Search Beta after Alpha observation.',
                toolName: 'workspace.search',
                toolArgs: { query: 'Beta multi follow-up', limit: 2 },
              },
              {
                id: 'evidence-resolve',
                title: 'Resolve multi evidence after Beta',
                description: 'Resolve after the second read loop.',
                toolName: 'evidence.resolve',
              },
              {
                id: 'synthesize-answer',
                title: 'Synthesize multi answer after Beta',
                description: 'Answer after the second read loop.',
              },
              {
                id: 'invented-extra-step',
                title: 'Ignored invented step',
                description: 'Should remain ignored.',
                toolName: 'workspace.search',
                toolArgs: { query: 'ignored', limit: 1 },
              },
            ],
          }),
        };
      }

      return {
        text: JSON.stringify({
          steps: [
            {
              id: 'context-pack',
              title: 'Collect multi context',
              description: 'Collect context first.',
            },
            {
              id: 'workspace-search-alpha',
              title: 'Search Alpha workspace',
              description: 'Search Alpha before replanning.',
              toolName: 'workspace.search',
              toolArgs: { query: 'Alpha multi initial', limit: 2 },
            },
            {
              id: 'workspace-search-beta',
              title: 'Prepare Beta workspace search',
              description: 'Planner may activate this after observation.',
            },
            {
              id: 'evidence-resolve',
              title: 'Resolve initial multi evidence',
              description: 'Resolve evidence after observations.',
              toolName: 'evidence.resolve',
            },
            {
              id: 'synthesize-answer',
              title: 'Synthesize initial multi answer',
              description: 'Synthesize answer.',
            },
          ],
        }),
      };
    });

    const workspaceIndex = getWorkspaceIndex();
    workspaceIndex.files.set('notes/alpha-multi.md', {
      path: 'notes/alpha-multi.md',
      name: 'alpha-multi.md',
      extension: '.md',
      size: 160,
      summary: 'Alpha multi initial workspace context.',
      headings: ['Alpha multi'],
      lastModified: 760,
    });
    workspaceIndex.files.set('notes/beta-multi.md', {
      path: 'notes/beta-multi.md',
      name: 'beta-multi.md',
      extension: '.md',
      size: 180,
      summary: 'Beta multi follow-up workspace context.',
      headings: ['Beta multi'],
      lastModified: 761,
    });
    workspaceIndex.lastFullIndex = 761;
    workspaceIndex.version = 12;

    const result = await runResearchAgent({
      sessionId: 'research-session-multi-observation-replan',
      now: 760,
      task: 'Use multi observation replan',
      filePath: 'notes/multi-observation.md',
      content: '# Multi Observation\nBeta multi final evidence should be used.',
      selection: 'Beta multi final evidence should be used.',
      query: 'Alpha multi initial',
      workspaceKey: 'lattice-research',
      compact: false,
      generatePlan,
      maxObservationReplans: 2,
    });

    expect(generatePlan).toHaveBeenCalledTimes(3);
    expect(result.toolObservations.map((observation) => observation.stepId)).toEqual([
      'workspace-search-alpha',
      'workspace-search-beta',
    ]);
    expect(result.planSteps.some((step) => step.id === 'invented-extra-step')).toBe(false);
    expect(result.planSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'workspace-search-alpha', status: 'completed' }),
        expect.objectContaining({ id: 'workspace-search-beta', status: 'completed', toolName: 'workspace.search' }),
        expect.objectContaining({ id: 'evidence-resolve', status: 'completed', title: 'Resolve multi-observed evidence' }),
      ]),
    );
    expect(result.session.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'research-session-multi-observation-replan:observation-replan',
          metadata: expect.objectContaining({
            observationReplanIteration: 1,
            observationReplanBudget: 2,
            updatedStepIds: expect.stringContaining('workspace-search-beta'),
            ignoredStepIds: 'invented-extra-step',
          }),
        }),
        expect.objectContaining({
          id: 'research-session-multi-observation-replan:observation-replan:2',
          metadata: expect.objectContaining({
            observationReplanIteration: 2,
            observationReplanBudget: 2,
            updatedStepIds: expect.stringContaining('evidence-resolve'),
          }),
        }),
        expect.objectContaining({
          id: 'research-session-multi-observation-replan:observation-replan-stop',
          metadata: expect.objectContaining({
            observationReplanStopReason: 'budget_exhausted',
            observationReplanIteration: 2,
            observationCount: 2,
          }),
        }),
        expect.objectContaining({
          kind: 'tool_requested',
          tool: expect.objectContaining({
            toolName: 'evidence.resolve',
            argumentsPreview: expect.stringContaining('Beta multi final evidence'),
          }),
        }),
      ]),
    );
  });

  it('stops bounded observation replans when every new observation is low value', async () => {
    const generatePlan = vi.fn(async (messages: AiMessage[]) => {
      const prompt = getMessageText(messages.find((message) => message.role === 'user')?.content ?? '');

      if (prompt.includes('Tool observations:')) {
        return {
          text: JSON.stringify({
            steps: [
              {
                id: 'context-pack',
                title: 'Collect low value context',
                description: 'Context already collected.',
              },
              {
                id: 'workspace-search-alpha',
                title: 'Search empty Alpha',
                description: 'Already searched empty Alpha.',
                toolName: 'workspace.search',
                toolArgs: { query: 'No indexed Alpha matches', limit: 2 },
              },
              {
                id: 'workspace-search-beta',
                title: 'Search empty Beta',
                description: 'Search another empty query after the first low-value observation.',
                toolName: 'workspace.search',
                toolArgs: { query: 'No indexed Beta matches', limit: 2 },
              },
              {
                id: 'evidence-resolve',
                title: 'Resolve low value evidence',
                description: 'Resolve after low value observations.',
                toolName: 'evidence.resolve',
              },
              {
                id: 'synthesize-answer',
                title: 'Synthesize low value answer',
                description: 'Answer with available context.',
              },
            ],
          }),
        };
      }

      return {
        text: JSON.stringify({
          steps: [
            {
              id: 'context-pack',
              title: 'Collect low value context',
              description: 'Collect context first.',
            },
            {
              id: 'workspace-search-alpha',
              title: 'Search empty Alpha',
              description: 'Search before replanning.',
              toolName: 'workspace.search',
              toolArgs: { query: 'No indexed Alpha matches', limit: 2 },
            },
            {
              id: 'workspace-search-beta',
              title: 'Prepare empty Beta search',
              description: 'Planner may activate this after observation.',
            },
            {
              id: 'evidence-resolve',
              title: 'Resolve initial low value evidence',
              description: 'Resolve evidence after observations.',
              toolName: 'evidence.resolve',
            },
            {
              id: 'synthesize-answer',
              title: 'Synthesize initial low value answer',
              description: 'Synthesize answer.',
            },
          ],
        }),
      };
    });

    const result = await runResearchAgent({
      sessionId: 'research-session-low-value-observation-stop',
      now: 780,
      task: 'Stop on low value observations',
      filePath: 'notes/low-value-observation.md',
      content: '# Low Value\nOnly local context is available.',
      selection: 'Only local context is available.',
      query: 'No indexed Alpha matches',
      compact: false,
      generatePlan,
      maxObservationReplans: 2,
    });

    expect(generatePlan).toHaveBeenCalledTimes(2);
    expect(result.toolObservations.map((observation) => observation.stepId)).toEqual([
      'workspace-search-alpha',
      'workspace-search-beta',
    ]);
    expect(result.session.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'research-session-low-value-observation-stop:observation-replan',
          metadata: expect.objectContaining({
            observationQualitySummary: 'duplicates=0, lowValue=1, observations=1',
            observationDuplicateCount: 0,
            observationLowValueCount: 1,
            updatedStepIds: expect.stringContaining('workspace-search-beta'),
          }),
        }),
        expect.objectContaining({
          id: 'research-session-low-value-observation-stop:observation-replan-stop',
          metadata: expect.objectContaining({
            observationReplanStopReason: 'low_value_observations',
            observationReplanIteration: 1,
            observationReplanBudget: 2,
            observationCount: 2,
            observationQualitySummary: 'duplicates=0, lowValue=1, observations=1',
            observationLowValueCount: 2,
            observationRecoveryRecommendation: expect.stringContaining('Stop repeated low-value reads'),
          }),
        }),
      ]),
    );
    expect(result.session.trace.some((event) => event.id === 'research-session-low-value-observation-stop:observation-replan:2')).toBe(false);
  });

  it('stops bounded observation replans when every new observation repeats a prior request', async () => {
    const generatePlan = vi.fn(async (messages: AiMessage[]) => {
      const prompt = getMessageText(messages.find((message) => message.role === 'user')?.content ?? '');

      if (prompt.includes('Tool observations:')) {
        return {
          text: JSON.stringify({
            steps: [
              {
                id: 'context-pack',
                title: 'Collect duplicate context',
                description: 'Context already collected.',
              },
              {
                id: 'workspace-search-alpha',
                title: 'Search duplicate Alpha',
                description: 'Already searched duplicate Alpha.',
                toolName: 'workspace.search',
                toolArgs: { query: 'Repeated empty request', limit: 2 },
              },
              {
                id: 'workspace-search-beta',
                title: 'Repeat duplicate request',
                description: 'This repeats the exact prior request.',
                toolName: 'workspace.search',
                toolArgs: { query: 'Repeated empty request', limit: 2 },
              },
              {
                id: 'evidence-resolve',
                title: 'Resolve duplicate evidence',
                description: 'Resolve after duplicate observations.',
                toolName: 'evidence.resolve',
              },
              {
                id: 'synthesize-answer',
                title: 'Synthesize duplicate answer',
                description: 'Answer with available context.',
              },
            ],
          }),
        };
      }

      return {
        text: JSON.stringify({
          steps: [
            {
              id: 'context-pack',
              title: 'Collect duplicate context',
              description: 'Collect context first.',
            },
            {
              id: 'workspace-search-alpha',
              title: 'Search duplicate Alpha',
              description: 'Search before replanning.',
              toolName: 'workspace.search',
              toolArgs: { query: 'Repeated empty request', limit: 2 },
            },
            {
              id: 'workspace-search-beta',
              title: 'Prepare duplicate request',
              description: 'Planner may activate this after observation.',
            },
            {
              id: 'evidence-resolve',
              title: 'Resolve initial duplicate evidence',
              description: 'Resolve evidence after observations.',
              toolName: 'evidence.resolve',
            },
            {
              id: 'synthesize-answer',
              title: 'Synthesize initial duplicate answer',
              description: 'Synthesize answer.',
            },
          ],
        }),
      };
    });

    const result = await runResearchAgent({
      sessionId: 'research-session-duplicate-observation-stop',
      now: 790,
      task: 'Stop on duplicate observations',
      filePath: 'notes/duplicate-observation.md',
      content: '# Duplicate\nOnly local context is available.',
      selection: 'Only local context is available.',
      query: 'Repeated empty request',
      compact: false,
      generatePlan,
      maxObservationReplans: 2,
    });

    expect(generatePlan).toHaveBeenCalledTimes(2);
    expect(result.toolObservations.map((observation) => observation.requestSignature)).toEqual([
      'workspace.search:{"query":"Repeated empty request","limit":2}',
      'workspace.search:{"query":"Repeated empty request","limit":2}',
    ]);
    expect(result.session.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'research-session-duplicate-observation-stop:observation-replan-stop',
          metadata: expect.objectContaining({
            observationReplanStopReason: 'duplicate_observations',
            observationReplanIteration: 1,
            observationReplanBudget: 2,
            observationCount: 2,
            observationQualitySummary: 'duplicates=1, lowValue=1, observations=1',
            observationDuplicateCount: 1,
            observationRecoveryRecommendation: expect.stringContaining('Avoid repeating the same read request'),
          }),
        }),
      ]),
    );
    expect(result.session.trace.some((event) => event.id === 'research-session-duplicate-observation-stop:observation-replan:2')).toBe(false);
  });

  it('does not call injected planner when planner output is already provided', async () => {
    const generatePlan = vi.fn(async () => ({
      text: '{"steps":[]}',
    }));

    const result = await runResearchAgent({
      sessionId: 'research-session-planner-priority',
      now: 800,
      task: 'Respect planner output priority',
      filePath: 'notes/zeta.md',
      content: '# Zeta\nPlanner output should win.',
      selection: 'Planner output should win.',
      compact: false,
      plannerOutput: JSON.stringify({
        steps: [
          {
            id: 'context-pack',
            title: 'Provided context',
            description: 'Use provided output.',
          },
          {
            id: 'evidence-resolve',
            title: 'Provided evidence',
            description: 'Use provided output.',
            toolName: 'evidence.resolve',
          },
          {
            id: 'synthesize-answer',
            title: 'Provided synthesis',
            description: 'Use provided output.',
          },
        ],
      }),
      generatePlan,
    });

    expect(generatePlan).not.toHaveBeenCalled();
    expect(result.planSource).toBe('custom');
    expect(result.plannerPrompt).toBeNull();
    expect(result.plannerRawOutput).toContain('Provided context');
    expect(result.planSteps[0]).toMatchObject({
      title: 'Provided context',
    });
  });

  it('falls back to the default plan when injected planner generation fails', async () => {
    const result = await runResearchAgent({
      sessionId: 'research-session-generate-fallback',
      now: 900,
      task: 'Planner failure fallback',
      filePath: 'notes/eta.md',
      content: '# Eta\nPlanner failure should not block execution.',
      selection: 'Planner failure should not block execution.',
      compact: false,
      generatePlan: async () => {
        throw new Error('planner offline');
      },
    });

    expect(result.planSource).toBe('fallback');
    expect(result.planWarnings).toEqual(['Planner generation failed: planner offline']);
    expect(result.plannerPrompt).toContain('Planner failure fallback');
    expect(result.plannerRawOutput).toBeNull();
    expect(result.planSteps).toEqual([
      expect.objectContaining({ id: 'context-pack', status: 'completed' }),
      expect.objectContaining({ id: 'resolve-lattice-path-identity', status: 'completed', toolArgs: expect.objectContaining({ filePathOrAbsolutePath: 'notes/eta.md' }) }),
      expect.objectContaining({ id: 'evidence-resolve', status: 'completed' }),
      expect.objectContaining({ id: 'synthesize-answer', status: 'completed' }),
    ]);
  });

  it('derives completed approval summary from approval records when session status is stale', () => {
    const summary = buildResearchAgentApprovalSummary({
      id: 'research-session-stale-approval',
      profile: 'research',
      task: 'Stale waiting approval state',
      title: 'Stale waiting approval state',
      status: 'waiting_approval',
      createdAt: 1,
      updatedAt: 2,
      trace: [],
      evidenceRefs: [],
      approvalRequestIds: ['approval-1'],
      pendingApprovals: [{
        id: 'approval-1',
        capability: 'run_code',
        toolName: 'runner.runCode',
        request: {
          name: 'runner.runCode',
          args: { language: 'javascript', code: '2 + 2' },
        },
        decision: {
          capability: 'run_code',
          permission: 'ask',
          requiresApproval: true,
          allowed: true,
        },
        status: 'completed',
        createdAt: 1,
        updatedAt: 2,
      }],
      compactions: [],
      memorySnapshotIds: [],
    });

    expect(summary).toMatchObject({
      status: 'completed',
      totalApprovals: 1,
      pendingApprovals: 0,
      completedApprovals: 1,
      completedToolNames: ['runner.runCode'],
    });
  });
});
