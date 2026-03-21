"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { runnerManager, type ExecutionSession, type PersistentPythonSession } from "@/lib/runner/runner-manager";
import type { JupyterOutput } from "@/lib/notebook-utils";
import { getExecutionOrigin } from "@/lib/runner/preferences";
import type { ExecutionPanelMeta, RunnerEvent } from "@/lib/runner/types";
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

interface UseNotebookExecutorOptions {
  kernel?: LegacyKernel | null;
  runner?: KernelOption | null;
  cwd?: string;
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

export function useNotebookExecutor(options: UseNotebookExecutorOptions = {}) {
  const { kernel, runner, cwd, onCellStart, onCellOutput, onCellComplete, onAllComplete } = options;
  const [executionState, setExecutionState] = useState<ExecutionState>("idle");
  const [currentCellId, setCurrentCellId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [activeKernel, setActiveKernel] = useState<KernelOption | LegacyKernel | null>(runner ?? kernel ?? null);
  const interruptedRef = useRef(false);
  const executionCountRef = useRef(0);
  const activeSessionRef = useRef<ExecutionSession | null>(null);
  const notebookSessionRef = useRef<PersistentPythonSession | null>(null);

  useEffect(() => {
    setActiveKernel(runner ?? kernel ?? null);
  }, [kernel, runner]);

  useEffect(() => {
    return () => {
      void activeSessionRef.current?.terminate();
      activeSessionRef.current = null;

      if (notebookSessionRef.current) {
        void notebookSessionRef.current.dispose();
        notebookSessionRef.current = null;
      }
    };
  }, []);

  const executeCellInternal = useCallback(async (
    cellId: string,
    code: string,
  ): Promise<CellExecutionResult> => {
    if (!activeKernel) {
      return {
        cellId,
        outputs: [
          {
            type: "error",
            content: {
              ename: "ExecutionError",
              evalue: "No runner available",
              traceback: ["No runner available"],
            },
          },
        ],
        executionCount: 0,
        success: false,
        panelMeta: {
          origin: null,
          diagnostics: [],
        },
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
          panelMeta: {
            origin: null,
            diagnostics: [],
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          cellId,
          outputs: [
            {
              type: "error",
              content: {
                ename: "ExecutionError",
                evalue: message,
                traceback: [message],
              },
            },
          ],
          executionCount,
          success: false,
          panelMeta: {
            origin: null,
            diagnostics: [],
          },
        };
      }
    }

    const panelMeta: ExecutionPanelMeta = {
      origin: getExecutionOrigin({
        runnerType: activeKernel.runnerType,
        mode: "cell",
        command: activeKernel.command,
      }),
      diagnostics: [],
    };

    if (isTauriHost() && activeKernel.runnerType === "python-local") {
      const shouldRecreateSession =
        !notebookSessionRef.current ||
        interruptedRef.current;

      if (shouldRecreateSession) {
        if (notebookSessionRef.current) {
          await notebookSessionRef.current.dispose();
        }
        notebookSessionRef.current = runnerManager.createPersistentPythonSession({
          command: activeKernel.command,
          cwd,
        });
      }

      interruptedRef.current = false;
      executionCountRef.current += 1;
      const executionCount = executionCountRef.current;
      const outputs: JupyterOutput[] = [];
      const startedAt = Date.now();
      const persistentSession = notebookSessionRef.current;

      if (!persistentSession) {
        return {
          cellId,
          outputs: [
            {
              output_type: "error",
              ename: "ExecutionError",
              evalue: "Failed to initialize persistent Python session",
              traceback: ["Failed to initialize persistent Python session"],
            },
          ],
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
        const failureOutput: JupyterOutput = {
          output_type: "error",
          ename: "ExecutionError",
          evalue: message,
          traceback: [message],
        };
        outputs.push(failureOutput);
        onCellOutput?.(cellId, failureOutput);
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
      const allowPyodideFallback = activeKernel.runnerType === "python-pyodide";
      const result = await session.run({
        runnerType: activeKernel.runnerType,
        command: activeKernel.command,
        code,
        cwd,
        mode: "cell",
        allowPyodideFallback,
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
      const failureOutput: JupyterOutput = {
        output_type: "error",
        ename: "ExecutionError",
        evalue: message,
        traceback: [message],
      };
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
  }, [activeKernel, cwd, onCellOutput]);

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
    if (isLegacyKernel(activeKernel)) {
      await activeKernel.restart();
      return;
    }
    if (notebookSessionRef.current) {
      await notebookSessionRef.current.dispose();
      notebookSessionRef.current = null;
      return;
    }
    await activeSessionRef.current?.terminate();
    activeSessionRef.current = null;
  }, [activeKernel]);

  const switchKernel = useCallback(async (newKernel: KernelOption | LegacyKernel) => {
    interruptedRef.current = false;
    executionCountRef.current = 0;
    await activeSessionRef.current?.terminate();
    activeSessionRef.current = null;
    if (notebookSessionRef.current) {
      await notebookSessionRef.current.dispose();
      notebookSessionRef.current = null;
    }
    setActiveKernel(newKernel);
  }, []);

  return {
    executionState,
    currentCellId,
    progress,
    kernel: activeKernel,
    runAll,
    runAllAbove,
    runAllBelow,
    interrupt,
    restartKernel,
    switchKernel,
    executeCell,
  };
}
