import { describe, expect, it } from 'vitest';
import { addAgentPendingApproval, createAgentSession } from '@/lib/ai/agent-session';
import { buildAgentReviewQueueViewModel } from '@/lib/ai/agent-review-queue-view-model';

describe('agent review queue view model', () => {
  it('prioritizes active-run memory and tool approvals as one review queue', () => {
    let active = createAgentSession({
      id: 'session-active',
      profile: 'research',
      task: 'Active task',
      title: 'Active run',
      now: 100,
    });
    active = addAgentPendingApproval(active, {
      id: 'approval-tool',
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
    active = addAgentPendingApproval(active, {
      id: 'approval-memory',
      capability: 'memory_write',
      toolName: 'memory.write',
      request: {
        name: 'memory.write',
        args: {
          memory: {
            title: 'Alpha finding',
            content: 'Remember this.',
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

    let older = createAgentSession({
      id: 'session-older',
      profile: 'research',
      task: 'Older task',
      title: 'Older run',
      now: 80,
    });
    older = addAgentPendingApproval(older, {
      id: 'approval-older-memory',
      capability: 'memory_write',
      toolName: 'memory.write',
      request: {
        name: 'memory.write',
        args: {
          memory: {
            title: 'Older finding',
            content: 'Older memory.',
          },
        },
      },
      decision: {
        capability: 'memory_write',
        permission: 'ask',
        requiresApproval: true,
        allowed: true,
      },
      now: 90,
    });

    const queue = buildAgentReviewQueueViewModel([older, active], 'session-active');

    expect(queue).toMatchObject({
      activeSessionId: 'session-active',
      pendingApprovalCount: 3,
      pendingMemoryApprovalCount: 2,
      activeSessionPendingApprovalCount: 2,
      activeSessionPendingMemoryApprovalCount: 1,
      otherSessionPendingApprovalCount: 1,
      otherSessionPendingMemoryApprovalCount: 1,
      nextAction: 'review_approvals',
    });
    expect(queue.summary).toBe('3 pending / 2 memory / 2 current run');
    expect(queue.items.map((item) => item.id)).toEqual([
      'approval-memory',
      'approval-tool',
      'approval-older-memory',
    ]);
    expect(queue.items[0]).toMatchObject({
      kind: 'memory_approval',
      title: 'Alpha finding',
      isActiveSession: true,
    });
  });

  it('falls back to memory review when only other runs need memory approval', () => {
    let session = createAgentSession({
      id: 'session-memory',
      profile: 'research',
      task: 'Memory task',
      title: 'Memory run',
      now: 100,
    });
    session = addAgentPendingApproval(session, {
      id: 'approval-memory',
      capability: 'memory_write',
      toolName: 'memory.write',
      request: {
        name: 'memory.write',
        args: { memory: { title: 'Memory from another run' } },
      },
      decision: {
        capability: 'memory_write',
        permission: 'ask',
        requiresApproval: true,
        allowed: true,
      },
      now: 110,
    });

    const queue = buildAgentReviewQueueViewModel([session], 'missing-active-session');

    expect(queue.nextAction).toBe('review_memory');
    expect(queue.activeSessionPendingApprovalCount).toBe(0);
    expect(queue.pendingMemoryApprovalCount).toBe(1);
  });
});
