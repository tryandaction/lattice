"use client";

import React, { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

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
  children: React.ReactNode;
}

interface ResizableHandleProps {
  withHandle?: boolean;
  className?: string;
  index?: number;
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
}: ResizableHandleProps) {
  const context = React.useContext(PanelContext);
  const handleRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startPosRef = useRef(0);
  const startSizesRef = useRef<number[]>([]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startPosRef.current = context?.direction === "horizontal" ? e.clientX : e.clientY;
      startSizesRef.current = [...(context?.sizes ?? [])];

      const container = handleRef.current?.parentElement;
      if (!container) return;

      const containerSize =
        context?.direction === "horizontal"
          ? container.offsetWidth
          : container.offsetHeight;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDragging.current) return;

        const currentPos =
          context?.direction === "horizontal"
            ? moveEvent.clientX
            : moveEvent.clientY;
        const delta = ((currentPos - startPosRef.current) / containerSize) * 100;

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
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [context, index]
  );

  const isHorizontal = context?.direction === "horizontal";

  return (
    <div
      ref={handleRef}
      onMouseDown={handleMouseDown}
      className={cn(
        "relative flex items-center justify-center bg-border",
        isHorizontal ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
        "hover:bg-primary/50 transition-colors",
        className
      )}
    >
      {withHandle && (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
          <GripVertical className="h-2.5 w-2.5" />
        </div>
      )}
    </div>
  );
}
