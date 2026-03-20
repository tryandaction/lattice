"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { AlertTriangle, Check, ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { buildNotebookRuntimeMessage, getLanguagePreferenceKey, getNotebookKernelPreferenceOrigin } from "@/lib/runner/preferences";
import { runnerManager } from "@/lib/runner/runner-manager";
import { isTauriHost } from "@/lib/storage-adapter";
import type { PythonEnvironmentInfo, RunnerType } from "@/lib/runner/types";
import { useWorkspaceStore } from "@/stores/workspace-store";

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
  filePath?: string;
}

function buildPyodideOption(isDesktopHost: boolean): KernelOption {
  return {
    id: "pyodide",
    runnerType: "python-pyodide",
    displayName: isDesktopHost ? "Pyodide（应急回退）" : "Pyodide（浏览器内核）",
    description: isDesktopHost
      ? "仅在本地解释器不可用或临时排障时使用，不应作为桌面端默认运行器。"
      : "浏览器内 Python，适合网页环境下的轻量执行。",
  };
}

function buildLocalKernelOption(env: PythonEnvironmentInfo, index: number): KernelOption {
  const label = env.name
    ? `Python ${env.version} (${env.envType}: ${env.name})`
    : `Python ${env.version} (${env.envType})`;

  return {
    id: `python-local-${index}:${env.path}`,
    runnerType: "python-local",
    displayName: label,
    description: env.path,
    command: env.path,
    pythonEnv: env,
  };
}

export function KernelSelector({ currentKernel, onKernelChange, cwd, filePath }: KernelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [kernelOptions, setKernelOptions] = useState<KernelOption[]>([]);
  const [runtimeMessage, setRuntimeMessage] = useState<string | null>(null);

  const isDesktopHost = useMemo(() => isTauriHost(), []);
  const runnerPreferences = useWorkspaceStore((state) => state.runnerPreferences);
  const setRunnerPreferences = useWorkspaceStore((state) => state.setRunnerPreferences);
  const setRecentRunConfig = useWorkspaceStore((state) => state.setRecentRunConfig);
  const languageKey = getLanguagePreferenceKey("python");

  const detectEnvironments = useCallback(async () => {
    setIsLoading(true);
    setRuntimeMessage(null);

    try {
      const fallback = buildPyodideOption(isDesktopHost);
      let options: KernelOption[] = [fallback];
      let localOptions: KernelOption[] = [];
      const fileKey = filePath ?? "__notebook__";

      if (isDesktopHost) {
        const envs = await runnerManager.detectPythonEnvironments(cwd);
        localOptions = envs.map(buildLocalKernelOption);

        options = localOptions.length > 0
          ? [...localOptions, fallback]
          : [fallback];

        setRuntimeMessage(buildNotebookRuntimeMessage(isDesktopHost, envs, runnerPreferences, fileKey));
      }

      setKernelOptions(options);

      const recent = runnerPreferences.recentRunByFile[fileKey];
      const preferredEnvironment = getNotebookKernelPreferenceOrigin(
        localOptions.map((option) => option.pythonEnv).filter((env): env is PythonEnvironmentInfo => Boolean(env)),
        runnerPreferences,
        fileKey,
      );

      const matchedCurrent = currentKernel
        ? options.find((option) => option.id === currentKernel.id || option.command === currentKernel.command)
        : null;

      const shouldPromotePreferredOption =
        isDesktopHost &&
        currentKernel?.runnerType === "python-pyodide" &&
        recent?.runnerType !== "python-pyodide" &&
        localOptions.length > 0;

      if (matchedCurrent) {
        if (shouldPromotePreferredOption) {
          const preferredOption = preferredEnvironment
            ? localOptions.find((option) => option.command === preferredEnvironment.path) ?? options[0]
            : options[0];
          onKernelChange(preferredOption);
          return;
        }
        if (matchedCurrent.id !== currentKernel?.id) {
          onKernelChange(matchedCurrent);
        }
        return;
      }

      const preferredOption =
        recent?.runnerType === "python-pyodide"
          ? fallback
          : preferredEnvironment
            ? localOptions.find((option) => option.command === preferredEnvironment.path) ?? options[0]
            : options[0];

      if (!currentKernel || preferredOption.id !== currentKernel.id) {
        onKernelChange(preferredOption);
      }
    } catch (error) {
      console.error("Failed to detect notebook runtimes:", error);
      const fallback = buildPyodideOption(isDesktopHost);
      setKernelOptions([fallback]);
      setRuntimeMessage(
        isDesktopHost
          ? "桌面运行器探测失败，当前只保留 Pyodide 应急回退。请刷新运行器列表并检查本地 Python 环境。"
          : "网页环境下仅提供 Pyodide 浏览器内核。",
      );
      if (!currentKernel) {
        onKernelChange(fallback);
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentKernel, cwd, filePath, isDesktopHost, onKernelChange, runnerPreferences]);

  useEffect(() => {
    void detectEnvironments();
  }, [detectEnvironments]);

  const handleSelect = (kernel: KernelOption) => {
    const recentKey = filePath ?? "__notebook__";
    setRecentRunConfig(recentKey, {
      runnerType: kernel.runnerType,
      command: kernel.command,
    });
    setRunnerPreferences({
      defaultLanguageRunners: {
        [languageKey]: kernel.runnerType,
      },
      defaultPythonPath: kernel.runnerType === "python-local" ? kernel.command ?? null : runnerPreferences.defaultPythonPath,
    });
    onKernelChange(kernel);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen((open) => !open)}
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
          <div className="absolute top-full left-0 mt-1 w-[28rem] bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden">
            <div className="max-h-96 overflow-y-auto">
              <div className="border-b border-border px-4 py-3 text-xs text-muted-foreground">
                当前环境：{isDesktopHost ? "桌面运行时" : "网页运行时"}
              </div>

              {runtimeMessage && (
                <div className="border-b border-border bg-yellow-500/10 px-4 py-3 text-xs text-yellow-700 dark:text-yellow-300 flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{runtimeMessage}</span>
                </div>
              )}

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
                      {kernel.runnerType === "python-pyodide" ? (
                        <span className="text-xs px-1.5 py-0.5 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 rounded">
                          {isDesktopHost ? "Fallback" : "Browser"}
                        </span>
                      ) : (
                        <span className="text-xs px-1.5 py-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 rounded">
                          Desktop
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 break-all">
                      {kernel.description}
                    </p>
                  </div>
                </button>
              ))}

              <div className="border-t border-border" />

              <button
                onClick={() => void detectEnvironments()}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                <span>刷新运行器列表</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
