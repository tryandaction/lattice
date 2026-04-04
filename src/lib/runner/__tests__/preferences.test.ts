/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  getWorkspaceRunnerPreferencesStorageKey,
  loadWorkspaceRunnerPreferences,
  normalizeWorkspacePath,
  saveWorkspaceRunnerPreferences,
} from "../preferences";

describe("runner preferences helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("normalizes workspace paths for stable storage keys", () => {
    expect(normalizeWorkspacePath("C:\\Workspace\\Project\\")).toBe("c:/Workspace/Project");
    expect(normalizeWorkspacePath("/tmp/project/")).toBe("/tmp/project");
  });

  it("persists and restores workspace runner preferences", async () => {
    const workspacePath = "C:\\Workspace\\Project";
    const storageKey = getWorkspaceRunnerPreferencesStorageKey({
      workspaceKey: "desktop:c:/workspace/project",
      workspaceRootPath: workspacePath,
    });

    expect(storageKey).toBe("lattice-workspace-runner-preferences:desktop:c:/workspace/project");

    await saveWorkspaceRunnerPreferences({
      workspaceKey: "desktop:c:/workspace/project",
      workspaceRootPath: workspacePath,
    }, {
      defaultPythonPath: "C:/Python312/python.exe",
      defaultLanguageRunners: {
        py: "python-local",
      },
      recentRunByFile: {
        "notes/demo.md#block:0:py": {
          runnerType: "python-local",
          command: "C:/Python312/python.exe",
        },
      },
    });

    const loaded = await loadWorkspaceRunnerPreferences({
      workspaceKey: "desktop:c:/workspace/project",
      workspaceRootPath: workspacePath,
    });
    expect(loaded.defaultPythonPath).toBe("C:/Python312/python.exe");
    expect(loaded.defaultLanguageRunners.py).toBe("python-local");
    expect(loaded.recentRunByFile["notes/demo.md#block:0:py"]?.command).toBe("C:/Python312/python.exe");
  });

  it("migrates legacy path-keyed preferences into workspaceKey storage", async () => {
    localStorage.setItem(
      "lattice-workspace-runner-preferences:c:/Workspace/Project",
      JSON.stringify({
        defaultPythonPath: "C:/Python312/python.exe",
        defaultLanguageRunners: {
          py: "python-local",
        },
        recentRunByFile: {},
      }),
    );

    const loaded = await loadWorkspaceRunnerPreferences({
      workspaceKey: "desktop:c:/workspace/project",
      workspaceRootPath: "C:\\Workspace\\Project",
    });

    expect(loaded.defaultPythonPath).toBe("C:/Python312/python.exe");
    expect(localStorage.getItem("lattice-workspace-runner-preferences:desktop:c:/workspace/project")).not.toBeNull();
  });
});
