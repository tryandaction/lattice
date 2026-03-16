/**
 * Kernel Toolbar Component
 *
 * 提供 Jupyter Notebook 内核控制功能：
 * - 内核状态显示
 * - 重启内核
 * - 中断执行
 * - 清除所有输出
 * - 运行所有 cell
 * - 性能指标显示
 */

'use client';

import { useNotebookStore } from '@/stores/notebook-store';
import { Play, Square, RotateCcw } from 'lucide-react';

interface KernelToolbarProps {
  onRunAll: () => void;
  onRestart: () => Promise<void>;
  onInterrupt: () => void;
  onClearOutputs: () => void;
  isRunning: boolean;
  progress: { current: number; total: number };
}

export function KernelToolbar({
  onRunAll,
  onRestart,
  onInterrupt,
  onClearOutputs,
  isRunning,
  progress,
}: KernelToolbarProps) {
  const kernelStatus = useNotebookStore((state) => state.kernelStatus);
  const metrics = useNotebookStore((state) => state.metrics);

  const handleRestart = async () => {
    if (confirm('Restart kernel? All variables will be lost.')) {
      await onRestart();
      useNotebookStore.getState().reset();
    }
  };

  const getStatusColor = () => {
    switch (kernelStatus) {
      case 'ready':
      case 'idle':
        return 'bg-green-500';
      case 'busy':
        return 'bg-yellow-500 animate-pulse';
      case 'loading':
        return 'bg-blue-500 animate-pulse';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusText = () => {
    switch (kernelStatus) {
      case 'ready':
        return 'Ready';
      case 'idle':
        return 'Idle';
      case 'busy':
        return 'Busy';
      case 'loading':
        return 'Loading';
      case 'error':
        return 'Error';
      default:
        return 'Unknown';
    }
  };

  return (
    <div className="flex items-center gap-1.5 px-3 py-1 border-b border-border bg-background">
      {/* 内核状态 */}
      <div className="flex items-center gap-1.5">
        <div className={`w-1.5 h-1.5 rounded-full ${getStatusColor()}`} />
        <span className="text-xs font-medium">{getStatusText()}</span>
      </div>

      <div className="flex-1" />

      {/* 性能指标 */}
      {metrics.totalExecutions > 0 && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <div title="Last execution time">
            {metrics.lastExecutionTime.toFixed(0)}ms
          </div>
          <div title="Average execution time">
            Avg: {metrics.averageExecutionTime.toFixed(0)}ms
          </div>
        </div>
      )}

      {/* 控制按钮 */}
      <div className="flex items-center gap-1">
        {isRunning ? (
          <button
            onClick={onInterrupt}
            className="flex items-center gap-1 px-2 py-0.5 text-xs bg-destructive/10 text-destructive rounded hover:bg-destructive/20 transition-colors"
            title="Interrupt execution"
          >
            <Square className="h-3 w-3" />
            <span>Stop</span>
            {progress.total > 0 && (
              <span className="text-[10px] opacity-70">
                ({progress.current}/{progress.total})
              </span>
            )}
          </button>
        ) : (
          <button
            onClick={onRunAll}
            className="flex items-center gap-1 px-2 py-0.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
            title="Run all cells"
          >
            <Play className="h-3 w-3" />
            <span>Run All</span>
          </button>
        )}

        <button
          onClick={handleRestart}
          className="flex items-center gap-1 px-2 py-0.5 text-xs border border-border rounded hover:bg-muted transition-colors"
          title="Restart kernel"
        >
          <RotateCcw className="h-3 w-3" />
        </button>

        <button
          onClick={onClearOutputs}
          className="px-2 py-0.5 text-xs border border-border rounded hover:bg-muted transition-colors"
          title="Clear all outputs"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
