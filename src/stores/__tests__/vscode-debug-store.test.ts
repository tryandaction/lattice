/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startPythonDebugSession: vi.fn(),
  startNodeDebugSession: vi.fn(),
  stopDebugSession: vi.fn(),
  getDebugThreads: vi.fn(),
  getDebugStackTrace: vi.fn(),
  getDebugScopes: vi.fn(),
  getDebugVariables: vi.fn(),
  setDebugBreakpoints: vi.fn(),
  continueDebugSession: vi.fn(),
  pauseDebugSession: vi.fn(),
  stepOverDebugSession: vi.fn(),
  stepIntoDebugSession: vi.fn(),
  stepOutDebugSession: vi.fn(),
  restartDebugSession: vi.fn(),
  evaluateDebugExpression: vi.fn(),
}));

vi.mock("@/lib/vscode-debug/desktop", () => ({
  startPythonDebugSession: mocks.startPythonDebugSession,
  startNodeDebugSession: mocks.startNodeDebugSession,
  stopDebugSession: mocks.stopDebugSession,
  getDebugThreads: mocks.getDebugThreads,
  getDebugStackTrace: mocks.getDebugStackTrace,
  getDebugScopes: mocks.getDebugScopes,
  getDebugVariables: mocks.getDebugVariables,
  setDebugBreakpoints: mocks.setDebugBreakpoints,
  continueDebugSession: mocks.continueDebugSession,
  pauseDebugSession: mocks.pauseDebugSession,
  stepOverDebugSession: mocks.stepOverDebugSession,
  stepIntoDebugSession: mocks.stepIntoDebugSession,
  stepOutDebugSession: mocks.stepOutDebugSession,
  restartDebugSession: mocks.restartDebugSession,
  evaluateDebugExpression: mocks.evaluateDebugExpression,
}));

import { useVSCodeDebugStore } from "@/stores/vscode-debug-store";

