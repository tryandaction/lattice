import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMemo } from "react";
import { usePaneCommandBar } from "@/hooks/use-pane-command-bar";
import { useWorkspaceStore } from "@/stores/workspace-store";

function Fixture({
  version,
  onTrigger,
  scopeId = "pane-test::tab-1",
}: {
  version: number;
  onTrigger: (version: number) => void;
  scopeId?: string;
}) {
  const state = useMemo(() => ({
    breadcrumbs: [],
    actions: [
      {
        id: "run",
        label: "Run",
        onTrigger: () => onTrigger(version),
      },
    ],
  }), [onTrigger, version]);

  usePaneCommandBar({
    paneId: "pane-test",
    scopeId,
    state,
  });

  return null;
}

describe("usePaneCommandBar", () => {
  afterEach(() => {
    useWorkspaceStore.getState().clearCommandBarState("pane-test");
  });

  it("在动作签名不变时也会刷新最新闭包", async () => {
    const onTrigger = vi.fn();
    const { rerender, unmount } = render(<Fixture version={1} onTrigger={onTrigger} />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().commandBarByPane["pane-test"]).toBeDefined();
    });

    act(() => {
      useWorkspaceStore.getState().commandBarByPane["pane-test"].actions[0].onTrigger?.();
    });

    rerender(<Fixture version={2} onTrigger={onTrigger} />);

    await waitFor(() => {
      act(() => {
        useWorkspaceStore.getState().commandBarByPane["pane-test"].actions[0].onTrigger?.();
      });
      expect(onTrigger).toHaveBeenNthCalledWith(2, 2);
    });

    unmount();
  });

  it("卸载旧 scope 时不会清掉同 pane 下新 scope 的动作", async () => {
    const onTrigger = vi.fn();
    const first = render(<Fixture version={1} onTrigger={onTrigger} scopeId="pane-test::tab-1" />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().commandBarByPane["pane-test"]?.scopeId).toBe("pane-test::tab-1");
    });

    const second = render(<Fixture version={2} onTrigger={onTrigger} scopeId="pane-test::tab-2" />);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().commandBarByPane["pane-test"]?.scopeId).toBe("pane-test::tab-2");
    });

    first.unmount();

    expect(useWorkspaceStore.getState().commandBarByPane["pane-test"]?.scopeId).toBe("pane-test::tab-2");

    second.unmount();
  });
});
