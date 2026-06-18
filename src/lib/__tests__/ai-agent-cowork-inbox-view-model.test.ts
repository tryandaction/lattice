import { describe, expect, it } from 'vitest';
import {
  addAgentPendingApproval,
  appendAgentTraceEvent,
  completeAgentSession,
  createAgentSession,
  failAgentSession,
} from '@/lib/ai/agent-session';
import {
  buildAgentCoworkInboxViewModel,
  formatAgentCoworkInboxMarkdown,
} from '@/lib/ai/agent-cowork-inbox-view-model';

describe('agent cowork inbox view model', () => {
  it('prioritizes the active session, approvals, blocked runs, running runs, and handoffs', () => {
    let active = createAgentSession({
      id: 'session-active',
      profile: 'research',
      task: 'Active coding review',
      title: 'Active run',
      now: 100,
    });
    active = addAgentPendingApproval(active, {
      id: 'approval-active',
      capability: 'write_workspace',
      toolName: 'workbench.createProposal',
      request: { name: 'workbench.createProposal', args: {} },
      decision: {
        capability: 'write_workspace',
        permission: 'ask',
        requiresApproval: true,
        allowed: true,
      },
      now: 140,
    });

    const blocked = failAgentSession(createAgentSession({
      id: 'session-blocked',
      profile: 'research',
      task: 'Blocked task',
      title: 'Blocked run',
      now: 90,
    }), 'Typecheck failed.', 150);

    const running = appendAgentTraceEvent(createAgentSession({
      id: 'session-running',
      profile: 'research',
      task: 'Running task',
      title: 'Running run',
      now: 80,
    }), {
      kind: 'planning',
      message: 'Planning next step.',
      timestamp: 160,
    });

    const handoff = completeAgentSession(appendAgentTraceEvent(createAgentSession({
      id: 'session-handoff',
      profile: 'research',
      task: 'Create handoff',
      title: 'Handoff run',
      now: 70,
    }), {
      kind: 'proposal_created',
      message: 'Workbench proposal created.',
      timestamp: 170,
      artifactId: 'proposal-1',
    }), 'Completed handoff.', 180);

    const inbox = buildAgentCoworkInboxViewModel(
      [handoff, running, blocked, active],
      'session-active',
      {
        workspace: {
          openTabCount: 5,
          dirtyTabCount: 2,
          dirtyPaths: ['notes/a.md', 'notes/b.md'],
          activeTabName: 'a.md',
          activeTabPath: 'notes/a.md',
        },
      },
    );

    expect(inbox).toMatchObject({
      activeSessionId: 'session-active',
      totalSessionCount: 4,
      pendingApprovalCount: 1,
      blockedCount: 1,
      runningCount: 1,
      handoffCount: 1,
      nextAction: 'review_approvals',
    });
    expect(inbox.workspaceRisk).toMatchObject({
      level: 'dirty',
      dirtyTabCount: 2,
      duplicateDirtyPathCount: 0,
      summary: '2 unsaved tabs / 5 open tabs',
    });
    expect(inbox.summary).toBe('4 sessions / 1 approvals / 1 blocked / 1 running / 1 handoffs');
    expect(inbox.items.map((item) => [item.sessionId, item.kind])).toEqual([
      ['session-active', 'needs_approval'],
      ['session-blocked', 'blocked'],
      ['session-running', 'running'],
      ['session-handoff', 'handoff'],
    ]);
    expect(inbox.items[0]).toMatchObject({
      isActiveSession: true,
      summary: '1 approval waiting',
    });
    expect(inbox.items[1]?.detail).toContain('Typecheck failed.');

    const markdown = formatAgentCoworkInboxMarkdown(inbox);

    expect(markdown).toContain('Summary: 4 sessions / 1 approvals / 1 blocked / 1 running / 1 handoffs');
    expect(markdown).toContain('Next action: review_approvals');
    expect(markdown).toContain('Workspace risk: dirty');
    expect(markdown).toContain('Workspace: 2 unsaved tabs / 5 open tabs');
    expect(markdown).toContain('1. [needs_approval] Active run (active)');
    expect(markdown).toContain('session: session-blocked');
    expect(markdown).toContain('detail: Typecheck failed.');
  });

  it('flags duplicate dirty paths as workspace conflicts', () => {
    const inbox = buildAgentCoworkInboxViewModel([], null, {
      workspace: {
        openTabCount: 4,
        dirtyTabCount: 3,
        dirtyPaths: ['notes/a.md', 'notes/A.md', 'notes/b.md'],
        activeTabName: 'a.md',
        activeTabPath: 'notes/a.md',
      },
    });

    expect(inbox.workspaceRisk).toMatchObject({
      level: 'conflict',
      dirtyTabCount: 3,
      duplicateDirtyPathCount: 1,
      duplicateDirtyPaths: ['notes/a.md'],
      summary: '3 unsaved tabs / 1 duplicate dirty paths',
    });
    expect(formatAgentCoworkInboxMarkdown(inbox)).toContain(
      'Workspace detail: Resolve duplicate dirty tabs before approving agent work: notes/a.md',
    );
  });

  it('limits visible items while preserving aggregate counts', () => {
    const sessions = Array.from({ length: 8 }, (_, index) =>
      createAgentSession({
        id: `session-${index}`,
        profile: 'research',
        task: `Task ${index}`,
        title: `Run ${index}`,
        now: 100 + index,
      })
    );

    const inbox = buildAgentCoworkInboxViewModel(sessions, null, { limit: 3 });

    expect(inbox.totalSessionCount).toBe(8);
    expect(inbox.items).toHaveLength(3);
    expect(inbox.summary).toBe('8 sessions / 8 running');
    expect(inbox.nextAction).toBe('watch_running');
  });
});
