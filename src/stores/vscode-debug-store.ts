"use client";

import { create } from "zustand";
import {
  continueDebugSession,
  evaluateDebugExpression,
  getDebugScopes,
  getDebugStackTrace,
  getDebugThreads,
  getDebugVariables,
  listenDebugEvents,
  pauseDebugSession,
  restartDebugSession,
  setDebugBreakpoints,
  startNodeDebugSession,
  startPythonDebugSession,
  stepIntoDebugSession,
  stepOutDebugSession,
  stepOverDebugSession,
  stopDebugSession,
  type DebugEventEnvelope,
  type DebugEvaluateResponse,
  type DebugLifecycle,
  type DebugScope,
  type DebugSourceBreakpoint,
  type DebugStackFrame,
  type DebugThread,
  type DebugVariable,
  type DebugLaunchRequest,
} from "@/lib/vscode-debug/desktop";
import { normalizeDebugSourcePath } from "@/lib/vscode-debug/paths";

const OUTPUT_LIMIT = 1_000;
const START_EVENT_BUFFER_LIMIT = 128;
const BREAKPOINTS_STORAGE_PREFIX = "lattice-vscode-debug-breakpoints:";

export interface DebugOutputEntry {
  category: string;
  output: string;
}

interface VSCodeDebugState {
  workspaceKey: string | null;
  sessionId: string | null;
  sessionName: string | null;
  lifecycle: DebugLifecycle;
  breakpoints: Record<string, DebugSourceBreakpoint[]>;
  threads: DebugThread[];
  stackFrames: DebugStackFrame[];
  selectedThreadId: number | null;
  selectedFrameId: number | null;
  scopes: DebugScope[];
  variablesByReference: Record<number, DebugVariable[]>;
  output: DebugOutputEntry[];
  stopReason: string | null;
  error: string | null;
  pendingStartEvents: DebugEventEnvelope[];
  loadBreakpoints: (workspaceKey: string | null) => void;
  toggleBreakpoint: (path: string, line: number) => void;
  applyEvent: (event: DebugEventEnvelope) => void;
  startDebugging: (request: DebugLaunchRequest) => Promise<void>;
  stopDebugging: () => Promise<void>;
  continueExecution: () => Promise<void>;
  pauseExecution: () => Promise<void>;
  stepOver: () => Promise<void>;
  stepInto: () => Promise<void>;
  stepOut: () => Promise<void>;
  restartDebugging: () => Promise<void>;
  evaluate: (expression: string) => Promise<DebugEvaluateResponse | null>;
  hydrateStoppedState: (threadId?: number | null) => Promise<void>;
  selectFrame: (frameId: number) => Promise<void>;
  loadVariables: (variablesReference: number) => Promise<void>;
  initializeEventListener: () => Promise<() => void>;
  clearOutput: () => void;
  reset: () => void;
}

const SESSION_STATE = {
  sessionId: null,
  sessionName: null,
  lifecycle: "idle" as DebugLifecycle,
  threads: [] as DebugThread[],
  stackFrames: [] as DebugStackFrame[],
  selectedThreadId: null,
  selectedFrameId: null,
  scopes: [] as DebugScope[],
  variablesByReference: {} as Record<number, DebugVariable[]>,
  output: [] as DebugOutputEntry[],
  stopReason: null,
  error: null,
  pendingStartEvents: [] as DebugEventEnvelope[],
};

function breakpointStorageKey(workspaceKey: string): string {
  return `${BREAKPOINTS_STORAGE_PREFIX}${workspaceKey}`;
}

