import { beforeEach, expect, it, vi } from 'vitest';
import type { AiRuntimeSettings } from '../ai/types';
import type { ResearchAgentRunResult } from '../ai/research-agent';
import { buildCitationContract } from '../ai/citation-contract';
const partialMocks = vi.hoisted(() => ({ run: vi.fn(), planner: vi.fn() }));
vi.mock('../ai/research-agent', () => ({ runResearchAgent: partialMocks.run }));
vi.mock('../ai/research-agent-planner-provider', () => ({ createResearchAgentPlannerGenerate: partialMocks.planner }));
import { runResearchAgentForChat } from '../ai/research-agent-chat-runner';
import { buildAgentToolResultPreview } from '../ai/agent-tool-broker';
const settings: AiRuntimeSettings = { aiEnabled: true, providerId: 'openai', model: 'synthetic', temperature: .4, maxTokens: 4000, systemPrompt: '', preferLocal: false };
function createResult(overrides: Partial<ResearchAgentRunResult> = {}): ResearchAgentRunResult {
  return {
    sessionId: 'research-session-chat',
    session: {
      id: 'research-session-chat',
      profile: 'research',
      task: 'Explain Alpha',
      title: 'Explain Alpha',
      status: 'completed',
      createdAt: 1,
      updatedAt: 2,
      trace: [],
      evidenceRefs: [],
      approvalRequestIds: [],
      pendingApprovals: [],
      compactions: [],
      memorySnapshotIds: [],
    },
    approvalSummary: {
      status: 'none',
      totalApprovals: 0,
      pendingApprovals: 0,
      executingApprovals: 0,
      completedApprovals: 0,
      failedApprovals: 0,
      rejectedApprovals: 0,
      pendingToolNames: [],
      executingToolNames: [],
      completedToolNames: [],
      failedToolNames: [],
    },
    contextPack: {
      id: 'context-pack-chat',
      createdAt: 1,
      sections: [],
      sourceSummaries: [],
      evidenceRefs: [],
      prompt: '',
      tokenEstimate: 0,
      truncated: false,
      budget: {
        maxTokens: 4000,
        bySource: {},
      },
      omitted: [],
      omittedSummary: {
        totalOmittedCount: 0,
        totalOmittedTokens: 0,
        bySource: [],
        preview: 'No omitted context.',
        semanticPreview: 'No omitted context.',
        autoSummary: [],
        autoSummaryPreview: 'No omitted auto summary.',
        recoveryHints: [],
        recoveryHintsPreview: 'No omitted recovery hints.',
        recoveryPriorityPreview: 'No omitted recovery priorities.',
        recoveryPlan: [],
        recoveryPlanPreview: 'No omitted recovery plan.',
      },
    },
    promptContext: {
      nodes: [],
      prompt: '',
      evidenceRefs: [],
      truncated: false,
    },
    answer: 'Alpha improves evidence grounding and reproducibility.',
    planSteps: [
      {
        id: 'context-pack',
        title: 'Build context pack',
        description: 'Build context.',
        status: 'completed',
      },
      {
        id: 'evidence-resolve',
        title: 'Resolve evidence',
        description: 'Resolve evidence.',
        status: 'completed',
        toolName: 'evidence.resolve',
      },
    ],
    planSource: 'custom',
    planWarnings: [],
    plannerPrompt: 'planner prompt',
    plannerRawOutput: '{"steps":[]}',
    memorySnapshotIds: [],
    workspaceSummary: null,
    artifactResults: [],
    toolResults: [],
    toolObservations: [],
    memorySuggestionResults: [],
    ...overrides,
  };
}
const validation = { acceptedCount: 1, rejectedCount: 1, details: { issues: [{ annotationIndex: 1, page: 2, reason: 'quote_not_found' }] } };
const pendingDraft = { status: 'pending-review', complete: false, annotationValidation: validation };
function partialResult(overrides: Partial<ResearchAgentRunResult> = {}): ResearchAgentRunResult {
  return createResult({ toolResults: [{ status: 'completed', sessionId: 'synthetic', toolName: 'lattice.pdf.proposeAnnotations', decision: {} as never, result: pendingDraft }], ...overrides });
}
beforeEach(() => {
  vi.resetAllMocks();
  partialMocks.planner.mockReturnValue({ generatePlan: vi.fn(), generateAnswer: vi.fn(), modelInfo: { providerId: 'openai', providerName: 'Synthetic', model: 'synthetic', source: 'cloud' } });
});
it('reports a partially validated review draft as partial rather than hiding it behind pending-review', () => {
  const preview = buildAgentToolResultPreview('lattice.pdf.proposeAnnotations', pendingDraft);
  expect(preview.metadata).toMatchObject({ complete: false, resultStatus: 'partial' });
});
it.each(['conversation', 'structured', 'annotation'] as const)('shows excluded annotation counts in the %s chat output without raw validation JSON', async mode => {
  const quote = 'A verified synthetic result appears here.';
  const ref = { kind: 'pdf_page' as const, label: 'paper.pdf', locator: 'paper.pdf#page=1', preview: quote, anchor: { page: 1, snippet: quote } };
  const annotationAnswer = '```lattice-annotations'+String.fromCharCode(10)+JSON.stringify({ annotations: [{ sourceId: buildCitationContract(ref).stableId, page: 1, quote, reason: 'Core result.' }] })+String.fromCharCode(10)+'```';
  partialMocks.run.mockResolvedValue(partialResult(mode === 'annotation' ? { answer: annotationAnswer, promptContext: { nodes: [], prompt: quote, evidenceRefs: [ref], truncated: false } } : {}));
  const result = await runResearchAgentForChat({ settings, task: 'Annotate the core result', filePath: 'paper.pdf', workflowId: mode === 'annotation' ? 'pdf-annotation' : 'paper-reading', ...(mode === 'conversation' ? { responseMode: 'conversation' as const } : {}) });
  expect(result.chatText).toContain('已保留 1 条通过原文核验的批注草稿');
  expect(result.chatText).toContain('另有 1 条未能定位');
  expect(result.chatText).not.toContain('quote_not_found');
  expect(result.chatText).not.toContain('annotationIndex');
  expect(result.chatText.split('已保留 1 条通过原文核验的批注草稿')).toHaveLength(2);
  expect(result.agentResult.warnings).toEqual(expect.arrayContaining([expect.stringContaining('另有 1 条未能定位')]));
});
it('uses the configured answer language for the annotation validation notice', async () => {
  partialMocks.run.mockResolvedValue(partialResult());
  const result = await runResearchAgentForChat({ settings, responseMode: 'conversation', task: 'Annotate the core result', filePath: 'paper.pdf', workflowId: 'paper-reading', noteConfigOverrides: { language: 'en-US' } });
  expect(result.chatText).toContain('1 verified annotation draft');
  expect(result.chatText).toContain('1 suggestion could not be located');
  expect(result.chatText).not.toContain('已保留');
});
