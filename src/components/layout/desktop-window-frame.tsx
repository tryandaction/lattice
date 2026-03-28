"use client";

import { memo, useCallback, type CSSProperties } from "react";
import {
  isWindowsDesktopHost,
  startDesktopWindowResize,
  toggleDesktopWindowMaximize,
  type DesktopResizeDirection,
} from "@/lib/desktop-window";
import {
  DESKTOP_COMMAND_BAR_HEIGHT,
  DESKTOP_WINDOW_CONTROLS_SAFE_WIDTH,
  DESKTOP_WINDOW_TOP_STRIP_HEIGHT,
} from "@/components/layout/desktop-window-metrics";

const RESIZE_HANDLES: Array<{
  direction: DesktopResizeDirection;
  style: CSSProperties;
  testId: string;
}> = [
  {
    direction: "north",
    style: { left: 12, right: DESKTOP_WINDOW_CONTROLS_SAFE_WIDTH, top: 0, height: DESKTOP_WINDOW_TOP_STRIP_HEIGHT, cursor: "n-resize" },
    testId: "desktop-resize-north",
  },
  {
    direction: "south",
    style: { left: 12, right: 12, bottom: 0, height: 4, cursor: "s-resize" },
    testId: "desktop-resize-south",
  },
  {
    direction: "west",
    style: { left: 0, top: 12, bottom: 12, width: 4, cursor: "w-resize" },
    testId: "desktop-resize-west",
  },
  {
    direction: "east",
    style: { right: 0, top: DESKTOP_COMMAND_BAR_HEIGHT, bottom: 12, width: 4, cursor: "e-resize" },
    testId: "desktop-resize-east",
  },
  {
    direction: "north-west",
    style: { left: 0, top: 0, width: 12, height: 12, cursor: "nw-resize" },
    testId: "desktop-resize-north-west",
  },
  {
    direction: "north-east",
    style: { right: DESKTOP_WINDOW_CONTROLS_SAFE_WIDTH, top: 0, width: 12, height: 12, cursor: "ne-resize" },
    testId: "desktop-resize-north-east",
  },
  {
    direction: "south-west",
    style: { left: 0, bottom: 0, width: 12, height: 12, cursor: "sw-resize" },
    testId: "desktop-resize-south-west",
  },
  {
    direction: "south-east",
    style: { right: 0, bottom: 0, width: 12, height: 12, cursor: "se-resize" },
    testId: "desktop-resize-south-east",
  },
];

export const DesktopWindowFrame = memo(function DesktopWindowFrame() {
  const isDesktop = isWindowsDesktopHost();

  const handleResize = useCallback((direction: DesktopResizeDirection) => {
    void startDesktopWindowResize(direction);
  }, []);

  const handleTopStripDoubleClick = useCallback(() => {
    void toggleDesktopWindowMaximize();
  }, []);

  if (!isDesktop) {
    return null;
  }

  return (
    <>
      <div
        className="pointer-events-auto absolute left-0 top-0 z-[80]"
        data-tauri-drag-region="true"
        data-testid="desktop-drag-strip"
        onDoubleClick={handleTopStripDoubleClick}
        style={{
          height: DESKTOP_WINDOW_TOP_STRIP_HEIGHT,
          right: DESKTOP_WINDOW_CONTROLS_SAFE_WIDTH,
        }}
      />
      <div className="pointer-events-none absolute inset-0 z-[90]" aria-hidden="true">
        {RESIZE_HANDLES.map((handle) => (
          <button
            key={handle.direction}
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            data-testid={handle.testId}
            className="pointer-events-auto absolute bg-transparent"
            style={handle.style}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleResize(handle.direction);
            }}
          />
        ))}
      </div>
    </>
  );
});

export default DesktopWindowFrame;
