/**
 * Notebook Store
 *
 * 管理 Jupyter Notebook 的全局状态，包括：
 * - 内核状态
 * - 变量命名空间
 * - 执行历史
 * - 性能指标
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface VariableInfo {
  type: string;
  value: string;
  size: number | null;
  shape: string | null;
}

export interface ExecutionRecord {
  id: string;
  timestamp: number;
  duration: number;
  success: boolean;
}

export type KernelStatus = 'idle' | 'loading' | 'ready' | 'busy' | 'error';

interface NotebookState {
  // 内核状态
  kernelStatus: KernelStatus;
  kernelError: string | null;

  // 变量命名空间
  variables: Map<string, VariableInfo>;

  // 执行历史
  executionHistory: ExecutionRecord[];

  // 性能指标
  metrics: {
    lastExecutionTime: number;
    totalExecutions: number;
    averageExecutionTime: number;
  };

  // Actions
  setKernelStatus: (status: KernelStatus, error?: string) => void;
  updateVariables: (vars: Record<string, VariableInfo>) => void;
  recordExecution: (record: ExecutionRecord) => void;
  clearHistory: () => void;
  reset: () => void;
}

const initialState = {
  kernelStatus: 'idle' as KernelStatus,
  kernelError: null,
  variables: new Map<string, VariableInfo>(),
  executionHistory: [],
  metrics: {
    lastExecutionTime: 0,
    totalExecutions: 0,
    averageExecutionTime: 0,
  },
};

export const useNotebookStore = create<NotebookState>()(
  immer((set) => ({
    ...initialState,

    setKernelStatus: (status, error) =>
      set((state) => {
        state.kernelStatus = status;
        state.kernelError = error || null;
      }),

    updateVariables: (vars) =>
      set((state) => {
        state.variables = new Map(Object.entries(vars));
      }),

    recordExecution: (record) =>
      set((state) => {
        state.executionHistory.push(record);

        // 只保留最近 100 条记录
        if (state.executionHistory.length > 100) {
          state.executionHistory.shift();
        }

        // 更新性能指标
        state.metrics.totalExecutions++;
        state.metrics.lastExecutionTime = record.duration;

        // 计算平均执行时间
        const total = state.executionHistory.reduce((sum, r) => sum + r.duration, 0);
        state.metrics.averageExecutionTime = total / state.executionHistory.length;
      }),

    clearHistory: () =>
      set((state) => {
        state.executionHistory = [];
        state.metrics = {
          lastExecutionTime: 0,
          totalExecutions: 0,
          averageExecutionTime: 0,
        };
      }),

    reset: () => set(initialState),
  }))
);
