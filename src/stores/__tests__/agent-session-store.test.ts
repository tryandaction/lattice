import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = {
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
};

vi.mock('@/lib/storage-adapter', () => ({
  getStorageAdapter: () => storage,
}));

import { useAgentSessionStore } from '../agent-session-store';
import type { DocumentResearchCheckpoint } from '@/lib/ai/document-research';

function waitForSave(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 650));
}

describe('agent-session-store', () => {
  it('recovers a final synthesis interrupted after all document units were read', async () => {
    const id = useAgentSessionStore.getState().createSession({ id: 'final-synthesis', profile: 'research', task: 'Read all' });
    const checkpoint: DocumentResearchCheckpoint = { version: 1, queryKey: 'read', sources: [], findings: [], summaries: ['Finished reading'], coverage: [], completedBatches: 1 };
    await useAgentSessionStore.getState().saveDocumentResearch(id, { checkpoint, status: 'ready' });
    const saved = { sessions: useAgentSessionStore.getState().sessions, activeSessionId: id };
    useAgentSessionStore.setState({ sessions: [], activeSessionId: null });
    storage.get.mockResolvedValueOnce(saved);
    await useAgentSessionStore.getState().loadSessions();
    expect(useAgentSessionStore.getState().getSession(id)).toMatchObject({ status: 'cancelled', documentResearch: { status: 'ready', checkpoint: { completedBatches: 1 } } });
    useAgentSessionStore.getState().resumeDocumentSession(id);
    expect(useAgentSessionStore.getState().getSession(id)?.status).toBe('running');
  });
  it('reports failed checkpoint persistence and retains in-memory progress for recovery', async () => {
    const id = useAgentSessionStore.getState().createSession({ id: 'durable-checkpoint', profile: 'research', task: 'Read all' });
    const checkpoint: DocumentResearchCheckpoint = { version: 1, queryKey: 'read', sources: [], findings: [], summaries: ['Batch one'], coverage: [], completedBatches: 1 };
    storage.set.mockRejectedValueOnce(new Error('disk full'));
    await expect(useAgentSessionStore.getState().saveDocumentResearch(id, { checkpoint, status: 'reading' })).rejects.toThrow('无法保存阅读进度');
    expect(useAgentSessionStore.getState().getSession(id)?.documentResearch).toMatchObject({ status: 'failed', checkpoint: { completedBatches: 1 } });
    await useAgentSessionStore.getState().saveDocumentResearch(id, { checkpoint, status: 'reading' });
    expect(useAgentSessionStore.getState().getSession(id)?.documentResearch?.status).toBe('reading');
  });
  it('does not overwrite a new live task when old session hydration finishes late', async () => {
    let resolve!: (value: unknown) => void;
    storage.get.mockImplementationOnce(() => new Promise(value => { resolve = value; }));
    const hydration = useAgentSessionStore.getState().loadSessions();
    useAgentSessionStore.getState().createSession({ id: 'new-live-task', profile: 'research', task: 'New task' });
    resolve({ sessions: [], activeSessionId: null });
    await hydration;
    expect(useAgentSessionStore.getState().getActiveSession()?.id).toBe('new-live-task');
  });
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      focusTarget: null,
    });
  });

  it('creates and persists a new active session', async () => {
    const id = useAgentSessionStore.getState().createSession({
      id: 'session-1',
      profile: 'research',
      task: 'Compare annotated papers',
      now: 100,
    });

    expect(id).toBe('session-1');
    expect(useAgentSessionStore.getState().activeSessionId).toBe('session-1');
    expect(useAgentSessionStore.getState().getActiveSession()?.status).toBe('running');

    await waitForSave();

    expect(storage.set).toHaveBeenCalledWith(
      'lattice-agent-sessions-v1',
      expect.objectContaining({
        activeSessionId: 'session-1',
        sessions: expect.arrayContaining([
          expect.objectContaining({ id: 'session-1' }),
        ]),
      }),
    );
  });

  it('records approval waits and resumes after approval ids are resolved', () => {
    useAgentSessionStore.getState().createSession({
      id: 'session-approval',
      profile: 'research',
      task: 'Create draft',
      now: 100,
    });

    useAgentSessionStore.getState().appendTrace('session-approval', {
      id: 'approval-1',
      kind: 'approval_required',
      timestamp: 120,
      message: 'Draft creation requires approval.',
      decision: {
        capability: 'create_draft',
        permission: 'ask',
        requiresApproval: true,
        allowed: true,
      },
    });

    expect(useAgentSessionStore.getState().getSession('session-approval')?.status).toBe('waiting_approval');
    expect(useAgentSessionStore.getState().getSession('session-approval')?.approvalRequestIds).toEqual(['approval-1']);

    useAgentSessionStore.getState().resumeSession('session-approval', ['approval-1']);

    expect(useAgentSessionStore.getState().getSession('session-approval')?.status).toBe('running');
    expect(useAgentSessionStore.getState().getSession('session-approval')?.approvalRequestIds).toEqual([]);
  });

  it('records terminal states through store actions', () => {
    useAgentSessionStore.getState().createSession({
      id: 'session-complete',
      profile: 'research',
      task: 'Finish task',
      now: 100,
    });
    useAgentSessionStore.getState().completeSession('session-complete', 'Done');

    expect(useAgentSessionStore.getState().getSession('session-complete')).toMatchObject({
      status: 'completed',
      result: 'Done',
    });

    useAgentSessionStore.getState().createSession({
      id: 'session-fail',
      profile: 'research',
      task: 'Fail task',
      now: 100,
    });
    useAgentSessionStore.getState().failSession('session-fail', 'Tool failed');

    expect(useAgentSessionStore.getState().getSession('session-fail')).toMatchObject({
      status: 'failed',
      error: 'Tool failed',
    });
  });

  it('compacts persisted sessions through the store action', () => {
    const sessionId = useAgentSessionStore.getState().createSession({
      id: 'store-session-compact',
      profile: 'research',
      task: 'Compact store session',
      now: 100,
    });

    for (let index = 0; index < 10; index += 1) {
      useAgentSessionStore.getState().appendTrace(sessionId, {
        id: `store-event-${index}`,
        kind: 'planning',
        timestamp: 110 + index,
        message: `Planning ${index}`,
      });
    }

    useAgentSessionStore.getState().compactSession(sessionId, {
      id: 'store-compaction-1',
      maxTraceEvents: 6,
      retainRecentEvents: 2,
      now: 200,
    });

    const compacted = useAgentSessionStore.getState().getSession(sessionId);
    expect(compacted?.trace.map((event) => event.id)).toEqual([
      'store-session-compact:start',
      'store-compaction-1:event',
      'store-event-8',
      'store-event-9',
    ]);
    expect(compacted?.compactions[0]).toMatchObject({
      id: 'store-compaction-1',
      compactedEventCount: 8,
    });
  });

  it('loads persisted sessions and falls back to the newest active session', async () => {
    useAgentSessionStore.setState({ focusTarget: 'memory' });
    storage.get.mockResolvedValue({
      sessions: [
        {
          id: 'older',
          profile: 'chat',
          title: 'Older',
          task: 'Older task',
          status: 'completed',
          createdAt: 1,
          updatedAt: 1,
          completedAt: 1,
          trace: [],
          evidenceRefs: [],
          approvalRequestIds: [],
        },
        {
          id: 'newer',
          profile: 'research',
          title: 'Newer',
          task: 'Newer task',
          status: 'running',
          createdAt: 2,
          updatedAt: 2,
          trace: [],
          evidenceRefs: [],
          approvalRequestIds: [],
        },
      ],
      activeSessionId: 'missing',
    });

    await useAgentSessionStore.getState().loadSessions();

    expect(useAgentSessionStore.getState().sessions.map((session) => session.id)).toEqual(['newer', 'older']);
    expect(useAgentSessionStore.getState().activeSessionId).toBe('newer');
    expect(useAgentSessionStore.getState().focusTarget).toBeNull();
  });

  it('tracks transient panel focus targets without changing persisted session payload shape', async () => {
    useAgentSessionStore.getState().createSession({
      id: 'session-focus',
      profile: 'research',
      task: 'Focus session',
      now: 100,
    });

    useAgentSessionStore.getState().focusSession('session-focus', 'memory');

    expect(useAgentSessionStore.getState().activeSessionId).toBe('session-focus');
    expect(useAgentSessionStore.getState().focusTarget).toBe('memory');

    useAgentSessionStore.getState().consumeFocusTarget('trace');
    expect(useAgentSessionStore.getState().focusTarget).toBe('memory');

    useAgentSessionStore.getState().consumeFocusTarget('memory');
    expect(useAgentSessionStore.getState().focusTarget).toBeNull();

    await waitForSave();

    expect(storage.set).toHaveBeenLastCalledWith(
      'lattice-agent-sessions-v1',
      expect.not.objectContaining({
        focusTarget: expect.anything(),
      }),
    );
  });
});
