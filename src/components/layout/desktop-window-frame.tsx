"use client";

import { memo, useCallback, type CSSProperties } from "react";
import {
  isWindowsDesktopHost,
  startDesktopWindowResize,
  toggleDesktopWindowMaximize,
  type DesktopResizeDirection,
} from "@/lib/desktop-window";
import {
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
    style: { left: 8, right: 0, top: 0, height: 6, cursor: "n-resize" },
    testId: "desktop-resize-north",
  },
  {
    direction: "south",
    style: { left: 8, right: 8, bottom: 0, height: 6, cursor: "s-resize" },
    testId: "desktop-resize-south",
  },
  {
    direction: "west",
    style: { left: 0, top: 8, bottom: 8, width: 6, cursor: "w-resize" },
    testId: "desktop-resize-west",
  },
  {
    direction: "east",
    style: { right: 0, top: 8, bottom: 8, width: 6, cursor: "e-resize" },
    testId: "desktop-resize-east",
  },
  {
    direction: "north-west",
    style: { left: 0, top: 0, width: 14, height: 14, cursor: "nw-resize" },
    testId: "desktop-resize-north-west",
  },
  {
    direction: "north-east",
    style: { right: 0, top: 0, width: 14, height: 14, cursor: "ne-resize" },
    testId: "desktop-resize-north-east",
  },
  {
    direction: "south-west",
    style: { left: 0, bottom: 0, width: 14, height: 14, cursor: "sw-resize" },
    testId: "desktop-resize-south-west",
  },
  {
    direction: "south-east",
    style: { right: 0, bottom: 0, width: 14, height: 14, cursor: "se-resize" },
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
