"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface WorkbenchMenuAction {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  tone?: "default" | "destructive";
  separatorBefore?: boolean;
  onSelect: () => void;
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

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const adjustedX = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const adjustedY = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    menu.style.left = `${adjustedX}px`;
    menu.style.top = `${adjustedY}px`;
  }, [x, y]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
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

  return (
    <div
      ref={menuRef}
      className={cn(
        "fixed z-50 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg",
        minWidthClassName
      )}
      style={{ left: x, top: y }}
      role="menu"
    >
      {actions.map((action) => (
        <div key={action.id}>
          {action.separatorBefore && <div className="my-1 h-px bg-border" />}
          <button
            type="button"
            disabled={action.disabled}
            onClick={() => {
              if (action.disabled) return;
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
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
              {action.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{action.label}</span>
            {action.shortcut && (
              <span className="ml-4 shrink-0 text-[11px] text-muted-foreground">{action.shortcut}</span>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
