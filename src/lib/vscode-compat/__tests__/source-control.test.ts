import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitVSCodeSourceControlChanges,
  getVSCodeSourceControlDiff,
  getVSCodeSourceControlStatus,
  stageAllVSCodeSourceControlChanges,
  stageVSCodeSourceControlPaths,
  unstageAllVSCodeSourceControlChanges,
  unstageVSCodeSourceControlPaths,
} from "@/lib/vscode-compat/source-control";

const mocks = vi.hoisted(() => ({
  invokeTauriCommand: vi.fn(),
  isTauriHost: vi.fn(),
}));

vi.mock("@/lib/storage-adapter", () => ({
  invokeTauriCommand: mocks.invokeTauriCommand,
  isTauriHost: mocks.isTauriHost,
}));

describe("VS Code source control adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requests repository status from the desktop backend", async () => {
    mocks.isTauriHost.mockReturnValue(true);
    mocks.invokeTauriCommand.mockResolvedValue({ available: true, changes: [] });

    await getVSCodeSourceControlStatus("C:/workspace");

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_get_source_control_status",
      { path: "C:/workspace" },
      { timeoutMs: 5000 },
    );
  });

  it("returns a truthful unavailable result outside the desktop workspace", async () => {
    mocks.isTauriHost.mockReturnValue(false);

    const result = await getVSCodeSourceControlStatus("C:/workspace");

    expect(result.available).toBe(false);
    expect(result.error).toContain("desktop build");
    expect(mocks.invokeTauriCommand).not.toHaveBeenCalled();
  });

  it("requests a staged diff with the bounded desktop timeout", async () => {
    mocks.isTauriHost.mockReturnValue(true);
    mocks.invokeTauriCommand.mockResolvedValue({
      path: "src/app.ts",
      staged: true,
      content: "diff --git",
      binary: false,
      truncated: false,
      error: null,
    });

    await getVSCodeSourceControlDiff("C:/workspace", "src/app.ts", true);

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_get_source_control_diff",
      { path: "C:/workspace", filePath: "src/app.ts", staged: true },
      { timeoutMs: 30000 },
    );
  });

  it.each([
    ["stage paths", () => stageVSCodeSourceControlPaths("C:/workspace", ["a.ts"]), "desktop_stage_source_control_paths", { path: "C:/workspace", paths: ["a.ts"] }],
    ["unstage paths", () => unstageVSCodeSourceControlPaths("C:/workspace", ["a.ts"]), "desktop_unstage_source_control_paths", { path: "C:/workspace", paths: ["a.ts"] }],
    ["stage all", () => stageAllVSCodeSourceControlChanges("C:/workspace"), "desktop_stage_all_source_control_changes", { path: "C:/workspace" }],
    ["unstage all", () => unstageAllVSCodeSourceControlChanges("C:/workspace"), "desktop_unstage_all_source_control_changes", { path: "C:/workspace" }],
  ])("invokes %s and returns the refreshed snapshot", async (_label, invoke, command, payload) => {
    const refreshed = { available: true, changes: [{ path: "a.ts", staged: true }] };
    mocks.isTauriHost.mockReturnValue(true);
    mocks.invokeTauriCommand.mockResolvedValue(refreshed);

    await expect(invoke()).resolves.toBe(refreshed);
    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(command, payload, { timeoutMs: 10000 });
  });

  it("sends the commit message with the commit timeout", async () => {
    const refreshed = { available: true, changes: [] };
    mocks.isTauriHost.mockReturnValue(true);
    mocks.invokeTauriCommand.mockResolvedValue(refreshed);

    await expect(commitVSCodeSourceControlChanges("C:/workspace", "Finish SCM"))
      .resolves.toBe(refreshed);

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_commit_source_control_changes",
      { path: "C:/workspace", message: "Finish SCM" },
      { timeoutMs: 30000 },
    );
  });

  it("rejects mutations outside an opened desktop workspace", async () => {
    mocks.isTauriHost.mockReturnValue(false);

    await expect(stageAllVSCodeSourceControlChanges("C:/workspace"))
      .rejects.toThrow("desktop build");
    mocks.isTauriHost.mockReturnValue(true);
    await expect(getVSCodeSourceControlDiff(null, "a.ts", false))
      .rejects.toThrow("opened workspace");
    expect(mocks.invokeTauriCommand).not.toHaveBeenCalled();
  });
});
