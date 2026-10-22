import { create } from 'zustand';
import {
  addAgentPendingApproval,
  addAgentSessionMemorySnapshotIds,
  appendAgentTraceEvent,
  cancelAgentSession,
  compactAgentSession,
  completeAgentSession,
  createAgentSession,
  failAgentSession,
  resumeAgentSession,
  resolveAgentPendingApproval,
  type AgentPendingApproval,
  type AgentSession,
  type AppendAgentTraceInput,
  type CompactAgentSessionInput,
  type CreateAgentPendingApprovalInput,
  type CreateAgentSessionInput,
  type ResolveAgentPendingApprovalInput,
} from '@/lib/ai/agent-session';
import { getAgentSessionPersistence, type AgentSessionPersistence, type AgentSessionPersistenceData } from '@/lib/ai/agent-session-persistence';

const MAX_ARCHIVED_SESSIONS = 40;

interface AgentSessionState {
  sessions: AgentSession[];
  activeSessionId: string | null;
  focusTarget: 'trace' | 'memory' | null;
}

interface AgentSessionActions {
  resumeExecutionSynthesisSession: (sessionId: string) => void;
  saveExecutionContinuation: (sessionId: string, continuation: AgentSession['executionContinuation']) => Promise<void>;
  saveDocumentResearch: (sessionId: string, state: NonNullable<AgentSession['documentResearch']>) => Promise<void>;
  resumeDocumentSession: (sessionId: string) => void;
  createSession: (input: CreateAgentSessionInput) => string;
  setActiveSession: (sessionId: string | null) => void;
  focusSession: (sessionId: string, target: 'trace' | 'memory') => void;
  consumeFocusTarget: (target: 'trace' | 'memory') => void;
  appendTrace: (sessionId: string, event: AppendAgentTraceInput) => void;
  addMemorySnapshotIds: (sessionId: string, memoryIds: string[], now?: number) => void;
  addPendingApproval: (sessionId: string, approval: CreateAgentPendingApprovalInput) => void;
  resolvePendingApproval: (sessionId: string, approval: ResolveAgentPendingApprovalInput) => void;
  resumeSession: (sessionId: string, resolvedApprovalIds?: string[]) => void;
  completeSession: (sessionId: string, result: string) => void;
  failSession: (sessionId: string, error: string) => void;
  cancelSession: (sessionId: string, reason?: string) => void;
  compactSession: (sessionId: string, input?: CompactAgentSessionInput) => void;
  deleteSession: (sessionId: string) => void;
  getSession: (sessionId: string) => AgentSession | null;
  getActiveSession: () => AgentSession | null;
  getPendingApproval: (approvalId: string) => { session: AgentSession; approval: AgentPendingApproval } | null;
  loadSessions: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveTail: Promise<void> = Promise.resolve();
let persistenceOwner: AgentSessionPersistence | undefined;
let hydrated = false;
let hydration: Promise<AgentSessionPersistenceData | null> | null = null;
let hydrationBaseline: AgentSessionPersistenceData | null = null;
let hydrationRevision = 0;
const deletedSessionIds = new Set<string>();
function persistenceContext(): AgentSessionPersistence {
  const persistence = getAgentSessionPersistence();
  if (persistence !== persistenceOwner) {
    persistenceOwner = persistence; hydrated = false; hydration = null; hydrationBaseline = null; hydrationRevision = 0;
    deletedSessionIds.clear();
  }
  return persistence;
}
function recoverSession(session: AgentSession): AgentSession {
  if (!session.documentResearch || !['running', 'queued'].includes(session.status)) return session;
  return { ...session, status: session.documentResearch.status === 'failed' ? 'failed' : 'cancelled',
    documentResearch: { ...session.documentResearch, status: session.documentResearch.status === 'reading' ? 'paused' : session.documentResearch.status } };
}
function mergedData(saved: AgentSessionPersistenceData | null, current: AgentSessionPersistenceData): AgentSessionPersistenceData {
  const sessions = sortSessions([...new Map([...(saved?.sessions ?? []), ...current.sessions].map(session => [session.id, session])).values()]
    .filter(session => !deletedSessionIds.has(session.id)));
  const active = current.activeSessionId ?? saved?.activeSessionId;
  return { sessions, activeSessionId: active && sessions.some(session => session.id === active) ? active : sessions[0]?.id ?? null };
}
function hydrate(persistence: AgentSessionPersistence, force = false): Promise<AgentSessionPersistenceData | null> {
  if (hydration) return hydration;
  if (hydrated && !force) return Promise.resolve(hydrationBaseline);
  hydrated = false;
  hydration = persistence.load().then(saved => {
    if (persistenceOwner !== persistence) throw new Error('Agent session storage changed during loading; retry without replacing existing data.');
    const recovered = saved ? { ...saved, sessions: saved.sessions.map(recoverSession) } : null;
    const data = mergedData(recovered, useAgentSessionStore.getState());
    useAgentSessionStore.setState({ ...data, focusTarget: null });
    hydrationBaseline = recovered;
    hydrationRevision++;
    hydrated = true;
    hydration = null;
    return recovered;
  }).catch(error => { hydration = null; throw error; });
  return hydration;
}
function persistNow(state: AgentSessionState): Promise<void> {
  const persistence = persistenceContext();
  // Clone before entering the queued write or hydration await.
  const captured = structuredClone({ sessions: sortSessions(state.sessions), activeSessionId: state.activeSessionId });
  const needsHydration = !hydrated || Boolean(hydration);
  const capturedRevision = hydrationRevision;
  const operation = saveTail.then(async () => {
    const saved = needsHydration || !hydrated || hydration ? await hydrate(persistence)
      : capturedRevision !== hydrationRevision ? hydrationBaseline : null;
    const data = mergedData(saved, captured);
    await persistence.save(data);
  });
  saveTail = operation.catch(() => undefined);
  return operation;
}

function normalizeSession(session: AgentSession): AgentSession {
  return {
    ...session,
    trace: session.trace ?? [],
    evidenceRefs: session.evidenceRefs ?? [],
    approvalRequestIds: session.approvalRequestIds ?? [],
    pendingApprovals: session.pendingApprovals ?? [],
    compactions: session.compactions ?? [],
  };
}

function hasUnfinishedWork(session: AgentSession): boolean {
  if (['queued', 'running', 'waiting_approval'].includes(session.status)) return true;
  if (session.approvalRequestIds.length || session.pendingApprovals.some(approval =>
    ['pending', 'approved', 'executing'].includes(approval.status))) return true;
  const reading = session.documentResearch;
  const directory = reading?.directory;
  if (directory && (!directory.manifest?.complete || directory.phase !== 'ready'
    || directory.files.some(file => file.status !== 'complete'))) return true;
  if (reading && (reading.status !== 'ready' || session.status !== 'completed')) return true;
  return Boolean(session.executionContinuation && session.status !== 'completed');
}

function sortSessions(sessions: AgentSession[]): AgentSession[] {
  let archivedCount = 0;
  return [...sessions]
    .map(normalizeSession)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    // A checkpoint or pending approval is user work, not disposable history.
    // Apply the history limit only to terminal sessions with no continuation.
    .filter(session => hasUnfinishedWork(session) || archivedCount++ < MAX_ARCHIVED_SESSIONS);
}

function persistSessions() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      // Hydration may have added historical tasks since this debounce was scheduled.
      await persistNow(useAgentSessionStore.getState());
    } catch (error) {
      console.error('Failed to save agent sessions:', error);
    }
  }, 500);
}