function readBreakpoints(workspaceKey: string | null): Record<string, DebugSourceBreakpoint[]> {
  if (!workspaceKey || typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(breakpointStorageKey(workspaceKey)) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, DebugSourceBreakpoint[]> = {};
    for (const [rawPath, rawBreakpoints] of Object.entries(parsed)) {
      if (!Array.isArray(rawBreakpoints)) continue;
      const pathKey = normalizeDebugSourcePath(rawPath);
      const breakpoints = rawBreakpoints
        .filter((item): item is { line: number; path?: string } => Boolean(
          item && typeof item === "object" && Number.isInteger((item as { line?: unknown }).line)
            && ((item as { line: number }).line > 0),
        ))
        .map((item) => ({
          path: typeof item.path === "string" ? item.path.replace(/\\/g, "/") : rawPath.replace(/\\/g, "/"),
          line: item.line,
          verified: false,
        }))
        .sort((left, right) => left.line - right.line);
      if (breakpoints.length > 0) result[pathKey] = breakpoints;
    }
    return result;
  } catch {
    return {};
  }
}

function persistBreakpoints(
  workspaceKey: string | null,
  breakpoints: Record<string, DebugSourceBreakpoint[]>,
): void {
  if (!workspaceKey || typeof window === "undefined") return;
  localStorage.setItem(breakpointStorageKey(workspaceKey), JSON.stringify(breakpoints));
}

function bodyRecord(event: DebugEventEnvelope): Record<string, unknown> {
  return event.body && typeof event.body === "object" ? event.body : {};
}

