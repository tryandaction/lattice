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
import { getStorageAdapter } from '@/lib/storage-adapter';

const AGENT_SESSION_STORAGE_KEY = 'lattice-agent-sessions-v1';
const MAX_PERSISTED_SESSIONS = 40;

interface AgentSessionState {
  sessions: AgentSession[];
  activeSessionId: string | null;
  focusTarget: 'trace' | 'memory' | null;
}

interface AgentSessionActions {
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

function sortSessions(sessions: AgentSession[]): AgentSession[] {
  return [...sessions]
    .map(normalizeSession)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_PERSISTED_SESSIONS);
}

function persistSessions(state: AgentSessionState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const storage = getStorageAdapter();
      await storage.set(AGENT_SESSION_STORAGE_KEY, {
        sessions: sortSessions(state.sessions),
        activeSessionId: state.activeSessionId,
      });
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

  createSession: (input) => {
    const session = createAgentSession(input);
    set((state) => ({
      sessions: sortSessions([session, ...state.sessions]),
      activeSessionId: session.id,
    }));
    persistSessions(get());
    return session.id;
  },

  setActiveSession: (sessionId) => {
    set({ activeSessionId: sessionId });
    persistSessions(get());
  },

  focusSession: (sessionId, target) => {
    set({
      activeSessionId: sessionId,
      focusTarget: target,
    });
    persistSessions(get());
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
    persistSessions(get());
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
    persistSessions(get());
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
    persistSessions(get());
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
    persistSessions(get());
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
    persistSessions(get());
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
    persistSessions(get());
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
    persistSessions(get());
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
    persistSessions(get());
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
    persistSessions(get());
  },

  deleteSession: (sessionId) => {
    set((state) => {
      const sessions = state.sessions.filter((session) => session.id !== sessionId);
      return {
        sessions,
        activeSessionId: state.activeSessionId === sessionId
          ? sessions[0]?.id ?? null
          : state.activeSessionId,
      };
    });
    persistSessions(get());
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
      const storage = getStorageAdapter();
      const saved = await storage.get<AgentSessionState>(AGENT_SESSION_STORAGE_KEY);
      if (!saved) {
        return;
      }

      const sessions = sortSessions(saved.sessions ?? []);
      const activeSessionId = saved.activeSessionId && sessions.some((session) => session.id === saved.activeSessionId)
        ? saved.activeSessionId
        : sessions[0]?.id ?? null;

      set({
        sessions,
        activeSessionId,
        focusTarget: null,
      });
    } catch (error) {
      console.error('Failed to load agent sessions:', error);
    }
  },
}));
