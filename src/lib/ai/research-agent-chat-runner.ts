import type {
  AiDraftSuggestion,
  AiFollowUpAction,
  AiModelInfo,
  AiRuntimeSettings,
} from './types';
import type { AgentResultMetadata } from '@/stores/ai-chat-store';
import {
  runResearchAgent,
  type ResearchAgentApprovalSummary,
  type ResearchAgentRunInput,
  type ResearchAgentRunResult,
} from './research-agent';
import type { AgentMemoryQuery } from './agent-memory';
import { createResearchAgentPlannerGenerate } from './research-agent-planner-provider';
import {
  buildResearchAgentWorkflowPlannerHints,
  getResearchAgentWorkflow,
  inferResearchAgentWorkflow,
  resolveNoteTakingSkillConfig,
  type NoteTakingSkillConfig,
  type ResearchAgentWorkflowId,
  type ResearchAgentWorkflowPreset,
} from './research-agent-workflows';
import { buildNoteTakingDraftSuggestion } from './lattice-skills/note-taking-draft-planner';

export interface ResearchAgentChatRunInput extends Omit<
  ResearchAgentRunInput,
  'generatePlan' | 'plannerModel' | 'plannerSignal'
> {
  settings: AiRuntimeSettings;
  plannerSignal?: AbortSignal;
  workflowId?: ResearchAgentWorkflowId;
  noteConfigOverrides?: Partial<NoteTakingSkillConfig>;
}

export type ResearchAgentSurfaceRunInput = ResearchAgentChatRunInput;

export interface ResearchAgentSurfaceRunResult {
  result: ResearchAgentRunResult;
  plannerModel: string | null;
  plannerModelInfo: AiModelInfo | null;
  adapterWarnings: string[];
  chatText: string;
  agentResult: AgentResultMetadata;
  followUpActions: AiFollowUpAction[];
  draftSuggestion?: AiDraftSuggestion;
  workflow: ResearchAgentWorkflowPreset | null;
  workflowPlannerHints: string | null;
  workflowInferred: boolean;
}

export type ResearchAgentChatRunResult = ResearchAgentSurfaceRunResult;

function formatApprovalTools(toolNames: string[]): string {
  return toolNames.length > 0 ? ` (${toolNames.join(', ')})` : '';
}

function formatApprovalSummaryLine(summary: ResearchAgentApprovalSummary): string | null {
  if (summary.totalApprovals === 0) {
    return null;
  }

  if (summary.status === 'failed') {
    const failedCount = summary.failedApprovals + summary.rejectedApprovals;
    return `Approval status: ${failedCount} approval${failedCount === 1 ? '' : 's'} failed${formatApprovalTools(summary.failedToolNames)}.`;
  }

  if (summary.status === 'waiting_approval') {
    return `Approval status: waiting for ${summary.pendingApprovals} approval${summary.pendingApprovals === 1 ? '' : 's'}${formatApprovalTools(summary.pendingToolNames)}.`;
  }

  if (summary.status === 'executing') {
    return `Approval status: ${summary.executingApprovals} approved tool${summary.executingApprovals === 1 ? '' : 's'} executing${formatApprovalTools(summary.executingToolNames)}.`;
  }

  if (summary.status === 'completed') {
    return `Approval status: ${summary.completedApprovals} approval${summary.completedApprovals === 1 ? '' : 's'} completed${formatApprovalTools(summary.completedToolNames)}.`;
  }

  return null;
}

function formatRecoverySummary(result: ResearchAgentRunResult): string | null {
  const recoveryEvent = result.session.trace
    .slice()
    .reverse()
    .find((event) =>
      typeof event.metadata?.observationRecoveryRecommendation === 'string' &&
      event.metadata.observationRecoveryRecommendation.trim().length > 0,
    );
  if (!recoveryEvent) {
    return null;
  }

  const recommendation = String(recoveryEvent.metadata?.observationRecoveryRecommendation ?? '').trim();
  const stopReason = typeof recoveryEvent.metadata?.observationReplanStopReason === 'string'
    ? recoveryEvent.metadata.observationReplanStopReason
    : null;
  return stopReason
    ? `Recovery: ${stopReason} - ${recommendation}`
    : `Recovery: ${recommendation}`;
}

