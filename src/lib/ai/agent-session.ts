import type { AiModelInfo, EvidenceRef } from './types';
import type {
  AgentCapabilityDecision,
  AgentSafetyProfile,
  AgentToolCapability,
} from './agent-policy';

export type AgentSessionStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentTraceEventKind =
  | 'session_started'
  | 'planning'
  | 'context-pack'
  | 'context_resolved'
  | 'tool_requested'
  | 'approval_required'
  | 'approval_granted'
  | 'tool_result'
  | 'draft_created'
  | 'proposal_created'
  | 'writeback_applied'
  | 'memory_updated'
  | 'error'
  | 'completed'
  | 'cancelled';

export interface AgentTraceEventBase {
  id: string;
  kind: AgentTraceEventKind;
  timestamp: number;
  message: string;
}

export interface AgentTraceToolPayload {
  capability: AgentToolCapability;
  toolName: string;
  argumentsPreview?: string;
}

export interface AgentTraceEvent extends AgentTraceEventBase {
  evidenceRefs?: EvidenceRef[];
  model?: AiModelInfo;
  tool?: AgentTraceToolPayload;
  decision?: AgentCapabilityDecision;
  artifactId?: string;
  targetPath?: string;
  error?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AgentSessionCompaction {
  id: string;
  createdAt: number;
  summary: string;
  compactedEventCount: number;
  retainedEventIds: string[];
  sourceEventKinds: AgentTraceEventKind[];
  evidenceRefs: EvidenceRef[];
}

export type AgentPendingApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'completed'
  | 'failed';

export interface AgentPendingApprovalRequest {
  name: string;
  args: unknown;
}

export interface AgentPendingApproval {
  id: string;
  capability: AgentToolCapability;
  toolName: string;
  toolLabel?: string;
  toolDescription?: string;
  toolArgsSummary?: string;
  toolResultSummary?: string;
  argumentsPreview?: string;
  request: AgentPendingApprovalRequest;
  decision: AgentCapabilityDecision;
  status: AgentPendingApprovalStatus;
  createdAt: number;
  updatedAt: number;
  approvalNote?: string;
  resultPreview?: string;
  error?: string;
}

export interface AgentSession {
  id: string;
  profile: AgentSafetyProfile;
  title: string;
  task: string;
  status: AgentSessionStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  trace: AgentTraceEvent[];
  evidenceRefs: EvidenceRef[];
  model?: AiModelInfo;
  result?: string;
  error?: string;
  approvalRequestIds: string[];
  pendingApprovals: AgentPendingApproval[];
  compactions: AgentSessionCompaction[];
  contextPackId?: string;
  memorySnapshotIds?: string[];
}

export interface CreateAgentSessionInput {
  id?: string;
  profile: AgentSafetyProfile;
  task: string;
  title?: string;
  evidenceRefs?: EvidenceRef[];
  model?: AiModelInfo;
  contextPackId?: string;
  memorySnapshotIds?: string[];
  now?: number;
}

export interface AppendAgentTraceInput extends Omit<AgentTraceEvent, 'id' | 'timestamp'> {
  id?: string;
  timestamp?: number;
}

export interface CreateAgentPendingApprovalInput {
  id: string;
  capability: AgentToolCapability;
  toolName: string;
  toolLabel?: string;
  toolDescription?: string;
  toolArgsSummary?: string;
  toolResultSummary?: string;
  argumentsPreview?: string;
  request: AgentPendingApprovalRequest;
  decision: AgentCapabilityDecision;
  approvalNote?: string;
  now?: number;
}

export interface ResolveAgentPendingApprovalInput {
  id: string;
  status: Exclude<AgentPendingApprovalStatus, 'pending'>;
  approvalNote?: string;
  resultPreview?: string;
  error?: string;
  now?: number;
}

export interface CompactAgentSessionInput {
  id?: string;
  summary?: string;
  maxTraceEvents?: number;
  retainRecentEvents?: number;
  now?: number;
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function titleFromTask(task: string): string {
  const normalized = task.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'Agent run';
  }
  return normalized.length > 64 ? `${normalized.slice(0, 64)}...` : normalized;
}

function isTerminalStatus(status: AgentSessionStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function statusAfterEvent(
  current: AgentSessionStatus,
  event: AgentTraceEvent,
): AgentSessionStatus {
  switch (event.kind) {
    case 'approval_required':
      return 'waiting_approval';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'error':
      return 'failed';
    default:
      return current === 'queued' ? 'running' : current;
  }
}

export function createAgentSession(input: CreateAgentSessionInput): AgentSession {
  const now = input.now ?? Date.now();
  const session: AgentSession = {
    id: input.id ?? generateId('agent-session'),
    profile: input.profile,
    title: input.title ?? titleFromTask(input.task),
    task: input.task,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    trace: [],
    evidenceRefs: input.evidenceRefs ?? [],
    model: input.model,
    approvalRequestIds: [],
    pendingApprovals: [],
    compactions: [],
    contextPackId: input.contextPackId,
    memorySnapshotIds: input.memorySnapshotIds,
  };

  return appendAgentTraceEvent(session, {
    id: `${session.id}:start`,
    kind: 'session_started',
    timestamp: now,
    message: `Started ${input.profile} agent session.`,
    evidenceRefs: input.evidenceRefs,
    model: input.model,
  });
}

export function appendAgentTraceEvent(
  session: AgentSession,
  input: AppendAgentTraceInput,
): AgentSession {
  if (isTerminalStatus(session.status)) {
    throw new Error(`Cannot append trace event to terminal agent session: ${session.status}`);
  }

  const timestamp = input.timestamp ?? Date.now();
  const event: AgentTraceEvent = {
    ...input,
    id: input.id ?? generateId('agent-event'),
    timestamp,
  };

  const approvalRequestIds = event.kind === 'approval_required'
    ? [...session.approvalRequestIds, event.id]
    : session.approvalRequestIds;

  const mergedEvidenceRefs = event.evidenceRefs?.length
    ? mergeEvidenceRefs(session.evidenceRefs, event.evidenceRefs)
    : session.evidenceRefs;

  const nextStatus = statusAfterEvent(session.status, event);

  return {
    ...session,
    status: nextStatus,
    updatedAt: timestamp,
    completedAt: isTerminalStatus(nextStatus) ? timestamp : session.completedAt,
    trace: [...session.trace, event],
    evidenceRefs: mergedEvidenceRefs,
    model: event.model ?? session.model,
    error: event.kind === 'error' ? event.error ?? event.message : session.error,
    result: event.kind === 'completed' ? event.message : session.result,
    approvalRequestIds,
  };
}

export function addAgentSessionMemorySnapshotIds(
  session: AgentSession,
  memoryIds: string[],
  now = Date.now(),
): AgentSession {
  const normalizedIds = memoryIds.map((id) => id.trim()).filter(Boolean);
  if (normalizedIds.length === 0) {
    return session;
  }

  const existing = new Set(session.memorySnapshotIds ?? []);
  const merged = [...(session.memorySnapshotIds ?? [])];
  for (const memoryId of normalizedIds) {
    if (!existing.has(memoryId)) {
      existing.add(memoryId);
      merged.push(memoryId);
    }
  }

  if (merged.length === (session.memorySnapshotIds ?? []).length) {
    return session;
  }

  return {
    ...session,
    updatedAt: now,
    memorySnapshotIds: merged,
  };
}

export function addAgentPendingApproval(
  session: AgentSession,
  input: CreateAgentPendingApprovalInput,
): AgentSession {
  if (isTerminalStatus(session.status)) {
    throw new Error(`Cannot add approval request to terminal agent session: ${session.status}`);
  }

  const timestamp = input.now ?? Date.now();
  const pendingApproval: AgentPendingApproval = {
    id: input.id,
    capability: input.capability,
    toolName: input.toolName,
    toolLabel: input.toolLabel,
    toolDescription: input.toolDescription,
    toolArgsSummary: input.toolArgsSummary,
    toolResultSummary: input.toolResultSummary,
    argumentsPreview: input.argumentsPreview,
    request: input.request,
    decision: input.decision,
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
    approvalNote: input.approvalNote,
  };

  const pendingApprovals = [
    ...session.pendingApprovals.filter((approval) => approval.id !== input.id),
    pendingApproval,
  ];
  const approvalRequestIds = session.approvalRequestIds.includes(input.id)
    ? session.approvalRequestIds
    : [...session.approvalRequestIds, input.id];

  return {
    ...session,
    status: 'waiting_approval',
    updatedAt: timestamp,
    approvalRequestIds,
    pendingApprovals,
  };
}

export function resolveAgentPendingApproval(
  session: AgentSession,
  input: ResolveAgentPendingApprovalInput,
): AgentSession {
  const timestamp = input.now ?? Date.now();
  const pendingApprovals = session.pendingApprovals.map((approval) => {
    if (approval.id !== input.id) {
      return approval;
    }

    return {
      ...approval,
      status: input.status,
      updatedAt: timestamp,
      approvalNote: input.approvalNote ?? approval.approvalNote,
      resultPreview: input.resultPreview ?? approval.resultPreview,
      error: input.error ?? approval.error,
    };
  });

  const hasPendingApproval = pendingApprovals.some((approval) => approval.status === 'pending');
  const approvalRequestIds = session.approvalRequestIds.filter((id) => id !== input.id);

  return {
    ...session,
    status: hasPendingApproval ? 'waiting_approval' : session.status === 'waiting_approval' ? 'running' : session.status,
    updatedAt: timestamp,
    approvalRequestIds,
    pendingApprovals,
  };
}

export function resumeAgentSession(
  session: AgentSession,
  options: { now?: number; resolvedApprovalIds?: string[] } = {},
): AgentSession {
  if (session.status !== 'waiting_approval') {
    return session;
  }

  const resolved = new Set(options.resolvedApprovalIds ?? session.approvalRequestIds);
  const remainingApprovals = session.approvalRequestIds.filter((id) => !resolved.has(id));
  const pendingApprovals = session.pendingApprovals.map((approval) =>
    resolved.has(approval.id) && approval.status === 'pending'
      ? { ...approval, status: 'approved' as const, updatedAt: options.now ?? Date.now() }
      : approval,
  );
  const hasPendingApproval = pendingApprovals.some((approval) => approval.status === 'pending');

  return {
    ...session,
    status: remainingApprovals.length > 0 || hasPendingApproval ? 'waiting_approval' : 'running',
    approvalRequestIds: remainingApprovals,
    pendingApprovals,
    updatedAt: options.now ?? Date.now(),
  };
}

export function completeAgentSession(
  session: AgentSession,
  result: string,
  now = Date.now(),
): AgentSession {
  return appendAgentTraceEvent(session, {
    kind: 'completed',
    timestamp: now,
    message: result,
  });
}

export function failAgentSession(
  session: AgentSession,
  error: string,
  now = Date.now(),
): AgentSession {
  return appendAgentTraceEvent(session, {
    kind: 'error',
    timestamp: now,
    message: error,
    error,
  });
}

export function cancelAgentSession(
  session: AgentSession,
  reason = 'Agent run cancelled.',
  now = Date.now(),
): AgentSession {
  return appendAgentTraceEvent(session, {
    kind: 'cancelled',
    timestamp: now,
    message: reason,
  });
}

function summarizeTraceEvents(events: AgentTraceEvent[]): string {
  const counts = new Map<AgentTraceEventKind, number>();
  for (const event of events) {
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, count]) => `${kind}: ${count}`)
    .join(', ');
}

