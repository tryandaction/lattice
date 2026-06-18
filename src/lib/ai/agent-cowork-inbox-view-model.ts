import type { AgentSession, AgentSessionStatus } from './agent-session';

export type AgentCoworkInboxItemKind =
  | 'needs_approval'
  | 'blocked'
  | 'running'
  | 'handoff'
  | 'completed';

export interface AgentCoworkInboxItem {
  id: string;
  kind: AgentCoworkInboxItemKind;
  sessionId: string;
  title: string;
  task: string;
  status: AgentSessionStatus;
  isActiveSession: boolean;
  updatedAt: number;
  pendingApprovalCount: number;
  evidenceCount: number;
  traceCount: number;
  summary: string;
  detail: string | null;
}

export type AgentCoworkInboxWorkspaceRiskLevel = 'clean' | 'dirty' | 'conflict';

export interface AgentCoworkInboxWorkspaceSnapshot {
  openTabCount?: number;
  dirtyTabCount?: number;
  dirtyPaths?: string[];
  activeTabName?: string | null;
  activeTabPath?: string | null;
}

export interface AgentCoworkInboxWorkspaceRisk {
  level: AgentCoworkInboxWorkspaceRiskLevel;
  openTabCount: number;
  dirtyTabCount: number;
  duplicateDirtyPathCount: number;
  duplicateDirtyPaths: string[];
  activeTabName: string | null;
  activeTabPath: string | null;
  summary: string;
  detail: string | null;
}

export interface AgentCoworkInboxViewModel {
  activeSessionId: string | null;
  totalSessionCount: number;
  pendingApprovalCount: number;
  blockedCount: number;
  runningCount: number;
  handoffCount: number;
  summary: string;
  nextAction: 'none' | 'review_approvals' | 'inspect_blocked' | 'watch_running' | 'review_handoff';
  workspaceRisk: AgentCoworkInboxWorkspaceRisk;
  items: AgentCoworkInboxItem[];
}

