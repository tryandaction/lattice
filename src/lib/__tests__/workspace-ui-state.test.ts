/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from "vitest";
import { loadWorkspaceUiState, saveWorkspaceUiState } from "../workspace-ui-state";

describe("workspace-ui-state", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists explorer expansion and selection by workspace key", async () => {
    await saveWorkspaceUiState("desktop:C:/workspace/a", "C:/workspace/a", {
      version: 1,
      explorer: {
        expandedPaths: ["workspace", "workspace/docs", "workspace/docs"],
        selectedPath: "workspace/docs/paper.pdf",
        selectedKind: "file",
      },
    });
    await saveWorkspaceUiState("desktop:C:/workspace/b", "C:/workspace/b", {
      version: 1,
      explorer: {
        expandedPaths: ["workspace-b"],
        selectedPath: "workspace-b",
        selectedKind: "directory",
      },
    });

    await expect(loadWorkspaceUiState("desktop:C:/workspace/a", "C:/workspace/a")).resolves.toEqual({
      version: 1,
      explorer: {
        expandedPaths: ["workspace", "workspace/docs"],
        selectedPath: "workspace/docs/paper.pdf",
        selectedKind: "file",
      },
    });
    await expect(loadWorkspaceUiState("desktop:C:/workspace/b", "C:/workspace/b")).resolves.toEqual({
      version: 1,
      explorer: {
        expandedPaths: ["workspace-b"],
        selectedPath: "workspace-b",
        selectedKind: "directory",
      },
    });
  });

  it("caps expanded path payloads to keep workspace switching lightweight", async () => {
    const expandedPaths = Array.from({ length: 550 }, (_, index) => `workspace/folder-${index}`);

    await saveWorkspaceUiState("desktop:C:/workspace", "C:/workspace", {
      version: 1,
      explorer: {
        expandedPaths,
        selectedPath: null,
        selectedKind: null,
      },
    });

    const restored = await loadWorkspaceUiState("desktop:C:/workspace", "C:/workspace");
    expect(restored?.explorer.expandedPaths).toHaveLength(500);
    expect(restored?.explorer.expandedPaths.at(0)).toBe("workspace/folder-0");
    expect(restored?.explorer.expandedPaths.at(-1)).toBe("workspace/folder-499");
  });
});
