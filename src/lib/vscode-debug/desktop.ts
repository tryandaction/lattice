"use client";

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";
export { normalizeDebugSourcePath } from "./paths";

const DEBUG_COMMAND_TIMEOUT_MS = 15_000;
const DEBUG_LAUNCH_TIMEOUT_MS = 60_000;
const DEBUG_STOP_TIMEOUT_MS = 30_000;

export type DebugLifecycle =
  | "idle"
  | "starting"
  | "running"
  | "stopped"
  | "restarting"
  | "stopping"
  | "terminated"
  | "error";

export interface DebugSourceBreakpoint {
  path: string;
  line: number;
  verified?: boolean;
  id?: number;
  message?: string;
}

export interface PythonDebugLaunchRequest {
  kind: "python";
  name: string;
  workspaceRootPath: string;
  python?: string;
  target: { kind: "program" | "module"; value: string };
  cwd: string;
  args: string[];
  env?: Record<string, string>;
  justMyCode: boolean;
  stopOnEntry: boolean;
  subProcess: boolean;
  breakpoints: Array<Pick<DebugSourceBreakpoint, "path" | "line">>;
}

export interface NodeDebugLaunchRequest {
  kind: "node";
  name: string;
  workspaceRootPath: string;
  program: string;
  cwd: string;
  runtimeExecutable: string;
  runtimeArgs: string[];
  args: string[];
  env?: Record<string, string>;
  stopOnEntry: boolean;
  sourceMaps: boolean;
  smartStep: boolean;
  skipFiles: string[];
  outFiles: string[];
  breakpoints: Array<Pick<DebugSourceBreakpoint, "path" | "line">>;
}

export type DebugLaunchRequest = PythonDebugLaunchRequest | NodeDebugLaunchRequest;

export interface DebugSessionSnapshot {
  sessionId: string;
  name: string;
  lifecycle: DebugLifecycle;
}

export interface DebugEventEnvelope {
  sessionId: string;
  event: string;
  body: Record<string, unknown> | null;
}

export interface DebugSource {
  name?: string;
  path?: string;
}

export interface DebugThread {
  id: number;
  name: string;
}

export interface DebugStackFrame {
  id: number;
  name: string;
  source?: DebugSource;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

export interface DebugScope {
  name: string;
  variablesReference: number;
  expensive: boolean;
  presentationHint?: string;
}

export interface DebugVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
  namedVariables?: number;
  indexedVariables?: number;
  evaluateName?: string;
}

export interface DebugThreadsResponse {
  threads: DebugThread[];
}

export interface DebugStackTraceResponse {
  stackFrames: DebugStackFrame[];
  totalFrames?: number;
}

export interface DebugScopesResponse {
  scopes: DebugScope[];
}

export interface DebugVariablesResponse {
  variables: DebugVariable[];
}

export interface DebugEvaluateResponse {
  result: string;
  type?: string;
  variablesReference: number;
  namedVariables?: number;
  indexedVariables?: number;
}

function requireDesktopDebugging(): void {
  if (!isTauriHost()) {
    throw new Error("Debugging is available in the Lattice desktop build.");
  }
}

async function invokeDebugCommand<T>(
  command: string,
  payload: Record<string, unknown>,
  timeoutMs = DEBUG_COMMAND_TIMEOUT_MS,
): Promise<T> {
  requireDesktopDebugging();
  return await invokeTauriCommand<T>(command, payload, { timeoutMs });
}

export function startPythonDebugSession(
  request: PythonDebugLaunchRequest,
): Promise<DebugSessionSnapshot> {
  return invokeDebugCommand(
    "desktop_start_python_debug_session",
    { request },
    DEBUG_LAUNCH_TIMEOUT_MS,
  );
}

export function startNodeDebugSession(
  request: NodeDebugLaunchRequest,
): Promise<DebugSessionSnapshot> {
  return invokeDebugCommand(
    "desktop_start_node_debug_session",
    { request },
    DEBUG_LAUNCH_TIMEOUT_MS,
  );
}

export function getDebugSessionStatus(sessionId: string): Promise<DebugSessionSnapshot> {
  return invokeDebugCommand("desktop_get_debug_session_status", { sessionId });
}

export function setDebugBreakpoints(
  sessionId: string,
  sourcePath: string,
  lines: number[],
): Promise<{ breakpoints?: DebugSourceBreakpoint[] }> {
  return invokeDebugCommand("desktop_set_debug_breakpoints", { sessionId, sourcePath, lines });
}

function invokeThreadControl(command: string, sessionId: string, threadId: number): Promise<unknown> {
  return invokeDebugCommand(command, { sessionId, threadId });
}

export function continueDebugSession(sessionId: string, threadId: number): Promise<unknown> {
  return invokeThreadControl("desktop_continue_debug_session", sessionId, threadId);
}

export function pauseDebugSession(sessionId: string, threadId: number): Promise<unknown> {
  return invokeThreadControl("desktop_pause_debug_session", sessionId, threadId);
}

export function stepOverDebugSession(sessionId: string, threadId: number): Promise<unknown> {
  return invokeThreadControl("desktop_step_over_debug_session", sessionId, threadId);
}

export function stepIntoDebugSession(sessionId: string, threadId: number): Promise<unknown> {
  return invokeThreadControl("desktop_step_into_debug_session", sessionId, threadId);
}

export function stepOutDebugSession(sessionId: string, threadId: number): Promise<unknown> {
  return invokeThreadControl("desktop_step_out_debug_session", sessionId, threadId);
}

export function restartDebugSession(sessionId: string): Promise<unknown> {
  return invokeDebugCommand("desktop_restart_debug_session", { sessionId }, DEBUG_STOP_TIMEOUT_MS);
}

export function stopDebugSession(sessionId: string): Promise<DebugSessionSnapshot> {
  return invokeDebugCommand(
    "desktop_stop_debug_session",
    { sessionId },
    DEBUG_STOP_TIMEOUT_MS,
  );
}

export function getDebugThreads(sessionId: string): Promise<DebugThreadsResponse> {
  return invokeDebugCommand("desktop_get_debug_threads", { sessionId });
}

export function getDebugStackTrace(
  sessionId: string,
  threadId: number,
  startFrame = 0,
  levels = 50,
): Promise<DebugStackTraceResponse> {
  return invokeDebugCommand("desktop_get_debug_stack_trace", {
    sessionId,
    threadId,
    startFrame,
    levels,
  });
}

export function getDebugScopes(sessionId: string, frameId: number): Promise<DebugScopesResponse> {
  return invokeDebugCommand("desktop_get_debug_scopes", { sessionId, frameId });
}

export function getDebugVariables(
  sessionId: string,
  variablesReference: number,
  start = 0,
  count = 200,
): Promise<DebugVariablesResponse> {
  return invokeDebugCommand("desktop_get_debug_variables", {
    sessionId,
    variablesReference,
    start,
    count,
  });
}

export function evaluateDebugExpression(
  sessionId: string,
  expression: string,
  frameId?: number,
  context: "repl" | "watch" | "hover" = "watch",
): Promise<DebugEvaluateResponse> {
  return invokeDebugCommand("desktop_evaluate_debug_expression", {
    sessionId,
    expression,
    frameId,
    context,
  });
}

export async function listenDebugEvents(
  handler: (event: DebugEventEnvelope) => void,
): Promise<UnlistenFn> {
  if (!isTauriHost()) {
    return () => {};
  }
  return listen<DebugEventEnvelope>("debug://event", (event) => {
    if (event.payload) {
      handler(event.payload);
    }
  });
}
