/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRunnerPreferenceDefaults,
  resolveRunnerExecutionRequest,
  getRunnerDefinitionForLanguage,
  getWorkspaceRunnerPreferencesStorageKey,
  loadWorkspaceRunnerPreferences,
  normalizeWorkspacePath,
  saveWorkspaceRunnerPreferences,
} from "../preferences";

const probeCommandAvailabilityMock = vi.hoisted(() => vi.fn());
const detectPythonEnvironmentsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/runner/runner-manager", () => ({
  runnerManager: {
    probeCommandAvailability: probeCommandAvailabilityMock,
    detectPythonEnvironments: detectPythonEnvironmentsMock,
  },
}));

describe("runner preferences helpers", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    detectPythonEnvironmentsMock.mockResolvedValue([]);
    probeCommandAvailabilityMock.mockResolvedValue({
      command: "gcc",
      available: true,
      resolvedPath: "C:/msys64/ucrt64/bin/gcc.exe",
      version: "gcc 13.2.0",
      error: null,
    });
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

  it("builds saved-file requests for compiled native C entries", async () => {
    const runnerDefinition = getRunnerDefinitionForLanguage("c");
    expect(runnerDefinition).toBeTruthy();

    const resolved = await resolveRunnerExecutionRequest({
      runnerDefinition: runnerDefinition!,
      mode: "file",
      code: "int main(void) { return 0; }",
      cwd: "C:/workspace/project",
      absoluteFilePath: "C:/workspace/project/main.c",
      fileKey: "workspace/main.c",
      language: "c",
      preferences: createRunnerPreferenceDefaults(),
    });

    expect(probeCommandAvailabilityMock).toHaveBeenCalledWith("gcc");
    expect(resolved.request).toEqual(expect.objectContaining({
      runnerType: "compiled-native",
      command: "gcc",
      filePath: "C:/workspace/project/main.c",
      cwd: "C:/workspace/project",
      args: [],
      mode: "file",
      allowPyodideFallback: false,
    }));
    expect(resolved.meta.diagnostics).toEqual([]);
  });

  it("blocks inline requests for compiled native entries", async () => {
    const runnerDefinition = getRunnerDefinitionForLanguage("cpp");
    expect(runnerDefinition).toBeTruthy();

    const resolved = await resolveRunnerExecutionRequest({
      runnerDefinition: runnerDefinition!,
      mode: "selection",
      code: "int main() { return 0; }",
      cwd: "C:/workspace/project",
      absoluteFilePath: "C:/workspace/project/main.cpp",
      fileKey: "workspace/main.cpp",
      language: "cpp",
      preferences: createRunnerPreferenceDefaults(),
    });

    expect(probeCommandAvailabilityMock).toHaveBeenCalledWith("g++");
    expect(resolved.request).toBeNull();
    expect(resolved.meta.diagnostics).toEqual([
      expect.objectContaining({
        severity: "error",
        stage: "request-build",
      }),
    ]);
  });
});
