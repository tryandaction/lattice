"use client";

import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";

export interface PythonDesktopDiagnostic {
  filePath: string;
  line: number;
  column: number;
  severity: "info" | "warning" | "error";
  code?: string | null;
  message: string;
}

export interface PythonDesktopRequest {
  workspaceRootPath?: string | null;
  pythonPath?: string | null;
  filePath: string;
  content: string;
}

export interface PythonLanguageFeatureRequest extends PythonDesktopRequest {
  offset: number;
}

export interface PythonQuickInfoSnapshot {
  display: string;
  documentation?: string | null;
}

export interface PythonDefinitionSnapshot {
  filePath: string;
  line: number;
  column: number;
}

export interface PythonReferenceSnapshot {
  filePath: string;
  line: number;
  column: number;
  text?: string | null;
}

export function canUsePythonDesktopService(): boolean {
  return isTauriHost();
}

export async function getPythonDesktopDiagnostics(
  request: PythonDesktopRequest,
): Promise<PythonDesktopDiagnostic[]> {
  return invokeTauriCommand<PythonDesktopDiagnostic[]>(
    "desktop_python_diagnostics",
    {
      workspaceRootPath: request.workspaceRootPath ?? null,
      pythonPath: request.pythonPath ?? null,
      filePath: request.filePath,
      content: request.content,
    },
    { timeoutMs: 20000 },
  );
}

export async function getPythonDesktopQuickInfo(
  request: PythonLanguageFeatureRequest,
): Promise<PythonQuickInfoSnapshot | null> {
  return invokeTauriCommand<PythonQuickInfoSnapshot | null>(
    "desktop_python_quick_info",
    {
      workspaceRootPath: request.workspaceRootPath ?? null,
      pythonPath: request.pythonPath ?? null,
      filePath: request.filePath,
      content: request.content,
      offset: request.offset,
    },
    { timeoutMs: 20000 },
  );
}

export async function getPythonDesktopDefinition(
  request: PythonLanguageFeatureRequest,
): Promise<PythonDefinitionSnapshot | null> {
  return invokeTauriCommand<PythonDefinitionSnapshot | null>(
    "desktop_python_definition",
    {
      workspaceRootPath: request.workspaceRootPath ?? null,
      pythonPath: request.pythonPath ?? null,
      filePath: request.filePath,
      content: request.content,
      offset: request.offset,
    },
    { timeoutMs: 20000 },
  );
}

export async function getPythonDesktopReferences(
  request: PythonLanguageFeatureRequest,
): Promise<PythonReferenceSnapshot[]> {
  return invokeTauriCommand<PythonReferenceSnapshot[]>(
    "desktop_python_references",
    {
      workspaceRootPath: request.workspaceRootPath ?? null,
      pythonPath: request.pythonPath ?? null,
      filePath: request.filePath,
      content: request.content,
      offset: request.offset,
    },
    { timeoutMs: 20000 },
  );
}
