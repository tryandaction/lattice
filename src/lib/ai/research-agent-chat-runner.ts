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
import { evaluateAiUsagePolicy } from './usage-policy';
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
import { buildWorkflowAnswerInstructions } from './research-workflow-answer';
import { preparePdfAnnotationProposal } from './pdf-annotation-agent';
import { verifiedPdfAnnotationToolDeliveries } from './pdf-annotation-tool-delivery';
import type { TransientPdfAnnotation } from './transient-pdf-annotations';
import { effectiveOutputTokenCeiling, outputTokenBudget } from './output-budget';
import { requestsMarkdownDocument } from './task-outcome';

export interface ResearchAgentChatRunInput extends Omit<
  ResearchAgentRunInput,
  'generatePlan' | 'plannerModel' | 'plannerSignal'
> {
  settings: AiRuntimeSettings;
  plannerSignal?: AbortSignal;
  workflowId?: ResearchAgentWorkflowId;
  noteConfigOverrides?: Partial<NoteTakingSkillConfig>;
  onProgress?: import('./types').AiGenerateOptions['onProgress'];
  responseMode?: 'conversation';
  images?: import('./types').AiContentPart[];
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
  annotationProposal?: TransientPdfAnnotation[];
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

  if (workflowId === 'code-change-plan') {
    actions.push({
      id: 'create-code-change-proposal',
      label: '生成代码变更计划',
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
  const directAnswer = input.result.answer.trim() || 'Research Agent did not return a readable answer. Please retry the question.';
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
    directAnswer,
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
    onProgress,
    responseMode,
    images,
    ...agentInput
  } = input;
  const adapterWarnings: string[] = [];
  let generatePlan: ResearchAgentRunInput['generatePlan'];
  let generateAnswer: ResearchAgentRunInput['generateAnswer'];
  let generateOmittedSummary: ResearchAgentRunInput['generateOmittedSummary'];
  let plannerModel: string | null = null;
  let plannerRequestModel: string | undefined;
  let plannerModelInfo: AiModelInfo | null = null;
  let answerTimeoutMs: number | undefined;
  let answerOutputCeiling = effectiveOutputTokenCeiling(settings.maxTokens);
  const inferredWorkflowId = workflowId ?? inferResearchAgentWorkflow({
    task: agentInput.task,
    query: agentInput.query,
    filePath: agentInput.filePath,
    content: agentInput.content,
    selection: agentInput.selection,
  });
  const workflowInferred = !workflowId;
  const workflow = getResearchAgentWorkflow(inferredWorkflowId);
  const markdownDocument = requestsMarkdownDocument(agentInput.task ?? agentInput.query ?? '');
  const noteConfig = resolveNoteTakingSkillConfig(workflow, noteConfigOverrides);
  const annotationLimit = noteConfigOverrides?.annotationLimit ?? 5;
  const answerConfig = { ...noteConfig, annotationLimit };
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
      onProgress,
      images,
    });
    generatePlan = adapter.generatePlan;
    generateAnswer = adapter.generateAnswer;
    answerTimeoutMs = adapter.answerTimeoutMs;
    answerOutputCeiling = effectiveOutputTokenCeiling(settings.maxTokens, adapter.maxOutputTokens);
    const omittedSummaryDecision = evaluateAiUsagePolicy({
      category: 'automatic-agent-omitted-summary',
      settings: {
        aiEnabled: settings.aiEnabled,
        aiInlineCompletionEnabled: false,
        aiAgentOmittedSummaryEnabled: settings.agentOmittedSummaryEnabled ?? false,
        aiModel: settings.model,
      },
      inputText: [
        agentInput.task,
        agentInput.query,
        agentInput.filePath,
        agentInput.selection,
      ].filter((value): value is string => Boolean(value)).join('\n'),
      maxOutputTokens: Math.min(settings.maxTokens, 700),
    });
    if (omittedSummaryDecision.allowed) {
      generateOmittedSummary = adapter.generateOmittedSummary;
    } else {
      adapterWarnings.push(`Omitted-context model summary skipped: ${omittedSummaryDecision.reason}`);
    }
    plannerModelInfo = adapter.modelInfo;
    plannerRequestModel = adapter.modelInfo.model ?? settings.model ?? undefined;
    plannerModel = adapter.modelInfo.model
      ? `${adapter.modelInfo.providerName}/${adapter.modelInfo.model}`
      : adapter.modelInfo.providerName;
  } catch (error) {
    throw new Error(`Agent model unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  const result = await runResearchAgent({
    ...agentInput,
    ...((agentInput.documentDirectory || agentInput.documentSources?.length && !agentInput.latticeSourcePdfRuntime && !agentInput.apiToolRuntime) ? {
      planSteps: agentInput.planSteps ?? [
        { id: 'context-pack', title: '确认文档范围', description: '核对授权文档和版本。' },
        { id: 'evidence-resolve', title: '分批阅读全文', description: '逐批分析正文，校验原文并保存覆盖检查点。', toolName: 'evidence.resolve' as const },
        { id: 'synthesize-answer', title: '汇总有依据的结果', description: '使用各批次笔记和经核验的原文生成结果。' },
      ],
      maxObservationReplans: 0,
    } : {}),
    generatePlan,
    generateAnswer,
    generateOmittedSummary,
    plannerModel: plannerRequestModel,
    plannerMaxTokens: agentInput.plannerMaxTokens ?? outputTokenBudget(settings.maxTokens, 'planning'),
    answerMaxTokens: outputTokenBudget(answerOutputCeiling, 'detailed'),
    answerRecoveryMaxTokens: answerOutputCeiling,
    answerTimeoutMs,
    requireAnswer: true,
    answerInstructions: [responseMode === 'conversation' && !markdownDocument && workflow?.id !== 'pdf-annotation'
      ? 'This is a conversational document question. Answer the latest question at its requested depth and honor explicit language or style preferences; otherwise mirror the language of the question. Explain mechanisms and supported derivations clearly, distinguishing evidence from deductions. Cite original passages. Do not output a reading-note template, annotation proposal or claim any file write.\n' + (settings.systemPrompt ?? '')
      : buildWorkflowAnswerInstructions(workflow, answerConfig, settings.systemPrompt, { markdownDocument }), agentInput.answerInstructions].filter(Boolean).join('\n\n'),
    validateAnswer: (answer, context, toolResults) => {
      agentInput.validateAnswer?.(answer, context, toolResults);
      const proposal = workflow?.id === 'pdf-annotation' ? preparePdfAnnotationProposal(answer, context.evidenceRefs, { maxAnnotations: annotationLimit }) : null;
      if (proposal && markdownDocument && !proposal.text.trim()) {
        throw new Error('缺少用户要求的 Markdown 讲解正文。请保留批注提案，同时补充有证据支持的完整讲解。');
      }
      if (proposal && !markdownDocument && proposal.annotations.length === 0 && !verifiedPdfAnnotationToolDeliveries(toolResults).length) {
        throw new Error('批注提案未通过原文或结构校验，本次没有写入。已读进度会保留，可继续重新生成建议。');
      }
    },
    plannerSignal,
    plannerHints: mergedPlannerHints,
    workflowId: workflow?.id,
    workflowTitle: workflow?.title,
    workflowInferred,
    title: agentInput.title ?? workflow?.traceLabels.run,
    suggestMemory: agentInput.suggestMemory ?? false,
    includeWorkspaceSummary: agentInput.includeWorkspaceSummary ?? workflow?.contextProfile.includeWorkspaceSummary,
    contextBudgetProfileId: agentInput.contextBudgetProfileId ?? workflow?.contextProfile.contextBudgetProfileId,
    memoryQuery: resolveSurfaceMemoryQuery({
      explicitQuery: agentInput.memoryQuery,
      workflow,
      workspaceKey: agentInput.workspaceKey,
      sessionId: agentInput.sessionId,
    }),
  });

  const annotationToolDeliveries = workflow?.id === 'pdf-annotation' ? verifiedPdfAnnotationToolDeliveries(result.toolResults) : [];
  const hasAnnotationToolDelivery = annotationToolDeliveries.length > 0;
  const annotationValidationWarnings: string[] = [];
  for (const receipt of result.toolResults ?? []) {
    if (receipt.status !== 'completed' || receipt.toolName !== 'lattice.pdf.proposeAnnotations' || !receipt.result || typeof receipt.result !== 'object') continue;
    const validation = (receipt.result as { annotationValidation?: { acceptedCount: number; rejectedCount: number } }).annotationValidation;
    if (validation && validation.rejectedCount > 0) annotationValidationWarnings.push(noteConfig.language === 'en-US'
      ? `${validation.acceptedCount} verified annotation draft${validation.acceptedCount === 1 ? '' : 's'} retained for review; ${validation.rejectedCount} suggestion${validation.rejectedCount === 1 ? '' : 's'} could not be located in the original text and ${validation.rejectedCount === 1 ? 'was' : 'were'} excluded. No annotations have been applied.`
      : `已保留 ${validation.acceptedCount} 条通过原文核验的批注草稿；另有 ${validation.rejectedCount} 条未能定位，已排除。请审查有效草稿后应用，本次尚未写入批注。`);
  }
  adapterWarnings.push(...annotationValidationWarnings);
  const annotationValidationNotice = annotationValidationWarnings.length ? `\n\n${annotationValidationWarnings.join('\n\n')}` : '';

  const draftSuggestion = result.documentReading?.resumable || responseMode === 'conversation' && !markdownDocument ? undefined : buildNoteTakingDraftSuggestion({
    workflow,
    result,
    noteConfig,
  });
  const annotationProposal = workflow?.id === 'pdf-annotation' && !result.documentReading?.resumable && !hasAnnotationToolDelivery
    ? preparePdfAnnotationProposal(result.answer, result.promptContext.evidenceRefs, { maxAnnotations: annotationLimit })
    : null;
  if (annotationProposal && !markdownDocument && annotationProposal.annotations.length === 0) {
    throw new Error('批注提案未通过原文或结构校验，本次没有写入。已读进度会保留，可继续重新生成建议。');
  }

  const readingEvidenceGap = result.documentReading?.evidenceIssues.length
    ? `阅读过程中另有 ${result.documentReading.evidenceIssues.length} 条证据未通过原文校验，已排除；详见阅读进度中的证据缺口。`
    : '';

  return {
    result,
    plannerModel,
    plannerModelInfo,
    adapterWarnings,
    workflow,
    workflowPlannerHints,
    workflowInferred,
    agentResult: { ...buildResearchAgentResultMetadata({
      result,
      adapterWarnings,
    }), ...(hasAnnotationToolDelivery ? { deliveryStatus: annotationToolDeliveries.some(delivery => delivery.rejectedCount > 0) ? 'partial' as const : 'ready_for_review' as const }
      : annotationProposal ? { deliveryStatus: annotationProposal.annotations.length ? 'ready_for_review' as const : 'partial' as const } : {}) },
    followUpActions: buildWorkflowFollowUpActions({
      workflow,
      result,
      draftSuggestion,
    }),
    draftSuggestion,
    annotationProposal: annotationProposal?.annotations,
    chatText: hasAnnotationToolDelivery
      ? `${preparePdfAnnotationProposal(result.answer, result.promptContext.evidenceRefs, { maxAnnotations: annotationLimit }).text}\n\n${noteConfig.language === 'en-US'
        ? 'Verified annotation drafts are ready in AI Workbench. Open this message’s draft to review and apply them; no annotations have been written to the PDF.'
        : '已将通过原文核验的批注草稿提交 AI 工作台。请打开当前消息的草稿审查后应用，尚未写入 PDF。'}${annotationValidationNotice}`
      : annotationProposal
      ? `${markdownDocument ? `${annotationProposal.text}\n\nMarkdown 讲解已生成，尚未保存为文件。\n\n` : ''}${result.documentReading ? `已分析 ${result.documentReading.coverage.reduce((sum, item) => sum + item.readUnits.length, 0)}/${result.documentReading.coverage.reduce((sum, item) => sum + item.totalUnits, 0)} 页/节。` : ''}${annotationProposal.annotations.length ? `已生成 ${annotationProposal.annotations.length} 条原文高亮建议，尚未写入 PDF。请核对下方引文与理由后应用。` : '批注未就绪：没有建议通过原文与结构校验，本次没有写入 PDF；Markdown 讲解已保留。'}${readingEvidenceGap}${annotationProposal.rejectedCount ? `另有 ${annotationProposal.rejectedCount} 条建议未通过原文校验，已排除。` : ''}${annotationProposal.limitedCount ? `按本次数量上限保留了最先列出的建议；另有 ${annotationProposal.limitedCount} 条未列入。` : ''}${annotationValidationNotice}`
      : responseMode === 'conversation' && result.answer.trim()
      ? `${result.answer.trim()}${annotationValidationNotice}`
      : formatResearchAgentChatAnswer({
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
