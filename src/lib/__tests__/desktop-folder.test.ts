/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDesktopDirectoryDialog } from "../desktop-folder";

const storageMocks = vi.hoisted(() => {
  return {
    isTauriHost: vi.fn(() => true),
    invokeTauriCommand: vi.fn(),
  };
});

vi.mock("@/lib/storage-adapter", () => ({
  isTauriHost: storageMocks.isTauriHost,
  invokeTauriCommand: storageMocks.invokeTauriCommand,
}));

describe("openDesktopDirectoryDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the Tauri dialog plugin with the v2 options payload", async () => {
    storageMocks.invokeTauriCommand.mockResolvedValue("C:\\vault\\");

    const selected = await openDesktopDirectoryDialog({
      title: "Open Folder",
      defaultPath: "C:\\workspace\\",
    });

    expect(storageMocks.invokeTauriCommand).toHaveBeenCalledWith("plugin:dialog|open", {
      options: {
        directory: true,
        multiple: false,
        title: "Open Folder",
        defaultPath: "C:/workspace",
      },
    }, {
      timeoutMs: 30000,
    });
    expect(selected).toBe("C:/vault");
  });

  it("normalizes object payloads returned by the desktop dialog", async () => {
    storageMocks.invokeTauriCommand.mockResolvedValue({ path: "C:\\vault\\" });

    await expect(openDesktopDirectoryDialog()).resolves.toBe("C:/vault");
  });

  it("treats dialog timeout as a cancelled selection", async () => {
    storageMocks.invokeTauriCommand.mockRejectedValue(new Error("Tauri command plugin:dialog|open timed out after 30000ms"));

    await expect(openDesktopDirectoryDialog()).resolves.toBeNull();
  });
});
