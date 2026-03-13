"use client";

import { useState, useCallback, useRef } from "react";
import type { IKernelManager, ExecutionOutput as KernelExecutionOutput, KernelStatus } from "@/lib/kernel/kernel-manager";
import { createKernel } from "@/lib/kernel/kernel-factory";

export type ExecutionState = "idle" | "running" | "interrupted";

export interface CellExecutionResult {
  cellId: string;
  outputs: KernelExecutionOutput[];
  executionCount: number;
  success: boolean;
  executionTime?: number;
  variables?: Record<string, any>;
}

interface UseNotebookExecutorOptions {
  kernel?: IKernelManager;
  onCellStart?: (cellId: string) => void;
  onCellOutput?: (cellId: string, output: KernelExecutionOutput) => void;
  onCellComplete?: (cellId: string, result: CellExecutionResult) => void;
  onAllComplete?: (results: CellExecutionResult[]) => void;
}

/**
 * Hook for managing notebook cell execution
 * Supports Run All, Run All Above, Run All Below, and interruption
 */
export function useNotebookExecutor(options: UseNotebookExecutorOptions = {}) {
  const { kernel: externalKernel, onCellStart, onCellOutput, onCellComplete, onAllComplete } = options;

  const [executionState, setExecutionState] = useState<ExecutionState>("idle");
  const [currentCellId, setCurrentCellId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [kernel, setKernel] = useState<IKernelManager | null>(externalKernel || null);

  const interruptedRef = useRef(false);
  const executionCountRef = useRef(0);

  /**
   * Execute a single cell and collect outputs
   */
  const executeCell = useCallback(async (
    cellId: string,
    code: string
  ): Promise<CellExecutionResult> => {
    if (!kernel) {
      return {
        cellId,
        outputs: [{
          type: "error",
          content: {
            ename: "KernelError",
            evalue: "No kernel available",
            traceback: ["No kernel available"],
          }
        }],
        executionCount: 0,
        success: false,
      };
    }

    executionCountRef.current += 1;
    const executionCount = executionCountRef.current;

    try {
      const result = await kernel.execute(code, {
        silent: false,
        storeHistory: true,
      });

      // Convert outputs and notify
      result.outputs.forEach(output => {
        onCellOutput?.(cellId, output);
      });

      return {
        cellId,
        outputs: result.outputs,
        executionCount: result.executionCount || executionCount,
        success: result.status === "ok",
        executionTime: result.executionTime,
        variables: result.variables,
      };
    } catch (error) {
      const errorOutput: KernelExecutionOutput = {
        type: "error",
        content: {
          ename: "ExecutionError",
          evalue: error instanceof Error ? error.message : String(error),
          traceback: [error instanceof Error ? error.message : String(error)],
        },
      };
      return {
        cellId,
        outputs: [errorOutput],
        executionCount,
        success: false,
      };
    }
  }, [kernel, onCellOutput]);

  /**
   * Run multiple cells sequentially
   */
  const runCells = useCallback(async (
    cells: Array<{ id: string; source: string; type: string }>
  ): Promise<CellExecutionResult[]> => {
    // Filter to only code cells
    const codeCells = cells.filter(cell => cell.type === "code");

    if (codeCells.length === 0) {
      return [];
    }

    // Initialize kernel if needed
    if (!kernel) {
      const defaultKernel = createKernel({ type: "pyodide" });
      setKernel(defaultKernel);
      try {
        await defaultKernel.initialize();
      } catch (error) {
        return [{
          cellId: codeCells[0].id,
          outputs: [{
            type: "error",
            content: {
              ename: "KernelError",
              evalue: `Kernel initialization failed: ${error}`,
              traceback: [`Kernel initialization failed: ${error}`],
            }
          }],
          executionCount: 0,
          success: false,
        }];
      }
    }

    interruptedRef.current = false;
    setExecutionState("running");
    setProgress({ current: 0, total: codeCells.length });

    const results: CellExecutionResult[] = [];

    // Execute cells sequentially
    for (let i = 0; i < codeCells.length; i++) {
      // Check for interruption
      if (interruptedRef.current) {
        setExecutionState("interrupted");
        break;
      }

      const cell = codeCells[i];
      setCurrentCellId(cell.id);
      setProgress({ current: i + 1, total: codeCells.length });
      onCellStart?.(cell.id);

      const result = await executeCell(cell.id, cell.source);
      results.push(result);
      onCellComplete?.(cell.id, result);

      // Stop on error (optional - could make this configurable)
      if (!result.success) {
        break;
      }
    }

    setExecutionState("idle");
    setCurrentCellId(null);
    setProgress({ current: 0, total: 0 });
    onAllComplete?.(results);

    return results;
  }, [kernel, executeCell, onCellStart, onCellComplete, onAllComplete]);

  /**
   * Run all cells in the notebook
   */
  const runAll = useCallback(async (
    cells: Array<{ id: string; source: string; type: string }>
  ) => {
    return runCells(cells);
  }, [runCells]);

  /**
   * Run all cells above (and including) the specified cell
   */
  const runAllAbove = useCallback(async (
    cells: Array<{ id: string; source: string; type: string }>,
    targetCellId: string
  ) => {
    const targetIndex = cells.findIndex(c => c.id === targetCellId);
    if (targetIndex === -1) return [];
    
    const cellsToRun = cells.slice(0, targetIndex + 1);
    return runCells(cellsToRun);
  }, [runCells]);

  /**
   * Run all cells below (and including) the specified cell
   */
  const runAllBelow = useCallback(async (
    cells: Array<{ id: string; source: string; type: string }>,
    targetCellId: string
  ) => {
    const targetIndex = cells.findIndex(c => c.id === targetCellId);
    if (targetIndex === -1) return [];
    
    const cellsToRun = cells.slice(targetIndex);
    return runCells(cellsToRun);
  }, [runCells]);

  /**
   * Interrupt the current execution
   */
  const interrupt = useCallback(async () => {
    interruptedRef.current = true;
    setExecutionState("interrupted");
    if (kernel) {
      try {
        await kernel.interrupt();
      } catch (error) {
        console.error("Failed to interrupt kernel:", error);
      }
    }
  }, [kernel]);

  /**
   * Restart the kernel
   */
  const restartKernel = useCallback(async () => {
    interruptedRef.current = true;
    setExecutionState("idle");
    setCurrentCellId(null);
    executionCountRef.current = 0;
    if (kernel) {
      try {
        await kernel.restart();
      } catch (error) {
        console.error("Failed to restart kernel:", error);
      }
    }
  }, [kernel]);

  /**
   * Switch to a different kernel
   */
  const switchKernel = useCallback(async (newKernel: IKernelManager) => {
    // Shutdown old kernel
    if (kernel) {
      try {
        await kernel.shutdown();
      } catch (error) {
        console.error("Failed to shutdown old kernel:", error);
      }
    }

    // Initialize new kernel
    setKernel(newKernel);
    executionCountRef.current = 0;
    try {
      await newKernel.initialize();
    } catch (error) {
      console.error("Failed to initialize new kernel:", error);
      throw error;
    }
  }, [kernel]);

  return {
    executionState,
    currentCellId,
    progress,
    kernel,
    runAll,
    runAllAbove,
    runAllBelow,
    interrupt,
    restartKernel,
    switchKernel,
    executeCell,
  };
}
