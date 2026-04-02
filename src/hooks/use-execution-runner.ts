"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  runnerEventToTextOutputs,
} from "@/lib/runner/runner-manager";
import { ensureCodeRuntimeResource, getCodeRuntimeResource } from "@/lib/runner/execution-runtime-registry";
import { diagnosticsToExecutionProblems, outputsToExecutionProblems } from "@/lib/runner/problem-utils";
import {
  createExecutionSessionFallback,
  ensureExecutionSession,
  getExecutionSession,
  patchExecutionSession,
  resetExecutionFeedback,
  updateExecutionProblemSources,
  useExecutionSessionStore,
} from "@/stores/execution-session-store";
import type {
  ExecutionCommandState,
  ExecutionDiagnostic,
  ExecutionFailureStage,
  ExecutionLifecyclePhase,
  ExecutionOrigin,
  ExecutionOutput,
  ExecutionPanelMeta,
  ExecutionProblem,
  ExecutionRunResult,
  ExecutionRunSummary,
  ExecutionSessionScope,
  RunnerCapabilityModel,
  RunnerExecutionRequest,
  RunnerStatus,
} from "@/lib/runner/types";

export interface UseExecutionRunnerOptions {
  scope?: ExecutionSessionScope | null;
  capability?: Partial<RunnerCapabilityModel>;
}

export interface UseExecutionRunnerReturn {
  status: RunnerStatus;
  outputs: ExecutionOutput[];
  error: string | null;
  summary: ExecutionRunSummary;
  panelMeta: ExecutionPanelMeta;
  problems: ExecutionProblem[];
  isReady: boolean;
  isRunning: boolean;
  isLoading: boolean;
  run: (request: RunnerExecutionRequest) => Promise<ExecutionRunResult>;
  terminate: () => Promise<void>;
  clearOutputs: () => void;
  setPanelMeta: (meta: ExecutionPanelMeta) => void;
  setDiagnostics: (diagnostics: ExecutionDiagnostic[], origin?: ExecutionOrigin | null) => void;
  setExternalProblems: (problems: ExecutionProblem[]) => void;
  lastRequest: RunnerExecutionRequest | null;
  commandState: ExecutionCommandState;
}

