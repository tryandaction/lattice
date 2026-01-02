"use client";

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface ResizablePanelGroupProps {
  direction: "horizontal" | "vertical";
  className?: string;
  children: React.ReactNode;
}

interface ResizablePanelProps {
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  className?: string;
  children: React.ReactNode;
}

interface ResizableHandleProps {
  withHandle?: boolean;
  className?: string;
}

interface PanelContextValue {
  direction: "horizontal" | "vertical";
  sizes: number[];
  setSizes: React.Dispatch<React.SetStateAction<number[]>>;
  getPanelIndex: () => number;
}

const PanelContext = React.createContext<PanelContextValue | null>(null);

export function ResizablePanelGroup({
  direction,
  className,
  children,
}: ResizablePanelGroupProps) {
  const [sizes, setSizes] = useState<number[]>([]);
  const panelIndexRef = useRef(0);

  // Reset panel index on each render cycle start
  useEffect(() => {
    panelIndexRef.current = 0;
  });

  const getPanelIndex = useCallback(() => {
    return panelIndexRef.current++;
  }, []);

  const contextValue = useMemo(
    () => ({ direction, sizes, setSizes, getPanelIndex }),
    [direction, sizes, getPanelIndex]
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
  defaultSize = 50,
  minSize = 10,
  maxSize = 90,
  className,
  children,
}: ResizablePanelProps) {
  const context = React.useContext(PanelContext);
  const [index] = useState(() => context?.getPanelIndex() ?? 0);
  const initializedRef = useRef(false);

  // Initialize size only once
  useEffect(() => {
    if (!initializedRef.current && context) {
      initializedRef.current = true;
      context.setSizes((prev) => {
        const newSizes = [...prev];
        if (newSizes[index] === undefined) {
          newSizes[index] = defaultSize;
        }
        return newSizes;
      });
    }
  }, [context, index, defaultSize]);

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
          if (newSizes.length >= 2) {
            const newFirst = Math.max(10, Math.min(90, newSizes[0] + delta));
            const newSecond = 100 - newFirst;
            if (newSecond >= 10 && newSecond <= 90) {
              newSizes[0] = newFirst;
              newSizes[1] = newSecond;
            }
          }
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
    [context]
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
