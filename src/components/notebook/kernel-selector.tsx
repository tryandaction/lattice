"use client";

import { useState, useEffect, useCallback } from "react";
import { Check, ChevronDown, Settings, Loader2 } from "lucide-react";
import { runnerManager } from "@/lib/runner/runner-manager";
import { isTauri } from "@/lib/storage-adapter";
import type { PythonEnvironmentInfo, RunnerType } from "@/lib/runner/types";

interface KernelOption {
  id: string;
  runnerType: RunnerType;
  displayName: string;
  description: string;
  command?: string;
  pythonEnv?: PythonEnvironmentInfo;
}

export type { KernelOption };

interface KernelSelectorProps {
  currentKernel: KernelOption | null;
  onKernelChange: (kernel: KernelOption) => void;
  cwd?: string;
}

export function KernelSelector({ currentKernel, onKernelChange, cwd }: KernelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [kernelOptions, setKernelOptions] = useState<KernelOption[]>([]);

  const detectEnvironments = useCallback(async () => {
    setIsLoading(true);
    try {
      const options: KernelOption[] = [
        {
          id: "pyodide",
          runnerType: "python-pyodide",
          displayName: "Pyodide (Web Fallback)",
          description: "浏览器内 Python，适合无本地解释器时降级执行",
        },
      ];

      if (isTauri()) {
        const envs = await runnerManager.detectPythonEnvironments(cwd);
        envs.forEach((env, index) => {
          const label = env.name
            ? `Python ${env.version} (${env.envType}: ${env.name})`
            : `Python ${env.version} (${env.envType})`;

          options.unshift({
            id: `python-local-${index}`,
            runnerType: "python-local",
            displayName: label,
            description: env.path,
            command: env.path,
            pythonEnv: env,
          });
        });
      }

      setKernelOptions(options);

      if (!currentKernel) {
        onKernelChange(options[0]);
      }
    } catch (error) {
      console.error("Failed to detect notebook runtimes:", error);
      const fallback: KernelOption = {
        id: "pyodide",
        runnerType: "python-pyodide",
        displayName: "Pyodide (Web Fallback)",
        description: "浏览器内 Python，适合无本地解释器时降级执行",
      };
      setKernelOptions([fallback]);
      if (!currentKernel) {
        onKernelChange(fallback);
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentKernel, cwd, onKernelChange]);

  useEffect(() => {
    void detectEnvironments();
  }, [detectEnvironments]);

  const handleSelect = (kernel: KernelOption) => {
    onKernelChange(kernel);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm border border-border rounded hover:bg-muted transition-colors"
        disabled={isLoading}
      >
        {isLoading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>检测运行环境...</span>
          </>
        ) : (
          <>
            <span className="font-medium">
              {currentKernel?.displayName || "选择运行器"}
            </span>
            <ChevronDown className="h-3.5 w-3.5" />
          </>
        )}
      </button>

      {isOpen && !isLoading && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-96 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden">
            <div className="max-h-96 overflow-y-auto">
              {kernelOptions.map((kernel) => (
                <button
                  key={kernel.id}
                  onClick={() => handleSelect(kernel)}
                  className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted transition-colors ${
                    currentKernel?.id === kernel.id ? "bg-muted" : ""
                  }`}
                >
                  <div className="flex-shrink-0 w-4 h-4 mt-0.5">
                    {currentKernel?.id === kernel.id && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{kernel.displayName}</span>
                      {kernel.runnerType === "python-pyodide" && (
                        <span className="text-xs px-1.5 py-0.5 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded">
                          Fallback
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {kernel.description}
                    </p>
                  </div>
                </button>
              ))}

              <div className="border-t border-border" />

              <button
                onClick={() => setIsOpen(false)}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                <Settings className="h-4 w-4" />
                <span>刷新运行器列表</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
