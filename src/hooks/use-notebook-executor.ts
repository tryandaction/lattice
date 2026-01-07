"use client";

import { useState, useCallback, useRef } from "react";
import { pythonWorkerManager, type ExecutionOutput, type WorkerOutMessage } from "@/lib/python-worker-manager";

export type ExecutionState = "idle" | "running" | "interrupted";

export interface CellExecutionResult {
  cellId: string;
  outputs: ExecutionOutput[];
  executionCount: number;
  success: boolean;
}

interface UseNotebookExecutorOptions {
  onCellStart?: (cellId: string) => void;
  onCellOutput?: (cellId: string, output: ExecutionOutput) => void;
  onCellComplete?: (cellId: string, result: CellExecutionResult) => void;
  onAllComplete?: (results: CellExecutionResult[]) => void;
}

/**
 * Hook for managing notebook cell execution
 * Supports Run All, Run All Above, Run All Below, and interruption
 */
export function useNotebookExecutor(options: UseNotebookExecutorOptions = {}) {
  const { onCellStart, onCellOutput, onCellComplete, onAllComplete } = options;
  
  const [executionState, setExecutionState] = useState<ExecutionState>("idle");
  const [currentCellId, setCurrentCellId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  
  const interruptedRef = useRef(false);
  const executionCountRef = useRef(0);

  /**
   * Execute a single cell and collect outputs
   */
  const executeCell = useCallback(async (
    cellId: string,
    code: string
  ): Promise<CellExecutionResult> => {
    return new Promise((resolve) => {
      const outputs: ExecutionOutput[] = [];
      const executionId = `${cellId}-${Date.now()}`;
      executionCountRef.current += 1;
      const executionCount = executionCountRef.current;

      // Set up message handler
      const unsubscribe = pythonWorkerManager.onMessage(executionId, (message: WorkerOutMessage) => {
        let output: ExecutionOutput | null = null;

        switch (message.type) {
          case "stdout":
            output = { type: "text", content: message.content };
            break;
          case "stderr":
            output = { type: "text", content: message.content };
            break;
          case "image":
            output = { type: "image", content: message.payload };
            break;
          case "result":
            if (message.value && message.value !== "None") {
              output = { type: "text", content: message.value };
            }
            // Execution complete - success
            unsubscribe();
            resolve({
              cellId,
              outputs,
              executionCount,
              success: true,
            });
            return;
          case "error":
            output = {
              type: "error",
              content: message.traceback || message.error,
            };
            // Execution complete - error
            unsubscribe();
            resolve({
              cellId,
              outputs: [...outputs, output],
              executionCount,
              success: false,
            });
            return;
        }

        if (output) {
          outputs.push(output);
          onCellOutput?.(cellId, output);
        }
      });

      // Start execution
      pythonWorkerManager.runCode(code, executionId).catch((error) => {
        unsubscribe();
        resolve({
          cellId,
          outputs: [{ type: "error", content: error.message }],
          executionCount,
          success: false,
        });
      });
    });
  }, [onCellOutput]);

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

    interruptedRef.current = false;
    setExecutionState("running");
    setProgress({ current: 0, total: codeCells.length });

    const results: CellExecutionResult[] = [];

    // Initialize kernel if needed
    try {
      await pythonWorkerManager.initialize();
    } catch (error) {
      setExecutionState("idle");
      return [{
        cellId: codeCells[0].id,
        outputs: [{ type: "error", content: `Kernel initialization failed: ${error}` }],
        executionCount: 0,
        success: false,
      }];
    }

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
  }, [executeCell, onCellStart, onCellComplete, onAllComplete]);

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
  const interrupt = useCallback(() => {
    interruptedRef.current = true;
    setExecutionState("interrupted");
  }, []);

  /**
   * Restart the kernel
   */
  const restartKernel = useCallback(async () => {
    interruptedRef.current = true;
    setExecutionState("idle");
    setCurrentCellId(null);
    executionCountRef.current = 0;
    await pythonWorkerManager.restart();
  }, []);

  return {
    executionState,
    currentCellId,
    progress,
    runAll,
    runAllAbove,
    runAllBelow,
    interrupt,
    restartKernel,
    executeCell,
  };
}
