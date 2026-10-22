/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VSCodeRunDebugPanel } from "../vscode-run-debug-panel";
import { setLocale } from "@/lib/i18n";
import { createDefaultVSCodeWorkbenchSettings } from "@/lib/vscode-compat/mapper";
import { useVSCodeCompatStore } from "@/stores/vscode-compat-store";
import { useVSCodeDebugStore } from "@/stores/vscode-debug-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const executionMocks = vi.hoisted(() => ({
  run: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/hooks/use-execution-runner", () => ({
  useExecutionRunner: () => ({
    run: executionMocks.run,
    outputs: [],
    status: "idle",
    error: null,
    isRunning: false,
  }),
}));

describe("VSCodeRunDebugPanel", () => {
  beforeEach(() => {
    setLocale("en-US");
    vi.clearAllMocks();
    useWorkspaceStore.getState().setWorkspaceRootPath("C:/workspace");
    useWorkspaceStore.setState((state) => ({
      runnerPreferences: { ...state.runnerPreferences, defaultPythonPath: "python" },
    }));
    useVSCodeCompatStore.setState({
      settings: createDefaultVSCodeWorkbenchSettings(),
      keybindings: [],
      snippets: [],
      tasks: [],
      launches: [],
      extensions: [],
      importedAt: Date.now(),
      sourceLabel: "VS Code",
      warnings: [],
    });
    useVSCodeDebugStore.getState().reset();
    useVSCodeDebugStore.setState({
      workspaceKey: "C:/workspace",
      breakpoints: {},
      initializeEventListener: vi.fn(async () => () => {}),
      startDebugging: vi.fn(async () => undefined),
      stopDebugging: vi.fn(async () => undefined),
      continueExecution: vi.fn(async () => undefined),
      pauseExecution: vi.fn(async () => undefined),
      stepOver: vi.fn(async () => undefined),
      stepInto: vi.fn(async () => undefined),
      stepOut: vi.fn(async () => undefined),
      restartDebugging: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => null),
      hydrateStoppedState: vi.fn(async () => undefined),
      selectFrame: vi.fn(async () => undefined),
      loadVariables: vi.fn(async () => undefined),
    });
  });

  it("starts a real Python debug session with persisted breakpoints", async () => {
    useVSCodeCompatStore.setState({
      launches: [{
        name: "Python App",
        type: "debugpy",
        request: "launch",
        program: "${workspaceFolder}/app.py",
        cwd: "${workspaceFolder}",
        args: [],
      }],
    });
    useVSCodeDebugStore.setState({
      breakpoints: {
        "c:/workspace/app.py": [{ path: "C:/workspace/app.py", line: 3, verified: false }],
      },
    });

    render(<VSCodeRunDebugPanel onImportProfile={vi.fn()} isImporting={false} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Debug Python App" }));
    });

    expect(useVSCodeDebugStore.getState().startDebugging).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Python App",
        workspaceRootPath: "C:/workspace",
        target: { kind: "program", value: "C:/workspace/app.py" },
        breakpoints: [{ path: "C:/workspace/app.py", line: 3 }],
      }),
    );
  });

  it("starts a real Node debug session with persisted breakpoints", async () => {
    useVSCodeCompatStore.setState({
      launches: [{
        name: "Node App",
        type: "pwa-node",
        request: "launch",
        program: "C:/workspace/app.js",
        args: [],
      }],
    });
    useVSCodeDebugStore.setState({
      breakpoints: {
        "c:/workspace/app.js": [{ path: "C:/workspace/app.js", line: 3, verified: false }],
      },
    });

    render(<VSCodeRunDebugPanel onImportProfile={vi.fn()} isImporting={false} />);
    const button = screen.getByRole("button", { name: "Debug Node App" });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(useVSCodeDebugStore.getState().startDebugging).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "node",
        name: "Node App",
        program: "C:/workspace/app.js",
        breakpoints: [{ path: "C:/workspace/app.js", line: 3 }],
      }),
    );
    expect(executionMocks.run).not.toHaveBeenCalled();
  });

  it("renders stopped controls, call stack, variables, evaluation, and output", async () => {
    useVSCodeDebugStore.setState({
      sessionId: "debug-1",
      sessionName: "Python App",
      lifecycle: "stopped",
      selectedThreadId: 2,
      selectedFrameId: 11,
      stopReason: "breakpoint",
      threads: [{ id: 2, name: "MainThread" }],
      stackFrames: [{
        id: 11,
        name: "main",
        line: 3,
        column: 1,
        source: { path: "C:/workspace/app.py" },
      }],
      scopes: [{ name: "Locals", variablesReference: 9, expensive: false }],
      variablesByReference: {
        9: [{ name: "value", value: "42", type: "int", variablesReference: 0 }],
      },
      output: [{ category: "stdout", output: "ready\n" }],
    });

    render(<VSCodeRunDebugPanel onImportProfile={vi.fn()} isImporting={false} />);

    expect(screen.getByText("breakpoint")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Step over" })).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("value")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("ready")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByPlaceholderText("Expression"), { target: { value: "value + 1" } });
    await act(async () => {
      fireEvent.submit(screen.getByPlaceholderText("Expression").closest("form")!);
    });

    expect(useVSCodeDebugStore.getState().continueExecution).toHaveBeenCalled();
    expect(useVSCodeDebugStore.getState().evaluate).toHaveBeenCalledWith("value + 1");
  });
});
