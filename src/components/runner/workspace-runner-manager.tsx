"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, RefreshCw, Settings2, X } from "lucide-react";
import { useRunnerHealth } from "@/hooks/use-runner-health";
import { ProblemsPanel } from "@/components/runner/problems-panel";
import { runnerHealthIssuesToExecutionProblems } from "@/lib/runner/problem-utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cn } from "@/lib/utils";
import type { ExecutionProblem, RunnerHealthAction } from "@/lib/runner/types";

interface WorkspaceRunnerManagerProps {
  cwd?: string;
  fileKey?: string;
  commands?: string[];
  title?: string;
  triggerLabel?: string;
  triggerClassName?: string;
}

export function WorkspaceRunnerManager({
  cwd,
  fileKey,
  commands = [],
  title = "Workspace Runner Manager",
  triggerLabel = "运行器管理",
  triggerClassName,
}: WorkspaceRunnerManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const runnerPreferences = useWorkspaceStore((state) => state.runnerPreferences);
  const setRunnerPreferences = useWorkspaceStore((state) => state.setRunnerPreferences);
  const setRecentRunConfig = useWorkspaceStore((state) => state.setRecentRunConfig);
  const clearRecentRunConfig = useWorkspaceStore((state) => state.clearRecentRunConfig);
  const {
    runnerHealthSnapshot,
    isRefreshing,
    refresh,
  } = useRunnerHealth({
    cwd,
    fileKey,
    commands,
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    void refresh();
  }, [isOpen, refresh]);

  const fileScopedSelection = fileKey ? runnerPreferences.recentRunByFile[fileKey] : undefined;
  const issueProblems = useMemo(
    () => runnerHealthIssuesToExecutionProblems(runnerHealthSnapshot.issues),
    [runnerHealthSnapshot.issues],
  );

  const applyWorkspaceDefault = async (pythonPath: string | null) => {
    setRunnerPreferences({
      defaultPythonPath: pythonPath,
    });
    await refresh();
  };

  const applyEntrySelection = async (pythonPath: string | null) => {
    if (!fileKey) {
      return;
    }

    if (!pythonPath) {
      clearRecentRunConfig(fileKey);
    } else {
      setRecentRunConfig(fileKey, {
        runnerType: "python-local",
        command: pythonPath,
      });
    }

    await refresh();
  };

  const handleProblemAction = async (_problem: ExecutionProblem, action: RunnerHealthAction) => {
    if (action.kind === "select-python") {
      await applyWorkspaceDefault(action.pythonPath ?? null);
      return;
    }

    if (action.kind === "reset-python-selection") {
      await applyWorkspaceDefault(null);
      return;
    }

    if (action.kind === "refresh") {
      await refresh();
      return;
    }

    if (action.kind === "command" && action.command) {
      try {
        await navigator.clipboard.writeText(action.command);
      } catch {
        // Ignore clipboard errors in the manager action row.
      }
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={cn(
          "inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          triggerClassName,
        )}
      >
        <Settings2 className="h-3.5 w-3.5" />
        <span>{triggerLabel}</span>
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="relative max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-lg border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <div className="text-sm font-medium">{title}</div>
                <div className="text-xs text-muted-foreground">
                  Host: {runnerHealthSnapshot.hostKind === "desktop" ? "desktop" : "web"}
                  {cwd ? ` · cwd: ${cwd}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                  <span>刷新</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid max-h-[calc(85vh-57px)] grid-cols-1 overflow-hidden lg:grid-cols-[1.4fr_1fr]">
              <div className="overflow-auto border-r border-border p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Python Interpreters</div>
                    <div className="text-xs text-muted-foreground">
                      默认解释器：{runnerHealthSnapshot.preferredPythonPath ?? "自动选择"}
                    </div>
                    {fileKey ? (
                      <div className="text-xs text-muted-foreground">
                        当前入口选择：{fileScopedSelection?.command ?? "自动选择"}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {fileKey ? (
                      <button
                        type="button"
                        onClick={() => void applyEntrySelection(null)}
                        className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        恢复当前入口自动选择
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void applyWorkspaceDefault(null)}
                      className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      清空工作区默认
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {runnerHealthSnapshot.pythonEnvironments.map((environment) => {
                    const isPreferred = environment.path === runnerHealthSnapshot.preferredPythonPath;
                    const isSelected = environment.path === runnerHealthSnapshot.selectedPythonPath;
                    const isEntrySelected = fileScopedSelection?.command === environment.path;

                    return (
                      <div key={environment.path} className="rounded-lg border border-border bg-muted/20 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-medium">
                            Python {environment.version}
                            {environment.name ? ` (${environment.envType}: ${environment.name})` : ` (${environment.envType})`}
                          </div>
                          {isPreferred ? (
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">Workspace Default</span>
                          ) : null}
                          {isSelected ? (
                            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">Active</span>
                          ) : null}
                          {isEntrySelected ? (
                            <span className="rounded bg-yellow-500/10 px-1.5 py-0.5 text-[10px] text-yellow-700 dark:text-yellow-300">Current Entry</span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">Source: {environment.source}</div>
                        <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{environment.path}</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void applyWorkspaceDefault(environment.path)}
                            className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            设为工作区默认
                          </button>
                          {fileKey ? (
                            <button
                              type="button"
                              onClick={() => void applyEntrySelection(environment.path)}
                              className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            >
                              仅当前入口使用
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}

                  {runnerHealthSnapshot.pythonEnvironments.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                      当前未检测到本地 Python 解释器。
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="overflow-auto p-4">
                <div className="mb-4">
                  <div className="mb-2 text-sm font-medium">Runner Health</div>
                  <ProblemsPanel problems={issueProblems} onAction={handleProblemAction} />
                  {issueProblems.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                      当前未发现运行器健康问题。
                    </div>
                  ) : null}
                </div>

                <div>
                  <div className="mb-2 text-sm font-medium">External Commands</div>
                  <div className="space-y-2">
                    {Object.values(runnerHealthSnapshot.commandAvailabilityByName).map((availability) => (
                      <div key={availability.command} className="rounded-lg border border-border bg-muted/20 p-3">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium">{availability.command}</div>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] ${availability.available ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-destructive/10 text-destructive"}`}>
                            {availability.available ? "Available" : "Missing"}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {availability.resolvedPath ?? availability.error ?? "未解析到命令路径"}
                        </div>
                        {availability.version ? (
                          <div className="mt-1 text-[11px] text-muted-foreground">{availability.version}</div>
                        ) : null}
                      </div>
                    ))}
                    {Object.keys(runnerHealthSnapshot.commandAvailabilityByName).length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                        当前没有需要探测的外部命令。
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">Selection Rules</div>
                  <div className="mt-2 flex items-start gap-2">
                    <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>工作区默认解释器优先于自动探测结果。</span>
                  </div>
                  <div className="mt-1 flex items-start gap-2">
                    <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>当前入口“仅当前使用”会覆盖工作区默认，但只作用于当前文件 / block / notebook。</span>
                  </div>
                  <div className="mt-1 flex items-start gap-2">
                    <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>恢复自动选择后，将重新按工作区默认与可用环境排序决定解释器。</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default WorkspaceRunnerManager;
