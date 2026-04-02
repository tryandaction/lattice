export type RunnerType = "python-local" | "python-pyodide" | "external-command";

export type ExecutionMode = "file" | "selection" | "cell" | "inline";

export type RunnerStatus = "idle" | "loading" | "ready" | "running" | "error";

export type ExecutionSessionKind = "code" | "notebook";

export type ExecutionRuntimeSelectionSource =
  | "manual"
  | "current-entry"
  | "workspace-default"
  | "language-default"
  | "metadata"
  | "detected"
  | "fallback"
  | "legacy";

export type ExecutionLifecyclePhase =
  | "idle"
  | "preparing"
  | "ready"
  | "running"
  | "stopping"
  | "interrupted"
  | "completed"
  | "error";

export type ExecutionFailureStage =
  | "interpreter-discovery"
  | "kernel-selection"
  | "session-start"
  | "request-build"
  | "execution"
  | "output-parse"
  | "render"
  | "health-check"
  | "unknown";

export interface RunnerExecutionRequest {
  sessionId?: string;
  runnerType: RunnerType;
  command?: string;
  filePath?: string;
  cwd?: string;
  code?: string;
  args?: string[];
  env?: Record<string, string>;
  mode: ExecutionMode;
  allowPyodideFallback?: boolean;
}