function replaceSession(
  sessions: AgentSession[],
  sessionId: string,
  updater: (session: AgentSession) => AgentSession,
): AgentSession[] {
  let found = false;
  const next = sessions.map((session) => {
    if (session.id !== sessionId) {
      return session;
    }
    found = true;
    return updater(session);
  });

  if (!found) {
    throw new Error(`Agent session not found: ${sessionId}`);
  }

  return sortSessions(next);
}

export const useAgentSessionStore = create<AgentSessionState & AgentSessionActions>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  focusTarget: null,
  resumeExecutionSynthesisSession: (sessionId) => {
    const current = get().getSession(sessionId);
    const failure = current?.trace.slice().reverse().find((event) => event.metadata?.errorStage);
    if (current?.status !== 'failed' || !current.executionContinuation?.synthesisContext ||
      failure?.metadata?.errorStage !== 'synthesis.answer' || current.pendingApprovals.some((approval) => approval.status !== 'completed')) {
      throw new Error('This execution session cannot resume final synthesis.');
    }
    set((state) => ({ sessions: replaceSession(state.sessions, sessionId, (session) => ({ ...session, status: 'running', error: undefined, completedAt: undefined, updatedAt: Date.now() })), activeSessionId: sessionId }));
    persistSessions();
  },
  saveExecutionContinuation: async (sessionId, executionContinuation) => {
    set((state) => ({ sessions: replaceSession(state.sessions, sessionId, (session) => ({ ...session, executionContinuation, updatedAt: Date.now() })) }));
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    await persistNow(get());
  },
  saveDocumentResearch: async (sessionId, documentResearch) => {
    set((state) => ({ sessions: replaceSession(state.sessions, sessionId, (session) => ({ ...session, documentResearch, updatedAt: Date.now() })) }));
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    try {
      await persistNow(get());
    } catch (error) {
      const message = '无法保存阅读进度，请检查可用存储空间后重试。当前窗口仍保留已读进度。';
      set((state) => ({ sessions: replaceSession(state.sessions, sessionId, (session) => ({ ...session,
        documentResearch: { ...documentResearch, status: 'failed', error: message },
      })) }));
      throw new Error(message, { cause: error });
    }
  },
  resumeDocumentSession: (sessionId) => {
    const current = get().getSession(sessionId);
    if (!current?.documentResearch || current.pendingApprovals.some(item => item.status === 'pending' || item.status === 'executing')) throw new Error('This task cannot resume document reading yet.');
    set((state) => ({ sessions: replaceSession(state.sessions, sessionId, (session) => ({ ...session, status: 'running', completedAt: undefined, error: undefined,
      documentResearch: { ...session.documentResearch!, status: 'reading', error: undefined }, updatedAt: Date.now() })), activeSessionId: sessionId }));
    persistSessions();
  },

  createSession: (input) => {
    persistenceContext();
    if (input.id) deletedSessionIds.delete(input.id);
    const session = createAgentSession(input);
    set((state) => ({
      sessions: sortSessions([session, ...state.sessions]),
      activeSessionId: session.id,
    }));
    persistSessions();
    return session.id;
  },

  setActiveSession: (sessionId) => {
    set({ activeSessionId: sessionId });
    persistSessions();
  },

  focusSession: (sessionId, target) => {
    set({
      activeSessionId: sessionId,
      focusTarget: target,
    });
    persistSessions();
  },

  consumeFocusTarget: (target) => {
    set((state) => ({
      focusTarget: state.focusTarget === target ? null : state.focusTarget,
    }));
  },

  appendTrace: (sessionId, event) => {
    set((state) => ({
      sessions: replaceSession(
        state.sessions,
        sessionId,
        (session) => appendAgentTraceEvent(session, event),
      ),
      activeSessionId: sessionId,
    }));
    persistSessions();
  },

  addMemorySnapshotIds: (sessionId, memoryIds, now) => {
    set((state) => ({
      sessions: replaceSession(
        state.sessions,
        sessionId,
        (session) => addAgentSessionMemorySnapshotIds(session, memoryIds, now),
      ),
      activeSessionId: sessionId,
    }));
    persistSessions();
  },

  addPendingApproval: (sessionId, approval) => {
    set((state) => ({
      sessions: replaceSession(
        state.sessions,
        sessionId,
        (session) => addAgentPendingApproval(session, approval),
      ),
      activeSessionId: sessionId,
    }));
    persistSessions();
  },

  resolvePendingApproval: (sessionId, approval) => {
    set((state) => ({
      sessions: replaceSession(
        state.sessions,
        sessionId,
        (session) => resolveAgentPendingApproval(session, approval),
      ),
      activeSessionId: sessionId,
    }));
    persistSessions();
  },

  resumeSession: (sessionId, resolvedApprovalIds) => {
    set((state) => ({
      sessions: replaceSession(
        state.sessions,
        sessionId,
        (session) => resumeAgentSession(session, { resolvedApprovalIds }),
      ),
      activeSessionId: sessionId,
    }));
    persistSessions();
  },

  completeSession: (sessionId, result) => {
    set((state) => ({
      sessions: replaceSession(
        state.sessions,
        sessionId,
        (session) => completeAgentSession(session, result),
      ),
      activeSessionId: sessionId,
    }));
    persistSessions();
  },

  failSession: (sessionId, error) => {
    set((state) => ({
      sessions: replaceSession(
        state.sessions,
        sessionId,
        (session) => failAgentSession(session, error),
      ),
      activeSessionId: sessionId,
    }));
    persistSessions();
  },

  cancelSession: (sessionId, reason) => {
    set((state) => ({
      sessions: replaceSession(
        state.sessions,
        sessionId,
        (session) => cancelAgentSession(session, reason),
      ),
      activeSessionId: sessionId,
    }));
    persistSessions();
  },

  compactSession: (sessionId, input) => {
    set((state) => ({
      sessions: replaceSession(
        state.sessions,
        sessionId,
        (session) => compactAgentSession(session, input),
      ),
      activeSessionId: sessionId,
    }));
    persistSessions();
  },

  deleteSession: (sessionId) => {
    persistenceContext();
    // A load already in flight may still contain this id.
    deletedSessionIds.add(sessionId);
    set((state) => {
      const sessions = state.sessions.filter((session) => session.id !== sessionId);
      return {
        sessions,
        activeSessionId: state.activeSessionId === sessionId
          ? sessions[0]?.id ?? null
          : state.activeSessionId,
      };
    });
    persistSessions();
  },

  getSession: (sessionId) =>
    get().sessions.find((session) => session.id === sessionId) ?? null,

  getActiveSession: () => {
    const { activeSessionId, sessions } = get();
    return sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null;
  },

  getPendingApproval: (approvalId) => {
    for (const session of get().sessions) {
      const approval = (session.pendingApprovals ?? []).find((item) => item.id === approvalId);
      if (approval) {
        return { session, approval };
      }
    }
    return null;
  },

  loadSessions: async () => {
    try {
      await hydrate(persistenceContext(), true);
    } catch (error) {
      console.error('Failed to load agent sessions:', error);
    }
  },
}));
