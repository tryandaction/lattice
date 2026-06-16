import { describe, expect, it } from 'vitest';
import {
  addAgentPendingApproval,
  appendAgentTraceEvent,
  completeAgentSession,
  createAgentSession,
} from '@/lib/ai/agent-session';
import { buildAgentSessionAuditViewModel } from '@/lib/ai/agent-session-audit-view-model';
import { buildAgentRunReportViewModel } from '@/lib/ai/agent-run-report-view-model';
import { buildAgentReviewQueueViewModel } from '@/lib/ai/agent-review-queue-view-model';

describe('agent run report view model', () => {
  it('builds a compact run report from session audit data', () => {
    let session = createAgentSession({
      id: 'run-report-session',
      profile: 'research',
      title: 'Run report session',
      task: 'Explain Alpha',
      evidenceRefs: [
        { kind: 'file', label: 'alpha.md', locator: 'notes/alpha.md' },
      ],
      now: 100,
    });
    session = appendAgentTraceEvent(session, {
      kind: 'planning',
      message: 'Research Agent plan created.',
      timestamp: 110,
      metadata: {
        planSource: 'custom',
        planStepCount: 2,
        workflowTitle: 'Markdown Research',
      },
    });
    session = appendAgentTraceEvent(session, {
      kind: 'planning',
      message: 'Completed plan step: Resolve evidence.',
      timestamp: 120,
      metadata: {
        planStepId: 'resolve',
        planStepStatus: 'completed',
        toolName: 'evidence.resolve',
      },
    });
    session = appendAgentTraceEvent(session, {
      kind: 'context-pack',
      message: 'Context omitted.',
      timestamp: 130,
      metadata: {
        omittedContextCount: 2,
        omittedContextTokens: 900,
      },
    });
    session = addAgentPendingApproval(session, {
      id: 'memory-approval',
      capability: 'memory_write',
      toolName: 'memory.write',
      request: {
        name: 'memory.write',
        args: {},
      },
      decision: {
        capability: 'memory_write',
        permission: 'ask',
        requiresApproval: true,
        allowed: true,
      },
      now: 140,
    });
    session = completeAgentSession(session, 'Alpha answer summary.');

    const report = buildAgentRunReportViewModel(session, buildAgentSessionAuditViewModel(session));

    expect(report).toMatchObject({
      sessionId: 'run-report-session',
      title: 'Run report session',
      task: 'Explain Alpha',
      status: 'completed',
    });
    expect(report.summary).toContain('Markdown Research');
    expect(report.actions.map((action) => action.id)).toEqual([
      'inspect-trace',
      'review-approvals',
      'review-memory',
    ]);
    expect(report.sections.map((section) => section.title)).toEqual([
      'Answer',
      'Run',
      'Plan',
      'Approvals',
      'Memory',
      'Context',
    ]);
    expect(report.sections.find((section) => section.title === 'Answer')?.content).toBe('Alpha answer summary.');
    expect(report.sections.find((section) => section.title === 'Run')?.content).toContain('Workflow: Markdown Research');
    expect(report.sections.find((section) => section.title === 'Plan')?.content).toContain('- completed: Resolve evidence (evidence.resolve)');
    expect(report.sections.find((section) => section.title === 'Approvals')?.content).toContain('Pending: 1');
    expect(report.sections.find((section) => section.title === 'Memory')?.content).toContain('Pending approval: 1');
    expect(report.sections.find((section) => section.title === 'Context')?.content).toContain('2 items / 900 tokens');
  });

  it('uses review queue context for pending summary and next actions', () => {
    let session = createAgentSession({
      id: 'queue-report-session',
      profile: 'research',
      title: 'Queue report session',
      task: 'Review queued work',
      now: 100,
    });
    session = addAgentPendingApproval(session, {
      id: 'tool-approval',
      capability: 'run_code',
      toolName: 'runner.runCode',
      toolLabel: 'Run code',
      request: {
        name: 'runner.runCode',
        args: { language: 'javascript', code: '2 + 2' },
      },
      decision: {
        capability: 'run_code',
        permission: 'ask',
        requiresApproval: true,
        allowed: true,
      },
      now: 120,
    });
    session = addAgentPendingApproval(session, {
      id: 'memory-approval',
      capability: 'memory_write',
      toolName: 'memory.write',
      request: {
        name: 'memory.write',
        args: {
          memory: {
            title: 'Queue memory',
            content: 'Remember queued work.',
          },
        },
      },
      decision: {
        capability: 'memory_write',
        permission: 'ask',
        requiresApproval: true,
        allowed: true,
      },
      now: 130,
    });
    const audit = buildAgentSessionAuditViewModel(session);
    const reviewQueue = buildAgentReviewQueueViewModel([session], session.id);

    const report = buildAgentRunReportViewModel(session, audit, reviewQueue);

    expect(report.summary).toContain('2 pending');
    expect(report.summary).toContain('next: review_approvals');
    expect(report.actions.map((action) => action.id)).toEqual([
      'inspect-trace',
      'review-approvals',
      'review-memory',
    ]);
    expect(report.sections.find((section) => section.title === 'Approvals')?.content).toContain(
      'Queue: 2 pending / 1 memory / 2 current run',
    );
    expect(report.sections.find((section) => section.title === 'Memory')?.content).toContain('Pending approval: 1');
  });
});
