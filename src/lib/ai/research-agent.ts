import {
  buildAgentContextPack,
  type AgentContextPack,
  type AgentContextPackBudget,
} from './agent-context-pack';
import {
  resolveAgentContextBudget,
  type AgentContextBudgetProfileId,
} from './agent-context-budget-profiles';
import {
  executeAgentTool,
  type AgentToolExecutionResult,
} from './agent-tool-broker';
import { agentErrorMetadata, classifyAgentError } from './agent-error';
import {
  buildAgentMemorySourceFingerprint,
  buildAgentMemorySuggestion,
  evaluateAgentMemoryLifecycle,
  evaluateAgentMemorySuggestion,
  rankAgentMemoryEntriesForContext,
  type AgentMemoryQuery,
  type AgentMemoryRankingItem,
} from './agent-memory';
import type { AgentPendingApproval, AgentSession } from './agent-session';
import {
  parseResearchAgentPlannerOutput,
  runResearchAgentPlanner,
  type ResearchAgentPlannerGenerate,
} from './research-agent-llm-planner';
import {
  buildDefaultResearchAgentPlanSteps,
  normalizeResearchAgentPlan,
  updateResearchAgentPlanStepStatus,
  type ResearchAgentPlanStep,
  type ResearchAgentPlanStepInput,
  type ResearchAgentPlanStepStatus,
} from './research-agent-planner';
import {
  getOrBuildWorkspaceSummary,
  type WorkspaceSummaryCacheEntry,
} from './workspace-summary-cache';
import {
  getWorkspaceIndex,
  type WorkspaceIndex,
} from './workspace-indexer';
import {
  buildEvidenceResolveRequest,
  runResearchAgentReadToolLoop,
  type ResearchAgentReadToolLoopResult,
  type ResearchAgentPlannedToolSummary,
  type ResearchAgentToolObservation,
} from './research-agent-tool-loop';
import type {
  AiDraftArtifact,
  AiPromptContext,
  AiTaskProposal,
  EvidenceRef,
} from './types';
import { useAgentMemoryStore } from '@/stores/agent-memory-store';
import { useAgentSessionStore } from '@/stores/agent-session-store';

export type {
  ResearchAgentPlan,
  ResearchAgentPlanContext,
  ResearchAgentPlanStep,
  ResearchAgentPlanStepInput,
  ResearchAgentPlanStepStatus,
} from './research-agent-planner';
export {
  buildResearchAgentPlannerPrompt,
  parseResearchAgentPlannerOutput,
  runResearchAgentPlanner,
  type ResearchAgentPlannerGenerate,
} from './research-agent-llm-planner';

export interface ResearchAgentArtifactRequest {
  draft?: Omit<AiDraftArtifact, 'id' | 'createdAt' | 'status'>;
  proposal?: AiTaskProposal;
  approvedByUser?: boolean;
  approvalNote?: string;
}

export interface ResearchAgentContinuationContext {
  sourceSessionId: string;
  compactionId?: string;
  sourceSummary?: string;
}

interface ResearchAgentContinuationRecovery {
  summary: string | null;
  plannerSummary?: string;
  recoveryHintsPreview?: string;
  recoveryPriorityPreview?: string;
  recoveryPlanPreview?: string;
  autoSummaryPreview?: string;
  modelSummaryPreview?: string;
  semanticPreview?: string;
  evidenceRefs: EvidenceRef[];
  heavyInput?: {
    id: string;
    label: string;
    content: string;
  };
}

type ResearchAgentRecoveryQualityStatus =
  | 'not_needed'
  | 'complete'
  | 'partial'
  | 'weak'
  | 'missing';

interface ResearchAgentRecoveryQuality {
  status: ResearchAgentRecoveryQualityStatus;
  plannedCount: number;
  observedCount: number;
  coveredCount: number;
  lowValueCount: number;
  missingLocators: string[];
  summary: string;
}

interface ResearchAgentRecoveredContextDigest {
  count: number;
  completedCount: number;
  usefulCount: number;
  lowValueCount: number;
  locatorsPreview: string | null;
  summary: string | null;
  answerSection: string | null;
  memoryLine: string | null;
}

export interface ResearchAgentOmittedModelSummaryGenerateInput {
  task: string;
  query: string;
  contextPackId: string;
  omittedContextCount: number;
  omittedContextTokens: number;
  omittedContextPreview: string;
  omittedAutoSummary: string;
  omittedSemanticPreview: string;
  omittedRecoveryPlan: string;
  signal?: AbortSignal;
}

export type ResearchAgentOmittedModelSummaryGenerate = (
  input: ResearchAgentOmittedModelSummaryGenerateInput,
) => Promise<string>;

type ResearchAgentOmittedModelSummaryStatus =
  | 'not_needed'
  | 'skipped'
  | 'generated'
  | 'failed';

type ResearchAgentOmittedModelSummaryQualityStatus =
  | 'not_needed'
  | 'skipped'
  | 'healthy'
  | 'partial'
  | 'weak'
  | 'failed';

interface ResearchAgentOmittedModelSummaryQuality {
  status: ResearchAgentOmittedModelSummaryQualityStatus;
  score: number;
  reasons: string[];
  summary: string;
}

interface ResearchAgentOmittedModelSummary {
  status: ResearchAgentOmittedModelSummaryStatus;
  summary: string | null;
  warning: string | null;
  quality: ResearchAgentOmittedModelSummaryQuality;
}

export interface ResearchAgentRunInput {
  sessionId?: string;
  contextPackId?: string;
  task?: string;
  title?: string;
  query?: string;
  filePath?: string;
  content?: string;
  selection?: string;
  explicitEvidenceRefs?: EvidenceRef[];
  memoryQuery?: AgentMemoryQuery;
  workspaceKey?: string;
  workspaceIndex?: WorkspaceIndex;
  includeWorkspaceSummary?: boolean;
  contextBudgetProfileId?: AgentContextBudgetProfileId;
  contextBudget?: AgentContextPackBudget;
  artifacts?: ResearchAgentArtifactRequest;
  plannerOutput?: string;
  generatePlan?: ResearchAgentPlannerGenerate;
  generateOmittedSummary?: ResearchAgentOmittedModelSummaryGenerate;
  plannerModel?: string;
  plannerTemperature?: number;
  plannerMaxTokens?: number;
  plannerSignal?: AbortSignal;
  plannerHints?: string;
  workflowId?: string;
  workflowTitle?: string;
  workflowInferred?: boolean;
  continuation?: ResearchAgentContinuationContext;
  planSteps?: ResearchAgentPlanStepInput[];
  maxObservationReplans?: number;
  suggestMemory?: boolean;
  compact?: boolean;
  maxTraceEvents?: number;
  retainRecentEvents?: number;
  maxReadToolSteps?: number;
  now?: number;
}

export interface ResearchAgentRunResult {
  sessionId: string;
  session: AgentSession;
  approvalSummary: ResearchAgentApprovalSummary;
  contextPack: AgentContextPack;
  promptContext: AiPromptContext;
  answer: string;
  planSteps: ResearchAgentPlanStep[];
  planSource: 'default' | 'custom' | 'fallback';
  planWarnings: string[];
  plannerPrompt: string | null;
  plannerRawOutput: string | null;
  memorySnapshotIds: string[];
  workspaceSummary: WorkspaceSummaryCacheEntry | null;
  artifactResults: AgentToolExecutionResult[];
  toolResults: AgentToolExecutionResult[];
  toolObservations: ResearchAgentToolObservation[];
  memorySuggestionResults: AgentToolExecutionResult[];
  workflowId?: string;
  workflowTitle?: string;
  workflowInferred?: boolean;
  continuation?: ResearchAgentContinuationContext;
}

export type ResearchAgentApprovalSummaryStatus =
  | 'none'
  | 'waiting_approval'
  | 'executing'
  | 'completed'
  | 'failed';

export interface ResearchAgentApprovalSummary {
  status: ResearchAgentApprovalSummaryStatus;
  totalApprovals: number;
  pendingApprovals: number;
  executingApprovals: number;
  completedApprovals: number;
  failedApprovals: number;
  rejectedApprovals: number;
  pendingToolNames: string[];
  executingToolNames: string[];
  completedToolNames: string[];
  failedToolNames: string[];
}

export interface FinalizeResearchAgentApprovedArtifactsInput {
  sessionId: string;
  planSteps?: ResearchAgentPlanStep[];
  compact?: boolean;
  maxTraceEvents?: number;
  retainRecentEvents?: number;
  now?: number;
}

export interface FinalizeResearchAgentApprovedArtifactsResult {
  session: AgentSession;
  planSteps: ResearchAgentPlanStep[];
  finalized: boolean;
  compacted: boolean;
  pendingApprovalIds: string[];
  completedApprovalIds: string[];
  failedApprovalIds: string[];
}

export interface ReconcileResearchAgentPendingApprovalsInput extends FinalizeResearchAgentApprovedArtifactsInput {
  toolNames?: string[];
  completeSession?: boolean;
  completionMessage?: string;
}

export interface ReconcileResearchAgentPendingApprovalsResult extends FinalizeResearchAgentApprovedArtifactsResult {
  reconciledApprovalIds: string[];
}

function openSession(sessionId: string): AgentSession {
  const session = useAgentSessionStore.getState().getSession(sessionId);
  if (!session) {
    throw new Error(`Research agent session not found: ${sessionId}`);
  }
  return session;
}

function appendPlanStepTrace(input: {
  sessionId: string;
  step: ResearchAgentPlanStep;
  status: ResearchAgentPlanStepStatus;
  timestamp: number;
  message?: string;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  useAgentSessionStore.getState().appendTrace(input.sessionId, {
    id: `${input.sessionId}:plan:${input.step.id}:${input.status}`,
    kind: 'planning',
    timestamp: input.timestamp,
    message: input.message ?? `${input.step.title}: ${input.status}.`,
    metadata: {
      planStepId: input.step.id,
      planStepStatus: input.status,
      toolName: input.step.toolName ?? null,
      ...(input.metadata ?? {}),
    },
  });
}

function buildPlannerPreview(value: string | null | undefined, maxLength = 1200): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1).trimEnd()}…`
    : normalized;
}

function createAbortError(message = 'Research agent run was cancelled.'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function throwIfResearchAgentAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) {
    return;
  }
  throw createAbortError();
}

function normalizeBoundedText(value: string | null | undefined, maxLength: number): string {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  if (!normalized) {
    return '';
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3).trimEnd()}...`
    : normalized;
}

function extractQualityKeywords(value: string, limit: number): string[] {
  const normalized = value.toLowerCase();
  const words = normalized.match(/[a-z0-9][a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? [];
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'context', 'omitted',
    'summary', 'preview', 'tokens', 'items', 'workspace', 'chunk', 'reason',
    'score', 'source', 'labels', 'keywords', 'examples', 'none',
  ]);
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const word of words) {
    if (stopWords.has(word) || seen.has(word)) {
      continue;
    }
    seen.add(word);
    keywords.push(word);
    if (keywords.length >= limit) {
      break;
    }
  }
  return keywords;
}

function evaluateOmittedModelSummaryQuality(input: {
  contextPack: AgentContextPack;
  modelSummary: {
    status: ResearchAgentOmittedModelSummaryStatus;
    summary: string | null;
  };
}): ResearchAgentOmittedModelSummaryQuality {
  if (input.contextPack.omittedSummary.totalOmittedCount === 0) {
    return {
      status: 'not_needed',
      score: 100,
      reasons: ['no_omitted_context'],
      summary: 'not_needed / no omitted context',
    };
  }
  if (input.modelSummary.status === 'skipped') {
    return {
      status: 'skipped',
      score: 0,
      reasons: ['generator_unavailable'],
      summary: 'skipped / generator_unavailable',
    };
  }
  if (input.modelSummary.status === 'failed' || !input.modelSummary.summary) {
    return {
      status: 'failed',
      score: 0,
      reasons: ['generation_failed'],
      summary: 'failed / generation_failed',
    };
  }

  const summary = input.modelSummary.summary.toLowerCase();
  const reference = [
    input.contextPack.omittedSummary.autoSummaryPreview,
    input.contextPack.omittedSummary.semanticPreview,
    input.contextPack.omittedSummary.recoveryPlanPreview,
  ].join('\n');
  const keywords = extractQualityKeywords(reference, 16);
  const matchedKeywords = keywords.filter((keyword) => summary.includes(keyword));
  const mentionsRecovery = /recover|recovery|read|locator|source|file|priority|restore|恢复|读取|来源|文件|优先/.test(summary);
  const mentionsOmission = /omit|omitted|省略|截断|压缩/.test(summary);
  const length = input.modelSummary.summary.length;
  const reasons: string[] = [];
  let score = 0;

  if (length >= 80) {
    score += 25;
    reasons.push('length:ok');
  } else {
    reasons.push('length:short');
  }
  if (matchedKeywords.length >= Math.min(3, keywords.length)) {
    score += 35;
    reasons.push(`keywords:${matchedKeywords.slice(0, 5).join(',')}`);
  } else if (matchedKeywords.length > 0) {
    score += 18;
    reasons.push(`keywords_partial:${matchedKeywords.join(',')}`);
  } else {
    reasons.push('keywords:none');
  }
  if (mentionsRecovery) {
    score += 25;
    reasons.push('recovery:mentioned');
  } else {
    reasons.push('recovery:missing');
  }
  if (mentionsOmission) {
    score += 15;
    reasons.push('omission:mentioned');
  } else {
    reasons.push('omission:missing');
  }

  const boundedScore = Math.min(100, score);
  const status: ResearchAgentOmittedModelSummaryQualityStatus = boundedScore >= 75
    ? 'healthy'
    : boundedScore >= 45
      ? 'partial'
      : 'weak';
  return {
    status,
    score: boundedScore,
    reasons,
    summary: `${status} / score=${boundedScore} / ${reasons.join(', ')}`.slice(0, 500),
  };
}