const LOCAL_SCOPE_PREFIX = "__local_code_scope__";
function randomRunId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `code_run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createLocalScope(scopeId: string): ExecutionSessionScope {
  return {
    scopeId,
    kind: "code",
    paneId: scopeId,
    tabId: scopeId,
    filePath: scopeId,
    fileName: "code",
  };
}

function deriveCommandState(session: {
  activeRunId: string | null;
  lastRequest: RunnerExecutionRequest | null;
  capability: RunnerCapabilityModel;
  lifecyclePhase: string;
}): ExecutionCommandState {
  const isBusy = session.lifecyclePhase === "preparing"
    || session.lifecyclePhase === "running"
    || session.lifecyclePhase === "stopping";

  return {
    canRun: session.capability.canRun && !isBusy,
    canRerun: Boolean(session.lastRequest) && !isBusy,
    canStop: session.capability.canStop && isBusy,
    canInterrupt: false,
    canRestart: false,
    canVerifyRuntime: false,
    canSelectRuntime: false,
  };
}

function setCodeFailure(
  scopeId: string,
  stage: ExecutionFailureStage,
  message: string,
): void {
  patchExecutionSession(scopeId, (current) => {
    const diagnostic: ExecutionDiagnostic = {
      severity: "error",
      title: "代码运行失败",
      message,
      stage,
    };
    const runtimeProblems = diagnosticsToExecutionProblems(
      [diagnostic],
      "preflight",
      current.panelMeta.context ?? null,
    );
    const problemSources = {
      ...current.problemSources,
      runtime: runtimeProblems,
    };

    const next = {
      ...current,
      lifecyclePhase: "error" as const,
      failureStage: stage,
      status: "error" as const,
      runtime: {
        ...current.runtime,
        status: "error" as RunnerStatus,
        error: message,
      },
      panelMeta: {
        ...current.panelMeta,
        diagnostics: [diagnostic],
      },
      problemSources,
      problems: [...problemSources.runtime, ...problemSources.health, ...problemSources.external],
      lastEvent: {
        type: "failure" as const,
        timestampMs: Date.now(),
        message,
      },
    };
    return {
      ...next,
      commandState: deriveCommandState({
        activeRunId: next.activeRunId,
        lastRequest: next.lastRequest,
        capability: next.capability,
        lifecyclePhase: next.lifecyclePhase,
      }),
    };
  });
}

function ensureCodeController(scope: ExecutionSessionScope) {
  const controller = ensureCodeRuntimeResource(scope, {
    onStatusChange: (nextStatus, nextError) => {
      patchExecutionSession(scope.scopeId, (current) => {
        const nextLifecycle = nextStatus === "loading"
          ? "preparing"
          : nextStatus === "running"
            ? "running"
            : nextStatus === "error"
              ? "error"
              : nextStatus === "ready"
                ? current.lifecyclePhase === "running" || current.lifecyclePhase === "preparing" || current.lifecyclePhase === "stopping"
                  ? current.summary.terminated
                    ? "interrupted"
                    : "completed"
                  : "ready"
                : current.summary.terminated
                  ? "interrupted"
                  : "idle";

        const next = {
          ...current,
          status: nextStatus,
          lifecyclePhase: nextLifecycle as ExecutionLifecyclePhase,
          runtime: {
            ...current.runtime,
            status: nextStatus,
            error: nextError ?? current.runtime.error,
          },
        };
        return {
          ...next,
          commandState: deriveCommandState({
            activeRunId: next.activeRunId,
            lastRequest: next.lastRequest,
            capability: next.capability,
            lifecyclePhase: next.lifecyclePhase,
          }),
        };
      });
    },
    onEvent: (event) => {
      patchExecutionSession(scope.scopeId, (current) => {
        const nextOutputs = runnerEventToTextOutputs(event);
        const outputs = nextOutputs.length > 0
          ? [...current.outputs, ...nextOutputs]
          : current.outputs;
        const runtimeProblems = outputsToExecutionProblems(outputs, current.panelMeta.context ?? null);
        const summary = { ...current.summary };
        let lifecyclePhase = current.lifecyclePhase;
        let activeRunId = current.activeRunId;
        let lastCompletedRunId = current.lastCompletedRunId;
        let failureStage = current.failureStage;
        let runtimeError = current.runtime.error;

        if (event.type === "started") {
          lifecyclePhase = "running";
          summary.sessionId = event.sessionId;
          summary.startedAt = Date.now();
          summary.completedAt = null;
          summary.durationMs = null;
          summary.exitCode = null;
          summary.terminated = false;
          failureStage = null;
          runtimeError = null;
        }

        if (event.type === "error") {
          failureStage = "execution";
          runtimeError = event.payload.message;
        }

        if (event.type === "completed" || event.type === "terminated") {
          const completedAt = Date.now();
          summary.sessionId = event.sessionId;
          summary.completedAt = completedAt;
          summary.durationMs = summary.startedAt ? completedAt - summary.startedAt : null;
          summary.exitCode = event.payload.exitCode;
          summary.terminated = event.type === "terminated" || Boolean(event.payload.terminated);
          lifecyclePhase = summary.terminated ? "interrupted" : "completed";
          lastCompletedRunId = current.activeRunId;
          activeRunId = null;
        }

        const problemSources = {
          ...current.problemSources,
          runtime: runtimeProblems,
        };
        const next = {
          ...current,
          outputs,
          summary,
          lifecyclePhase,
          activeRunId,
          lastCompletedRunId,
          failureStage,
          runtime: {
            ...current.runtime,
            error: runtimeError,
          },
          problemSources,
          problems: [
            ...problemSources.runtime,
            ...problemSources.health,
            ...problemSources.external,
          ],
          lastEvent: {
            type: event.type,
            timestampMs: Date.now(),
            message: event.type === "error" ? event.payload.message : null,
          },
        };
        return {
          ...next,
          commandState: deriveCommandState({
            activeRunId: next.activeRunId,
            lastRequest: next.lastRequest,
            capability: next.capability,
            lifecyclePhase: next.lifecyclePhase,
          }),
        };
      });
    },
  });

  ensureExecutionSession(scope, {
    commandState: {
      canRun: true,
      canRerun: false,
      canStop: false,
      canInterrupt: false,
      canRestart: false,
      canVerifyRuntime: false,
      canSelectRuntime: false,
    },
    capability: {
      supportsSelection: true,
      supportsPersistentSession: false,
      supportsNotebook: false,
      supportsLocalExecution: true,
      supportsPyodide: false,
      canRun: true,
      canStop: true,
      canInterrupt: false,
      canRestart: false,
    },
  });
  return controller;
}

export function useExecutionRunner(options: UseExecutionRunnerOptions = {}): UseExecutionRunnerReturn {
  const [localScopeId] = useState(() => `${LOCAL_SCOPE_PREFIX}:${randomRunId()}`);
  const providedScopeId = options.scope?.scopeId;
  const providedScopeKind = options.scope?.kind;
  const providedScopePaneId = options.scope?.paneId;
  const providedScopeTabId = options.scope?.tabId;
  const providedScopeFilePath = options.scope?.filePath;
  const providedScopeFileName = options.scope?.fileName;
  const scope = useMemo(
    () => providedScopeId
      ? {
          scopeId: providedScopeId,
          kind: providedScopeKind!,
          paneId: providedScopePaneId!,
          tabId: providedScopeTabId!,
          filePath: providedScopeFilePath!,
          fileName: providedScopeFileName,
        }
      : createLocalScope(localScopeId),
    [
      localScopeId,
      providedScopeId,
      providedScopeKind,
      providedScopePaneId,
      providedScopeTabId,
      providedScopeFilePath,
      providedScopeFileName,
    ],
  );
  const sessionState = useExecutionSessionStore((state) => state.sessions[scope.scopeId]);
  const fallbackState = useMemo(() => createExecutionSessionFallback(scope), [scope]);
  const current = sessionState ?? fallbackState;

  useEffect(() => {
    ensureCodeController(scope);
  }, [scope]);

  useEffect(() => {
    const capability = {
      ...fallbackState.capability,
      ...options.capability,
    };
    patchExecutionSession(scope.scopeId, (state) => {
      const next = {
        ...state,
        capability,
      };
      return {
        ...next,
        commandState: deriveCommandState({
          activeRunId: next.activeRunId,
          lastRequest: next.lastRequest,
          capability: next.capability,
          lifecyclePhase: next.lifecyclePhase,
        }),
      };
    });
  }, [fallbackState.capability, options.capability, scope.scopeId]);

  const clearOutputs = useCallback(() => {
    resetExecutionFeedback(scope.scopeId);
  }, [scope.scopeId]);

  const run = useCallback(async (request: RunnerExecutionRequest) => {
    const controller = ensureCodeController(scope);
    const currentState = getExecutionSession(scope.scopeId) ?? ensureExecutionSession(scope);
    const isBusy = currentState.lifecyclePhase === "preparing"
      || currentState.lifecyclePhase === "running"
      || currentState.lifecyclePhase === "stopping";

    if (isBusy) {
      setCodeFailure(scope.scopeId, "execution", "当前代码任务仍在运行，已阻止新的执行请求。");
      return {
        sessionId: request.sessionId ?? scope.scopeId,
        success: false,
        exitCode: null,
        terminated: false,
      };
    }

    const activeRunId = randomRunId();
    patchExecutionSession(scope.scopeId, (state) => {
      const next = {
        ...state,
        outputs: [],
        summary: {
          sessionId: null,
          startedAt: null,
          completedAt: null,
          durationMs: null,
          exitCode: null,
          terminated: false,
        },
        lastRequest: request,
        activeRunId,
        failureStage: null,
        lifecyclePhase: (request.runnerType === "python-pyodide" ? "preparing" : "running") as ExecutionLifecyclePhase,
        status: (request.runnerType === "python-pyodide" ? "loading" : "running") as RunnerStatus,
        runtime: {
          ...state.runtime,
          status: (request.runnerType === "python-pyodide" ? "loading" : "running") as RunnerStatus,
          error: null,
          runnerType: request.runnerType,
          command: request.command ?? null,
          cwd: request.cwd,
          args: request.args,
        },
        lastEvent: null,
        problemSources: {
          ...state.problemSources,
          runtime: [],
        },
        problems: [...state.problemSources.health, ...state.problemSources.external],
      };
      return {
        ...next,
        commandState: deriveCommandState({
          activeRunId: next.activeRunId,
          lastRequest: next.lastRequest,
          capability: next.capability,
          lifecyclePhase: next.lifecyclePhase,
        }),
      };
    });

    try {
      return await controller.session.run(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCodeFailure(scope.scopeId, "session-start", message);
      return {
        sessionId: request.sessionId ?? scope.scopeId,
        success: false,
        exitCode: null,
        terminated: false,
      };
    }
  }, [scope]);

  const terminate = useCallback(async () => {
    const controller = getCodeRuntimeResource(scope.scopeId) ?? ensureCodeController(scope);
    patchExecutionSession(scope.scopeId, (state) => {
      const next = {
        ...state,
        lifecyclePhase: "stopping" as const,
      };
      return {
        ...next,
        commandState: deriveCommandState({
          activeRunId: next.activeRunId,
          lastRequest: next.lastRequest,
          capability: next.capability,
          lifecyclePhase: next.lifecyclePhase,
        }),
      };
    });
    await controller.session.terminate();
  }, [scope]);

  const setPanelMeta = useCallback((meta: ExecutionPanelMeta) => {
    patchExecutionSession(scope.scopeId, (state) => ({
      ...state,
      panelMeta: meta,
      runtime: {
        ...state.runtime,
        runnerType: meta.origin?.runnerType ?? state.runtime.runnerType,
      },
    }));
  }, [scope.scopeId]);

  const setDiagnostics = useCallback((diagnostics: ExecutionDiagnostic[], origin?: ExecutionOrigin | null) => {
    patchExecutionSession(scope.scopeId, (state) => ({
      ...state,
      panelMeta: {
        ...state.panelMeta,
        origin: origin ?? state.panelMeta.origin,
        diagnostics,
      },
    }));
  }, [scope.scopeId]);

  const setExternalProblems = useCallback((problems: ExecutionProblem[]) => {
    updateExecutionProblemSources(scope.scopeId, {
      external: problems,
    });
  }, [scope.scopeId]);

  return {
    status: current.status,
    outputs: current.outputs,
    error: current.runtime.error,
    summary: current.summary,
    panelMeta: current.panelMeta,
    problems: current.problems,
    isReady: current.status === "ready",
    isRunning: current.lifecyclePhase === "running" || current.lifecyclePhase === "stopping",
    isLoading: current.lifecyclePhase === "preparing",
    run,
    terminate,
    clearOutputs,
    setPanelMeta,
    setDiagnostics,
    setExternalProblems,
    lastRequest: current.lastRequest,
    commandState: current.commandState,
  };
}