export const useVSCodeDebugStore = create<VSCodeDebugState>((set, get) => ({
  workspaceKey: null,
  breakpoints: {},
  ...SESSION_STATE,

  loadBreakpoints: (workspaceKey) => set({
    workspaceKey,
    breakpoints: readBreakpoints(workspaceKey),
  }),

  toggleBreakpoint: (rawPath, line) => {
    if (!Number.isInteger(line) || line <= 0) return;
    const sourcePath = rawPath.replace(/\\/g, "/");
    const pathKey = normalizeDebugSourcePath(sourcePath);
    const current = get().breakpoints[pathKey] ?? [];
    const exists = current.some((breakpoint) => breakpoint.line === line);
    const nextForPath = exists
      ? current.filter((breakpoint) => breakpoint.line !== line)
      : [...current, { path: sourcePath, line, verified: false }].sort((left, right) => left.line - right.line);
    const breakpoints = { ...get().breakpoints };
    if (nextForPath.length > 0) breakpoints[pathKey] = nextForPath;
    else delete breakpoints[pathKey];
    set({ breakpoints });
    persistBreakpoints(get().workspaceKey, breakpoints);

    const sessionId = get().sessionId;
    if (!sessionId) return;
    const requestedLines = nextForPath.map((breakpoint) => breakpoint.line);
    void setDebugBreakpoints(sessionId, sourcePath, requestedLines)
      .then((response) => {
        if (get().sessionId !== sessionId) return;
        const latest = get().breakpoints[pathKey] ?? [];
        if (latest.map((breakpoint) => breakpoint.line).join(",") !== requestedLines.join(",")) return;
        const updates = response.breakpoints ?? [];
        set({
          breakpoints: {
            ...get().breakpoints,
            ...(latest.length > 0 ? {
              [pathKey]: latest.map((breakpoint, index) => {
                const update = updates.find((item) => item.line === breakpoint.line) ?? updates[index];
                return {
                  ...breakpoint,
                  verified: update?.verified === true,
                  ...(typeof update?.id === "number" ? { id: update.id } : {}),
                  ...(typeof update?.message === "string" ? { message: update.message } : {}),
                };
              }),
            } : {}),
          },
        });
      })
      .catch((error) => {
        if (get().sessionId === sessionId) {
          set({ error: error instanceof Error ? error.message : String(error) });
        }
      });
  },

  applyEvent: (event) => {
    if (!get().sessionId) {
      if (get().lifecycle === "starting") {
        set({
          pendingStartEvents: [...get().pendingStartEvents, event].slice(-START_EVENT_BUFFER_LIMIT),
        });
      }
      return;
    }
    if (event.sessionId !== get().sessionId) return;
    const body = bodyRecord(event);
    if (event.event === "output") {
      const entry: DebugOutputEntry = {
        category: typeof body.category === "string" ? body.category : "console",
        output: typeof body.output === "string" ? body.output : "",
      };
      set({ output: [...get().output, entry].slice(-OUTPUT_LIMIT) });
      return;
    }
    if (event.event === "stopped") {
      set({
        lifecycle: "stopped",
        selectedThreadId: typeof body.threadId === "number" ? body.threadId : null,
        stopReason: typeof body.reason === "string" ? body.reason : "paused",
        error: null,
      });
      return;
    }
    if (event.event === "continued") {
      set({
        lifecycle: "running",
        stackFrames: [],
        selectedFrameId: null,
        scopes: [],
        variablesByReference: {},
        stopReason: null,
      });
      return;
    }
    if (event.event === "terminated" || event.event === "exited") {
      set({
        lifecycle: "terminated",
        threads: [],
        stackFrames: [],
        selectedThreadId: null,
        selectedFrameId: null,
        scopes: [],
        variablesByReference: {},
        stopReason: null,
      });
      return;
    }
    if (event.event === "breakpoints") {
      const source = body.source as { path?: unknown } | undefined;
      const path = typeof source?.path === "string" ? normalizeDebugSourcePath(source.path) : null;
      const updates = Array.isArray(body.breakpoints) ? body.breakpoints : [];
      if (!path || !get().breakpoints[path]) return;
      set({
        breakpoints: {
          ...get().breakpoints,
          [path]: get().breakpoints[path]!.map((breakpoint, index) => {
            const update = updates[index] as Record<string, unknown> | undefined;
            return {
              ...breakpoint,
              verified: update?.verified === true,
              ...(typeof update?.id === "number" ? { id: update.id } : {}),
              ...(typeof update?.message === "string" ? { message: update.message } : {}),
            };
          }),
        },
      });
    }
  },

  startDebugging: async (request) => {
    set({ ...SESSION_STATE, lifecycle: "starting" });
    try {
      const snapshot = request.kind === "node"
        ? await startNodeDebugSession(request)
        : await startPythonDebugSession(request);
      const pendingStartEvents = get().pendingStartEvents
        .filter((event) => event.sessionId === snapshot.sessionId);
      set({
        sessionId: snapshot.sessionId,
        sessionName: snapshot.name,
        lifecycle: snapshot.lifecycle,
        error: null,
        pendingStartEvents: [],
      });
      for (const event of pendingStartEvents) get().applyEvent(event);
    } catch (error) {
      set({
        lifecycle: "error",
        error: error instanceof Error ? error.message : String(error),
        pendingStartEvents: [],
      });
      throw error;
    }
  },

  stopDebugging: async () => {
    const sessionId = get().sessionId;
    if (!sessionId) return;
    set({ lifecycle: "stopping", error: null });
    try {
      await stopDebugSession(sessionId);
      set({ lifecycle: "terminated" });
    } catch (error) {
      set({ lifecycle: "error", error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  continueExecution: async () => {
    const { sessionId, selectedThreadId } = get();
    if (!sessionId || selectedThreadId === null) return;
    try {
      await continueDebugSession(sessionId, selectedThreadId);
      if (get().sessionId === sessionId) {
        set({
          lifecycle: "running",
          stackFrames: [],
          selectedFrameId: null,
          scopes: [],
          variablesByReference: {},
          stopReason: null,
          error: null,
        });
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  pauseExecution: async () => {
    const { sessionId, selectedThreadId } = get();
    if (!sessionId) return;
    try {
      await pauseDebugSession(sessionId, selectedThreadId ?? 0);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  stepOver: async () => {
    const { sessionId, selectedThreadId } = get();
    if (!sessionId || selectedThreadId === null) return;
    await stepOverDebugSession(sessionId, selectedThreadId);
    if (get().sessionId === sessionId) {
      set({ lifecycle: "running", stackFrames: [], scopes: [], variablesByReference: {} });
    }
  },

  stepInto: async () => {
    const { sessionId, selectedThreadId } = get();
    if (!sessionId || selectedThreadId === null) return;
    await stepIntoDebugSession(sessionId, selectedThreadId);
    if (get().sessionId === sessionId) {
      set({ lifecycle: "running", stackFrames: [], scopes: [], variablesByReference: {} });
    }
  },

  stepOut: async () => {
    const { sessionId, selectedThreadId } = get();
    if (!sessionId || selectedThreadId === null) return;
    await stepOutDebugSession(sessionId, selectedThreadId);
    if (get().sessionId === sessionId) {
      set({ lifecycle: "running", stackFrames: [], scopes: [], variablesByReference: {} });
    }
  },

  restartDebugging: async () => {
    const sessionId = get().sessionId;
    if (!sessionId) return;
    set({ lifecycle: "restarting", error: null });
    try {
      await restartDebugSession(sessionId);
      if (get().sessionId === sessionId) {
        set({
          lifecycle: "running",
          threads: [],
          stackFrames: [],
          selectedThreadId: null,
          selectedFrameId: null,
          scopes: [],
          variablesByReference: {},
          stopReason: null,
        });
      }
    } catch (error) {
      set({ lifecycle: "error", error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  evaluate: async (expression) => {
    const { sessionId, selectedFrameId, lifecycle } = get();
    if (!sessionId || lifecycle !== "stopped" || !expression.trim()) return null;
    try {
      const result = await evaluateDebugExpression(
        sessionId,
        expression.trim(),
        selectedFrameId ?? undefined,
        "watch",
      );
      if (get().sessionId === sessionId) {
        set({
          output: [...get().output, {
            category: "console",
            output: `> ${expression.trim()}\n${result.result}\n`,
          }].slice(-OUTPUT_LIMIT),
          error: null,
        });
      }
      return result;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  hydrateStoppedState: async (preferredThreadId = null) => {
    const sessionId = get().sessionId;
    if (!sessionId || get().lifecycle !== "stopped") return;
    try {
      const threadResult = await getDebugThreads(sessionId);
      if (get().sessionId !== sessionId) return;
      const threadId = preferredThreadId
        ?? get().selectedThreadId
        ?? threadResult.threads[0]?.id
        ?? null;
      if (threadId === null) {
        set({ threads: threadResult.threads, stackFrames: [], scopes: [] });
        return;
      }
      const stackResult = await getDebugStackTrace(sessionId, threadId);
      if (get().sessionId !== sessionId) return;
      const frame = stackResult.stackFrames[0] ?? null;
      const scopeResult = frame ? await getDebugScopes(sessionId, frame.id) : { scopes: [] };
      if (get().sessionId !== sessionId) return;
      set({
        threads: threadResult.threads,
        selectedThreadId: threadId,
        stackFrames: stackResult.stackFrames,
        selectedFrameId: frame?.id ?? null,
        scopes: scopeResult.scopes,
        variablesByReference: {},
        error: null,
      });
    } catch (error) {
      if (get().sessionId === sessionId) {
        set({ error: error instanceof Error ? error.message : String(error) });
      }
    }
  },

  selectFrame: async (frameId) => {
    const sessionId = get().sessionId;
    if (!sessionId || get().lifecycle !== "stopped") return;
    try {
      const result = await getDebugScopes(sessionId, frameId);
      if (get().sessionId === sessionId) {
        set({ selectedFrameId: frameId, scopes: result.scopes, variablesByReference: {} });
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  loadVariables: async (variablesReference) => {
    if (variablesReference <= 0 || Object.hasOwn(get().variablesByReference, variablesReference)) return;
    const sessionId = get().sessionId;
    if (!sessionId || get().lifecycle !== "stopped") return;
    try {
      const result = await getDebugVariables(sessionId, variablesReference);
      if (get().sessionId === sessionId) {
        set({
          variablesByReference: {
            ...get().variablesByReference,
            [variablesReference]: result.variables,
          },
        });
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  initializeEventListener: async () => listenDebugEvents((event) => get().applyEvent(event)),
  clearOutput: () => set({ output: [] }),
  reset: () => set({ workspaceKey: null, breakpoints: {}, ...SESSION_STATE }),
}));
