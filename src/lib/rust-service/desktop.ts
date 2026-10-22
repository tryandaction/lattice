"use client";

import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";

export interface RustDesktopDiagnostic {
  filePath: string;
  line: number;
  column: number;
  severity: "info" | "warning" | "error";
  code?: string | null;
  message: string;
}

export interface RustDesktopRequest {
  workspaceRootPath?: string | null;
  filePath: string;
  content: string;
}

export interface RustLanguageFeatureRequest extends RustDesktopRequest {
  offset: number;
}

export interface RustQuickInfoSnapshot {
  display: string;
  documentation?: string | null;
}

export interface RustDefinitionSnapshot {
  filePath: string;
  line: number;
  column: number;
}

export interface RustReferenceSnapshot {
  filePath: string;
  line: number;
  column: number;
  text?: string | null;
}

export function canUseRustDesktopService(): boolean {
  return isTauriHost();
}

export async function getRustDesktopDiagnostics(
  request: RustDesktopRequest,
): Promise<RustDesktopDiagnostic[]> {
  return invokeTauriCommand<RustDesktopDiagnostic[]>(
    "desktop_rust_diagnostics",
    {
      workspaceRootPath: request.workspaceRootPath ?? null,
      filePath: request.filePath,
      content: request.content,
    },
    { timeoutMs: 20000 },
  );
}

export async function getRustDesktopQuickInfo(
  request: RustLanguageFeatureRequest,
): Promise<RustQuickInfoSnapshot | null> {
  return invokeTauriCommand<RustQuickInfoSnapshot | null>(
    "desktop_rust_quick_info",
    {
      workspaceRootPath: request.workspaceRootPath ?? null,
      filePath: request.filePath,
      content: request.content,
      offset: request.offset,
    },
    { timeoutMs: 20000 },
  );
}

export async function getRustDesktopDefinition(
  request: RustLanguageFeatureRequest,
): Promise<RustDefinitionSnapshot | null> {
  return invokeTauriCommand<RustDefinitionSnapshot | null>(
    "desktop_rust_definition",
    {
      workspaceRootPath: request.workspaceRootPath ?? null,
      filePath: request.filePath,
      content: request.content,
      offset: request.offset,
    },
    { timeoutMs: 20000 },
  );
}

export async function getRustDesktopReferences(
  request: RustLanguageFeatureRequest,
): Promise<RustReferenceSnapshot[]> {
  return invokeTauriCommand<RustReferenceSnapshot[]>(
    "desktop_rust_references",
    {
      workspaceRootPath: request.workspaceRootPath ?? null,
      filePath: request.filePath,
      content: request.content,
      offset: request.offset,
    },
    { timeoutMs: 20000 },
  );
}