function formatContextSummary(result: ResearchAgentRunResult): AgentResultMetadata['contextSummary'] | undefined {
  const omittedSummary = result.contextPack.omittedSummary;
  if (omittedSummary.totalOmittedCount <= 0) {
    return undefined;
  }

  const contextPackEvent = result.session.trace
    .slice()
    .reverse()
    .find((event) => event.id.endsWith(':context-pack'));
  const modelSummary = typeof contextPackEvent?.metadata?.omittedContextModelSummary === 'string'
    ? contextPackEvent.metadata.omittedContextModelSummary
    : undefined;
  const modelSummaryStatus = typeof contextPackEvent?.metadata?.omittedContextModelSummaryStatus === 'string'
    ? contextPackEvent.metadata.omittedContextModelSummaryStatus
    : undefined;
  const modelSummaryQualityStatus = typeof contextPackEvent?.metadata?.omittedContextModelSummaryQualityStatus === 'string'
    ? contextPackEvent.metadata.omittedContextModelSummaryQualityStatus
    : undefined;
  const modelSummaryQualitySummary = typeof contextPackEvent?.metadata?.omittedContextModelSummaryQualitySummary === 'string'
    ? contextPackEvent.metadata.omittedContextModelSummaryQualitySummary
    : undefined;
  const modelSummaryQuality = [
    modelSummaryQualityStatus,
    modelSummaryQualitySummary,
  ].filter((part): part is string => Boolean(part?.trim())).join(' - ') || undefined;

  return {
    omittedCount: omittedSummary.totalOmittedCount,
    omittedTokens: omittedSummary.totalOmittedTokens,
    preview: omittedSummary.preview.slice(0, 500) || undefined,
    autoSummary: omittedSummary.autoSummaryPreview.slice(0, 700) || undefined,
    modelSummary: modelSummary?.slice(0, 700),
    modelSummaryStatus,
    modelSummaryQuality,
    recoveryPlan: omittedSummary.recoveryPlanPreview.slice(0, 700) || undefined,
  };
}

function formatMemorySummary(result: ResearchAgentRunResult): AgentResultMetadata['memorySummary'] | undefined {
  const pendingSuggestions = result.session.pendingApprovals.filter((approval) =>
    approval.status === 'pending' &&
    approval.toolName === 'memory.write'
  );
  if (pendingSuggestions.length === 0) {
    return undefined;
  }

  const pendingSuggestionTitles = pendingSuggestions
    .map((approval) => {
      const args = approval.request.args;
      if (!args || typeof args !== 'object') {
        return null;
      }
      const memory = (args as { memory?: { title?: unknown } }).memory;
      return typeof memory?.title === 'string' ? memory.title.trim() : null;
    })
    .filter((title): title is string => Boolean(title))
    .slice(0, 4);

  return {
    pendingSuggestionCount: pendingSuggestions.length,
    pendingSuggestionTitles,
  };
}

function resolveSurfaceMemoryQuery(input: {
  explicitQuery?: AgentMemoryQuery;
  workflow?: ResearchAgentWorkflowPreset | null;
  workspaceKey?: string;
  sessionId?: string;
}): AgentMemoryQuery | undefined {
  if (input.explicitQuery) {
    return input.explicitQuery;
  }

  if (!input.workflow) {
    return input.workspaceKey || input.sessionId
      ? {
          scopes: ['workspace', 'project', 'conversation', 'user'],
          workspaceKey: input.workspaceKey,
          conversationId: input.sessionId,
          limit: 6,
        }
      : undefined;
  }

  return {
    scopes: input.workflow.contextProfile.memoryScopes,
    workspaceKey: input.workspaceKey,
    conversationId: input.sessionId,
    limit: 6,
  };
}

