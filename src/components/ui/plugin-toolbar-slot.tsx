"use client";

import { useSyncExternalStore } from "react";
import { getToolbarItems, onToolbarChange } from "@/lib/plugins/runtime";
import type { PluginToolbarItem } from "@/lib/plugins/types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/use-i18n";
import { localizeQuantumKeyboardCommand } from "@/plugins/quantum-keyboard/localization";

function subscribe(cb: () => void) {
  return onToolbarChange(cb);
}

function getSnapshot(): PluginToolbarItem[] {
  return getToolbarItems();
}

export function PluginToolbarSlot() {
  const { locale } = useI18n();
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (items.length === 0) return null;

  const groups = new Map<string, PluginToolbarItem[]>();
  for (const item of items) {
    const group = item.group ?? "__default";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(item);
  }

  return (
    <div className="flex items-center gap-1 border-l border-border pl-2 ml-2">
      {Array.from(groups.entries()).map(([group, groupItems]) => (
        <div key={group} className="flex items-center gap-0.5">
          {groupItems.map((item) => {
            const title = localizeQuantumKeyboardCommand(item.id, locale, item.title);
            return (
            <button
              key={item.id}
              onClick={() => item.run()}
              aria-label={title}
              className={cn(
                "p-1.5 rounded-md text-muted-foreground",
                "hover:bg-muted hover:text-foreground transition-colors"
              )}
              title={title}
            >
              <span className="text-xs">{title}</span>
            </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
