import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { RunnerEvent } from '@/lib/runner/types';

const mockCreatePersistentPythonSession = vi.hoisted(() => vi.fn());
const mockCreateSession = vi.hoisted(() => vi.fn());

vi.mock('@/lib/storage-adapter', () => ({
  isTauriHost: () => true,
}));

vi.mock('@/lib/runner/runner-manager', () => ({
  runnerManager: {
    createPersistentPythonSession: mockCreatePersistentPythonSession,
    createSession: mockCreateSession,
  },
}));

import { useNotebookExecutor } from '@/hooks/use-notebook-executor';

const pythonLocalRunner = {
  id: 'python-local',
  runnerType: 'python-local' as const,
  displayName: 'Python Local',
  description: 'Local Python runtime',
  command: 'python',
};

function createPersistentSessionMock() {
  return {
    execute: vi.fn(),
    stop: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    onEvent: vi.fn(),
    start: vi.fn(async () => 'session-1'),
  };
}

describe('useNotebookExecutor (Tauri persistent session)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSession.mockImplementation(() => {
      throw new Error('createSession should not be used for python-local notebook execution in Tauri');
    });
  });

  it('挂载后不会自动启动持久会话，只有运行或验证时才启动', () => {
    const session = createPersistentSessionMock();
    mockCreatePersistentPythonSession.mockReturnValue(session);

    renderHook(() =>
      useNotebookExecutor({
        runner: pythonLocalRunner,
        cwd: '/workspace',
      })
    );

    expect(mockCreatePersistentPythonSession).not.toHaveBeenCalled();
    expect(session.start).not.toHaveBeenCalled();
  });

  it('应该在运行多个单元格时复用同一个持久会话', async () => {
    const session = createPersistentSessionMock();
    session.execute.mockImplementation(async ({ code }: { code: string }, onEvent?: (event: RunnerEvent) => void) => {
      onEvent?.({
        type: 'stdout',
        sessionId: 'session-1',
        payload: { text: `${code}\n`, channel: 'stdout' },
      });
      return {
        sessionId: 'session-1',
        success: true,
        exitCode: 0,
        terminated: false,
      };
    });
    mockCreatePersistentPythonSession.mockReturnValue(session);

    const { result } = renderHook(() =>
      useNotebookExecutor({
        runner: pythonLocalRunner,
        cwd: '/workspace',
      })
    );

    let runResults: Awaited<ReturnType<typeof result.current.runAll>> = [];
    await act(async () => {
      runResults = await result.current.runAll([
        { id: 'cell-1', source: 'x = 1', type: 'code' },
        { id: 'cell-2', source: 'x + 1', type: 'code' },
      ]);
    });

    expect(mockCreatePersistentPythonSession).toHaveBeenCalledTimes(1);
    expect(mockCreatePersistentPythonSession).toHaveBeenCalledWith({
      command: 'python',
      cwd: '/workspace',
    });
    expect(session.execute).toHaveBeenCalledTimes(2);
    expect(runResults).toHaveLength(2);
    expect(runResults.every((entry) => entry.success)).toBe(true);
    expect(runResults[1].outputs).toEqual([
      {
        output_type: 'stream',
        name: 'stdout',
        text: 'x + 1\n',
      },
    ]);
  });

  it('应该在中断时停止持久会话并保持 interrupted 状态', async () => {
    const session = createPersistentSessionMock();
    let resolveExecution: ((value: {
      sessionId: string;
      success: boolean;
      exitCode: number | null;
      terminated: boolean;
    }) => void) | null = null;
    session.execute.mockImplementation(
      async (_request: { code: string }, onEvent?: (event: RunnerEvent) => void) =>
        new Promise((resolve) => {
          resolveExecution = resolve;
          onEvent?.({
            type: 'stdout',
            sessionId: 'session-1',
            payload: { text: 'running\n', channel: 'stdout' },
          });
        })
    );
    session.stop.mockImplementation(async () => {
      resolveExecution?.({
        sessionId: 'session-1',
        success: false,
        exitCode: null,
        terminated: true,
      });
    });
    mockCreatePersistentPythonSession.mockReturnValue(session);

    const { result } = renderHook(() =>
      useNotebookExecutor({
        runner: pythonLocalRunner,
      })
    );

    let runPromise: Promise<unknown> | undefined;
    await act(async () => {
      runPromise = result.current.runAll([
        { id: 'cell-1', source: 'import time; time.sleep(10)', type: 'code' },
      ]);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.executionState).toBe('running');
    });

    await act(async () => {
      await result.current.interrupt();
    });

    await act(async () => {
      await runPromise;
    });

    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(result.current.executionState).toBe('interrupted');
  });

  it('应该在卸载时释放持久会话', async () => {
    const session = createPersistentSessionMock();
    session.execute.mockResolvedValue({
      sessionId: 'session-1',
      success: true,
      exitCode: 0,
      terminated: false,
    });
    mockCreatePersistentPythonSession.mockReturnValue(session);

    const { result, unmount } = renderHook(() =>
      useNotebookExecutor({
        runner: pythonLocalRunner,
      })
    );

    await act(async () => {
      await result.current.executeCell('cell-1', '42');
    });

    unmount();
    await waitFor(() => {
      expect(session.dispose).toHaveBeenCalledTimes(1);
    });
  });
});
