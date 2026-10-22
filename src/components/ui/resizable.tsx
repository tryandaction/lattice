"use client";

import React, { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { GripHorizontal, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { UI_LAYER_CLASS } from "@/lib/ui-layers";

interface ResizablePanelGroupProps {
  direction: "horizontal" | "vertical";
  className?: string;
  children: React.ReactNode;
  sizes?: number[];
  onSizesChange?: (sizes: number[]) => void;
}

interface ResizablePanelProps {
  index: number;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

interface ResizableHandleProps {
  withHandle?: boolean;
  className?: string;
  index?: number;
  ariaLabel?: string;
  testId?: string;
}

interface PanelContextValue {
  direction: "horizontal" | "vertical";
  sizes: number[];
  setSizes: (updater: (prev: number[]) => number[]) => void;
  registerPanel: (index: number, minSize: number, maxSize: number, defaultSize: number) => void;
  getConstraints: (index: number) => { minSize: number; maxSize: number };
}

const PanelContext = React.createContext<PanelContextValue | null>(null);

function normalizeSizes(input: number[]): number[] {
  if (input.length === 0) return input;
  const sum = input.reduce((acc, value) => acc + value, 0);
  if (sum === 0) return input;
  const scale = 100 / sum;
  return input.map((value) => value * scale);
}

function getElementSize(element: HTMLElement, direction: "horizontal" | "vertical"): number {
  const offsetSize = direction === "horizontal" ? element.offsetWidth : element.offsetHeight;
  if (offsetSize > 0) return offsetSize;

  const rect = element.getBoundingClientRect();
  const rectSize = direction === "horizontal" ? rect.width : rect.height;
  if (rectSize > 0) return rectSize;

  if (typeof window === "undefined") return 0;
  return direction === "horizontal" ? window.innerWidth : window.innerHeight;
}

export function ResizablePanelGroup({
  direction,
  className,
  children,
  sizes,
  onSizesChange,
}: ResizablePanelGroupProps) {
  const [internalSizes, setInternalSizes] = useState<number[]>(
    () => (sizes && sizes.length > 0 ? normalizeSizes([...sizes]) : [])
  );
  const minSizesRef = useRef<number[]>([]);
  const maxSizesRef = useRef<number[]>([]);
  const isControlled = Boolean(sizes && sizes.length > 0);
  const resolvedSizes = useMemo(() => {
    if (isControlled && sizes) {
      return normalizeSizes([...sizes]);
    }
    return internalSizes;
  }, [internalSizes, isControlled, sizes]);

  const registerPanel = useCallback(
    (index: number, minSize: number, maxSize: number, defaultSize: number) => {
      minSizesRef.current[index] = minSize;
      maxSizesRef.current[index] = maxSize;
      setInternalSizes((prev) => {
        if (prev[index] !== undefined) return prev;
        const next = [...prev];
        next[index] = defaultSize;
        return normalizeSizes(next);
      });
    },
    []
  );

  const getConstraints = useCallback((index: number) => {
    return {
      minSize: minSizesRef.current[index] ?? 5,
      maxSize: maxSizesRef.current[index] ?? 95,
    };
  }, []);

  const setSizes = useCallback(
    (updater: (prev: number[]) => number[]) => {
      if (isControlled) {
        const next = normalizeSizes(updater(resolvedSizes));
        onSizesChange?.(next);
        return;
      }
      setInternalSizes((prev) => {
        const next = normalizeSizes(updater(prev));
        onSizesChange?.(next);
        return next;
      });
    },
    [isControlled, onSizesChange, resolvedSizes]
  );

  const contextValue = useMemo(
    () => ({
      direction,
      sizes: resolvedSizes,
      setSizes,
      registerPanel,
      getConstraints,
    }),
    [direction, resolvedSizes, setSizes, registerPanel, getConstraints]
  );

  return (
    <PanelContext.Provider value={contextValue}>
      <div
        className={cn(
          "flex h-full w-full overflow-hidden",
          direction === "vertical" ? "flex-col" : "flex-row",
          className
        )}
        style={{ minWidth: 0, minHeight: 0 }}
      >
        {children}
      </div>
    </PanelContext.Provider>
  );
}

export function ResizablePanel({
  index,
  defaultSize = 50,
  minSize = 10,
  maxSize = 90,
  className,
  style,
  children,
}: ResizablePanelProps) {
  const context = React.useContext(PanelContext);
  const registerPanel = context?.registerPanel;
  const registeredRef = useRef<{
    index: number;
    minSize: number;
    maxSize: number;
    defaultSize: number;
  } | null>(null);

  useEffect(() => {
    if (!registerPanel) return;
    const prev = registeredRef.current;
    if (
      prev &&
      prev.index === index &&
      prev.minSize === minSize &&
      prev.maxSize === maxSize &&
      prev.defaultSize === defaultSize
    ) {
      return;
    }
    registerPanel(index, minSize, maxSize, defaultSize);
    registeredRef.current = { index, minSize, maxSize, defaultSize };
  }, [registerPanel, index, minSize, maxSize, defaultSize]);

  const size = context?.sizes[index] ?? defaultSize;
  const isHorizontal = context?.direction === "horizontal";

  return (
    <div
      className={cn("overflow-hidden", className)}
      style={{
        flex: `${size} 1 0%`,
        minWidth: isHorizontal ? 0 : undefined,
        minHeight: !isHorizontal ? 0 : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function ResizableHandle({
  withHandle,
  className,
  index = 0,
  ariaLabel,
  testId,
}: ResizableHandleProps) {
  const context = React.useContext(PanelContext);
  const handleRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [shieldMounted, setShieldMounted] = useState(false);
  const startPosRef = useRef(0);
  const startSizesRef = useRef<number[]>([]);
  const containerSizeRef = useRef(0);
  const activePointerIdRef = useRef<number | null>(null);
  const pendingPositionRef = useRef<number | null>(null);
  const dragFrameRef = useRef(0);
  const previousBodyStylesRef = useRef<{ cursor: string; userSelect: string } | null>(null);

  const restoreBodyStyles = useCallback(() => {
    const previous = previousBodyStylesRef.current;
    previousBodyStylesRef.current = null;
    if (previous && typeof document !== "undefined") {
      document.body.style.cursor = previous.cursor;
      document.body.style.userSelect = previous.userSelect;
    }
  }, []);

  useEffect(() => () => {
    if (dragFrameRef.current !== 0) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = 0;
    }
    pendingPositionRef.current = null;
    isDragging.current = false;
    activePointerIdRef.current = null;
    restoreBodyStyles();
  }, [restoreBodyStyles]);

  const resizeAdjacentPanels = useCallback((delta: number) => {
    context?.setSizes(() => {
      const newSizes = [...startSizesRef.current];
      const leftIndex = index;
      const rightIndex = index + 1;
      if (newSizes.length <= rightIndex) return newSizes;

      const left = newSizes[leftIndex] ?? 0;
      const right = newSizes[rightIndex] ?? 0;
      const total = left + right;
      if (total <= 0) return newSizes;

      const leftConstraints = context?.getConstraints(leftIndex);
      const rightConstraints = context?.getConstraints(rightIndex);
      const minLeft = leftConstraints?.minSize ?? 5;
      const maxLeft = leftConstraints?.maxSize ?? 95;
      const minRight = rightConstraints?.minSize ?? 5;
      const maxRight = rightConstraints?.maxSize ?? 95;

      let nextLeft = left + delta;
      nextLeft = Math.max(minLeft, Math.min(maxLeft, nextLeft));
      nextLeft = Math.min(nextLeft, total - minRight);

      let nextRight = total - nextLeft;
      nextRight = Math.max(minRight, Math.min(maxRight, nextRight));
      nextLeft = total - nextRight;

      newSizes[leftIndex] = nextLeft;
      newSizes[rightIndex] = nextRight;

      return newSizes;
    });
  }, [context, index]);

  const updateDragPosition = useCallback(
    (currentPosition: number) => {
      if (!isDragging.current || containerSizeRef.current <= 0) {
        return;
      }
      const delta = ((currentPosition - startPosRef.current) / containerSizeRef.current) * 100;
      resizeAdjacentPanels(delta);
    },
    [resizeAdjacentPanels],
  );

  const scheduleDragPosition = useCallback((currentPosition: number) => {
    pendingPositionRef.current = currentPosition;
    if (dragFrameRef.current !== 0 || typeof window === "undefined") {
      return;
    }
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = 0;
      const pendingPosition = pendingPositionRef.current;
      pendingPositionRef.current = null;
      if (pendingPosition !== null) {
        updateDragPosition(pendingPosition);
      }
    });
  }, [updateDragPosition]);

  const endDrag = useCallback(() => {
    if (!isDragging.current) return;
    if (dragFrameRef.current !== 0 && typeof window !== "undefined") {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = 0;
    }
    const pendingPosition = pendingPositionRef.current;
    pendingPositionRef.current = null;
    if (pendingPosition !== null) {
      updateDragPosition(pendingPosition);
    }
    isDragging.current = false;
    activePointerIdRef.current = null;
    setDragging(false);
    setShieldMounted(false);
    restoreBodyStyles();
  }, [restoreBodyStyles, updateDragPosition]);

  const handleNativePointerMove = useCallback(
    (event: PointerEvent) => {
      if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) {
        return;
      }
      event.preventDefault();
      scheduleDragPosition(context?.direction === "horizontal" ? event.clientX : event.clientY);
    },
    [context?.direction, scheduleDragPosition],
  );

  const handleNativeMouseMove = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      scheduleDragPosition(context?.direction === "horizontal" ? event.clientX : event.clientY);
    },
    [context?.direction, scheduleDragPosition],
  );

  const handleNativeEnd = useCallback(
    (event: PointerEvent | MouseEvent) => {
      if ("pointerId" in event && activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) return;
      event.preventDefault();
      endDrag();
    },
    [endDrag],
  );

  useEffect(() => {
    if (!dragging || typeof window === "undefined") {
      return;
    }

    const supportsPointerEvents = "PointerEvent" in window;
    window.addEventListener("blur", endDrag);
    if (supportsPointerEvents) {
      window.addEventListener("pointermove", handleNativePointerMove, { passive: false });
      window.addEventListener("pointerup", handleNativeEnd, { passive: false });
      window.addEventListener("pointercancel", handleNativeEnd, { passive: false });
    } else {
      window.addEventListener("mousemove", handleNativeMouseMove, { passive: false });
      window.addEventListener("mouseup", handleNativeEnd, { passive: false });
    }

    return () => {
      window.removeEventListener("blur", endDrag);
      if (supportsPointerEvents) {
        window.removeEventListener("pointermove", handleNativePointerMove);
        window.removeEventListener("pointerup", handleNativeEnd);
        window.removeEventListener("pointercancel", handleNativeEnd);
      } else {
        window.removeEventListener("mousemove", handleNativeMouseMove);
        window.removeEventListener("mouseup", handleNativeEnd);
      }
    };
  }, [dragging, endDrag, handleNativeEnd, handleNativeMouseMove, handleNativePointerMove]);

  const beginDrag = useCallback(
    (startPosition: number, pointerId?: number) => {
      if (isDragging.current) {
        return;
      }
      isDragging.current = true;
      activePointerIdRef.current = typeof pointerId === "number" ? pointerId : null;
      setDragging(true);
      startPosRef.current = startPosition;
      startSizesRef.current = [...(context?.sizes ?? [])];
      if (typeof document !== "undefined") {
        previousBodyStylesRef.current = {
          cursor: document.body.style.cursor,
          userSelect: document.body.style.userSelect,
        };
        document.body.style.cursor = context?.direction === "horizontal" ? "col-resize" : "row-resize";
        document.body.style.userSelect = "none";
      }

      const container = handleRef.current?.parentElement;
      if (!container) {
        endDrag();
        return;
      }

      const containerSize = getElementSize(container, context?.direction ?? "horizontal");
      if (containerSize <= 0) {
        endDrag();
        return;
      }
      containerSizeRef.current = containerSize;
      setShieldMounted(true);
    },
    [context?.direction, context?.sizes, endDrag],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof window !== "undefined" && "PointerEvent" in window) {
        return;
      }
      beginDrag(context?.direction === "horizontal" ? e.clientX : e.clientY);
    },
    [beginDrag, context?.direction]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // Some embedded webviews can reject pointer capture during nested pane drags.
      }
      beginDrag(context?.direction === "horizontal" ? e.clientX : e.clientY, e.pointerId);
    },
    [beginDrag, context?.direction]
  );

  const handleShieldPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) {
        return;
      }
      e.preventDefault();
      scheduleDragPosition(context?.direction === "horizontal" ? e.clientX : e.clientY);
    },
    [context?.direction, scheduleDragPosition],
  );

  const handleShieldMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      scheduleDragPosition(context?.direction === "horizontal" ? e.clientX : e.clientY);
    },
    [context?.direction, scheduleDragPosition],
  );

  const handleShieldEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
      if ("pointerId" in e && activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;
      e.preventDefault();
      endDrag();
    },
    [endDrag],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const isHorizontal = context?.direction === "horizontal";
      const forwardKey = isHorizontal ? "ArrowRight" : "ArrowDown";
      const backwardKey = isHorizontal ? "ArrowLeft" : "ArrowUp";
      if (e.key !== forwardKey && e.key !== backwardKey) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      startSizesRef.current = [...(context?.sizes ?? [])];
      const step = e.shiftKey ? 8 : 2;
      resizeAdjacentPanels(e.key === forwardKey ? step : -step);
    },
    [context?.direction, context?.sizes, resizeAdjacentPanels]
  );

  const isHorizontal = context?.direction === "horizontal";

  return (
    <div
      ref={handleRef}
      onMouseDown={handleMouseDown}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      role="separator"
      aria-orientation={isHorizontal ? "vertical" : "horizontal"}
      aria-label={ariaLabel ?? (isHorizontal ? "Resize panels horizontally" : "Resize panels vertically")}
      title={ariaLabel ?? (isHorizontal ? "Resize panels horizontally" : "Resize panels vertically")}
      data-testid={testId}
      tabIndex={0}
      data-dragging={dragging ? "true" : "false"}
      style={{ zIndex: 90 }}
      className={cn(
        "group relative flex shrink-0 touch-none select-none items-center justify-center outline-none",
        "bg-transparent transition-colors",
        isHorizontal ? "-mx-[7px] w-[14px] cursor-col-resize" : "-my-[7px] h-[14px] cursor-row-resize",
        "focus-visible:ring-1 focus-visible:ring-ring",
        UI_LAYER_CLASS.desktopResizeHandle,
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute rounded-full bg-border transition-all duration-150",
          isHorizontal
            ? "left-1/2 top-0 h-full w-px -translate-x-1/2 group-hover:w-0.5 group-focus-visible:w-0.5"
            : "left-0 top-1/2 h-px w-full -translate-y-1/2 group-hover:h-0.5 group-focus-visible:h-0.5",
          "group-hover:bg-primary/50 group-focus-visible:bg-primary/60",
          dragging && "bg-primary/70"
        )}
      />
      {withHandle ? (
        <>
          <span
            aria-hidden="true"
            data-testid={testId ? `${testId}-grip` : "resizable-handle-grip"}
            className={cn(
              "pointer-events-none absolute z-10 inline-flex items-center justify-center rounded-sm border border-border/80 bg-background/95 text-muted-foreground opacity-70 shadow-sm transition-[opacity,color,border-color] duration-150",
              "group-hover:border-primary/40 group-hover:text-foreground group-hover:opacity-100 group-focus-visible:opacity-100",
              isHorizontal ? "h-7 w-3" : "h-3 w-7",
              dragging && "border-primary/50 text-primary opacity-100",
            )}
          >
            {isHorizontal
              ? <GripVertical className="h-3 w-3" />
              : <GripHorizontal className="h-3 w-3" />}
          </span>
          <span className="sr-only">Drag to resize</span>
        </>
      ) : null}
      {shieldMounted && typeof document !== "undefined" && createPortal(
        <div
          data-testid="resizable-drag-shield"
          aria-hidden="true"
          onPointerMove={handleShieldPointerMove}
          onPointerUp={handleShieldEnd}
          onPointerCancel={handleShieldEnd}
          onMouseMove={handleShieldMouseMove}
          onMouseUp={handleShieldEnd}
          className={cn(
            "fixed inset-0 z-[2147483647] touch-none select-none bg-transparent",
            isHorizontal ? "cursor-col-resize" : "cursor-row-resize",
          )}
        />,
        document.body,
      )}
    </div>
  );
}
