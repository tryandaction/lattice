"use client";

import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";

export function canUseDesktopOpeners(): boolean {
  return isTauriHost();
}

export async function openDesktopPath(path: string): Promise<void> {
  await openPath(path);
}

export async function revealDesktopPath(path: string): Promise<void> {
  await revealItemInDir(path);
}

export async function openDesktopTerminalAtPath(path: string): Promise<void> {
  await invokeTauriCommand("desktop_open_terminal_at_path", { path }, { timeoutMs: 4000 });
}

export async function openDesktopVSCode(filePath: string, workspacePath?: string | null): Promise<void> {
  await invokeTauriCommand(
    "desktop_open_in_vscode",
    { filePath, workspacePath: workspacePath ?? null },
    { timeoutMs: 4000 },
  );
}
