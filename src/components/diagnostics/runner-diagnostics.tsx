"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useRunnerHealth } from "@/hooks/use-runner-health";
import { runnerHealthIssuesToExecutionProblems } from "@/lib/runner/problem-utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { resolveAppRoute } from "@/lib/app-route";
import { ProblemsPanel } from "@/components/runner/problems-panel";

export function RunnerDiagnostics() {
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const {
    runnerHealthSnapshot,
    isRefreshing,
    refresh,
  } = useRunnerHealth({
    cwd: workspaceRootPath ?? undefined,
    fileKey: "__runner_diagnostics__",
    autoRefresh: true,
  });

  const issues = runnerHealthIssuesToExecutionProblems(runnerHealthSnapshot.issues);
  const livePreviewHref = resolveAppRoute("/diagnostics");

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
