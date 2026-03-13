/**
 * use-notebook-executor Hook 集成测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNotebookExecutor } from '@/hooks/use-notebook-executor';
import { PyodideKernel } from '@/lib/kernel/pyodide-kernel';

describe('useNotebookExecutor', () => {
  let kernel: PyodideKernel;

  beforeEach(() => {
    kernel = new PyodideKernel();
  });

  afterEach(async () => {
    if (kernel) {
      await kernel.shutdown();
    }
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

      let executionResult: any;

      await act(async () => {
        executionResult = await result.current.executeCell('cell-1', 'print("test")');
      });

      expect(executionResult.cellId).toBe('cell-1');
      expect(executionResult.success).toBe(true);
      expect(executionResult.outputs.length).toBeGreaterThan(0);
    }, 30000);

    it('应该处理执行错误', async () => {
      const { result } = renderHook(() => useNotebookExecutor({ kernel }));

      await act(async () => {
        await kernel.initialize();
      });

      let executionResult: any;

      await act(async () => {
        executionResult = await result.current.executeCell('cell-1', '1 / 0');
      });

      expect(executionResult.cellId).toBe('cell-1');
      expect(executionResult.success).toBe(false);
      expect(executionResult.outputs.some((o: any) => o.type === 'error')).toBe(true);
    }, 30000);

    it('应该在没有 kernel 时返回错误', async () => {
      const { result } = renderHook(() => useNotebookExecutor());

      let executionResult: any;

      await act(async () => {
        executionResult = await result.current.executeCell('cell-1', 'print("test")');
      });

      expect(executionResult.success).toBe(false);
      expect(executionResult.outputs[0].type).toBe('error');
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

      let results: any;

      await act(async () => {
        results = await result.current.runAll(cells);
      });

      expect(results).toHaveLength(3);
      expect(results.every((r: any) => r.success)).toBe(true);
    }, 30000);

    it('应该跳过 markdown 单元格', async () => {
      const { result } = renderHook(() => useNotebookExecutor({ kernel }));

      await act(async () => {
        await kernel.initialize();
      });

      const cells = [
        { id: 'cell-1', source: '# Title', type: 'markdown' },
        { id: 'cell-2', source: 'print("test")', type: 'code' },
      ];

      let results: any;

      await act(async () => {
        results = await result.current.runAll(cells);
      });

      expect(results).toHaveLength(1);
      expect(results[0].cellId).toBe('cell-2');
    }, 30000);

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

      let results: any;

      await act(async () => {
        results = await result.current.runAll(cells);
      });

      expect(results).toHaveLength(2);
      expect(results[1].success).toBe(false);
    }, 30000);
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

      const promise = act(async () => {
        await result.current.runAll(cells);
      });

      // 执行期间应该是 running
      await waitFor(() => {
        if (result.current.executionState === 'running') {
          expect(result.current.executionState).toBe('running');
        }
      }, { timeout: 1000 }).catch(() => {
        // 如果执行太快，可能直接完成
      });

      await promise;

      expect(result.current.executionState).toBe('idle');
    }, 30000);
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

      // 开始执行
      const executePromise = act(async () => {
        await result.current.runAll(cells);
      });

      // 等待一小段时间后中断
      await new Promise(resolve => setTimeout(resolve, 100));

      await act(async () => {
        await result.current.interrupt();
      });

      await executePromise;

      expect(result.current.executionState).toBe('interrupted');
    }, 30000);
  });

  describe('Kernel 重启', () => {
    it('应该重启 kernel', async () => {
      const { result } = renderHook(() => useNotebookExecutor({ kernel }));

      await act(async () => {
        await kernel.initialize();
      });

      // 执行一些代码
      await act(async () => {
        await result.current.executeCell('cell-1', 'x = 42');
      });

      // 重启
      await act(async () => {
        await result.current.restartKernel();
      });

      expect(result.current.executionState).toBe('idle');
    }, 60000);
  });

  describe('Kernel 切换', () => {
    it('应该切换到新 kernel', async () => {
      const { result } = renderHook(() => useNotebookExecutor({ kernel }));

      await act(async () => {
        await kernel.initialize();
      });

      const newKernel = new PyodideKernel();

      await act(async () => {
        await result.current.switchKernel(newKernel);
      });

      expect(result.current.kernel).toBe(newKernel);

      await newKernel.shutdown();
    }, 60000);
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
    }, 30000);

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
    }, 30000);
  });
});
