"use client";

import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";

export type NativeVSCodeWorkbenchStatus = "stopped" | "preparing" | "ready" | "error" | string;

export interface NativeVSCodeWorkbenchSnapshot {
  status: NativeVSCodeWorkbenchStatus;
  phase: "stopped" | "contacting" | "downloading" | "installing" | "starting" | "ready" | "error" | string;
  elapsedSeconds: number;
  firstLaunch: boolean;
  workspacePath: string | null;
  url: string | null;
  detail: string;
  cliPath: string | null;
  bridgeStatus: "stopped" | "waiting" | "connecting" | "ready" | "error" | string;
  runtimeKind: "bundledCodeServer" | "legacyVSCodeTunnel" | null;
  runtimeVersion: string | null;
  codeOssVersion: string | null;
  profilePath: string | null;
  legacyFallback: boolean;
}

export interface VSCodeWorkbenchResourceRequest {
  requestId: number;
  path: string;
  kind: "text" | "notebook";
  line?: number;
  column?: number;
}

export type VSCodeWorkbenchAction = "focusWorkbench" | "closePrimarySidebar";

export interface VSCodeWorkbenchBridgeAcknowledgement {
  ok: boolean;
  requestId: number | null;
}

const START_STOP_TIMEOUT_MS = 15_000;
const STATUS_TIMEOUT_MS = 6_000;

export function canUseNativeVSCodeWorkbench(): boolean {
  return isTauriHost();
}

export async function startNativeVSCodeWorkbench(
  workspacePath: string,
): Promise<NativeVSCodeWorkbenchSnapshot> {
  return invokeTauriCommand<NativeVSCodeWorkbenchSnapshot>(
    "desktop_start_vscode_workbench",
    { workspacePath },
    { timeoutMs: START_STOP_TIMEOUT_MS },
  );
}

export async function getNativeVSCodeWorkbenchStatus(): Promise<NativeVSCodeWorkbenchSnapshot> {
  return invokeTauriCommand<NativeVSCodeWorkbenchSnapshot>(
    "desktop_get_vscode_workbench_status",
    undefined,
    { timeoutMs: STATUS_TIMEOUT_MS },
  );
}

export async function stopNativeVSCodeWorkbench(): Promise<NativeVSCodeWorkbenchSnapshot> {
  return invokeTauriCommand<NativeVSCodeWorkbenchSnapshot>(
    "desktop_stop_vscode_workbench",
    undefined,
    { timeoutMs: START_STOP_TIMEOUT_MS },
  );
}

export async function openNativeVSCodeWorkbenchResource(
  request: VSCodeWorkbenchResourceRequest,
): Promise<VSCodeWorkbenchBridgeAcknowledgement> {
  return invokeTauriCommand<VSCodeWorkbenchBridgeAcknowledgement>(
    "desktop_open_vscode_workbench_resource",
    { request },
    { timeoutMs: STATUS_TIMEOUT_MS },
  );
}

export async function runNativeVSCodeWorkbenchAction(
  action: VSCodeWorkbenchAction,
): Promise<VSCodeWorkbenchBridgeAcknowledgement> {
  return invokeTauriCommand<VSCodeWorkbenchBridgeAcknowledgement>(
    "desktop_run_vscode_workbench_action",
    { request: { action } },
    { timeoutMs: STATUS_TIMEOUT_MS },
  );
}
