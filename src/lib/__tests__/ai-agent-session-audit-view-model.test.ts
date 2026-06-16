import { describe, expect, it } from 'vitest';
import {
  auditMetadataNumber,
  auditMetadataString,
  buildAgentSessionAuditViewModel,
} from '@/lib/ai/agent-session-audit-view-model';
import {
  addAgentPendingApproval,
  appendAgentTraceEvent,
  createAgentSession,
} from '@/lib/ai/agent-session';

describe('agent session audit view model', () => {
  it('derives one shared run summary for trace and memory surfaces', () => {
    let session = createAgentSession({
      id: 'audit-session',
      profile: 'research',
      task: 'Audit Alpha',
      title: 'Audit Alpha',
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
        planStepId: 'resolve-evidence',
        planStepStatus: 'completed',
        toolName: 'evidence.resolve',
      },
    });
    session = appendAgentTraceEvent(session, {
      kind: 'tool_requested',
      message: 'Read indexed context.',
      timestamp: 130,
      tool: {
        capability: 'read_workspace',
        toolName: 'workspace.readIndexedContext',
      },
    });
    session = appendAgentTraceEvent(session, {
      kind: 'context-pack',
      message: 'Context pack omitted content.',
      timestamp: 140,
      metadata: {
        omittedContextCount: 3,
        omittedContextTokens: 1800,
      },
    });
    session = appendAgentTraceEvent(session, {
      kind: 'memory_updated',
      message: 'Memory candidate generated.',
      timestamp: 150,
      metadata: {
        toolName: 'memory.write',
      },
    });
    session = addAgentPendingApproval(session, {
      id: 'approval-memory',
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
      now: 160,
    });

    const audit = buildAgentSessionAuditViewModel(session);

    expect(audit).toMatchObject({
      sessionId: 'audit-session',
      title: 'Audit Alpha',
      workflowLabel: 'Markdown Research',
      toolCallCount: 1,
      uniqueToolCount: 1,
      evidenceCount: 1,
      approvalCount: 1,
      pendingApprovalCount: 1,
      pendingMemoryApprovalCount: 1,
      memorySuggestionCount: 1,
      omittedContextCount: 3,
      omittedContextTokens: 1800,
    });
    expect(audit.plan).toMatchObject({
      source: 'custom',
      stepCount: 1,
      completedStepCount: 1,
    });
    expect(audit.plan.steps[0]).toMatchObject({
      id: 'resolve-evidence',
      status: 'completed',
      toolName: 'evidence.resolve',
    });
  });

  it('normalizes primitive metadata fields safely', () => {
    const event = {
      id: 'event',
      kind: 'planning' as const,
      timestamp: 1,
      message: 'event',
      metadata: {
        text: ' Alpha ',
        blank: '   ',
        count: 3,
        bad: Number.NaN,
      },
    };

    expect(auditMetadataString(event, 'text')).toBe(' Alpha ');
    expect(auditMetadataString(event, 'blank')).toBeNull();
    expect(auditMetadataNumber(event, 'count')).toBe(3);
    expect(auditMetadataNumber(event, 'bad')).toBeNull();
  });
});
