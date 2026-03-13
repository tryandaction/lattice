/**
 * Kernel Selector Component
 *
 * 允许用户选择 Python 环境和 Kernel 类型
 */

'use client';

import { useState, useEffect } from 'react';
import { Check, ChevronDown, Settings, Loader2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

// ============================================================================
// 类型定义
// ============================================================================

interface PythonEnv {
  path: string;
  version: string;
  env_type: 'system' | 'conda' | 'venv';
  name?: string;
}

interface KernelOption {
  id: string;
  type: 'pyodide' | 'jupyter';
  displayName: string;
  description: string;
  pythonEnv?: PythonEnv;
}

export type { KernelOption };

interface KernelSelectorProps {
  currentKernel: KernelOption | null;
  onKernelChange: (kernel: KernelOption) => void;
}

// ============================================================================
// Kernel Selector 组件
// ============================================================================

export function KernelSelector({ currentKernel, onKernelChange }: KernelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [pythonEnvs, setPythonEnvs] = useState<PythonEnv[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [kernelOptions, setKernelOptions] = useState<KernelOption[]>([]);

  // 检测 Python 环境
  useEffect(() => {
    detectEnvironments();
  }, []);

  const detectEnvironments = async () => {
    setIsLoading(true);
    try {
      // 检查是否在 Tauri 环境中
      const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

      // 构建 Kernel 选项列表
      const options: KernelOption[] = [
        // Pyodide 选项（始终可用）
        {
          id: 'pyodide',
          type: 'pyodide',
          displayName: 'Pyodide (Web)',
          description: '浏览器内 Python，功能受限',
        },
      ];

      // 只在 Tauri 环境中检测本地 Python 环境
      if (isTauri) {
        try {
          const envs = await invoke<PythonEnv[]>('detect_python_environments');
          setPythonEnvs(envs);

          // 添加本地 Python 环境选项
          envs.forEach((env, index) => {
            const displayName = env.name
              ? `Python ${env.version} (${env.env_type}: ${env.name})`
              : `Python ${env.version} (${env.env_type})`;

            options.push({
              id: `jupyter-${index}`,
              type: 'jupyter',
              displayName,
              description: env.path,
              pythonEnv: env,
            });
          });
        } catch (error) {
          console.warn('Failed to detect Python environments in Tauri:', error);
          // 继续使用 Pyodide 选项
        }
      }

      setKernelOptions(options);

      // 如果没有选中的 Kernel，默认选择 Pyodide
      if (!currentKernel) {
        onKernelChange(options[0]);
      }
    } catch (error) {
      console.error('Failed to initialize kernel options:', error);
      // 如果检测失败，至少提供 Pyodide 选项
      const fallbackOption: KernelOption = {
        id: 'pyodide',
        type: 'pyodide',
        displayName: 'Pyodide (Web)',
        description: '浏览器内 Python，功能受限',
      };
      setKernelOptions([fallbackOption]);
      if (!currentKernel) {
        onKernelChange(fallbackOption);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleKernelSelect = (kernel: KernelOption) => {
    onKernelChange(kernel);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      {/* 当前选中的 Kernel */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm border border-border rounded hover:bg-muted transition-colors"
        disabled={isLoading}
      >
        {isLoading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>检测环境...</span>
          </>
        ) : (
          <>
            <span className="font-medium">
              {currentKernel?.displayName || '选择 Kernel'}
            </span>
            <ChevronDown className="h-3.5 w-3.5" />
          </>
        )}
      </button>

      {/* 下拉菜单 */}
      {isOpen && !isLoading && (
        <>
          {/* 遮罩层 */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* 菜单内容 */}
          <div className="absolute top-full left-0 mt-1 w-96 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden">
            <div className="max-h-96 overflow-y-auto">
              {kernelOptions.map((kernel) => (
                <button
                  key={kernel.id}
                  onClick={() => handleKernelSelect(kernel)}
                  className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted transition-colors ${
                    currentKernel?.id === kernel.id ? 'bg-muted' : ''
                  }`}
                >
                  {/* 选中标记 */}
                  <div className="flex-shrink-0 w-4 h-4 mt-0.5">
                    {currentKernel?.id === kernel.id && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>

                  {/* Kernel 信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">
                        {kernel.displayName}
                      </span>
                      {kernel.type === 'pyodide' && (
                        <span className="text-xs px-1.5 py-0.5 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded">
                          功能受限
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {kernel.description}
                    </p>
                  </div>
                </button>
              ))}

              {/* 分隔线 */}
              <div className="border-t border-border" />

              {/* 管理环境按钮 */}
              <button
                onClick={() => {
                  setIsOpen(false);
                  // TODO: 打开环境管理对话框
                }}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                <Settings className="h-4 w-4" />
                <span>管理环境...</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
