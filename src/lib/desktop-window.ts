"use client";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";

export type DesktopResizeDirection =
  | "north"
  | "south"
  | "east"
  | "west"
  | "north-east"
  | "north-west"
  | "south-east"
  | "south-west";

export interface DesktopWindowStatePayload {
  isMaximized: boolean;
}

function mapResizeDirection(direction: DesktopResizeDirection):
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West" {
  switch (direction) {
    case "east":
      return "East";
    case "north":
      return "North";
    case "north-east":
      return "NorthEast";
    case "north-west":
      return "NorthWest";
    case "south":
      return "South";
    case "south-east":
      return "SouthEast";
    case "south-west":
      return "SouthWest";
    case "west":
      return "West";
  }
}

function getDesktopWindow() {
  if (typeof window === "undefined" || !isTauriHost()) {
    return null;
  }

  try {
    return getCurrentWindow();
  } catch (error) {
    console.error("[DesktopWindow] getCurrentWindow failed:", error);
    return null;
  }
}

async function invokeDesktopWindowCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  try {
    return await invokeTauriCommand<T>(command, args, { timeoutMs: 4000 });
  } catch (error) {
    console.error(`[DesktopWindow] ${command} failed:`, error);
    return null;
  }
}

export function isWindowsDesktopHost(): boolean {
  if (typeof window === "undefined" || !isTauriHost()) {
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

export async function minimizeDesktopWindow(): Promise<void> {
  const desktopWindow = getDesktopWindow();
  if (desktopWindow) {
    try {
      await desktopWindow.minimize();
      return;
    } catch (error) {
      console.error("[DesktopWindow] minimize via JS API failed:", error);
    }
  }

  await invokeDesktopWindowCommand("desktop_window_minimize");
}

export async function startDesktopWindowDrag(): Promise<void> {
  const invoked = await invokeDesktopWindowCommand("desktop_window_start_dragging");
  if (invoked !== null) {
    return;
  }

  const desktopWindow = getDesktopWindow();
  if (!desktopWindow) {
    return;
  }

  await desktopWindow.startDragging();
}

export async function startDesktopWindowResize(direction: DesktopResizeDirection): Promise<void> {
  const desktopWindow = getDesktopWindow();
  if (!desktopWindow) {
    return;
  }

  await desktopWindow.startResizeDragging(mapResizeDirection(direction));
}

export async function toggleDesktopWindowMaximize(): Promise<boolean | null> {
  const desktopWindow = getDesktopWindow();
  if (desktopWindow) {
    try {
      await desktopWindow.toggleMaximize();
      return await desktopWindow.isMaximized();
    } catch (error) {
      console.error("[DesktopWindow] toggleMaximize via JS API failed:", error);
    }
  }

  const invoked = await invokeDesktopWindowCommand<boolean>("desktop_window_toggle_maximize");
  return typeof invoked === "boolean" ? invoked : null;
}

export async function isDesktopWindowMaximized(): Promise<boolean> {
  const desktopWindow = getDesktopWindow();
  if (desktopWindow) {
    try {
      return await desktopWindow.isMaximized();
    } catch (error) {
      console.error("[DesktopWindow] isMaximized via JS API failed:", error);
    }
  }

  const invoked = await invokeDesktopWindowCommand<boolean>("desktop_window_is_maximized");
  return typeof invoked === "boolean" ? invoked : false;
}

export async function closeDesktopWindow(): Promise<void> {
  const desktopWindow = getDesktopWindow();
  if (desktopWindow) {
    try {
      await desktopWindow.close();
      return;
    } catch (error) {
      console.error("[DesktopWindow] close via JS API failed:", error);
    }
  }

  await invokeDesktopWindowCommand("desktop_window_close");
}

export async function subscribeDesktopWindowState(
  onStateChange: (payload: DesktopWindowStatePayload) => void,
): Promise<() => void> {
  const desktopWindow = getDesktopWindow();
  if (!desktopWindow || !isWindowsDesktopHost()) {
    return () => {};
  }

  const emitState = async () => {
    onStateChange({
      isMaximized: await desktopWindow.isMaximized(),
    });
  };

  const unlistenResized = await desktopWindow.onResized(() => {
    void emitState();
  });
  const unlistenMoved = await desktopWindow.onMoved(() => {
    void emitState();
  });
  const unlistenScale = await desktopWindow.onScaleChanged(() => {
    void emitState();
  });

  return () => {
    unlistenResized();
    unlistenMoved();
    unlistenScale();
  };
}
