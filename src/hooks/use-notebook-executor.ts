"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { runnerManager, type PersistentPythonSession } from "@/lib/runner/runner-manager";
import {
  ensureNotebookRuntimeResource,
  getNotebookRuntimeResource,
} from "@/lib/runner/execution-runtime-registry";
import type { JupyterOutput } from "@/lib/notebook-utils";
import { getExecutionOrigin } from "@/lib/runner/preferences";
import type {
  ExecutionCommandState,
  ExecutionDiagnostic,
  ExecutionFailureStage,
  ExecutionPanelMeta,
  ExecutionProblem,
  ExecutionSessionScope,
  RunnerEvent,
  RunnerStatus,
} from "@/lib/runner/types";
import { diagnosticsToExecutionProblems } from "@/lib/runner/problem-utils";
import type { KernelOption } from "@/components/notebook/kernel-selector";
import { isTauriHost } from "@/lib/storage-adapter";
import { normalizeExecutionText } from "@/lib/runner/text-utils";
import {
  clearNotebookCellSessionState,
  createExecutionSessionFallback,
  ensureExecutionSession,
  getExecutionSession,
  patchExecutionSession,
  setNotebookCellSessionState,
  updateExecutionProblemSources,
  useExecutionSessionStore,
} from "@/stores/execution-session-store";

export interface LegacyKernel {
  initialize?: () => Promise<void>;
  execute: (code: string, options?: Record<string, unknown>) => Promise<{
    outputs: unknown[];
    executionCount?: number;
    status?: string;
    executionTime?: number;
  }>;
  interrupt: () => Promise<void>;
  restart: () => Promise<void>;
  shutdown?: () => Promise<void>;
}

export type ExecutionState = "idle" | "running" | "interrupted";

export interface CellExecutionResult {
  cellId: string;
  outputs: Array<JupyterOutput | Record<string, unknown>>;
  executionCount: number;
  success: boolean;
  executionTime?: number;
  panelMeta?: ExecutionPanelMeta;
}

export type NotebookRuntimeAvailability = "unknown" | "checking" | "ready" | "error" | "unsupported";

interface UseNotebookExecutorOptions {
  scope?: ExecutionSessionScope | null;
  kernel?: LegacyKernel | null;
  runner?: KernelOption | null;
  cwd?: string;
  filePath?: string;
  notebookLanguage?: string | null;
  onCellStart?: (cellId: string) => void;
  onCellOutput?: (cellId: string, output: JupyterOutput) => void;
  onCellComplete?: (cellId: string, result: CellExecutionResult) => void;
  onAllComplete?: (results: CellExecutionResult[]) => void;
}

const LOCAL_SCOPE_PREFIX = "__local_notebook_scope__";

