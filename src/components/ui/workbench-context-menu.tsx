"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { positionAnchoredMenu, positionCursorMenu } from "@/lib/menu-positioning";

export interface WorkbenchMenuAction {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  tone?: "default" | "destructive";
  separatorBefore?: boolean;
  onSelect: () => void;
  children?: WorkbenchMenuAction[];
}

interface WorkbenchContextMenuProps {
  x: number;
  y: number;
  actions: WorkbenchMenuAction[];
  onClose: () => void;
  minWidthClassName?: string;
}

export function WorkbenchContextMenu({
  x,
  y,
  actions,
  onClose,
  minWidthClassName = "min-w-[190px]",
}: WorkbenchContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [maxHeight, setMaxHeight] = useState<number | null>(null);
  const [submenuStates, setSubmenuStates] = useState<Array<{
    action: WorkbenchMenuAction;
    anchorRect: DOMRect;
  }>>([]);
  const [submenuLayout, setSubmenuLayout] = useState<Array<{
    left: number;
    top: number;
    maxHeight: number | null;
  } | null>>([]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const position = positionCursorMenu({
      point: { x, y },
      menuSize: { width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    menu.style.left = `${position.left}px`;
    menu.style.top = `${position.top}px`;
    setMaxHeight(position.maxHeight);
  }, [x, y]);

  useLayoutEffect(() => {
    if (!submenuStates.length) return;

    const nextLayout = submenuStates.map((state, index) => {
      const submenu = submenuRefs.current[index];
      if (!submenu) return null;
      const rect = submenu.getBoundingClientRect();
      const position = positionAnchoredMenu({
        anchorRect: state.anchorRect,
        menuSize: { width: rect.width, height: rect.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        placement: "right-start",
      });
      return {
        left: position.left,
        top: position.top,
        maxHeight: position.maxHeight,
      };
    });

    setSubmenuLayout((currentLayout) => {
      const current = JSON.stringify(currentLayout);
      const next = JSON.stringify(nextLayout);
      return current === next ? currentLayout : nextLayout;
    });
  }, [submenuStates]);

  const openSubmenu = useCallback((action: WorkbenchMenuAction, element: HTMLElement, level: number) => {
    if (!action.children?.length) {
      setSubmenuStates((current) => current.slice(0, level));
      setSubmenuLayout((current) => current.slice(0, level));
      return;
    }
    setSubmenuStates((current) => {
      const next = current.slice(0, level);
      next[level] = { action, anchorRect: element.getBoundingClientRect() };
      return next;
    });
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !submenuRefs.current.some((submenu) => submenu?.contains(target))
      ) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const renderActionButton = (action: WorkbenchMenuAction, level: number) => {
    const hasChildren = Boolean(action.children?.length);
    return (
      <button
        type="button"
        disabled={action.disabled}
        onPointerEnter={(event) => openSubmenu(action, event.currentTarget, level)}
        onFocus={(event) => openSubmenu(action, event.currentTarget, level)}
        onClick={() => {
          if (action.disabled || hasChildren) return;
          action.onSelect();
          onClose();
        }}
        className={cn(
          "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors",
          "focus:outline-none focus:bg-accent",
          action.tone === "destructive"
            ? "hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive"
            : "hover:bg-accent",
          action.disabled && "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-current"
        )}
        role="menuitem"
        aria-haspopup={hasChildren ? "menu" : undefined}
        aria-expanded={hasChildren ? submenuStates[level]?.action.id === action.id : undefined}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
          {action.icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{action.label}</span>
        {action.shortcut && (
          <span className="ml-4 shrink-0 text-[11px] text-muted-foreground">{action.shortcut}</span>
        )}
        {hasChildren && (
          <span className="ml-2 shrink-0 text-xs text-muted-foreground" aria-hidden="true">›</span>
        )}
      </button>
    );
  };

  return (
    <>
    <div
      ref={menuRef}
      className={cn(
        "fixed z-50 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg overflow-y-auto overscroll-contain",
        minWidthClassName
      )}
      style={{ left: x, top: y, maxHeight: maxHeight ? `${maxHeight}px` : undefined }}
      role="menu"
    >
      {actions.map((action) => (
        <div key={action.id} onPointerEnter={(event) => openSubmenu(action, event.currentTarget.querySelector('button') ?? event.currentTarget, 0)}>
          {action.separatorBefore && <div className="my-1 h-px bg-border" />}
          {renderActionButton(action, 0)}
        </div>
      ))}
    </div>
    {submenuStates.map((submenuState, index) => (
      <div
        key={`${submenuState.action.id}-${index}`}
        ref={(element) => {
          submenuRefs.current[index] = element;
        }}
        className={cn(
          "fixed z-50 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg overflow-y-auto overscroll-contain",
          minWidthClassName
        )}
        style={{
          left: submenuLayout[index] ? `${submenuLayout[index]?.left}px` : -9999,
          top: submenuLayout[index] ? `${submenuLayout[index]?.top}px` : -9999,
          maxHeight: submenuLayout[index]?.maxHeight ? `${submenuLayout[index]?.maxHeight}px` : undefined,
        }}
        role="menu"
      >
        {submenuState.action.children?.map((child) => (
          <div key={child.id} onPointerEnter={(event) => openSubmenu(child, event.currentTarget.querySelector('button') ?? event.currentTarget, index + 1)}>
            {child.separatorBefore && <div className="my-1 h-px bg-border" />}
            {renderActionButton(child, index + 1)}
          </div>
        ))}
      </div>
    ))}
    </>
  );
}
