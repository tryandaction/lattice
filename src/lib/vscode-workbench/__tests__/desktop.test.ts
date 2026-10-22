import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeTauriCommand: vi.fn(),
  isTauriHost: vi.fn(() => true),
}));

vi.mock("@/lib/storage-adapter", () => ({
  invokeTauriCommand: mocks.invokeTauriCommand,
  isTauriHost: mocks.isTauriHost,
}));

import {
  canUseNativeVSCodeWorkbench,
  getNativeVSCodeWorkbenchStatus,
  openNativeVSCodeWorkbenchResource,
  runNativeVSCodeWorkbenchAction,
  startNativeVSCodeWorkbench,
  stopNativeVSCodeWorkbench,
} from "@/lib/vscode-workbench/desktop";

describe("native VS Code Workbench desktop bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauriHost.mockReturnValue(true);
  });

  it("reflects desktop host availability", () => {
    expect(canUseNativeVSCodeWorkbench()).toBe(true);
    mocks.isTauriHost.mockReturnValue(false);
    expect(canUseNativeVSCodeWorkbench()).toBe(false);
  });

  it("starts the native workbench for the current workspace", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({ status: "preparing" });

    await startNativeVSCodeWorkbench("C:/workspace/project");

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_start_vscode_workbench",
      { workspacePath: "C:/workspace/project" },
      { timeoutMs: 15000 },
    );
  });

  it("reads status with a short polling timeout", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({ status: "ready" });

    await getNativeVSCodeWorkbenchStatus();

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_get_vscode_workbench_status",
      undefined,
      { timeoutMs: 6000 },
    );
  });

  it("stops only the Lattice-owned workbench", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({ status: "stopped" });

    await stopNativeVSCodeWorkbench();

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_stop_vscode_workbench",
      undefined,
      { timeoutMs: 15000 },
    );
  });

  it("opens a resource through the existing Workbench bridge", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({ ok: true, requestId: 9 });
    const request = {
      requestId: 9,
      path: "C:/workspace/main.ts",
      kind: "text" as const,
      line: 2,
      column: 4,
    };

    await openNativeVSCodeWorkbenchResource(request);

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_open_vscode_workbench_resource",
      { request },
      { timeoutMs: 6000 },
    );
  });

  it("runs only typed Workbench actions", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({ ok: true, requestId: null });

    await runNativeVSCodeWorkbenchAction("focusWorkbench");

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_run_vscode_workbench_action",
      { request: { action: "focusWorkbench" } },
      { timeoutMs: 6000 },
    );
  });
});
