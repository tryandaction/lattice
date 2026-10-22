/**
 * @vitest-environment jsdom
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVSCodeWorkbenchStore } from "@/stores/vscode-workbench-store";

const desktopMocks = vi.hoisted(() => ({
  canUseNativeVSCodeWorkbench: vi.fn(() => true),
  startNativeVSCodeWorkbench: vi.fn(),
  getNativeVSCodeWorkbenchStatus: vi.fn(),
  openNativeVSCodeWorkbenchResource: vi.fn(),
  runNativeVSCodeWorkbenchAction: vi.fn(),
  stopNativeVSCodeWorkbench: vi.fn(),
}));

vi.mock("@/lib/vscode-workbench/desktop", () => desktopMocks);

import { NativeVSCodeWorkbenchPane } from "../native-vscode-workbench-pane";

const readySnapshot = {
  status: "ready",
  phase: "ready",
  elapsedSeconds: 1,
  firstLaunch: false,
  workspacePath: "C:/workspace",
  url: "http://127.0.0.1:40123/?folder=C%3A%2Fworkspace",
  detail: "Workbench and bridge are ready.",
  cliPath: "C:/VSCode/Code.exe",
  bridgeStatus: "ready",
};

const connectingBridgeSnapshot = {
  ...readySnapshot,
  status: "preparing",
  phase: "connectingBridge",
  detail: "Connecting Lattice Explorer to the VS Code Workbench...",
  bridgeStatus: "connecting",
};

const startingSnapshot = {
  ...readySnapshot,
  status: "preparing",
  phase: "starting",
  url: null,
  detail: "Starting the local VS Code Workbench...",
  bridgeStatus: "waiting",
};

const runtimeErrorSnapshot = {
  ...startingSnapshot,
  status: "error",
  phase: "error",
  detail: 'VS Code Workbench returned HTTP 500: {"error":"runtime failure"}',
  bridgeStatus: "error",
};

describe("NativeVSCodeWorkbenchPane", () => {
  beforeEach(() => {
    useVSCodeWorkbenchStore.getState().reset();
    vi.clearAllMocks();
    desktopMocks.canUseNativeVSCodeWorkbench.mockReturnValue(true);
    desktopMocks.startNativeVSCodeWorkbench.mockResolvedValue(readySnapshot);
    desktopMocks.getNativeVSCodeWorkbenchStatus.mockResolvedValue(
      readySnapshot,
    );
    desktopMocks.openNativeVSCodeWorkbenchResource.mockResolvedValue({
      ok: true,
      requestId: 1,
    });
    desktopMocks.runNativeVSCodeWorkbenchAction.mockResolvedValue({
      ok: true,
      requestId: null,
    });
  });

  it("starts one native Workbench and keeps its iframe stable while latest resources are dispatched", async () => {
    const { rerender } = render(
      <NativeVSCodeWorkbenchPane workspacePath="C:/workspace" />,
    );

    const iframe = await screen.findByTitle("VS Code Workbench");
    expect(desktopMocks.startNativeVSCodeWorkbench).toHaveBeenCalledTimes(1);
    expect(iframe.getAttribute("src")).toBe(readySnapshot.url);

    act(() => {
      useVSCodeWorkbenchStore
        .getState()
        .queueResource({ path: "C:/workspace/first.ts", kind: "text" });
    });

    await waitFor(() => {
      expect(
        desktopMocks.openNativeVSCodeWorkbenchResource,
      ).toHaveBeenCalledWith({
        requestId: 1,
        path: "C:/workspace/first.ts",
        kind: "text",
      });
    });

    act(() => {
      useVSCodeWorkbenchStore
        .getState()
        .queueResource({ path: "C:/workspace/latest.py", kind: "text" });
    });
    rerender(<NativeVSCodeWorkbenchPane workspacePath="C:/workspace" />);

    await waitFor(() => {
      expect(
        desktopMocks.openNativeVSCodeWorkbenchResource,
      ).toHaveBeenLastCalledWith({
        requestId: 2,
        path: "C:/workspace/latest.py",
        kind: "text",
      });
    });
    expect(screen.getByTitle("VS Code Workbench")).toBe(iframe);
    expect(iframe.getAttribute("src")).toBe(readySnapshot.url);
  });

  it("loads the Workbench while its bridge is connecting and preserves the native sidebar", async () => {
    desktopMocks.startNativeVSCodeWorkbench.mockResolvedValue(
      connectingBridgeSnapshot,
    );

    render(<NativeVSCodeWorkbenchPane workspacePath="C:/workspace" />);

    const iframe = await screen.findByTitle("VS Code Workbench");
    expect(iframe.getAttribute("src")).toBe(connectingBridgeSnapshot.url);
    expect(desktopMocks.runNativeVSCodeWorkbenchAction).not.toHaveBeenCalled();
  });

  it("dispatches the latest resource as soon as the visible Workbench can receive bridge retries", async () => {
    desktopMocks.startNativeVSCodeWorkbench.mockResolvedValue(
      connectingBridgeSnapshot,
    );
    act(() => {
      useVSCodeWorkbenchStore.getState().queueResource({
        path: "C:/workspace/analysis.py",
        kind: "text",
      });
    });

    render(<NativeVSCodeWorkbenchPane workspacePath="C:/workspace" />);

    await waitFor(() => {
      expect(
        desktopMocks.openNativeVSCodeWorkbenchResource,
      ).toHaveBeenCalledWith({
        requestId: 1,
        path: "C:/workspace/analysis.py",
        kind: "text",
      });
    });
  });

  it("acknowledges a bridge response that completes after the dispatch state updates", async () => {
    let completeRequest:
      ((value: { ok: boolean; requestId: number }) => void) | undefined;
    desktopMocks.openNativeVSCodeWorkbenchResource.mockImplementation(
      () =>
        new Promise((resolve) => {
          completeRequest = resolve;
        }),
    );

    render(<NativeVSCodeWorkbenchPane workspacePath="C:/workspace" />);
    act(() => {
      useVSCodeWorkbenchStore
        .getState()
        .queueResource({ path: "C:/workspace/slow.py", kind: "text" });
    });

    await waitFor(() => {
      expect(
        desktopMocks.openNativeVSCodeWorkbenchResource,
      ).toHaveBeenCalledTimes(1);
    });

    act(() => {
      completeRequest?.({ ok: true, requestId: 1 });
    });

    await waitFor(() => {
      expect(useVSCodeWorkbenchStore.getState().pendingResource).toBeNull();
      expect(useVSCodeWorkbenchStore.getState().lastAcknowledgedRequestId).toBe(
        1,
      );
    });
  });

  it("polls native status from startup through bridge readiness", async () => {
    desktopMocks.startNativeVSCodeWorkbench.mockResolvedValue(startingSnapshot);
    desktopMocks.getNativeVSCodeWorkbenchStatus
      .mockResolvedValueOnce(connectingBridgeSnapshot)
      .mockResolvedValue(readySnapshot);

    render(<NativeVSCodeWorkbenchPane workspacePath="C:/workspace" />);

    await waitFor(() => {
      expect(desktopMocks.getNativeVSCodeWorkbenchStatus).toHaveBeenCalledTimes(
        2,
      );
      expect(
        screen.queryByText("Workbench and bridge are ready."),
      ).not.toBeNull();
    }, { timeout: 5_000 });
  });

  it("continues polling through unchanged startup snapshots and exposes runtime errors", async () => {
    desktopMocks.startNativeVSCodeWorkbench.mockResolvedValue(startingSnapshot);
    desktopMocks.getNativeVSCodeWorkbenchStatus
      .mockResolvedValueOnce(startingSnapshot)
      .mockResolvedValueOnce(startingSnapshot)
      .mockResolvedValue(runtimeErrorSnapshot);

    render(<NativeVSCodeWorkbenchPane workspacePath="C:/workspace" />);

    await waitFor(
      () => {
        expect(
          desktopMocks.getNativeVSCodeWorkbenchStatus,
        ).toHaveBeenCalledTimes(3);
        expect(screen.queryByText(/runtime failure/i)).not.toBeNull();
      },
      { timeout: 5_000 },
    );
  });

  it("keeps polling when the start invocation times out before the backend finishes", async () => {
    desktopMocks.startNativeVSCodeWorkbench.mockRejectedValue(
      new Error(
        "Tauri command desktop_start_vscode_workbench timed out after 15000ms",
      ),
    );
    desktopMocks.getNativeVSCodeWorkbenchStatus.mockResolvedValue(
      readySnapshot,
    );

    render(<NativeVSCodeWorkbenchPane workspacePath="C:/workspace" />);

    const iframe = await screen.findByTitle("VS Code Workbench");
    expect(iframe.getAttribute("src")).toBe(readySnapshot.url);
    expect(desktopMocks.startNativeVSCodeWorkbench).toHaveBeenCalledTimes(1);
    expect(desktopMocks.getNativeVSCodeWorkbenchStatus).toHaveBeenCalled();
    expect(screen.queryByText(/timed out after 15000ms/i)).toBeNull();
  });
});
