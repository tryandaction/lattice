"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BugPlay,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Square,
  StepForward,
  Terminal,
  Trash2,
} from "lucide-react";
import { useExecutionRunner } from "@/hooks/use-execution-runner";
import { useI18n } from "@/hooks/use-i18n";
import { createDesktopFileHandle } from "@/lib/desktop-file-system";
import { resolveWorkspaceFilePath } from "@/lib/runner/path-utils";
import {
  buildNodeDebugLaunchRequest,
  buildPythonDebugLaunchRequest,
  buildVSCodeLaunchExecutionRequest,
  buildVSCodeTaskExecutionRequest,
} from "@/lib/vscode-compat/task-actions";
import type { DebugLaunchRequest, DebugVariable } from "@/lib/vscode-debug/desktop";
import { useVSCodeCompatStore } from "@/stores/vscode-compat-store";
import { useVSCodeDebugStore } from "@/stores/vscode-debug-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

interface VSCodeRunDebugPanelProps {
  onImportProfile: () => void;
  isImporting: boolean;
}

function DebugSection({ title, count, children }: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-8 w-full items-center gap-1 bg-muted/30 px-2 text-left"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase">{title}</span>
        {typeof count === "number" ? <span className="text-[10px] text-muted-foreground">{count}</span> : null}
      </button>
      {open ? children : null}
    </section>
  );
}