async function buildOmittedModelSummary(input: {
  task: string;
  query: string;
  contextPack: AgentContextPack;
  generateOmittedSummary?: ResearchAgentOmittedModelSummaryGenerate;
  signal?: AbortSignal;
}): Promise<ResearchAgentOmittedModelSummary> {
  if (input.contextPack.omittedSummary.totalOmittedCount === 0) {
    const modelSummary: ResearchAgentOmittedModelSummary = {
      status: 'not_needed',
      summary: null,
      warning: null,
      quality: {
        status: 'not_needed',
        score: 100,
        reasons: ['no_omitted_context'],
        summary: 'not_needed / no omitted context',
      },
    };
    return {
      ...modelSummary,
    };
  }

  if (!input.generateOmittedSummary) {
    const modelSummary: ResearchAgentOmittedModelSummary = {
      status: 'skipped',
      summary: null,
      warning: null,
      quality: {
        status: 'skipped',
        score: 0,
        reasons: ['generator_unavailable'],
        summary: 'skipped / generator_unavailable',
      },
    };
    return {
      ...modelSummary,
    };
  }

  try {
    throwIfResearchAgentAborted(input.signal);
    const summary = normalizeBoundedText(await input.generateOmittedSummary({
      task: input.task,
      query: input.query,
      contextPackId: input.contextPack.id,
      omittedContextCount: input.contextPack.omittedSummary.totalOmittedCount,
      omittedContextTokens: input.contextPack.omittedSummary.totalOmittedTokens,
      omittedContextPreview: input.contextPack.omittedSummary.preview.slice(0, 700),
      omittedAutoSummary: input.contextPack.omittedSummary.autoSummaryPreview.slice(0, 1200),
      omittedSemanticPreview: input.contextPack.omittedSummary.semanticPreview.slice(0, 900),
      omittedRecoveryPlan: input.contextPack.omittedSummary.recoveryPlanPreview.slice(0, 1100),
      signal: input.signal,
    }), 1200);
    throwIfResearchAgentAborted(input.signal);

    if (!summary) {
      const modelSummary = {
        status: 'failed',
        summary: null,
        warning: 'Omitted context model summary generator returned empty text.',
      } satisfies Pick<ResearchAgentOmittedModelSummary, 'status' | 'summary' | 'warning'>;
      return {
        ...modelSummary,
        quality: evaluateOmittedModelSummaryQuality({
          contextPack: input.contextPack,
          modelSummary,
        }),
      };
    }

    const modelSummary = {
      status: 'generated',
      summary,
      warning: null,
    } satisfies Pick<ResearchAgentOmittedModelSummary, 'status' | 'summary' | 'warning'>;
    return {
      ...modelSummary,
      quality: evaluateOmittedModelSummaryQuality({
        contextPack: input.contextPack,
        modelSummary,
      }),
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    const modelSummary = {
      status: 'failed',
      summary: null,
      warning: `Omitted context model summary failed: ${error instanceof Error ? error.message : String(error)}`,
    } satisfies Pick<ResearchAgentOmittedModelSummary, 'status' | 'summary' | 'warning'>;
    return {
      ...modelSummary,
      quality: evaluateOmittedModelSummaryQuality({
        contextPack: input.contextPack,
        modelSummary,
      }),
    };
  }
}

function buildPlannerContextSummary(input: {
  contextPack: AgentContextPack;
  omittedModelSummary: ResearchAgentOmittedModelSummary;
}): string {
  if (!input.omittedModelSummary.summary) {
    return input.contextPack.prompt;
  }

  return [
    '## Omitted context model summary',
    input.omittedModelSummary.summary,
    '',
    input.contextPack.prompt,
  ].join('\n');
}

function cancelResearchAgentSessionIfOpen(sessionId: string, reason = 'Research agent run was cancelled.') {
  const session = useAgentSessionStore.getState().getSession(sessionId);
  if (!session || session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled') {
    return;
  }
  useAgentSessionStore.getState().cancelSession(sessionId, reason);
}

function isTerminalResearchAgentStatus(status: AgentSession['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function uniqueApprovalToolNames(
  approvals: AgentPendingApproval[],
  predicate: (approval: AgentPendingApproval) => boolean,
): string[] {
  return Array.from(new Set(
    approvals
      .filter(predicate)
      .map((approval) => approval.toolName),
  ));
}

export function buildResearchAgentApprovalSummary(session: AgentSession): ResearchAgentApprovalSummary {
  const approvals = session.pendingApprovals ?? [];
  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending').length;
  const executingApprovals = approvals.filter((approval) =>
    approval.status === 'approved' || approval.status === 'executing',
  ).length;
  const completedApprovals = approvals.filter((approval) => approval.status === 'completed').length;
  const failedApprovals = approvals.filter((approval) => approval.status === 'failed').length;
  const rejectedApprovals = approvals.filter((approval) => approval.status === 'rejected').length;
  const totalApprovals = approvals.length;

  let status: ResearchAgentApprovalSummaryStatus = 'none';
  if (failedApprovals > 0 || rejectedApprovals > 0) {
    status = 'failed';
  } else if (pendingApprovals > 0) {
    status = 'waiting_approval';
  } else if (executingApprovals > 0) {
    status = 'executing';
  } else if (totalApprovals > 0 && completedApprovals === totalApprovals) {
    status = 'completed';
  } else if (totalApprovals > 0 && session.status === 'waiting_approval') {
    status = 'waiting_approval';
  }

  return {
    status,
    totalApprovals,
    pendingApprovals,
    executingApprovals,
    completedApprovals,
    failedApprovals,
    rejectedApprovals,
    pendingToolNames: uniqueApprovalToolNames(
      approvals,
      (approval) => approval.status === 'pending',
    ),
    executingToolNames: uniqueApprovalToolNames(
      approvals,
      (approval) => approval.status === 'approved' || approval.status === 'executing',
    ),
    completedToolNames: uniqueApprovalToolNames(
      approvals,
      (approval) => approval.status === 'completed',
    ),
    failedToolNames: uniqueApprovalToolNames(
      approvals,
      (approval) => approval.status === 'failed' || approval.status === 'rejected',
    ),
  };
}

function planStepIdForApprovedTool(toolName: string): string | null {
  if (toolName === 'workbench.createDraft') {
    return 'create-draft';
  }
  if (toolName === 'workbench.createProposal') {
    return 'create-proposal';
  }
  if (toolName === 'runner.runCode') {
    return 'run-code';
  }
  if (toolName === 'memory.write') {
    return 'memory-write';
  }
  return null;
}

function buildContinuationPlannerSummary(input: {
  continuation: ResearchAgentContinuationContext | undefined;
  recovery?: ResearchAgentContinuationRecovery;
}): string | undefined {
  const { continuation, recovery } = input;
  if (!continuation) {
    return undefined;
  }

  return [
    `Continue from session: ${continuation.sourceSessionId}`,
    continuation.compactionId ? `Compaction: ${continuation.compactionId}` : null,
    continuation.sourceSummary ? `Source summary: ${continuation.sourceSummary}` : null,
    recovery?.summary ? `Recovered summary: ${recovery.summary}` : null,
    recovery?.recoveryHintsPreview ? `Recovered omitted hints: ${recovery.recoveryHintsPreview}` : null,
    recovery?.recoveryPriorityPreview ? `Recovered omitted recovery priority: ${recovery.recoveryPriorityPreview}` : null,
    recovery?.recoveryPlanPreview ? `Recovered omitted recovery plan: ${recovery.recoveryPlanPreview}` : null,
    recovery?.autoSummaryPreview ? `Recovered omitted auto summary: ${recovery.autoSummaryPreview}` : null,
    recovery?.modelSummaryPreview ? `Recovered omitted model summary: ${recovery.modelSummaryPreview}` : null,
    recovery?.semanticPreview ? `Recovered omitted semantic preview: ${recovery.semanticPreview}` : null,
    recovery && recovery.evidenceRefs.length > 0
      ? `Recovered evidence refs: ${recovery.evidenceRefs.slice(0, 6).map((ref) => `${ref.label} (${ref.locator})`).join('; ')}`
      : null,
    'Treat completed prior work as context. Plan only the next useful research steps unless verification is necessary.',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function mergeEvidenceRefs(left: EvidenceRef[] = [], right: EvidenceRef[] = []): EvidenceRef[] {
  const seen = new Set<string>();
  return [...left, ...right].filter((ref) => {
    const key = `${ref.kind}:${ref.locator}:${JSON.stringify(ref.anchor ?? {})}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function metadataStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function buildContinuationRecoveryContext(
  continuation: ResearchAgentContinuationContext | undefined,
): ResearchAgentContinuationRecovery {
  if (!continuation) {
    return {
      summary: null,
      plannerSummary: undefined,
      evidenceRefs: [],
    };
  }

  const sourceSession = useAgentSessionStore.getState().getSession(continuation.sourceSessionId);
  if (!sourceSession) {
    return {
      summary: `Continuation source session not found: ${continuation.sourceSessionId}`,
      plannerSummary: [
        `Continue from session: ${continuation.sourceSessionId}`,
        continuation.compactionId ? `Compaction: ${continuation.compactionId}` : null,
        continuation.sourceSummary ? `Source summary: ${continuation.sourceSummary}` : null,
        'Continuation source session was not found in the local store.',
      ].filter((line): line is string => Boolean(line)).join('\n'),
      evidenceRefs: [],
      heavyInput: {
        id: `continuation-${continuation.sourceSessionId}`,
        label: 'Continuation recovery context',
        content: [
          `Source session: ${continuation.sourceSessionId}`,
          continuation.compactionId ? `Compaction: ${continuation.compactionId}` : null,
          continuation.sourceSummary ? `Source summary: ${continuation.sourceSummary}` : null,
          'Source session was not available in the current local session store.',
        ].filter((line): line is string => Boolean(line)).join('\n'),
      },
    };
  }

  const selectedCompaction = continuation.compactionId
    ? sourceSession.compactions.find((compaction) => compaction.id === continuation.compactionId)
    : sourceSession.compactions[sourceSession.compactions.length - 1];
  const contextTrace = sourceSession.trace
    .filter((event) =>
      event.id.includes(':context-pack') ||
      metadataStringValue(event.metadata?.omittedContextRecoveryHints) ||
      metadataStringValue(event.metadata?.omittedContextRecoveryPriority) ||
      metadataStringValue(event.metadata?.omittedContextRecoveryPlan) ||
      metadataStringValue(event.metadata?.omittedContextAutoSummary) ||
      metadataStringValue(event.metadata?.omittedContextModelSummary) ||
      metadataStringValue(event.metadata?.omittedContextSemanticPreview),
    )
    .slice(-3);
  const recoveryHints = contextTrace
    .map((event) => metadataStringValue(event.metadata?.omittedContextRecoveryHints))
    .filter((value): value is string => Boolean(value));
  const recoveryPriorities = contextTrace
    .map((event) => metadataStringValue(event.metadata?.omittedContextRecoveryPriority))
    .filter((value): value is string => Boolean(value));
  const recoveryPlans = contextTrace
    .map((event) => metadataStringValue(event.metadata?.omittedContextRecoveryPlan))
    .filter((value): value is string => Boolean(value));
  const autoSummaries = contextTrace
    .map((event) => metadataStringValue(event.metadata?.omittedContextAutoSummary))
    .filter((value): value is string => Boolean(value));
  const modelSummaries = contextTrace
    .map((event) => metadataStringValue(event.metadata?.omittedContextModelSummary))
    .filter((value): value is string => Boolean(value));
  const semanticPreviews = contextTrace
    .map((event) => metadataStringValue(event.metadata?.omittedContextSemanticPreview))
    .filter((value): value is string => Boolean(value));
  const recoveryHintsPreview = recoveryHints.join(' / ').slice(0, 1200);
  const recoveryPriorityPreview = recoveryPriorities.join(' / ').slice(0, 1200);
  const recoveryPlanPreview = recoveryPlans.join(' / ').slice(0, 1400);
  const autoSummaryPreview = autoSummaries.join(' / ').slice(0, 1200);
  const modelSummaryPreview = modelSummaries.join(' / ').slice(0, 1200);
  const semanticPreview = semanticPreviews.join(' / ').slice(0, 900);
  const evidenceRefs = mergeEvidenceRefs(
    selectedCompaction?.evidenceRefs ?? [],
    sourceSession.evidenceRefs,
  ).slice(0, 12);
  const summary = selectedCompaction?.summary ?? continuation.sourceSummary ?? sourceSession.result ?? null;
  const content = [
    `Source session: ${sourceSession.id}`,
    `Source title: ${sourceSession.title}`,
    `Original task: ${sourceSession.task}`,
    continuation.compactionId ? `Requested compaction: ${continuation.compactionId}` : null,
    selectedCompaction ? `Compaction summary: ${selectedCompaction.summary}` : null,
    selectedCompaction ? `Compacted events: ${selectedCompaction.compactedEventCount}` : null,
    selectedCompaction ? `Retained events: ${selectedCompaction.retainedEventIds.length}` : null,
    selectedCompaction && selectedCompaction.sourceEventKinds.length > 0
      ? `Compacted source kinds: ${selectedCompaction.sourceEventKinds.join(', ')}`
      : null,
    continuation.sourceSummary && continuation.sourceSummary !== selectedCompaction?.summary
      ? `Continuation prompt summary: ${continuation.sourceSummary}`
      : null,
    recoveryHintsPreview ? `Prior omitted recovery hints: ${recoveryHintsPreview}` : null,
    recoveryPriorityPreview ? `Prior omitted recovery priority: ${recoveryPriorityPreview}` : null,
    recoveryPlanPreview ? `Prior omitted recovery plan: ${recoveryPlanPreview}` : null,
    autoSummaryPreview ? `Prior omitted auto summary: ${autoSummaryPreview}` : null,
    modelSummaryPreview ? `Prior omitted model summary: ${modelSummaryPreview}` : null,
    semanticPreview ? `Prior omitted semantic preview: ${semanticPreview}` : null,
    evidenceRefs.length > 0
      ? `Preserved evidence: ${evidenceRefs.slice(0, 8).map((ref) => `${ref.label} (${ref.locator})`).join('; ')}`
      : null,
    'Continue from this recovery context. Do not repeat completed prior work unless verification is needed.',
  ].filter((line): line is string => Boolean(line)).join('\n');

  return {
    summary,
    plannerSummary: buildContinuationPlannerSummary({
      continuation,
      recovery: {
        summary,
        recoveryHintsPreview,
        recoveryPriorityPreview,
        recoveryPlanPreview,
        autoSummaryPreview,
        modelSummaryPreview,
        semanticPreview,
        evidenceRefs,
      },
    }),
    recoveryHintsPreview: recoveryHintsPreview || undefined,
    recoveryPriorityPreview: recoveryPriorityPreview || undefined,
    recoveryPlanPreview: recoveryPlanPreview || undefined,
    autoSummaryPreview: autoSummaryPreview || undefined,
    modelSummaryPreview: modelSummaryPreview || undefined,
    semanticPreview: semanticPreview || undefined,
    evidenceRefs,
    heavyInput: {
      id: `continuation-${sourceSession.id}${selectedCompaction ? `-${selectedCompaction.id}` : ''}`,
      label: 'Continuation recovery context',
      content,
    },
  };
}

function buildToolObservationsSummary(observations: ResearchAgentToolObservation[]): string | undefined {
  if (observations.length === 0) {
    return undefined;
  }

  return observations
    .slice(0, 8)
    .map((observation, index) => {
      const evidence = observation.evidenceCount > 0 ? `, evidence=${observation.evidenceCount}` : '';
      const schema = [
        observation.resultStatus ? `schemaStatus=${observation.resultStatus}` : null,
        observation.resultSummary ? `summary=${normalizeBoundedText(observation.resultSummary, 160)}` : null,
        observation.resultMetricsPreview ? `metrics=${normalizeBoundedText(observation.resultMetricsPreview, 140)}` : null,
        observation.resultArtifactsPreview ? `artifacts=${normalizeBoundedText(observation.resultArtifactsPreview, 140)}` : null,
        observation.resultDiagnosticsPreview ? `diagnostics=${normalizeBoundedText(observation.resultDiagnosticsPreview, 140)}` : null,
      ].filter(Boolean).join(', ');
      const schemaPreview = schema ? `, resultSchema={${schema}}` : '';
      const metadata = observation.metadataPreview ? `, metadata=${observation.metadataPreview}` : '';
      const purpose = observation.purpose === 'recovery_read' ? ', purpose=recovery_read' : '';
      const locator = observation.recoveryLocator ? `, locator=${observation.recoveryLocator}` : '';
      return `${index + 1}. ${observation.stepId}: ${observation.toolName} ${observation.status}${purpose}${locator}${evidence}${schemaPreview}${metadata} - ${observation.preview}`;
    })
    .join('\n');
}

function buildRecoveryObservationLocatorsPreview(observations: ResearchAgentToolObservation[]): string {
  return observations
    .filter((observation) => observation.purpose === 'recovery_read' && observation.recoveryLocator)
    .map((observation) => observation.recoveryLocator as string)
    .filter((locator, index, locators) => locators.indexOf(locator) === index)
    .slice(0, 8)
    .join(',')
    .slice(0, 500);
}

function buildRecoveryObservationPreview(observations: ResearchAgentToolObservation[]): string {
  return observations
    .filter((observation) => observation.purpose === 'recovery_read')
    .map((observation, index) => {
      const locator = observation.recoveryLocator ? ` @ ${observation.recoveryLocator}` : '';
      return `${index + 1}. ${observation.toolName}${locator} (${observation.status}) - ${observation.preview || 'no preview'}`;
    })
    .slice(0, 6)
    .join(' | ')
    .slice(0, 900);
}

function buildRecoveredContextDigest(observations: ResearchAgentToolObservation[]): ResearchAgentRecoveredContextDigest {
  const recoveryObservations = observations.filter((observation) => observation.purpose === 'recovery_read');
  if (recoveryObservations.length === 0) {
    return {
      count: 0,
      completedCount: 0,
      usefulCount: 0,
      lowValueCount: 0,
      locatorsPreview: null,
      summary: null,
      answerSection: null,
      memoryLine: null,
    };
  }

  const completed = recoveryObservations.filter((observation) => observation.status === 'completed');
  const useful = completed.filter((observation) =>
    observation.evidenceCount > 0 ||
    (observation.resultItemCount ?? 0) > 0 ||
    (observation.resultSize ?? 0) > 0,
  );
  const lowValueCount = recoveryObservations.length - useful.length;
  const locators = Array.from(new Set(
    recoveryObservations
      .map((observation) => observation.recoveryLocator)
      .filter((locator): locator is string => Boolean(locator)),
  ));
  const locatorsPreview = locators.join(',').slice(0, 500) || null;
  const lines = recoveryObservations.slice(0, 5).map((observation, index) => {
    const locator = observation.recoveryLocator ? ` @ ${observation.recoveryLocator}` : '';
    const value = observation.status === 'completed'
      ? `evidence=${observation.evidenceCount}, items=${observation.resultItemCount ?? 0}, size=${observation.resultSize ?? 0}`
      : observation.status;
    return `${index + 1}. ${observation.toolName}${locator}: ${value} - ${normalizeBoundedText(observation.preview, 220) || 'no preview'}`;
  });
  const summary = [
    `Recovered omitted context: ${recoveryObservations.length} read${recoveryObservations.length === 1 ? '' : 's'}`,
    `completed=${completed.length}`,
    `useful=${useful.length}`,
    `lowValue=${lowValueCount}`,
    locatorsPreview ? `locators=${locatorsPreview}` : null,
  ].filter((part): part is string => Boolean(part)).join(' / ');
  const answerSection = [
    summary,
    lines.length > 0 ? lines.join('\n') : null,
  ].filter((part): part is string => Boolean(part)).join('\n').slice(0, 1200);

  return {
    count: recoveryObservations.length,
    completedCount: completed.length,
    usefulCount: useful.length,
    lowValueCount,
    locatorsPreview,
    summary,
    answerSection,
    memoryLine: answerSection ? `Recovered omitted context digest:\n${answerSection.slice(0, 700)}` : null,
  };
}

function evaluateContinuationRecoveryQuality(input: {
  plannedLocators: string[];
  observations: ResearchAgentToolObservation[];
}): ResearchAgentRecoveryQuality {
  const plannedLocators = input.plannedLocators
    .map((locator) => locator.trim())
    .filter((locator, index, locators) => locator && locators.indexOf(locator) === index);
  const recoveryObservations = input.observations.filter((observation) => observation.purpose === 'recovery_read');
  if (plannedLocators.length === 0 && recoveryObservations.length === 0) {
    return {
      status: 'not_needed',
      plannedCount: 0,
      observedCount: 0,
      coveredCount: 0,
      lowValueCount: 0,
      missingLocators: [],
      summary: 'not_needed: no recovery reads planned.',
    };
  }

  const observedLocators = new Set(
    recoveryObservations
      .map((observation) => observation.recoveryLocator)
      .filter((locator): locator is string => Boolean(locator)),
  );
  const missingLocators = plannedLocators.filter((locator) => !observedLocators.has(locator));
  const lowValueCount = recoveryObservations.filter((observation) =>
    observation.status !== 'completed' ||
    (
      observation.evidenceCount === 0 &&
      (observation.resultItemCount ?? 0) === 0 &&
      (observation.resultSize ?? 0) === 0
    ),
  ).length;
  const coveredCount = plannedLocators.filter((locator) => observedLocators.has(locator)).length;
  const status: ResearchAgentRecoveryQualityStatus = missingLocators.length === plannedLocators.length
    ? 'missing'
    : missingLocators.length > 0
      ? 'partial'
      : lowValueCount > 0
        ? 'weak'
        : 'complete';
  const summary = [
    status,
    `planned=${plannedLocators.length}`,
    `observed=${recoveryObservations.length}`,
    `covered=${coveredCount}`,
    `lowValue=${lowValueCount}`,
    missingLocators.length > 0 ? `missing=${missingLocators.slice(0, 4).join(',')}` : null,
  ].filter((part): part is string => Boolean(part)).join(' / ');

  return {
    status,
    plannedCount: plannedLocators.length,
    observedCount: recoveryObservations.length,
    coveredCount,
    lowValueCount,
    missingLocators,
    summary,
  };
}

function buildMemoryRankingQueryText(input: {
  task: string;
  query: string;
  selection: string;
  workflowId?: string;
  workflowTitle?: string;
  evidenceRefs: EvidenceRef[];
}): string {
  return [
    input.task,
    input.query,
    input.selection,
    input.workflowTitle,
    input.workflowId,
    ...input.evidenceRefs.flatMap((ref) => [ref.label, ref.locator, ref.preview ?? '']),
  ].filter(Boolean).join(' ');
}

function buildMemoryRankingPreview(items: AgentMemoryRankingItem[]): string {
  return items
    .slice(0, 8)
    .map((item, index) =>
      `${index + 1}. ${item.entry.id}:${item.entry.scope}:score=${item.score}:reasons=${item.reasons.slice(0, 4).join('+')}:${item.entry.title}`,
    )
    .join(' | ')
    .slice(0, 900);
}

function buildMemoryLifecycleAuditPreview(
  items: AgentMemoryRankingItem[],
  now: number,
): { summary: string; preview: string } {
  if (items.length === 0) {
    return {
      summary: 'none',
      preview: '',
    };
  }

  const counts = new Map<string, number>();
  const reviewItems: string[] = [];
  items.forEach((item) => {
    const lifecycle = evaluateAgentMemoryLifecycle(item.entry, now);
    counts.set(lifecycle.status, (counts.get(lifecycle.status) ?? 0) + 1);
    if (lifecycle.status !== 'healthy') {
      reviewItems.push([
        item.entry.id,
        lifecycle.status,
        lifecycle.recommendedAction,
        lifecycle.reasons.slice(0, 4).join('+'),
      ].filter(Boolean).join(':'));
    }
  });

  const summary = ['healthy', 'stale', 'weak', 'review', 'disabled', 'deleted']
    .filter((status) => counts.has(status))
    .map((status) => `${status}=${counts.get(status)}`)
    .join(', ');

  return {
    summary: summary || 'none',
    preview: reviewItems.join(' | ').slice(0, 700),
  };
}

function extractRecoveryPriorityLocators(priorityPreview: string | undefined): string[] {
  if (!priorityPreview) {
    return [];
  }

  const locators: string[] = [];
  const pattern = /@\s*([^()|]+?)\s+score=/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(priorityPreview)) !== null) {
    const locator = match[1]?.trim();
    if (locator && !locators.includes(locator)) {
      locators.push(locator);
    }
  }
  return locators.slice(0, 3);
}

function extractRecoveryPlanLocators(planPreview: string | undefined): string[] {
  if (!planPreview) {
    return [];
  }

  const locators: string[] = [];
  const pattern = /@\s*([^|]+?)\s*\|/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(planPreview)) !== null) {
    const locator = match[1]?.trim();
    if (locator && !locators.includes(locator)) {
      locators.push(locator);
    }
  }
  return locators.slice(0, 3);
}

function insertContinuationRecoveryReadSteps(input: {
  steps: ResearchAgentPlanStep[];
  continuationRecovery: ResearchAgentContinuationRecovery;
}): {
  steps: ResearchAgentPlanStep[];
  recoveryReadPaths: string[];
} {
  const recoveryReadPaths = [
    ...extractRecoveryPlanLocators(input.continuationRecovery.recoveryPlanPreview),
    ...extractRecoveryPriorityLocators(input.continuationRecovery.recoveryPriorityPreview),
  ].filter((path, index, paths) => paths.indexOf(path) === index).slice(0, 3);
  if (recoveryReadPaths.length === 0) {
    return {
      steps: input.steps,
      recoveryReadPaths,
    };
  }

  const existingStepIds = new Set(input.steps.map((step) => step.id));
  const recoverySteps: ResearchAgentPlanStep[] = recoveryReadPaths
    .map((path, index) => ({
      id: `recover-omitted-context-${index + 1}`,
      title: `Recover omitted context ${index + 1}`,
      description: `Read high-priority omitted context from ${path}.`,
      status: 'pending' as const,
      toolName: 'workspace.readIndexedContext' as const,
      toolArgs: {
        paths: [path],
      },
    }))
    .filter((step) => !existingStepIds.has(step.id));

  if (recoverySteps.length === 0) {
    return {
      steps: input.steps,
      recoveryReadPaths,
    };
  }

  const contextPackIndex = input.steps.findIndex((step) => step.id === 'context-pack');
  const insertAt = contextPackIndex >= 0 ? contextPackIndex + 1 : 0;
  return {
    steps: [
      ...input.steps.slice(0, insertAt),
      ...recoverySteps,
      ...input.steps.slice(insertAt),
    ],
    recoveryReadPaths,
  };
}

function summarizeObservationQuality(input: {
  observations: ResearchAgentToolObservation[];
  seenRequestSignatures: Set<string>;
}): {
  duplicateCount: number;
  lowValueCount: number;
  qualitySummary: string;
  stopReason: 'duplicate_observations' | 'low_value_observations' | null;
} {
  const duplicateCount = input.observations.filter((observation) =>
    input.seenRequestSignatures.has(observation.requestSignature),
  ).length;
  const lowValueCount = input.observations.filter((observation) =>
    observation.status === 'completed' &&
    observation.evidenceCount === 0 &&
    (observation.resultItemCount ?? 0) === 0 &&
    (observation.resultSize ?? 0) === 0,
  ).length;
  const qualitySummary = [
    `duplicates=${duplicateCount}`,
    `lowValue=${lowValueCount}`,
    `observations=${input.observations.length}`,
  ].join(', ');
  const allDuplicate = input.observations.length > 0 && duplicateCount === input.observations.length;
  const allLowValue = input.observations.length > 0 && lowValueCount === input.observations.length;

  return {
    duplicateCount,
    lowValueCount,
    qualitySummary,
    stopReason: allDuplicate
      ? 'duplicate_observations'
      : allLowValue
        ? 'low_value_observations'
        : null,
  };
}

function buildObservationRecoveryRecommendation(input: {
  stopReason: string | null;
  qualitySummary: string | null;
  recoveryQualitySummary?: string | null;
  observationsPreview?: string | null;
}): string | null {
  switch (input.stopReason) {
    case 'blocked':
      return 'Approve or reject the pending tool request, then resume the agent from Trace.';
    case 'read_tool_failed':
      return 'Inspect the failed read/search tool result, narrow the source path or query, and rerun the research step.';
    case 'planner_error':
      return 'Review the planner warning and retry with a narrower task or fallback to the current plan.';
    case 'low_value_observations':
      return `Stop repeated low-value reads. Refine the query, choose a more specific source, or continue synthesis with current evidence. ${input.qualitySummary ?? ''}`.trim();
    case 'duplicate_observations':
      return `Avoid repeating the same read request. Reuse the existing observation or change the locator/query before replanning. ${input.qualitySummary ?? ''}`.trim();
    case 'budget_exhausted':
      return 'Observation replan budget is exhausted. Continue with the best current plan or start a focused follow-up run.';
    case 'no_pending_updates':
      return 'Planner returned no useful pending-step updates. Continue with the current plan or revise the task instructions.';
    case 'no_new_observations':
      return 'No new tool observations were produced. Continue with the current context or add a specific source/query.';
    case 'no_observations':
      return 'No read-tool observations were available for replanning. Proceed to evidence resolution or add an explicit read step.';
    case 'planner_unavailable':
      return 'Planner generation is unavailable, so the agent will continue with the existing deterministic plan.';
    case 'replan_disabled':
      return 'Observation replanning is disabled for this run because an explicit plan or planner output was supplied.';
    default:
      if (input.recoveryQualitySummary) {
        return `Review recovery quality before continuing: ${input.recoveryQualitySummary}`;
      }
      return input.observationsPreview
        ? 'Review the observations preview and decide whether to continue, narrow the query, or rerun.'
        : null;
  }
}

function mergeObservationReplanSteps(input: {
  current: ResearchAgentPlanStep[];
  replanned: ResearchAgentPlanStep[];
}): {
  steps: ResearchAgentPlanStep[];
  updatedStepIds: string[];
  ignoredStepIds: string[];
} {
  const currentById = new Map(input.current.map((step) => [step.id, step]));
  const replannedById = new Map(input.replanned.map((step) => [step.id, step]));
  const updatedStepIds: string[] = [];
  const ignoredStepIds = input.replanned
    .filter((step) => !currentById.has(step.id))
    .map((step) => step.id);
  const steps = input.current.map((step) => {
    if (step.status !== 'pending') {
      return step;
    }

    const replanned = replannedById.get(step.id);
    if (!replanned) {
      return step;
    }

    updatedStepIds.push(step.id);
    return {
      ...step,
      title: replanned.title,
      description: replanned.description,
      ...(replanned.toolName ? { toolName: replanned.toolName } : { toolName: undefined }),
      ...(replanned.toolArgs ? { toolArgs: replanned.toolArgs } : { toolArgs: undefined }),
      status: 'pending' as const,
    };
  });

  return {
    steps,
    updatedStepIds,
    ignoredStepIds,
  };
}

function restoreResolvedEvidenceContext(session: AgentSession | null): AiPromptContext | null {
  if (!session) {
    return null;
  }

  const completedTrace = session.trace
    .slice()
    .reverse()
    .find((event) =>
      event.kind === 'planning' &&
      event.metadata?.planStepId === 'evidence-resolve' &&
      event.metadata?.planStepStatus === 'completed' &&
      event.metadata?.toolName === 'evidence.resolve' &&
      typeof event.metadata?.resolvedPromptPreview === 'string',
    );
  if (!completedTrace) {
    return null;
  }

  const promptPreview = String(completedTrace.metadata?.resolvedPromptPreview ?? '').trim();
  if (!promptPreview) {
    return null;
  }

  const evidenceRefs = completedTrace.evidenceRefs ?? [];
  return {
    nodes: [],
    prompt: [
      '[Restored evidence context from prior Research Agent trace]',
      promptPreview,
    ].join('\n'),
    evidenceRefs,
    truncated: true,
  };
}

function restoreSynthesisAnswerPreview(session: AgentSession | null): string | null {
  if (!session) {
    return null;
  }

  const synthesisTrace = session.trace
    .slice()
    .reverse()
    .find((event) =>
      event.id.endsWith(':synthesis') &&
      event.kind === 'planning' &&
      typeof event.metadata?.answerPreview === 'string',
    );
  const answerPreview = String(synthesisTrace?.metadata?.answerPreview ?? '').trim();
  if (!answerPreview) {
    return null;
  }

  return answerPreview;
}

function restoreSynthesisAnswer(session: AgentSession | null): string | null {
  const answerPreview = restoreSynthesisAnswerPreview(session);
  if (!answerPreview) {
    return null;
  }

  return [
    '[Restored synthesis preview from prior Research Agent trace]',
    answerPreview,
  ].join('\n');
}

function hasPlanStepTrace(session: AgentSession, stepId: string, status: ResearchAgentPlanStepStatus): boolean {
  return session.trace.some((event) =>
    event.kind === 'planning' &&
    event.metadata?.planStepId === stepId &&
    event.metadata?.planStepStatus === status,
  );
}

function ensureArtifactPlanSteps(steps: ResearchAgentPlanStep[], session: AgentSession): ResearchAgentPlanStep[] {
  const requiredStepIds = new Set(
    session.pendingApprovals
      .map((approval) => planStepIdForApprovedTool(approval.toolName))
      .filter((stepId): stepId is string => Boolean(stepId)),
  );
  if (requiredStepIds.size === 0) {
    return steps;
  }

  const existingStepIds = new Set(steps.map((step) => step.id));
  const defaults = buildDefaultResearchAgentPlanSteps({
    includeDraftStep: requiredStepIds.has('create-draft'),
    includeProposalStep: requiredStepIds.has('create-proposal'),
    includeCompactionStep: true,
  });
  const missing = defaults.filter((step) => requiredStepIds.has(step.id) && !existingStepIds.has(step.id));
  return missing.length > 0 ? [...steps, ...missing] : steps;
}

function ensureApprovalPlanSteps(steps: ResearchAgentPlanStep[], session: AgentSession): ResearchAgentPlanStep[] {
  const existingStepIds = new Set(steps.map((step) => step.id));
  const missing: ResearchAgentPlanStep[] = [];
  for (const approval of session.pendingApprovals) {
    const stepId = planStepIdForApprovedTool(approval.toolName);
    if (!stepId || existingStepIds.has(stepId)) {
      continue;
    }
    existingStepIds.add(stepId);
    missing.push({
      id: stepId,
      title: approval.toolName === 'runner.runCode'
        ? 'Run code'
        : approval.toolName === 'memory.write'
          ? 'Write memory'
          : approval.toolName,
      description: `Complete approved tool request ${approval.toolName}.`,
      status: 'pending',
      toolName: approval.toolName as ResearchAgentPlanStep['toolName'],
    });
  }
  return missing.length > 0 ? [...steps, ...missing] : steps;
}

function normalizeAnswerSnippet(value: string | null | undefined, maxLength = 240): string {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  if (!normalized) {
    return '';
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trimEnd()}...` : normalized;
}

function buildEvidenceCue(ref: EvidenceRef, index: number): string {
  const preview = normalizeAnswerSnippet(ref.preview, 180);
  return preview
    ? `${index + 1}. ${ref.label} (${ref.locator}) - ${preview}`
    : `${index + 1}. ${ref.label} (${ref.locator})`;
}

function buildEvidenceCueLines(promptContext: AiPromptContext, limit = 4): string[] {
  return promptContext.evidenceRefs.slice(0, limit).map(buildEvidenceCue);
}

function buildPrimaryContextCue(input: {
  query: string;
  promptContext: AiPromptContext;
}): string {
  const firstNode = input.promptContext.nodes.find((node) => node.content.trim().length > 0);
  const fromNode = normalizeAnswerSnippet(firstNode?.content, 260);
  if (fromNode) {
    return fromNode;
  }
  const fromPrompt = normalizeAnswerSnippet(input.promptContext.prompt, 260);
  return fromPrompt || normalizeAnswerSnippet(input.query, 260) || 'No source-backed context was resolved yet.';
}

function buildToolSignalLine(plannedToolSummaries: ResearchAgentPlannedToolSummary[] | undefined): string {
  const completed = (plannedToolSummaries ?? [])
    .filter((summary) => summary.status === 'completed')
    .slice(0, 3)
    .map((summary) => `${summary.toolName}: ${normalizeAnswerSnippet(summary.preview, 120) || 'completed'}`);
  return completed.length > 0 ? completed.join('; ') : 'No completed tool observations beyond evidence resolution.';
}

function buildWorkflowOutputSection(input: {
  workflowId?: string;
  workflowTitle?: string;
  query: string;
  promptContext: AiPromptContext;
  plannedToolSummaries?: ResearchAgentPlannedToolSummary[];
  recoveredContextDigest?: ResearchAgentRecoveredContextDigest;
}): string | null {
  const workflowId = input.workflowId ?? 'markdown-research';
  const workflowTitle = input.workflowTitle ?? 'Markdown Research';
  const primaryCue = buildPrimaryContextCue({
    query: input.query,
    promptContext: input.promptContext,
  });
  const evidenceCues = buildEvidenceCueLines(input.promptContext);
  const evidenceBlock = evidenceCues.length > 0
    ? evidenceCues.join('\n')
    : 'No explicit evidence refs resolved; treat this output as a draft until sources are attached.';
  const toolSignal = buildToolSignalLine(input.plannedToolSummaries);
  const recoveredSignal = input.recoveredContextDigest?.summary
    ? normalizeAnswerSnippet(input.recoveredContextDigest.summary, 220)
    : null;

  switch (workflowId) {
    case 'reading-note':
      return [
        `Workflow output: ${workflowTitle}`,
        'One-sentence takeaway:',
        `- ${primaryCue}`,
        'Key claims:',
        `- Extract the main claim from the cited context: ${primaryCue}`,
        '- Keep claims evidence-backed; promote uncited interpretation to Open questions.',
        'Evidence map:',
        evidenceBlock,
        'Methods / setup:',
        `- Use resolved context and tool observations: ${toolSignal}`,
        'Results / implications:',
        '- Summarize what the source supports, then separate implications from direct evidence.',
        'Open questions:',
        `- What remains unclear or needs source recovery?${recoveredSignal ? ` ${recoveredSignal}` : ''}`,
        'Draft next step:',
        '- Turn this into a Workbench reading note after reviewing citations.',
      ].join('\n');

    case 'notebook-analysis':
      return [
        `Workflow output: ${workflowTitle}`,
        'Observed result:',
        `- ${primaryCue}`,
        'Interpretation:',
        '- Explain what the current cells, outputs, or experiment notes support.',
        'Checks:',
        `- Verify execution context and artifacts: ${toolSignal}`,
        'Next experiment:',
        '- Propose the smallest follow-up cell or diagnostic needed to validate the interpretation.',
        'Evidence map:',
        evidenceBlock,
      ].join('\n');

    case 'literature-matrix':
      return [
        `Workflow output: ${workflowTitle}`,
        '| Source | Claim / focus | Evidence cue | Limitation / question |',
        '| --- | --- | --- | --- |',
        ...(evidenceCues.length > 0
          ? input.promptContext.evidenceRefs.slice(0, 4).map((ref, index) =>
              `| ${ref.label} | ${normalizeAnswerSnippet(ref.preview, 90) || primaryCue} | ${index + 1}. ${ref.locator} | Needs comparison against neighboring sources. |`,
            )
          : [`| Current context | ${primaryCue} | No explicit evidence refs | Attach source refs before using this matrix. |`]),
        '',
        'Matrix next step:',
        '- Add method, dataset/material, result, and limitation columns only when the source context supports them.',
      ].join('\n');

    case 'knowledge-organization':
      return [
        `Workflow output: ${workflowTitle}`,
        'Clusters:',
        `- Current focus: ${primaryCue}`,
        'Links to create:',
        evidenceCues.length > 0
          ? evidenceCues.map((line) => `- ${line}`).join('\n')
          : '- No explicit source links available yet.',
        'Gaps / duplicates:',
        '- Check whether this topic duplicates an existing note, memory, or workspace chunk before writeback.',
        'Proposal next step:',
        '- Create a proposal that links notes instead of rewriting source material.',
      ].join('\n');

    case 'teaching-explain':
      return [
        `Workflow output: ${workflowTitle}`,
        'Plain explanation:',
        `- ${primaryCue}`,
        'Example:',
        '- Use one concrete example from the resolved context or ask the user for a target audience.',
        'Common misconception:',
        '- Do not treat uncited inference as source fact; mark it as interpretation.',
        'Check question:',
        '- What evidence in the source would change this explanation?',
        'Evidence map:',
        evidenceBlock,
      ].join('\n');

    case 'markdown-research':
      return [
        `Workflow output: ${workflowTitle}`,
        'Research brief:',
        `- ${primaryCue}`,
        'Evidence map:',
        evidenceBlock,
        'Caveat:',
        '- Keep unsupported synthesis separate from cited source material.',
        'Next check:',
        `- ${toolSignal}`,
      ].join('\n');

    default:
      return null;
  }
}

function buildEvidenceBackedAnswer(input: {
  task: string;
  query: string;
  workflowId?: string;
  workflowTitle?: string;
  contextPack: AgentContextPack;
  promptContext: AiPromptContext;
  memorySnapshotIds: string[];
  memoryLifecycleAudit?: {
    summary: string;
    preview: string;
  };
  workspaceSummary: WorkspaceSummaryCacheEntry | null;
  plannedToolSummaries?: ResearchAgentPlannedToolSummary[];
  recoveredContextDigest?: ResearchAgentRecoveredContextDigest;
  omittedModelSummary?: ResearchAgentOmittedModelSummary;
}): string {
  const evidenceLines = input.promptContext.evidenceRefs.slice(0, 6).map((ref, index) => {
    const preview = ref.preview ? ` - ${ref.preview.replace(/\s+/g, ' ').trim()}` : '';
    return `${index + 1}. ${ref.label} (${ref.locator})${preview}`;
  });
  const contextSources = input.contextPack.sourceSummaries
    .filter((summary) => summary.includedCount > 0)
    .map((summary) => `${summary.source}:${summary.includedCount}`)
    .join(', ');
  const toolLines = (input.plannedToolSummaries ?? [])
    .map((summary, index) => {
      const purpose = 'purpose' in summary && summary.purpose === 'recovery_read'
        ? ' recovery_read'
        : '';
      return `${index + 1}. ${summary.toolName}${purpose} (${summary.status}) - ${summary.preview || 'no preview'}`;
    });
  const omittedSummaryLines = input.contextPack.omittedSummary.totalOmittedCount > 0
    ? [
        `Omitted context: ${input.contextPack.omittedSummary.totalOmittedCount} item${input.contextPack.omittedSummary.totalOmittedCount === 1 ? '' : 's'} / ${input.contextPack.omittedSummary.totalOmittedTokens} estimated tokens.`,
        input.omittedModelSummary?.summary
          ? `Model summary (${input.omittedModelSummary.status}, quality=${input.omittedModelSummary.quality.status}): ${input.omittedModelSummary.summary.slice(0, 700)}`
          : input.contextPack.omittedSummary.autoSummaryPreview
            ? `Auto summary: ${input.contextPack.omittedSummary.autoSummaryPreview.slice(0, 700)}`
            : null,
        input.contextPack.omittedSummary.recoveryPlanPreview
          ? `Recovery plan: ${input.contextPack.omittedSummary.recoveryPlanPreview.slice(0, 600)}`
          : input.contextPack.omittedSummary.recoveryHintsPreview
            ? `Recovery hints: ${input.contextPack.omittedSummary.recoveryHintsPreview.slice(0, 600)}`
            : null,
      ].filter((line): line is string => Boolean(line))
    : [];
  const memoryHealthLine = input.memoryLifecycleAudit?.summary
    ? `Memory health: ${input.memoryLifecycleAudit.summary}${input.memoryLifecycleAudit.preview ? ` (${input.memoryLifecycleAudit.preview.slice(0, 520)})` : ''}.`
    : null;
  const workflowOutputSection = buildWorkflowOutputSection({
    workflowId: input.workflowId,
    workflowTitle: input.workflowTitle,
    query: input.query,
    promptContext: input.promptContext,
    plannedToolSummaries: input.plannedToolSummaries,
    recoveredContextDigest: input.recoveredContextDigest,
  });

  return [
    `Task: ${input.task}`,
    `Question: ${input.query}`,
    '',
    input.promptContext.prompt.trim() || 'No resolved evidence context was available.',
    '',
    evidenceLines.length > 0
      ? `Evidence:\n${evidenceLines.join('\n')}`
      : 'Evidence: no explicit evidence refs resolved.',
    toolLines.length > 0
      ? `\nPlanned tool results:\n${toolLines.join('\n')}`
      : null,
    omittedSummaryLines.length > 0
      ? `\nLong-context summary:\n${omittedSummaryLines.join('\n')}`
      : null,
    input.recoveredContextDigest?.answerSection
      ? `\nRecovered omitted context digest:\n${input.recoveredContextDigest.answerSection}`
      : null,
    memoryHealthLine ? `\n${memoryHealthLine}` : null,
    workflowOutputSection ? `\n${workflowOutputSection}` : null,
    '',
    `Context pack: ${input.contextPack.id} (${input.contextPack.tokenEstimate} estimated tokens${input.contextPack.truncated ? ', truncated' : ''}).`,
    contextSources ? `Included sources: ${contextSources}.` : 'Included sources: none.',
    `Memory snapshot: ${input.memorySnapshotIds.length} entr${input.memorySnapshotIds.length === 1 ? 'y' : 'ies'}.`,
    input.workspaceSummary
      ? `Workspace summary: ${input.workspaceSummary.workspaceKey} v${input.workspaceSummary.indexVersion}.`
      : 'Workspace summary: not included.',
  ].filter((part): part is string => part !== null).join('\n');
}

async function suggestResearchAgentMemory(input: {
  sessionId: string;
  task: string;
  query: string;
  workflowId?: string;
  workflowTitle?: string;
  workspaceKey?: string;
  answer: string;
  contextPack: AgentContextPack;
  promptContext: AiPromptContext;
  recoveryObservations?: ResearchAgentToolObservation[];
  recoveredContextDigest?: ResearchAgentRecoveredContextDigest;
  omittedModelSummary?: ResearchAgentOmittedModelSummary;
  now: number;
}): Promise<AgentToolExecutionResult[]> {
  const firstEvidence = input.promptContext.evidenceRefs[0];
  const existingEntries = useAgentMemoryStore.getState().entries;
  const titleBase = input.workflowTitle ?? input.workflowId ?? 'Research finding';
  const evidenceLabel = firstEvidence
    ? `${firstEvidence.label} (${firstEvidence.locator})`
    : 'current research run';
  const sourceFingerprint = buildAgentMemorySourceFingerprint([
    input.workspaceKey ?? input.sessionId,
    input.workflowId ?? input.workflowTitle ?? 'research',
    input.query,
    firstEvidence?.kind,
    firstEvidence?.locator,
    input.contextPack.id,
    input.contextPack.omittedSummary.totalOmittedCount,
    input.answer.slice(0, 800),
    input.promptContext.prompt.slice(0, 800),
  ]);
  const answerPreview = input.answer.replace(/\s+/g, ' ').trim().slice(0, 520);
  const evidencePreview = input.promptContext.prompt.replace(/\s+/g, ' ').trim().slice(0, 260);
  const omittedLine = input.contextPack.omittedSummary.totalOmittedCount > 0
    ? `Omitted context: ${input.contextPack.omittedSummary.preview || `${input.contextPack.omittedSummary.totalOmittedCount} items omitted`}.`
    : 'Omitted context: none.';
  const autoSummaryLine = input.contextPack.omittedSummary.totalOmittedCount > 0
    ? `Omitted auto summary: ${input.contextPack.omittedSummary.autoSummaryPreview.slice(0, 360)}`
    : null;
  const modelSummaryLine = input.omittedModelSummary?.summary
    ? `Omitted model summary: ${input.omittedModelSummary.summary.slice(0, 500)}`
    : null;
  const recoveryLine = input.contextPack.omittedSummary.recoveryHintsPreview
    ? `Recovery hints: ${input.contextPack.omittedSummary.recoveryHintsPreview.slice(0, 260)}`
    : null;
  const recoveryObservationPreview = buildRecoveryObservationPreview(input.recoveryObservations ?? []);
  const recoveryObservationLine = recoveryObservationPreview
    ? `Recovered omitted context reads: ${recoveryObservationPreview.slice(0, 500)}`
    : null;
  const recoveredDigestLine = input.recoveredContextDigest?.memoryLine ?? null;
  const applicability = [
    input.workspaceKey ? `Workspace: ${input.workspaceKey}` : `Conversation: ${input.sessionId}`,
    input.workflowTitle ?? input.workflowId ?? 'Research Agent',
    `Query: ${input.query}`,
  ].join(' / ').slice(0, 260);
  const evidenceSummary = [
    firstEvidence ? evidenceLabel : 'No explicit evidence ref resolved',
    `Context pack ${input.contextPack.id}`,
    `${input.contextPack.tokenEstimate} estimated tokens${input.contextPack.truncated ? ', truncated' : ''}`,
  ].join(' / ').slice(0, 320);
  const caution = 'Approve only if this finding should influence future research runs in the shown scope.';
  const suggestion = buildAgentMemorySuggestion({
    scope: input.workspaceKey ? 'workspace' : 'conversation',
    title: `${titleBase}: ${input.query}`.slice(0, 96),
    content: [
      `Task: ${input.task}`,
      `Finding: ${answerPreview || 'Evidence-backed research answer was generated.'}`,
      `Evidence: ${evidenceLabel}`,
      evidencePreview ? `Evidence context: ${evidencePreview}` : null,
      `Context pack: ${input.contextPack.id} (${input.contextPack.tokenEstimate} estimated tokens${input.contextPack.truncated ? ', truncated' : ''}).`,
      omittedLine,
      autoSummaryLine,
      modelSummaryLine,
      recoveryLine,
      recoveryObservationLine,
      recoveredDigestLine,
    ].join('\n'),
    source: {
      label: 'Research Agent suggestion',
      locator: `agent-session://${input.sessionId}`,
      fingerprint: sourceFingerprint,
      evidenceRef: firstEvidence,
    },
    tags: ['research-agent', input.workflowId].filter((tag): tag is string => Boolean(tag)),
    workspaceKey: input.workspaceKey,
    conversationId: input.workspaceKey ? undefined : input.sessionId,
    candidateKind: 'finding',
    reason: 'The research run produced a reusable evidence-backed finding.',
    confidence: firstEvidence ? 0.72 : 0.55,
    now: input.now,
  });

  const agentStore = useAgentSessionStore.getState();
  if (!suggestion) {
    agentStore.appendTrace(input.sessionId, {
      id: `${input.sessionId}:memory-suggestion-skipped`,
      kind: 'planning',
      timestamp: input.now,
      message: 'Skipped Agent memory suggestion because no valid candidate could be built.',
      metadata: {
        memorySuggestionStatus: 'skipped',
        memorySuggestionReasonCode: 'invalid_candidate',
        memorySuggestionReason: 'Memory candidate title or content was empty after normalization.',
      },
    });
    return [];
  }

  const evaluation = evaluateAgentMemorySuggestion(suggestion, existingEntries);
  agentStore.appendTrace(input.sessionId, {
    id: `${input.sessionId}:memory-suggestion-evaluated`,
    kind: 'planning',
    timestamp: input.now,
    message: evaluation.shouldSuggest
      ? 'Agent memory candidate is ready for approval.'
      : `Skipped Agent memory suggestion: ${evaluation.reason}`,
    metadata: {
      memorySuggestionStatus: evaluation.shouldSuggest ? 'accepted' : 'skipped',
      memorySuggestionReasonCode: evaluation.code,
      memorySuggestionReason: evaluation.reason,
      memorySuggestionConfidence: Math.round(suggestion.confidence * 100),
      memorySuggestionPolicyDecision: evaluation.policy?.decision ?? null,
      memorySuggestionPolicySummary: evaluation.policy?.summary ?? null,
      memorySuggestionPolicyReasons: evaluation.policy?.reasons.join(',').slice(0, 500) ?? null,
      memorySuggestionCandidateKind: suggestion.candidateKind,
      memorySuggestionScope: suggestion.scope,
      memorySuggestionTitle: suggestion.title,
      memorySuggestionDedupeKey: suggestion.dedupeKey.slice(0, 180),
      memorySuggestionSourceFingerprint: suggestion.sourceFingerprint ?? null,
      memorySuggestionDuplicateMemoryId: evaluation.duplicateMemoryId ?? null,
      memorySuggestionContextPackId: input.contextPack.id,
      memorySuggestionOmittedContextCount: input.contextPack.omittedSummary.totalOmittedCount,
      memorySuggestionOmittedContextPreview: input.contextPack.omittedSummary.preview.slice(0, 500),
      memorySuggestionOmittedAutoSummary: input.contextPack.omittedSummary.autoSummaryPreview.slice(0, 700),
      memorySuggestionOmittedModelSummary: input.omittedModelSummary?.summary?.slice(0, 700) ?? null,
      memorySuggestionRecoveryObservationCount: input.recoveryObservations?.length ?? 0,
      memorySuggestionRecoveryObservationPreview: recoveryObservationPreview.slice(0, 500),
      memorySuggestionRecoveredContextDigest: input.recoveredContextDigest?.summary?.slice(0, 700) ?? null,
      memorySuggestionApplicability: applicability,
      memorySuggestionEvidenceSummary: evidenceSummary,
      memorySuggestionCaution: caution,
      memorySuggestionAnswerPreview: answerPreview.slice(0, 500),
    },
  });

  if (!evaluation.shouldSuggest) {
    return [];
  }

  const result = await executeAgentTool({
    name: 'memory.write',
    args: {
      memory: {
        scope: suggestion.scope,
        title: suggestion.title,
        content: suggestion.content,
        source: suggestion.source,
        pinned: suggestion.pinned,
        tags: suggestion.tags,
        workspaceKey: suggestion.workspaceKey,
        projectKey: suggestion.projectKey,
        conversationId: suggestion.conversationId,
        candidateKind: suggestion.candidateKind,
        now: suggestion.now,
      },
      reason: suggestion.reason,
          review: {
            candidateKind: suggestion.candidateKind,
            applicability,
            evidenceSummary,
            recoverySummary: input.recoveredContextDigest?.summary?.slice(0, 500) ?? recoveryObservationPreview.slice(0, 500),
            policySummary: evaluation.policy?.summary,
            policyReasons: evaluation.policy?.reasons,
            caution,
          },
    },
  }, {
    sessionId: input.sessionId,
    approvalNote: `Memory candidate (${Math.round(suggestion.confidence * 100)}% confidence): ${suggestion.reason}`,
  });

  return [result];
}

async function executeArtifactRequests(input: {
  sessionId: string;
  artifacts?: ResearchAgentArtifactRequest;
}): Promise<AgentToolExecutionResult[]> {
  const results: AgentToolExecutionResult[] = [];
  const artifacts = input.artifacts;
  if (!artifacts) {
    return results;
  }

  if (artifacts.draft) {
    results.push(await executeAgentTool({
      name: 'workbench.createDraft',
      args: { draft: artifacts.draft },
    }, {
      sessionId: input.sessionId,
      approvedByUser: artifacts.approvedByUser ?? false,
      approvalNote: artifacts.approvalNote,
    }));
  }

  if (artifacts.proposal) {
    results.push(await executeAgentTool({
      name: 'workbench.createProposal',
      args: { proposal: artifacts.proposal },
    }, {
      sessionId: input.sessionId,
      approvedByUser: artifacts.approvedByUser ?? false,
      approvalNote: artifacts.approvalNote,
    }));
  }

  return results;
}

export function reconcileResearchAgentPendingApprovals(
  input: ReconcileResearchAgentPendingApprovalsInput,
): ReconcileResearchAgentPendingApprovalsResult {
  const agentStore = useAgentSessionStore.getState();
  const initialSession = agentStore.getSession(input.sessionId);
  if (!initialSession) {
    throw new Error(`Research agent session not found: ${input.sessionId}`);
  }

  const toolNameFilter = input.toolNames ? new Set(input.toolNames) : null;
  let planSteps = ensureApprovalPlanSteps(ensureArtifactPlanSteps(
    input.planSteps ?? buildDefaultResearchAgentPlanSteps({ includeCompactionStep: true }),
    initialSession,
  ), initialSession);
  const approvals = initialSession.pendingApprovals.filter((approval) =>
    (!toolNameFilter || toolNameFilter.has(approval.toolName)) &&
    planStepIdForApprovedTool(approval.toolName),
  );
  const pendingApprovalIds = approvals
    .filter((approval) => approval.status === 'pending' || approval.status === 'executing')
    .map((approval) => approval.id);
  const completedApprovalIds = approvals
    .filter((approval) => approval.status === 'completed')
    .map((approval) => approval.id);
  const failedApprovalIds = approvals
    .filter((approval) => approval.status === 'failed' || approval.status === 'rejected')
    .map((approval) => approval.id);

  if (isTerminalResearchAgentStatus(initialSession.status) || approvals.length === 0) {
    return {
      session: initialSession,
      planSteps,
      finalized: false,
      compacted: false,
      pendingApprovalIds,
      completedApprovalIds,
      failedApprovalIds,
      reconciledApprovalIds: completedApprovalIds,
    };
  }

  if (pendingApprovalIds.length > 0) {
    return {
      session: initialSession,
      planSteps,
      finalized: false,
      compacted: false,
      pendingApprovalIds,
      completedApprovalIds,
      failedApprovalIds,
      reconciledApprovalIds: completedApprovalIds,
    };
  }

  if (failedApprovalIds.length > 0) {
    const error = `Research agent approval failed: ${failedApprovalIds.join(', ')}.`;
    if (initialSession.status !== 'failed' && initialSession.status !== 'cancelled') {
      agentStore.failSession(input.sessionId, error);
    }
    return {
      session: openSession(input.sessionId),
      planSteps,
      finalized: false,
      compacted: false,
      pendingApprovalIds,
      completedApprovalIds,
      failedApprovalIds,
      reconciledApprovalIds: completedApprovalIds,
    };
  }

  let latestSession = initialSession;
  for (const approval of approvals) {
    const stepId = planStepIdForApprovedTool(approval.toolName);
    if (!stepId || approval.status !== 'completed') {
      continue;
    }
    planSteps = updateResearchAgentPlanStepStatus(planSteps, stepId, 'completed');
    const step = planSteps.find((item) => item.id === stepId);
    if (step && !hasPlanStepTrace(latestSession, stepId, 'completed')) {
      appendPlanStepTrace({
        sessionId: input.sessionId,
        step: { ...step, status: 'completed' },
        status: 'completed',
        timestamp: input.now ?? Date.now(),
        message: `Completed approved plan step: ${step.title}.`,
        metadata: {
          approvalId: approval.id,
          approvalToolName: approval.toolName,
          resultPreview: approval.resultPreview ?? null,
          restoredSynthesisPreview: restoreSynthesisAnswerPreview(latestSession)?.slice(0, 900) ?? null,
        },
      });
      latestSession = openSession(input.sessionId);
    }
  }

  latestSession = openSession(input.sessionId);
  if ((input.completeSession ?? true) && !isTerminalResearchAgentStatus(latestSession.status)) {
    const restoredSynthesisPreview = restoreSynthesisAnswerPreview(latestSession);
    agentStore.completeSession(
      input.sessionId,
      input.completionMessage ??
        `Research agent completed after ${completedApprovalIds.length} approved tool${completedApprovalIds.length === 1 ? '' : 's'}${restoredSynthesisPreview ? ' and restored synthesis context' : ''}.`,
    );
    latestSession = openSession(input.sessionId);
  }

  let compacted = false;
  if (input.compact ?? true) {
    planSteps = updateResearchAgentPlanStepStatus(planSteps, 'compact-session', 'completed');
    agentStore.compactSession(input.sessionId, {
      id: `${input.sessionId}:compaction`,
      summary: 'Research context, omitted-context summary, memory snapshot, evidence, approved artifacts, and synthesis trace compacted.',
      maxTraceEvents: input.maxTraceEvents ?? 6,
      retainRecentEvents: input.retainRecentEvents ?? 3,
      now: input.now,
    });
    latestSession = openSession(input.sessionId);
    compacted = true;
  }

  return {
    session: latestSession,
    planSteps,
    finalized: true,
    compacted,
    pendingApprovalIds,
    completedApprovalIds,
    failedApprovalIds,
    reconciledApprovalIds: completedApprovalIds,
  };
}

export function finalizeResearchAgentApprovedArtifacts(
  input: FinalizeResearchAgentApprovedArtifactsInput,
): FinalizeResearchAgentApprovedArtifactsResult {
  const session = useAgentSessionStore.getState().getSession(input.sessionId);
  const completedArtifactCount = session?.pendingApprovals.filter((approval) =>
    (approval.toolName === 'workbench.createDraft' || approval.toolName === 'workbench.createProposal') &&
    approval.status === 'completed',
  ).length ?? 0;
  return reconcileResearchAgentPendingApprovals({
    ...input,
    toolNames: ['workbench.createDraft', 'workbench.createProposal'],
    completionMessage: `Research agent completed after ${completedArtifactCount} approved artifact tool${completedArtifactCount === 1 ? '' : 's'}.`,
  });
}

export async function runResearchAgent(
  input: ResearchAgentRunInput = {},
): Promise<ResearchAgentRunResult> {
  throwIfResearchAgentAborted(input.plannerSignal);
  const now = input.now ?? Date.now();
  const task = input.task ?? 'Research agent run';
  const filePath = input.filePath ?? 'research/current-note.md';
  const content = input.content ?? '';
  const selection = input.selection ?? content.slice(0, 800);
  const query = input.query ?? task;
  const effectiveMemoryQuery: AgentMemoryQuery = input.memoryQuery ?? {
    scopes: ['workspace', 'project', 'conversation', 'user'],
    limit: 6,
  };
  const memoryQueryLimit = effectiveMemoryQuery.limit ?? 6;
  const memoryCandidates = useAgentMemoryStore.getState().queryMemories({
    ...effectiveMemoryQuery,
    limit: undefined,
  });
  const memoryQueryScopesPreview = effectiveMemoryQuery.scopes?.join(',') ?? null;
  const shouldIncludeWorkspaceSummary = input.includeWorkspaceSummary ?? Boolean(input.workspaceKey || input.workspaceIndex);
  const contextBudget = resolveAgentContextBudget({
    profileId: input.contextBudgetProfileId,
    override: input.contextBudget,
  });
  const workspaceSummary = shouldIncludeWorkspaceSummary
    ? getOrBuildWorkspaceSummary(input.workspaceIndex ?? getWorkspaceIndex(), {
        workspaceKey: input.workspaceKey ?? 'research-workspace',
        now,
      })
    : null;
  const continuationRecovery = buildContinuationRecoveryContext(input.continuation);
  const explicitEvidenceRefs = mergeEvidenceRefs(
    input.explicitEvidenceRefs,
    continuationRecovery.evidenceRefs,
  );
  const memoryRankingQueryText = buildMemoryRankingQueryText({
    task,
    query,
    selection,
    workflowId: input.workflowId,
    workflowTitle: input.workflowTitle,
    evidenceRefs: explicitEvidenceRefs,
  });
  const rankedMemory = rankAgentMemoryEntriesForContext({
    entries: memoryCandidates,
    queryText: memoryRankingQueryText,
    workspaceKey: effectiveMemoryQuery.workspaceKey,
    projectKey: effectiveMemoryQuery.projectKey,
    conversationId: effectiveMemoryQuery.conversationId,
    limit: memoryQueryLimit,
  });
  const memoryEntries = rankedMemory.map((item) => item.entry);
  const memoryRankedPreview = buildMemoryRankingPreview(rankedMemory);
  const memoryLifecycleAudit = buildMemoryLifecycleAuditPreview(rankedMemory, now);

  const contextPack = buildAgentContextPack({
    id: input.contextPackId ?? `research-context-pack-${now}`,
    now,
    explicitEvidenceRefs,
    selection: selection.trim()
      ? {
          text: selection,
          label: 'Research task selection',
        }
      : undefined,
    activeFile: content.trim()
      ? {
          path: filePath,
          summary: content.slice(0, 1200),
        }
      : undefined,
    workspaceChunks: workspaceSummary
      ? [{
          id: `summary-${workspaceSummary.indexVersion}`,
          path: workspaceSummary.workspaceKey,
          label: 'Cached workspace summary',
          content: workspaceSummary.summary,
        }]
      : undefined,
    memoryEntries,
    heavyInputs: continuationRecovery.heavyInput ? [continuationRecovery.heavyInput] : undefined,
    budget: contextBudget,
  });
  const omittedModelSummary = await buildOmittedModelSummary({
    task,
    query,
    contextPack,
    generateOmittedSummary: input.generateOmittedSummary,
    signal: input.plannerSignal,
  });
  const plannerContextSummary = buildPlannerContextSummary({
    contextPack,
    omittedModelSummary,
  });
  const memorySnapshotIds = memoryEntries.map((entry) => entry.id);
  const planContext = {
    includeDraftStep: Boolean(input.artifacts?.draft),
    includeProposalStep: Boolean(input.artifacts?.proposal),
    includeCompactionStep: input.compact ?? true,
    ...(input.filePath ? {
      pathIdentity: {
        filePathOrAbsolutePath: input.filePath,
        fileName: input.filePath.split(/[\\/]/).pop() ?? input.filePath,
        ...(input.filePath.toLowerCase().endsWith('.pdf') ? { kind: 'pdf' as const } : {}),
      },
    } : {}),
  };
  const plannerRun = input.planSteps === undefined && !input.plannerOutput && input.generatePlan
    ? await runResearchAgentPlanner({
        task,
        query,
        contextPackId: contextPack.id,
        contextSummary: plannerContextSummary,
        memoryCount: memorySnapshotIds.length,
        evidenceCount: contextPack.evidenceRefs.length,
        includeDraftStep: planContext.includeDraftStep,
        includeProposalStep: planContext.includeProposalStep,
        includeCompactionStep: planContext.includeCompactionStep,
        continuationSummary: continuationRecovery.plannerSummary,
        workflowHints: input.plannerHints,
        generatePlan: input.generatePlan,
        model: input.plannerModel,
        temperature: input.plannerTemperature,
        maxTokens: input.plannerMaxTokens,
        signal: input.plannerSignal,
      })
    : null;
  throwIfResearchAgentAborted(input.plannerSignal);
  const plan = input.planSteps !== undefined
    ? normalizeResearchAgentPlan({
        planSteps: input.planSteps,
        context: planContext,
      })
    : input.plannerOutput
      ? parseResearchAgentPlannerOutput({
          output: input.plannerOutput,
          context: planContext,
        })
      : plannerRun?.plan ?? normalizeResearchAgentPlan({
          context: planContext,
        });
  const recoveryReadPlan = insertContinuationRecoveryReadSteps({
    steps: plan.steps,
    continuationRecovery,
  });
  let planSteps = recoveryReadPlan.steps;

  const agentStore = useAgentSessionStore.getState();
  const existingSession = input.sessionId ? agentStore.getSession(input.sessionId) : null;
  const sessionId = existingSession && !isTerminalResearchAgentStatus(existingSession.status)
    ? existingSession.id
    : agentStore.createSession({
        id: input.sessionId,
        profile: 'research',
        task,
        title: input.title ?? 'Research agent run',
        evidenceRefs: contextPack.evidenceRefs,
        contextPackId: contextPack.id,
        memorySnapshotIds,
        now,
      });
  try {
    throwIfResearchAgentAborted(input.plannerSignal);
  } catch (error) {
    if (isAbortError(error)) {
      cancelResearchAgentSessionIfOpen(sessionId);
    }
    throw error;
  }
  const plannerPromptPreview = buildPlannerPreview(plannerRun?.prompt);
  const plannerRawOutput = input.plannerOutput ?? plannerRun?.rawOutput ?? null;
  const plannerRawOutputPreview = buildPlannerPreview(plannerRawOutput);
  agentStore.appendTrace(sessionId, {
    id: `${sessionId}:plan-created`,
    kind: 'planning',
    timestamp: now + 1,
    message: `Created research plan with ${planSteps.length} steps.`,
    metadata: {
      agentKind: 'research_agent',
      planStepCount: planSteps.length,
      planSource: plan.source,
      planWarningCount: plan.warnings.length,
      plannerPromptPreview,
      plannerRawOutputPreview,
      workflowId: input.workflowId ?? null,
      workflowTitle: input.workflowTitle ?? null,
      workflowInferred: input.workflowInferred ?? false,
      continuationSourceSessionId: input.continuation?.sourceSessionId ?? null,
      continuationCompactionId: input.continuation?.compactionId ?? null,
      continuationSourceSummary: input.continuation?.sourceSummary?.slice(0, 500) ?? null,
      continuationRecoverySummary: continuationRecovery.summary?.slice(0, 500) ?? null,
      continuationRecoveredEvidenceCount: continuationRecovery.evidenceRefs.length,
      continuationRecoveryHintsPreview: continuationRecovery.recoveryHintsPreview?.slice(0, 900) ?? null,
      continuationRecoveryPriorityPreview: continuationRecovery.recoveryPriorityPreview?.slice(0, 900) ?? null,
      continuationRecoveryPlanPreview: continuationRecovery.recoveryPlanPreview?.slice(0, 1100) ?? null,
      continuationRecoveryAutoSummaryPreview: continuationRecovery.autoSummaryPreview?.slice(0, 900) ?? null,
      continuationRecoveryModelSummaryPreview: continuationRecovery.modelSummaryPreview?.slice(0, 900) ?? null,
      continuationRecoverySemanticPreview: continuationRecovery.semanticPreview?.slice(0, 900) ?? null,
      continuationRecoveryReadPathCount: recoveryReadPlan.recoveryReadPaths.length,
      continuationRecoveryReadPathsPreview: recoveryReadPlan.recoveryReadPaths.join(',').slice(0, 500),
    },
  });
  if (recoveryReadPlan.recoveryReadPaths.length > 0) {
    agentStore.appendTrace(sessionId, {
      id: `${sessionId}:continuation-recovery-read-plan`,
      kind: 'planning',
      timestamp: now + 1.25,
      message: `Planned ${recoveryReadPlan.recoveryReadPaths.length} high-priority omitted context recovery read${recoveryReadPlan.recoveryReadPaths.length === 1 ? '' : 's'}.`,
      metadata: {
        continuationRecoveryReadPathCount: recoveryReadPlan.recoveryReadPaths.length,
        continuationRecoveryReadPathsPreview: recoveryReadPlan.recoveryReadPaths.join(',').slice(0, 500),
        continuationRecoveryPriorityPreview: continuationRecovery.recoveryPriorityPreview?.slice(0, 900) ?? null,
        continuationRecoveryPlanPreview: continuationRecovery.recoveryPlanPreview?.slice(0, 1100) ?? null,
        continuationRecoveryAutoSummaryPreview: continuationRecovery.autoSummaryPreview?.slice(0, 900) ?? null,
        continuationRecoveryModelSummaryPreview: continuationRecovery.modelSummaryPreview?.slice(0, 900) ?? null,
      },
    });
  }
  if (plan.warnings.length > 0) {
    agentStore.appendTrace(sessionId, {
      id: `${sessionId}:plan-warnings`,
      kind: 'planning',
      timestamp: now + 1.5,
      message: `Research plan fell back to defaults: ${plan.warnings.join(' ')}`,
      metadata: {
        planSource: plan.source,
        planWarningCount: plan.warnings.length,
      },
    });
  }
  agentStore.appendTrace(sessionId, {
    id: `${sessionId}:context-pack`,
    kind: 'planning',
    timestamp: now + 2,
    message: `Built research context pack ${contextPack.id}.`,
    evidenceRefs: contextPack.evidenceRefs,
    metadata: {
      contextPackId: contextPack.id,
      contextPackTokens: contextPack.tokenEstimate,
      contextPackTruncated: contextPack.truncated,
      omittedContextCount: contextPack.omittedSummary.totalOmittedCount,
      omittedContextTokens: contextPack.omittedSummary.totalOmittedTokens,
      omittedContextPreview: contextPack.omittedSummary.preview.slice(0, 500),
      omittedContextAutoSummary: contextPack.omittedSummary.autoSummaryPreview.slice(0, 900),
      omittedContextModelSummary: omittedModelSummary.summary?.slice(0, 900) ?? null,
      omittedContextModelSummaryStatus: omittedModelSummary.status,
      omittedContextModelSummaryWarning: omittedModelSummary.warning?.slice(0, 500) ?? null,
      omittedContextModelSummaryQualityStatus: omittedModelSummary.quality.status,
      omittedContextModelSummaryQualityScore: omittedModelSummary.quality.score,
      omittedContextModelSummaryQualitySummary: omittedModelSummary.quality.summary,
      omittedContextSemanticPreview: contextPack.omittedSummary.semanticPreview.slice(0, 900),
      omittedContextRecoveryHints: contextPack.omittedSummary.recoveryHintsPreview.slice(0, 900),
      omittedContextRecoveryPriority: contextPack.omittedSummary.recoveryPriorityPreview.slice(0, 900),
      omittedContextRecoveryPlan: contextPack.omittedSummary.recoveryPlanPreview.slice(0, 1100),
      continuationRecoverySummary: continuationRecovery.summary?.slice(0, 500) ?? null,
      continuationRecoveredEvidenceCount: continuationRecovery.evidenceRefs.length,
      continuationRecoveryIncluded: Boolean(continuationRecovery.heavyInput),
      continuationRecoveryHintsPreview: continuationRecovery.recoveryHintsPreview?.slice(0, 900) ?? null,
      continuationRecoveryPriorityPreview: continuationRecovery.recoveryPriorityPreview?.slice(0, 900) ?? null,
      continuationRecoveryPlanPreview: continuationRecovery.recoveryPlanPreview?.slice(0, 1100) ?? null,
      continuationRecoveryAutoSummaryPreview: continuationRecovery.autoSummaryPreview?.slice(0, 900) ?? null,
      continuationRecoveryModelSummaryPreview: continuationRecovery.modelSummaryPreview?.slice(0, 900) ?? null,
      continuationRecoverySemanticPreview: continuationRecovery.semanticPreview?.slice(0, 900) ?? null,
      memoryCount: memorySnapshotIds.length,
      memoryQueryScopes: memoryQueryScopesPreview,
      memoryQueryWorkspaceKey: effectiveMemoryQuery.workspaceKey ?? null,
      memoryQueryProjectKey: effectiveMemoryQuery.projectKey ?? null,
      memoryQueryConversationId: effectiveMemoryQuery.conversationId ?? null,
      memoryQueryLimit,
      memoryCandidateCount: memoryCandidates.length,
      memoryRankingQueryPreview: memoryRankingQueryText.slice(0, 500),
      memoryRankedPreview,
      memoryLifecycleSummary: memoryLifecycleAudit.summary,
      memoryLifecyclePreview: memoryLifecycleAudit.preview || null,
      workspaceSummaryVersion: workspaceSummary?.indexVersion ?? null,
    },
  });
  planSteps = updateResearchAgentPlanStepStatus(planSteps, 'context-pack', 'completed');
  const contextStep = planSteps.find((step) => step.id === 'context-pack');
  if (contextStep) {
    appendPlanStepTrace({
      sessionId,
      step: contextStep,
      status: 'completed',
      timestamp: now + 3,
      message: `Completed plan step: ${contextStep.title}.`,
    });
  }

  if (memorySnapshotIds.length > 0) {
    agentStore.appendTrace(sessionId, {
      id: `${sessionId}:memory-snapshot`,
      kind: 'planning',
      timestamp: now + 4,
      message: `Loaded ${memorySnapshotIds.length} scoped memory entries for the research run.`,
      metadata: {
        memoryCount: memorySnapshotIds.length,
        memoryIdsPreview: memorySnapshotIds.slice(0, 12).join(','),
        memoryQueryScopes: memoryQueryScopesPreview,
        memoryQueryWorkspaceKey: effectiveMemoryQuery.workspaceKey ?? null,
        memoryQueryProjectKey: effectiveMemoryQuery.projectKey ?? null,
        memoryQueryConversationId: effectiveMemoryQuery.conversationId ?? null,
        memoryQueryLimit,
        memoryCandidateCount: memoryCandidates.length,
        memoryRankingQueryPreview: memoryRankingQueryText.slice(0, 500),
        memoryRankedPreview,
        memoryLifecycleSummary: memoryLifecycleAudit.summary,
        memoryLifecyclePreview: memoryLifecycleAudit.preview || null,
      },
    });
  }

  const observationReplanGenerate = input.generatePlan;
  const maxObservationReplans = Math.max(0, input.maxObservationReplans ?? 1);
  let readToolLoop: ResearchAgentReadToolLoopResult = {
    planSteps,
    toolResults: [],
    summaries: [],
    observations: [],
    blocked: false,
  };
  let observationPlannerPrompt: string | null = null;
  let observationPlannerRawOutput: string | null = null;
  let observationReplanIteration = 0;
  let observationReplanStopReason: string | null = null;
  let observationQualitySummary: string | null = null;
  let observationDuplicateCount = 0;
  let observationLowValueCount = 0;
  let recoveryObservationTotalCount = 0;
  let recoveryObservationLocatorsPreview: string | null = null;
  let recoveryQuality = evaluateContinuationRecoveryQuality({
    plannedLocators: recoveryReadPlan.recoveryReadPaths,
    observations: [],
  });
  const seenObservationRequestSignatures = new Set<string>();

  while (true) {
    let iterationReadToolLoop: ResearchAgentReadToolLoopResult;
    try {
      throwIfResearchAgentAborted(input.plannerSignal);
      iterationReadToolLoop = await runResearchAgentReadToolLoop({
        sessionId,
        planSteps,
        query,
        now: now + 4.5 + (observationReplanIteration * 0.5),
        maxReadToolSteps: input.maxReadToolSteps,
        signal: input.plannerSignal,
      });
      throwIfResearchAgentAborted(input.plannerSignal);
    } catch (error) {
      if (isAbortError(error)) {
        cancelResearchAgentSessionIfOpen(sessionId);
      } else {
        const diagnostic = classifyAgentError({
          error,
          stage: 'context.read_tool_loop',
          category: 'context',
        });
        agentStore.appendTrace(sessionId, {
          id: `${sessionId}:read-tool-loop-failed`,
          kind: 'error',
          timestamp: now + 4.75 + (observationReplanIteration * 0.5),
          message: diagnostic.message,
          error: diagnostic.message,
          metadata: agentErrorMetadata(diagnostic),
        });
        if (openSession(sessionId).status !== 'failed') {
          agentStore.failSession(sessionId, diagnostic.message);
        }
      }
      throw error;
    }

    planSteps = iterationReadToolLoop.planSteps;
    readToolLoop = {
      planSteps,
      toolResults: [...readToolLoop.toolResults, ...iterationReadToolLoop.toolResults],
      summaries: [...readToolLoop.summaries, ...iterationReadToolLoop.summaries],
      observations: [...readToolLoop.observations, ...iterationReadToolLoop.observations],
      blocked: readToolLoop.blocked || iterationReadToolLoop.blocked,
    };

    const iterationObservationsSummary = buildToolObservationsSummary(iterationReadToolLoop.observations);
    const iterationRecoveryObservationCount = iterationReadToolLoop.observations.filter(
      (observation) => observation.purpose === 'recovery_read',
    ).length;
    const iterationRecoveryObservationLocatorsPreview = buildRecoveryObservationLocatorsPreview(
      iterationReadToolLoop.observations,
    );
    const quality = summarizeObservationQuality({
      observations: iterationReadToolLoop.observations,
      seenRequestSignatures: seenObservationRequestSignatures,
    });
    const iterationRecoveryQuality = evaluateContinuationRecoveryQuality({
      plannedLocators: recoveryReadPlan.recoveryReadPaths,
      observations: iterationReadToolLoop.observations,
    });
    observationQualitySummary = quality.qualitySummary;
    observationDuplicateCount += quality.duplicateCount;
    observationLowValueCount += quality.lowValueCount;
    recoveryObservationTotalCount += iterationRecoveryObservationCount;
    recoveryObservationLocatorsPreview = iterationRecoveryObservationLocatorsPreview || recoveryObservationLocatorsPreview;
    recoveryQuality = evaluateContinuationRecoveryQuality({
      plannedLocators: recoveryReadPlan.recoveryReadPaths,
      observations: readToolLoop.observations,
    });
    const hasIterationReadToolFailure = iterationReadToolLoop.toolResults.some((result) => result.status === 'failed' || result.status === 'denied');
    if (iterationReadToolLoop.blocked) {
      observationReplanStopReason = 'blocked';
      break;
    }
    if (hasIterationReadToolFailure) {
      observationReplanStopReason = 'read_tool_failed';
      break;
    }
    if (!iterationObservationsSummary) {
      observationReplanStopReason = observationReplanIteration > 0 ? 'no_new_observations' : 'no_observations';
      break;
    }
    if (observationReplanIteration > 0 && quality.stopReason) {
      observationReplanStopReason = quality.stopReason;
      break;
    }
    if (!observationReplanGenerate || input.plannerOutput || input.planSteps !== undefined) {
      observationReplanStopReason = observationReplanGenerate ? 'replan_disabled' : 'planner_unavailable';
      break;
    }
    if (observationReplanIteration >= maxObservationReplans) {
      observationReplanStopReason = 'budget_exhausted';
      break;
    }

    try {
      throwIfResearchAgentAborted(input.plannerSignal);
      const observationPlannerRun = await runResearchAgentPlanner({
        task,
        query,
        contextPackId: contextPack.id,
        contextSummary: plannerContextSummary,
        memoryCount: memorySnapshotIds.length,
        evidenceCount: contextPack.evidenceRefs.length,
        includeDraftStep: planContext.includeDraftStep,
        includeProposalStep: planContext.includeProposalStep,
        includeCompactionStep: planContext.includeCompactionStep,
        continuationSummary: continuationRecovery.plannerSummary,
        observationsSummary: iterationObservationsSummary,
        workflowHints: input.plannerHints,
        generatePlan: observationReplanGenerate,
        model: input.plannerModel,
        temperature: input.plannerTemperature,
        maxTokens: input.plannerMaxTokens,
        signal: input.plannerSignal,
      });
      observationPlannerPrompt = observationPlannerRun.prompt;
      observationPlannerRawOutput = observationPlannerRun.rawOutput;
      const merged = mergeObservationReplanSteps({
        current: planSteps,
        replanned: observationPlannerRun.plan.steps,
      });
      const observationRecoveryRecommendation = buildObservationRecoveryRecommendation({
        stopReason: merged.updatedStepIds.length === 0 ? 'no_pending_updates' : null,
        qualitySummary: quality.qualitySummary,
        recoveryQualitySummary: iterationRecoveryQuality.summary,
        observationsPreview: iterationObservationsSummary,
      });
      planSteps = merged.steps;
      readToolLoop = {
        ...readToolLoop,
        planSteps,
      };
      observationReplanIteration += 1;
      agentStore.appendTrace(sessionId, {
        id: observationReplanIteration === 1
          ? `${sessionId}:observation-replan`
          : `${sessionId}:observation-replan:${observationReplanIteration}`,
        kind: 'planning',
        timestamp: now + 4.9 + (observationReplanIteration * 0.5),
        message: `Replanned pending steps from ${iterationReadToolLoop.observations.length} tool observation${iterationReadToolLoop.observations.length === 1 ? '' : 's'}.`,
        metadata: {
          planSource: observationPlannerRun.plan.source,
          planWarningCount: observationPlannerRun.plan.warnings.length,
          observationCount: iterationReadToolLoop.observations.length,
          observationReplanIteration,
          observationReplanBudget: maxObservationReplans,
          observationQualitySummary: quality.qualitySummary,
          observationDuplicateCount: quality.duplicateCount,
          observationLowValueCount: quality.lowValueCount,
          recoveryObservationCount: iterationRecoveryObservationCount,
          recoveryObservationLocatorsPreview: iterationRecoveryObservationLocatorsPreview,
          recoveryQualityStatus: iterationRecoveryQuality.status,
          recoveryQualitySummary: iterationRecoveryQuality.summary,
          recoveryQualityMissingLocators: iterationRecoveryQuality.missingLocators.join(',').slice(0, 500),
          updatedStepIds: merged.updatedStepIds.join(','),
          ignoredStepIds: merged.ignoredStepIds.join(','),
          observationsPreview: iterationObservationsSummary.slice(0, 900),
          observationRecoveryRecommendation,
          plannerPromptPreview: buildPlannerPreview(observationPlannerRun.prompt),
          plannerRawOutputPreview: buildPlannerPreview(observationPlannerRun.rawOutput),
        },
      });
      if (merged.updatedStepIds.length === 0) {
        observationReplanStopReason = 'no_pending_updates';
        break;
      }
      if (observationReplanIteration >= maxObservationReplans) {
        observationReplanStopReason = 'budget_exhausted';
        break;
      }
    } catch (error) {
      if (isAbortError(error)) {
        cancelResearchAgentSessionIfOpen(sessionId);
        throw error;
      }
      const diagnostic = classifyAgentError({
        error,
        stage: 'planner.observation_replan',
        category: 'planner',
      });
      observationReplanStopReason = 'planner_error';
      const observationRecoveryRecommendation = buildObservationRecoveryRecommendation({
        stopReason: observationReplanStopReason,
        qualitySummary: quality.qualitySummary,
        recoveryQualitySummary: iterationRecoveryQuality.summary,
        observationsPreview: iterationObservationsSummary,
      });
      agentStore.appendTrace(sessionId, {
        id: `${sessionId}:observation-replan-warning`,
        kind: 'planning',
        timestamp: now + 4.9,
        message: `Observation replan skipped: ${diagnostic.message}`,
        metadata: {
          observationCount: iterationReadToolLoop.observations.length,
          observationReplanIteration: observationReplanIteration + 1,
          observationReplanBudget: maxObservationReplans,
          observationQualitySummary: quality.qualitySummary,
          observationDuplicateCount: quality.duplicateCount,
          observationLowValueCount: quality.lowValueCount,
          recoveryObservationCount: iterationRecoveryObservationCount,
          recoveryObservationLocatorsPreview: iterationRecoveryObservationLocatorsPreview,
          recoveryQualityStatus: iterationRecoveryQuality.status,
          recoveryQualitySummary: iterationRecoveryQuality.summary,
          recoveryQualityMissingLocators: iterationRecoveryQuality.missingLocators.join(',').slice(0, 500),
          observationsPreview: iterationObservationsSummary.slice(0, 900),
          observationRecoveryRecommendation,
          ...agentErrorMetadata(diagnostic),
        },
      });
      break;
    }

    for (const observation of iterationReadToolLoop.observations) {
      seenObservationRequestSignatures.add(observation.requestSignature);
    }
  }

  if (observationReplanStopReason && maxObservationReplans > 1) {
    const observationsPreview = (buildToolObservationsSummary(readToolLoop.observations) ?? '').slice(0, 900);
    const observationRecoveryRecommendation = buildObservationRecoveryRecommendation({
      stopReason: observationReplanStopReason,
      qualitySummary: observationQualitySummary,
      recoveryQualitySummary: recoveryQuality.summary,
      observationsPreview,
    });
    agentStore.appendTrace(sessionId, {
      id: `${sessionId}:observation-replan-stop`,
      kind: 'planning',
      timestamp: now + 5.6 + (observationReplanIteration * 0.5),
      message: `Observation replan loop stopped: ${observationReplanStopReason}.`,
      metadata: {
        observationReplanStopReason,
        observationReplanIteration,
        observationReplanBudget: maxObservationReplans,
        observationCount: readToolLoop.observations.length,
        observationQualitySummary,
        observationDuplicateCount,
        observationLowValueCount,
        recoveryObservationCount: recoveryObservationTotalCount,
        recoveryObservationLocatorsPreview,
        recoveryQualityStatus: recoveryQuality.status,
        recoveryQualitySummary: recoveryQuality.summary,
        recoveryQualityMissingLocators: recoveryQuality.missingLocators.join(',').slice(0, 500),
        observationsPreview,
        observationRecoveryRecommendation,
      },
    });
  }

  const hasReadToolFailure = readToolLoop.toolResults.some((result) => result.status === 'failed' || result.status === 'denied');
  if (hasReadToolFailure) {
    const failed = readToolLoop.toolResults.find((result) => result.status === 'failed' || result.status === 'denied');
    const error = failed?.error ?? 'Research agent planned tool step failed.';
    const diagnostic = classifyAgentError({
      error,
      stage: 'context.read_tool_result',
      toolName: failed?.toolName,
      category: failed?.status === 'denied' ? 'policy' : 'context',
    });
    agentStore.appendTrace(sessionId, {
      id: `${sessionId}:read-tool-result-failed`,
      kind: 'error',
      timestamp: now + 4.95,
      message: `Research read tool result failed: ${diagnostic.message}`,
      error: diagnostic.message,
      metadata: agentErrorMetadata(diagnostic),
    });
    if (openSession(sessionId).status !== 'failed') {
      agentStore.failSession(sessionId, diagnostic.message);
    }
    throw new Error(diagnostic.message);
  }
  if (readToolLoop.blocked) {
    const session = openSession(sessionId);
    return {
      sessionId,
      session,
      approvalSummary: buildResearchAgentApprovalSummary(session),
      contextPack,
      promptContext: {
        prompt: '',
        nodes: [],
        evidenceRefs: [],
        truncated: false,
      },
      answer: 'Research agent is waiting for tool approval.',
      planSteps,
      planSource: plan.source,
      planWarnings: plan.warnings,
      plannerPrompt: observationPlannerPrompt ?? plannerRun?.prompt ?? null,
      plannerRawOutput: observationPlannerRawOutput ?? plannerRawOutput,
      memorySnapshotIds,
      workspaceSummary,
      artifactResults: [],
      toolResults: readToolLoop.toolResults,
      toolObservations: readToolLoop.observations,
      memorySuggestionResults: [],
      workflowId: input.workflowId,
      workflowTitle: input.workflowTitle,
    };
  }

  planSteps = updateResearchAgentPlanStepStatus(planSteps, 'evidence-resolve', 'running');
  const evidenceStep = planSteps.find((step) => step.id === 'evidence-resolve');
  if (evidenceStep) {
    appendPlanStepTrace({
      sessionId,
      step: evidenceStep,
      status: 'running',
      timestamp: now + 5,
      message: `Running plan step: ${evidenceStep.title}.`,
    });
  }

  let resolved;
  const restoredEvidenceContext = restoreResolvedEvidenceContext(openSession(sessionId));
  if (restoredEvidenceContext) {
    resolved = {
      status: 'completed' as const,
      result: restoredEvidenceContext,
      resultPreview: 'Restored evidence context from prior trace.',
      resultMetadata: {
        resultKind: 'evidence.resolve',
        resultPreview: 'Restored evidence context from prior trace.',
        evidenceCount: restoredEvidenceContext.evidenceRefs.length,
        restored: true,
      },
    };
  } else {
    try {
      throwIfResearchAgentAborted(input.plannerSignal);
      resolved = await executeAgentTool(buildEvidenceResolveRequest({
        defaults: {
          filePath,
          content,
          selection,
          query,
          explicitEvidenceRefs: contextPack.evidenceRefs,
          maxContextTokens: 3000,
        },
        step: evidenceStep,
      }), { sessionId });
      throwIfResearchAgentAborted(input.plannerSignal);
    } catch (error) {
      if (isAbortError(error)) {
        planSteps = updateResearchAgentPlanStepStatus(planSteps, 'evidence-resolve', 'failed');
        if (evidenceStep) {
          appendPlanStepTrace({
            sessionId,
            step: { ...evidenceStep, status: 'failed' },
            status: 'failed',
            timestamp: now + 6,
            message: 'Cancelled plan step: Resolve evidence.',
          });
        }
        cancelResearchAgentSessionIfOpen(sessionId);
      }
      throw error;
    }
  }

  if (resolved.status !== 'completed' || !resolved.result) {
    const error = resolved.error ?? 'Research agent evidence resolution failed.';
    const diagnostic = classifyAgentError({
      error,
      stage: 'context.evidence_resolve',
      toolName: 'evidence.resolve',
      category: resolved.status === 'denied' ? 'policy' : 'context',
    });
    planSteps = updateResearchAgentPlanStepStatus(planSteps, 'evidence-resolve', 'failed');
    if (evidenceStep) {
      appendPlanStepTrace({
        sessionId,
        step: { ...evidenceStep, status: 'failed' },
        status: 'failed',
        timestamp: now + 6,
        message: `Failed plan step: ${evidenceStep.title}.`,
        metadata: agentErrorMetadata(diagnostic),
      });
    }
    if (openSession(sessionId).status !== 'failed') {
      agentStore.failSession(sessionId, diagnostic.message);
    }
    throw new Error(diagnostic.message);
  }
  planSteps = updateResearchAgentPlanStepStatus(planSteps, 'evidence-resolve', 'completed');
  if (evidenceStep) {
    appendPlanStepTrace({
      sessionId,
      step: { ...evidenceStep, status: 'completed' },
      status: 'completed',
      timestamp: now + 6,
      message: restoredEvidenceContext
        ? `Skipped completed plan step from restored evidence context: ${evidenceStep.title}.`
        : `Completed plan step: ${evidenceStep.title}.`,
      metadata: {
        resultPreview: resolved.resultPreview ?? null,
        resolvedPromptPreview: resolved.result.prompt.slice(0, 900),
        resolvedContextNodeCount: resolved.result.nodes.length,
        resolvedEvidenceCount: resolved.result.evidenceRefs.length,
        restored: Boolean(restoredEvidenceContext),
      },
    });
  }

  const restoredSynthesisAnswer = restoreSynthesisAnswer(openSession(sessionId));
  const recoveryObservations = readToolLoop.observations.filter((observation) =>
    observation.purpose === 'recovery_read',
  );
  const recoveryObservationPreview = buildRecoveryObservationPreview(recoveryObservations);
  const recoveryObservationLocatorsPreviewForSynthesis = buildRecoveryObservationLocatorsPreview(recoveryObservations);
  const recoveredContextDigest = buildRecoveredContextDigest(recoveryObservations);
  const synthesisRecoveryQuality = evaluateContinuationRecoveryQuality({
    plannedLocators: recoveryReadPlan.recoveryReadPaths,
    observations: recoveryObservations,
  });
  const answer = restoredSynthesisAnswer ?? buildEvidenceBackedAnswer({
    task,
    query,
    workflowId: input.workflowId,
    workflowTitle: input.workflowTitle,
    contextPack,
    promptContext: resolved.result,
    memorySnapshotIds,
    memoryLifecycleAudit,
    workspaceSummary,
    plannedToolSummaries: readToolLoop.summaries,
    recoveredContextDigest,
    omittedModelSummary,
  });
  planSteps = updateResearchAgentPlanStepStatus(planSteps, 'synthesize-answer', 'completed');
  const synthesisStep = planSteps.find((step) => step.id === 'synthesize-answer');
  if (synthesisStep) {
    appendPlanStepTrace({
      sessionId,
      step: synthesisStep,
      status: 'completed',
      timestamp: now + 7,
      message: restoredSynthesisAnswer
        ? `Skipped completed plan step from restored synthesis: ${synthesisStep.title}.`
        : `Completed plan step: ${synthesisStep.title}.`,
      metadata: {
        restored: Boolean(restoredSynthesisAnswer),
        answerPreview: answer.slice(0, 1200),
      },
    });
  }

  agentStore.appendTrace(sessionId, {
    id: `${sessionId}:synthesis`,
    kind: 'planning',
    timestamp: now + 8,
    message: 'Prepared research synthesis from context pack, memory, and resolved evidence.',
    evidenceRefs: resolved.result.evidenceRefs,
    metadata: {
      resolvedEvidenceCount: resolved.result.evidenceRefs.length,
      answerLength: answer.length,
      answerPreview: answer.slice(0, 1200),
      restored: Boolean(restoredSynthesisAnswer),
      toolObservationCount: readToolLoop.observations.length,
      toolObservationsPreview: readToolLoop.observations
        .slice(0, 6)
        .map((observation) => `${observation.stepId}:${observation.toolName}:${observation.status}:${observation.preview}`)
        .join(' | ')
        .slice(0, 900),
      recoveryObservationCount: recoveryObservations.length,
      recoveryObservationLocatorsPreview: recoveryObservationLocatorsPreviewForSynthesis,
      recoveryObservationPreview,
      recoveredContextDigestSummary: recoveredContextDigest.summary,
      recoveredContextDigestAnswerPreview: recoveredContextDigest.answerSection?.slice(0, 900) ?? null,
      recoveredContextUsefulCount: recoveredContextDigest.usefulCount,
      recoveredContextLowValueCount: recoveredContextDigest.lowValueCount,
      recoveryQualityStatus: synthesisRecoveryQuality.status,
      recoveryQualitySummary: synthesisRecoveryQuality.summary,
      recoveryQualityMissingLocators: synthesisRecoveryQuality.missingLocators.join(',').slice(0, 500),
    },
  });

  const memorySuggestionResults = input.suggestMemory === true
    ? await suggestResearchAgentMemory({
        sessionId,
        task,
        query,
        workflowId: input.workflowId,
        workflowTitle: input.workflowTitle,
        workspaceKey: input.workspaceKey,
        answer,
        contextPack,
        promptContext: resolved.result,
        recoveryObservations,
        recoveredContextDigest,
        omittedModelSummary,
        now: now + 8.5,
      })
    : [];

  let artifactResults: AgentToolExecutionResult[];
  try {
    throwIfResearchAgentAborted(input.plannerSignal);
    artifactResults = await executeArtifactRequests({
      sessionId,
      artifacts: input.artifacts,
    });
    throwIfResearchAgentAborted(input.plannerSignal);
  } catch (error) {
    if (isAbortError(error)) {
      cancelResearchAgentSessionIfOpen(sessionId);
    }
    throw error;
  }
  const hasPendingApproval = [...memorySuggestionResults, ...artifactResults].some((result) => result.status === 'requires_approval');
  const hasArtifactFailure = [...memorySuggestionResults, ...artifactResults].some((result) => result.status === 'denied' || result.status === 'failed');
  for (const result of artifactResults) {
    const stepId = result.toolName === 'workbench.createDraft'
      ? 'create-draft'
      : result.toolName === 'workbench.createProposal'
        ? 'create-proposal'
        : null;
    if (!stepId) {
      continue;
    }
    const status: ResearchAgentPlanStepStatus = result.status === 'completed'
      ? 'completed'
      : result.status === 'requires_approval'
        ? 'blocked'
        : 'failed';
    planSteps = updateResearchAgentPlanStepStatus(planSteps, stepId, status);
    const step = planSteps.find((item) => item.id === stepId);
    if (step) {
      appendPlanStepTrace({
        sessionId,
        step,
        status,
        timestamp: Date.now(),
        message: status === 'blocked'
          ? `Plan step blocked on approval: ${step.title}.`
          : `Plan step ${status}: ${step.title}.`,
      });
    }
  }

  if (!hasPendingApproval && !hasArtifactFailure) {
    agentStore.completeSession(
      sessionId,
      `Research agent completed with ${resolved.result.evidenceRefs.length} evidence refs.`,
    );
  }

  if ((input.compact ?? true) && !hasPendingApproval) {
    planSteps = updateResearchAgentPlanStepStatus(planSteps, 'compact-session', 'completed');
    agentStore.compactSession(sessionId, {
      id: `${sessionId}:compaction`,
      summary: 'Research context, omitted-context summary, memory snapshot, evidence, and synthesis trace compacted.',
      maxTraceEvents: input.maxTraceEvents ?? 6,
      retainRecentEvents: input.retainRecentEvents ?? 3,
      now: now + 9,
    });
  }

  const session = openSession(sessionId);
  return {
    sessionId,
    session,
    approvalSummary: buildResearchAgentApprovalSummary(session),
    contextPack,
    promptContext: resolved.result,
    answer,
    planSteps,
    planSource: plan.source,
    planWarnings: plan.warnings,
    plannerPrompt: observationPlannerPrompt ?? plannerRun?.prompt ?? null,
    plannerRawOutput: observationPlannerRawOutput ?? plannerRawOutput,
    memorySnapshotIds,
    workspaceSummary,
    artifactResults,
    toolResults: readToolLoop.toolResults,
    toolObservations: readToolLoop.observations,
    memorySuggestionResults,
    workflowId: input.workflowId,
    workflowTitle: input.workflowTitle,
    workflowInferred: input.workflowInferred,
    continuation: input.continuation,
  };
}
