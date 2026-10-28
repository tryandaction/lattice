import {
  executeAgentTool,
  buildRunCodeRequestSignature,
  isLatticeApiToolName,
  type AgentToolExecutionResult,
  type AgentToolRequest,
  type ReadIndexedContextToolArgs,
  type ResolveLatticePathIdentityToolArgs,
  type ResolveEvidenceToolArgs,
  type WorkspaceSearchToolArgs,
  type ScheduleTaskToolArgs,
  type LatticeSourcePdfExecutionRuntime,
  type LatticeApiToolRuntime,
} from './agent-tool-broker';
import { LATTICE_HARNESS_TOOLS } from './harness/lattice-tool-definitions';
import {
  updateResearchAgentPlanStepStatus,
  normalizeResearchAgentRunCodeArgs,
  type ResearchAgentPlanStep,
  type ResearchAgentPlanStepStatus,
} from './research-agent-planner';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import type { AgentSession } from './agent-session';
import type { AgentSourceSelection } from './source-index';
import { targetedSourceSearchPlan } from './research-source-recovery';

export interface ResearchAgentPlannedToolSummary {
  stepId: string;
  toolName: AgentToolRequest['name'];
  status: AgentToolExecutionResult['status'];
  preview: string;
}

export interface ResearchAgentToolObservation extends ResearchAgentPlannedToolSummary {
  /** Untrusted output from a matching execution receipt; never an instruction. */
  output?: string;
  outputTruncated?: boolean;
  purpose: 'read' | 'recovery_read' | 'action';
  recoveryLocator: string | null;
  evidenceCount: number;
  requestSignature: string;
  resultItemCount: number | null;
  resultSize: number | null;
  resultStatus: string | null;
  resultSummary: string | null;
  resultMetricsPreview: string | null;
  resultArtifactsPreview: string | null;
  resultDiagnosticsPreview: string | null;
  metadataPreview: string | null;
}

export interface ResearchAgentReadToolLoopResult {
  planSteps: ResearchAgentPlanStep[];
  toolResults: AgentToolExecutionResult[];
  summaries: ResearchAgentPlannedToolSummary[];
  observations: ResearchAgentToolObservation[];
  blocked: boolean;
}

export interface ResearchAgentEvidenceDefaults extends ResolveEvidenceToolArgs {
  query: string;
  maxContextTokens: number;
}

const CORE_STEP_IDS = new Set([
  'context-pack',
  'evidence-resolve',
  'synthesize-answer',
  'compact-session',
]);

const PLANNED_TOOL_NAMES = new Set<AgentToolRequest['name']>([
  ...LATTICE_HARNESS_TOOLS.map(tool => tool.name),
  'workspace.search',
  'workspace.readIndexedContext',
  'lattice.resolvePathIdentity',
  'schedule_task',
  'runner.runCode',
]);

const DEFAULT_MAX_READ_TOOL_STEPS = 8;

function createAbortError(message = 'Research agent run was cancelled.'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) {
    return;
  }
  throw createAbortError();
}

function appendPlanStepTrace(input: {
  sessionId: string;
  step: ResearchAgentPlanStep;
  status: ResearchAgentPlanStepStatus;
  timestamp: number;
  message: string;
  resultPreview?: string;
  approvalRequestId?: string;
  requestSignature?: string;
}) {
  const session = useAgentSessionStore.getState().getSession(input.sessionId);
  // The broker may already have recorded a terminal failure or rejection.
  // Preserve that state while still returning its observation to the caller.
  if (session && (session.status === 'failed' || session.status === 'cancelled' || session.status === 'completed')) return;
  useAgentSessionStore.getState().appendTrace(input.sessionId, {
    id: `${input.sessionId}:plan:${input.step.id}:${input.status}:${input.timestamp}`,
    kind: 'planning',
    timestamp: input.timestamp,
    message: input.message,
    metadata: {
      planStepId: input.step.id,
      planStepStatus: input.status,
      toolName: input.step.toolName ?? null,
      resultPreview: input.resultPreview ?? null,
      approvalRequestId: input.approvalRequestId ?? null,
      requestSignature: input.requestSignature ?? null,
    },
  });
}

