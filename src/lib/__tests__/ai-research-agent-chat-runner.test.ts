import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResearchAgentRunResult } from '../ai/research-agent';
import type { AiRuntimeSettings } from '../ai/types';

const mocks = vi.hoisted(() => ({
  runResearchAgent: vi.fn(),
  createResearchAgentPlannerGenerate: vi.fn(),
}));

vi.mock('../ai/research-agent', () => ({
  runResearchAgent: mocks.runResearchAgent,
}));

vi.mock('../ai/research-agent-planner-provider', () => ({
  createResearchAgentPlannerGenerate: mocks.createResearchAgentPlannerGenerate,
}));

import {
  buildResearchAgentResultMetadata,
  formatResearchAgentChatAnswer,
  runResearchAgentForChat,
} from '../ai/research-agent-chat-runner';

const settings: AiRuntimeSettings = {
  aiEnabled: true,
  providerId: 'openai',
  model: 'gpt-test',
  temperature: 0.4,
  maxTokens: 4000,
  systemPrompt: '',
  preferLocal: false,
};

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
    answer: 'Task: Explain Alpha\n\nEvidence: no explicit evidence refs resolved.',
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

describe('research-agent-chat-runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the research agent with a routed LLM planner and formats chat output', async () => {
    const generatePlan = vi.fn();
    const generateOmittedSummary = vi.fn();
    mocks.createResearchAgentPlannerGenerate.mockReturnValue({
      generatePlan,
      generateOmittedSummary,
      modelInfo: {
        providerId: 'openai',
        providerName: 'OpenAI',
        model: 'gpt-test',
        source: 'cloud',
      },
      policy: {
        taskType: 'research',
        preferredProvider: 'openai',
        fallbackProvider: null,
        maxContextTokens: 18000,
        evidenceRequired: true,
      },
    });
    mocks.runResearchAgent.mockResolvedValue(createResult({
      workflowId: 'teaching-explain',
      workflowTitle: 'Teaching Explain',
      workflowInferred: true,
      session: {
        ...createResult().session,
        trace: [
          {
            id: 'research-session-chat:observation-replan-stop',
            kind: 'planning',
            timestamp: 10,
            message: 'Observation replan loop stopped: budget_exhausted.',
            metadata: {
              observationReplanStopReason: 'budget_exhausted',
              observationRecoveryRecommendation: 'Observation replan budget is exhausted. Continue with the best current plan or start a focused follow-up run.',
            },
          },
        ],
      },
      continuation: {
        sourceSessionId: 'source-session-alpha',
        compactionId: 'source-compaction-alpha',
        sourceSummary: 'Alpha compacted summary.',
      },
      toolObservations: [
        {
          stepId: 'workspace-search',
          toolName: 'workspace.search',
          status: 'completed',
          purpose: 'read',
          recoveryLocator: null,
          preview: '2 matches.',
          evidenceCount: 0,
          requestSignature: 'workspace.search:{"query":"Alpha","limit":2}',
          resultItemCount: 2,
          resultSize: null,
          resultStatus: 'completed',
          resultSummary: '2 indexed file matches.',
          resultMetricsPreview: 'items=2',
          resultArtifactsPreview: 'notes/alpha.md, notes/beta.md',
          resultDiagnosticsPreview: null,
          metadataPreview: 'matchCount=2',
        },
      ],
    }));

    const result = await runResearchAgentForChat({
      settings,
      task: 'Explain Alpha',
      query: 'Explain Alpha',
      content: 'Alpha content',
      continuation: {
        sourceSessionId: 'source-session-alpha',
        compactionId: 'source-compaction-alpha',
        sourceSummary: 'Alpha compacted summary.',
      },
    });

    expect(mocks.createResearchAgentPlannerGenerate).toHaveBeenCalledWith(settings, {
      taskType: 'research',
    });
    expect(mocks.runResearchAgent).toHaveBeenCalledWith(expect.objectContaining({
      task: 'Explain Alpha',
      workflowId: 'teaching-explain',
      workflowTitle: 'Teaching Explain',
      workflowInferred: true,
      generatePlan,
      generateOmittedSummary,
      plannerModel: 'OpenAI/gpt-test',
      contextBudgetProfileId: 'chat',
      continuation: {
        sourceSessionId: 'source-session-alpha',
        compactionId: 'source-compaction-alpha',
        sourceSummary: 'Alpha compacted summary.',
      },
    }));
    expect(result.plannerModelInfo).toMatchObject({ providerName: 'OpenAI', model: 'gpt-test' });
    expect(result.chatText).toContain('Agent session: research-session-chat');
    expect(result.chatText).toContain('Workflow: Teaching Explain (teaching-explain) [auto]');
    expect(result.chatText).toContain('Continuation: source-session-alpha / source-compaction-alpha');
    expect(result.chatText).toContain('Recovery: budget_exhausted - Observation replan budget is exhausted.');
    expect(result.chatText).toContain('Plan source: custom (OpenAI/gpt-test)');
    expect(result.chatText).toContain('- completed: Resolve evidence (evidence.resolve)');
    expect(result.chatText).not.toContain('Approval status:');
    expect(result.agentResult).toMatchObject({
      sessionId: 'research-session-chat',
      workflowLabel: 'Teaching Explain',
      workflowInferred: true,
      planSource: 'custom',
      recoverySummary: expect.stringContaining('Recovery: budget_exhausted'),
      continuation: {
        sourceSessionId: 'source-session-alpha',
        compactionId: 'source-compaction-alpha',
      },
      planSteps: [
        { title: 'Build context pack', status: 'completed' },
        { title: 'Resolve evidence', status: 'completed', toolName: 'evidence.resolve' },
      ],
      toolObservations: [
        {
          stepId: 'workspace-search',
          toolName: 'workspace.search',
          status: 'completed',
          preview: '2 matches.',
          evidenceCount: 0,
          resultStatus: 'completed',
          resultSummary: '2 indexed file matches.',
          resultMetricsPreview: 'items=2',
          resultArtifactsPreview: 'notes/alpha.md, notes/beta.md',
        },
      ],
    });
  });

  it('falls back to the deterministic plan when planner routing is unavailable', async () => {
    mocks.createResearchAgentPlannerGenerate.mockImplementation(() => {
      throw new Error('No provider configured');
    });
    mocks.runResearchAgent.mockResolvedValue(createResult({
      planSource: 'default',
      workflowId: 'teaching-explain',
      workflowTitle: 'Teaching Explain',
      workflowInferred: true,
    }));

    const result = await runResearchAgentForChat({
      settings,
      task: 'Explain Beta',
      query: 'Explain Beta',
    });

    expect(mocks.runResearchAgent).toHaveBeenCalledWith(expect.objectContaining({
      task: 'Explain Beta',
      workflowId: 'teaching-explain',
      workflowTitle: 'Teaching Explain',
      workflowInferred: true,
      generatePlan: undefined,
      plannerModel: undefined,
    }));
    expect(result.adapterWarnings[0]).toContain('LLM planner unavailable');
    expect(result.workflow?.id).toBe('teaching-explain');
    expect(result.workflowInferred).toBe(true);
    expect(result.chatText).toContain('Planner warnings: LLM planner unavailable');
  });

  it('injects workflow planner hints into surface research runs', async () => {
    const generatePlan = vi.fn();
    mocks.createResearchAgentPlannerGenerate.mockReturnValue({
      generatePlan,
      modelInfo: {
        providerId: 'openai',
        providerName: 'OpenAI',
        model: 'gpt-test',
        source: 'cloud',
      },
      policy: {
        taskType: 'research',
        preferredProvider: 'openai',
        fallbackProvider: null,
        maxContextTokens: 18000,
        evidenceRequired: true,
      },
    });
    mocks.runResearchAgent.mockResolvedValue(createResult({
      workflowId: 'notebook-analysis',
      workflowTitle: 'Notebook Analysis',
      workflowInferred: false,
    }));

    const result = await runResearchAgentForChat({
      settings,
      workflowId: 'notebook-analysis',
      task: 'Explain notebook results',
      query: 'What did the notebook show?',
      plannerHints: 'User-level hint: keep it short.',
      noteConfigOverrides: {
        sections: ['Observed results', 'Next experiment'],
      },
    });

    expect(mocks.runResearchAgent).toHaveBeenCalledWith(expect.objectContaining({
      task: 'Explain notebook results',
      generatePlan,
      plannerModel: 'OpenAI/gpt-test',
      workflowId: 'notebook-analysis',
      workflowTitle: 'Notebook Analysis',
      workflowInferred: false,
      includeWorkspaceSummary: true,
      contextBudgetProfileId: 'notebook',
      suggestMemory: true,
      plannerHints: expect.stringContaining('Workflow: Notebook Analysis (notebook-analysis)'),
      memoryQuery: expect.objectContaining({
        scopes: ['workspace', 'project', 'conversation', 'user'],
        workspaceKey: undefined,
        conversationId: undefined,
        limit: 6,
      }),
    }));
    const callInput = mocks.runResearchAgent.mock.calls[0][0];
    expect(callInput.plannerHints).toContain('User-level hint: keep it short.');
    expect(callInput.plannerHints).toContain('Allowed tools: workspace.search, workspace.readIndexedContext, lattice.resolvePathIdentity, evidence.resolve, runner.runCode, workbench.createProposal');
    expect(callInput.plannerHints).toContain('Approval policy: draft=ask, proposal=ask, runCode=ask, memory=ask');
    expect(callInput.plannerHints).toContain('Sections: Observed results, Next experiment');
    expect(result.workflow?.id).toBe('notebook-analysis');
    expect(result.workflowInferred).toBe(false);
    expect(result.workflowPlannerHints).toContain('Notebook Analysis');
    expect(result.draftSuggestion).toMatchObject({
      type: 'code_explainer',
      templateId: 'code-note',
      title: 'Notebook Analysis: Explain Alpha',
      targetPath: 'AI Drafts/Notebook Analysis Explain Alpha.md',
      writeMode: 'create',
    });
    expect(result.draftSuggestion?.content).toContain('> Workflow: Notebook Analysis');
    expect(result.draftSuggestion?.content).toContain('### Observed results');
    expect(result.draftSuggestion?.content).toContain('### Next experiment');
    expect(result.followUpActions.map((action) => action.kind)).toEqual(['create_draft']);
    expect(result.chatText).toContain('Workflow: Notebook Analysis (notebook-analysis)');
    expect(result.agentResult.workflowLabel).toBe('Notebook Analysis');
  });

  it('maps product workflows to focused Workbench follow-up actions', async () => {
    mocks.createResearchAgentPlannerGenerate.mockImplementation(() => {
      throw new Error('No provider configured');
    });
    mocks.runResearchAgent.mockResolvedValueOnce(createResult({
      workflowId: 'reading-note',
      workflowTitle: 'Reading Note',
    }));
    mocks.runResearchAgent.mockResolvedValueOnce(createResult({
      workflowId: 'literature-matrix',
      workflowTitle: 'Literature Matrix',
    }));
    mocks.runResearchAgent.mockResolvedValueOnce(createResult({
      workflowId: 'knowledge-organization',
      workflowTitle: 'Knowledge Organization',
    }));
    mocks.runResearchAgent.mockResolvedValueOnce(createResult({
      workflowId: 'teaching-explain',
      workflowTitle: 'Teaching Explain',
    }));

    const readingNote = await runResearchAgentForChat({
      settings,
      workflowId: 'reading-note',
      task: 'Summarize Alpha paper',
      query: 'Summarize Alpha paper',
    });
    const matrix = await runResearchAgentForChat({
      settings,
      workflowId: 'literature-matrix',
      task: 'Compare Alpha and Beta',
      query: 'Compare Alpha and Beta',
    });
    const organization = await runResearchAgentForChat({
      settings,
      workflowId: 'knowledge-organization',
      task: 'Organize Alpha notes',
      query: 'Organize Alpha notes',
    });
    const teaching = await runResearchAgentForChat({
      settings,
      workflowId: 'teaching-explain',
      task: 'Explain Alpha to students',
      query: 'Explain Alpha to students',
    });

    expect(readingNote.draftSuggestion).toMatchObject({
      type: 'paper_note',
      templateId: 'reading-note',
      title: 'Reading Note: Explain Alpha',
      targetPath: 'AI Drafts/Reading Note Explain Alpha.md',
      writeMode: 'create',
    });
    expect(readingNote.draftSuggestion?.content).toContain('> Workflow: Reading Note');
    expect(readingNote.draftSuggestion?.content).toContain('> Quote policy: evidence-table');
    expect(readingNote.draftSuggestion?.content).toContain('## Configured Sections');
    expect(matrix.draftSuggestion).toMatchObject({
      type: 'comparison_summary',
      templateId: 'comparison-summary',
      title: 'Literature Matrix: Explain Alpha',
      targetPath: 'AI Drafts/Literature Matrix Explain Alpha.md',
      writeMode: 'create',
    });
    expect(matrix.draftSuggestion?.content).toContain('> Workflow: Literature Matrix');
    expect(matrix.draftSuggestion?.content).toContain('## Evidence-backed draft');
    expect(organization.draftSuggestion).toBeUndefined();
    expect(organization.followUpActions).toEqual([
      { id: 'create-organization-proposal', label: '生成整理计划', kind: 'propose_task' },
    ]);
    expect(teaching.draftSuggestion).toBeUndefined();
    expect(teaching.followUpActions).toEqual([]);
  });

  it('maps markdown-research into an evidence-backed Workbench draft contract', async () => {
    mocks.createResearchAgentPlannerGenerate.mockImplementation(() => {
      throw new Error('No provider configured');
    });
    mocks.runResearchAgent.mockResolvedValue(createResult({
      workflowId: 'markdown-research',
      workflowTitle: 'Markdown Research',
      answer: [
        'Task: Explain Alpha',
        '',
        'Workflow output:',
        '- Alpha depends on source-backed notes.',
      ].join('\n'),
      promptContext: {
        nodes: [],
        prompt: 'resolved evidence context',
        evidenceRefs: [
          {
            kind: 'file',
            label: 'alpha.md',
            locator: 'notes/alpha.md',
            preview: 'Alpha evidence preview',
          },
        ],
        truncated: false,
      },
    }));

    const result = await runResearchAgentForChat({
      settings,
      workflowId: 'markdown-research',
      task: 'Summarize Alpha note',
      query: 'Summarize Alpha note',
    });

    expect(result.draftSuggestion).toMatchObject({
      type: 'research_summary',
      templateId: 'research-summary',
      title: 'Markdown Research: Explain Alpha',
      targetPath: 'AI Drafts/Markdown Research Explain Alpha.md',
      writeMode: 'create',
    });
    expect(result.draftSuggestion?.content).toContain('> Workflow: Markdown Research');
    expect(result.draftSuggestion?.content).toContain('> Quote policy: paraphrase-first');
    expect(result.draftSuggestion?.content).toContain('- Alpha depends on source-backed notes.');
    expect(result.draftSuggestion?.content).toContain('alpha.md (notes/alpha.md) - Alpha evidence preview');
    expect(result.followUpActions.map((action) => action.kind)).toEqual(['create_draft']);
  });

  it('applies note config overrides to draft path, sections, and quote policy', async () => {
    mocks.createResearchAgentPlannerGenerate.mockImplementation(() => {
      throw new Error('No provider configured');
    });
    mocks.runResearchAgent.mockResolvedValue(createResult({
      workflowId: 'reading-note',
      workflowTitle: 'Reading Note',
      contextPack: {
        ...createResult().contextPack,
        createdAt: Date.UTC(2026, 0, 15),
      },
    }));

    const result = await runResearchAgentForChat({
      settings,
      workflowId: 'reading-note',
      task: 'Draft Alpha reading note',
      query: 'Draft Alpha reading note',
      noteConfigOverrides: {
        fileNaming: 'date-title',
        quotePolicy: 'short-quotes-only',
        sections: ['Core claim', 'Evidence trail'],
      },
    });

    expect(result.draftSuggestion).toMatchObject({
      type: 'paper_note',
      templateId: 'reading-note',
      title: 'Reading Note: Explain Alpha',
      targetPath: 'AI Drafts/2026-01-15 Reading Note Explain Alpha.md',
      writeMode: 'create',
    });
    expect(result.draftSuggestion?.content).toContain('> Quote policy: short-quotes-only');
    expect(result.draftSuggestion?.content).toContain('### Core claim');
    expect(result.draftSuggestion?.content).toContain('### Evidence trail');
    expect(result.draftSuggestion?.content).not.toContain('### Methods / Setup');
  });

  it('scopes default memory reads to the current workspace and session without adding UI controls', async () => {
    mocks.createResearchAgentPlannerGenerate.mockImplementation(() => {
      throw new Error('No provider configured');
    });
    mocks.runResearchAgent.mockResolvedValue(createResult());

    await runResearchAgentForChat({
      settings,
      sessionId: 'chat-session-42',
      task: 'Summarize scoped Alpha research notes',
      query: 'Summarize scoped Alpha research notes',
      workspaceKey: 'workspace-alpha',
    });

    expect(mocks.runResearchAgent).toHaveBeenCalledWith(expect.objectContaining({
      memoryQuery: {
        scopes: ['workspace', 'project', 'conversation', 'user'],
        workspaceKey: 'workspace-alpha',
        conversationId: 'chat-session-42',
        limit: 6,
      },
    }));
  });

  it('preserves explicit memory queries from advanced callers', async () => {
    mocks.createResearchAgentPlannerGenerate.mockImplementation(() => {
      throw new Error('No provider configured');
    });
    mocks.runResearchAgent.mockResolvedValue(createResult());

    await runResearchAgentForChat({
      settings,
      task: 'Explain explicit memory',
      query: 'Explain explicit memory',
      workspaceKey: 'workspace-alpha',
      memoryQuery: {
        scopes: ['user'],
        limit: 2,
      },
    });

    expect(mocks.runResearchAgent).toHaveBeenCalledWith(expect.objectContaining({
      memoryQuery: {
        scopes: ['user'],
        limit: 2,
      },
    }));
  });

  it('includes planner warnings in the formatted answer', () => {
    const text = formatResearchAgentChatAnswer({
      result: createResult({
        planSource: 'fallback',
        planWarnings: ['Planner output did not contain JSON.'],
      }),
      plannerModel: null,
      adapterWarnings: ['Adapter unavailable.'],
    });

    expect(text).toContain('Plan source: fallback');
    expect(text).toContain('Planner warnings: Adapter unavailable. Planner output did not contain JSON.');
  });

  it('includes workflow metadata in the formatted answer', () => {
    const text = formatResearchAgentChatAnswer({
      result: createResult({
        workflowId: 'reading-note',
        workflowTitle: 'Reading Note',
      }),
    });

    expect(text).toContain('Workflow: Reading Note (reading-note)');
  });

  it('includes approval status in the formatted answer when approvals exist', () => {
    const text = formatResearchAgentChatAnswer({
      result: createResult({
        approvalSummary: {
          status: 'waiting_approval',
          totalApprovals: 1,
          pendingApprovals: 1,
          executingApprovals: 0,
          completedApprovals: 0,
          failedApprovals: 0,
          rejectedApprovals: 0,
          pendingToolNames: ['workbench.createDraft'],
          executingToolNames: [],
          completedToolNames: [],
          failedToolNames: [],
        },
      }),
    });

    expect(text).toContain('Approval status: waiting for 1 approval (workbench.createDraft).');
  });

  it('surfaces omitted context summaries in chat text and agent metadata', () => {
    const result = createResult({
      session: {
        ...createResult().session,
        trace: [
          {
            id: 'research-session-chat:context-pack',
            kind: 'planning',
            timestamp: 5,
            message: 'Context pack built.',
            metadata: {
              omittedContextModelSummary: 'Model summary: Alpha omitted material is mostly methods context.',
              omittedContextModelSummaryStatus: 'generated',
              omittedContextModelSummaryQualityStatus: 'healthy',
              omittedContextModelSummaryQualitySummary: 'Covers omitted methods and results cues.',
            },
          },
        ],
      },
      contextPack: {
        ...createResult().contextPack,
        omittedSummary: {
          ...createResult().contextPack.omittedSummary,
          totalOmittedCount: 3,
          totalOmittedTokens: 1800,
          preview: 'workspace_chunk: 3 omitted (notes/alpha.md; notes/beta.md)',
          autoSummaryPreview: 'workspace_chunk: methods and results notes were omitted.',
          recoveryPlanPreview: '1. read_indexed_context source=workspace_chunk label=notes/alpha.md',
        },
      },
    });

    const text = formatResearchAgentChatAnswer({ result });
    const metadata = buildResearchAgentResultMetadata({ result });

    expect(text).toContain('Context omitted: 3 items / 1800 tokens.');
    expect(text).toContain('Omitted preview: workspace_chunk: 3 omitted');
    expect(text).toContain('Recovery plan: 1. read_indexed_context');
    expect(metadata.contextSummary).toMatchObject({
      omittedCount: 3,
      omittedTokens: 1800,
      preview: expect.stringContaining('workspace_chunk: 3 omitted'),
      autoSummary: expect.stringContaining('methods and results notes'),
      modelSummary: expect.stringContaining('Model summary: Alpha omitted material'),
      modelSummaryStatus: 'generated',
      modelSummaryQuality: expect.stringContaining('healthy'),
      recoveryPlan: expect.stringContaining('read_indexed_context'),
    });
  });

  it('surfaces pending memory suggestions in chat text and agent metadata', () => {
    const result = createResult({
      session: {
        ...createResult().session,
        pendingApprovals: [
          {
            id: 'approval-memory-1',
            capability: 'memory_write',
            toolName: 'memory.write',
            request: {
              name: 'memory.write',
              args: {
                memory: {
                  id: 'memory-alpha',
                  title: 'Alpha finding',
                  content: 'Alpha reusable finding.',
                  scope: 'workspace',
                  source: {
                    kind: 'agent',
                    label: 'Research Agent',
                  },
                },
              },
            },
            decision: {
              capability: 'memory_write',
              permission: 'ask',
              requiresApproval: true,
              allowed: true,
            },
            status: 'pending',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      approvalSummary: {
        status: 'waiting_approval',
        totalApprovals: 1,
        pendingApprovals: 1,
        executingApprovals: 0,
        completedApprovals: 0,
        failedApprovals: 0,
        rejectedApprovals: 0,
        pendingToolNames: ['memory.write'],
        executingToolNames: [],
        completedToolNames: [],
        failedToolNames: [],
      },
    });

    const text = formatResearchAgentChatAnswer({ result });
    const metadata = buildResearchAgentResultMetadata({ result });

    expect(text).toContain('Memory suggestions: 1 pending (Alpha finding).');
    expect(metadata.memorySummary).toEqual({
      pendingSuggestionCount: 1,
      pendingSuggestionTitles: ['Alpha finding'],
    });
  });
});
