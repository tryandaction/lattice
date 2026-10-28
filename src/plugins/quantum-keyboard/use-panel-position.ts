import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useHUDStore } from "@/stores/hud-store";
import { positionQuantumPanel } from "./position";

export function usePanelPosition({ fitContent = false }: { fitContent?: boolean } = {}) {
  const offset = useHUDStore(state => state.customOffset);
  const anchor = useHUDStore(state => state.cursorPosition);
  const preferredDock = useHUDStore(state => state.position);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [dock] = useState<"top" | "bottom">(() => preferredDock === "auto"
    ? (anchor && anchor.centerY > window.innerHeight / 2 ? "top" : "bottom")
    : preferredDock);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);
  const panelElement = useRef<HTMLElement>(null);
  const panelRef = useCallback((element: HTMLElement | null) => { panelElement.current = element; }, []);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const measuredHeight = fitContent ? contentHeight : undefined;
  const current = positionQuantumPanel({ ...viewport, dock, contentHeight: measuredHeight, offset: dragOffset ?? offset ?? undefined });
  const margin = Math.min(12, viewport.width / 4, viewport.height / 4);

  useLayoutEffect(() => {
    const panel = panelElement.current;
    if (!fitContent || !panel) return;
    const measure = () => {
      const height = Math.ceil(panel.getBoundingClientRect().height);
      if (height > 0) setContentHeight(previous => previous === height ? previous : height);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(panel);
    return () => observer?.disconnect();
  }, [fitContent]);

  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize, { passive: true });
    window.visualViewport?.addEventListener("resize", resize, { passive: true });
    return () => {
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const base = positionQuantumPanel({ ...viewport, dock, contentHeight: measuredHeight });
    drag.current = { x: event.clientX, y: event.clientY, left: current.left - base.left, top: current.top - base.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    setDragOffset({ x: drag.current.left + event.clientX - drag.current.x, y: drag.current.top + event.clientY - drag.current.y });
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    const base = positionQuantumPanel({ ...viewport, dock, contentHeight: measuredHeight });
    useHUDStore.getState().setCustomOffset({ x: current.left - base.left, y: current.top - base.top });
    drag.current = null;
    setDragOffset(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return { panelRef, style: { width: current.width, height: fitContent ? "auto" : current.height, maxHeight: Math.max(1, viewport.height - margin * 2), left: current.left, top: current.top }, custom: Boolean(offset), dragProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } };
}
