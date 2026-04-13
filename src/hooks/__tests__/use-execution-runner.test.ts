import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { RunnerEvent, RunnerExecutionRequest, RunnerStatus } from "@/lib/runner/types";
import { destroyExecutionScope } from "@/stores/execution-session-store";

const mockCreateSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/runner/runner-manager", () => ({
  runnerManager: {
    createSession: mockCreateSession,
  },
  runnerEventToTextOutputs: (event: RunnerEvent) => {
    if (event.type === "stdout" || event.type === "stderr") {
      return [{ type: "text" as const, content: event.payload.text, channel: event.payload.channel }];
    }
    return [];
  },
}));

import { useExecutionRunner } from "@/hooks/use-execution-runner";

function createSessionMock() {
  let statusListener: ((status: RunnerStatus, error?: string | null) => void) | null = null;
  let eventListener: ((event: RunnerEvent) => void) | null = null;
  let resolveRun: ((value: { sessionId: string; success: boolean; exitCode: number | null; terminated: boolean }) => void) | null = null;

  return {
    onStatusChange: vi.fn((listener: (status: RunnerStatus, error?: string | null) => void) => {
      statusListener = listener;
      listener("idle", null);
      return () => {
        statusListener = null;
      };
    }),
    onEvent: vi.fn((listener: (event: RunnerEvent) => void) => {
      eventListener = listener;
      return () => {
        eventListener = null;
      };
    }),
    run: vi.fn(async (request: RunnerExecutionRequest) => {
      statusListener?.("running", null);
      eventListener?.({
        type: "started",
        sessionId: "session-1",
        payload: {
          cwd: request.cwd,
          filePath: request.filePath,
          mode: request.mode,
          runnerType: request.runnerType,
        },
      });
      return new Promise((resolve) => {
        resolveRun = resolve;
      });
    }),
    terminate: vi.fn(async () => {
      eventListener?.({
        type: "terminated",
        sessionId: "session-1",
        payload: {
          success: false,
          exitCode: null,
          terminated: true,
        },
      });
      statusListener?.("idle", null);
      resolveRun?.({
        sessionId: "session-1",
        success: false,
        exitCode: null,
        terminated: true,
      });
    }),
    dispose: vi.fn(),
    complete() {
      eventListener?.({
        type: "stdout",
        sessionId: "session-1",
        payload: {
          text: "done\n",
          channel: "stdout",
        },
      });
      eventListener?.({
        type: "completed",
        sessionId: "session-1",
        payload: {
          success: true,
          exitCode: 0,
          terminated: false,
        },
      });
      statusListener?.("ready", null);
      resolveRun?.({
        sessionId: "session-1",
        success: true,
        exitCode: 0,
        terminated: false,
      });
    },
  };
}

describe("useExecutionRunner", () => {
  const scope = {
    scopeId: "pane-1::tab-1",
    kind: "code" as const,
    paneId: "pane-1",
    tabId: "tab-1",
    filePath: "workspace/test.py",
    fileName: "test.py",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => {
      await destroyExecutionScope(scope.scopeId);
    });
  });

  it("会阻止同一 scope 的并发运行请求", async () => {
    const session = createSessionMock();
    mockCreateSession.mockReturnValue(session);

    const { result } = renderHook(() => useExecutionRunner({ scope }));
    const request: RunnerExecutionRequest = {
      runnerType: "python-local",
      command: "python",
      code: "print('hello')",
      mode: "inline",
    };

    let firstRun: Promise<unknown> | undefined;
    await act(async () => {
      firstRun = result.current.run(request);
      await Promise.resolve();
    });

    const secondRun = await act(async () => result.current.run(request));

    expect(session.run).toHaveBeenCalledTimes(1);
    expect(secondRun.success).toBe(false);

    await act(async () => {
      session.complete();
      await firstRun;
    });

    await waitFor(() => {
      expect(result.current.commandState.canRun).toBe(true);
    });
  });

  it("卸载时不会释放 session，scope 销毁时才释放", async () => {
    const session = createSessionMock();
    mockCreateSession.mockReturnValue(session);

    const { result, unmount } = renderHook(() => useExecutionRunner({ scope }));

    await act(async () => {
      void result.current.run({
        runnerType: "python-local",
        command: "python",
        code: "print('hi')",
        mode: "inline",
      });
      await Promise.resolve();
    });

    unmount();
    expect(session.dispose).not.toHaveBeenCalled();

    await act(async () => {
      await destroyExecutionScope(scope.scopeId);
    });

    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  it("在同一 scope remount 后保留最近一次执行结果", async () => {
    const session = createSessionMock();
    mockCreateSession.mockReturnValue(session);

    const first = renderHook(() => useExecutionRunner({ scope }));

    let runPromise: Promise<unknown> | undefined;
    await act(async () => {
      runPromise = first.result.current.run({
        runnerType: "python-local",
        command: "python",
        code: "print('hi')",
        mode: "inline",
      });
      await Promise.resolve();
    });

    await act(async () => {
      session.complete();
      await runPromise;
    });

    first.unmount();

    const second = renderHook(() => useExecutionRunner({ scope }));

    expect(second.result.current.outputs).toEqual([
      {
        type: "text",
        content: "done\n",
        channel: "stdout",
      },
    ]);
    expect(second.result.current.summary.exitCode).toBe(0);
    expect(second.result.current.lastRequest?.code).toBe("print('hi')");

    second.unmount();
  });
  it("does not loop when rerendered with an equivalent capability object", async () => {
    const session = createSessionMock();
    mockCreateSession.mockReturnValue(session);

    const createCapability = () => ({
      supportsSelection: true,
      supportsPersistentSession: false,
      supportsNotebook: false,
      supportsLocalExecution: true,
      supportsPyodide: false,
      canRun: true,
      canStop: true,
      canInterrupt: false,
      canRestart: false,
    });

    const hook = renderHook(
      ({ capability }: { capability: ReturnType<typeof createCapability> }) => useExecutionRunner({
        scope,
        capability,
      }),
      {
        initialProps: {
          capability: createCapability(),
        },
      },
    );

    hook.rerender({ capability: createCapability() });
    hook.rerender({ capability: createCapability() });

    await waitFor(() => {
      expect(hook.result.current.commandState.canRun).toBe(true);
    });

    expect(mockCreateSession).toHaveBeenCalledTimes(1);

    hook.unmount();
  });
});
