/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LayoutRenderer } from "../layout-renderer";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { SplitNode } from "@/types/layout";

const paneRender = vi.hoisted(() => vi.fn(() => null));
vi.mock("../pane-wrapper", () => ({ PaneWrapper: paneRender }));

describe("split resize rendering", () => {
  it("does not rerender document subtrees when only pane sizes change", () => {
    const originalLayout = useWorkspaceStore.getState().layout;
    useWorkspaceStore.setState({ layout: { activePaneId: "left", root: {
      type: "split", id: "split", direction: "horizontal", sizes: [50, 50], children: [
        { type: "pane", id: "left", activeTabIndex: -1, tabs: [] },
        { type: "pane", id: "right", activeTabIndex: -1, tabs: [] },
      ],
    } } });
    const Host = () => {
      const layout = useWorkspaceStore((state) => state.layout);
      return <LayoutRenderer node={layout.root} activePaneId={layout.activePaneId} />;
    };
    paneRender.mockClear();
    const { unmount } = render(<Host />);
    try {
      expect(paneRender).toHaveBeenCalledTimes(2);
      for (let i = 0; i < 10; i += 1) {
        act(() => useWorkspaceStore.getState().resizePanes("split", [50 + i, 50 - i]));
      }
      expect(paneRender).toHaveBeenCalledTimes(2);
    } finally {
      unmount();
      useWorkspaceStore.setState({ layout: originalLayout });
    }
  });

  it("applies a burst in the first frame and commits the final pointer position immediately", () => {
    const callbacks: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const original = useWorkspaceStore.getState().resizePanes;
    const resize = vi.fn();
    useWorkspaceStore.setState({ resizePanes: resize });
    const split: SplitNode = { type: "split", id: "split", direction: "horizontal", sizes: [50, 50], children: [
      { type: "pane", id: "left", activeTabIndex: -1, tabs: [] },
      { type: "pane", id: "right", activeTabIndex: -1, tabs: [] },
    ] };
    const { unmount } = render(<LayoutRenderer node={split} activePaneId="left" />);
    try {
      const handle = screen.getByRole("separator");
      Object.defineProperty(handle.parentElement, "offsetWidth", { configurable: true, value: 1000 });
      fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
      for (let x = 501; x <= 600; x += 1) fireEvent.pointerMove(window, { clientX: x, pointerId: 1 });
      expect(callbacks).toHaveLength(1);
      act(() => callbacks[0]?.(16));
      expect(resize).toHaveBeenCalledExactlyOnceWith("split", [60, 40]);
      fireEvent.pointerMove(window, { clientX: 700, pointerId: 1 });
      fireEvent.pointerUp(window, { pointerId: 1 });
      expect(resize).toHaveBeenLastCalledWith("split", [70, 30]);
      expect(resize).toHaveBeenCalledTimes(2);
    } finally {
      unmount();
      useWorkspaceStore.setState({ resizePanes: original });
      raf.mockRestore();
      cancel.mockRestore();
    }
  });
});
