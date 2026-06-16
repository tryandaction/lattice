import {
  executeAgentTool,
  type AgentToolExecutionResult,
  type AgentToolRequest,
  type ReadIndexedContextToolArgs,
  type ResolveLatticePathIdentityToolArgs,
  type ResolveEvidenceToolArgs,
  type WorkspaceSearchToolArgs,
} from './agent-tool-broker';
import {
  updateResearchAgentPlanStepStatus,
  type ResearchAgentPlanStep,
  type ResearchAgentPlanStepStatus,
} from './research-agent-planner';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import type { AgentSession } from './agent-session';

export interface ResearchAgentPlannedToolSummary {
  stepId: string;
  toolName: AgentToolRequest['name'];
  status: AgentToolExecutionResult['status'];
  preview: string;
}

export interface ResearchAgentToolObservation extends ResearchAgentPlannedToolSummary {
  purpose: 'read' | 'recovery_read';
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

const READ_TOOL_NAMES = new Set<AgentToolRequest['name']>([
  'workspace.search',
  'workspace.readIndexedContext',
  'lattice.resolvePathIdentity',
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
}) {
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
    },
  });
}

function buildReadToolRequest(step: ResearchAgentPlanStep, query: string): AgentToolRequest | null {
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
  return `${request.name}:${JSON.stringify(request.args)}`;
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
  if (!input.session || !input.step.toolName || !READ_TOOL_NAMES.has(input.step.toolName)) {
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
  sessionId: string;
  planSteps: ResearchAgentPlanStep[];
  query: string;
  now: number;
  maxReadToolSteps?: number;
  signal?: AbortSignal;
}): Promise<ResearchAgentReadToolLoopResult> {
  let planSteps = input.planSteps;
  const toolResults: AgentToolExecutionResult[] = [];
  const summaries: ResearchAgentPlannedToolSummary[] = [];
  const observations: ResearchAgentToolObservation[] = [];
  let timestamp = input.now;
  const maxReadToolSteps = Math.max(0, input.maxReadToolSteps ?? DEFAULT_MAX_READ_TOOL_STEPS);
  let executedReadToolSteps = 0;
  const session = useAgentSessionStore.getState().getSession(input.sessionId);

  for (const step of input.planSteps) {
    throwIfAborted(input.signal);
    if (step.status !== 'pending' || !step.toolName || CORE_STEP_IDS.has(step.id) || !READ_TOOL_NAMES.has(step.toolName)) {
      continue;
    }

    const request = buildReadToolRequest(step, input.query);
    if (!request) {
      continue;
    }

    const restoredObservation = restoreCompletedObservation({ session, step });
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

    if (executedReadToolSteps >= maxReadToolSteps) {
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

    planSteps = updateResearchAgentPlanStepStatus(planSteps, step.id, 'running');
    appendPlanStepTrace({
      sessionId: input.sessionId,
      step,
      status: 'running',
      timestamp: timestamp += 0.1,
      message: `Running plan step: ${step.title}.`,
    });

    throwIfAborted(input.signal);
    executedReadToolSteps += 1;
    const result = await executeAgentTool(request, { sessionId: input.sessionId });
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
      purpose: recoveryLocator ? 'recovery_read' : 'read',
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
