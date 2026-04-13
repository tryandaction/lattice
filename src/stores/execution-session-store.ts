"use client";

import { create } from "zustand";
import { mergeExecutionProblems } from "@/lib/runner/problem-utils";
import type {
  ExecutionCommandState,
  ExecutionLifecyclePhase,
  ExecutionProblem,
  ExecutionRunSummary,
  ExecutionSessionProblems,
  ExecutionSessionScope,
  ExecutionSessionState,
  ExecutionSessionRuntimeState,
  NotebookExecutionSnapshot,
  RunnerCapabilityModel,
  RunnerHealthSnapshot,
  RunnerStatus,
} from "@/lib/runner/types";

type ExecutionScopeCleanup = () => void | Promise<void>;

interface ExecutionSessionStoreState {
  sessions: Record<string, ExecutionSessionState>;
  setSession: (scopeId: string, session: ExecutionSessionState) => void;
  updateSession: (
    scopeId: string,
    updater: (current: ExecutionSessionState | null) => ExecutionSessionState | null,
  ) => void;
  removeSession: (scopeId: string) => void;
}

const cleanupRegistry = new Map<string, Set<ExecutionScopeCleanup>>();

const EMPTY_SUMMARY: ExecutionRunSummary = {
  sessionId: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
  exitCode: null,
  terminated: false,
};

const EMPTY_NOTEBOOK_STATE: NotebookExecutionSnapshot = {
  executionState: "idle",
  currentCellId: null,
  progress: {
    current: 0,
    total: 0,
  },
  cells: {},
};

const EMPTY_RUNTIME_STATE: ExecutionSessionRuntimeState = {
  status: "idle",
  availability: null,
  error: null,
  hasValidatedRuntime: false,
  kernelId: null,
  kernelLabel: null,
  kernelDescription: null,
  kernelSelectionSource: null,
  kernelSourceLabel: null,
  runnerType: null,
  command: null,
  cwd: undefined,
  args: undefined,
};

const EMPTY_COMMAND_STATE: ExecutionCommandState = {
  canRun: false,
  canRerun: false,
  canStop: false,
  canInterrupt: false,
  canRestart: false,
  canVerifyRuntime: false,
  canSelectRuntime: false,
};

const EMPTY_PROBLEM_SOURCES: ExecutionSessionProblems = {
  runtime: [],
  health: [],
  external: [],
};

function createDefaultCapability(kind: ExecutionSessionScope["kind"]): RunnerCapabilityModel {
  return {
    supportsSelection: kind === "code",
    supportsPersistentSession: kind === "notebook",
    supportsNotebook: kind === "notebook",
    supportsLocalExecution: true,
    supportsPyodide: kind === "notebook",
    canRun: false,
    canStop: false,
    canInterrupt: kind === "notebook",
    canRestart: kind === "notebook",
  };
}

function createDefaultSession(scope: ExecutionSessionScope): ExecutionSessionState {
  return {
    ...scope,
    lifecyclePhase: "idle",
    failureStage: null,
    activeRunId: null,
    lastCompletedRunId: null,
    status: "idle",
    runtime: {
      ...EMPTY_RUNTIME_STATE,
    },
    summary: {
      ...EMPTY_SUMMARY,
    },
    panelMeta: {
      origin: null,
      diagnostics: [],
      context: null,
    },
    outputs: [],
    lastRequest: null,
    problems: [],
    problemSources: {
      ...EMPTY_PROBLEM_SOURCES,
    },
    healthSnapshot: null,
    commandState: {
      ...EMPTY_COMMAND_STATE,
    },
    capability: createDefaultCapability(scope.kind),
    notebook: scope.kind === "notebook"
      ? {
          ...EMPTY_NOTEBOOK_STATE,
          progress: { ...EMPTY_NOTEBOOK_STATE.progress },
          cells: {},
        }
      : null,
    lastEvent: null,
  };
}

export function createExecutionSessionFallback(scope: ExecutionSessionScope): ExecutionSessionState {
  return createDefaultSession(scope);
}

function mergeProblemSources(problemSources: ExecutionSessionProblems): ExecutionProblem[] {
  return mergeExecutionProblems(
    problemSources.runtime,
    problemSources.health,
    problemSources.external,
  );
}

export const useExecutionSessionStore = create<ExecutionSessionStoreState>((set) => ({
  sessions: {},
  setSession: (scopeId, session) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [scopeId]: session,
      },
    })),
  updateSession: (scopeId, updater) =>
    set((state) => {
      const current = state.sessions[scopeId] ?? null;
      const next = updater(current);
      if (next === current) {
        return state;
      }
      if (!next) {
        if (!(scopeId in state.sessions)) {
          return state;
        }
        const sessions = { ...state.sessions };
        delete sessions[scopeId];
        return { sessions };
      }
      return {
        sessions: {
          ...state.sessions,
          [scopeId]: next,
        },
      };
    }),
  removeSession: (scopeId) =>
    set((state) => {
      if (!(scopeId in state.sessions)) {
        return state;
      }
      const sessions = { ...state.sessions };
      delete sessions[scopeId];
      return { sessions };
    }),
}));