describe("VS Code debug store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useVSCodeDebugStore.getState().reset();
  });

  it("ignores stale events and clears stopped inspection state when execution continues", () => {
    useVSCodeDebugStore.setState({
      sessionId: "debug-1",
      lifecycle: "running",
      stackFrames: [{ id: 11, name: "main", line: 3, column: 1, source: { path: "app.py" } }],
      scopes: [{ name: "Locals", variablesReference: 9, expensive: false }],
      variablesByReference: { 9: [{ name: "value", value: "42", variablesReference: 0 }] },
    });

    useVSCodeDebugStore.getState().applyEvent({
      sessionId: "stale",
      event: "stopped",
      body: { threadId: 99, reason: "breakpoint" },
    });
    expect(useVSCodeDebugStore.getState().selectedThreadId).toBeNull();

    useVSCodeDebugStore.getState().applyEvent({
      sessionId: "debug-1",
      event: "stopped",
      body: { threadId: 2, reason: "breakpoint" },
    });
    expect(useVSCodeDebugStore.getState()).toMatchObject({
      lifecycle: "stopped",
      selectedThreadId: 2,
      stopReason: "breakpoint",
    });

    useVSCodeDebugStore.getState().applyEvent({
      sessionId: "debug-1",
      event: "continued",
      body: { threadId: 2 },
    });
    expect(useVSCodeDebugStore.getState()).toMatchObject({
      lifecycle: "running",
      stackFrames: [],
      scopes: [],
      variablesByReference: {},
    });
  });

  it("bounds output and keeps the latest entries", () => {
    useVSCodeDebugStore.setState({ sessionId: "debug-1" });
    for (let index = 0; index < 1_050; index += 1) {
      useVSCodeDebugStore.getState().applyEvent({
        sessionId: "debug-1",
        event: "output",
        body: { category: "stdout", output: `line-${index}` },
      });
    }

    const output = useVSCodeDebugStore.getState().output;
    expect(output).toHaveLength(1_000);
    expect(output[0]?.output).toBe("line-50");
    expect(output.at(-1)?.output).toBe("line-1049");
  });

  it("persists breakpoints per workspace and toggles exact file lines", () => {
    useVSCodeDebugStore.getState().loadBreakpoints("workspace-a");
    useVSCodeDebugStore.getState().toggleBreakpoint("C:/workspace/app.py", 3);
    useVSCodeDebugStore.getState().toggleBreakpoint("C:/workspace/app.py", 7);

    expect(useVSCodeDebugStore.getState().breakpoints["c:/workspace/app.py"]).toEqual([
      { path: "C:/workspace/app.py", line: 3, verified: false },
      { path: "C:/workspace/app.py", line: 7, verified: false },
    ]);

    useVSCodeDebugStore.getState().reset();
    useVSCodeDebugStore.getState().loadBreakpoints("workspace-a");
    expect(useVSCodeDebugStore.getState().breakpoints["c:/workspace/app.py"]).toHaveLength(2);

    useVSCodeDebugStore.getState().toggleBreakpoint("C:/workspace/app.py", 3);
    expect(useVSCodeDebugStore.getState().breakpoints["c:/workspace/app.py"]).toEqual([
      { path: "C:/workspace/app.py", line: 7, verified: false },
    ]);
  });

  it("synchronizes toggled breakpoints with the active adapter and applies verification", async () => {
    useVSCodeDebugStore.setState({ sessionId: "debug-1", lifecycle: "running" });
    mocks.setDebugBreakpoints.mockResolvedValue({
      breakpoints: [{ id: 4, line: 3, verified: true }],
    });

    useVSCodeDebugStore.getState().toggleBreakpoint("C:/workspace/app.py", 3);

    await vi.waitFor(() => {
      expect(mocks.setDebugBreakpoints).toHaveBeenCalledWith(
        "debug-1",
        "C:/workspace/app.py",
        [3],
      );
    });
    expect(useVSCodeDebugStore.getState().breakpoints["c:/workspace/app.py"]).toEqual([
      { path: "C:/workspace/app.py", line: 3, verified: true, id: 4 },
    ]);
  });

  it("hydrates stopped threads, stack, scopes, and caches variables lazily", async () => {
    useVSCodeDebugStore.setState({ sessionId: "debug-1", lifecycle: "stopped" });
    mocks.getDebugThreads.mockResolvedValue({ threads: [{ id: 2, name: "MainThread" }] });
    mocks.getDebugStackTrace.mockResolvedValue({
      stackFrames: [{ id: 11, name: "main", line: 3, column: 1, source: { path: "app.py" } }],
      totalFrames: 1,
    });
    mocks.getDebugScopes.mockResolvedValue({
      scopes: [{ name: "Locals", variablesReference: 9, expensive: false }],
    });
    mocks.getDebugVariables.mockResolvedValue({
      variables: [{ name: "value", value: "42", variablesReference: 0 }],
    });

    await useVSCodeDebugStore.getState().hydrateStoppedState(2);
    await useVSCodeDebugStore.getState().loadVariables(9);
    await useVSCodeDebugStore.getState().loadVariables(9);

    expect(useVSCodeDebugStore.getState()).toMatchObject({
      selectedThreadId: 2,
      selectedFrameId: 11,
      threads: [{ id: 2, name: "MainThread" }],
      scopes: [{ name: "Locals", variablesReference: 9, expensive: false }],
      variablesByReference: {
        9: [{ name: "value", value: "42", variablesReference: 0 }],
      },
    });
    expect(mocks.getDebugVariables).toHaveBeenCalledTimes(1);
  });

  it("continues the selected thread and evaluates in the selected frame", async () => {
    useVSCodeDebugStore.setState({
      sessionId: "debug-1",
      lifecycle: "stopped",
      selectedThreadId: 2,
      selectedFrameId: 11,
      stackFrames: [{ id: 11, name: "main", line: 3, column: 1 }],
      scopes: [{ name: "Locals", variablesReference: 9, expensive: false }],
    });
    mocks.continueDebugSession.mockResolvedValue({ allThreadsContinued: true });
    mocks.evaluateDebugExpression.mockResolvedValue({
      result: "43",
      type: "int",
      variablesReference: 0,
    });

    const evaluation = await useVSCodeDebugStore.getState().evaluate("value + 1");
    await useVSCodeDebugStore.getState().continueExecution();

    expect(evaluation?.result).toBe("43");
    expect(mocks.evaluateDebugExpression).toHaveBeenCalledWith(
      "debug-1",
      "value + 1",
      11,
      "watch",
    );
    expect(mocks.continueDebugSession).toHaveBeenCalledWith("debug-1", 2);
    expect(useVSCodeDebugStore.getState()).toMatchObject({
      lifecycle: "running",
      stackFrames: [],
      scopes: [],
      output: [
        { category: "console", output: "> value + 1\n43\n" },
      ],
    });
  });

  it("replays adapter events that arrive before the start command returns", async () => {
    let resolveStart!: (value: {
      sessionId: string;
      name: string;
      lifecycle: "running";
    }) => void;
    mocks.startPythonDebugSession.mockImplementation(() => new Promise((resolve) => {
      resolveStart = resolve;
    }));

    const startPromise = useVSCodeDebugStore.getState().startDebugging({
      kind: "python",
      workspaceRootPath: "C:/workspace",
      name: "Python: Current File",
      target: { kind: "program", value: "C:/workspace/app.py" },
      cwd: "C:/workspace",
      args: [],
      justMyCode: true,
      stopOnEntry: false,
      subProcess: false,
      breakpoints: [],
    });

    useVSCodeDebugStore.getState().applyEvent({
      sessionId: "debug-early",
      event: "stopped",
      body: { threadId: 2, reason: "breakpoint" },
    });
    resolveStart({ sessionId: "debug-early", name: "Python: Current File", lifecycle: "running" });
    await startPromise;

    expect(useVSCodeDebugStore.getState()).toMatchObject({
      sessionId: "debug-early",
      lifecycle: "stopped",
      selectedThreadId: 2,
      stopReason: "breakpoint",
    });
  });

  it("dispatches Node launch requests to the js-debug desktop command", async () => {
    mocks.startNodeDebugSession.mockResolvedValue({
      sessionId: "node-debug-1",
      name: "Node: Current File",
      lifecycle: "running",
    });

    await useVSCodeDebugStore.getState().startDebugging({
      kind: "node",
      name: "Node: Current File",
      workspaceRootPath: "C:/workspace",
      program: "C:/workspace/app.js",
      cwd: "C:/workspace",
      runtimeExecutable: "node",
      runtimeArgs: [],
      args: [],
      stopOnEntry: false,
      sourceMaps: true,
      smartStep: false,
      skipFiles: ["<node_internals>/**"],
      outFiles: [],
      breakpoints: [],
    });

    expect(mocks.startNodeDebugSession).toHaveBeenCalledOnce();
    expect(mocks.startPythonDebugSession).not.toHaveBeenCalled();
    expect(useVSCodeDebugStore.getState()).toMatchObject({
      sessionId: "node-debug-1",
      lifecycle: "running",
    });
  });
});
