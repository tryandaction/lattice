import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentSession } from '@/lib/ai/agent-session';
import type { AgentSessionPersistenceData } from '@/lib/ai/agent-session-persistence';
import type { DocumentResearchCheckpoint } from '@/lib/ai/document-research';

const runtime = vi.hoisted(() => ({ persistence: { load: vi.fn(), save: vi.fn() } }));
vi.mock('@/lib/ai/agent-session-persistence', () => ({ getAgentSessionPersistence: () => runtime.persistence }));
import { useAgentSessionStore } from '../agent-session-store';

const old = (): AgentSessionPersistenceData => ({
  sessions: [{ ...createAgentSession({ id: 'old-task', task: 'Synthetic original directory', profile: 'research', now: 1 }), status: 'cancelled' }],
  activeSessionId: 'old-task',
});
const checkpoint = (): DocumentResearchCheckpoint => ({ version: 1, queryKey: 'read', sources: [], coverage: [], findings: [], summaries: ['Committed synthetic note'], completedBatches: 1 });
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe('agent session hydration barrier', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    runtime.persistence = { load: vi.fn().mockResolvedValue(null), save: vi.fn().mockResolvedValue(undefined) };
    useAgentSessionStore.setState({ sessions: [], activeSessionId: null, focusTarget: null });
  });
  afterEach(async () => { await vi.runOnlyPendingTimersAsync(); vi.useRealTimers(); });

  it('merges disk tasks before the first strict save even when a new task was started before load', async () => {
    let resolve!: (data: AgentSessionPersistenceData) => void;
    runtime.persistence.load.mockImplementationOnce(() => new Promise<AgentSessionPersistenceData>(done => { resolve = done; }));
    const state = useAgentSessionStore.getState();
    state.createSession({ id: 'new-task', task: 'Synthetic new task', profile: 'research' });
    const save = state.saveDocumentResearch('new-task', { checkpoint: checkpoint(), status: 'reading' });
    await tick();
    expect(runtime.persistence.load).toHaveBeenCalledTimes(1);
    expect(runtime.persistence.save).not.toHaveBeenCalled();
    resolve(old()); await save;
    expect(useAgentSessionStore.getState().sessions.map(item => item.id)).toEqual(['new-task', 'old-task']);
    expect(runtime.persistence.save.mock.lastCall?.[0].sessions.map((item: { id: string }) => item.id)).toEqual(['new-task', 'old-task']);
  });

  it('shares an in-flight explicit load and does not resurrect an explicitly deleted old task', async () => {
    let resolve!: (data: AgentSessionPersistenceData) => void;
    runtime.persistence.load.mockImplementationOnce(() => new Promise<AgentSessionPersistenceData>(done => { resolve = done; }));
    const load = useAgentSessionStore.getState().loadSessions();
    useAgentSessionStore.getState().deleteSession('old-task');
    useAgentSessionStore.getState().createSession({ id: 'new-task', task: 'Synthetic new task', profile: 'research' });
    const save = useAgentSessionStore.getState().saveDocumentResearch('new-task', { checkpoint: checkpoint(), status: 'reading' });
    await tick(); resolve(old()); await Promise.all([load, save]);
    expect(runtime.persistence.load).toHaveBeenCalledTimes(1);
    expect(useAgentSessionStore.getState().getSession('old-task')).toBeNull();
    expect(runtime.persistence.save.mock.lastCall?.[0].sessions.map((item: { id: string }) => item.id)).toEqual(['new-task']);
  });

  it('does not save defaults or a new partial state over an unavailable old store', async () => {
    runtime.persistence.load.mockRejectedValue(new Error('Synthetic storage unavailable'));
    useAgentSessionStore.getState().createSession({ id: 'new-task', task: 'Synthetic new task', profile: 'research' });
    await expect(useAgentSessionStore.getState().saveDocumentResearch('new-task', { checkpoint: checkpoint(), status: 'reading' })).rejects.toThrow('无法保存阅读进度');
    expect(runtime.persistence.save).not.toHaveBeenCalled();
    expect(useAgentSessionStore.getState().getSession('new-task')?.documentResearch?.status).toBe('failed');
  });

  it('captures the checkpoint before the hydration await and preserves old history during an empty initial UI save', async () => {
    runtime.persistence.load.mockResolvedValueOnce(old());
    useAgentSessionStore.getState().setActiveSession(null);
    await vi.advanceTimersByTimeAsync(500);
    expect(runtime.persistence.save.mock.lastCall?.[0].sessions[0].id).toBe('old-task');
    const id = useAgentSessionStore.getState().createSession({ id: 'new-task', task: 'Synthetic new task', profile: 'research' });
    const value = checkpoint(); const save = useAgentSessionStore.getState().saveDocumentResearch(id, { checkpoint: value, status: 'reading' });
    value.summaries.push('MUTATED AFTER SAVE');
    await save;
    const captured = runtime.persistence.save.mock.lastCall?.[0].sessions.find((item: { id: string }) => item.id === id);
    expect(captured.documentResearch.checkpoint.summaries).toEqual(['Committed synthetic note']);
  });

  it.each(['new-task', 'empty'] as const)('does not let a pre-hydration %s debounce overwrite history loaded before the timer fires', async mode => {
    let resolve!: (data: AgentSessionPersistenceData) => void;
    runtime.persistence.load.mockImplementationOnce(() => new Promise<AgentSessionPersistenceData>(done => { resolve = done; }));
    if (mode === 'new-task') useAgentSessionStore.getState().createSession({ id: 'new-task', task: 'Synthetic new task', profile: 'research' });
    else useAgentSessionStore.getState().setActiveSession(null);
    const load = useAgentSessionStore.getState().loadSessions();
    await tick(); resolve(old()); await load;
    const expected = mode === 'new-task' ? ['new-task', 'old-task'] : ['old-task'];
    expect(useAgentSessionStore.getState().sessions.map(item => item.id)).toEqual(expected);
    await vi.advanceTimersByTimeAsync(500);
    expect(runtime.persistence.save.mock.lastCall?.[0].sessions.map((item: { id: string }) => item.id)).toEqual(expected);
  });
});