export function getExecutionSession(scopeId: string): ExecutionSessionState | null {
  return useExecutionSessionStore.getState().sessions[scopeId] ?? null;
}

export function listExecutionSessions(): ExecutionSessionState[] {
  return Object.values(useExecutionSessionStore.getState().sessions);
}

export function ensureExecutionSession(
  scope: ExecutionSessionScope,
  patch?: Partial<ExecutionSessionState>,
): ExecutionSessionState {
  let ensured: ExecutionSessionState | null = null;
  useExecutionSessionStore.getState().updateSession(scope.scopeId, (current) => {
    const base = current
      ? {
          ...current,
          ...scope,
        }
      : createDefaultSession(scope);
    ensured = patch ? { ...base, ...patch } : base;
    return ensured;
  });
  return ensured ?? createDefaultSession(scope);
}

export function patchExecutionSession(
  scopeId: string,
  updater: (current: ExecutionSessionState) => ExecutionSessionState,
): void {
  useExecutionSessionStore.getState().updateSession(scopeId, (current) => {
    if (!current) {
      return null;
    }
    return updater(current);
  });
}

export function updateExecutionProblemSources(
  scopeId: string,
  partialSources: Partial<ExecutionSessionProblems>,
): void {
  patchExecutionSession(scopeId, (current) => {
    const problemSources = {
      ...current.problemSources,
      ...partialSources,
    };
    return {
      ...current,
      problemSources,
      problems: mergeProblemSources(problemSources),
    };
  });
}

export function setExecutionHealthSnapshot(
  scopeId: string,
  snapshot: RunnerHealthSnapshot | null,
  problems: ExecutionProblem[],
): void {
  patchExecutionSession(scopeId, (current) => {
    const problemSources = {
      ...current.problemSources,
      health: problems,
    };
    return {
      ...current,
      healthSnapshot: snapshot,
      problemSources,
      problems: mergeProblemSources(problemSources),
    };
  });
}

export function resetExecutionFeedback(scopeId: string): void {
  patchExecutionSession(scopeId, (current) => ({
    ...current,
    outputs: [],
    panelMeta: {
      ...current.panelMeta,
      diagnostics: [],
    },
    summary: {
      ...EMPTY_SUMMARY,
    },
    failureStage: null,
    lastEvent: null,
    problemSources: {
      ...current.problemSources,
      runtime: [],
    },
    problems: mergeProblemSources({
      ...current.problemSources,
      runtime: [],
    }),
  }));
}

export function setNotebookCellSessionState(
  scopeId: string,
  cellId: string,
  patch: Partial<NonNullable<ExecutionSessionState["notebook"]>["cells"][string]>,
): void {
  patchExecutionSession(scopeId, (current) => {
    if (!current.notebook) {
      return current;
    }
    return {
      ...current,
      notebook: {
        ...current.notebook,
        cells: {
          ...current.notebook.cells,
          [cellId]: {
            ...(current.notebook.cells[cellId] ?? {
              outputs: [],
              executionCount: null,
              panelMeta: null,
            }),
            ...patch,
          },
        },
      },
    };
  });
}

export function clearNotebookCellSessionState(scopeId: string, cellId: string): void {
  setNotebookCellSessionState(scopeId, cellId, {
    outputs: [],
    executionCount: null,
    panelMeta: null,
  });
}

export function registerExecutionScopeCleanup(scopeId: string, cleanup: ExecutionScopeCleanup): () => void {
  const current = cleanupRegistry.get(scopeId) ?? new Set<ExecutionScopeCleanup>();
  current.add(cleanup);
  cleanupRegistry.set(scopeId, current);
  return () => {
    const scopeCleanups = cleanupRegistry.get(scopeId);
    if (!scopeCleanups) {
      return;
    }
    scopeCleanups.delete(cleanup);
    if (scopeCleanups.size === 0) {
      cleanupRegistry.delete(scopeId);
    }
  };
}

export async function destroyExecutionScope(scopeId: string): Promise<void> {
  const cleanups = Array.from(cleanupRegistry.get(scopeId) ?? []);
  cleanupRegistry.delete(scopeId);
  for (const cleanup of cleanups) {
    await cleanup();
  }
  useExecutionSessionStore.getState().removeSession(scopeId);
}

export async function destroyExecutionScopes(scopeIds: string[]): Promise<void> {
  for (const scopeId of scopeIds) {
    await destroyExecutionScope(scopeId);
  }
}

export function setExecutionLifecycle(
  scopeId: string,
  lifecyclePhase: ExecutionLifecyclePhase,
  status?: RunnerStatus,
): void {
  patchExecutionSession(scopeId, (current) => ({
    ...current,
    lifecyclePhase,
    status: status ?? current.status,
  }));
}

/**
 * Granular selector: subscribe to a single scope's session.
 * Components using this will only re-render when their specific session changes,
 * not when any session in the store changes.
 */
export function useExecutionSession(scopeId: string): ExecutionSessionState | null {
  return useExecutionSessionStore(
    (state) => state.sessions[scopeId] ?? null,
  );
}
