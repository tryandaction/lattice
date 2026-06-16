import type { AgentPendingApproval, AgentSession } from './agent-session';

export type AgentReviewQueueItemKind = 'tool_approval' | 'memory_approval';
export type AgentReviewQueueNextAction = 'none' | 'review_approvals' | 'review_memory';

export interface AgentReviewQueueItem {
  id: string;
  kind: AgentReviewQueueItemKind;
  sessionId: string;
  sessionTitle: string;
  isActiveSession: boolean;
  title: string;
  detail: string | null;
  toolName: string;
  capability: string;
  updatedAt: number;
}

export interface AgentReviewQueueViewModel {
  activeSessionId: string | null;
  pendingApprovalCount: number;
  pendingMemoryApprovalCount: number;
  activeSessionPendingApprovalCount: number;
  activeSessionPendingMemoryApprovalCount: number;
  otherSessionPendingApprovalCount: number;
  otherSessionPendingMemoryApprovalCount: number;
  nextAction: AgentReviewQueueNextAction;
  summary: string;
  items: AgentReviewQueueItem[];
}

function memoryTitle(approval: AgentPendingApproval): string | null {
  const args = approval.request.args;
  if (!args || typeof args !== 'object') {
    return null;
  }
  const memory = (args as { memory?: unknown }).memory;
  if (!memory || typeof memory !== 'object') {
    return null;
  }
  const title = (memory as { title?: unknown }).title;
  return typeof title === 'string' && title.trim() ? title.trim() : null;
}

function isMemoryApproval(approval: AgentPendingApproval): boolean {
  return approval.toolName === 'memory.write';
}

function buildItem(session: AgentSession, approval: AgentPendingApproval, activeSessionId: string | null): AgentReviewQueueItem {
  const memory = isMemoryApproval(approval);
  const title = memory
    ? memoryTitle(approval) ?? approval.toolLabel ?? approval.toolName
    : approval.toolLabel ?? approval.toolName;

  return {
    id: approval.id,
    kind: memory ? 'memory_approval' : 'tool_approval',
    sessionId: session.id,
    sessionTitle: session.title,
    isActiveSession: Boolean(activeSessionId && session.id === activeSessionId),
    title,
    detail: approval.toolDescription ?? approval.argumentsPreview ?? null,
    toolName: approval.toolName,
    capability: approval.capability,
    updatedAt: approval.updatedAt || approval.createdAt,
  };
}

export function buildAgentReviewQueueViewModel(
  sessions: AgentSession[],
  activeSessionId: string | null | undefined,
): AgentReviewQueueViewModel {
  const normalizedActiveSessionId = activeSessionId ?? null;
  const items = sessions
    .flatMap((session) => (session.pendingApprovals ?? [])
      .filter((approval) => approval.status === 'pending')
      .map((approval) => buildItem(session, approval, normalizedActiveSessionId)))
    .sort((left, right) => {
      if (left.isActiveSession !== right.isActiveSession) {
        return left.isActiveSession ? -1 : 1;
      }
      if (left.kind !== right.kind) {
        return left.kind === 'memory_approval' ? -1 : 1;
      }
      return right.updatedAt - left.updatedAt;
    });

  const pendingApprovalCount = items.length;
  const pendingMemoryApprovalCount = items.filter((item) => item.kind === 'memory_approval').length;
  const activeSessionPendingApprovalCount = items.filter((item) => item.isActiveSession).length;
  const activeSessionPendingMemoryApprovalCount = items.filter((item) =>
    item.isActiveSession && item.kind === 'memory_approval',
  ).length;
  const otherSessionPendingApprovalCount = pendingApprovalCount - activeSessionPendingApprovalCount;
  const otherSessionPendingMemoryApprovalCount = pendingMemoryApprovalCount - activeSessionPendingMemoryApprovalCount;
  const nextAction = activeSessionPendingApprovalCount > 0
    ? 'review_approvals'
    : pendingMemoryApprovalCount > 0
      ? 'review_memory'
      : pendingApprovalCount > 0
        ? 'review_approvals'
        : 'none';

  return {
    activeSessionId: normalizedActiveSessionId,
    pendingApprovalCount,
    pendingMemoryApprovalCount,
    activeSessionPendingApprovalCount,
    activeSessionPendingMemoryApprovalCount,
    otherSessionPendingApprovalCount,
    otherSessionPendingMemoryApprovalCount,
    nextAction,
    summary: [
      `${pendingApprovalCount} pending`,
      pendingMemoryApprovalCount > 0 ? `${pendingMemoryApprovalCount} memory` : null,
      activeSessionPendingApprovalCount > 0 ? `${activeSessionPendingApprovalCount} current run` : null,
    ].filter((part): part is string => Boolean(part)).join(' / '),
    items,
  };
}
