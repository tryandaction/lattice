import { beforeEach, describe, expect, it, vi } from "vitest";

const isTauriHostMock = vi.hoisted(() => vi.fn());
const detectPythonEnvironmentsMock = vi.hoisted(() => vi.fn());
const probeCommandAvailabilityMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/storage-adapter", () => ({
  isTauriHost: () => isTauriHostMock(),
}));

vi.mock("@/lib/runner/runner-manager", () => ({
  runnerManager: {
    detectPythonEnvironments: detectPythonEnvironmentsMock,
    probeCommandAvailability: probeCommandAvailabilityMock,
  },
}));

import { buildRuntimeRunnerHealthIssues, collectRunnerHealthSnapshot } from "@/lib/runner/health";
import type { WorkspaceRunnerPreferences } from "@/lib/runner/types";

const emptyPreferences: WorkspaceRunnerPreferences = {
  defaultPythonPath: null,
  defaultLanguageRunners: {},
  recentRunByFile: {},
};

describe("runner health helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("在桌面端无 Python 时生成 python_not_found issue", async () => {
    isTauriHostMock.mockReturnValue(true);
    detectPythonEnvironmentsMock.mockResolvedValue([]);
    probeCommandAvailabilityMock.mockResolvedValue({
      command: "node",
      available: true,
      resolvedPath: "C:/Program Files/nodejs/node.exe",
      version: "v20.0.0",
      error: null,
    });

    const snapshot = await collectRunnerHealthSnapshot({
      cwd: "C:/workspace",
      fileKey: "demo.py",
      preferences: emptyPreferences,
    });

    expect(snapshot.hostKind).toBe("desktop");
    expect(snapshot.issues.some((issue) => issue.code === "python_not_found")).toBe(true);
  });

  it("在默认解释器失效时生成 preferred_python_missing issue", async () => {
    isTauriHostMock.mockReturnValue(true);
    detectPythonEnvironmentsMock.mockResolvedValue([
      {
        path: "C:/Workspace/.venv/Scripts/python.exe",
        version: "3.12.1",
        envType: "venv",
        name: ".venv",
        source: "workspace",
      },
    ]);
    probeCommandAvailabilityMock.mockResolvedValue({
      command: "node",
      available: true,
      resolvedPath: "C:/Program Files/nodejs/node.exe",
      version: "v20.0.0",
      error: null,
    });

    const snapshot = await collectRunnerHealthSnapshot({
      cwd: "C:/workspace",
      fileKey: "demo.py",
      preferences: {
        ...emptyPreferences,
        defaultPythonPath: "C:/Missing/python.exe",
      },
    });

    expect(snapshot.issues.some((issue) => issue.code === "preferred_python_missing")).toBe(true);
  });

  it("将 ModuleNotFoundError 映射为 missing_dependency issue", () => {
    const issues = buildRuntimeRunnerHealthIssues([
      {
        type: "error",
        content: "ModuleNotFoundError: No module named 'pandas'",
        errorName: "ModuleNotFoundError",
        errorValue: "No module named 'pandas'",
        traceback: ['File "<lattice-inline>", line 1', "ModuleNotFoundError: No module named 'pandas'"],
      },
    ], "C:/Workspace/.venv/Scripts/python.exe");

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("missing_dependency");
    expect(issues[0].actions?.[0]?.command).toBe("pip install pandas");
  });
});
