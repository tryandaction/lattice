import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeTauriCommand: vi.fn(),
  isTauriHost: vi.fn(() => true),
  listen: vi.fn(),
}));

vi.mock("@/lib/storage-adapter", () => ({
  invokeTauriCommand: mocks.invokeTauriCommand,
  isTauriHost: mocks.isTauriHost,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

import {
  continueDebugSession,
  evaluateDebugExpression,
  getDebugStackTrace,
  getDebugVariables,
  listenDebugEvents,
  normalizeDebugSourcePath,
  setDebugBreakpoints,
  startNodeDebugSession,
  startPythonDebugSession,
  stopDebugSession,
} from "@/lib/vscode-debug/desktop";

describe("desktop debug adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauriHost.mockReturnValue(true);
  });

  it("starts Node debugging through the fixed js-debug command", async () => {
    const request = {
      kind: "node" as const,
      name: "Debug Node app",
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
      breakpoints: [{ path: "C:/workspace/app.js", line: 3 }],
    };
    mocks.invokeTauriCommand.mockResolvedValue({
      sessionId: "node-debug-1",
      name: request.name,
      lifecycle: "running",
    });

    await startNodeDebugSession(request);

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_start_node_debug_session",
      { request },
      { timeoutMs: 60000 },
    );
  });

  it("starts Python debugging with the bounded launch timeout", async () => {
    const request = {
      kind: "python" as const,
      name: "Debug app",
      workspaceRootPath: "C:/workspace",
      python: "python",
      target: { kind: "program" as const, value: "C:/workspace/app.py" },
      cwd: "C:/workspace",
      args: [],
      justMyCode: true,
      stopOnEntry: false,
      subProcess: true,
      breakpoints: [{ path: "C:/workspace/app.py", line: 3 }],
    };
    mocks.invokeTauriCommand.mockResolvedValue({
      sessionId: "debug-1",
      name: "Debug app",
      lifecycle: "running",
    });

    await startPythonDebugSession(request);

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_start_python_debug_session",
      { request },
      { timeoutMs: 60000 },
    );
  });

  it("normalizes Windows regular and verbatim source paths to one key", () => {
    expect(normalizeDebugSourcePath("C:\\workspace\\app.py")).toBe("c:/workspace/app.py");
    expect(normalizeDebugSourcePath("\\\\?\\C:\\workspace\\app.py")).toBe("c:/workspace/app.py");
  });

  it("maps breakpoint, control, query, evaluation, and stop payloads", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({});

    await setDebugBreakpoints("debug-1", "C:/workspace/app.py", [3, 7]);
    await continueDebugSession("debug-1", 2);
    await getDebugStackTrace("debug-1", 2, 5, 40);
    await getDebugVariables("debug-1", 9, 0, 200);
    await evaluateDebugExpression("debug-1", "value + 1", 11, "watch");
    await stopDebugSession("debug-1");

    expect(mocks.invokeTauriCommand).toHaveBeenNthCalledWith(1, "desktop_set_debug_breakpoints", {
      sessionId: "debug-1",
      sourcePath: "C:/workspace/app.py",
      lines: [3, 7],
    }, { timeoutMs: 15000 });
    expect(mocks.invokeTauriCommand).toHaveBeenNthCalledWith(2, "desktop_continue_debug_session", {
      sessionId: "debug-1",
      threadId: 2,
    }, { timeoutMs: 15000 });
    expect(mocks.invokeTauriCommand).toHaveBeenNthCalledWith(3, "desktop_get_debug_stack_trace", {
      sessionId: "debug-1",
      threadId: 2,
      startFrame: 5,
      levels: 40,
    }, { timeoutMs: 15000 });
    expect(mocks.invokeTauriCommand).toHaveBeenNthCalledWith(4, "desktop_get_debug_variables", {
      sessionId: "debug-1",
      variablesReference: 9,
      start: 0,
      count: 200,
    }, { timeoutMs: 15000 });
    expect(mocks.invokeTauriCommand).toHaveBeenNthCalledWith(5, "desktop_evaluate_debug_expression", {
      sessionId: "debug-1",
      expression: "value + 1",
      frameId: 11,
      context: "watch",
    }, { timeoutMs: 15000 });
    expect(mocks.invokeTauriCommand).toHaveBeenNthCalledWith(6, "desktop_stop_debug_session", {
      sessionId: "debug-1",
    }, { timeoutMs: 30000 });
  });

  it("subscribes to debug events and returns the Tauri disposer", async () => {
    const unlisten = vi.fn();
    const handler = vi.fn();
    mocks.listen.mockResolvedValue(unlisten);

    const dispose = await listenDebugEvents(handler);
    const listener = mocks.listen.mock.calls[0]?.[1] as (event: { payload: unknown }) => void;
    listener({ payload: { sessionId: "debug-1", event: "stopped", body: { threadId: 2 } } });
    dispose();

    expect(mocks.listen).toHaveBeenCalledWith("debug://event", expect.any(Function));
    expect(handler).toHaveBeenCalledWith({
      sessionId: "debug-1",
      event: "stopped",
      body: { threadId: 2 },
    });
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("rejects desktop operations before invoking Tauri outside the desktop host", async () => {
    mocks.isTauriHost.mockReturnValue(false);

    await expect(stopDebugSession("debug-1")).rejects.toThrow(
      "Debugging is available in the Lattice desktop build.",
    );
    expect(mocks.invokeTauriCommand).not.toHaveBeenCalled();
  });
});
