"use client";

import { convertFileSrc } from "@tauri-apps/api/core";
import { getDesktopHandlePath } from "@/lib/desktop-file-system";
import { invokeTauriCommand, isTauriHost } from "@/lib/storage-adapter";

const PREVIEW_PROTOCOL = "lattice-preview";

function normalizeDesktopPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function getDesktopPreviewPath(handle: FileSystemHandle | null | undefined): string | null {
  const fullPath = getDesktopHandlePath(handle);
  return fullPath ? normalizeDesktopPath(fullPath) : null;
}

export function resolveDesktopPreviewUrl(path: string): string {
  return convertFileSrc(normalizeDesktopPath(path), PREVIEW_PROTOCOL);
}

export async function setDesktopPreviewRoot(path: string | null | undefined): Promise<void> {
  if (!isTauriHost()) {
    return;
  }

  try {
    await invokeTauriCommand("desktop_set_preview_root", {
      path: path ? normalizeDesktopPath(path) : null,
    }, {
      timeoutMs: 4000,
    });
  } catch {
    // The preview root command is a performance optimization; startup and tests
    // should continue even if the bridge is not ready in the current runtime.
  }
}

export async function readDesktopFileBytesRaw(path: string): Promise<Uint8Array> {
  const response = await invokeTauriCommand<Uint8Array | ArrayBuffer | number[]>("desktop_read_file_bytes_raw", {
    path: normalizeDesktopPath(path),
  }, {
    timeoutMs: 15000,
  });

  if (response instanceof Uint8Array) {
    return response;
  }
  if (response instanceof ArrayBuffer) {
    return new Uint8Array(response);
  }
  return Uint8Array.from(response);
}
