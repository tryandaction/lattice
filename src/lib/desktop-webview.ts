"use client";

import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface DesktopWebviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopNativeWebviewSnapshot {
  label: string;
  currentUrl: string;
  title: string | null;
  status: "idle" | "mounting" | "ready" | "error" | string;
  lastError: string | null;
}

export interface DesktopNativeWebviewRequestEvent {
  label: string;
  url: string;
  disposition: string;
}

export interface DesktopNativeWebviewDownloadEventPayload {
  label: string;
  phase: "requested" | "finished";
  url: string;
  path: string | null;
  success: boolean | null;
}

function canManageDesktopWebviews(): boolean {
  return isTauriHost();
}

export function getDesktopWebviewLabelForTab(tabId: string): string {
  return `lattice-webview:${tabId}`.replace(/[^a-zA-Z0-9\-/:_]/g, "_");
}

export function buildDesktopWebviewDataDirectory(url: string): string {
  try {
    const parsed = new URL(url);
    const originKey = `${parsed.protocol.replace(":", "")}_${parsed.hostname}_${parsed.port || "default"}`
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    return `embedded-web/${originKey}`;
  } catch {
    return "embedded-web/default";
  }
}

export async function ensureDesktopWebview(input: {
  label: string;
  windowLabel: string;
  url: string;
  rect: DesktopWebviewRect;
  visible: boolean;
  focus: boolean;
}): Promise<DesktopNativeWebviewSnapshot | null> {
  if (!canManageDesktopWebviews()) {
    return null;
  }

  return invokeTauriCommand<DesktopNativeWebviewSnapshot>(
    "desktop_native_webview_mount",
    {
      label: input.label,
      windowLabel: input.windowLabel,
      url: input.url,
      x: input.rect.x,
      y: input.rect.y,
      width: input.rect.width,
      height: input.rect.height,
      visible: input.visible,
      focus: input.focus,
    },
    { timeoutMs: 20000 },
  );
}

export async function updateDesktopWebviewRect(label: string, rect: DesktopWebviewRect): Promise<void> {
  if (!canManageDesktopWebviews()) {
    return;
  }

  await invokeTauriCommand("desktop_native_webview_update_bounds", {
    label,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  });
}

export async function setDesktopWebviewVisibility(
  label: string,
  visible: boolean,
  focus = false,
): Promise<void> {
  if (!canManageDesktopWebviews()) {
    return;
  }

  await invokeTauriCommand("desktop_native_webview_set_visibility", {
    label,
    visible,
    focus,
  });
}

export async function showDesktopWebview(label: string): Promise<void> {
  return setDesktopWebviewVisibility(label, true, true);
}

export async function hideDesktopWebview(label: string): Promise<void> {
  return setDesktopWebviewVisibility(label, false, false);
}

export async function destroyDesktopWebview(label: string): Promise<void> {
  if (!canManageDesktopWebviews()) {
    return;
  }

  await invokeTauriCommand("desktop_native_webview_close", { label });
}

export async function getDesktopWebviewState(label: string): Promise<DesktopNativeWebviewSnapshot | null> {
  if (!canManageDesktopWebviews()) {
    return null;
  }

  return invokeTauriCommand<DesktopNativeWebviewSnapshot | null>(
    "desktop_native_webview_get_state",
    { label },
  );
}

export async function navigateDesktopWebview(
  label: string,
  url: string,
): Promise<DesktopNativeWebviewSnapshot | null> {
  if (!canManageDesktopWebviews()) {
    return null;
  }

  return invokeTauriCommand<DesktopNativeWebviewSnapshot>("desktop_native_webview_navigate", {
    label,
    url,
  });
}

export async function reloadDesktopWebview(label: string): Promise<void> {
  if (!canManageDesktopWebviews()) {
    return;
  }

  await invokeTauriCommand("desktop_native_webview_reload", { label });
}

export async function goBackDesktopWebview(label: string): Promise<void> {
  if (!canManageDesktopWebviews()) {
    return;
  }

  await invokeTauriCommand("desktop_native_webview_go_back", { label });
}

export async function goForwardDesktopWebview(label: string): Promise<void> {
  if (!canManageDesktopWebviews()) {
    return;
  }

  await invokeTauriCommand("desktop_native_webview_go_forward", { label });
}

export async function listenDesktopWebviewNewWindow(
  handler: (event: DesktopNativeWebviewRequestEvent) => void,
): Promise<UnlistenFn> {
  if (!canManageDesktopWebviews()) {
    return () => {};
  }

  return listen<DesktopNativeWebviewRequestEvent>("desktop-native-webview://new-window", (event) => {
    if (event.payload) {
      handler(event.payload);
    }
  });
}

export async function listenDesktopWebviewDownload(
  handler: (event: DesktopNativeWebviewDownloadEventPayload) => void,
): Promise<UnlistenFn> {
  if (!canManageDesktopWebviews()) {
    return () => {};
  }

  return listen<DesktopNativeWebviewDownloadEventPayload>("desktop-native-webview://download", (event) => {
    if (event.payload) {
      handler(event.payload);
    }
  });
}

export async function destroyAllDesktopWebviews(): Promise<void> {
  // Managed centrally by workspace/tab lifecycle, so no-op helper remains for compatibility.
}
