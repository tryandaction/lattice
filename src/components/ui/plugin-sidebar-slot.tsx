"use client";

import { useSyncExternalStore } from "react";
import { getSidebarItems, onSidebarChange } from "@/lib/plugins/runtime";
import type { PluginSidebarItem } from "@/lib/plugins/types";

function subscribe(cb: () => void) {
  return onSidebarChange(cb);
}

function getSnapshot(): PluginSidebarItem[] {
  return getSidebarItems();
}

export function PluginSidebarSlot() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (items.length === 0) return null;

  const topItems = items.filter((i) => i.position !== "bottom");
  const bottomItems = items.filter((i) => i.position === "bottom");

  return (
    <div className="border-t border-border">
      {topItems.map((item) => (
        <SidebarEntry key={item.id} item={item} />
      ))}
      {bottomItems.length > 0 && (
        <div className="mt-auto">
          {bottomItems.map((item) => (
            <SidebarEntry key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function SidebarEntry({ item }: { item: PluginSidebarItem }) {
  const rendered = item.render();
  return (
    <div className="px-3 py-2 text-sm text-muted-foreground" data-plugin-sidebar={item.id}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium uppercase tracking-wider">{item.title}</span>
      </div>
      <div data-type={rendered.type} />
    </div>
  );
}
