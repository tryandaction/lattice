"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type MutableRefObject,
  type ReactNode,
  type Ref,
  type WheelEvent,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type ViewportProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "className" | "onScroll" | "onWheel" | "ref"
> & {
  [key: `data-${string}`]: string | number | undefined;
};

export interface HorizontalScrollStripProps {
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
  contentClassName?: string;
  viewportRef?: Ref<HTMLDivElement>;
  viewportProps?: ViewportProps;
  ariaLabel?: string;
  scrollStep?: number;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) {
    return;
  }

  if (typeof ref === "function") {
    ref(value);
    return;
  }

  (ref as MutableRefObject<T | null>).current = value;
}

export function HorizontalScrollStrip({
  children,
  className,
  viewportClassName,
  contentClassName,
  viewportRef,
  viewportProps,
  ariaLabel = "horizontal content",
  scrollStep,
}: HorizontalScrollStripProps) {
  const localViewportRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const node = localViewportRef.current;
    if (!node) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }

    const maxScrollLeft = Math.max(0, node.scrollWidth - node.clientWidth);
    setCanScrollLeft(node.scrollLeft > 4);
    setCanScrollRight(node.scrollLeft < maxScrollLeft - 4);
  }, []);

  const setViewportNode = useCallback((node: HTMLDivElement | null) => {
    localViewportRef.current = node;
    assignRef(viewportRef, node);
  }, [viewportRef]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      updateScrollState();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [updateScrollState]);

  useEffect(() => {
    const node = localViewportRef.current;
    if (!node) {
      return;
    }

    const handleResize = () => updateScrollState();
    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(handleResize)
      : null;

    resizeObserver?.observe(node);
    const contentNode = node.firstElementChild;
    if (contentNode instanceof HTMLElement) {
      resizeObserver?.observe(contentNode);
    }

    node.addEventListener("scroll", handleResize, { passive: true });
    window.addEventListener("resize", handleResize);

    return () => {
      node.removeEventListener("scroll", handleResize);
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
    };
  }, [updateScrollState]);

  const scrollByDirection = useCallback((direction: -1 | 1) => {
    const node = localViewportRef.current;
    if (!node) {
      return;
    }

    const nextStep = scrollStep ?? Math.max(node.clientWidth * 0.65, 120);
    node.scrollBy({
      left: direction * nextStep,
      behavior: "smooth",
    });
  }, [scrollStep]);

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const node = localViewportRef.current;
    if (!node) {
      return;
    }

    const maxScrollLeft = node.scrollWidth - node.clientWidth;
    if (maxScrollLeft <= 1) {
      return;
    }

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;
    if (delta === 0) {
      return;
    }

    const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, node.scrollLeft + delta));
    if (nextScrollLeft === node.scrollLeft) {
      return;
    }

    event.preventDefault();
    node.scrollLeft = nextScrollLeft;
    updateScrollState();
  }, [updateScrollState]);

  const hasOverflowControls = canScrollLeft || canScrollRight;

  return (
    <div className={cn("flex min-w-0 items-stretch", className)}>
      {hasOverflowControls ? (
        <div className="flex shrink-0 items-center border-r border-border/60 px-1">
          <button
            type="button"
            onClick={() => scrollByDirection(-1)}
            disabled={!canScrollLeft}
            aria-label={`向左滚动${ariaLabel}`}
            className={cn(
              "rounded p-1 text-muted-foreground transition-colors",
              canScrollLeft ? "hover:bg-background/80 hover:text-foreground" : "cursor-default opacity-35"
            )}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <div
        {...viewportProps}
        ref={setViewportNode}
        aria-label={ariaLabel}
        onWheel={handleWheel}
        className={cn(
          "min-w-0 flex-1 overflow-x-auto overflow-y-hidden scroll-smooth [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted",
          viewportClassName,
        )}
      >
        <div className={cn("flex min-w-max items-center", contentClassName)}>
          {children}
        </div>
      </div>

      {hasOverflowControls ? (
        <div className="flex shrink-0 items-center border-l border-border/60 px-1">
          <button
            type="button"
            onClick={() => scrollByDirection(1)}
            disabled={!canScrollRight}
            aria-label={`向右滚动${ariaLabel}`}
            className={cn(
              "rounded p-1 text-muted-foreground transition-colors",
              canScrollRight ? "hover:bg-background/80 hover:text-foreground" : "cursor-default opacity-35"
            )}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
