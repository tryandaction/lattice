import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentSession, type AgentSession } from '@/lib/ai/agent-session';
import type { DocumentResearchCheckpoint } from '@/lib/ai/document-research';
import type { DirectoryResearchCheckpoint } from '@/lib/ai/directory-research';

const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), setStrict: vi.fn() }));
vi.mock('@/lib/storage-adapter', () => ({ getStorageAdapter: () => storage }));

import { useAgentSessionStore } from '../agent-session-store';

const checkpoint: DocumentResearchCheckpoint = {
  version: 1, queryKey: '["Read all", "Read all"]', sources: [], coverage: [],
  summaries: ['A committed batch'], findings: [], completedBatches: 1,
};
function session(id: string, updatedAt: number, extra: Partial<AgentSession> = {}): AgentSession {
  return { ...createAgentSession({ id, profile: 'research', task: 'Read all', now: updatedAt }), status: 'completed', ...extra };
}
function archived(count: number): AgentSession[] {
  return Array.from({ length: count }, (_, i) => session('archive-' + i, 1000 + i, {
    status: i % 3 === 0 ? 'failed' : i % 3 === 1 ? 'cancelled' : 'completed',
  }));
}

describe('agent session retention', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    storage.set.mockResolvedValue(undefined);
    storage.setStrict.mockResolvedValue(undefined);
    useAgentSessionStore.setState({ sessions: [], activeSessionId: null, focusTarget: null });
  });
  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
  });

  it('keeps older resumable reading tasks during hydration while bounding disposable terminal history', async () => {
    const protectedSessions = [
      session('paused', 1, { status: 'cancelled', documentResearch: { checkpoint, status: 'paused' } }),
      session('failed-reading', 2, { status: 'failed', documentResearch: { checkpoint, status: 'failed' } }),
      session('interrupted-reading', 3, { status: 'running', documentResearch: { checkpoint, status: 'reading' } }),
      session('unfinished-synthesis', 4, { status: 'failed', documentResearch: { checkpoint, status: 'ready' } }),
      session('interrupted-synthesis', 5, { status: 'running', documentResearch: { checkpoint, status: 'ready' } }),
    ];
    storage.get.mockResolvedValueOnce({ sessions: [...protectedSessions, ...archived(60)], activeSessionId: 'paused' });
    await useAgentSessionStore.getState().loadSessions();
    const state = useAgentSessionStore.getState();
    expect(state.sessions).toHaveLength(45);
    expect(state.activeSessionId).toBe('paused');
    expect(state.sessions.filter(item => item.id.startsWith('archive-'))).toHaveLength(40);
    for (const item of protectedSessions) expect(state.getSession(item.id)?.documentResearch?.checkpoint).toEqual(checkpoint);
    expect(state.getSession('interrupted-reading')).toMatchObject({ status: 'cancelled', documentResearch: { status: 'paused' } });
    expect(state.getSession('interrupted-synthesis')).toMatchObject({ status: 'cancelled', documentResearch: { status: 'ready' } });
    expect(state.getSession('archive-19')).toBeNull();
    expect(state.getSession('archive-20')).not.toBeNull();
  });

  it('persists more than forty active tasks and can explicitly delete one', async () => {
    for (let i = 0; i < 55; i++) useAgentSessionStore.getState().createSession({ id: 'active-' + i, profile: 'research', task: 'Synthetic task', now: i + 1 });
    expect(useAgentSessionStore.getState().sessions).toHaveLength(55);
    await vi.advanceTimersByTimeAsync(500);
    expect(storage.setStrict.mock.lastCall?.[1].sessions).toHaveLength(55);
    useAgentSessionStore.getState().deleteSession('active-0');
    await vi.advanceTimersByTimeAsync(500);
    expect(useAgentSessionStore.getState().getSession('active-0')).toBeNull();
    expect(storage.setStrict.mock.lastCall?.[1].sessions).toHaveLength(54);
    expect(storage.setStrict.mock.lastCall?.[1].sessions.some((item: AgentSession) => item.id === 'active-0')).toBe(false);
  });

  it('retains unresolved approvals and execution continuations but not stale completed continuations', async () => {
    const approval = {
      id: 'approval', capability: 'create_draft' as const, toolName: 'draft.create',
      request: { name: 'draft.create', args: {} },
      decision: { capability: 'create_draft' as const, permission: 'ask' as const, requiresApproval: true, allowed: true },
      status: 'pending' as const, createdAt: 1, updatedAt: 1,
    };
    const continuation = { planSteps: [], request: { task: 'Finish synthetic result' } };
    const pending = [
      session('queued', 1, { status: 'queued' }),
      session('running', 2, { status: 'running' }),
      session('waiting-approval', 3, { status: 'waiting_approval' }),
      session('legacy-approval', 4, { status: 'cancelled', approvalRequestIds: ['unresolved'] }),
      ...(['pending', 'approved', 'executing'] as const).map((status, i) => session(status, 5 + i, { status: 'failed', pendingApprovals: [{ ...approval, status }] })),
      session('execution-failed', 8, { status: 'failed', executionContinuation: continuation }),
      session('execution-cancelled', 9, { status: 'cancelled', executionContinuation: continuation }),
    ];
    const finished = [
      session('stale-execution', 10, { status: 'completed', executionContinuation: continuation }),
      session('finished-reading', 11, { status: 'completed', documentResearch: { checkpoint, status: 'ready' } }),
      session('rejected-approval', 12, { status: 'failed', pendingApprovals: [{ ...approval, status: 'rejected' }] }),
    ];
    storage.get.mockResolvedValueOnce({ sessions: [...pending, ...finished, ...archived(60)], activeSessionId: null });
    await useAgentSessionStore.getState().loadSessions();
    for (const item of pending) expect(useAgentSessionStore.getState().getSession(item.id)).not.toBeNull();
    for (const item of finished) expect(useAgentSessionStore.getState().getSession(item.id)).toBeNull();
    expect(useAgentSessionStore.getState().sessions).toHaveLength(pending.length + 40);
  });

  it('keeps a failed strict checkpoint in memory and persists it after storage recovers', async () => {
    const id = useAgentSessionStore.getState().createSession({ id: 'write-recovery', profile: 'research', task: 'Read all' });
    storage.setStrict.mockRejectedValueOnce(new Error('synthetic disk full'));
    await expect(useAgentSessionStore.getState().saveDocumentResearch(id, { checkpoint, status: 'reading' })).rejects.toThrow('无法保存阅读进度');
    const failed = { ...useAgentSessionStore.getState().getSession(id)!, updatedAt: 1 };
    // Newer terminal records must not replace the failed in-memory checkpoint.
    useAgentSessionStore.setState({ sessions: [failed, ...archived(60)] });
    useAgentSessionStore.getState().createSession({ id: 'newest', profile: 'research', task: 'Another synthetic task' });
    expect(useAgentSessionStore.getState().getSession(id)?.documentResearch).toMatchObject({ status: 'failed', checkpoint });
    await useAgentSessionStore.getState().saveDocumentResearch(id, { checkpoint, status: 'paused' });
    const saved = structuredClone(storage.setStrict.mock.lastCall?.[1]);
    expect(saved.sessions.find((item: AgentSession) => item.id === id)?.documentResearch).toMatchObject({ status: 'paused', checkpoint });
    useAgentSessionStore.setState({ sessions: [], activeSessionId: null });
    storage.get.mockResolvedValueOnce(saved);
    await useAgentSessionStore.getState().loadSessions();
    expect(useAgentSessionStore.getState().getSession(id)?.documentResearch?.checkpoint).toEqual(checkpoint);
  });

  it('keeps retryable directory ledgers after a partial answer is completed, but can retire a fully completed directory', async () => {
    const directory = (status: DirectoryResearchCheckpoint['files'][number]['status']): DirectoryResearchCheckpoint => ({
      version: 2, workspaceKey: 'A', selections: [{ kind: 'folder', path: 'docs' }], task: 'Read all', query: 'Read all',
      phase: 'ready', calls: 1, removedPaths: [], reductions: [],
      files: [{ path: 'docs/paper.pdf', size: 4, lastModified: 1, status }],
      manifest: { version: 1, workspaceKey: 'A', selections: [{ kind: 'folder', path: 'docs' }], roots: [{ kind: 'folder', path: 'docs' }],
        files: [], directories: [], pendingDirectories: [], complete: true, revision: 1, changedPaths: [], removedPaths: [] },
    });
    const unfinished = (id: string, value: DirectoryResearchCheckpoint) => session(id, 1, {
      status: 'completed', documentResearch: { checkpoint, status: 'ready', directory: value },
    });
    const incompleteDiscovery = directory('complete'); incompleteDiscovery.manifest!.complete = false;
    const pendingReduction = directory('complete'); pendingReduction.phase = 'paused';
    const missingManifest = directory('complete'); delete missingManifest.manifest;
    const pending = [
      ...(['failed', 'no_text', 'pending', 'reading'] as const).map(status => unfinished('directory-' + status, directory(status))),
      unfinished('directory-incomplete-discovery', incompleteDiscovery),
      unfinished('directory-pending-reduction', pendingReduction),
      unfinished('directory-missing-manifest', missingManifest),
    ];
    const finished = unfinished('directory-finished', directory('complete'));
    storage.get.mockResolvedValueOnce({ sessions: [...pending, finished, ...archived(60)], activeSessionId: 'directory-failed' });
    await useAgentSessionStore.getState().loadSessions();
    for (const item of pending) expect(useAgentSessionStore.getState().getSession(item.id)?.documentResearch?.directory).toEqual(item.documentResearch?.directory);
    expect(useAgentSessionStore.getState().getSession(finished.id)).toBeNull();
    expect(useAgentSessionStore.getState().sessions).toHaveLength(47);
    // A later ordinary save must preserve the same retry scopes as hydration.
    useAgentSessionStore.getState().setActiveSession('directory-failed');
    await vi.advanceTimersByTimeAsync(500);
    const saved = structuredClone(storage.setStrict.mock.lastCall?.[1]);
    useAgentSessionStore.setState({ sessions: [], activeSessionId: null });
    storage.get.mockResolvedValueOnce(saved);
    await useAgentSessionStore.getState().loadSessions();
    expect(useAgentSessionStore.getState().getSession('directory-failed')?.documentResearch?.directory?.selections).toEqual([{ kind: 'folder', path: 'docs' }]);
    expect(useAgentSessionStore.getState().sessions).toHaveLength(47);
  });
});
