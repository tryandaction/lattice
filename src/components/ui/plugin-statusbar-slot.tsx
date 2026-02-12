"use client";

import { useSyncExternalStore } from "react";
import { getStatusBarItems, onStatusBarChange } from "@/lib/plugins/runtime";
import type { PluginStatusBarItem } from "@/lib/plugins/types";
import { cn } from "@/lib/utils";

function subscribe(cb: () => void) {
  return onStatusBarChange(cb);
}

function getSnapshot(): PluginStatusBarItem[] {
  return getStatusBarItems();
}

export function PluginStatusBarSlot() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (items.length === 0) return null;

  const leftItems = items.filter((i) => i.position !== "right");
  const rightItems = items.filter((i) => i.position === "right");

  return (
    <div
      className={cn(
        "flex items-center justify-between px-3 py-1",
        "border-t border-border bg-card text-xs text-muted-foreground",
        "shrink-0"
      )}
    >
      <div className="flex items-center gap-3">
        {leftItems.map((item) => (
          <StatusBarEntry key={item.id} item={item} />
        ))}
      </div>
      <div className="flex items-center gap-3">
        {rightItems.map((item) => (
          <StatusBarEntry key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function StatusBarEntry({ item }: { item: PluginStatusBarItem }) {
  const interactive = !!item.onClick;
  const Tag = interactive ? "button" : "span";
  return (
    <Tag
      onClick={item.onClick}
      className={cn(
        interactive && "hover:text-foreground transition-colors cursor-pointer"
      )}
      title={item.tooltip}
    >
      {item.text}
    </Tag>
  );
}
