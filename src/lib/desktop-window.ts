"use client";

import { getTauriInvoke, isTauri } from "@/lib/storage-adapter";

export function isWindowsDesktopHost(): boolean {
  if (typeof window === "undefined" || !isTauri()) {
    return false;
  }

  const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platformCandidates = [
    userAgentData?.platform,
    navigator.platform,
    navigator.userAgent,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  return platformCandidates.some((value) => /win(dows)?/i.test(value));
}

async function invokeDesktopWindowCommand<T>(command: string): Promise<T | null> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    return null;
  }

  try {
    return await invoke<T>(command);
  } catch {
    return null;
  }
}

export async function minimizeDesktopWindow(): Promise<void> {
  await invokeDesktopWindowCommand("desktop_window_minimize");
}

export async function toggleDesktopWindowMaximize(): Promise<boolean | null> {
  return invokeDesktopWindowCommand<boolean>("desktop_window_toggle_maximize");
}

export async function isDesktopWindowMaximized(): Promise<boolean> {
  const result = await invokeDesktopWindowCommand<boolean>("desktop_window_is_maximized");
  return Boolean(result);
}

export async function closeDesktopWindow(): Promise<void> {
  await invokeDesktopWindowCommand("desktop_window_close");
}