function randomId(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}_${crypto.randomUUID()}`
    : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createLocalScope(scopeId: string): ExecutionSessionScope {
  return {
    scopeId,
    kind: "notebook",
    paneId: scopeId,
    tabId: scopeId,
    filePath: scopeId,
    fileName: "notebook.ipynb",
  };
}

function isLegacyKernel(value: KernelOption | LegacyKernel | null | undefined): value is LegacyKernel {
  return Boolean(value && typeof value === "object" && "execute" in value);
}

function normalizeNotebookOutput(event: RunnerEvent): JupyterOutput[] {
  switch (event.type) {
    case "stdout":
    case "stderr":
      return [
        {
          output_type: "stream",
          name: event.payload.channel,
          text: event.payload.text,
        },
      ];
    case "display_data":
      return [
        {
          output_type: "display_data",
          data: event.payload.data,
        },
      ];
    case "error":
      return [
        {
          output_type: "error",
          ename: event.payload.ename || "ExecutionError",
          evalue: event.payload.evalue || event.payload.message,
          traceback: event.payload.traceback || [event.payload.message],
        },
      ];
    default:
      return [];
  }
}

function createNotebookErrorOutput(message: string, ename = "ExecutionError"): JupyterOutput {
  return {
    output_type: "error",
    ename,
    evalue: message,
    traceback: [message],
  };
}

function buildRuntimeDiagnostic(
  title: string,
  message: string,
  hint?: string,
  stage?: ExecutionFailureStage,
): ExecutionDiagnostic {
  return {
    severity: "error",
    title,
    message,
    hint,
    stage,
  };
}

function looksLikeInvalidCwd(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("no such file")
    || normalized.includes("cannot find the path")
    || normalized.includes("path specified");
}

function isPersistentSessionReady(session: PersistentPythonSession | null): boolean {
  if (!session) {
    return false;
  }
  if (typeof session.isReady === "function") {
    return session.isReady();
  }
  return true;
}

function mapRuntimeAvailability(status: RunnerStatus, hasValidatedRuntime: boolean, supportedNotebook: boolean, hasKernel: boolean): NotebookRuntimeAvailability {
  if (!hasKernel) {
    return "unknown";
  }
  if (!supportedNotebook) {
    return "unsupported";
  }
  if (status === "loading") {
    return "checking";
  }
  if (status === "ready") {
    return "ready";
  }
  if (status === "error") {
    return "error";
  }
  return hasValidatedRuntime ? "error" : "unknown";
}

function deriveNotebookCommandState(
  controller: NonNullable<ReturnType<typeof getNotebookRuntimeResource>>,
  current: NonNullable<ReturnType<typeof getExecutionSession>>,
): ExecutionCommandState {
  const busy = current.notebook?.executionState === "running"
    || current.lifecyclePhase === "preparing"
    || current.lifecyclePhase === "running"
    || current.lifecyclePhase === "stopping";
  const hasKernel = Boolean(controller.activeKernel);
  return {
    canRun: controller.supportsNotebook && hasKernel && !busy && current.runtime.status !== "loading",
    canRerun: false,
    canStop: busy,
    canInterrupt: busy,
    canRestart: controller.supportsNotebook && hasKernel,
    canVerifyRuntime: controller.supportsNotebook && hasKernel && !busy && current.runtime.status !== "loading",
    canSelectRuntime: controller.supportsNotebook && !busy,
  };
}

function updateNotebookScopeState(
  scopeId: string,
  updater: (current: NonNullable<ReturnType<typeof getExecutionSession>>) => NonNullable<ReturnType<typeof getExecutionSession>>,
): void {
  patchExecutionSession(scopeId, (current) => {
    const controller = getNotebookRuntimeResource(scopeId);
    const next = updater(current);
    if (!controller) {
      return next;
    }
    return {
      ...next,
      commandState: deriveNotebookCommandState(controller, next),
    };
  });
}

function updateNotebookKernelState(scopeId: string): void {
  const controller = getNotebookRuntimeResource(scopeId);
  if (!controller) {
    return;
  }
  updateNotebookScopeState(scopeId, (current) => ({
    ...current,
    runtime: {
      ...current.runtime,
      kernelId: !isLegacyKernel(controller.activeKernel) ? controller.activeKernel?.id ?? null : "legacy-kernel",
      kernelLabel: !isLegacyKernel(controller.activeKernel)
        ? controller.activeKernel?.displayName ?? null
        : "Legacy Kernel",
      kernelDescription: !isLegacyKernel(controller.activeKernel)
        ? controller.activeKernel?.description ?? null
        : "Legacy kernel session",
      kernelSelectionSource: !isLegacyKernel(controller.activeKernel)
        ? controller.activeKernel?.selectionSource ?? null
        : "legacy",
      kernelSourceLabel: !isLegacyKernel(controller.activeKernel)
        ? controller.activeKernel?.sourceLabel ?? null
        : "Legacy",
      runnerType: !isLegacyKernel(controller.activeKernel)
        ? controller.activeKernel?.runnerType ?? null
        : null,
      command: !isLegacyKernel(controller.activeKernel)
        ? controller.activeKernel?.command ?? null
        : null,
      availability: mapRuntimeAvailability(
        current.runtime.status,
        current.runtime.hasValidatedRuntime,
        controller.supportsNotebook,
        Boolean(controller.activeKernel),
      ),
    },
  }));
}

function setRuntimeFailure(
  scopeId: string,
  stage: ExecutionFailureStage,
  title: string,
  message: string,
  hint?: string,
): ExecutionDiagnostic[] {
  const diagnostic = buildRuntimeDiagnostic(title, message, hint, stage);
  updateNotebookScopeState(scopeId, (current) => {
    const problemSources = {
      ...current.problemSources,
      runtime: diagnosticsToExecutionProblems([diagnostic], "preflight", current.panelMeta.context ?? null),
    };
    return {
      ...current,
      lifecyclePhase: "error",
      failureStage: stage,
      status: "error",
      runtime: {
        ...current.runtime,
        status: "error",
        error: message,
        hasValidatedRuntime: true,
        availability: mapRuntimeAvailability("error", true, getNotebookRuntimeResource(scopeId)?.supportsNotebook ?? true, Boolean(getNotebookRuntimeResource(scopeId)?.activeKernel)),
      },
      panelMeta: {
        ...current.panelMeta,
        diagnostics: [diagnostic],
      },
      problemSources,
      problems: [
        ...problemSources.runtime,
        ...problemSources.health,
        ...problemSources.external,
      ],
      lastEvent: {
        type: "failure",
        timestampMs: Date.now(),
        message,
      },
    };
  });
  return [diagnostic];
}

function clearRuntimeFailure(scopeId: string): void {
  updateNotebookScopeState(scopeId, (current) => {
    const problemSources = {
      ...current.problemSources,
      runtime: [],
    };
    const controller = getNotebookRuntimeResource(scopeId);
    const runtimeStatus = !controller?.activeKernel
      ? "idle"
      : !isLegacyKernel(controller.activeKernel) && controller.activeKernel.runnerType === "python-pyodide"
        ? "ready"
        : current.runtime.status === "loading"
          ? "loading"
          : "idle";
    return {
      ...current,
      failureStage: null,
      status: runtimeStatus,
      runtime: {
        ...current.runtime,
        status: runtimeStatus,
        error: null,
        hasValidatedRuntime: true,
        availability: mapRuntimeAvailability(
          runtimeStatus,
          true,
          controller?.supportsNotebook ?? true,
          Boolean(controller?.activeKernel),
        ),
      },
      panelMeta: {
        ...current.panelMeta,
        diagnostics: [],
      },
      problemSources,
      problems: [
        ...problemSources.runtime,
        ...problemSources.health,
        ...problemSources.external,
      ],
    };
  });
}

function ensureNotebookController(
  scope: ExecutionSessionScope,
  kernel: KernelOption | LegacyKernel | null,
  notebookLanguage?: string | null,
){
  const supportedNotebook = !notebookLanguage || notebookLanguage.trim().toLowerCase() === "python";
  const controller = ensureNotebookRuntimeResource(scope, supportedNotebook, kernel);

  ensureExecutionSession(scope, {
    commandState: {
      canRun: false,
      canRerun: false,
      canStop: false,
      canInterrupt: false,
      canRestart: false,
      canVerifyRuntime: false,
      canSelectRuntime: supportedNotebook,
    },
    capability: {
      supportsSelection: false,
      supportsPersistentSession: true,
      supportsNotebook: true,
      supportsLocalExecution: true,
      supportsPyodide: true,
      canRun: true,
      canStop: true,
      canInterrupt: true,
      canRestart: true,
    },
  });
  updateNotebookKernelState(scope.scopeId);
  return controller;
}

export function useNotebookExecutor(options: UseNotebookExecutorOptions = {}) {
  const {
    scope: providedScope,
    kernel,
    runner,
    cwd,
    notebookLanguage,
    onCellStart,
    onCellOutput,
    onCellComplete,
    onAllComplete,
  } = options;
  const [localScopeId] = useState(() => `${LOCAL_SCOPE_PREFIX}:${randomId("scope")}`);
  const providedScopeId = providedScope?.scopeId;
  const providedScopeKind = providedScope?.kind;
  const providedScopePaneId = providedScope?.paneId;
  const providedScopeTabId = providedScope?.tabId;
  const providedScopeFilePath = providedScope?.filePath;
  const providedScopeFileName = providedScope?.fileName;
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
  const getController = useCallback(
    () => ensureNotebookController(scope, runner ?? kernel ?? null, notebookLanguage),
    [kernel, notebookLanguage, runner, scope],
  );
  const controller = getNotebookRuntimeResource(scope.scopeId) ?? null;
  const state = useExecutionSessionStore((store) => store.sessions[scope.scopeId]);
  const fallback = useMemo(() => createExecutionSessionFallback(scope), [scope]);
  const current = state ?? fallback;

  useEffect(() => {
    getController();
  }, [getController]);

  useEffect(() => {
    const ensuredController = getController();
    ensuredController.supportsNotebook = !notebookLanguage || notebookLanguage.trim().toLowerCase() === "python";
    if (!ensuredController.activeKernel && (runner ?? kernel)) {
      ensuredController.activeKernel = runner ?? kernel ?? ensuredController.activeKernel;
    }
    updateNotebookKernelState(scope.scopeId);
  }, [getController, kernel, notebookLanguage, runner, scope.scopeId]);

  const attachPersistentSession = useCallback((session: PersistentPythonSession) => {
    const controller = getController();
    controller.sessionCleanup?.();
    controller.sessionCleanup = session.onEvent((event) => {
      if (event.type === "ready") {
        clearRuntimeFailure(scope.scopeId);
        updateNotebookScopeState(scope.scopeId, (currentState) => ({
          ...currentState,
          runtime: {
            ...currentState.runtime,
            status: "ready",
            availability: "ready",
          },
        }));
        return;
      }

      if (
        event.type === "terminated" ||
        (event.type === "completed" && event.payload.persistent)
      ) {
        controller.notebookSession = null;
        if (controller.expectedPersistentShutdown) {
          controller.expectedPersistentShutdown = false;
          updateNotebookScopeState(scope.scopeId, (currentState) => ({
            ...currentState,
            runtime: {
              ...currentState.runtime,
              status: "idle",
              availability: mapRuntimeAvailability("idle", currentState.runtime.hasValidatedRuntime, controller.supportsNotebook, Boolean(controller.activeKernel)),
            },
          }));
          return;
        }
        setRuntimeFailure(
          scope.scopeId,
          "session-start",
          "Notebook 会话已终止",
          "Notebook Python 会话已结束，请重新验证或重新运行。",
          "通常是解释器进程退出、被中断或工作目录失效导致。",
        );
      }
    });
  }, [getController, scope.scopeId]);

  const prepareRuntime = useCallback(async (): Promise<boolean> => {
    const controller = getController();
    if (!controller.activeKernel) {
      setRuntimeFailure(scope.scopeId, "kernel-selection", "未选择运行环境", "当前 Notebook 没有可用的运行环境。");
      return false;
    }

    if (!controller.supportsNotebook) {
      setRuntimeFailure(
        scope.scopeId,
        "kernel-selection",
        "暂不支持的 Notebook 内核",
        `当前 Notebook 语言为 ${notebookLanguage}，本轮只支持 Python Notebook 执行。`,
        "请切换到 Python Notebook，或仅以只读方式查看当前 .ipynb。",
      );
      return false;
    }

    if (isLegacyKernel(controller.activeKernel)) {
      try {
        updateNotebookScopeState(scope.scopeId, (currentState) => ({
          ...currentState,
          runtime: {
            ...currentState.runtime,
            status: "loading",
            availability: "checking",
          },
        }));
        await controller.activeKernel.initialize?.();
        clearRuntimeFailure(scope.scopeId);
        updateNotebookScopeState(scope.scopeId, (currentState) => ({
          ...currentState,
          status: "ready",
          lifecyclePhase: "ready",
          runtime: {
            ...currentState.runtime,
            status: "ready",
            availability: "ready",
          },
        }));
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setRuntimeFailure(scope.scopeId, "session-start", "Legacy kernel 初始化失败", message);
        return false;
      }
    }

    if (controller.activeKernel.runnerType === "python-pyodide") {
      clearRuntimeFailure(scope.scopeId);
      updateNotebookScopeState(scope.scopeId, (currentState) => ({
        ...currentState,
        status: "ready",
        lifecyclePhase: "ready",
        runtime: {
          ...currentState.runtime,
          status: "ready",
          availability: "ready",
          hasValidatedRuntime: true,
        },
      }));
      return true;
    }

    if (!isTauriHost()) {
      setRuntimeFailure(
        scope.scopeId,
        "session-start",
        "本地 Python 不可用",
        "当前环境不是桌面端，无法启动本地 Python 会话。",
        "请切换到桌面端，或改用 Pyodide 浏览器内核。",
      );
      return false;
    }

    if (!controller.activeKernel.command) {
      setRuntimeFailure(
        scope.scopeId,
        "interpreter-discovery",
        "缺少 Python 解释器",
        "当前 Notebook 没有解析到可用的本地 Python 解释器。",
        "请在 Runner Manager 中选择一个有效解释器后重试。",
      );
      return false;
    }

    if (isPersistentSessionReady(controller.notebookSession)) {
      clearRuntimeFailure(scope.scopeId);
      updateNotebookScopeState(scope.scopeId, (currentState) => ({
        ...currentState,
        status: "ready",
        lifecyclePhase: "ready",
        runtime: {
          ...currentState.runtime,
          status: "ready",
          availability: "ready",
          hasValidatedRuntime: true,
        },
      }));
      return true;
    }

    updateNotebookScopeState(scope.scopeId, (currentState) => ({
      ...currentState,
      lifecyclePhase: "preparing",
      runtime: {
        ...currentState.runtime,
        status: "loading",
        error: null,
        hasValidatedRuntime: false,
        availability: "checking",
      },
      panelMeta: {
        ...currentState.panelMeta,
        diagnostics: [],
      },
    }));
    updateExecutionProblemSources(scope.scopeId, { runtime: [] });

    try {
      if (controller.notebookSession) {
        controller.expectedPersistentShutdown = true;
        await controller.notebookSession.dispose();
      }
      const session = runnerManager.createPersistentPythonSession({
        command: controller.activeKernel.command,
        cwd,
      });
      attachPersistentSession(session);
      controller.notebookSession = session;
      controller.expectedPersistentShutdown = false;
      await session.start();
      clearRuntimeFailure(scope.scopeId);
      updateNotebookScopeState(scope.scopeId, (currentState) => ({
        ...currentState,
        status: "ready",
        lifecyclePhase: "ready",
        runtime: {
          ...currentState.runtime,
          status: "ready",
          availability: "ready",
          hasValidatedRuntime: true,
        },
      }));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const title = looksLikeInvalidCwd(message) ? "Notebook 工作目录无效" : "Notebook 会话启动失败";
      const hint = looksLikeInvalidCwd(message)
        ? "请确认当前文件路径与工作区根目录有效，再重新选择运行环境。"
        : "请检查解释器、依赖环境或 Runner Diagnostics 后重试。";
      setRuntimeFailure(scope.scopeId, looksLikeInvalidCwd(message) ? "request-build" : "session-start", title, message, hint);
      controller.notebookSession = null;
      return false;
    }
  }, [attachPersistentSession, cwd, getController, notebookLanguage, scope.scopeId]);

  const executeCellInternal = useCallback(async (cellId: string, code: string): Promise<CellExecutionResult> => {
    const normalizedCode = normalizeExecutionText(code);
    const controller = getController();
    if (!controller.activeKernel) {
      const diagnostics = setRuntimeFailure(scope.scopeId, "kernel-selection", "未选择运行环境", "当前 Notebook 没有可用的运行环境。");
      const failureOutput = createNotebookErrorOutput("当前 Notebook 没有可用的运行环境。");
      setNotebookCellSessionState(scope.scopeId, cellId, {
        outputs: [failureOutput as unknown as Record<string, unknown>],
        executionCount: 0,
        panelMeta: { ...current.panelMeta, diagnostics },
      });
      return { cellId, outputs: [failureOutput], executionCount: 0, success: false, panelMeta: { ...current.panelMeta, diagnostics } };
    }

    if (!(await prepareRuntime())) {
      const failureOutput = createNotebookErrorOutput(getExecutionSession(scope.scopeId)?.runtime.error || "Notebook 运行环境未就绪");
      setNotebookCellSessionState(scope.scopeId, cellId, {
        outputs: [failureOutput as unknown as Record<string, unknown>],
        executionCount: 0,
        panelMeta: getExecutionSession(scope.scopeId)?.panelMeta ?? current.panelMeta,
      });
      return { cellId, outputs: [failureOutput], executionCount: 0, success: false, panelMeta: getExecutionSession(scope.scopeId)?.panelMeta ?? current.panelMeta };
    }

    const panelMeta: ExecutionPanelMeta = {
      origin: !isLegacyKernel(controller.activeKernel) ? getExecutionOrigin({
        runnerType: controller.activeKernel.runnerType,
        mode: "cell",
        command: controller.activeKernel.command,
      }) : current.panelMeta.origin,
      diagnostics: getExecutionSession(scope.scopeId)?.panelMeta.diagnostics ?? [],
      context: getExecutionSession(scope.scopeId)?.panelMeta.context,
    };

    const appendOutputs = (outputs: JupyterOutput[], executionCount: number) => {
      setNotebookCellSessionState(scope.scopeId, cellId, {
        outputs: outputs as unknown as Array<Record<string, unknown>>,
        executionCount,
        panelMeta,
      });
      outputs.forEach((output) => onCellOutput?.(cellId, output));
    };

    if (isLegacyKernel(controller.activeKernel)) {
      controller.executionCount += 1;
      const executionCount = controller.executionCount;
      try {
        const result = await controller.activeKernel.execute(normalizedCode, { silent: false, storeHistory: true });
        setNotebookCellSessionState(scope.scopeId, cellId, {
          outputs: result.outputs as Array<Record<string, unknown>>,
          executionCount: result.executionCount ?? executionCount,
          panelMeta,
        });
        return { cellId, outputs: result.outputs as Array<Record<string, unknown>>, executionCount: result.executionCount ?? executionCount, success: result.status !== "error", executionTime: result.executionTime, panelMeta };
      } catch (error) {
        const failureOutput = createNotebookErrorOutput(error instanceof Error ? error.message : String(error));
        appendOutputs([failureOutput], executionCount);
        return { cellId, outputs: [failureOutput], executionCount, success: false, panelMeta };
      }
    }

    controller.executionCount += 1;
    const executionCount = controller.executionCount;

    if (isTauriHost() && controller.activeKernel.runnerType === "python-local") {
      const outputs: JupyterOutput[] = [];
      const persistentSession = controller.notebookSession;
      if (!persistentSession) {
        const failureOutput = createNotebookErrorOutput("Notebook Python 会话未初始化，请先验证运行环境。");
        appendOutputs([failureOutput], executionCount);
        return { cellId, outputs: [failureOutput], executionCount, success: false, panelMeta };
      }
      try {
        const result = await persistentSession.execute({ code: normalizedCode }, (event) => {
          const chunk = normalizeNotebookOutput(event);
          if (chunk.length > 0) {
            outputs.push(...chunk);
            appendOutputs(outputs, executionCount);
          }
        });
        return { cellId, outputs, executionCount, success: result.success, executionTime: undefined, panelMeta };
      } catch (error) {
        const failureOutput = createNotebookErrorOutput(error instanceof Error ? error.message : String(error));
        outputs.push(failureOutput);
        appendOutputs(outputs, executionCount);
        setRuntimeFailure(scope.scopeId, "execution", "Notebook 会话执行失败", failureOutput.evalue || failureOutput.traceback?.[0] || "执行失败");
        return { cellId, outputs, executionCount, success: false, panelMeta };
      }
    }

    const session = runnerManager.createSession();
    controller.activeSession = session;
    const outputs: JupyterOutput[] = [];
    session.onEvent((event) => {
      const chunk = normalizeNotebookOutput(event);
      if (chunk.length > 0) {
        outputs.push(...chunk);
        appendOutputs(outputs, executionCount);
      }
    });
    try {
      const result = await session.run({
        runnerType: controller.activeKernel.runnerType,
        command: controller.activeKernel.command,
        code: normalizedCode,
        cwd,
        mode: "cell",
        allowPyodideFallback: controller.activeKernel.runnerType === "python-pyodide",
      });
      return { cellId, outputs, executionCount, success: result.success, executionTime: undefined, panelMeta };
    } catch (error) {
      const failureOutput = createNotebookErrorOutput(error instanceof Error ? error.message : String(error));
      outputs.push(failureOutput);
      appendOutputs(outputs, executionCount);
      setRuntimeFailure(scope.scopeId, "session-start", "Notebook 运行启动失败", failureOutput.evalue || failureOutput.traceback?.[0] || "启动失败");
      return { cellId, outputs, executionCount, success: false, panelMeta };
    } finally {
      session.dispose();
      controller.activeSession = null;
    }
  }, [current.panelMeta, onCellOutput, prepareRuntime, scope.scopeId, cwd, getController]);

  const finishNotebookRun = useCallback((didInterrupt: boolean) => {
    updateNotebookScopeState(scope.scopeId, (sessionState) => ({
      ...sessionState,
      activeRunId: null,
      lastCompletedRunId: sessionState.activeRunId,
      lifecyclePhase: didInterrupt ? "interrupted" : "completed",
      status: didInterrupt ? "idle" : sessionState.runtime.status === "ready" ? "ready" : "idle",
      notebook: sessionState.notebook
        ? {
            ...sessionState.notebook,
            executionState: didInterrupt ? "interrupted" : "idle",
            currentCellId: null,
            progress: { current: 0, total: 0 },
          }
        : sessionState.notebook,
    }));
  }, [scope.scopeId]);

  const executeCell = useCallback(async (cellId: string, code: string): Promise<CellExecutionResult> => {
    const controller = getController();
    const currentState = getExecutionSession(scope.scopeId) ?? ensureExecutionSession(scope);
    if (currentState.notebook?.executionState === "running") {
      const failureOutput = createNotebookErrorOutput("Notebook 正在执行，已阻止新的单元格运行请求。");
      setRuntimeFailure(scope.scopeId, "execution", "Notebook 正在执行", "当前 Notebook 正在执行，不能并发运行多个单元格。");
      return { cellId, outputs: [failureOutput], executionCount: currentState.notebook.cells[cellId]?.executionCount ?? 0, success: false, panelMeta: currentState.panelMeta };
    }

    controller.interrupted = false;
    clearNotebookCellSessionState(scope.scopeId, cellId);
    updateNotebookScopeState(scope.scopeId, (sessionState) => ({
      ...sessionState,
      lifecyclePhase: "running",
      status: "running",
      activeRunId: randomId("nb"),
      notebook: sessionState.notebook
        ? { ...sessionState.notebook, executionState: "running", currentCellId: cellId }
        : sessionState.notebook,
    }));
    onCellStart?.(cellId);
    try {
      const result = await executeCellInternal(cellId, code);
      onCellComplete?.(cellId, result);
      return result;
    } finally {
      finishNotebookRun(controller.interrupted);
    }
  }, [executeCellInternal, finishNotebookRun, onCellComplete, onCellStart, scope, getController]);

  const runCells = useCallback(async (cells: Array<{ id: string; source: string; type: string }>): Promise<CellExecutionResult[]> => {
    const controller = getController();
    const currentState = getExecutionSession(scope.scopeId) ?? ensureExecutionSession(scope);
    if (currentState.notebook?.executionState === "running") {
      setRuntimeFailure(scope.scopeId, "execution", "Notebook 正在执行", "当前 Notebook 正在执行，不能并发运行多个请求。");
      return [];
    }
    const codeCells = cells.filter((cell) => cell.type === "code");
    if (codeCells.length === 0) {
      return [];
    }

    controller.interrupted = false;
    updateNotebookScopeState(scope.scopeId, (sessionState) => ({
      ...sessionState,
      lifecyclePhase: "running",
      status: "running",
      activeRunId: randomId("nb_all"),
      notebook: sessionState.notebook
        ? { ...sessionState.notebook, executionState: "running", currentCellId: null, progress: { current: 0, total: codeCells.length } }
        : sessionState.notebook,
    }));

    const results: CellExecutionResult[] = [];
    let didInterrupt = false;
    for (let index = 0; index < codeCells.length; index += 1) {
      if (controller.interrupted) {
        didInterrupt = true;
        break;
      }
      const cell = codeCells[index];
      clearNotebookCellSessionState(scope.scopeId, cell.id);
      updateNotebookScopeState(scope.scopeId, (sessionState) => ({
        ...sessionState,
        notebook: sessionState.notebook
          ? { ...sessionState.notebook, currentCellId: cell.id, progress: { current: index + 1, total: codeCells.length } }
          : sessionState.notebook,
      }));
      onCellStart?.(cell.id);
      const result = await executeCellInternal(cell.id, cell.source);
      results.push(result);
      onCellComplete?.(cell.id, result);
      if (!result.success || controller.interrupted) {
        didInterrupt = controller.interrupted;
        break;
      }
    }
    finishNotebookRun(didInterrupt);
    onAllComplete?.(results);
    return results;
  }, [executeCellInternal, finishNotebookRun, onAllComplete, onCellComplete, onCellStart, scope, getController]);

  const runAll = useCallback(async (cells: Array<{ id: string; source: string; type: string }>) => runCells(cells), [runCells]);
  const runAllAbove = useCallback(async (cells: Array<{ id: string; source: string; type: string }>, targetCellId: string) => {
    const targetIndex = cells.findIndex((cell) => cell.id === targetCellId);
    return targetIndex === -1 ? [] : runCells(cells.slice(0, targetIndex + 1));
  }, [runCells]);
  const runAllBelow = useCallback(async (cells: Array<{ id: string; source: string; type: string }>, targetCellId: string) => {
    const targetIndex = cells.findIndex((cell) => cell.id === targetCellId);
    return targetIndex === -1 ? [] : runCells(cells.slice(targetIndex));
  }, [runCells]);

  const interrupt = useCallback(async () => {
    const controller = getController();
    controller.interrupted = true;
    updateNotebookScopeState(scope.scopeId, (sessionState) => ({
      ...sessionState,
      lifecyclePhase: "stopping",
      notebook: sessionState.notebook ? { ...sessionState.notebook, executionState: "interrupted" } : sessionState.notebook,
    }));
    if (isLegacyKernel(controller.activeKernel)) {
      await controller.activeKernel.interrupt();
      return;
    }
    if (controller.notebookSession) {
      controller.expectedPersistentShutdown = true;
      await controller.notebookSession.stop();
      controller.notebookSession = null;
      return;
    }
    await controller.activeSession?.terminate();
  }, [getController, scope.scopeId]);

  const restartKernel = useCallback(async () => {
    const controller = getController();
    controller.interrupted = true;
    controller.executionCount = 0;
    clearRuntimeFailure(scope.scopeId);
    if (isLegacyKernel(controller.activeKernel)) {
      await controller.activeKernel.restart();
      finishNotebookRun(false);
      return;
    }
    if (controller.notebookSession) {
      controller.expectedPersistentShutdown = true;
      await controller.notebookSession.dispose();
      controller.notebookSession = null;
      await prepareRuntime();
      return;
    }
    await controller.activeSession?.terminate();
    controller.activeSession = null;
    finishNotebookRun(false);
  }, [finishNotebookRun, prepareRuntime, scope.scopeId, getController]);

  const switchKernel = useCallback(async (newKernel: KernelOption | LegacyKernel) => {
    const controller = getController();
    controller.interrupted = false;
    controller.executionCount = 0;
    await controller.activeSession?.terminate();
    controller.activeSession = null;
    if (controller.notebookSession) {
      controller.expectedPersistentShutdown = true;
      await controller.notebookSession.dispose();
      controller.notebookSession = null;
      controller.expectedPersistentShutdown = false;
    }
    controller.activeKernel = newKernel;
    clearRuntimeFailure(scope.scopeId);
    updateNotebookScopeState(scope.scopeId, (sessionState) => ({
      ...sessionState,
      lifecyclePhase: !isLegacyKernel(newKernel) && newKernel.runnerType === "python-pyodide" ? "ready" : "idle",
      status: !isLegacyKernel(newKernel) && newKernel.runnerType === "python-pyodide" ? "ready" : "idle",
      runtime: {
        ...sessionState.runtime,
        status: !isLegacyKernel(newKernel) && newKernel.runnerType === "python-pyodide" ? "ready" : "idle",
        availability: !isLegacyKernel(newKernel) && newKernel.runnerType === "python-pyodide" ? "ready" : "unknown",
        hasValidatedRuntime: !isLegacyKernel(newKernel) && newKernel.runnerType === "python-pyodide",
      },
    }));
    updateNotebookKernelState(scope.scopeId);
  }, [getController, scope.scopeId]);

  const notebookState = current.notebook ?? fallback.notebook;
  const runtimeAvailability = (current.runtime.availability as NotebookRuntimeAvailability | null)
    ?? mapRuntimeAvailability(
      current.runtime.status,
      current.runtime.hasValidatedRuntime,
      controller?.supportsNotebook ?? (!notebookLanguage || notebookLanguage.trim().toLowerCase() === "python"),
      Boolean(controller?.activeKernel ?? runner ?? kernel),
    );

  return {
    executionState: notebookState?.executionState ?? "idle",
    currentCellId: notebookState?.currentCellId ?? null,
    progress: notebookState?.progress ?? { current: 0, total: 0 },
    cellStates: notebookState?.cells ?? {},
    kernel: controller?.activeKernel ?? runner ?? kernel ?? null,
    runtimeStatus: current.runtime.status,
    runtimeAvailability,
    runtimeError: current.runtime.error,
    runtimeProblems: current.problemSources.runtime as ExecutionProblem[],
    runtimeMeta: current.panelMeta,
    hasValidatedRuntime: current.runtime.hasValidatedRuntime,
    prepareRuntime,
    runAll,
    runAllAbove,
    runAllBelow,
    interrupt,
    restartKernel,
    switchKernel,
    executeCell,
    commandState: current.commandState,
  };
}
