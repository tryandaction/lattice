"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { runnerManager, type ExecutionSession, type PersistentPythonSession } from "@/lib/runner/runner-manager";
import type { JupyterOutput } from "@/lib/notebook-utils";
import { getExecutionOrigin } from "@/lib/runner/preferences";
import type {
  ExecutionDiagnostic,
  ExecutionPanelMeta,
  ExecutionProblem,
  RunnerEvent,
  RunnerStatus,
} from "@/lib/runner/types";
import { diagnosticsToExecutionProblems } from "@/lib/runner/problem-utils";
import type { KernelOption } from "@/components/notebook/kernel-selector";
import { isTauriHost } from "@/lib/storage-adapter";

interface LegacyKernel {
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
): ExecutionDiagnostic {
  return {
    severity: "error",
    title,
    message,
    hint,
  };
}

function looksLikeInvalidCwd(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("no such file") ||
    normalized.includes("cannot find the path") ||
    normalized.includes("path specified");
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

export function useNotebookExecutor(options: UseNotebookExecutorOptions = {}) {
  const { kernel, runner, cwd, filePath, notebookLanguage, onCellStart, onCellOutput, onCellComplete, onAllComplete } = options;
  const [executionState, setExecutionState] = useState<ExecutionState>("idle");
  const [currentCellId, setCurrentCellId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [activeKernel, setActiveKernel] = useState<KernelOption | LegacyKernel | null>(runner ?? kernel ?? null);
  const [runtimeStatus, setRuntimeStatus] = useState<RunnerStatus>("idle");
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeProblems, setRuntimeProblems] = useState<ExecutionProblem[]>([]);
  const [hasValidatedRuntime, setHasValidatedRuntime] = useState(false);
  const [runtimeMeta, setRuntimeMeta] = useState<ExecutionPanelMeta>({
    origin: null,
    diagnostics: [],
    context: filePath
      ? {
          kind: "workspace",
          filePath,
          label: "Notebook Runtime",
        }
      : {
          kind: "workspace",
          label: "Notebook Runtime",
        },
  });
  const interruptedRef = useRef(false);
  const executionCountRef = useRef(0);
  const activeSessionRef = useRef<ExecutionSession | null>(null);
  const notebookSessionRef = useRef<PersistentPythonSession | null>(null);
  const sessionCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setActiveKernel(runner ?? kernel ?? null);
  }, [kernel, runner]);

  useEffect(() => {
    const origin = !isLegacyKernel(activeKernel) && activeKernel
      ? getExecutionOrigin({
          runnerType: activeKernel.runnerType,
          mode: "cell",
          command: activeKernel.command,
        })
      : null;
    const nextStatus = !activeKernel
      ? "idle"
      : !isLegacyKernel(activeKernel) && activeKernel.runnerType === "python-pyodide"
        ? "ready"
        : "idle";
    setRuntimeStatus(nextStatus);
    setRuntimeError(null);
    setRuntimeProblems([]);
    setHasValidatedRuntime(!activeKernel ? false : !isLegacyKernel(activeKernel) && activeKernel.runnerType === "python-pyodide");
    setRuntimeMeta((previous) => ({
      ...previous,
      origin,
      diagnostics: [],
    }));
  }, [activeKernel]);

  useEffect(() => {
    setRuntimeMeta((previous) => ({
      ...previous,
      context: filePath
        ? {
            kind: "workspace",
            filePath,
            label: "Notebook Runtime",
          }
        : {
            kind: "workspace",
            label: "Notebook Runtime",
          },
    }));
  }, [filePath]);

  useEffect(() => {
    return () => {
      sessionCleanupRef.current?.();
      void activeSessionRef.current?.terminate();
      activeSessionRef.current = null;

      if (notebookSessionRef.current) {
        void notebookSessionRef.current.dispose();
        notebookSessionRef.current = null;
      }
    };
  }, []);

  const setRuntimeFailure = useCallback((
    title: string,
    message: string,
    hint?: string,
  ) => {
    const diagnostic = buildRuntimeDiagnostic(title, message, hint);
    const problems = diagnosticsToExecutionProblems([diagnostic], "preflight", runtimeMeta.context ?? null);
    setRuntimeStatus("error");
    setRuntimeError(message);
    setRuntimeProblems(problems);
    setHasValidatedRuntime(true);
    setRuntimeMeta((previous) => ({
      ...previous,
      diagnostics: [diagnostic],
    }));
    return [diagnostic];
  }, [runtimeMeta.context]);

  const clearRuntimeFailure = useCallback(() => {
    setRuntimeError(null);
    setRuntimeProblems([]);
    setHasValidatedRuntime(true);
    setRuntimeMeta((previous) => ({
      ...previous,
      diagnostics: [],
    }));
  }, []);

  const attachPersistentSession = useCallback((session: PersistentPythonSession) => {
    sessionCleanupRef.current?.();
    sessionCleanupRef.current = session.onEvent((event) => {
      if (event.type === "ready") {
        setRuntimeStatus("ready");
        setRuntimeError(null);
        setRuntimeProblems([]);
        setRuntimeMeta((previous) => ({
          ...previous,
          diagnostics: [],
        }));
        return;
      }

      if (
        event.type === "terminated" ||
        (event.type === "completed" && event.payload.persistent)
      ) {
        setRuntimeFailure(
          "Notebook 会话已终止",
          "Notebook Python 会话已结束，请重新验证或重新运行。",
          "通常是解释器进程退出、被中断或工作目录失效导致。",
        );
        notebookSessionRef.current = null;
      }
    });
  }, [setRuntimeFailure]);

  const prepareRuntime = useCallback(async (): Promise<boolean> => {
    if (!activeKernel) {
      setRuntimeFailure("未选择运行环境", "当前 Notebook 没有可用的运行环境。");
      return false;
    }

    if (notebookLanguage && notebookLanguage.toLowerCase() !== "python") {
      setRuntimeFailure(
        "暂不支持的 Notebook 内核",
        `当前 Notebook 语言为 ${notebookLanguage}，本轮只支持 Python Notebook 执行。`,
        "请切换到 Python Notebook，或仅以只读方式查看当前 .ipynb。",
      );
      return false;
    }

    if (isLegacyKernel(activeKernel)) {
      try {
        setRuntimeStatus("loading");
        await activeKernel.initialize?.();
        clearRuntimeFailure();
        setRuntimeStatus("ready");
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setRuntimeFailure("Legacy kernel 初始化失败", message);
        return false;
      }
    }

    if (activeKernel.runnerType === "python-pyodide") {
      clearRuntimeFailure();
      setRuntimeStatus("ready");
      return true;
    }

    if (!isTauriHost()) {
      setRuntimeFailure(
        "本地 Python 不可用",
        "当前环境不是桌面端，无法启动本地 Python 会话。",
        "请切换到桌面端，或改用 Pyodide 浏览器内核。",
      );
      return false;
    }

    if (!activeKernel.command) {
      setRuntimeFailure(
        "缺少 Python 解释器",
        "当前 Notebook 没有解析到可用的本地 Python 解释器。",
        "请在 Runner Manager 中选择一个有效解释器后重试。",
      );
      return false;
    }

    if (isPersistentSessionReady(notebookSessionRef.current)) {
      clearRuntimeFailure();
      setRuntimeStatus("ready");
      return true;
    }

    setRuntimeStatus("loading");
    setRuntimeError(null);
    setRuntimeProblems([]);
    setRuntimeMeta((previous) => ({
      ...previous,
      diagnostics: [],
    }));

    try {
      if (notebookSessionRef.current) {
        await notebookSessionRef.current.dispose();
      }

      const session = runnerManager.createPersistentPythonSession({
        command: activeKernel.command,
        cwd,
      });
      attachPersistentSession(session);
      notebookSessionRef.current = session;
      await session.start();
      clearRuntimeFailure();
      setRuntimeStatus("ready");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const title = looksLikeInvalidCwd(message) ? "Notebook 工作目录无效" : "Notebook 会话启动失败";
      const hint = looksLikeInvalidCwd(message)
        ? "请确认当前文件路径与工作区根目录有效，再重新选择运行环境。"
        : "请检查解释器、依赖环境或 Runner Diagnostics 后重试。";
      setRuntimeFailure(title, message, hint);
      notebookSessionRef.current = null;
      return false;
    }
  }, [
    activeKernel,
    attachPersistentSession,
    clearRuntimeFailure,
    cwd,
    notebookLanguage,
    setRuntimeFailure,
  ]);

  const executeCellInternal = useCallback(async (
    cellId: string,
    code: string,
  ): Promise<CellExecutionResult> => {
    if (!activeKernel) {
      const diagnostics = setRuntimeFailure("未选择运行环境", "当前 Notebook 没有可用的运行环境。");
      return {
        cellId,
        outputs: [createNotebookErrorOutput("当前 Notebook 没有可用的运行环境。")],
        executionCount: 0,
        success: false,
        panelMeta: {
          ...runtimeMeta,
          diagnostics,
        },
      };
    }

    if (!(await prepareRuntime())) {
      return {
        cellId,
        outputs: [createNotebookErrorOutput(runtimeError || "Notebook 运行环境未就绪")],
        executionCount: 0,
        success: false,
        panelMeta: runtimeMeta,
      };
    }

    if (isLegacyKernel(activeKernel)) {
      executionCountRef.current += 1;
      const executionCount = executionCountRef.current;
      try {
        const result = await activeKernel.execute(code, {
          silent: false,
          storeHistory: true,
        });

        return {
          cellId,
          outputs: result.outputs as Array<Record<string, unknown>>,
          executionCount: result.executionCount ?? executionCount,
          success: result.status !== "error",
          executionTime: result.executionTime,
          panelMeta: runtimeMeta,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          cellId,
          outputs: [createNotebookErrorOutput(message)],
          executionCount,
          success: false,
          panelMeta: runtimeMeta,
        };
      }
    }

    const panelMeta: ExecutionPanelMeta = {
      origin: getExecutionOrigin({
        runnerType: activeKernel.runnerType,
        mode: "cell",
        command: activeKernel.command,
      }),
      diagnostics: runtimeMeta.diagnostics,
      context: runtimeMeta.context,
    };

    if (isTauriHost() && activeKernel.runnerType === "python-local") {
      interruptedRef.current = false;
      executionCountRef.current += 1;
      const executionCount = executionCountRef.current;
      const outputs: JupyterOutput[] = [];
      const startedAt = Date.now();
      const persistentSession = notebookSessionRef.current;

      if (!persistentSession) {
        return {
          cellId,
          outputs: [createNotebookErrorOutput("Notebook Python 会话未初始化，请先验证运行环境。")],
          executionCount,
          success: false,
          panelMeta,
        };
      }

      try {
        const result = await persistentSession.execute({ code }, (event) => {
          const notebookOutputs = normalizeNotebookOutput(event);
          notebookOutputs.forEach((output) => {
            outputs.push(output);
            onCellOutput?.(cellId, output);
          });
        });

        return {
          cellId,
          outputs,
          executionCount,
          success: result.success,
          executionTime: Date.now() - startedAt,
          panelMeta,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failureOutput = createNotebookErrorOutput(message);
        outputs.push(failureOutput);
        onCellOutput?.(cellId, failureOutput);
        setRuntimeFailure("Notebook 会话执行失败", message);
        return {
          cellId,
          outputs,
          executionCount,
          success: false,
          panelMeta,
        };
      }
    }

    executionCountRef.current += 1;
    const executionCount = executionCountRef.current;
    const session = runnerManager.createSession();
    activeSessionRef.current = session;

    const startedAt = Date.now();
    const outputs: JupyterOutput[] = [];
    session.onEvent((event) => {
      const notebookOutputs = normalizeNotebookOutput(event);
      notebookOutputs.forEach((output) => {
        outputs.push(output);
        onCellOutput?.(cellId, output);
      });
    });

    try {
      const result = await session.run({
        runnerType: activeKernel.runnerType,
        command: activeKernel.command,
        code,
        cwd,
        mode: "cell",
        allowPyodideFallback: activeKernel.runnerType === "python-pyodide",
      });

      const executionTime = Date.now() - startedAt;
      return {
        cellId,
        outputs,
        executionCount,
        success: result.success,
        executionTime,
        panelMeta,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failureOutput = createNotebookErrorOutput(message);
      outputs.push(failureOutput);
      onCellOutput?.(cellId, failureOutput);
      return {
        cellId,
        outputs,
        executionCount,
        success: false,
        panelMeta,
      };
    } finally {
      session.dispose();
      activeSessionRef.current = null;
    }
  }, [
    activeKernel,
    cwd,
    onCellOutput,
    prepareRuntime,
    runtimeError,
    runtimeMeta,
    setRuntimeFailure,
  ]);

  const executeCell = useCallback(async (
    cellId: string,
    code: string,
  ): Promise<CellExecutionResult> => {
    interruptedRef.current = false;
    setExecutionState("running");
    setCurrentCellId(cellId);

    try {
      return await executeCellInternal(cellId, code);
    } finally {
      setExecutionState(interruptedRef.current ? "interrupted" : "idle");
      setCurrentCellId(null);
    }
  }, [executeCellInternal]);

  const runCells = useCallback(async (
    cells: Array<{ id: string; source: string; type: string }>,
  ): Promise<CellExecutionResult[]> => {
    const codeCells = cells.filter((cell) => cell.type === "code");
    if (codeCells.length === 0) {
      return [];
    }

    interruptedRef.current = false;
    setExecutionState("running");
    setProgress({ current: 0, total: codeCells.length });

    const results: CellExecutionResult[] = [];
    let didInterrupt = false;

    for (let index = 0; index < codeCells.length; index += 1) {
      if (interruptedRef.current) {
        setExecutionState("interrupted");
        didInterrupt = true;
        break;
      }

      const cell = codeCells[index];
      setCurrentCellId(cell.id);
      setProgress({ current: index + 1, total: codeCells.length });
      onCellStart?.(cell.id);

      const result = await executeCellInternal(cell.id, cell.source);
      results.push(result);
      onCellComplete?.(cell.id, result);

      if (interruptedRef.current) {
        didInterrupt = true;
      }

      if (!result.success) {
        break;
      }
    }

    setExecutionState(didInterrupt ? "interrupted" : "idle");
    setCurrentCellId(null);
    setProgress({ current: 0, total: 0 });
    onAllComplete?.(results);
    return results;
  }, [executeCellInternal, onAllComplete, onCellComplete, onCellStart]);

  const runAll = useCallback(async (cells: Array<{ id: string; source: string; type: string }>) => {
    return runCells(cells);
  }, [runCells]);

  const runAllAbove = useCallback(async (
    cells: Array<{ id: string; source: string; type: string }>,
    targetCellId: string,
  ) => {
    const targetIndex = cells.findIndex((cell) => cell.id === targetCellId);
    if (targetIndex === -1) return [];
    return runCells(cells.slice(0, targetIndex + 1));
  }, [runCells]);

  const runAllBelow = useCallback(async (
    cells: Array<{ id: string; source: string; type: string }>,
    targetCellId: string,
  ) => {
    const targetIndex = cells.findIndex((cell) => cell.id === targetCellId);
    if (targetIndex === -1) return [];
    return runCells(cells.slice(targetIndex));
  }, [runCells]);

  const interrupt = useCallback(async () => {
    interruptedRef.current = true;
    setExecutionState("interrupted");
    if (isLegacyKernel(activeKernel)) {
      await activeKernel.interrupt();
      return;
    }
    if (notebookSessionRef.current) {
      await notebookSessionRef.current.stop();
      notebookSessionRef.current = null;
      setRuntimeStatus("idle");
      return;
    }
    await activeSessionRef.current?.terminate();
  }, [activeKernel]);

  const restartKernel = useCallback(async () => {
    interruptedRef.current = true;
    executionCountRef.current = 0;
    setExecutionState("idle");
    setCurrentCellId(null);
    setProgress({ current: 0, total: 0 });
    clearRuntimeFailure();
    if (isLegacyKernel(activeKernel)) {
      await activeKernel.restart();
      return;
    }
    if (notebookSessionRef.current) {
      await notebookSessionRef.current.dispose();
      notebookSessionRef.current = null;
      setRuntimeStatus("idle");
      await prepareRuntime();
      return;
    }
    await activeSessionRef.current?.terminate();
    activeSessionRef.current = null;
  }, [activeKernel, clearRuntimeFailure, prepareRuntime]);

  const switchKernel = useCallback(async (newKernel: KernelOption | LegacyKernel) => {
    interruptedRef.current = false;
    executionCountRef.current = 0;
    await activeSessionRef.current?.terminate();
    activeSessionRef.current = null;
    if (notebookSessionRef.current) {
      await notebookSessionRef.current.dispose();
      notebookSessionRef.current = null;
    }
    clearRuntimeFailure();
    setRuntimeStatus(!isLegacyKernel(newKernel) && newKernel.runnerType === "python-pyodide" ? "ready" : "idle");
    setActiveKernel(newKernel);
  }, [clearRuntimeFailure]);

  const runtimeAvailability: NotebookRuntimeAvailability = !activeKernel
    ? "unknown"
    : notebookLanguage && notebookLanguage.toLowerCase() !== "python"
      ? "unsupported"
      : runtimeStatus === "loading"
        ? "checking"
        : runtimeStatus === "ready"
          ? "ready"
          : runtimeStatus === "error"
            ? "error"
            : hasValidatedRuntime
              ? "error"
              : "unknown";

  return {
    executionState,
    currentCellId,
    progress,
    kernel: activeKernel,
    runtimeStatus,
    runtimeAvailability,
    runtimeError,
    runtimeProblems,
    runtimeMeta,
    hasValidatedRuntime,
    prepareRuntime,
    runAll,
    runAllAbove,
    runAllBelow,
    interrupt,
    restartKernel,
    switchKernel,
    executeCell,
  };
}