const KIND_PRIORITY: Record<AgentCoworkInboxItemKind, number> = {
  needs_approval: 0,
  blocked: 1,
  running: 2,
  handoff: 3,
  completed: 4,
};

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trimEnd()}...` : normalized;
}

function pendingApprovalCount(session: AgentSession): number {
  return (session.pendingApprovals ?? []).filter((approval) => approval.status === 'pending').length;
}

function latestHandoffEvent(session: AgentSession): string | null {
  const event = [...(session.trace ?? [])].reverse().find((traceEvent) =>
    traceEvent.kind === 'proposal_created' ||
    traceEvent.kind === 'draft_created' ||
    traceEvent.kind === 'completed' ||
    traceEvent.kind === 'writeback_applied'
  );
  return event ? truncate(event.message, 160) : null;
}

function itemKind(session: AgentSession, approvals: number): AgentCoworkInboxItemKind {
  if (approvals > 0 || session.status === 'waiting_approval') {
    return 'needs_approval';
  }
  if (session.status === 'failed') {
    return 'blocked';
  }
  if (session.status === 'queued' || session.status === 'running') {
    return 'running';
  }
  if (session.status === 'completed') {
    return latestHandoffEvent(session) ? 'handoff' : 'completed';
  }
  return 'completed';
}

function itemSummary(session: AgentSession, kind: AgentCoworkInboxItemKind, approvals: number): string {
  switch (kind) {
    case 'needs_approval':
      return approvals > 0
        ? `${approvals} approval${approvals === 1 ? '' : 's'} waiting`
        : 'Waiting for approval';
    case 'blocked':
      return session.error ? `Blocked: ${truncate(session.error, 96)}` : 'Blocked by failed run';
    case 'running':
      return session.status === 'queued' ? 'Queued for agent work' : 'Agent run in progress';
    case 'handoff':
      return 'Ready for handoff review';
    case 'completed':
      return 'Completed';
  }
}

function itemDetail(session: AgentSession, kind: AgentCoworkInboxItemKind): string | null {
  if (kind === 'blocked') {
    return session.error ? truncate(session.error, 180) : null;
  }
  if (kind === 'handoff') {
    return latestHandoffEvent(session);
  }
  const latest = session.trace.at(-1);
  return latest ? truncate(latest.message, 180) : null;
}

function buildItem(session: AgentSession, activeSessionId: string | null): AgentCoworkInboxItem {
  const approvals = pendingApprovalCount(session);
  const kind = itemKind(session, approvals);
  return {
    id: session.id,
    kind,
    sessionId: session.id,
    title: session.title,
    task: truncate(session.task, 160),
    status: session.status,
    isActiveSession: Boolean(activeSessionId && session.id === activeSessionId),
    updatedAt: session.updatedAt,
    pendingApprovalCount: approvals,
    evidenceCount: session.evidenceRefs?.length ?? 0,
    traceCount: session.trace?.length ?? 0,
    summary: itemSummary(session, kind, approvals),
    detail: itemDetail(session, kind),
  };
}

function nextActionFor(items: AgentCoworkInboxItem[]): AgentCoworkInboxViewModel['nextAction'] {
  if (items.some((item) => item.kind === 'needs_approval')) {
    return 'review_approvals';
  }
  if (items.some((item) => item.kind === 'blocked')) {
    return 'inspect_blocked';
  }
  if (items.some((item) => item.kind === 'running')) {
    return 'watch_running';
  }
  if (items.some((item) => item.kind === 'handoff')) {
    return 'review_handoff';
  }
  return 'none';
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').toLowerCase();
}

function buildWorkspaceRisk(snapshot: AgentCoworkInboxWorkspaceSnapshot = {}): AgentCoworkInboxWorkspaceRisk {
  const openTabCount = Math.max(0, Math.trunc(snapshot.openTabCount ?? 0));
  const dirtyTabCount = Math.max(0, Math.trunc(snapshot.dirtyTabCount ?? 0));
  const dirtyPathCounts = new Map<string, { path: string; count: number }>();

  (snapshot.dirtyPaths ?? []).forEach((path) => {
    const normalized = normalizePath(path);
    if (!normalized) {
      return;
    }
    const current = dirtyPathCounts.get(normalized);
    dirtyPathCounts.set(normalized, {
      path: current?.path ?? path,
      count: (current?.count ?? 0) + 1,
    });
  });

  const duplicateDirtyPaths = [...dirtyPathCounts.values()]
    .filter((entry) => entry.count > 1)
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right));
  const level: AgentCoworkInboxWorkspaceRiskLevel = duplicateDirtyPaths.length > 0
    ? 'conflict'
    : dirtyTabCount > 0
      ? 'dirty'
      : 'clean';
  const activeTabName = snapshot.activeTabName?.trim() || null;
  const activeTabPath = snapshot.activeTabPath?.trim() || null;

  if (level === 'conflict') {
    return {
      level,
      openTabCount,
      dirtyTabCount,
      duplicateDirtyPathCount: duplicateDirtyPaths.length,
      duplicateDirtyPaths,
      activeTabName,
      activeTabPath,
      summary: `${dirtyTabCount} unsaved tabs / ${duplicateDirtyPaths.length} duplicate dirty paths`,
      detail: `Resolve duplicate dirty tabs before approving agent work: ${duplicateDirtyPaths.slice(0, 3).join(', ')}`,
    };
  }

  if (level === 'dirty') {
    return {
      level,
      openTabCount,
      dirtyTabCount,
      duplicateDirtyPathCount: 0,
      duplicateDirtyPaths,
      activeTabName,
      activeTabPath,
      summary: `${dirtyTabCount} unsaved tabs / ${openTabCount} open tabs`,
      detail: 'Review or save unsaved tabs before approving write proposals.',
    };
  }

  return {
    level,
    openTabCount,
    dirtyTabCount,
    duplicateDirtyPathCount: 0,
    duplicateDirtyPaths,
    activeTabName,
    activeTabPath,
    summary: openTabCount > 0 ? `Workspace clean / ${openTabCount} open tabs` : 'Workspace clean',
    detail: null,
  };
}

export function buildAgentCoworkInboxViewModel(
  sessions: AgentSession[],
  activeSessionId: string | null | undefined,
  options: { limit?: number; workspace?: AgentCoworkInboxWorkspaceSnapshot } = {},
): AgentCoworkInboxViewModel {
  const normalizedActiveSessionId = activeSessionId ?? null;
  const limit = Math.max(1, options.limit ?? 6);
  const allItems = sessions
    .map((session) => buildItem(session, normalizedActiveSessionId))
    .sort((left, right) => {
      if (left.isActiveSession !== right.isActiveSession) {
        return left.isActiveSession ? -1 : 1;
      }
      const priorityDelta = KIND_PRIORITY[left.kind] - KIND_PRIORITY[right.kind];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return right.updatedAt - left.updatedAt;
    });

  const pendingApprovalTotal = allItems.reduce((sum, item) => sum + item.pendingApprovalCount, 0);
  const blockedCount = allItems.filter((item) => item.kind === 'blocked').length;
  const runningCount = allItems.filter((item) => item.kind === 'running').length;
  const handoffCount = allItems.filter((item) => item.kind === 'handoff').length;

  return {
    activeSessionId: normalizedActiveSessionId,
    totalSessionCount: sessions.length,
    pendingApprovalCount: pendingApprovalTotal,
    blockedCount,
    runningCount,
    handoffCount,
    summary: [
      `${sessions.length} sessions`,
      pendingApprovalTotal > 0 ? `${pendingApprovalTotal} approvals` : null,
      blockedCount > 0 ? `${blockedCount} blocked` : null,
      runningCount > 0 ? `${runningCount} running` : null,
      handoffCount > 0 ? `${handoffCount} handoffs` : null,
    ].filter((part): part is string => Boolean(part)).join(' / '),
    nextAction: nextActionFor(allItems),
    workspaceRisk: buildWorkspaceRisk(options.workspace),
    items: allItems.slice(0, limit),
  };
}

export function formatAgentCoworkInboxMarkdown(view: AgentCoworkInboxViewModel): string {
  const lines = [
    `Summary: ${view.summary || '0 sessions'}`,
    `Next action: ${view.nextAction}`,
    `Totals: approvals=${view.pendingApprovalCount}, blocked=${view.blockedCount}, running=${view.runningCount}, handoffs=${view.handoffCount}`,
    `Workspace risk: ${view.workspaceRisk.level}`,
    `Workspace: ${view.workspaceRisk.summary}`,
  ];
  if (view.workspaceRisk.detail) {
    lines.push(`Workspace detail: ${view.workspaceRisk.detail}`);
  }

  if (view.items.length === 0) {
    lines.push('- No agent sessions recorded.');
    return lines.join('\n');
  }

  view.items.forEach((item, index) => {
    lines.push(
      `${index + 1}. [${item.kind}] ${item.title}${item.isActiveSession ? ' (active)' : ''}`,
      `   - session: ${item.sessionId}`,
      `   - status: ${item.status}`,
      `   - task: ${item.task || 'n/a'}`,
      `   - summary: ${item.summary}`,
      `   - counts: approvals=${item.pendingApprovalCount}, evidence=${item.evidenceCount}, trace=${item.traceCount}`,
    );
    if (item.detail) {
      lines.push(`   - detail: ${item.detail}`);
    }
  });

  return lines.join('\n');
}