function ToolButton({ label, disabled, onClick, children }: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 shrink-0 items-center justify-center hover:bg-muted disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function VariableRows({ variables, depth = 0 }: {
  variables: DebugVariable[];
  depth?: number;
}) {
  const variablesByReference = useVSCodeDebugStore((state) => state.variablesByReference);
  const loadVariables = useVSCodeDebugStore((state) => state.loadVariables);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  return (
    <>
      {variables.map((variable, index) => {
        const reference = variable.variablesReference;
        const hasChildren = reference > 0;
        const isExpanded = expanded[reference] === true;
        const children = variablesByReference[reference] ?? [];
        return (
          <div key={`${variable.name}:${index}`}>
            <button
              type="button"
              disabled={!hasChildren}
              onClick={() => {
                if (!hasChildren) return;
                const next = !isExpanded;
                setExpanded((current) => ({ ...current, [reference]: next }));
                if (next) void loadVariables(reference);
              }}
              className="flex min-h-7 w-full min-w-0 items-center gap-1 px-2 text-left text-[11px] disabled:cursor-default"
              style={{ paddingLeft: `${8 + depth * 12}px` }}
            >
              {hasChildren
                ? (isExpanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />)
                : <span className="w-3 shrink-0" />}
              <span className="min-w-0 truncate text-foreground">{variable.name}</span>
              <span className="ml-auto max-w-[55%] truncate font-mono text-muted-foreground">{variable.value}</span>
            </button>
            {isExpanded && children.length > 0 ? <VariableRows variables={children} depth={depth + 1} /> : null}
          </div>
        );
      })}
    </>
  );
}

export function VSCodeRunDebugPanel({ onImportProfile, isImporting }: VSCodeRunDebugPanelProps) {
  const { t } = useI18n();
  const tasks = useVSCodeCompatStore((state) => state.tasks);
  const launches = useVSCodeCompatStore((state) => state.launches);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const rootName = useWorkspaceStore((state) => state.rootHandle?.name ?? state.fileTree.root?.name ?? null);
  const activeTab = useWorkspaceStore((state) => state.getActiveTab());
  const defaultPythonPath = useWorkspaceStore((state) => state.runnerPreferences.defaultPythonPath);
  const openFileInActivePane = useWorkspaceStore((state) => state.openFileInActivePane);
  const sessionId = useVSCodeDebugStore((state) => state.sessionId);
  const lifecycle = useVSCodeDebugStore((state) => state.lifecycle);
  const sessionName = useVSCodeDebugStore((state) => state.sessionName);
  const breakpoints = useVSCodeDebugStore((state) => state.breakpoints);
  const stackFrames = useVSCodeDebugStore((state) => state.stackFrames);
  const selectedFrameId = useVSCodeDebugStore((state) => state.selectedFrameId);
  const scopes = useVSCodeDebugStore((state) => state.scopes);
  const variablesByReference = useVSCodeDebugStore((state) => state.variablesByReference);
  const output = useVSCodeDebugStore((state) => state.output);
  const stopReason = useVSCodeDebugStore((state) => state.stopReason);
  const debugError = useVSCodeDebugStore((state) => state.error);
  const initializeEventListener = useVSCodeDebugStore((state) => state.initializeEventListener);
  const startDebugging = useVSCodeDebugStore((state) => state.startDebugging);
  const stopDebugging = useVSCodeDebugStore((state) => state.stopDebugging);
  const continueExecution = useVSCodeDebugStore((state) => state.continueExecution);
  const pauseExecution = useVSCodeDebugStore((state) => state.pauseExecution);
  const stepOver = useVSCodeDebugStore((state) => state.stepOver);
  const stepInto = useVSCodeDebugStore((state) => state.stepInto);
  const stepOut = useVSCodeDebugStore((state) => state.stepOut);
  const restartDebugging = useVSCodeDebugStore((state) => state.restartDebugging);
  const hydrateStoppedState = useVSCodeDebugStore((state) => state.hydrateStoppedState);
  const selectFrame = useVSCodeDebugStore((state) => state.selectFrame);
  const evaluate = useVSCodeDebugStore((state) => state.evaluate);
  const clearOutput = useVSCodeDebugStore((state) => state.clearOutput);
  const [expression, setExpression] = useState("");
  const [panelError, setPanelError] = useState<string | null>(null);

  const { run, outputs: runOutputs, status: runStatus, error: runError, isRunning } = useExecutionRunner({
    scope: {
      scopeId: "vscode-sidebar-runner",
      kind: "code",
      paneId: "vscode-sidebar",
      tabId: "vscode-sidebar",
      filePath: workspaceRootPath ?? "vscode-sidebar",
      fileName: "VS Code Tasks",
    },
    capability: { supportsLocalExecution: true, canRun: true, canStop: true },
  });

  const activeFilePath = useMemo(() => {
    if (!activeTab || activeTab.kind === "web" || activeTab.kind === "vscode-workbench") return null;
    return resolveWorkspaceFilePath(workspaceRootPath, activeTab.filePath, rootName);
  }, [activeTab, rootName, workspaceRootPath]);
  const allBreakpoints = useMemo(
    () => Object.values(breakpoints).flat().map(({ path, line }) => ({ path, line })),
    [breakpoints],
  );
  const busy = ["starting", "restarting", "stopping"].includes(lifecycle);
  const stopped = lifecycle === "stopped";
  const running = lifecycle === "running";

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void initializeEventListener().then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [initializeEventListener]);

  useEffect(() => {
    if (stopped) void hydrateStoppedState(useVSCodeDebugStore.getState().selectedThreadId);
  }, [hydrateStoppedState, stopped]);

  const submitEvaluation = (event: FormEvent) => {
    event.preventDefault();
    if (!expression.trim()) return;
    void evaluate(expression).then(() => setExpression("")).catch(() => undefined);
  };

  const startLaunch = (request: DebugLaunchRequest) => {
    setPanelError(null);
    void startDebugging(request).catch((error) => {
      setPanelError(error instanceof Error ? error.message : String(error));
    });
  };

  if (tasks.length === 0 && launches.length === 0 && !sessionId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-xs text-muted-foreground">
        <span>{t("vscode.sidebar.runDebugEmpty")}</span>
        <button
          type="button"
          disabled={isImporting}
          onClick={onImportProfile}
          className="h-8 border border-border px-3 text-foreground hover:bg-muted disabled:opacity-50"
        >
          {isImporting ? t("vscode.sidebar.importingProfile") : t("vscode.sidebar.importProfile")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {sessionId ? (
        <header className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-2">
          <ToolButton label={t("vscode.debug.continue")} disabled={!stopped || busy} onClick={() => void continueExecution()}>
            <Play className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label={t("vscode.debug.pause")} disabled={!running || busy} onClick={() => void pauseExecution()}>
            <Pause className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label={t("vscode.debug.stepOver")} disabled={!stopped || busy} onClick={() => void stepOver()}>
            <StepForward className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label={t("vscode.debug.stepInto")} disabled={!stopped || busy} onClick={() => void stepInto()}>
            <ArrowDownToLine className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label={t("vscode.debug.stepOut")} disabled={!stopped || busy} onClick={() => void stepOut()}>
            <ArrowUpFromLine className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label={t("vscode.debug.restart")} disabled={busy} onClick={() => void restartDebugging()}>
            <RotateCcw className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label={t("vscode.debug.stop")} disabled={lifecycle === "terminated" || busy} onClick={() => void stopDebugging()}>
            <Square className="h-3.5 w-3.5" />
          </ToolButton>
          <span className="ml-auto max-w-28 truncate text-[10px] text-muted-foreground" title={sessionName ?? lifecycle}>
            {busy ? <LoaderCircle className="inline h-3 w-3 animate-spin" /> : (stopReason ?? lifecycle)}
          </span>
        </header>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {launches.length > 0 ? (
          <DebugSection title={t("vscode.sidebar.launches")} count={launches.length}>
            {launches.map((launch, index) => {
              const launchType = launch.type.trim().toLowerCase();
              const debugBuild = launchType === "node" || launchType === "pwa-node"
                ? buildNodeDebugLaunchRequest(launch, { workspaceRootPath, activeFilePath })
                : buildPythonDebugLaunchRequest(launch, {
                  workspaceRootPath,
                  activeFilePath,
                  defaultPythonPath,
                });
              const runRequest = buildVSCodeLaunchExecutionRequest(launch, {
                workspaceRootPath,
                defaultPythonPath,
              });
              if (debugBuild.supported) {
                const request: DebugLaunchRequest = {
                  ...debugBuild.request,
                  breakpoints: allBreakpoints,
                };
                return (
                  <button
                    key={`${launch.name}:${index}`}
                    type="button"
                    aria-label={t("vscode.debug.start", { name: launch.name })}
                    title={launch.stopOnEntry ? t("vscode.debug.stopOnEntryWarning") : launch.name}
                    disabled={Boolean(sessionId) || busy}
                    onClick={() => startLaunch(request)}
                    className="flex h-8 w-full min-w-0 items-center gap-2 px-3 text-left text-xs hover:bg-muted disabled:opacity-40"
                  >
                    <BugPlay className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{launch.name}</span>
                  </button>
                );
              }
              return (
                <button
                  key={`${launch.name}:${index}`}
                  type="button"
                  aria-label={t("vscode.debug.run", { name: launch.name })}
                  title={debugBuild.reason}
                  disabled={!runRequest || isRunning}
                  onClick={() => runRequest && void run(runRequest)}
                  className="flex h-8 w-full min-w-0 items-center gap-2 px-3 text-left text-xs hover:bg-muted disabled:opacity-40"
                >
                  <Play className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{launch.name}</span>
                </button>
              );
            })}
          </DebugSection>
        ) : null}

        {tasks.length > 0 ? (
          <DebugSection title={t("vscode.sidebar.tasks")} count={tasks.length}>
            {tasks.map((task, index) => (
              <button
                key={`${task.label}:${index}`}
                type="button"
                aria-label={task.label}
                disabled={isRunning}
                onClick={() => void run(buildVSCodeTaskExecutionRequest(task, { workspaceRootPath }))}
                className="flex h-8 w-full min-w-0 items-center gap-2 px-3 text-left text-xs hover:bg-muted disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5" />
                <span className="truncate">{task.label}</span>
              </button>
            ))}
          </DebugSection>
        ) : null}

        <DebugSection title={t("vscode.debug.breakpoints")} count={allBreakpoints.length}>
          {allBreakpoints.map((breakpoint) => (
            <div key={`${breakpoint.path}:${breakpoint.line}`} className="flex h-7 items-center gap-2 px-3 text-[11px]">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[#d13438]" />
              <span className="min-w-0 flex-1 truncate">{breakpoint.path}</span>
              <span className="text-muted-foreground">:{breakpoint.line}</span>
            </div>
          ))}
        </DebugSection>

        {sessionId ? (
          <>
            <DebugSection title={t("vscode.debug.callStack")} count={stackFrames.length}>
              {stackFrames.map((frame) => (
                <button
                  key={frame.id}
                  type="button"
                  onClick={() => {
                    void selectFrame(frame.id);
                    if (frame.source?.path) {
                      openFileInActivePane(createDesktopFileHandle(frame.source.path), frame.source.path);
                    }
                  }}
                  className={`flex min-h-8 w-full min-w-0 flex-col justify-center px-3 text-left hover:bg-muted ${selectedFrameId === frame.id ? "bg-muted/60" : ""}`}
                >
                  <span className="truncate text-xs">{frame.name}</span>
                  <span className="truncate text-[10px] text-muted-foreground">{frame.source?.path ?? ""}:{frame.line}</span>
                </button>
              ))}
            </DebugSection>

            <DebugSection title={t("vscode.debug.variables")} count={scopes.length}>
              {scopes.map((scope) => (
                <div key={`${scope.name}:${scope.variablesReference}`}>
                  <div className="h-7 px-3 pt-1 text-[11px] font-medium">{scope.name}</div>
                  <VariableRows variables={variablesByReference[scope.variablesReference] ?? []} />
                </div>
              ))}
            </DebugSection>

            <DebugSection title={t("vscode.debug.evaluate")}>
              <form onSubmit={submitEvaluation} className="flex gap-1 p-2">
                <input
                  value={expression}
                  onChange={(event) => setExpression(event.target.value)}
                  placeholder={t("vscode.debug.expression")}
                  disabled={!stopped}
                  className="h-8 min-w-0 flex-1 border border-border bg-background px-2 text-xs outline-none focus:border-primary disabled:opacity-50"
                />
                <button
                  type="submit"
                  aria-label={t("vscode.debug.evaluate")}
                  disabled={!stopped || !expression.trim()}
                  className="flex h-8 w-8 items-center justify-center border border-border hover:bg-muted disabled:opacity-40"
                >
                  <Terminal className="h-3.5 w-3.5" />
                </button>
              </form>
            </DebugSection>
          </>
        ) : null}

        {(output.length > 0 || runOutputs.length > 0 || runStatus !== "idle" || debugError || runError || panelError) ? (
          <DebugSection title={t("vscode.debug.console")} count={output.length + runOutputs.length}>
            <div className="relative max-h-64 overflow-auto px-3 py-2 text-[11px]">
              {output.length > 0 ? (
                <button
                  type="button"
                  aria-label={t("vscode.debug.clearConsole")}
                  title={t("vscode.debug.clearConsole")}
                  onClick={clearOutput}
                  className="absolute right-2 top-1 flex h-6 w-6 items-center justify-center hover:bg-muted"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {output.slice(-100).map((entry, index) => (
                <pre key={`${entry.category}:${index}`} className="whitespace-pre-wrap break-words pr-6">{entry.output}</pre>
              ))}
              {runOutputs.slice(-20).map((entry, index) => (
                <pre key={`run:${index}`} className="whitespace-pre-wrap break-words">{"content" in entry ? entry.content : ""}</pre>
              ))}
              {debugError || runError || panelError ? (
                <div className="break-words text-destructive">{debugError || runError || panelError}</div>
              ) : null}
            </div>
          </DebugSection>
        ) : null}
      </div>
    </div>
  );
}