export interface PythonSessionStartRequest {
  sessionId?: string;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface PythonSessionExecuteRequest {
  sessionId: string;
  code: string;
}

export interface ExecutionDisplayData {
  "text/plain"?: string;
  "text/html"?: string;
  "image/png"?: string;
  "image/jpeg"?: string;
  "image/svg+xml"?: string;
}

export interface ExecutionDiagnostic {
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  hint?: string;
  stage?: ExecutionFailureStage;
}

export type ExecutionContextKind = "file" | "notebook-cell" | "markdown-block" | "workspace";

export interface ExecutionContextRange {
  from: number;
  to: number;
  startLine?: number;
  endLine?: number;
}

export interface ExecutionContextRef {
  kind: ExecutionContextKind;
  filePath?: string;
  fileName?: string;
  language?: string;
  blockKey?: string;
  cellId?: string;
  label?: string;
  line?: number;
  column?: number;
  range?: ExecutionContextRange;
}

export interface ExecutionOrigin {
  runnerType: RunnerType;
  mode: ExecutionMode;
  sourceLabel: string;
  detailLabel: string;
  selectionLabel?: string;
}

export interface ExecutionPanelMeta {
  origin: ExecutionOrigin | null;
  diagnostics: ExecutionDiagnostic[];
  context?: ExecutionContextRef | null;
}

export interface ExecutionRunSummary {
  sessionId: string | null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  exitCode: number | null;
  terminated: boolean;
}

export interface ExecutionCommandState {
  canRun: boolean;
  canRerun: boolean;
  canStop: boolean;
  canInterrupt: boolean;
  canRestart: boolean;
  canVerifyRuntime: boolean;
  canSelectRuntime: boolean;
}

export interface RunnerCapabilityModel {
  supportsSelection: boolean;
  supportsPersistentSession: boolean;
  supportsNotebook: boolean;
  supportsLocalExecution: boolean;
  supportsPyodide: boolean;
  canRun: boolean;
  canStop: boolean;
  canInterrupt: boolean;
  canRestart: boolean;
}

export interface ExecutionSessionScope {
  scopeId: string;
  kind: ExecutionSessionKind;
  paneId: string;
  tabId: string;
  filePath: string;
  fileName?: string;
}

export interface NotebookExecutionSnapshot {
  executionState: "idle" | "running" | "interrupted";
  currentCellId: string | null;
  progress: {
    current: number;
    total: number;
  };
  cells: Record<string, NotebookCellExecutionState>;
}

export interface NotebookCellExecutionState {
  outputs: Array<Record<string, unknown>>;
  executionCount: number | null;
  panelMeta: ExecutionPanelMeta | null;
}

export interface ExecutionSessionProblems {
  runtime: ExecutionProblem[];
  health: ExecutionProblem[];
  external: ExecutionProblem[];
}

export interface ExecutionLastEvent {
  type: RunnerEvent["type"] | "failure";
  timestampMs: number;
  message?: string | null;
}

export interface ExecutionSessionRuntimeState {
  status: RunnerStatus;
  availability?: string | null;
  error: string | null;
  hasValidatedRuntime: boolean;
  kernelId?: string | null;
  kernelLabel?: string | null;
  kernelDescription?: string | null;
  kernelSelectionSource?: ExecutionRuntimeSelectionSource | null;
  kernelSourceLabel?: string | null;
  runnerType?: RunnerType | null;
  command?: string | null;
  cwd?: string;
  args?: string[];
}

export interface ExecutionSessionState extends ExecutionSessionScope {
  lifecyclePhase: ExecutionLifecyclePhase;
  failureStage: ExecutionFailureStage | null;
  activeRunId: string | null;
  lastCompletedRunId: string | null;
  status: RunnerStatus;
  runtime: ExecutionSessionRuntimeState;
  summary: ExecutionRunSummary;
  panelMeta: ExecutionPanelMeta;
  outputs: ExecutionOutput[];
  lastRequest: RunnerExecutionRequest | null;
  problems: ExecutionProblem[];
  problemSources: ExecutionSessionProblems;
  healthSnapshot: RunnerHealthSnapshot | null;
  commandState: ExecutionCommandState;
  capability: RunnerCapabilityModel;
  notebook: NotebookExecutionSnapshot | null;
  lastEvent: ExecutionLastEvent | null;
}

export type ExecutionOutput =
  | { type: "text"; content: string; channel?: "stdout" | "stderr" }
  | { type: "image"; content: string }
  | { type: "html"; content: string }
  | { type: "svg"; content: string }
  | { type: "error"; content: string; errorName?: string; errorValue?: string; traceback?: string[] };

export type RunnerEvent =
  | { type: "started"; sessionId: string; payload: { cwd?: string; filePath?: string; mode: ExecutionMode; runnerType: RunnerType } }
  | { type: "ready"; sessionId: string; payload: { persistent?: boolean } }
  | { type: "stdout"; sessionId: string; payload: { text: string; channel: "stdout" } }
  | { type: "stderr"; sessionId: string; payload: { text: string; channel: "stderr" } }
  | { type: "display_data"; sessionId: string; payload: { data: ExecutionDisplayData } }
  | { type: "error"; sessionId: string; payload: { message: string; ename?: string; evalue?: string; traceback?: string[] } }
  | { type: "completed"; sessionId: string; payload: { success: boolean; exitCode: number | null; terminated?: boolean; persistent?: boolean } }
  | { type: "terminated"; sessionId: string; payload: { success: false; exitCode: number | null; terminated: true; persistent?: boolean } };

export interface ExecutionRunResult {
  sessionId: string;
  success: boolean;
  exitCode: number | null;
  terminated: boolean;
}

export interface PythonEnvironmentInfo {
  path: string;
  version: string;
  envType: "system" | "conda" | "venv";
  name?: string;
  source: string;
}

export interface CommandAvailability {
  command: string;
  available: boolean;
  resolvedPath?: string | null;
  version?: string | null;
  error?: string | null;
}

export interface RunnerHealthAction {
  kind: "command" | "select-python" | "reset-python-selection" | "refresh";
  label: string;
  command?: string;
  pythonPath?: string | null;
}

export type RunnerHealthIssueCode =
  | "python_not_found"
  | "preferred_python_missing"
  | "command_not_found"
  | "web_fallback_only"
  | "session_start_failed"
  | "session_not_ready"
  | "session_terminated"
  | "invalid_cwd"
  | "notebook_runtime_mismatch";

export interface RunnerHealthIssue {
  code: RunnerHealthIssueCode;
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  hint?: string;
  actions?: RunnerHealthAction[];
}

export interface RunnerHealthSnapshot {
  hostKind: "desktop" | "web";
  pythonEnvironments: PythonEnvironmentInfo[];
  commandAvailabilityByName: Record<string, CommandAvailability>;
  preferredPythonPath: string | null;
  selectedPythonPath: string | null;
  issues: RunnerHealthIssue[];
  checkedAt: number;
}

export interface ExecutionProblem {
  id: string;
  severity: "info" | "warning" | "error";
  source: "syntax" | "preflight" | "runtime" | "health";
  title: string;
  message: string;
  hint?: string;
  code?: string;
  stage?: ExecutionFailureStage;
  errorName?: string;
  errorValue?: string;
  traceback?: string[];
  context?: ExecutionContextRef | null;
  actions?: RunnerHealthAction[];
}

export interface WorkspaceRunnerPreferences {
  defaultPythonPath: string | null;
  defaultLanguageRunners: Partial<Record<string, RunnerType>>;
  recentRunByFile: Record<
    string,
    {
      runnerType: RunnerType;
      command?: string;
      args?: string[];
    }
  >;
}