function buildReadToolRequest(step: ResearchAgentPlanStep, query: string): AgentToolRequest | null {
  if (step.toolName && isLatticeApiToolName(step.toolName)) {
    return { name: step.toolName, args: (step.toolArgs ?? {}) as Record<string, unknown> };
  }
  switch (step.toolName) {
    case 'workspace.search': {
      const args = (step.toolArgs ?? {}) as Partial<WorkspaceSearchToolArgs>;
      return {
        name: 'workspace.search',
        args: {
          query: args.query ?? query,
          limit: args.limit ?? 5,
        },
      };
    }
    case 'workspace.readIndexedContext': {
      const args = (step.toolArgs ?? {}) as ReadIndexedContextToolArgs;
      return {
        name: 'workspace.readIndexedContext',
        args,
      };
    }
    case 'lattice.resolvePathIdentity': {
      const args = step.toolArgs as ResolveLatticePathIdentityToolArgs | undefined;
      if (!args?.filePathOrAbsolutePath) {
        return null;
      }
      return {
        name: 'lattice.resolvePathIdentity',
        args,
      };
    }
    case 'schedule_task': {
      const args = step.toolArgs as ScheduleTaskToolArgs | undefined;
      if (!args?.title || !args.schedule) return null;
      return { name: 'schedule_task', args };
    }
    case 'runner.runCode': {
      const args = normalizeResearchAgentRunCodeArgs(step.toolArgs);
      return args ? { name: 'runner.runCode', args } : null;
    }
    default:
      return null;
  }
}

function buildMetadataPreview(metadata: AgentToolExecutionResult['resultMetadata']): string | null {
  if (!metadata) {
    return null;
  }

  const preferredKeys = [
    'resultStatus',
    'resultSummary',
    'complete',
    'nextCursor',
    'pendingUnitCount',
    'pendingUnitsPreview',
    'resultMetricsPreview',
    'resultArtifactsPreview',
    'resultDiagnosticsPreview',
  ];
  const preferred = preferredKeys
    .filter((key) => metadata[key] !== null && metadata[key] !== undefined && String(metadata[key]).trim())
    .map((key) => `${key}=${String(metadata[key])}`);
  const fallback = Object.entries(metadata)
    .filter(([key]) => !preferredKeys.includes(key))
    .slice(0, 6)
    .map(([key, value]) => `${key}=${String(value)}`);
  const pairs = [...preferred, ...fallback].slice(0, 8);
  return pairs.length > 0 ? pairs.join(', ') : null;
}

