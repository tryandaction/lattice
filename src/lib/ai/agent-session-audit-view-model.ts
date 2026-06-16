import type { AgentPendingApproval, AgentSession, AgentTraceEvent } from './agent-session';

export interface AgentSessionPlanAuditStep {
  id: string;
  title: string;
  status: string;
  toolName: string | null;
  timestamp: number;
}

export interface AgentSessionPlanAudit {
  source: string | null;
  warningCount: number;
  stepCount: number;
  completedStepCount: number;
  steps: AgentSessionPlanAuditStep[];
}

export interface AgentSessionAuditViewModel {
  sessionId: string;
  title: string;
  status: AgentSession['status'];
  workflowLabel: string | null;
  plan: AgentSessionPlanAudit;
  toolCallCount: number;
  uniqueToolCount: number;
  evidenceCount: number;
  approvalCount: number;
  pendingApprovalCount: number;
  completedApprovalCount: number;
  memorySuggestionCount: number;
  pendingMemoryApprovalCount: number;
  omittedContextCount: number;
  omittedContextTokens: number;
}

export function auditMetadataString(event: AgentTraceEvent | null | undefined, key: string): string | null {
  const value = event?.metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function auditMetadataNumber(event: AgentTraceEvent | null | undefined, key: string): number | null {
  const value = event?.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isTerminalApproval(approval: AgentPendingApproval): boolean {
  return approval.status === 'completed' || approval.status === 'failed' || approval.status === 'rejected';
}

function derivePlanAudit(session: AgentSession): AgentSessionPlanAudit {
  const stepsById = new Map<string, AgentSessionPlanAuditStep>();
  const planCreated = session.trace.find((event) =>
    event.kind === 'planning' &&
    (
      typeof event.metadata?.planSource === 'string' ||
      typeof event.metadata?.planStepCount === 'number'
    ),
  );
  const warningEvent = session.trace.find((event) =>
    event.kind === 'planning' &&
    typeof event.metadata?.planWarningCount === 'number' &&
    auditMetadataNumber(event, 'planWarningCount')! > 0,
  );

  for (const event of session.trace) {
    const stepId = auditMetadataString(event, 'planStepId');
    const status = auditMetadataString(event, 'planStepStatus');
    if (!stepId || !status) {
      continue;
    }

    const existing = stepsById.get(stepId);
    const title = event.message
      .replace(/^Completed plan step:\s*/i, '')
      .replace(/^Running plan step:\s*/i, '')
      .replace(/^Failed plan step:\s*/i, '')
      .replace(/^Plan step blocked on approval:\s*/i, '')
      .replace(/^Plan step \w+:\s*/i, '')
      .replace(/\.$/, '')
      .trim() || stepId;

    stepsById.set(stepId, {
      id: stepId,
      title: existing?.title && existing.title !== stepId ? existing.title : title,
      status,
      toolName: auditMetadataString(event, 'toolName'),
      timestamp: event.timestamp,
    });
  }

  const steps = [...stepsById.values()].sort((left, right) => left.timestamp - right.timestamp);
  return {
    source: auditMetadataString(planCreated, 'planSource'),
    warningCount: auditMetadataNumber(warningEvent ?? planCreated, 'planWarningCount') ?? 0,
    stepCount: steps.length || (auditMetadataNumber(planCreated, 'planStepCount') ?? 0),
    completedStepCount: steps.filter((step) => step.status === 'completed').length,
    steps,
  };
}

export function buildAgentSessionAuditViewModel(session: AgentSession): AgentSessionAuditViewModel {
  const planCreated = session.trace.find((event) =>
    event.kind === 'planning' &&
    (
      typeof event.metadata?.workflowTitle === 'string' ||
      typeof event.metadata?.workflowId === 'string' ||
      typeof event.metadata?.planStepCount === 'number'
    ),
  );
  const plan = derivePlanAudit(session);
  const toolNames = new Set<string>();
  let toolCallCount = 0;
  let omittedContextCount = 0;
  let omittedContextTokens = 0;
  let memorySuggestionCount = 0;

  for (const event of session.trace) {
    const toolName = event.tool?.toolName ?? auditMetadataString(event, 'toolName');
    if (event.kind === 'tool_requested' || event.kind === 'tool_result' || event.tool) {
      if (toolName) {
        toolNames.add(toolName);
      }
    }
    if (event.kind === 'tool_requested' || (event.tool && event.kind !== 'approval_required')) {
      toolCallCount += 1;
    }
    omittedContextCount += auditMetadataNumber(event, 'omittedContextCount') ?? 0;
    omittedContextTokens += auditMetadataNumber(event, 'omittedContextTokens') ?? 0;
    if (event.kind === 'memory_updated' || auditMetadataString(event, 'toolName') === 'memory.write') {
      memorySuggestionCount += 1;
    }
  }

  const pendingApprovalCount = session.pendingApprovals.filter((approval) => approval.status === 'pending').length;
  const completedApprovalCount = session.pendingApprovals.filter(isTerminalApproval).length;
  const pendingMemoryApprovalCount = session.pendingApprovals.filter((approval) =>
    approval.status === 'pending' && approval.toolName === 'memory.write',
  ).length;

  return {
    sessionId: session.id,
    title: session.title,
    status: session.status,
    workflowLabel: auditMetadataString(planCreated, 'workflowTitle') ?? auditMetadataString(planCreated, 'workflowId'),
    plan,
    toolCallCount,
    uniqueToolCount: toolNames.size,
    evidenceCount: session.evidenceRefs.length,
    approvalCount: session.pendingApprovals.length,
    pendingApprovalCount,
    completedApprovalCount,
    memorySuggestionCount,
    pendingMemoryApprovalCount,
    omittedContextCount,
    omittedContextTokens,
  };
}
