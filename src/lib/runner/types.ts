export type RunnerType = "python-local" | "python-pyodide" | "external-command";

export type ExecutionMode = "file" | "selection" | "cell" | "inline";

export type RunnerStatus = "idle" | "loading" | "ready" | "running" | "error";

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
}

export interface ExecutionOrigin {
  runnerType: RunnerType;
  mode: ExecutionMode;
  sourceLabel: string;
  detailLabel: string;
}

export interface ExecutionPanelMeta {
  origin: ExecutionOrigin | null;
  diagnostics: ExecutionDiagnostic[];
}

export type ExecutionOutput =
  | { type: "text"; content: string; channel?: "stdout" | "stderr" }
  | { type: "image"; content: string }
  | { type: "html"; content: string }
  | { type: "svg"; content: string }
  | { type: "error"; content: string; errorName?: string; errorValue?: string; traceback?: string[] };

export type RunnerEvent =
  | { type: "started"; sessionId: string; payload: { cwd?: string; filePath?: string; mode: ExecutionMode; runnerType: RunnerType } }
  | { type: "stdout"; sessionId: string; payload: { text: string; channel: "stdout" } }
  | { type: "stderr"; sessionId: string; payload: { text: string; channel: "stderr" } }
  | { type: "display_data"; sessionId: string; payload: { data: ExecutionDisplayData } }
  | { type: "error"; sessionId: string; payload: { message: string; ename?: string; evalue?: string; traceback?: string[] } }
  | { type: "completed"; sessionId: string; payload: { success: boolean; exitCode: number | null; terminated?: boolean } }
  | { type: "terminated"; sessionId: string; payload: { success: false; exitCode: number | null; terminated: true } };

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
