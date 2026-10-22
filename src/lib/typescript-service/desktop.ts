"use client";

import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";

export interface TypeScriptDesktopDiagnostic {
  filePath: string;
  line: number;
  column: number;
  severity: "info" | "warning" | "error";
  code?: string | null;
  message: string;
}

export interface TypeScriptDiagnosticsRequest {
  workspaceRootPath?: string | null;
  filePath: string;
  content: string;
}

export interface TypeScriptLanguageFeatureRequest extends TypeScriptDiagnosticsRequest {
  offset: number;
}

export interface TypeScriptQuickInfoSnapshot {
  display: string;
  documentation?: string | null;
}

export interface TypeScriptDefinitionSnapshot {
  filePath: string;
  line: number;
  column: number;
}

export interface TypeScriptReferenceSnapshot {
  filePath: string;
  line: number;
  column: number;
  text?: string | null;
}

export function canUseTypeScriptDesktopService(): boolean {
  return isTauriHost();
}

export async function getTypeScriptDesktopDiagnostics(
  request: TypeScriptDiagnosticsRequest,
): Promise<TypeScriptDesktopDiagnostic[]> {
  return invokeTauriCommand<TypeScriptDesktopDiagnostic[]>(
    "desktop_typescript_diagnostics",
    {
      workspaceRootPath: request.workspaceRootPath ?? null,
      filePath: request.filePath,
      content: request.content,
    },
    { timeoutMs: 20000 },
  );
}

export async function getTypeScriptDesktopQuickInfo(
  request: TypeScriptLanguageFeatureRequest,
): Promise<TypeScriptQuickInfoSnapshot | null> {
  return invokeTauriCommand<TypeScriptQuickInfoSnapshot | null>(
    "desktop_typescript_quick_info",
    {
      workspaceRootPath: request.workspaceRootPath ?? null,
      filePath: request.filePath,
      content: request.content,
      offset: request.offset,
    },
    { timeoutMs: 20000 },
  );
}

export async function getTypeScriptDesktopDefinition(
  request: TypeScriptLanguageFeatureRequest,
): Promise<TypeScriptDefinitionSnapshot | null> {
  return invokeTauriCommand<TypeScriptDefinitionSnapshot | null>(
    "desktop_typescript_definition",
    {
      workspaceRootPath: request.workspaceRootPath ?? null,
      filePath: request.filePath,
      content: request.content,
      offset: request.offset,
    },
    { timeoutMs: 20000 },
  );
}

export async function getTypeScriptDesktopReferences(
  request: TypeScriptLanguageFeatureRequest,
): Promise<TypeScriptReferenceSnapshot[]> {
  return invokeTauriCommand<TypeScriptReferenceSnapshot[]>(
    "desktop_typescript_references",
    {
      workspaceRootPath: request.workspaceRootPath ?? null,
      filePath: request.filePath,
      content: request.content,
      offset: request.offset,
    },
    { timeoutMs: 20000 },
  );
}
