"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { Bot, CornerDownLeft, ListTodo, MessageSquare, Sparkles } from "lucide-react";
import type { SelectionContext, SelectionAiMode } from "@/lib/ai/selection-context";
import type { SelectionContextMenuState } from "@/hooks/use-selection-context-menu";
import { cn } from "@/lib/utils";
import { getSelectionModeMeta } from "@/lib/ai/selection-ui";
import { useSelectionAiStore } from "@/stores/selection-ai-store";

interface SelectionContextMenuAction {
  id: string;
  label: string;
  onSelect: () => void;
}

interface SelectionContextMenuProps {
  state: SelectionContextMenuState<SelectionContext> | null;
  onClose: (options?: { restoreFocus?: boolean }) => void;
  onOpenHub: (context: SelectionContext, mode: SelectionAiMode, returnFocusTo?: HTMLElement | null) => void;
  extraActions?: SelectionContextMenuAction[];
}

const MODE_ICONS: Record<SelectionAiMode, typeof Sparkles> = {
  chat: MessageSquare,
  agent: Bot,
  plan: ListTodo,
};

const MODE_ORDER: SelectionAiMode[] = ["chat", "agent", "plan"];

export function SelectionContextMenu({
  state,
  onClose,
  onOpenHub,
  extraActions = [],
}: SelectionContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const preferredMode = useSelectionAiStore((store) => store.preferredMode);

  const modeActions = useMemo(() => {
    const prioritized = [...MODE_ORDER].sort((left, right) => {
      if (left === preferredMode) return -1;
      if (right === preferredMode) return 1;
      return MODE_ORDER.indexOf(left) - MODE_ORDER.indexOf(right);
    });

    return prioritized.map((mode) => ({
      mode,
      meta: getSelectionModeMeta(mode),
      icon: MODE_ICONS[mode],
      preferred: mode === preferredMode,
    }));
  }, [preferredMode]);

  const totalActionCount = state?.context ? modeActions.length + extraActions.length : 0;

  useEffect(() => {
    if (!state) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [onClose, state]);

  useEffect(() => {
    if (!state) return;

    const nextIndex = state.context ? 0 : -1;
    startTransition(() => {
      setActiveIndex(nextIndex);
    });

    const rafId = window.requestAnimationFrame(() => {
      if (!state.context) {
        menuRef.current?.focus();
        return;
      }
      actionRefs.current[nextIndex]?.focus();
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [state]);

  if (!state) {
    return null;
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (!state.context || totalActionCount === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = (activeIndex + 1) % totalActionCount;
      setActiveIndex(nextIndex);
      actionRefs.current[nextIndex]?.focus();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex = (activeIndex - 1 + totalActionCount) % totalActionCount;
      setActiveIndex(nextIndex);
      actionRefs.current[nextIndex]?.focus();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      actionRefs.current[activeIndex]?.click();
    }
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[120] w-[23rem] rounded-2xl border border-border bg-popover/95 p-2 shadow-2xl backdrop-blur"
      style={{ left: state.position.x, top: state.position.y }}
      role="menu"
      tabIndex={-1}
      aria-label="Selection AI menu"
      onKeyDown={handleKeyDown}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (!nextTarget || !menuRef.current?.contains(nextTarget as Node)) {
          onClose();
        }
      }}
    >
      <div className="rounded-xl border border-border/60 bg-background/80 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Selection AI
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <CornerDownLeft className="h-3 w-3" />
            <span>Enter 打开</span>
          </div>
        </div>
        {state.context ? (
          <>
            <div className="mt-1 truncate text-xs font-medium text-foreground">
              {state.context.sourceLabel}
            </div>
            <div className="mt-1 line-clamp-3 text-xs text-muted-foreground">
              {state.context.selectedText}
            </div>
          </>
        ) : (
          <>
            <div className="mt-1 text-xs font-medium text-foreground">当前未启用 Selection AI</div>
            <div className="mt-1 line-clamp-3 text-xs text-muted-foreground">
              {state.selectedText || "尚未选中文本"}
            </div>
            <div className="mt-2 rounded-lg border border-dashed border-border/70 bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
              {state.disabledReason}
            </div>
          </>
        )}
      </div>

      {state.context && (
        <div className="mt-2 space-y-1">
          {modeActions.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.mode}
                ref={(node) => {
                  actionRefs.current[index] = node;
                }}
                type="button"
                onClick={() => {
                  onOpenHub(state.context!, item.mode, state.returnFocusTo);
                  onClose({ restoreFocus: false });
                }}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
                  item.preferred
                    ? "border-primary/40 bg-primary/5 hover:bg-primary/10"
                    : "border-border/60 bg-background/70 hover:bg-accent",
                )}
                role="menuitem"
              >
                <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{item.meta.label}</span>
                    {item.preferred && (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                        最近使用
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {item.meta.executionTarget}
                  </div>
                </div>
              </button>
            );
          })}

          {extraActions.length > 0 && (
            <>
              <div className="my-2 border-t border-border/60" />
              {extraActions.map((action, index) => {
                const absoluteIndex = modeActions.length + index;
                return (
                  <button
                    key={action.id}
                    ref={(node) => {
                      actionRefs.current[absoluteIndex] = node;
                    }}
                    type="button"
                    onClick={() => {
                      action.onSelect();
                      onClose({ restoreFocus: false });
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                  >
                    <span>{action.label}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default SelectionContextMenu;
