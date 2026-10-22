/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceLiveSync } from "../use-workspace-live-sync";
import { useWorkspaceStore } from "@/stores/workspace-store";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(async () => {}),
  expand: vi.fn(async () => {}),
  invoke: vi.fn(async (_command: string, _args: Record<string, unknown>) => {}),
  callbacks: [] as Array<(event: { payload: unknown }) => void>,
  unlisten: vi.fn(),
  invalidate: vi.fn(),
  native: true,
  vaultChange: null as null | ((path: string) => void),
}));
vi.mock("@/hooks/use-file-system", () => ({
  useFileSystem: () => ({ refreshDirectory: mocks.refresh, ensureDirectoryExpanded: mocks.expand }),
  collectExpandedDirectoryPaths: () => new Set(),
}));
vi.mock("@/lib/storage-adapter", () => ({
  isTauriHost: () => mocks.native, invokeTauriCommand: mocks.invoke,
}));
vi.mock("@/lib/desktop-file-system", () => ({
  getDesktopHandlePath: (handle: { name?: string }) => mocks.native ? "C:/" + handle.name : null,
  invalidateDesktopDirCache: mocks.invalidate, invalidateDesktopDirectoryTreeCache: mocks.invalidate,
  readDesktopFileMetadata: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_event: string, callback: typeof mocks.callbacks[number]) => { mocks.callbacks.push(callback); return mocks.unlisten; },
}));
vi.mock("@/lib/plugins/runtime", () => ({
  emitVaultChange: (path: string) => mocks.vaultChange?.(path),
  subscribeVaultChange: (callback: (path: string) => void) => { mocks.vaultChange = callback; return () => { mocks.vaultChange = null; }; },
  subscribeVaultDelete: () => () => {}, subscribeVaultRename: () => () => {},
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks(); mocks.native = true; mocks.callbacks = [];
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  useWorkspaceStore.setState({ rootHandle: { name: "root" } as FileSystemDirectoryHandle,
    layout: { activePaneId: "pane", root: { type: "pane", id: "pane", activeTabIndex: -1, tabs: [] } } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("workspace live synchronization lifecycle", () => {
  it("coalesces native events, invalidates the directory cache, and avoids vault feedback loops", async () => {
    renderHook(() => useWorkspaceLiveSync());
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    const start = mocks.invoke.mock.calls.find(call => call[0] === "desktop_watch_workspace")!;
    const id = (start[1] as { watchId: string }).watchId;
    mocks.refresh.mockClear(); mocks.invalidate.mockClear();
    act(() => {
      for (let i = 0; i < 20; i++) mocks.callbacks[0]({ payload: { watchId: id, paths: ["docs/new.txt"] } });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledWith({ silent: true, visibleOnly: true, changedPaths: ["root/docs/new.txt"] });
    expect(mocks.invalidate).toHaveBeenCalledWith("C:/root/docs/new.txt");
  });

  it("rejects old events after switching root and unregisters both listeners on cleanup", async () => {
    const view = renderHook(() => useWorkspaceLiveSync());
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    const oldCallback = mocks.callbacks[0];
    const oldStart = mocks.invoke.mock.calls.find(call => call[0] === "desktop_watch_workspace")!;
    act(() => useWorkspaceStore.setState({ rootHandle: { name: "next" } as FileSystemDirectoryHandle }));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    mocks.refresh.mockClear();
    act(() => oldCallback({ payload: { watchId: (oldStart[1] as { watchId: string }).watchId, paths: ["old.txt"] } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(mocks.refresh).not.toHaveBeenCalled();
    view.unmount();
    expect(mocks.unlisten).toHaveBeenCalledTimes(2);
    expect(mocks.invoke.mock.calls.filter(call => call[0] === "desktop_unwatch_workspace")).toHaveLength(2);
  });

  it('keeps a clean open tab bound after two renames arrive before refresh', async () => {
    const finalHandle = { kind: 'file', name: 'final.txt' } as FileSystemFileHandle;
    useWorkspaceStore.setState({
      rootHandle: { name: 'root', getFileHandle: async (name: string) => {
        if (name !== 'final.txt') throw new DOMException('Missing intermediate name', 'NotFoundError');
        return finalHandle;
      } } as FileSystemDirectoryHandle,
      layout: { activePaneId: 'pane', root: { type: 'pane', id: 'pane', activeTabIndex: 0, tabs: [{
        id: 'rapid-rename', fileName: 'original.txt', filePath: 'root/original.txt',
        fileHandle: {} as FileSystemFileHandle, isDirty: false, scrollPosition: 42,
      }] } },
    });
    renderHook(() => useWorkspaceLiveSync());
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    const start = mocks.invoke.mock.calls.find(call => call[0] === 'desktop_watch_workspace')!;
    act(() => mocks.callbacks[0]({ payload: { watchId: (start[1] as { watchId: string }).watchId,
      paths: ['original.txt', 'intermediate.txt', 'final.txt'], renames: [
        { from: 'original.txt', to: 'intermediate.txt' }, { from: 'intermediate.txt', to: 'final.txt' },
      ] } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(useWorkspaceStore.getState().layout.root).toMatchObject({ tabs: [{
      filePath: 'root/final.txt', fileHandle: finalHandle, scrollPosition: 42,
    }] });
  });

  it("checks browser visible branches on focus and pauses periodic checks when hidden", async () => {
    mocks.native = false;
    renderHook(() => useWorkspaceLiveSync());
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    mocks.refresh.mockClear();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(mocks.refresh).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => window.dispatchEvent(new Event("focus")));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(mocks.refresh).toHaveBeenCalledWith({ silent: true, visibleOnly: true, changedPaths: undefined });
  });
});
