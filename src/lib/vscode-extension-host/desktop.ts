"use client";

import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";
import type {
  VSCodeHostCommandResult,
  VSCodeHostInteractionResponse,
  VSCodeHostSnapshot,
  VSCodeHostDocumentSyncRequest,
  VSCodeHostLanguageFeatureRequest,
  VSCodeHostLanguageFeatureResponse,
  VSCodeHostOpenDocumentRequest,
  VSCodeHostStartRequest,
  VSCodeHostTreeContent,
  VSCodeHostWebviewContent,
  VSCodeHostWebviewMessageResult,
} from "@/lib/vscode-extension-host/types";

const HOST_TIMEOUT_MS = 15_000;

export function canUseVSCodeExtensionHost(): boolean {
  return isTauriHost();
}

export async function startVSCodeExtensionHost(request: VSCodeHostStartRequest): Promise<VSCodeHostSnapshot> {
  return invokeTauriCommand<VSCodeHostSnapshot>(
    "desktop_start_vscode_extension_host",
    {
      request: {
        workspaceRootPath: request.workspaceRootPath ?? null,
        configuration: request.configuration ?? {},
        extensions: request.extensions,
      },
    },
    { timeoutMs: HOST_TIMEOUT_MS },
  );
}

export async function stopVSCodeExtensionHost(): Promise<VSCodeHostSnapshot> {
  return invokeTauriCommand<VSCodeHostSnapshot>(
    "desktop_stop_vscode_extension_host",
    undefined,
    { timeoutMs: HOST_TIMEOUT_MS },
  );
}

export async function getVSCodeExtensionHostSnapshot(): Promise<VSCodeHostSnapshot> {
  return invokeTauriCommand<VSCodeHostSnapshot>(
    "desktop_get_vscode_extension_host_snapshot",
    undefined,
    { timeoutMs: 4000 },
  );
}

export async function activateVSCodeExtensionHostExtension(extensionId: string): Promise<VSCodeHostSnapshot> {
  return invokeTauriCommand<VSCodeHostSnapshot>(
    "desktop_activate_vscode_extension",
    { request: { extensionId } },
    { timeoutMs: HOST_TIMEOUT_MS },
  );
}

export async function activateVSCodeExtensionHostView(viewId: string): Promise<VSCodeHostSnapshot> {
  return invokeTauriCommand<VSCodeHostSnapshot>(
    "desktop_activate_vscode_extension_view",
    { request: { viewId } },
    { timeoutMs: HOST_TIMEOUT_MS },
  );
}

export async function runVSCodeExtensionHostCommand(commandId: string, args: unknown[] = []): Promise<VSCodeHostCommandResult> {
  return invokeTauriCommand<VSCodeHostCommandResult>(
    "desktop_run_vscode_extension_command",
    { request: args.length > 0 ? { commandId, args } : { commandId } },
    { timeoutMs: HOST_TIMEOUT_MS },
  );
}

export async function resolveVSCodeExtensionHostInteraction(
  response: VSCodeHostInteractionResponse,
): Promise<VSCodeHostCommandResult> {
  return invokeTauriCommand<VSCodeHostCommandResult>(
    "desktop_resolve_vscode_extension_interaction",
    { request: response },
    { timeoutMs: HOST_TIMEOUT_MS },
  );
}

export async function openVSCodeExtensionHostDocument(request: VSCodeHostOpenDocumentRequest): Promise<VSCodeHostSnapshot> {
  return invokeTauriCommand<VSCodeHostSnapshot>(
    "desktop_open_vscode_extension_document",
    {
      request: {
        filePath: request.filePath,
        languageId: request.languageId,
        content: request.content,
        version: request.version,
      },
    },
    { timeoutMs: HOST_TIMEOUT_MS },
  );
}

export async function changeVSCodeExtensionHostDocument(
  request: VSCodeHostDocumentSyncRequest,
): Promise<VSCodeHostSnapshot> {
  return invokeTauriCommand<VSCodeHostSnapshot>(
    "desktop_change_vscode_extension_document",
    { request },
    { timeoutMs: HOST_TIMEOUT_MS },
  );
}

export async function saveVSCodeExtensionHostDocument(
  request: VSCodeHostDocumentSyncRequest,
): Promise<VSCodeHostSnapshot> {
  return invokeTauriCommand<VSCodeHostSnapshot>(
    "desktop_save_vscode_extension_document",
    { request },
    { timeoutMs: HOST_TIMEOUT_MS },
  );
}

export async function requestVSCodeExtensionHostLanguageFeature(
  request: VSCodeHostLanguageFeatureRequest,
): Promise<VSCodeHostLanguageFeatureResponse> {
  return invokeTauriCommand<VSCodeHostLanguageFeatureResponse>(
    "desktop_request_vscode_extension_language_feature",
    { request },
    { timeoutMs: 1800 },
  );
}

export async function resolveVSCodeExtensionHostView(viewId: string): Promise<VSCodeHostWebviewContent> {
  return invokeTauriCommand<VSCodeHostWebviewContent>(
    "desktop_resolve_vscode_extension_view",
    { request: { viewId } },
    { timeoutMs: HOST_TIMEOUT_MS },
  );
}

export async function postVSCodeExtensionHostViewMessage(
  viewId: string,
  message: unknown,
): Promise<VSCodeHostWebviewMessageResult> {
  return invokeTauriCommand<VSCodeHostWebviewMessageResult>(
    "desktop_post_vscode_extension_view_message",
    { request: { viewId, message } },
    { timeoutMs: HOST_TIMEOUT_MS },
  );
}

export async function drainVSCodeExtensionHostViewMessages(
  viewId: string,
): Promise<VSCodeHostWebviewMessageResult> {
  return invokeTauriCommand<VSCodeHostWebviewMessageResult>(
    "desktop_post_vscode_extension_view_message",
    { request: { viewId, drainOnly: true } },
    { timeoutMs: HOST_TIMEOUT_MS },
  );
}

export async function resolveVSCodeExtensionHostTree(viewId: string): Promise<VSCodeHostTreeContent> {
  return invokeTauriCommand<VSCodeHostTreeContent>(
    "desktop_resolve_vscode_extension_tree",
    { request: { viewId } },
    { timeoutMs: HOST_TIMEOUT_MS },
  );
}
