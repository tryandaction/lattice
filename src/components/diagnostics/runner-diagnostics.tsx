"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useRunnerHealth } from "@/hooks/use-runner-health";
import { runnerHealthIssuesToExecutionProblems } from "@/lib/runner/problem-utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { resolveAppRoute } from "@/lib/app-route";
import { ProblemsPanel } from "@/components/runner/problems-panel";
import { RUNNER_DEFINITIONS } from "@/lib/runner/extension-map";
import { runnerManager } from "@/lib/runner/runner-manager";
import { isTauriHost } from "@/lib/storage-adapter";

export function RunnerDiagnostics() {
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const [sessionValidation, setSessionValidation] = useState<{
    status: "idle" | "running" | "success" | "error";
    message: string | null;
  }>({
    status: "idle",
    message: null,
  });
  const diagnosticCommands = Object.values(RUNNER_DEFINITIONS)
    .map((definition) => definition.command)
    .filter((command): command is string => Boolean(command));
  const {
    runnerHealthSnapshot,
    isRefreshing,
    refresh,
  } = useRunnerHealth({
    cwd: workspaceRootPath ?? undefined,
    fileKey: "__runner_diagnostics__",
    commands: diagnosticCommands,
    checkPython: true,
    autoRefresh: true,
  });

  const issues = runnerHealthIssuesToExecutionProblems(runnerHealthSnapshot.issues);
  const livePreviewHref = resolveAppRoute("/diagnostics");
  const canValidateNotebookSession = isTauriHost() && Boolean(runnerHealthSnapshot.selectedPythonPath);

  const handleValidateNotebookSession = async () => {
    const selectedPythonPath = runnerHealthSnapshot.selectedPythonPath;
    if (!selectedPythonPath) {
      setSessionValidation({
        status: "error",
        message: "当前没有可用的本地 Python 解释器可用于 Notebook 会话验证。",
      });
      return;
    }

    setSessionValidation({
      status: "running",
      message: "正在验证 Notebook 本地 Python 会话启动…",
    });

    try {
      await runnerManager.validatePersistentPythonSession({
        command: selectedPythonPath,
        cwd: workspaceRootPath ?? undefined,
      });
      setSessionValidation({
        status: "success",
        message: `Notebook 本地会话已成功启动并完成握手：${selectedPythonPath}`,
      });
    } catch (error) {
      setSessionValidation({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-medium">Runner Diagnostics</h1>
          <p className="text-xs text-muted-foreground">
            复用工作区级 runner health snapshot，检查解释器、命令探测与结构化问题映射。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={livePreviewHref}
            className="rounded border border-border px-3 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            Live Preview 诊断
          </Link>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1 rounded border border-border px-3 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            <span>刷新</span>
          </button>
          <button
            type="button"
            onClick={() => void handleValidateNotebookSession()}
            disabled={!canValidateNotebookSession || sessionValidation.status === "running"}
            className="inline-flex items-center gap-1 rounded border border-border px-3 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {sessionValidation.status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            <span>验证 Notebook 会话</span>
          </button>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1.2fr_1fr]">
        <section className="overflow-auto border-r border-border p-4">
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="text-sm font-medium">Snapshot</div>
            <div className="mt-2 text-xs text-muted-foreground">
              Host: {runnerHealthSnapshot.hostKind}
            </div>
            <div className="mt-1 break-all text-xs text-muted-foreground">
              Workspace: {workspaceRootPath ?? "未打开工作区"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Preferred Python: {runnerHealthSnapshot.preferredPythonPath ?? "自动选择"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Selected Python: {runnerHealthSnapshot.selectedPythonPath ?? "未选中"}
            </div>
          </div>

          {sessionValidation.status !== "idle" ? (
            <div className={`mt-4 rounded-lg border p-4 ${sessionValidation.status === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : sessionValidation.status === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border bg-muted/20 text-muted-foreground"}`}>
              <div className="flex items-start gap-2">
                {sessionValidation.status === "error"
                  ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  : sessionValidation.status === "success"
                    ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    : <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />}
                <div>
                  <div className="text-sm font-medium">Notebook Runtime Startup</div>
                  <div className="mt-1 text-xs whitespace-pre-wrap break-words">{sessionValidation.message}</div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-4">
            <div className="mb-2 text-sm font-medium">Python Environments</div>
            <div className="space-y-2">
              {runnerHealthSnapshot.pythonEnvironments.map((environment) => (
                <div key={environment.path} className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className="text-sm font-medium">
                    Python {environment.version}
                    {environment.name ? ` (${environment.envType}: ${environment.name})` : ` (${environment.envType})`}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Source: {environment.source}</div>
                  <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{environment.path}</div>
                </div>
              ))}
              {runnerHealthSnapshot.pythonEnvironments.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  当前没有可用的本地 Python 环境。
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-4">
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
                  <div className="mt-1 break-all text-xs text-muted-foreground">
                    {availability.resolvedPath ?? availability.error ?? "未解析到命令路径"}
                  </div>
                  {availability.version ? (
                    <div className="mt-1 text-[11px] text-muted-foreground">{availability.version}</div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="overflow-auto p-4">
          <div className="mb-2 text-sm font-medium">Issues</div>
          <ProblemsPanel problems={issues} />
          {issues.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              当前没有 runner health issue。
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

export default RunnerDiagnostics;
