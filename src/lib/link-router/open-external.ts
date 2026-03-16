import { isTauri } from "@/lib/storage-adapter";

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

export async function openSystemPath(path: string): Promise<boolean> {
  if (!isTauri()) {
    return false;
  }

  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(path);
  return true;
}
