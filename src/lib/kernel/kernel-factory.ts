/**
 * Kernel Factory
 *
 * 根据配置创建相应的 Kernel 实例
 */

import { PyodideKernel } from './pyodide-kernel';
import { JupyterKernel, type JupyterKernelConfig } from './jupyter-kernel';
import type { IKernelManager, KernelType } from './kernel-manager';

// ============================================================================
// Kernel 配置
// ============================================================================

export interface KernelConfig {
  type: KernelType;
  jupyter?: JupyterKernelConfig;
}

// ============================================================================
// Kernel 工厂函数
// ============================================================================

/**
 * 创建 Kernel 实例
 */
export function createKernel(config: KernelConfig): IKernelManager {
  switch (config.type) {
    case 'pyodide':
      return new PyodideKernel();

    case 'jupyter':
      if (!config.jupyter) {
        throw new Error('Jupyter kernel config is required');
      }
      return new JupyterKernel(config.jupyter);

    default:
      throw new Error(`Unknown kernel type: ${config.type}`);
  }
}

/**
 * 检查 Kernel 类型是否可用
 */
export async function isKernelAvailable(type: KernelType): Promise<boolean> {
  switch (type) {
    case 'pyodide':
      // Pyodide 始终可用（浏览器环境）
      return true;

    case 'jupyter':
      // 检查是否在 Tauri 环境中
      try {
        if (typeof window === 'undefined') {
          return false;
        }
        const tauriWindow = window as Window & { __TAURI__?: unknown };
        return tauriWindow.__TAURI__ !== undefined;
      } catch {
        return false;
      }

    default:
      return false;
  }
}
