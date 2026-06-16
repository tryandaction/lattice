import { describe, expect, it } from 'vitest';

import { buildAgentCapabilityPolicy, getAgentCapabilityDecision } from '../ai/agent-policy';
import {
  addAgentPendingApproval,
  appendAgentTraceEvent,
  cancelAgentSession,
  compactAgentSession,
  completeAgentSession,
  createAgentSession,
  failAgentSession,
  resolveAgentPendingApproval,
  resumeAgentSession,
} from '../ai/agent-session';

describe('agent-session', () => {
  it('creates a queued session and records a start event', () => {
    const session = createAgentSession({
      id: 'session-1',
      profile: 'research',
      task: 'Compare two papers',
      now: 100,
      evidenceRefs: [
        {
          kind: 'file',
          label: 'paper-a.md',
          locator: 'paper-a.md',
        },
      ],
    });

    expect(session.status).toBe('running');
    expect(session.title).toBe('Compare two papers');
    expect(session.createdAt).toBe(100);
    expect(session.trace).toHaveLength(1);
    expect(session.trace[0]).toMatchObject({
      id: 'session-1:start',
      kind: 'session_started',
      timestamp: 100,
    });
    expect(session.evidenceRefs).toHaveLength(1);
  });

  it('moves to waiting approval when a gated tool is requested', () => {
    const policy = buildAgentCapabilityPolicy('research');
    const decision = getAgentCapabilityDecision(policy, 'create_draft');
    const session = createAgentSession({
      id: 'session-approval',
      profile: 'research',
      task: 'Create a reading note draft',
      now: 100,
    });

    const next = appendAgentTraceEvent(session, {
      id: 'approval-1',
      kind: 'approval_required',
      timestamp: 120,
      message: 'Create draft requires user approval.',
      decision,
      tool: {
        capability: 'create_draft',
        toolName: 'createDraft',
      },
    });

    expect(next.status).toBe('waiting_approval');
    expect(next.approvalRequestIds).toEqual(['approval-1']);

    const withPending = addAgentPendingApproval(next, {
      id: 'approval-1',
      capability: 'create_draft',
      toolName: 'workbench.createDraft',
      argumentsPreview: '{"draft":{"title":"Reading note"}}',
      request: {
        name: 'workbench.createDraft',
        args: { draft: { title: 'Reading note' } },
      },
      decision,
      now: 125,
    });

    expect(withPending.status).toBe('waiting_approval');
    expect(withPending.pendingApprovals).toEqual([
      expect.objectContaining({
        id: 'approval-1',
        status: 'pending',
        toolName: 'workbench.createDraft',
      }),
    ]);

    const completedApproval = resolveAgentPendingApproval(withPending, {
      id: 'approval-1',
      status: 'completed',
      resultPreview: '{"draftId":"draft-1"}',
      now: 128,
    });

    expect(completedApproval.status).toBe('running');
    expect(completedApproval.approvalRequestIds).toEqual([]);
    expect(completedApproval.pendingApprovals[0]).toMatchObject({
      status: 'completed',
      resultPreview: '{"draftId":"draft-1"}',
    });

    const resumed = resumeAgentSession(next, {
      now: 130,
      resolvedApprovalIds: ['approval-1'],
    });

    expect(resumed.status).toBe('running');
    expect(resumed.approvalRequestIds).toEqual([]);
    expect(resumed.updatedAt).toBe(130);
  });

  it('deduplicates evidence refs added by trace events', () => {
    const session = createAgentSession({
      id: 'session-evidence',
      profile: 'research',
      task: 'Inspect evidence',
      now: 100,
      evidenceRefs: [
        {
          kind: 'file',
          label: 'note.md',
          locator: 'note.md',
        },
      ],
    });

    const next = appendAgentTraceEvent(session, {
      kind: 'context_resolved',
      timestamp: 110,
      message: 'Resolved context.',
      evidenceRefs: [
        {
          kind: 'file',
          label: 'note.md duplicate',
          locator: 'note.md',
        },
        {
          kind: 'heading',
          label: 'note.md#Method',
          locator: 'note.md#Method',
        },
      ],
    });

    expect(next.evidenceRefs.map((ref) => ref.locator)).toEqual([
      'note.md',
      'note.md#Method',
    ]);
  });

  it('records terminal completion, failure, and cancellation states', () => {
    const completed = completeAgentSession(createAgentSession({
      id: 'session-complete',
      profile: 'research',
      task: 'Finish task',
      now: 100,
    }), 'Done', 200);

    expect(completed.status).toBe('completed');
    expect(completed.result).toBe('Done');
    expect(completed.completedAt).toBe(200);
    expect(() => appendAgentTraceEvent(completed, {
      kind: 'planning',
      message: 'Too late',
    })).toThrow('Cannot append trace event to terminal agent session: completed');

    const failed = failAgentSession(createAgentSession({
      id: 'session-fail',
      profile: 'research',
      task: 'Fail task',
      now: 100,
    }), 'Tool failed', 210);

    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('Tool failed');

    const cancelled = cancelAgentSession(createAgentSession({
      id: 'session-cancel',
      profile: 'research',
      task: 'Cancel task',
      now: 100,
    }), 'User stopped the run.', 220);

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.trace.at(-1)?.message).toBe('User stopped the run.');
  });

  it('compacts long sessions while retaining recent trace and evidence provenance', () => {
    let session = createAgentSession({
      id: 'session-compact',
      profile: 'research',
      task: 'Long research task',
      now: 100,
    });

    for (let index = 0; index < 12; index += 1) {
      session = appendAgentTraceEvent(session, {
        id: `event-${index}`,
        kind: index % 2 === 0 ? 'tool_result' : 'planning',
        timestamp: 110 + index,
        message: `Event ${index}`,
        metadata: index === 3
          ? {
              omittedContextRecoveryHints: 'workspace_chunk: omitted Alpha @ notes/alpha.md (600 tokens) - alpha detail',
              omittedContextRecoveryPriority: 'workspace_chunk: omitted Alpha @ notes/alpha.md score=120 (priority=80,source=workspace_chunk,tokens=600,locator)',
              omittedContextSemanticPreview: 'workspace_chunk: alpha omitted semantic preview',
            }
          : undefined,
        evidenceRefs: index === 2
          ? [{
              kind: 'file',
              label: 'paper.md',
              locator: 'paper.md',
            }]
          : undefined,
      });
    }

    const compacted = compactAgentSession(session, {
      id: 'compaction-1',
      maxTraceEvents: 6,
      retainRecentEvents: 3,
      now: 200,
    });

    expect(compacted.trace.map((event) => event.id)).toEqual([
      'session-compact:start',
      'compaction-1:event',
      'event-9',
      'event-10',
      'event-11',
    ]);
    expect(compacted.compactions[0]).toMatchObject({
      id: 'compaction-1',
      compactedEventCount: 9,
    });
    expect(compacted.evidenceRefs.map((ref) => ref.locator)).toContain('paper.md');
    expect(compacted.trace[1]).toMatchObject({
      kind: 'context_resolved',
      metadata: expect.objectContaining({
        compactionId: 'compaction-1',
        retainedEventCount: 4,
        sourceEventKinds: 'tool_result,planning',
        retainedEventIdsPreview: 'session-compact:start,event-9,event-10,event-11',
        omittedContextRecoveryHints: 'workspace_chunk: omitted Alpha @ notes/alpha.md (600 tokens) - alpha detail',
        omittedContextRecoveryPriority: 'workspace_chunk: omitted Alpha @ notes/alpha.md score=120 (priority=80,source=workspace_chunk,tokens=600,locator)',
        omittedContextSemanticPreview: 'workspace_chunk: alpha omitted semantic preview',
      }),
    });
  });

  it('retains planner audit anchors when compacting long sessions', () => {
    let session = createAgentSession({
      id: 'session-compact-plan',
      profile: 'research',
      task: 'Long planned research task',
      now: 100,
    });

    session = appendAgentTraceEvent(session, {
      id: 'session-compact-plan:plan-created',
      kind: 'planning',
      timestamp: 105,
      message: 'Plan created with 3 steps.',
      metadata: {
        planSource: 'custom',
        planStepCount: 3,
        planWarningCount: 0,
        plannerPromptPreview: 'Prompt preview',
        plannerRawOutputPreview: 'Raw output preview',
      },
    });

    for (let index = 0; index < 10; index += 1) {
      session = appendAgentTraceEvent(session, {
        id: `plan-event-${index}`,
        kind: index % 2 === 0 ? 'planning' : 'tool_result',
        timestamp: 110 + index,
        message: `Plan event ${index}`,
      });
    }

    const compacted = compactAgentSession(session, {
      id: 'plan-compaction-1',
      maxTraceEvents: 6,
      retainRecentEvents: 2,
      now: 200,
    });

    expect(compacted.trace.map((event) => event.id)).toEqual([
      'session-compact-plan:start',
      'session-compact-plan:plan-created',
      'plan-compaction-1:event',
      'plan-event-8',
      'plan-event-9',
    ]);
    expect(compacted.trace[1]?.metadata).toMatchObject({
      planSource: 'custom',
      plannerPromptPreview: 'Prompt preview',
      plannerRawOutputPreview: 'Raw output preview',
    });
    expect(compacted.trace[2]).toMatchObject({
      kind: 'context_resolved',
      metadata: expect.objectContaining({
        compactedEventCount: 8,
        retainedAuditAnchorCount: 1,
        retainedEventCount: 4,
        sourceEventKinds: 'planning,tool_result',
        retainedEventIdsPreview: expect.stringContaining('session-compact-plan:plan-created'),
      }),
    });
    expect(compacted.compactions[0]).toMatchObject({
      compactedEventCount: 8,
      retainedEventIds: expect.arrayContaining([
        'session-compact-plan:plan-created',
        'plan-event-8',
        'plan-event-9',
      ]),
    });
  });
});
