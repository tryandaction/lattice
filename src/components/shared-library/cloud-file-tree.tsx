"use client";

import { ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/use-i18n";
import type { Item } from "@/lib/shared-library/domain";

export interface CloudFileTreeProps {
  items: readonly Item[];
  currentFolderId?: string;
  activeItemId?: string;
  query?: string;
  onOpenFile: (item: Item) => void;
  onSelectFolder: (itemId: string) => void;
  renderActions?: (item: Item) => ReactNode;
}

export function CloudFileTree({ items, currentFolderId, activeItemId, query = "", onOpenFile, onSelectFolder, renderActions }: CloudFileTreeProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const collapsedSelection = useRef<string | null>(null);
  const { byId, children } = useMemo(() => {
    const byId = new Map(items.map(item => [item.id, item]));
    const children = new Map<string | undefined, Item[]>();
    for (const item of items) {
      const parent = typeof item.metadata.parentItemId === "string" && byId.has(item.metadata.parentItemId) ? item.metadata.parentItemId : undefined;
      const siblings = children.get(parent) ?? [];
      siblings.push(item); children.set(parent, siblings);
    }
    for (const siblings of children.values()) siblings.sort((a, b) => Number(b.kind === "folder") - Number(a.kind === "folder") || a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }));
    return { byId, children };
  }, [items]);
  const revealPath: string[] = [];
  let revealId = currentFolderId;
  while (revealId && !revealPath.includes(revealId)) {
    revealPath.push(revealId); const parent: unknown = byId.get(revealId)?.metadata.parentItemId;
    revealId = typeof parent === "string" ? parent : undefined;
  }
  const revealKey = JSON.stringify(revealPath);
  useEffect(() => {
    if (collapsedSelection.current === currentFolderId) { collapsedSelection.current = null; return; }
    setExpanded(previous => {
      const next = new Set(previous);
      for (const id of JSON.parse(revealKey) as string[]) next.add(id);
      return [...next].some(id => !previous.has(id)) ? next : previous;
    });
  }, [revealKey, currentFolderId]);
  const search = query.trim().toLocaleLowerCase();
  const matching = new Set<string>();
  if (search) for (const item of items) {
    if (!item.title.toLocaleLowerCase().includes(search)) continue;
    let ancestor: string | undefined = item.id;
    while (ancestor && !matching.has(ancestor)) {
      matching.add(ancestor); const parent: unknown = byId.get(ancestor)?.metadata.parentItemId;
      ancestor = typeof parent === "string" ? parent : undefined;
    }
  }
  function toggle(id: string) { setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function nodes(parentId?: string, depth = 1, ancestors = new Set<string>()): ReactNode {
    const siblings = (children.get(parentId) ?? []).filter(item => !ancestors.has(item.id) && (!search || matching.has(item.id)));
    return siblings.map((item, index) => {
      const branch = item.kind === "folder" || children.has(item.id);
      const open = branch && (Boolean(search) || expanded.has(item.id));
      const selected = item.kind === "folder" ? currentFolderId === item.id : activeItemId === item.id;
      return <div key={item.id}>
        <div className={`group flex min-w-0 items-center rounded ${selected ? "bg-accent" : "hover:bg-accent/40"}`}>
          {branch && item.kind !== "folder" ? <button type="button" aria-label={t(open ? "cloud.files.collapseChildren" : "cloud.files.expandChildren", { name: item.title })} className="shrink-0 p-1" onClick={() => toggle(item.id)}><ChevronRight className={`size-3 transition-transform ${open ? "rotate-90" : ""}`} /></button> : null}
          <button type="button" role="treeitem" aria-label={item.title} aria-selected={selected} aria-expanded={branch ? open : undefined} aria-level={depth} aria-posinset={index + 1} aria-setsize={siblings.length} data-testid="cloud-item-row" data-item-id={item.id}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-2 text-left text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring" style={{ paddingLeft: (depth - 1) * 14 + 6 }}
            onClick={() => { if (item.kind === "folder") { if (open) collapsedSelection.current = item.id; toggle(item.id); onSelectFolder(item.id); } else onOpenFile(item); }}
            onKeyDown={event => {
              if (event.key === "ArrowRight" && branch && !open) { event.preventDefault(); toggle(item.id); }
              else if (event.key === "ArrowLeft" && branch && open) { event.preventDefault(); toggle(item.id); }
              else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                const rows = Array.from(event.currentTarget.closest('[role="tree"]')?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') ?? []);
                const position = rows.indexOf(event.currentTarget); const target = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : position + (event.key === "ArrowDown" ? 1 : -1);
                event.preventDefault(); rows[target]?.focus();
              }
            }}>
            {item.kind === "folder" ? <><ChevronRight className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />{open ? <FolderOpen className="size-4 shrink-0 text-muted-foreground" /> : <Folder className="size-4 shrink-0 text-muted-foreground" />}</> : <><span className="w-3 shrink-0" /><File className="size-4 shrink-0 text-muted-foreground" /></>}
            <span className="truncate">{item.title}</span>
          </button>
          {renderActions?.(item)}
        </div>
        {open ? <div role="group">{nodes(item.id, depth + 1, new Set([...ancestors, item.id]))}</div> : null}
      </div>;
    });
  }
  return <div role="tree" aria-label={t("cloud.files.tree")} className="min-w-0">{nodes()}{!items.length ? <p className="px-3 py-6 text-xs text-muted-foreground">{t("cloud.files.empty")}</p> : search && !matching.size ? <p className="px-3 py-4 text-xs text-muted-foreground">{t("cloud.files.noMatch")}</p> : null}</div>;
}