function buildWorkflowFollowUpActions(input: {
  workflow: ResearchAgentWorkflowPreset | null;
  result: ResearchAgentRunResult;
  draftSuggestion?: ResearchAgentSurfaceRunResult['draftSuggestion'];
}): AiFollowUpAction[] {
  const workflowId = input.workflow?.id ?? input.result.workflowId ?? 'markdown-research';
  const actions: AiFollowUpAction[] = [];

  if (input.draftSuggestion) {
    actions.push({
      id: 'create-workflow-draft',
      label: '保存为草稿',
      kind: 'create_draft',
    });
  }

  if (workflowId === 'knowledge-organization') {
    actions.push({
      id: 'create-organization-proposal',
      label: '生成整理计划',
      kind: 'propose_task',
    });
  }

  return actions;
}

export function formatResearchAgentChatAnswer(input: {
  result: ResearchAgentRunResult;
  plannerModel?: string | null;
  adapterWarnings?: string[];
}): string {
  const warnings = [
    ...(input.adapterWarnings ?? []),
    ...input.result.planWarnings,
  ];
  const planSummary = input.result.planSteps
    .map((step) => `- ${step.status}: ${step.title}${step.toolName ? ` (${step.toolName})` : ''}`)
    .join('\n');
  const workflowSummary = input.result.workflowId
    ? `Workflow: ${input.result.workflowTitle ?? input.result.workflowId}${input.result.workflowTitle ? ` (${input.result.workflowId})` : ''}${input.result.workflowInferred ? ' [auto]' : ''}`
    : null;
  const approvalSummary = formatApprovalSummaryLine(input.result.approvalSummary);
  const recoverySummary = formatRecoverySummary(input.result);
  const contextSummary = formatContextSummary(input.result);
  const memorySummary = formatMemorySummary(input.result);
  const continuationSummary = input.result.continuation
    ? `Continuation: ${input.result.continuation.sourceSessionId}${input.result.continuation.compactionId ? ` / ${input.result.continuation.compactionId}` : ''}`
    : null;
  const omittedSummary = contextSummary
    ? [
        `Context omitted: ${contextSummary.omittedCount} item${contextSummary.omittedCount === 1 ? '' : 's'} / ${contextSummary.omittedTokens} tokens.`,
        contextSummary.preview ? `Omitted preview: ${contextSummary.preview}` : null,
        contextSummary.recoveryPlan ? `Recovery plan: ${contextSummary.recoveryPlan}` : null,
      ].filter((line): line is string => Boolean(line)).join('\n')
    : null;
  const memoryLine = memorySummary
    ? `Memory suggestions: ${memorySummary.pendingSuggestionCount} pending${memorySummary.pendingSuggestionTitles?.length ? ` (${memorySummary.pendingSuggestionTitles.join(', ')})` : ''}.`
    : null;

  return [
    input.result.answer,
    '',
    '---',
    `Agent session: ${input.result.sessionId}`,
    workflowSummary,
    continuationSummary,
    approvalSummary,
    recoverySummary,
    omittedSummary,
    memoryLine,
    `Plan source: ${input.result.planSource}${input.plannerModel ? ` (${input.plannerModel})` : ''}`,
    warnings.length > 0 ? `Planner warnings: ${warnings.join(' ')}` : null,
    planSummary ? `Plan:\n${planSummary}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n');
}

export function buildResearchAgentResultMetadata(input: {
  result: ResearchAgentRunResult;
  adapterWarnings?: string[];
}): AgentResultMetadata {
  return {
    sessionId: input.result.sessionId,
    workflowLabel: input.result.workflowTitle ?? input.result.workflowId,
    workflowInferred: input.result.workflowInferred,
    planSource: input.result.planSource,
    approvalStatus: formatApprovalSummaryLine(input.result.approvalSummary) ?? undefined,
    recoverySummary: formatRecoverySummary(input.result) ?? undefined,
    contextSummary: formatContextSummary(input.result),
    memorySummary: formatMemorySummary(input.result),
    continuation: input.result.continuation,
    warnings: [
      ...(input.adapterWarnings ?? []),
      ...input.result.planWarnings,
    ],
    planSteps: input.result.planSteps.map((step) => ({
      title: step.title,
      status: step.status,
      toolName: step.toolName,
    })),
    toolObservations: input.result.toolObservations.map((observation) => ({
      stepId: observation.stepId,
      toolName: observation.toolName,
      status: observation.status,
      preview: observation.preview,
      evidenceCount: observation.evidenceCount,
      resultStatus: observation.resultStatus ?? undefined,
      resultSummary: observation.resultSummary ?? undefined,
      resultMetricsPreview: observation.resultMetricsPreview ?? undefined,
      resultArtifactsPreview: observation.resultArtifactsPreview ?? undefined,
      resultDiagnosticsPreview: observation.resultDiagnosticsPreview ?? undefined,
    })),
  };
}

export async function runResearchAgentForSurface(
  input: ResearchAgentSurfaceRunInput,
): Promise<ResearchAgentSurfaceRunResult> {
  const {
    settings,
    plannerSignal,
    workflowId,
    noteConfigOverrides,
    plannerHints,
    ...agentInput
  } = input;
  const adapterWarnings: string[] = [];
  let generatePlan: ResearchAgentRunInput['generatePlan'];
  let generateOmittedSummary: ResearchAgentRunInput['generateOmittedSummary'];
  let plannerModel: string | null = null;
  let plannerModelInfo: AiModelInfo | null = null;
  const inferredWorkflowId = workflowId ?? inferResearchAgentWorkflow({
    task: agentInput.task,
    query: agentInput.query,
    filePath: agentInput.filePath,
    content: agentInput.content,
    selection: agentInput.selection,
  });
  const workflowInferred = !workflowId;
  const workflow = getResearchAgentWorkflow(inferredWorkflowId);
  const noteConfig = resolveNoteTakingSkillConfig(workflow, noteConfigOverrides);
  const workflowPlannerHints = workflow
    ? buildResearchAgentWorkflowPlannerHints(
        workflow,
        noteConfig,
      )
    : null;
  const mergedPlannerHints = [
    plannerHints,
    workflowPlannerHints,
  ].filter((hint): hint is string => Boolean(hint?.trim())).join('\n\n') || undefined;

  try {
    const adapter = createResearchAgentPlannerGenerate(settings, {
      taskType: 'research',
    });
    generatePlan = adapter.generatePlan;
    generateOmittedSummary = adapter.generateOmittedSummary;
    plannerModelInfo = adapter.modelInfo;
    plannerModel = adapter.modelInfo.model
      ? `${adapter.modelInfo.providerName}/${adapter.modelInfo.model}`
      : adapter.modelInfo.providerName;
  } catch (error) {
    adapterWarnings.push(
      `LLM planner unavailable; using the deterministic research plan. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const result = await runResearchAgent({
    ...agentInput,
    generatePlan,
    generateOmittedSummary,
    plannerModel: plannerModel ?? undefined,
    plannerSignal,
    plannerHints: mergedPlannerHints,
    workflowId: workflow?.id,
    workflowTitle: workflow?.title,
    workflowInferred,
    title: agentInput.title ?? workflow?.traceLabels.run,
    suggestMemory: agentInput.suggestMemory ?? true,
    includeWorkspaceSummary: agentInput.includeWorkspaceSummary ?? workflow?.contextProfile.includeWorkspaceSummary,
    contextBudgetProfileId: agentInput.contextBudgetProfileId ?? workflow?.contextProfile.contextBudgetProfileId,
    memoryQuery: resolveSurfaceMemoryQuery({
      explicitQuery: agentInput.memoryQuery,
      workflow,
      workspaceKey: agentInput.workspaceKey,
      sessionId: agentInput.sessionId,
    }),
  });

  const draftSuggestion = buildNoteTakingDraftSuggestion({
    workflow,
    result,
    noteConfig,
  });

  return {
    result,
    plannerModel,
    plannerModelInfo,
    adapterWarnings,
    workflow,
    workflowPlannerHints,
    workflowInferred,
    agentResult: buildResearchAgentResultMetadata({
      result,
      adapterWarnings,
    }),
    followUpActions: buildWorkflowFollowUpActions({
      workflow,
      result,
      draftSuggestion,
    }),
    draftSuggestion,
    chatText: formatResearchAgentChatAnswer({
      result,
      plannerModel,
      adapterWarnings,
    }),
  };
}

export async function runResearchAgentForChat(
  input: ResearchAgentChatRunInput,
): Promise<ResearchAgentChatRunResult> {
  return runResearchAgentForSurface(input);
}
