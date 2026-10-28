import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResearchAgentRunInput, ResearchAgentRunResult } from '../ai/research-agent';
import type { AiRuntimeSettings } from '../ai/types';
import { buildCitationContract } from '../ai/citation-contract';

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

it('bounds both Agent initial output and empty-output recovery to the routed model ceiling', async () => {
  mocks.runResearchAgent.mockResolvedValue(createResult());
  mocks.createResearchAgentPlannerGenerate.mockReturnValue({
    generatePlan:vi.fn(), generateAnswer:vi.fn(), generateOmittedSummary:vi.fn(), maxOutputTokens:8192,
    modelInfo:{providerId:'custom',providerName:'Synthetic gateway',model:'test-model',source:'cloud'},
    policy:{taskType:'research',preferredProvider:null,fallbackProvider:null,maxContextTokens:18000,evidenceRequired:true},
  });
  await runResearchAgentForChat({settings:{...settings,maxTokens:128000},task:'Explain the supplied mechanism',content:'Actual synthetic evidence.'});
  expect(mocks.runResearchAgent).toHaveBeenLastCalledWith(expect.objectContaining({answerMaxTokens:8192,answerRecoveryMaxTokens:8192}));
});

describe('research-agent-chat-runner', () => {
  it('keeps execution trace metadata out of conversational document answers and history', async () => {
    mocks.runResearchAgent.mockResolvedValue(createResult());
    const result = await runResearchAgentForChat({ settings, responseMode: 'conversation', workflowId: 'paper-reading', task: 'Explain this paper in detail', content: 'Actual evidence.' });
    expect(result.chatText).toBe('Alpha improves evidence grounding and reproducibility.');
    expect(result.agentResult.sessionId).toBe('research-session-chat');
    expect(result.draftSuggestion).toBeUndefined();
  });

  it('keeps an explicit named Markdown PDF child deliverable in automatic document chat', async () => {
    const task = '在当前 PDF 下创建 note.md 子文件，内容包含讲解、表格、公式和代码';
    const base = createResult();
    mocks.runResearchAgent.mockResolvedValue(createResult({ session: { ...base.session, task },
      promptContext: { ...base.promptContext, evidenceRefs: [{ kind: 'pdf_page', label: 'paper.pdf', locator: 'paper.pdf#page=1', anchor: { page: 1, snippet: 'Actual source.' } }] } }));
    const result = await runResearchAgentForChat({ settings, responseMode: 'conversation', workflowId: 'paper-reading', task, filePath: 'paper.pdf' });
    expect(result.draftSuggestion).toMatchObject({ pdfChildTarget: { sourcePath: 'paper.pdf', suggestedTargetPath: '.lattice/items/paper.pdf/note.md' }, writeMode: 'create' });
    expect(result.draftSuggestion?.content).toContain('Alpha improves');
  });

  it('passes usable note requirements into answer synthesis instead of only into planning', async () => {
    mocks.createResearchAgentPlannerGenerate.mockReturnValue({ generatePlan: vi.fn(), generateAnswer: vi.fn(), modelInfo: { providerId: 'openai', providerName: 'OpenAI', model: 'gpt-test', source: 'cloud' } });
    mocks.runResearchAgent.mockResolvedValue(createResult({ answer: 'A grounded note.' }));
    await runResearchAgentForChat({ settings, workflowId: 'reading-note', noteConfigOverrides: { language: 'en-US', sections: ['Findings', 'Limitations'], template: '## Findings\n{{findings}}' }, task: 'Write a useful reading note', content: 'Actual evidence.' });
    const input = mocks.runResearchAgent.mock.calls[0][0];
    expect(input.requireAnswer).toBe(true);
    expect(input.answerInstructions).toContain('English');
    expect(input.answerInstructions).toContain('Findings');
    expect(input.answerInstructions).toContain('Limitations');
    expect(input.answerInstructions).toContain('{{findings}}');
    expect(input.answerInstructions).toContain('Do not claim');
  });

  it.each(['glm-5.3', 'vendor/model:v2'])('keeps the provider display name out of the actual model request: %s', async (model) => {
    mocks.createResearchAgentPlannerGenerate.mockReturnValue({
      generatePlan: vi.fn(), generateAnswer: vi.fn(),
      modelInfo: { providerId: 'custom', providerName: 'Custom Provider', model, source: 'cloud' },
    });
    mocks.runResearchAgent.mockResolvedValue(createResult());
    const result = await runResearchAgentForChat({ settings: { ...settings, providerId: 'custom', model }, task: 'Read and annotate', content: 'Actual source text' });
    expect(mocks.runResearchAgent).toHaveBeenCalledWith(expect.objectContaining({ plannerModel: model }));
    expect(result.plannerModel).toBe(`Custom Provider/${model}`);
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.createResearchAgentPlannerGenerate.mockReturnValue({
      generatePlan: vi.fn(), generateAnswer: vi.fn(), generateOmittedSummary: vi.fn(),
      modelInfo: { providerId: 'openai', providerName: 'OpenAI', model: 'gpt-test', source: 'cloud' },
    });
  });

  it('turns validated PDF annotation output into a reviewable proposal without exposing JSON or claiming writes', async () => {
    const quote = 'The measured magnetic field was 58 G throughout the experiment.';
    const evidenceRef = { kind: 'pdf_page' as const, label: 'Paper p.4', locator: 'papers/source.pdf#page=4', preview: quote, anchor: { page: 4 } };
    const sourceId = buildCitationContract(evidenceRef).stableId;
    const answer = `I have highlighted the entire paper.\n\n\`\`\`lattice-annotations\n${JSON.stringify({ annotations: [{ sourceId, page: 4, quote, reason: 'Records the field used in the measurement.' }] })}\n\`\`\``;
    const context = { nodes: [], prompt: quote, evidenceRefs: [evidenceRef], truncated: false };
    const validateAnswer = vi.fn();
    mocks.runResearchAgent.mockImplementation(async (input: ResearchAgentRunInput) => {
      input.validateAnswer?.(answer, context);
      return createResult({ answer, promptContext: context, workflowId: 'pdf-annotation' });
    });
    const result = await runResearchAgentForChat({ settings, workflowId: 'pdf-annotation', task: 'Highlight the key results', filePath: 'papers/source.pdf', content: quote, validateAnswer });
    expect(validateAnswer).toHaveBeenCalledWith(answer, context, undefined);
    expect(result.annotationProposal).toEqual([expect.objectContaining({ documentPath: 'papers/source.pdf', page: 4, quote, reason: 'Records the field used in the measurement.', rects: [] })]);
    expect(result.chatText).toContain('1 条原文高亮建议');
    expect(result.chatText).toContain('尚未写入 PDF');
    expect(result.chatText).not.toContain('lattice-annotations');
    expect(result.chatText).not.toContain(sourceId);
    expect(result.chatText).not.toContain('highlighted the entire paper');
    expect(result.draftSuggestion).toBeUndefined();
    expect(result.followUpActions).toEqual([]);
  });

  it('keeps automatic full-paper annotation proposals selective instead of expanding the quota by page count', async () => {
    const source = { path: 'papers/source.pdf', kind: 'pdf' as const, version: 'synthetic-v1', totalUnits: 15, unitLabel: 'page' as const,
      readUnit: vi.fn(), close: vi.fn() };
    const refs = Array.from({ length: 6 }, (_, index) => {
      const page = index + 1, quote = `Synthetic central result ${page} is verified on this page.`;
      return { kind: 'pdf_page' as const, label: `Paper p.${page}`, locator: `papers/source.pdf#page=${page}`, preview: quote, anchor: { page, snippet: quote } };
    });
    const proposals = refs.map((ref, index) => ({ sourceId: buildCitationContract(ref).stableId, passageId: buildCitationContract(ref).stableId,
      reason: `Core result ${index + 1} matters.` }));
    const answer = `Explanation from verified evidence.\n\n\`\`\`lattice-annotations\n${JSON.stringify({ annotations: proposals })}\n\`\`\``;
    const context = { nodes: [], prompt: 'Synthetic full-paper context', evidenceRefs: refs, truncated: false };
    mocks.runResearchAgent.mockImplementation(async (input: ResearchAgentRunInput) => {
      input.validateAnswer?.(answer, context);
      return createResult({ answer, promptContext: context, workflowId: 'pdf-annotation' });
    });
    const result = await runResearchAgentForChat({ settings, workflowId: 'pdf-annotation', task: '批注本文核心', documentSources: [source] });
    expect(result.annotationProposal).toHaveLength(5);
    expect(result.chatText).toContain('按本次数量上限保留了最先列出的建议；另有 1 条未列入');
    expect(mocks.runResearchAgent.mock.calls[0][0].answerInstructions).toContain('at most 5');
    expect(mocks.runResearchAgent.mock.calls[0][0].answerInstructions).not.toContain('at most 12');
    expect(mocks.runResearchAgent.mock.calls[0][0].answerInstructions).toContain('independent of its page count');
    expect(mocks.runResearchAgent.mock.calls[0][0].answerInstructions).toContain('never isolated rows or a partial matrix');
    expect(mocks.runResearchAgent.mock.calls[0][0].answerInstructions).toContain('exclude adjacent follow-on text');
  });

  it('rejects invalid annotation output through the engine validator before returning a surface result', async () => {
    let returnedFromEngine = false;
    mocks.runResearchAgent.mockImplementation(async (input: ResearchAgentRunInput) => {
      const answer = '```lattice-annotations\n{"annotations":[]}\n```';
      input.validateAnswer?.(answer, createResult().promptContext);
      returnedFromEngine = true;
      return createResult({ answer, workflowId: 'pdf-annotation' });
    });
    await expect(runResearchAgentForChat({ settings, workflowId: 'pdf-annotation', task: 'Highlight the key results', filePath: 'papers/source.pdf' })).rejects.toThrow('批注提案未通过原文或结构校验');
    expect(returnedFromEngine).toBe(false);
    expect(mocks.runResearchAgent.mock.calls[0][0]).toEqual(expect.objectContaining({ requireAnswer: true, validateAnswer: expect.any(Function) }));
  });

  it.each([true, false])('delivers the requested Markdown independently of annotation validity: %s', async (valid) => {
    const task = '阅读并批注本文要点，尤其门实现原理以及保真度、鲁棒性。并生成一个md子文档详细讲解本文';
    const quote = 'The measured magnetic field was 58 G throughout the experiment.';
    const ref = { kind: 'pdf_page' as const, label: 'Paper', locator: 'atom/papers/source.pdf#page=4', preview: quote, anchor: { page: 4, snippet: quote } };
    const id = buildCitationContract(ref).stableId;
    const note = '## 实现原理\n正文解释实验条件及其适用范围。\n\n## 鲁棒性\n区分原文已验证的条件和仍待验证的误差来源。';
    const answer = note + '\n\n```lattice-annotations\n' + JSON.stringify({ annotations: [{ sourceId: valid ? id : 'invalid', passageId: id, reason: '实验复现条件。' }] }) + '\n```';
    const context = { nodes: [], prompt: quote, evidenceRefs: [ref], truncated: false };
    mocks.runResearchAgent.mockImplementation(async (input: ResearchAgentRunInput) => {
      input.validateAnswer?.(answer, context);
      return createResult({ answer, promptContext: context, workflowId: 'pdf-annotation', session: { ...createResult().session, task } });
    });
    const result = await runResearchAgentForChat({ settings, task, filePath: 'atom/papers/source.pdf', workflowId: 'pdf-annotation' });
    expect(result.draftSuggestion).toMatchObject({ content: note, targetPath: '.lattice/items/atom-papers-source.pdf/source Reading Note.md', writeMode: 'create',
      pdfChildTarget: { sourcePath: 'atom/papers/source.pdf', suggestedTargetPath: '.lattice/items/atom-papers-source.pdf/source Reading Note.md' } });
    expect(result.chatText).toContain(note);
    expect(result.chatText).not.toContain('lattice-annotations');
    expect(result.annotationProposal).toHaveLength(valid ? 1 : 0);
    expect(result.followUpActions.map(action => action.kind)).toContain('create_draft');
    expect(mocks.runResearchAgent.mock.calls[0][0].answerInstructions).toContain('complete Markdown');
    if (!valid) expect(result.chatText).toContain('批注未就绪');
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
      generateOmittedSummary: undefined,
      plannerModel: 'gpt-test',
      contextBudgetProfileId: 'chat',
      continuation: {
        sourceSessionId: 'source-session-alpha',
        compactionId: 'source-compaction-alpha',
        sourceSummary: 'Alpha compacted summary.',
      },
    }));
    expect(generateOmittedSummary).not.toHaveBeenCalled();
    expect(result.adapterWarnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Omitted-context model summary skipped'),
    ]));
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

  it('passes omitted-context model summary generation only when explicitly enabled', async () => {
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
    mocks.runResearchAgent.mockResolvedValue(createResult());

    const result = await runResearchAgentForChat({
      settings: {
        ...settings,
        agentOmittedSummaryEnabled: true,
      },
      task: 'Explain Alpha',
      query: 'Explain Alpha',
      content: 'Alpha content',
    });

    expect(mocks.runResearchAgent).toHaveBeenCalledWith(expect.objectContaining({
      generatePlan,
      generateOmittedSummary,
    }));
    expect(result.adapterWarnings).not.toEqual(expect.arrayContaining([
      expect.stringContaining('Omitted-context model summary skipped'),
    ]));
  });

  it('reports an unavailable model instead of presenting a deterministic context dump as an answer', async () => {
    mocks.createResearchAgentPlannerGenerate.mockImplementation(() => {
      throw new Error('No provider configured');
    });
    mocks.runResearchAgent.mockResolvedValue(createResult({
      planSource: 'default',
      workflowId: 'teaching-explain',
      workflowTitle: 'Teaching Explain',
      workflowInferred: true,
    }));

    await expect(runResearchAgentForChat({
      settings,
      task: 'Explain Beta',
      query: 'Explain Beta',
    })).rejects.toThrow('Agent model unavailable: No provider configured');
    expect(mocks.runResearchAgent).not.toHaveBeenCalled();
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
      plannerModel: 'gpt-test',
      workflowId: 'notebook-analysis',
      workflowTitle: 'Notebook Analysis',
      workflowInferred: false,
      includeWorkspaceSummary: true,
      contextBudgetProfileId: 'notebook',
      suggestMemory: false,
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
    expect(result.draftSuggestion?.content).toBe(createResult().answer);
    expect(callInput.answerInstructions).toContain('Observed results');
    expect(callInput.answerInstructions).toContain('Next experiment');
    expect(result.followUpActions.map((action) => action.kind)).toEqual(['create_draft']);
    expect(result.chatText).toContain('Workflow: Notebook Analysis (notebook-analysis)');
    expect(result.agentResult.workflowLabel).toBe('Notebook Analysis');
  });

  it('maps product workflows to focused Workbench follow-up actions', async () => {
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
      workflowId: 'code-change-plan',
      workflowTitle: 'Code Change Plan',
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
    const codePlan = await runResearchAgentForChat({
      settings,
      workflowId: 'code-change-plan',
      task: 'Review src/lib/agent.ts and prepare a patch plan',
      query: 'Review src/lib/agent.ts and prepare a patch plan',
      filePath: 'src/lib/agent.ts',
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
    expect(readingNote.draftSuggestion?.content).toBe(createResult().answer);
    expect(readingNote.draftSuggestion?.content).not.toContain('Configured Sections');
    expect(matrix.draftSuggestion).toMatchObject({
      type: 'comparison_summary',
      templateId: 'comparison-summary',
      title: 'Literature Matrix: Explain Alpha',
      targetPath: 'AI Drafts/Literature Matrix Explain Alpha.md',
      writeMode: 'create',
    });
    expect(matrix.draftSuggestion?.content).toBe(createResult().answer);
    expect(organization.draftSuggestion).toBeUndefined();
    expect(organization.followUpActions).toEqual([
      { id: 'create-organization-proposal', label: '生成整理计划', kind: 'propose_task' },
    ]);
    expect(codePlan.draftSuggestion).toBeUndefined();
    expect(codePlan.followUpActions.map((action) => action.id)).toEqual(['create-code-change-proposal']);
    expect(codePlan.followUpActions.map((action) => action.kind)).toEqual(['propose_task']);
    expect(teaching.draftSuggestion).toBeUndefined();
    expect(teaching.followUpActions).toEqual([]);
  });

  it('maps markdown-research into an evidence-backed Workbench draft contract', async () => {
    mocks.runResearchAgent.mockResolvedValue(createResult({
      workflowId: 'markdown-research',
      workflowTitle: 'Markdown Research',
      answer: [
        '## Findings',
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
    expect(result.draftSuggestion?.content).toBe('## Findings\n- Alpha depends on source-backed notes.');
    expect(result.draftSuggestion?.content).not.toContain('Alpha evidence preview');
    expect(result.followUpActions.map((action) => action.kind)).toEqual(['create_draft']);
  });

  it('applies note config overrides to draft path, sections, and quote policy', async () => {
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
    expect(result.draftSuggestion?.content).toBe(createResult().answer);
    const callInput = mocks.runResearchAgent.mock.calls[0][0];
    expect(callInput.answerInstructions).toContain('Core claim');
    expect(callInput.answerInstructions).toContain('Evidence trail');
    expect(callInput.answerInstructions).toContain('short-quotes-only');
  });

  it('scopes default memory reads to the current workspace and session without adding UI controls', async () => {
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

  it('keeps the Agent answer visible when synthesis returns empty text', () => {
    const text = formatResearchAgentChatAnswer({
      result: createResult({ answer: '' }),
    });

    expect(text.split('\n')[0]).toContain('Research Agent did not return a readable answer.');
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
