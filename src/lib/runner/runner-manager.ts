"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  pythonWorkerManager,
  type WorkerOutMessage,
} from "@/lib/python-worker-manager";
import { runnerEventToExecutionOutputs } from "@/lib/runner/output-utils";
import { isTauriHost } from "@/lib/storage-adapter";
import type {
  CommandAvailability,
  ExecutionDisplayData,
  ExecutionOutput,
  ExecutionRunResult,
  PythonEnvironmentInfo,
  PythonSessionExecuteRequest,
  PythonSessionStartRequest,
  RunnerEvent,
  RunnerExecutionRequest,
  RunnerStatus,
  RunnerType,
} from "@/lib/runner/types";

interface TauriRunnerEventEnvelope {
  session_id: string;
  event: string;
  payload: Record<string, unknown>;
}

type EventListener = (event: RunnerEvent) => void;
type StatusListener = (status: RunnerStatus, error?: string | null) => void;

interface PendingPythonExecution {
  resolve: (value: ExecutionRunResult) => void;
  reject: (reason?: unknown) => void;
  onEvent?: EventListener;
}

function randomSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `runner_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function mapPythonEnvironment(raw: {
  path: string;
  version: string;
  env_type: "system" | "conda" | "venv";
  name?: string;
  source: string;
}): PythonEnvironmentInfo {
  return {
    path: raw.path,
    version: raw.version,
    envType: raw.env_type,
    name: raw.name,
    source: raw.source,
  };
}

function mapCommandAvailability(raw: {
  command: string;
  available: boolean;
  resolved_path?: string | null;
  version?: string | null;
  error?: string | null;
}): CommandAvailability {
  return {
    command: raw.command,
    available: raw.available,
    resolvedPath: raw.resolved_path,
    version: raw.version,
    error: raw.error,
  };
}

function mapPyodideMessage(sessionId: string, message: WorkerOutMessage): RunnerEvent[] {
  switch (message.type) {
    case "stdout":
      return [{ type: "stdout", sessionId, payload: { text: message.content, channel: "stdout" } }];
    case "stderr":
      return [{ type: "stderr", sessionId, payload: { text: message.content, channel: "stderr" } }];
    case "image":
      return [
        {
          type: "display_data",
          sessionId,
          payload: { data: { "image/png": message.payload.replace(/^data:image\/png;base64,/, "") } },
        },
      ];
    case "html":
      return [{ type: "display_data", sessionId, payload: { data: { "text/html": message.payload } } }];
    case "svg":
      return [{ type: "display_data", sessionId, payload: { data: { "image/svg+xml": message.payload } } }];
    case "result":
      return message.value
        ? [{ type: "display_data", sessionId, payload: { data: { "text/plain": message.value } } }]
        : [];
    case "error":
      return [
        {
          type: "error",
          sessionId,
          payload: {
            message: message.error,
            traceback: message.traceback ? [message.traceback] : undefined,
          },
        },
      ];
    case "execution_complete":
      return [
        {
          type: "completed",
          sessionId,
          payload: { success: true, exitCode: 0, terminated: false },
        },
      ];
    default:
      return [];
  }
}

function mapTauriEvent(
  sessionId: string,
  envelope: TauriRunnerEventEnvelope,
): RunnerEvent | null {
  if (envelope.session_id !== sessionId) {
    return null;
  }

  const payload = envelope.payload ?? {};

  switch (envelope.event) {
    case "started":
      return {
        type: "started",
        sessionId,
        payload: {
          cwd: typeof payload.cwd === "string" ? payload.cwd : undefined,
          filePath: typeof payload.filePath === "string" ? payload.filePath : undefined,
          mode: payload.mode as RunnerExecutionRequest["mode"],
          runnerType: payload.runnerType as RunnerType,
        },
      };
    case "stdout":
      return {
        type: "stdout",
        sessionId,
        payload: { text: String(payload.text ?? ""), channel: "stdout" },
      };
    case "stderr":
      return {
        type: "stderr",
        sessionId,
        payload: { text: String(payload.text ?? ""), channel: "stderr" },
      };
    case "display_data":
      return {
        type: "display_data",
        sessionId,
        payload: { data: (payload.data ?? {}) as ExecutionDisplayData },
      };
    case "error":
      return {
        type: "error",
        sessionId,
        payload: {
          message: String(payload.message ?? "Execution failed"),
          ename: typeof payload.ename === "string" ? payload.ename : undefined,
          evalue: typeof payload.evalue === "string" ? payload.evalue : undefined,
          traceback: Array.isArray(payload.traceback)
            ? payload.traceback.filter((entry): entry is string => typeof entry === "string")
            : undefined,
        },
      };
    case "completed":
      return {
        type: "completed",
        sessionId,
        payload: {
          success: Boolean(payload.success),
          exitCode: typeof payload.exitCode === "number" ? payload.exitCode : null,
          terminated: Boolean(payload.terminated),
        },
      };
    case "terminated":
      return {
        type: "terminated",
        sessionId,
        payload: {
          success: false,
          exitCode: typeof payload.exitCode === "number" ? payload.exitCode : null,
          terminated: true,
        },
      };
    default:
      return null;
  }
}

export class ExecutionSession {
  private readonly eventListeners = new Set<EventListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private unlistenTauri?: UnlistenFn;
  private cleanupPyodideMessage?: () => void;
  private cleanupPyodideStatus?: () => void;
  private status: RunnerStatus = "idle";
  private error: string | null = null;
  private currentSessionId: string | null = null;

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status, this.error);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  getStatus(): RunnerStatus {
    return this.status;
  }

  async run(request: RunnerExecutionRequest): Promise<ExecutionRunResult> {
    const sessionId = request.sessionId ?? randomSessionId();
    this.currentSessionId = sessionId;
    this.setStatus(request.runnerType === "python-pyodide" ? "loading" : "running");
    const desktopHost = isTauriHost();

    if (request.runnerType === "python-local" && desktopHost) {
      const envs = await runnerManager.detectPythonEnvironments(request.cwd);
      if (envs.length === 0) {
        if (request.allowPyodideFallback !== false && !desktopHost) {
          return this.run({ ...request, sessionId, runnerType: "python-pyodide" });
        }
        const error = "未检测到本地 Python 解释器";
        this.emit({
          type: "error",
          sessionId,
          payload: { message: error },
        });
        this.setStatus("error", error);
        return { sessionId, success: false, exitCode: null, terminated: false };
      }
    }

    if (desktopHost && request.runnerType !== "python-pyodide") {
      return this.runWithTauri(sessionId, request);
    }

    if (request.runnerType === "python-local") {
      if (request.allowPyodideFallback !== false && !desktopHost) {
        return this.run({ ...request, sessionId, runnerType: "python-pyodide", allowPyodideFallback: false });
      }

      const error = desktopHost
        ? "桌面运行时未能接通本地 Python 执行桥接"
        : "当前网页环境不支持本地 Python 运行器";
      this.emit({
        type: "error",
        sessionId,
        payload: { message: error },
      });
      this.setStatus("error", error);
      return { sessionId, success: false, exitCode: null, terminated: false };
    }

    if (request.runnerType === "python-pyodide") {
      return this.runWithPyodide(sessionId, request);
    }

    const error = "当前环境不支持该本地运行器";
    this.emit({
      type: "error",
      sessionId,
      payload: { message: error },
    });
    this.setStatus("error", error);
    return { sessionId, success: false, exitCode: null, terminated: false };
  }

  async terminate(): Promise<void> {
    if (!this.currentSessionId) {
      return;
    }

    if (isTauriHost()) {
      await invoke("terminate_local_execution", { session_id: this.currentSessionId });
    } else {
      pythonWorkerManager.terminate();
      this.setStatus("idle");
    }
  }

  dispose(): void {
    this.unlistenTauri?.();
    this.cleanupPyodideMessage?.();
    this.cleanupPyodideStatus?.();
    this.eventListeners.clear();
    this.statusListeners.clear();
  }

  private async runWithTauri(
    sessionId: string,
    request: RunnerExecutionRequest,
  ): Promise<ExecutionRunResult> {
    this.unlistenTauri?.();

    return new Promise<ExecutionRunResult>(async (resolve, reject) => {
      try {
        this.unlistenTauri = await listen<TauriRunnerEventEnvelope>("runner://event", (event) => {
          const mapped = mapTauriEvent(sessionId, event.payload);
          if (!mapped) {
            return;
          }

          this.emit(mapped);

          if (mapped.type === "completed" || mapped.type === "terminated") {
            this.setStatus(mapped.payload.terminated ? "idle" : "ready");
            resolve({
              sessionId,
              success: mapped.payload.success,
              exitCode: mapped.payload.exitCode,
              terminated: Boolean(mapped.payload.terminated),
            });
          } else if (mapped.type === "error") {
            this.setStatus("error", mapped.payload.message);
          }
        });

        await invoke("start_local_execution", {
          request: {
            session_id: sessionId,
            runner_type: request.runnerType,
            command: request.command,
            file_path: request.filePath,
            cwd: request.cwd,
            code: request.code,
            args: request.args,
            env: request.env,
            mode: request.mode,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.setStatus("error", message);
        reject(error);
      }
    });
  }

  private async runWithPyodide(
    sessionId: string,
    request: RunnerExecutionRequest,
  ): Promise<ExecutionRunResult> {
    const code = request.code;
    if (!code) {
      const error = "Pyodide fallback 仅支持内联代码执行";
      this.emit({ type: "error", sessionId, payload: { message: error } });
      this.setStatus("error", error);
      return { sessionId, success: false, exitCode: null, terminated: false };
    }

    this.cleanupPyodideStatus?.();
    this.cleanupPyodideMessage?.();

    return new Promise<ExecutionRunResult>((resolve, reject) => {
      this.cleanupPyodideStatus = pythonWorkerManager.onStatusChange((status, error) => {
        this.setStatus(status, error ?? null);
      });

      this.cleanupPyodideMessage = pythonWorkerManager.onMessage(sessionId, (message) => {
        const events = mapPyodideMessage(sessionId, message);
        for (const event of events) {
          this.emit(event);
        }

        if (message.type === "error") {
          this.setStatus("error", message.error);
          resolve({ sessionId, success: false, exitCode: 1, terminated: false });
        }

        if (message.type === "execution_complete") {
          this.setStatus("ready");
          resolve({ sessionId, success: true, exitCode: 0, terminated: false });
        }
      });

      pythonWorkerManager
        .runCode(code, sessionId)
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.setStatus("error", message);
          reject(error);
        });
    });
  }

  private emit(event: RunnerEvent): void {
    this.eventListeners.forEach((listener) => listener(event));
  }

  private setStatus(status: RunnerStatus, error?: string | null): void {
    this.status = status;
    this.error = error ?? null;
    this.statusListeners.forEach((listener) => listener(status, this.error));
  }
}

export class PersistentPythonSession {
  private readonly eventListeners = new Set<EventListener>();
  private sessionId: string | null = null;
  private unlisten?: UnlistenFn;
  private pendingExecution: PendingPythonExecution | null = null;
  private startPromise: Promise<string> | null = null;

  constructor(
    private readonly options: Omit<PythonSessionStartRequest, "sessionId"> = {},
  ) {}

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  async start(): Promise<string> {
    if (this.sessionId) {
      return this.sessionId;
    }
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = (async () => {
      const sessionId = randomSessionId();
      this.sessionId = sessionId;
      this.unlisten = await listen<TauriRunnerEventEnvelope>("runner://event", (event) => {
        const mapped = mapTauriEvent(sessionId, event.payload);
        if (!mapped) {
          return;
        }

        this.eventListeners.forEach((listener) => listener(mapped));
        this.pendingExecution?.onEvent?.(mapped);

        if (mapped.type === "completed" || mapped.type === "terminated") {
          this.pendingExecution?.resolve({
            sessionId: mapped.sessionId,
            success: mapped.payload.success,
            exitCode: mapped.payload.exitCode,
            terminated: Boolean(mapped.payload.terminated),
          });
          this.pendingExecution = null;
        } else if (mapped.type === "error") {
          this.pendingExecution?.resolve({
            sessionId: mapped.sessionId,
            success: false,
            exitCode: 1,
            terminated: false,
          });
          this.pendingExecution = null;
        }
      });

      try {
        await invoke("start_python_session", {
          request: {
            session_id: sessionId,
            command: this.options.command,
            cwd: this.options.cwd,
            env: this.options.env,
          },
        });
        return sessionId;
      } catch (error) {
        this.unlisten?.();
        this.unlisten = undefined;
        this.sessionId = null;
        throw error;
      }
    })();

    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async execute(
    request: Omit<PythonSessionExecuteRequest, "sessionId">,
    onEvent?: EventListener,
  ): Promise<ExecutionRunResult> {
    if (!isTauriHost()) {
      throw new Error("Persistent Python session is only available in Tauri");
    }
    if (this.pendingExecution) {
      throw new Error("A Python session execution is already in progress");
    }

    const sessionId = await this.start();

    return new Promise<ExecutionRunResult>(async (resolve, reject) => {
      this.pendingExecution = { resolve, reject, onEvent };
      try {
        await invoke("execute_python_session", {
          request: {
            session_id: sessionId,
            code: request.code,
          },
        });
      } catch (error) {
        this.pendingExecution = null;
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.sessionId || !isTauriHost()) {
      return;
    }
    await invoke("stop_python_session", { session_id: this.sessionId });
    this.pendingExecution = null;
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.unlisten?.();
    this.unlisten = undefined;
    this.sessionId = null;
  }
}

export class RunnerManager {
  createSession(): ExecutionSession {
    return new ExecutionSession();
  }

  createPersistentPythonSession(
    options: Omit<PythonSessionStartRequest, "sessionId"> = {},
  ): PersistentPythonSession {
    return new PersistentPythonSession(options);
  }

  async detectPythonEnvironments(cwd?: string): Promise<PythonEnvironmentInfo[]> {
    if (!isTauriHost()) {
      return [];
    }

    const result = await invoke<
      Array<{
        path: string;
        version: string;
        env_type: "system" | "conda" | "venv";
        name?: string;
        source: string;
      }>
    >("detect_python_environments", { cwd });
    return result.map(mapPythonEnvironment);
  }

  async probeCommandAvailability(command: string): Promise<CommandAvailability> {
    if (!isTauriHost()) {
      return {
        command,
        available: false,
        error: "仅桌面端支持外部命令探测",
      };
    }

    const result = await invoke<{
      command: string;
      available: boolean;
      resolved_path?: string | null;
      version?: string | null;
      error?: string | null;
    }>("probe_command_availability", { command });
    return mapCommandAvailability(result);
  }
}

export const runnerManager = new RunnerManager();

export function runnerEventToTextOutputs(event: RunnerEvent): ExecutionOutput[] {
  return runnerEventToExecutionOutputs(event);
}
