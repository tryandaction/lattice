/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDesktopDirectoryDialog } from "../desktop-folder";

const storageMocks = vi.hoisted(() => {
  return {
    isTauriHost: vi.fn(() => true),
    waitForTauriInvokeReady: vi.fn(),
  };
});

vi.mock("@/lib/storage-adapter", () => ({
  isTauriHost: storageMocks.isTauriHost,
  waitForTauriInvokeReady: storageMocks.waitForTauriInvokeReady,
}));

describe("openDesktopDirectoryDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the Tauri dialog plugin with the v2 options payload", async () => {
    const invoke = vi.fn(async () => "C:\\vault\\");
    storageMocks.waitForTauriInvokeReady.mockResolvedValue(invoke);

    const selected = await openDesktopDirectoryDialog({
      title: "Open Folder",
      defaultPath: "C:\\workspace\\",
    });

    expect(invoke).toHaveBeenCalledWith("plugin:dialog|open", {
      options: {
        directory: true,
        multiple: false,
        title: "Open Folder",
        defaultPath: "C:/workspace",
      },
    });
    expect(selected).toBe("C:/vault");
  });

  it("normalizes object payloads returned by the desktop dialog", async () => {
    const invoke = vi.fn(async () => ({ path: "C:\\vault\\" }));
    storageMocks.waitForTauriInvokeReady.mockResolvedValue(invoke);

    await expect(openDesktopDirectoryDialog()).resolves.toBe("C:/vault");
  });
});