function readEvidenceCount(metadata: AgentToolExecutionResult['resultMetadata']): number {
  const value = metadata?.evidenceCount;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readMetadataNumber(metadata: AgentToolExecutionResult['resultMetadata'], key: string): number | null {
  const value = metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readMetadataString(metadata: AgentToolExecutionResult['resultMetadata'], key: string): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function buildRequestSignature(request: AgentToolRequest): string {
  if (request.name === 'runner.runCode') return buildRunCodeRequestSignature(request.args);
  return `${request.name}:${JSON.stringify(request.args)}`;
}

function restoreRunnerApprovalResult(
  session: AgentSession | null,
  step: ResearchAgentPlanStep,
  request: Extract<AgentToolRequest, { name: 'runner.runCode' }>,
): AgentToolExecutionResult<'runner.runCode'> | null {
  if (!session) return null;
  const requestSignature = buildRunCodeRequestSignature(request.args);
  const binding = session.trace.slice().reverse().find((event) =>
    event.kind === 'planning' && event.metadata?.planStepId === step.id &&
    event.metadata?.requestSignature === requestSignature &&
    typeof event.metadata?.approvalRequestId === 'string',
  );
  const approval = session.pendingApprovals.slice().reverse().find((item) => {
    if (item.id === binding?.metadata?.approvalRequestId) return true;
    const args = normalizeResearchAgentRunCodeArgs(item.request.args);
    return item.planStepId === step.id && item.toolName === 'runner.runCode' && args && buildRunCodeRequestSignature(args) === requestSignature;
  });
  const approvedArgs = normalizeResearchAgentRunCodeArgs(approval?.request.args);
  if (!approval || approval.toolName !== 'runner.runCode' || approval.request.name !== 'runner.runCode' ||
    !approvedArgs || buildRunCodeRequestSignature(approvedArgs) !== requestSignature) return null;

  const base = { sessionId: session.id, toolName: 'runner.runCode' as const, decision: approval.decision, approvalRequestId: approval.id };
  if (approval.status === 'pending' || approval.status === 'approved' || approval.status === 'executing') {
    return { ...base, status: 'requires_approval', resultPreview: approval.status === 'executing' ? 'Approved computation is still running.' : 'Computation is waiting for explicit tool approval.' };
  }
  if (approval.status === 'rejected') return { ...base, status: 'denied', error: approval.error ?? 'User rejected the computation.' };

  const receipt = approval.executionReceipt;
  if (!receipt || receipt.sessionId !== session.id || receipt.approvalRequestId !== approval.id ||
    receipt.requestSignature !== requestSignature || receipt.status !== approval.status) {
    return { ...base, status: 'failed', error: 'A matching execution receipt is unavailable; the computation was not rerun.' };
  }
  const failed = receipt.status === 'failed';
  return {
    ...base, status: receipt.status,
    ...(failed ? { error: receipt.output } : { result: { output: receipt.output } }),
    resultPreview: approval.resultPreview ?? receipt.output.slice(0, 320),
    resultMetadata: {
      resultStatus: failed ? 'failed' : receipt.truncated ? 'partial' : 'completed',
      resultSummary: failed ? 'Approved runner execution failed.' : receipt.truncated ? 'Runner output captured; retained output is truncated.' : 'Runner output captured.',
      resultSize: receipt.outputLength, outputTruncated: receipt.truncated,
      resultDiagnosticsPreview: failed ? receipt.output : null, restored: true,
    },
  };
}

function readRecoveryLocator(step: ResearchAgentPlanStep): string | null {
  if (!step.id.startsWith('recover-omitted-context-') || step.toolName !== 'workspace.readIndexedContext') {
    return null;
  }
  const paths = (step.toolArgs as ReadIndexedContextToolArgs | undefined)?.paths;
  return Array.isArray(paths) && typeof paths[0] === 'string' ? paths[0] : null;
}

function metadataString(metadata: Record<string, string | number | boolean | null> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function restoreCompletedObservation(input: {
  session: AgentSession | null;
  step: ResearchAgentPlanStep;
}): ResearchAgentToolObservation | null {
  if (!input.session || !input.step.toolName || !PLANNED_TOOL_NAMES.has(input.step.toolName)) {
    return null;
  }

  const completedTrace = input.session.trace
    .slice()
    .reverse()
    .find((event) =>
      event.kind === 'planning' &&
      event.metadata?.planStepId === input.step.id &&
      event.metadata?.planStepStatus === 'completed' &&
      event.metadata?.toolName === input.step.toolName,
    );
  if (!completedTrace) {
    return null;
  }

  const preview = metadataString(completedTrace.metadata, 'resultPreview') ?? completedTrace.message;
  const metadataPreview = buildMetadataPreview(completedTrace.metadata);
  return {
    stepId: input.step.id,
    toolName: input.step.toolName,
    status: 'completed',
    purpose: readRecoveryLocator(input.step) ? 'recovery_read' : 'read',
    recoveryLocator: readRecoveryLocator(input.step),
    preview,
    evidenceCount: 0,
    requestSignature: `${input.step.toolName}:${input.step.id}:restored`,
    resultItemCount: null,
    resultSize: null,
    resultStatus: metadataString(completedTrace.metadata, 'resultStatus'),
    resultSummary: metadataString(completedTrace.metadata, 'resultSummary'),
    resultMetricsPreview: metadataString(completedTrace.metadata, 'resultMetricsPreview'),
    resultArtifactsPreview: metadataString(completedTrace.metadata, 'resultArtifactsPreview'),
    resultDiagnosticsPreview: metadataString(completedTrace.metadata, 'resultDiagnosticsPreview'),
    metadataPreview: metadataPreview ? `restored=true, ${metadataPreview}` : 'restored=true',
  };
}

export async function runResearchAgentReadToolLoop(input: {
  apiToolRuntime?: LatticeApiToolRuntime;
  latticeSourcePdfRuntime?: LatticeSourcePdfExecutionRuntime;
  sessionId: string;
  planSteps: ResearchAgentPlanStep[];
  query: string;
  filePath?: string;
  sourceIntentQuery?: string;
  sourceSelections?: readonly AgentSourceSelection[];
  requireSourceRead?: boolean;
  now: number;
  maxReadToolSteps?: number;
  allowCodeExecution?: boolean;
  signal?: AbortSignal;
}): Promise<ResearchAgentReadToolLoopResult> {
  let planSteps = input.requireSourceRead !== false && (input.maxReadToolSteps ?? DEFAULT_MAX_READ_TOOL_STEPS) > 0 && (input.apiToolRuntime || input.latticeSourcePdfRuntime)
    ? targetedSourceSearchPlan({ query: input.query, sourceIntentQuery: input.sourceIntentQuery,
      filePath: input.filePath, selections: input.sourceSelections, steps: input.planSteps })
    : input.planSteps;
  const toolResults: AgentToolExecutionResult[] = [];
  const summaries: ResearchAgentPlannedToolSummary[] = [];
  const observations: ResearchAgentToolObservation[] = [];
  let timestamp = input.now;
  const maxReadToolSteps = Math.max(0, input.maxReadToolSteps ?? DEFAULT_MAX_READ_TOOL_STEPS);
  let executedReadToolSteps = 0;
  const session = useAgentSessionStore.getState().getSession(input.sessionId);

  for (const step of planSteps) {
    throwIfAborted(input.signal);
    const isComputation = step.toolName === 'runner.runCode';
    if ((!isComputation && step.status !== 'pending') || !step.toolName || CORE_STEP_IDS.has(step.id) || !PLANNED_TOOL_NAMES.has(step.toolName)) {
      continue;
    }
    if (isComputation && !input.allowCodeExecution) {
      throw new Error('runner.runCode requires explicit execution intent for this task.');
    }

    const request = buildReadToolRequest(step, input.query);
    if (!request) {
      if (isComputation) throw new Error('Invalid runner.runCode arguments; expected language (python or javascript) and non-empty code.');
      continue;
    }

    const restoredResult = request.name === 'runner.runCode' ? restoreRunnerApprovalResult(session, step, request) : null;
    const restoredObservation = isComputation || isLatticeApiToolName(request.name) ? null : restoreCompletedObservation({ session, step });
    if (restoredObservation) {
      planSteps = updateResearchAgentPlanStepStatus(planSteps, step.id, 'completed');
      summaries.push(restoredObservation);
      observations.push(restoredObservation);
      appendPlanStepTrace({
        sessionId: input.sessionId,
        step: { ...step, status: 'completed' },
        status: 'completed',
        timestamp: timestamp += 0.1,
        message: `Skipped completed plan step from restored observation: ${step.title}.`,
        resultPreview: restoredObservation.preview,
      });
      continue;
    }

    if (!restoredResult && executedReadToolSteps >= maxReadToolSteps) {
      planSteps = updateResearchAgentPlanStepStatus(planSteps, step.id, 'failed');
      const message = `Research agent read-tool step limit exceeded (${maxReadToolSteps}).`;
      appendPlanStepTrace({
        sessionId: input.sessionId,
        step: { ...step, status: 'failed' },
        status: 'failed',
        timestamp: timestamp += 0.1,
        message,
        resultPreview: message,
      });
      throw new Error(message);
    }

    if (isComputation && !restoredResult && step.status !== 'pending') {
      throw new Error('A matching runner.runCode approval is unavailable for this resumed step.');
    }
    planSteps = updateResearchAgentPlanStepStatus(planSteps, step.id, 'running');
    appendPlanStepTrace({
      sessionId: input.sessionId,
      step,
      status: 'running',
      timestamp: timestamp += 0.1,
      message: `Running plan step: ${step.title}.`,
    });

    throwIfAborted(input.signal);
    if (!restoredResult) executedReadToolSteps += 1;
    const result = restoredResult ?? await executeAgentTool(request, { sessionId: input.sessionId, planStepId: step.id, deferSourceReadFailure: true, deferAnnotationValidationFailure: true,
      apiToolRuntime: input.apiToolRuntime, latticeSourcePdfRuntime: input.latticeSourcePdfRuntime, signal: input.signal });
    throwIfAborted(input.signal);
    toolResults.push(result);

    const status: ResearchAgentPlanStepStatus = result.status === 'completed'
      ? 'completed'
      : result.status === 'requires_approval'
        ? 'blocked'
        : 'failed';
    planSteps = updateResearchAgentPlanStepStatus(planSteps, step.id, status);

    const resultPreview = result.resultPreview ?? result.error ?? result.status;
    const recoveryLocator = readRecoveryLocator(step);
    const observation: ResearchAgentToolObservation = {
      stepId: step.id,
      toolName: request.name,
      status: result.status,
      purpose: step.toolName === 'schedule_task' || isComputation || request.name.includes('.propose') || request.name === 'lattice.compute.evaluate' ? 'action' : recoveryLocator ? 'recovery_read' : 'read',
      ...(isComputation && result.status === 'completed' && result.result && typeof result.result === 'object' && 'output' in result.result && typeof result.result.output === 'string' ? {
        output: result.result.output, outputTruncated: result.resultMetadata?.outputTruncated === true,
      } : {}),
      ...(isLatticeApiToolName(request.name) && result.status === 'completed' ? { output: JSON.stringify(result.result).slice(0, 32000), outputTruncated: JSON.stringify(result.result).length > 32000 } : {}),
      ...(result.resultMetadata?.annotationValidationRecoverable === true && typeof result.resultMetadata.annotationRepairDetails === 'string'
        ? { output: result.resultMetadata.annotationRepairDetails, outputTruncated: false } : {}),
      recoveryLocator,
      preview: resultPreview,
      evidenceCount: readEvidenceCount(result.resultMetadata),
      requestSignature: buildRequestSignature(request),
      resultItemCount: readMetadataNumber(result.resultMetadata, 'resultItemCount'),
      resultSize: readMetadataNumber(result.resultMetadata, 'resultSize'),
      resultStatus: readMetadataString(result.resultMetadata, 'resultStatus'),
      resultSummary: readMetadataString(result.resultMetadata, 'resultSummary'),
      resultMetricsPreview: readMetadataString(result.resultMetadata, 'resultMetricsPreview'),
      resultArtifactsPreview: readMetadataString(result.resultMetadata, 'resultArtifactsPreview'),
      resultDiagnosticsPreview: readMetadataString(result.resultMetadata, 'resultDiagnosticsPreview'),
      metadataPreview: buildMetadataPreview(result.resultMetadata),
    };
    summaries.push(observation);
    observations.push(observation);
    appendPlanStepTrace({
      sessionId: input.sessionId,
      step: { ...step, status },
      status,
      timestamp: timestamp += 0.1,
      message: status === 'blocked'
        ? `Plan step blocked on approval: ${step.title}.`
        : `Plan step ${status}: ${step.title}.`,
      resultPreview,
      approvalRequestId: result.approvalRequestId,
      requestSignature: buildRequestSignature(request),
    });

    if (status !== 'completed') {
      return {
        planSteps,
        toolResults,
        summaries,
        observations,
        blocked: status === 'blocked',
      };
    }
  }

  return {
    planSteps,
    toolResults,
    summaries,
    observations,
    blocked: false,
  };
}

export function buildEvidenceResolveRequest(input: {
  defaults: ResearchAgentEvidenceDefaults;
  step?: ResearchAgentPlanStep;
}): Extract<AgentToolRequest, { name: 'evidence.resolve' }> {
  const plannedArgs = input.step?.toolName === 'evidence.resolve'
    ? (input.step.toolArgs ?? {}) as Partial<ResolveEvidenceToolArgs>
    : {};

  return {
    name: 'evidence.resolve',
    args: {
      ...input.defaults,
      query: plannedArgs.query ?? input.defaults.query,
      maxContextTokens: plannedArgs.maxContextTokens ?? input.defaults.maxContextTokens,
    },
  };
}
