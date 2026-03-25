"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, Loader2, RefreshCw, Settings2, X, XCircle } from "lucide-react";
import { useRunnerHealth } from "@/hooks/use-runner-health";
import { ProblemsPanel } from "@/components/runner/problems-panel";
import { runnerHealthIssuesToExecutionProblems } from "@/lib/runner/problem-utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cn } from "@/lib/utils";
import type { ExecutionProblem, RunnerHealthAction } from "@/lib/runner/types";
import { runnerManager } from "@/lib/runner/runner-manager";
import { useI18n } from "@/hooks/use-i18n";

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
  title,
  triggerLabel,
  triggerClassName,
}: WorkspaceRunnerManagerProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [sessionValidation, setSessionValidation] = useState<{
    status: "idle" | "running" | "success" | "error";
    message: string | null;
  }>({
    status: "idle",
    message: null,
  });
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
    checkPython: true,
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

  const handleValidateNotebookSession = async () => {
    if (runnerHealthSnapshot.hostKind !== "desktop") {
      setSessionValidation({
        status: "error",
        message: t("workbench.runner.manager.sessionUnsupported"),
      });
      return;
    }

    if (!runnerHealthSnapshot.selectedPythonPath) {
      setSessionValidation({
        status: "error",
        message: t("workbench.runner.manager.sessionMissingPython"),
      });
      return;
    }

    setSessionValidation({
      status: "running",
      message: t("workbench.runner.manager.sessionChecking"),
    });

    try {
      await runnerManager.validatePersistentPythonSession({
        command: runnerHealthSnapshot.selectedPythonPath,
        cwd,
      });
      setSessionValidation({
        status: "success",
        message: t("workbench.runner.manager.sessionSuccess", { path: runnerHealthSnapshot.selectedPythonPath }),
      });
    } catch (error) {
      setSessionValidation({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
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
        <span>{triggerLabel ?? t("workbench.runner.trigger")}</span>
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="relative max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-lg border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <div className="text-sm font-medium">{title ?? t("workbench.runner.managerCode")}</div>
                <div className="text-xs text-muted-foreground">
                  {t("workbench.runner.manager.host")}: {runnerHealthSnapshot.hostKind === "desktop" ? t("workbench.runner.manager.desktop") : t("workbench.runner.manager.web")}
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
                  <span>{t("workbench.runner.manager.refresh")}</span>
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
                    <div className="text-sm font-medium">{t("workbench.runner.manager.pythonInterpreters")}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("workbench.runner.manager.workspaceDefault")}：{runnerHealthSnapshot.preferredPythonPath ?? t("workbench.runner.manager.autoSelect")}
                    </div>
                    {fileKey ? (
                      <div className="text-xs text-muted-foreground">
                        {t("workbench.runner.manager.currentEntry")}：{fileScopedSelection?.command ?? t("workbench.runner.manager.autoSelect")}
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
                        {t("workbench.runner.manager.resetEntry")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void applyWorkspaceDefault(null)}
                      className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {t("workbench.runner.manager.clearWorkspaceDefault")}
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
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{t("workbench.runner.manager.workspaceDefault")}</span>
                          ) : null}
                          {isSelected ? (
                            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">{t("workbench.runner.manager.active")}</span>
                          ) : null}
                          {isEntrySelected ? (
                            <span className="rounded bg-yellow-500/10 px-1.5 py-0.5 text-[10px] text-yellow-700 dark:text-yellow-300">{t("workbench.runner.manager.currentEntry")}</span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{t("workbench.runner.manager.source")}: {environment.source}</div>
                        <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{environment.path}</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void applyWorkspaceDefault(environment.path)}
                            className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            {t("workbench.runner.manager.setWorkspaceDefault")}
                          </button>
                          {fileKey ? (
                            <button
                              type="button"
                              onClick={() => void applyEntrySelection(environment.path)}
                              className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            >
                              {t("workbench.runner.manager.useForEntry")}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}

                  {runnerHealthSnapshot.pythonEnvironments.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                      {t("workbench.runner.manager.noPython")}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="overflow-auto p-4">
                <div className="mb-4">
                  <div className="mb-2 text-sm font-medium">{t("workbench.runner.manager.healthTitle")}</div>
                  <ProblemsPanel problems={issueProblems} onAction={handleProblemAction} />
                  {issueProblems.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                      {t("workbench.runner.manager.noHealthIssues")}
                    </div>
                  ) : null}
                </div>

                <div className="mb-4">
                  <div className="mb-2 text-sm font-medium">{t("workbench.runner.manager.sessionTitle")}</div>
                  <button
                    type="button"
                    onClick={() => void handleValidateNotebookSession()}
                    disabled={sessionValidation.status === "running"}
                    className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    {sessionValidation.status === "running"
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <CheckCircle2 className="h-4 w-4" />}
                    <span>{t("workbench.runner.manager.validateSession")}</span>
                  </button>
                  {sessionValidation.status !== "idle" ? (
                    <div className={`mt-3 rounded-lg border p-3 text-xs ${sessionValidation.status === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : sessionValidation.status === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border bg-muted/20 text-muted-foreground"}`}>
                      <div className="flex items-start gap-2">
                        {sessionValidation.status === "error"
                          ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          : sessionValidation.status === "success"
                            ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                            : <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />}
                        <div className="whitespace-pre-wrap break-words">{sessionValidation.message}</div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div>
                  <div className="mb-2 text-sm font-medium">{t("workbench.runner.manager.commandsTitle")}</div>
                  <div className="space-y-2">
                    {Object.values(runnerHealthSnapshot.commandAvailabilityByName).map((availability) => (
                      <div key={availability.command} className="rounded-lg border border-border bg-muted/20 p-3">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium">{availability.command}</div>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] ${availability.available ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-destructive/10 text-destructive"}`}>
                            {availability.available ? t("workbench.runner.manager.commandAvailable") : t("workbench.runner.manager.commandMissing")}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {availability.resolvedPath ?? availability.error ?? t("workbench.runner.manager.commandUnresolved")}
                        </div>
                        {availability.version ? (
                          <div className="mt-1 text-[11px] text-muted-foreground">{availability.version}</div>
                        ) : null}
                      </div>
                    ))}
                    {Object.keys(runnerHealthSnapshot.commandAvailabilityByName).length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                        {t("workbench.runner.manager.noCommands")}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">{t("workbench.runner.manager.selectionRules")}</div>
                  <div className="mt-2 flex items-start gap-2">
                    <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{t("workbench.runner.manager.ruleDefault")}</span>
                  </div>
                  <div className="mt-1 flex items-start gap-2">
                    <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{t("workbench.runner.manager.ruleEntry")}</span>
                  </div>
                  <div className="mt-1 flex items-start gap-2">
                    <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{t("workbench.runner.manager.ruleAuto")}</span>
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
