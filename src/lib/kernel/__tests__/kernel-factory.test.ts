/**
 * Kernel Factory 单元测试
 */

import { describe, it, expect } from 'vitest';
import { createKernel, isKernelAvailable } from '../kernel-factory';
import { PyodideKernel } from '../pyodide-kernel';
import { JupyterKernel } from '../jupyter-kernel';

describe('Kernel Factory', () => {
  describe('createKernel', () => {
    it('应该创建 Pyodide Kernel', () => {
      const kernel = createKernel({ type: 'pyodide' });
      expect(kernel).toBeInstanceOf(PyodideKernel);
    });

    it('应该创建 Jupyter Kernel', () => {
      const kernel = createKernel({
        type: 'jupyter',
        jupyter: {
          serverUrl: 'http://localhost:8888',
          kernelId: 'test-kernel-id',
        },
      });
      expect(kernel).toBeInstanceOf(JupyterKernel);
    });

    it('应该在缺少 Jupyter 配置时抛出错误', () => {
      expect(() => {
        createKernel({ type: 'jupyter' } as any);
      }).toThrow('Jupyter kernel config is required');
    });

    it('应该在未知类型时抛出错误', () => {
      expect(() => {
        createKernel({ type: 'unknown' } as any);
      }).toThrow('Unknown kernel type');
    });
  });

  describe('isKernelAvailable', () => {
    it('Pyodide 应该始终可用', async () => {
      const available = await isKernelAvailable('pyodide');
      expect(available).toBe(true);
    });

    it('Jupyter 可用性取决于 Tauri 环境', async () => {
      const available = await isKernelAvailable('jupyter');
      // 在浏览器环境中应该返回 false
      expect(typeof available).toBe('boolean');
    });
  });
});
