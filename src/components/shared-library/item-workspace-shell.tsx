"use client";

import { useI18n } from "@/hooks/use-i18n";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ItemWorkspaceRegistry,
  type ItemWorkspaceItem,
} from "@/lib/shared-library/item-workspace";
import { FileQuestion } from "lucide-react";
import {
  getSharedLibraryItemContent,
  type SharedLibraryItemContent,
} from "@/lib/shared-library/content-store";

export interface ItemWorkspaceShellProps {
  item: ItemWorkspaceItem;
  registry: ItemWorkspaceRegistry;
  fallbackViewer?: (item: ItemWorkspaceItem) => ReactNode;
}

type SharedLibraryContentLoader = (itemId: string) => Promise<SharedLibraryItemContent | null>;

function DefaultUnsupportedViewer({ item }: { item: ItemWorkspaceItem }) {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
      <FileQuestion className="h-10 w-10" />
      <div className="text-sm font-medium text-foreground">{item.title}</div>
      <div className="text-xs">
        {t("cloud.content.unsupported")}{" "}
        <code className="rounded bg-muted px-1 py-0.5">{item.kind}</code>.
      </div>
    </div>
  );
}

/**
 * Generic item workspace shell.
 *
 * Composes the kind-specific regions contributed by an
 * `ItemWorkspaceAdapter`: header strip, content viewer and tool panel. The
 * viewer slot is keyed by `kind:id` so switching an item's kind remounts the
 * correct viewer instead of reusing a stale one. Items whose kind has no
 * adapter fall back to a generic placeholder (or the supplied fallback).
 */
export function ItemWorkspaceShell({
  item,
  registry,
  fallbackViewer,
}: ItemWorkspaceShellProps) {
  const adapter = registry.get(item.kind);
  const [content, setContent] = useState<SharedLibraryItemContent | null>(null);
  const [contentState, setContentState] = useState<"idle" | "loading" | "ready" | "missing" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    setContentState("loading");
    const customLoader = item.extras?.contentLoader;
    const load = typeof customLoader === "function"
      ? customLoader as SharedLibraryContentLoader
      : getSharedLibraryItemContent;
    void load(item.id).then((next) => {
      if (cancelled) return;
      setContent(next);
      setContentState(next ? "ready" : "missing");
    }).catch(() => {
      if (!cancelled) setContentState("error");
    });
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  const resolvedItem = useMemo<ItemWorkspaceItem>(() => ({
    ...item,
    extras: {
      ...item.extras,
      content,
      contentState,
    },
  }), [content, contentState, item]);

  if (!adapter) {
    return (
      <div data-testid="item-workspace-fallback" className="h-full">
        {fallbackViewer ? fallbackViewer(resolvedItem) : <DefaultUnsupportedViewer item={resolvedItem} />}
      </div>
    );
  }

  return (
    <div data-testid="item-workspace" className="flex h-full flex-col">
      {adapter.renderHeader ? (
        <div data-testid="item-workspace-header">{adapter.renderHeader(resolvedItem)}</div>
      ) : null}

      <div data-testid="item-workspace-body" className="relative flex min-h-0 flex-1">
        <div
          key={`viewer:${item.kind}:${item.id}`}
          data-testid="item-workspace-viewer"
          className="min-w-0 flex-1"
        >
          {adapter.renderViewer(resolvedItem)}
        </div>

        {adapter.renderTools ? (
          <aside
            data-testid="item-workspace-tools"
            className="w-72 shrink-0 overflow-y-auto border-l border-border"
          >
            {adapter.renderTools(resolvedItem)}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

export default ItemWorkspaceShell;
