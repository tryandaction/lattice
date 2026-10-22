import { beforeEach, describe, expect, it } from "vitest";
import {
  getWorkspaceStartupSnapshot,
  markWorkspaceStartup,
  resetWorkspaceStartupPerformance,
} from "@/lib/workspace-startup-performance";

describe("workspace startup performance metrics", () => {
  beforeEach(() => {
    resetWorkspaceStartupPerformance();
  });

  it("records monotonic startup stages without user data", () => {
    markWorkspaceStartup("workspace-open-start");
    markWorkspaceStartup("root-tree-ready");
    markWorkspaceStartup("first-file-ready");
    markWorkspaceStartup("background-index-complete");

    const snapshot = getWorkspaceStartupSnapshot();
    expect(snapshot["workspace-open-start"]).not.toBeNull();
    expect(snapshot["root-tree-ready"]).toBeGreaterThanOrEqual(snapshot["workspace-open-start"] ?? 0);
    expect(snapshot["first-file-ready"]).toBeGreaterThanOrEqual(snapshot["root-tree-ready"] ?? 0);
    expect(snapshot["background-index-complete"]).toBeGreaterThanOrEqual(snapshot["first-file-ready"] ?? 0);
    expect(Object.values(snapshot).every((value) => value === null || typeof value === "number")).toBe(true);
  });

  it("does not move a stage backwards when marked again", () => {
    markWorkspaceStartup("root-tree-ready");
    const first = getWorkspaceStartupSnapshot()["root-tree-ready"];
    markWorkspaceStartup("root-tree-ready");
    expect(getWorkspaceStartupSnapshot()["root-tree-ready"]).toBe(first);
  });
});
