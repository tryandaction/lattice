"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { AlertTriangle, Check, ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { buildNotebookRuntimeMessage, getLanguagePreferenceKey, getNotebookKernelPreferenceOrigin } from "@/lib/runner/preferences";
import { isTauriHost } from "@/lib/storage-adapter";
import type { PythonEnvironmentInfo, RunnerType } from "@/lib/runner/types";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useRunnerHealth } from "@/hooks/use-runner-health";
import { WorkspaceRunnerManager } from "@/components/runner/workspace-runner-manager";

interface KernelOption {
  id: string;
  runnerType: RunnerType;
  displayName: string;
  description: string;
  command?: string;
  pythonEnv?: PythonEnvironmentInfo;
  language?: string;
  selectionSource?: "manual" | "current-entry" | "workspace-default" | "metadata" | "detected" | "fallback";
  sourceLabel?: string;
  supported?: boolean;
  unsupportedReason?: string | null;
}

export type { KernelOption };

interface KernelSelectorProps {
  currentKernel: KernelOption | null;
  onKernelChange: (kernel: KernelOption) => void;
  cwd?: string;
  filePath?: string;
  notebookLanguage?: string | null;
  notebookKernelLabel?: string | null;
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

function decorateKernelOption(
  kernel: KernelOption,
  selectionSource: NonNullable<KernelOption["selectionSource"]>,
  sourceLabel: string,
): KernelOption {
  return {
    ...kernel,
    selectionSource,
    sourceLabel,
    supported: true,
    unsupportedReason: null,
  };
}

export function KernelSelector({
  currentKernel,
  onKernelChange,
  cwd,
  filePath,
  notebookLanguage,
  notebookKernelLabel,
}: KernelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [kernelOptions, setKernelOptions] = useState<KernelOption[]>([]);
  const [runtimeMessage, setRuntimeMessage] = useState<string | null>(null);
  const [hasLoadedOptions, setHasLoadedOptions] = useState(false);

  const isDesktopHost = useMemo(() => isTauriHost(), []);
  const runnerPreferences = useWorkspaceStore((state) => state.runnerPreferences);
  const setRunnerPreferences = useWorkspaceStore((state) => state.setRunnerPreferences);
  const setRecentRunConfig = useWorkspaceStore((state) => state.setRecentRunConfig);
  const languageKey = getLanguagePreferenceKey("python");
  const fileKey = filePath ?? "__notebook__";
  const normalizedNotebookLanguage = notebookLanguage?.trim().toLowerCase() ?? "python";
  const isNotebookLanguageSupported = normalizedNotebookLanguage === "python";
  const { refresh: refreshRunnerHealth } = useRunnerHealth({
    cwd,
    fileKey,
    checkPython: true,
  });

  const detectEnvironments = useCallback(async () => {
    if (!isNotebookLanguageSupported) {
      setKernelOptions([]);
      setRuntimeMessage(
        `当前 Notebook 内核为 ${notebookKernelLabel ?? notebookLanguage ?? "unknown"}，本轮仅支持 Python Notebook 执行。`,
      );
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setRuntimeMessage(null);

    try {
      const fallback = buildPyodideOption(isDesktopHost);
      let options: KernelOption[] = [fallback];
      let localOptions: KernelOption[] = [];
      const snapshot = await refreshRunnerHealth();
      const envs = snapshot.pythonEnvironments;

      if (isDesktopHost) {
        localOptions = envs.map(buildLocalKernelOption);

        options = localOptions.length > 0
          ? [...localOptions, fallback]
          : [fallback];

        setRuntimeMessage(buildNotebookRuntimeMessage(isDesktopHost, envs, runnerPreferences, fileKey));
      }

      setKernelOptions(options);
      setHasLoadedOptions(true);

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
          onKernelChange(decorateKernelOption(preferredOption, "detected", "自动探测"));
          return;
        }
        if (matchedCurrent.id !== currentKernel?.id) {
          onKernelChange(matchedCurrent);
        }
        return;
      }

      const preferredOption = recent?.runnerType === "python-pyodide"
        ? decorateKernelOption(fallback, "fallback", "当前入口回退")
        : preferredEnvironment
          ? decorateKernelOption(
              localOptions.find((option) => option.command === preferredEnvironment.path) ?? options[0],
              recent?.command === preferredEnvironment.path ? "current-entry" : runnerPreferences.defaultPythonPath === preferredEnvironment.path ? "workspace-default" : notebookKernelLabel ? "metadata" : "detected",
              recent?.command === preferredEnvironment.path
                ? "当前 Notebook 选择"
                : runnerPreferences.defaultPythonPath === preferredEnvironment.path
                  ? "工作区默认"
                  : notebookKernelLabel
                    ? `Notebook 元数据 (${notebookKernelLabel})`
                    : "自动探测",
            )
          : decorateKernelOption(options[0], options[0].runnerType === "python-pyodide" ? "fallback" : "detected", options[0].runnerType === "python-pyodide" ? "Pyodide 回退" : "自动探测");

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
        onKernelChange(decorateKernelOption(fallback, "fallback", "Pyodide 回退"));
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentKernel, fileKey, isDesktopHost, isNotebookLanguageSupported, notebookKernelLabel, notebookLanguage, onKernelChange, refreshRunnerHealth, runnerPreferences]);

  useEffect(() => {
    if (!isNotebookLanguageSupported) {
      setRuntimeMessage(
        `当前 Notebook 内核为 ${notebookKernelLabel ?? notebookLanguage ?? "unknown"}，本轮仅支持 Python Notebook 执行。`,
      );
      setKernelOptions([]);
    }
  }, [isNotebookLanguageSupported, notebookKernelLabel, notebookLanguage]);

  const handleSelect = (kernel: KernelOption) => {
    const recentKey = filePath ?? "__notebook__";
    const nextKernel = decorateKernelOption(kernel, "manual", "手动选择");
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
    onKernelChange(nextKernel);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => {
          if (!isNotebookLanguageSupported) {
            return;
          }
          if (!isOpen && !hasLoadedOptions) {
            void detectEnvironments();
          }
          setIsOpen((open) => !open);
        }}
        className="flex items-center gap-2 px-3 py-1.5 text-sm border border-border rounded hover:bg-muted transition-colors"
        disabled={isLoading || !isNotebookLanguageSupported}
      >
        {isLoading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>检测运行环境...</span>
          </>
        ) : (
          <>
            <span className="font-medium">
              {isNotebookLanguageSupported
                ? currentKernel?.displayName || "选择运行器"
                : `不支持的内核：${notebookKernelLabel ?? notebookLanguage ?? "unknown"}`}
            </span>
            <ChevronDown className="h-3.5 w-3.5" />
          </>
        )}
      </button>

      {isOpen && !isLoading && isNotebookLanguageSupported && (
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

              <div className="border-t border-border px-4 py-3 space-y-2">
                <button
                  onClick={() => void detectEnvironments()}
                  className="w-full flex items-center gap-2 rounded px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
                >
                  <RefreshCw className="h-4 w-4" />
                  <span>刷新运行器列表</span>
                </button>
                <WorkspaceRunnerManager
                  cwd={cwd}
                  fileKey={fileKey}
                  title="Notebook Runner Manager"
                  triggerLabel="打开运行器管理"
                  triggerClassName="w-full justify-center rounded px-3 py-2 text-sm hover:bg-muted"
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
