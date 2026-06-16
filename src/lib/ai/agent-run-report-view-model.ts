import type { AgentSession } from './agent-session';
import type { AgentSessionAuditViewModel } from './agent-session-audit-view-model';
import type { AgentReviewQueueViewModel } from './agent-review-queue-view-model';

export type AgentRunReportSectionKind = 'answer' | 'run' | 'plan' | 'observations' | 'approvals' | 'memory' | 'context';

export interface AgentRunReportSection {
  kind: AgentRunReportSectionKind;
  title: string;
  content: string;
}

export type AgentRunReportActionKind = 'inspect_trace' | 'review_approvals' | 'review_memory';

export interface AgentRunReportAction {
  id: string;
  kind: AgentRunReportActionKind;
  label: string;
  targetSectionKind?: AgentRunReportSectionKind;
}

export interface AgentRunReportViewModel {
  sessionId: string;
  title: string;
  task: string;
  status: AgentSession['status'];
  summary: string;
  sections: AgentRunReportSection[];
  actions: AgentRunReportAction[];
}

function compactLine(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(' / ');
}

function latestAnswerPreview(session: AgentSession): string | null {
  if (session.result?.trim()) {
    return session.result.trim();
  }
  const synthesis = [...session.trace].reverse().find((event) =>
    typeof event.metadata?.answerPreview === 'string' ||
    typeof event.metadata?.restoredSynthesisPreview === 'string',
  );
  const value = synthesis?.metadata?.answerPreview ?? synthesis?.metadata?.restoredSynthesisPreview;
  return typeof value === 'string' && value.trim() ? value : null;
}

function buildPlanContent(audit: AgentSessionAuditViewModel): string {
  if (audit.plan.steps.length === 0) {
    return compactLine([
      `Plan source: ${audit.plan.source ?? 'unknown'}`,
      `Steps: ${audit.plan.completedStepCount}/${audit.plan.stepCount}`,
      audit.plan.warningCount > 0 ? `Warnings: ${audit.plan.warningCount}` : null,
    ]);
  }

  return [
    compactLine([
      `Plan source: ${audit.plan.source ?? 'unknown'}`,
      `Steps: ${audit.plan.completedStepCount}/${audit.plan.stepCount}`,
      audit.plan.warningCount > 0 ? `Warnings: ${audit.plan.warningCount}` : null,
    ]),
    ...audit.plan.steps.slice(0, 8).map((step) =>
      `- ${step.status}: ${step.title}${step.toolName ? ` (${step.toolName})` : ''}`
    ),
  ].join('\n');
}

export function buildAgentRunReportViewModel(
  session: AgentSession,
  audit: AgentSessionAuditViewModel,
  reviewQueue?: AgentReviewQueueViewModel | null,
): AgentRunReportViewModel {
  const sections: AgentRunReportSection[] = [];
  const actions: AgentRunReportAction[] = [
    {
      id: 'inspect-trace',
      kind: 'inspect_trace',
      label: 'Inspect trace',
    },
  ];
  const answer = latestAnswerPreview(session);
  const queueAppliesToSession = reviewQueue?.activeSessionId === session.id;
  const pendingApprovalCount = queueAppliesToSession
    ? reviewQueue.activeSessionPendingApprovalCount
    : audit.pendingApprovalCount;
  const pendingMemoryApprovalCount = queueAppliesToSession
    ? reviewQueue.activeSessionPendingMemoryApprovalCount
    : audit.pendingMemoryApprovalCount;
  const queueSummary = queueAppliesToSession && reviewQueue.summary ? reviewQueue.summary : null;

  if (answer) {
    sections.push({
      kind: 'answer',
      title: 'Answer',
      content: answer,
    });
  }

  sections.push({
    kind: 'run',
    title: 'Run',
    content: compactLine([
      `Status: ${audit.status}`,
      audit.workflowLabel ? `Workflow: ${audit.workflowLabel}` : null,
      `Evidence: ${audit.evidenceCount}`,
      `Tools: ${audit.toolCallCount}/${audit.uniqueToolCount}`,
    ]),
  });

  sections.push({
    kind: 'plan',
    title: 'Plan',
    content: buildPlanContent(audit),
  });

  if (audit.approvalCount > 0) {
    sections.push({
      kind: 'approvals',
      title: 'Approvals',
      content: compactLine([
        `Completed: ${audit.completedApprovalCount}/${audit.approvalCount}`,
        pendingApprovalCount > 0 ? `Pending: ${pendingApprovalCount}` : null,
        queueSummary ? `Queue: ${queueSummary}` : null,
      ]),
    });
    if (pendingApprovalCount > 0) {
      actions.push({
        id: 'review-approvals',
        kind: 'review_approvals',
        label: 'Review approvals',
        targetSectionKind: 'approvals',
      });
    }
  }

  if (audit.memorySuggestionCount > 0 || audit.pendingMemoryApprovalCount > 0) {
    sections.push({
      kind: 'memory',
      title: 'Memory',
      content: compactLine([
        `Suggestions: ${audit.memorySuggestionCount}`,
        pendingMemoryApprovalCount > 0 ? `Pending approval: ${pendingMemoryApprovalCount}` : null,
      ]),
    });
    if (pendingMemoryApprovalCount > 0) {
      actions.push({
        id: 'review-memory',
        kind: 'review_memory',
        label: 'Review memory',
        targetSectionKind: 'memory',
      });
    }
  }

  if (audit.omittedContextCount > 0) {
    sections.push({
      kind: 'context',
      title: 'Context',
      content: `Omitted: ${audit.omittedContextCount} items / ${audit.omittedContextTokens} tokens`,
    });
  }

  return {
    sessionId: session.id,
    title: session.title,
    task: session.task,
    status: session.status,
    summary: compactLine([
      audit.workflowLabel ?? session.profile,
      `${audit.plan.completedStepCount}/${audit.plan.stepCount} plan`,
      `${audit.toolCallCount} tools`,
      `${audit.evidenceCount} evidence`,
      pendingApprovalCount > 0 ? `${pendingApprovalCount} pending` : null,
      queueAppliesToSession && reviewQueue.nextAction !== 'none' ? `next: ${reviewQueue.nextAction}` : null,
    ]),
    sections,
    actions,
  };
}
