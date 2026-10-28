import { createElement } from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHUDStore } from "@/stores/hud-store";
import { positionQuantumPanel } from "../position";
import { usePanelPosition } from "../use-panel-position";

function PositionedPanel({ fitContent }: { fitContent: boolean }) {
  const position = usePanelPosition({ fitContent });
  return createElement("section", { ref: position.panelRef, style: position.style });
}

describe("viewport-safe formula panel", () => {
  it.each([[320, 568], [390, 844], [760, 420], [1280, 720], [240, 320]])("stays within %s×%s even after dragging beyond the screen", (width, height) => {
    for (const dock of ["top", "bottom"] as const) {
      for (const offset of [{ x: 0, y: 0 }, { x: 9000, y: 9000 }, { x: -9000, y: -9000 }]) {
        const result = positionQuantumPanel({ width, height, dock, offset });
        expect(result.left).toBeGreaterThanOrEqual(0);
        expect(result.top).toBeGreaterThanOrEqual(0);
        expect(result.left + result.width).toBeLessThanOrEqual(width);
        expect(result.top + result.height).toBeLessThanOrEqual(height);
      }
    }
  });

  it("docks a compact content panel using its actual height", () => {
    expect(positionQuantumPanel({ width: 1280, height: 900, dock: "bottom", contentHeight: 340 })).toMatchObject({ height: 340, top: 548 });
    expect(positionQuantumPanel({ width: 1280, height: 900, dock: "top", contentHeight: 340 })).toMatchObject({ height: 340, top: 12 });
  });

  it("allows natural content taller than the fixed browse height while staying in the viewport", () => {
    expect(positionQuantumPanel({ width: 1280, height: 900, dock: "bottom", contentHeight: 620 })).toMatchObject({ height: 620, top: 268 });
    expect(positionQuantumPanel({ width: 390, height: 500, dock: "bottom", contentHeight: 900 })).toMatchObject({ height: 476, top: 12 });
  });

  it("clamps dragged compact panels according to their measured size", () => {
    expect(positionQuantumPanel({ width: 1280, height: 900, dock: "top", contentHeight: 340, offset: { x: 0, y: 9000 } })).toMatchObject({ height: 340, top: 548 });
    expect(positionQuantumPanel({ width: 1280, height: 900, dock: "bottom", contentHeight: 340, offset: { x: 0, y: -9000 } })).toMatchObject({ height: 340, top: 12 });
  });

  it("retains the fixed browse size when no content height is supplied", () => {
    expect(positionQuantumPanel({ width: 1280, height: 900, dock: "bottom" })).toMatchObject({ height: 520, top: 368 });
  });

  it("measures natural content, observes changes and restores fixed mode", () => {
    let measuredHeight = 340;
    let onResize: ResizeObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { onResize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const rectangle = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ height: measuredHeight }) as DOMRect);
    const originalOffset = useHUDStore.getState().customOffset;
    const originalDock = useHUDStore.getState().position;
    useHUDStore.setState({ customOffset: null, position: "bottom" });
    const view = render(createElement(PositionedPanel, { fitContent: true }));
    try {
      const panel = view.container.querySelector("section")!;
      expect(panel.style.height).toBe("auto");
      const firstTop = Number.parseFloat(panel.style.top);
      measuredHeight = 400;
      act(() => onResize?.([], {} as ResizeObserver));
      expect(Number.parseFloat(panel.style.top)).toBe(firstTop - 60);
      view.rerender(createElement(PositionedPanel, { fitContent: false }));
      expect(panel.style.height).toBe("520px");
      expect(disconnect).toHaveBeenCalledOnce();
      measuredHeight = 300;
      view.rerender(createElement(PositionedPanel, { fitContent: true }));
      expect(panel.style.height).toBe("auto");
      expect(Number.parseFloat(panel.style.top)).toBe(firstTop + 40);
    } finally {
      view.unmount();
      rectangle.mockRestore();
      vi.unstubAllGlobals();
      useHUDStore.setState({ customOffset: originalOffset, position: originalDock });
    }
  });
});
