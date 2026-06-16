import type {
  AgentPendingApproval,
  AgentSession,
  AgentSessionCompaction,
  AgentTraceEvent,
} from './agent-session';

export interface AgentSessionDebugBundle {
  schemaVersion: 1;
  exportedAt: number;
  session: {
    id: string;
    title: string;
    task: string;
    profile: AgentSession['profile'];
    status: AgentSession['status'];
    createdAt: number;
    updatedAt: number;
    completedAt: number | null;
    contextPackId: string | null;
    memorySnapshotCount: number;
    evidenceCount: number;
    error: string | null;
  };
  summary: {
    traceEventCount: number;
    toolRequestCount: number;
    toolResultCount: number;
    errorCount: number;
    approvalCount: number;
    pendingApprovalCount: number;
    compactionCount: number;
    omittedContextCount: number;
    omittedContextTokens: number;
  };
  diagnostics: Array<{
    eventId: string;
    category: string | null;
    stage: string | null;
    toolName: string | null;
    recoveryHint: string | null;
    error: string | null;
  }>;
  trace: Array<{
    id: string;
    kind: AgentTraceEvent['kind'];
    timestamp: number;
    message: string;
    toolName: string | null;
    capability: string | null;
    resultStatus: string | null;
    resultSummary: string | null;
    resultMetrics: string | null;
    resultArtifacts: string | null;
    error: string | null;
  }>;
  approvals: Array<{
    id: string;
    toolName: string;
    status: AgentPendingApproval['status'];
    createdAt: number;
    updatedAt: number;
    argumentsPreview: string | null;
    resultPreview: string | null;
    error: string | null;
  }>;
  compactions: Array<{
    id: string;
    createdAt: number;
    compactedEventCount: number;
    retainedEventCount: number;
    sourceEventKinds: string[];
    evidenceCount: number;
    summary: string;
  }>;
}

function metadataString(event: AgentTraceEvent, key: string): string | null {
  const value = event.metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function metadataNumber(event: AgentTraceEvent, key: string): number {
  const value = event.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function truncateDebugText(value: string | null | undefined, maxLength = 500): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...` : normalized;
}

function summarizeCompaction(compaction: AgentSessionCompaction): AgentSessionDebugBundle['compactions'][number] {
  return {
    id: compaction.id,
    createdAt: compaction.createdAt,
    compactedEventCount: compaction.compactedEventCount,
    retainedEventCount: compaction.retainedEventIds.length,
    sourceEventKinds: compaction.sourceEventKinds,
    evidenceCount: compaction.evidenceRefs.length,
    summary: truncateDebugText(compaction.summary, 700) ?? '',
  };
}

export function buildAgentSessionDebugBundle(
  session: AgentSession,
  options: { exportedAt?: number } = {},
): AgentSessionDebugBundle {
  let omittedContextCount = 0;
  let omittedContextTokens = 0;
  const diagnostics: AgentSessionDebugBundle['diagnostics'] = [];

  const trace = session.trace.map((event) => {
    omittedContextCount += metadataNumber(event, 'omittedContextCount');
    omittedContextTokens += metadataNumber(event, 'omittedContextTokens');

    const diagnostic = {
      eventId: event.id,
      category: metadataString(event, 'errorCategory'),
      stage: metadataString(event, 'errorStage'),
      toolName: metadataString(event, 'errorToolName') ?? event.tool?.toolName ?? null,
      recoveryHint: metadataString(event, 'errorRecoveryHint'),
      error: truncateDebugText(event.error, 500),
    };
    if (diagnostic.category || diagnostic.stage || diagnostic.recoveryHint || diagnostic.error) {
      diagnostics.push(diagnostic);
    }

    return {
      id: event.id,
      kind: event.kind,
      timestamp: event.timestamp,
      message: truncateDebugText(event.message, 500) ?? '',
      toolName: event.tool?.toolName ?? metadataString(event, 'toolName'),
      capability: event.tool?.capability ?? null,
      resultStatus: metadataString(event, 'resultStatus'),
      resultSummary: truncateDebugText(metadataString(event, 'resultSummary'), 500),
      resultMetrics: truncateDebugText(metadataString(event, 'resultMetricsPreview'), 500),
      resultArtifacts: truncateDebugText(metadataString(event, 'resultArtifactsPreview'), 500),
      error: truncateDebugText(event.error, 500),
    };
  });

  return {
    schemaVersion: 1,
    exportedAt: options.exportedAt ?? Date.now(),
    session: {
      id: session.id,
      title: session.title,
      task: session.task,
      profile: session.profile,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      completedAt: session.completedAt ?? null,
      contextPackId: session.contextPackId ?? null,
      memorySnapshotCount: session.memorySnapshotIds?.length ?? 0,
      evidenceCount: session.evidenceRefs.length,
      error: truncateDebugText(session.error, 500),
    },
    summary: {
      traceEventCount: session.trace.length,
      toolRequestCount: session.trace.filter((event) => event.kind === 'tool_requested').length,
      toolResultCount: session.trace.filter((event) => event.kind === 'tool_result').length,
      errorCount: session.trace.filter((event) => event.kind === 'error').length,
      approvalCount: session.pendingApprovals.length,
      pendingApprovalCount: session.pendingApprovals.filter((approval) => approval.status === 'pending').length,
      compactionCount: session.compactions.length,
      omittedContextCount,
      omittedContextTokens,
    },
    diagnostics,
    trace,
    approvals: session.pendingApprovals.map((approval) => ({
      id: approval.id,
      toolName: approval.toolName,
      status: approval.status,
      createdAt: approval.createdAt,
      updatedAt: approval.updatedAt,
      argumentsPreview: truncateDebugText(approval.argumentsPreview, 500),
      resultPreview: truncateDebugText(approval.resultPreview, 500),
      error: truncateDebugText(approval.error, 500),
    })),
    compactions: session.compactions.map(summarizeCompaction),
  };
}

export function serializeAgentSessionDebugBundle(bundle: AgentSessionDebugBundle): string {
  return JSON.stringify(bundle, null, 2);
}