function compactMetadataText(events: AgentTraceEvent[], key: string, maxLength: number): string | null {
  const parts = events
    .map((event) => event.metadata?.[key])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (parts.length === 0) {
    return null;
  }

  const joined = parts.join(' / ').replace(/\s+/g, ' ').trim();
  return joined.length > maxLength ? `${joined.slice(0, maxLength - 1).trimEnd()}...` : joined;
}

function isCompactionAuditAnchor(event: AgentTraceEvent): boolean {
  return event.kind === 'planning' && typeof event.metadata?.planSource === 'string';
}

export function compactAgentSession(
  session: AgentSession,
  input: CompactAgentSessionInput = {},
): AgentSession {
  const maxTraceEvents = Math.max(3, input.maxTraceEvents ?? 16);
  if (session.trace.length <= maxTraceEvents) {
    return session;
  }

  const retainRecentEvents = Math.max(1, Math.min(
    input.retainRecentEvents ?? 8,
    maxTraceEvents - 2,
  ));
  const startEvent = session.trace.find((event) => event.kind === 'session_started') ?? session.trace[0];
  const recentEvents = session.trace.slice(-retainRecentEvents);
  const auditAnchorEvents = session.trace.filter((event) =>
    event.id !== startEvent.id &&
    !recentEvents.some((recentEvent) => recentEvent.id === event.id) &&
    isCompactionAuditAnchor(event),
  );
  const retainedIds = new Set([
    startEvent.id,
    ...auditAnchorEvents.map((event) => event.id),
    ...recentEvents.map((event) => event.id),
  ]);
  const compactedEvents = session.trace.filter((event) => !retainedIds.has(event.id));

  if (compactedEvents.length === 0) {
    return session;
  }

  const now = input.now ?? Date.now();
  const compaction: AgentSessionCompaction = {
    id: input.id ?? `agent-compaction-${now}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    summary: input.summary ?? summarizeTraceEvents(compactedEvents),
    compactedEventCount: compactedEvents.length,
    retainedEventIds: [...retainedIds],
    sourceEventKinds: [...new Set(compactedEvents.map((event) => event.kind))],
    evidenceRefs: mergeEvidenceRefs(
      [],
      compactedEvents.flatMap((event) => event.evidenceRefs ?? []),
    ),
  };

  const compactionEvent: AgentTraceEvent = {
    id: `${compaction.id}:event`,
    kind: 'context_resolved',
    timestamp: now,
    message: `Session compacted: ${compaction.summary}`,
    evidenceRefs: compaction.evidenceRefs,
    metadata: {
      compactionId: compaction.id,
      compactedEventCount: compaction.compactedEventCount,
      retainedAuditAnchorCount: auditAnchorEvents.length,
      retainedEventCount: retainedIds.size,
      sourceEventKinds: compaction.sourceEventKinds.join(','),
      retainedEventIdsPreview: [...retainedIds].slice(0, 12).join(','),
      omittedContextAutoSummary: compactMetadataText(compactedEvents, 'omittedContextAutoSummary', 900),
      omittedContextModelSummary: compactMetadataText(compactedEvents, 'omittedContextModelSummary', 900),
      omittedContextRecoveryHints: compactMetadataText(compactedEvents, 'omittedContextRecoveryHints', 900),
      omittedContextRecoveryPriority: compactMetadataText(compactedEvents, 'omittedContextRecoveryPriority', 900),
      omittedContextRecoveryPlan: compactMetadataText(compactedEvents, 'omittedContextRecoveryPlan', 1100),
      omittedContextSemanticPreview: compactMetadataText(compactedEvents, 'omittedContextSemanticPreview', 900),
    },
  };

  return {
    ...session,
    updatedAt: now,
    trace: [startEvent, ...auditAnchorEvents, compactionEvent, ...recentEvents],
    evidenceRefs: mergeEvidenceRefs(session.evidenceRefs, compaction.evidenceRefs),
    compactions: [...(session.compactions ?? []), compaction],
  };
}

function mergeEvidenceRefs(left: EvidenceRef[], right: EvidenceRef[]): EvidenceRef[] {
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
