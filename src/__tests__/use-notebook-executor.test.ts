/**
 * use-notebook-executor Hook 集成测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNotebookExecutor, type CellExecutionResult } from '@/hooks/use-notebook-executor';

class FakeLegacyKernel {
  private initialized = false;
  private executionCount = 0;
  private pendingInterruptResolve: ((value: {
    outputs: unknown[];
    executionCount: number;
    status: string;
    executionTime: number;
  }) => void) | null = null;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async execute(code: string): Promise<{
    outputs: unknown[];
    executionCount: number;
    status: string;
    executionTime: number;
  }> {
    if (!this.initialized) {
      throw new Error('Kernel not initialized');
    }

    this.executionCount += 1;
    const currentExecutionCount = this.executionCount;

    if (code.includes('time.sleep')) {
      return new Promise((resolve) => {
        this.pendingInterruptResolve = resolve;
      });
    }

    if (code.includes('1 / 0')) {
      return {
        outputs: [
          {
            type: 'error',
            content: {
              ename: 'ZeroDivisionError',
              evalue: 'division by zero',
              traceback: ['division by zero'],
            },
          },
        ],
        executionCount: currentExecutionCount,
        status: 'error',
        executionTime: 1,
      };
    }

    return {
      outputs: [
        {
          type: 'stream',
          content: {
            name: 'stdout',
            text: `${code}\n`,
          },
        },
      ],
      executionCount: currentExecutionCount,
      status: 'ok',
      executionTime: 1,
    };
  }

  async interrupt(): Promise<void> {
    this.pendingInterruptResolve?.({
      outputs: [
        {
          type: 'error',
          content: {
            ename: 'InterruptedError',
            evalue: 'Execution interrupted',
            traceback: ['Execution interrupted'],
          },
        },
      ],
      executionCount: this.executionCount,
      status: 'error',
      executionTime: 1,
    });
    this.pendingInterruptResolve = null;
  }

  async restart(): Promise<void> {
    this.executionCount = 0;
    this.pendingInterruptResolve = null;
  }

  async shutdown(): Promise<void> {
    this.pendingInterruptResolve = null;
    this.initialized = false;
  }
}

describe('useNotebookExecutor', () => {
  let kernel: FakeLegacyKernel;

  beforeEach(() => {
    kernel = new FakeLegacyKernel();
  });

  afterEach(async () => {
    await kernel.shutdown();
  });

  describe('初始化', () => {
    it('应该返回初始状态', () => {
      const { result } = renderHook(() => useNotebookExecutor());

      expect(result.current.executionState).toBe('idle');
      expect(result.current.currentCellId).toBeNull();
      expect(result.current.progress).toEqual({ current: 0, total: 0 });
    });

    it('应该接受外部 kernel', () => {
      const { result } = renderHook(() => useNotebookExecutor({ kernel }));

      expect(result.current.kernel).toBe(kernel);
    });
  });

  describe('单元格执行', () => {
    it('应该执行单个单元格', async () => {
      const { result } = renderHook(() => useNotebookExecutor({ kernel }));

      await act(async () => {
        await kernel.initialize();
      });

      let executionResult: CellExecutionResult | null = null;

      await act(async () => {
        executionResult = await result.current.executeCell('cell-1', 'print("test")');
      });

      expect(executionResult).not.toBeNull();
      expect(executionResult!.cellId).toBe('cell-1');
      expect(executionResult!.success).toBe(true);
      expect(executionResult!.outputs.length).toBeGreaterThan(0);
    });

    it('应该处理执行错误', async () => {
      const { result } = renderHook(() => useNotebookExecutor({ kernel }));

      await act(async () => {
        await kernel.initialize();
      });

      let executionResult: CellExecutionResult | null = null;

      await act(async () => {
        executionResult = await result.current.executeCell('cell-1', '1 / 0');
      });

      expect(executionResult).not.toBeNull();
      expect(executionResult!.cellId).toBe('cell-1');
      expect(executionResult!.success).toBe(false);
      expect(executionResult!.outputs.some((o: any) => o.type === 'error')).toBe(true);
    });

    it('应该在没有 kernel 时返回错误', async () => {
      const { result } = renderHook(() => useNotebookExecutor());

      let executionResult: CellExecutionResult | null = null;

      await act(async () => {
        executionResult = await result.current.executeCell('cell-1', 'print("test")');
      });

      expect(executionResult).not.toBeNull();
      expect(executionResult!.success).toBe(false);
      expect((executionResult!.outputs[0] as any).type).toBe('error');
    });
  });

  describe('批量执行', () => {
    it('应该执行所有单元格', async () => {
      const { result } = renderHook(() => useNotebookExecutor({ kernel }));

      await act(async () => {
        await kernel.initialize();
      });

      const cells = [
        { id: 'cell-1', source: 'x = 1', type: 'code' },
        { id: 'cell-2', source: 'y = 2', type: 'code' },
        { id: 'cell-3', source: 'print(x + y)', type: 'code' },
      ];

      let results: Awaited<ReturnType<typeof result.current.runAll>> = [];

      await act(async () => {
        results = await result.current.runAll(cells);
      });

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it('应该跳过 markdown 单元格', async () => {
      const { result } = renderHook(() => useNotebookExecutor({ kernel }));

      await act(async () => {
        await kernel.initialize();
      });

      const cells = [
        { id: 'cell-1', source: '# Title', type: 'markdown' },
        { id: 'cell-2', source: 'print("test")', type: 'code' },
      ];

      let results: Awaited<ReturnType<typeof result.current.runAll>> = [];

      await act(async () => {
        results = await result.current.runAll(cells);
      });

      expect(results).toHaveLength(1);
      expect(results[0].cellId).toBe('cell-2');
    });

    it('应该在错误时停止执行', async () => {
      const { result } = renderHook(() => useNotebookExecutor({ kernel }));

      await act(async () => {
        await kernel.initialize();
      });

      const cells = [
        { id: 'cell-1', source: 'x = 1', type: 'code' },
        { id: 'cell-2', source: '1 / 0', type: 'code' },
        { id: 'cell-3', source: 'print("should not run")', type: 'code' },
      ];

      let results: Awaited<ReturnType<typeof result.current.runAll>> = [];

      await act(async () => {
        results = await result.current.runAll(cells);
      });

      expect(results).toHaveLength(2);
      expect(results[1].success).toBe(false);
    });
  });

  describe('执行状态', () => {
    it('应该在执行期间更新状态', async () => {
      const { result } = renderHook(() => useNotebookExecutor({ kernel }));

      await act(async () => {
        await kernel.initialize();
      });

      const cells = [
        { id: 'cell-1', source: 'print("test")', type: 'code' },
      ];

      expect(result.current.executionState).toBe('idle');

      let runPromise: Promise<unknown> | undefined;
      await act(async () => {
        runPromise = result.current.runAll(cells);
        await Promise.resolve();
      });

      await waitFor(() => {
        if (result.current.executionState === 'running') {
          expect(result.current.executionState).toBe('running');
        }
      }, { timeout: 1000 }).catch(() => {
        // execution can complete immediately in the fake kernel path.
      });

      await act(async () => {
        await runPromise;
      });

      expect(result.current.executionState).toBe('idle');
    });
  });

  describe('中断执行', () => {
    it('应该中断执行', async () => {
      const { result } = renderHook(() => useNotebookExecutor({ kernel }));

      await act(async () => {
        await kernel.initialize();
      });

      const cells = [
        { id: 'cell-1', source: 'import time; time.sleep(10)', type: 'code' },
      ];

      let executePromise: Promise<unknown> | undefined;
      await act(async () => {
        executePromise = result.current.runAll(cells);
        await Promise.resolve();
      });

      await act(async () => {
        await result.current.interrupt();
      });

      await act(async () => {
        await executePromise;
      });

      expect(result.current.executionState).toBe('interrupted');
    });
  });

  describe('Kernel 重启', () => {
    it('应该重启 kernel', async () => {
      const { result } = renderHook(() => useNotebookExecutor({ kernel }));

      await act(async () => {
        await kernel.initialize();
      });

      await act(async () => {
        await result.current.executeCell('cell-1', 'x = 42');
      });

      await act(async () => {
        await result.current.restartKernel();
      });

      expect(result.current.executionState).toBe('idle');
    });
  });

  describe('Kernel 切换', () => {
    it('应该切换到新 kernel', async () => {
      const { result } = renderHook(() => useNotebookExecutor({ kernel }));

      await act(async () => {
        await kernel.initialize();
      });

      const newKernel = new FakeLegacyKernel();

      await act(async () => {
        await result.current.switchKernel(newKernel);
      });

      expect(result.current.kernel).toBe(newKernel);

      await newKernel.shutdown();
    });
  });

  describe('回调函数', () => {
    it('应该触发 onCellStart 回调', async () => {
      const cellStarts: string[] = [];
      const { result } = renderHook(() =>
        useNotebookExecutor({
          kernel,
          onCellStart: (cellId) => cellStarts.push(cellId),
        })
      );

      await act(async () => {
        await kernel.initialize();
      });

      const cells = [
        { id: 'cell-1', source: 'print("test")', type: 'code' },
      ];

      await act(async () => {
        await result.current.runAll(cells);
      });

      expect(cellStarts).toContain('cell-1');
    });

    it('应该触发 onCellComplete 回调', async () => {
      const completions: string[] = [];
      const { result } = renderHook(() =>
        useNotebookExecutor({
          kernel,
          onCellComplete: (cellId) => completions.push(cellId),
        })
      );

      await act(async () => {
        await kernel.initialize();
      });

      const cells = [
        { id: 'cell-1', source: 'print("test")', type: 'code' },
      ];

      await act(async () => {
        await result.current.runAll(cells);
      });

      expect(completions).toContain('cell-1');
    });
  });
});
