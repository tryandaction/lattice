/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../resizable";

function renderHorizontalPanels(onSizesChange = vi.fn()) {
  render(
    <div data-testid="host" style={{ width: "1000px", height: "400px" }}>
      <ResizablePanelGroup direction="horizontal" sizes={[50, 50]} onSizesChange={onSizesChange}>
        <ResizablePanel index={0} minSize={20} maxSize={80}>
          left
        </ResizablePanel>
        <ResizableHandle withHandle index={0} />
        <ResizablePanel index={1} minSize={20} maxSize={80}>
          right
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>,
  );
  return onSizesChange;
}

function renderDesktopDockPanels(onSizesChange = vi.fn()) {
  render(
    <div data-testid="host" style={{ width: "1000px", height: "600px" }}>
      <ResizablePanelGroup direction="horizontal" sizes={[20, 52, 28]} onSizesChange={onSizesChange}>
        <ResizablePanel index={0} minSize={14} maxSize={42}>
          sidebar
        </ResizablePanel>
        <ResizableHandle withHandle index={0} />
        <ResizablePanel index={1} minSize={24}>
          main
        </ResizablePanel>
        <ResizableHandle withHandle index={1} />
        <ResizablePanel index={2} minSize={22} maxSize={42}>
          ai
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>,
  );
  return onSizesChange;
}

describe("ResizablePanelGroup", () => {
  it("exposes handles as keyboard-adjustable separators with a wide hit target", () => {
    const onSizesChange = renderHorizontalPanels();

    const handle = screen.getByRole("separator");

    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("tabindex")).toBe("0");
    expect(handle.getAttribute("aria-label")).toBe("Resize panels horizontally");
    expect(handle.className).toContain("w-[14px]");
    expect(handle.className).toContain("-mx-[7px]");
    expect(handle.className).toContain("shrink-0");
    expect(handle.style.zIndex).toBe("90");
    expect(handle.className).toContain("z-[90]");
    expect(handle.className).toContain("flex");

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onSizesChange).toHaveBeenLastCalledWith([52, 48]);

    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(onSizesChange).toHaveBeenLastCalledWith([42, 58]);
  });

  it("supports pointer dragging so touch and pen resizing work like mouse resizing", () => {
    const onSizesChange = renderHorizontalPanels();
    const handle = screen.getByRole("separator");
    Object.defineProperty(handle.parentElement, "offsetWidth", { configurable: true, value: 1000 });

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    expect(handle.getAttribute("data-dragging")).toBe("true");
    const shield = document.querySelector("[data-testid='resizable-drag-shield']");
    expect(shield).not.toBeNull();
    fireEvent.pointerMove(shield!, { clientX: 620, pointerId: 1 });
    fireEvent.pointerUp(shield!, { pointerId: 1 });

    expect(handle.getAttribute("data-dragging")).toBe("false");
    expect(document.querySelector("[data-testid='resizable-drag-shield']")).toBeNull();
    expect(onSizesChange).toHaveBeenLastCalledWith([62, 38]);
  });

  it("keeps resizing from the global drag shield after the pointer leaves the separator", () => {
    const onSizesChange = renderHorizontalPanels();
    const handle = screen.getByRole("separator");
    Object.defineProperty(handle.parentElement, "offsetWidth", { configurable: true, value: 1000 });

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    const shield = document.querySelector("[data-testid='resizable-drag-shield']");
    expect(shield).not.toBeNull();

    fireEvent.pointerMove(shield!, { clientX: 700, pointerId: 1 });
    fireEvent.pointerUp(shield!, { pointerId: 1 });

    expect(onSizesChange).toHaveBeenLastCalledWith([70, 30]);
  });

  it("resizes the right AI dock in a desktop three-panel layout", () => {
    const onSizesChange = renderDesktopDockPanels();
    const handles = screen.getAllByRole("separator");
    const aiHandle = handles[1]!;
    Object.defineProperty(aiHandle.parentElement, "offsetWidth", { configurable: true, value: 1000 });

    fireEvent.pointerDown(aiHandle, { clientX: 720, pointerId: 1 });
    const shield = document.querySelector("[data-testid='resizable-drag-shield']");
    expect(shield).not.toBeNull();

    fireEvent.pointerMove(shield!, { clientX: 640, pointerId: 1 });
    fireEvent.pointerUp(shield!, { pointerId: 1 });

    expect(onSizesChange).toHaveBeenLastCalledWith([20, 44, 36]);
  });

  it("keeps resizing the AI dock from window-level pointer movement", () => {
    const onSizesChange = renderDesktopDockPanels();
    const handles = screen.getAllByRole("separator");
    const aiHandle = handles[1]!;
    Object.defineProperty(aiHandle.parentElement, "offsetWidth", { configurable: true, value: 1000 });

    fireEvent.pointerDown(aiHandle, { clientX: 720, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 640, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(onSizesChange).toHaveBeenLastCalledWith([20, 44, 36]);
    expect(document.querySelector("[data-testid='resizable-drag-shield']")).toBeNull();
  });

  it("falls back to the panel group bounding rect when offset size is zero", () => {
    const onSizesChange = renderDesktopDockPanels();
    const handles = screen.getAllByRole("separator");
    const aiHandle = handles[1]!;
    Object.defineProperty(aiHandle.parentElement, "offsetWidth", { configurable: true, value: 0 });
    aiHandle.parentElement!.getBoundingClientRect = () => ({
      width: 1000,
      height: 600,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 600,
      right: 1000,
      toJSON: () => {},
    });

    fireEvent.pointerDown(aiHandle, { clientX: 720, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 640, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(onSizesChange).toHaveBeenLastCalledWith([20, 44, 36]);
  });

  it("renders one visible separator line with an invisible drag target", () => {
    renderHorizontalPanels();
    const handle = screen.getByRole("separator");
    const visualLine = handle.querySelector("[aria-hidden='true']");
    const accessibleLabel = screen.getByText("Drag to resize");

    expect(visualLine?.className).toContain("w-px");
    expect(visualLine?.className).toContain("group-hover:w-0.5");
    expect(visualLine?.className).toContain("group-focus-visible:w-0.5");
    expect(accessibleLabel.className).toContain("sr-only");
    expect(handle.querySelector("svg")).toBeNull();
  });
});
