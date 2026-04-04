"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, List, X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import type { ResolvedPdfOutlineItem } from "@/types/pdf-runtime";

interface DesktopPdfOutlinePanelProps {
  isOpen: boolean;
  isLoading: boolean;
  items: ResolvedPdfOutlineItem[];
  onNavigateToPage: (page: number) => void;
  onClose: () => void;
}

export function DesktopPdfOutlinePanel({
  isOpen,
  isLoading,
  items,
  onNavigateToPage,
  onClose,
}: DesktopPdfOutlinePanelProps) {
  const { t } = useI18n();

  if (!isOpen) {
    return null;
  }

  return (
    <div className="w-72 shrink-0 border-l border-border bg-background/95 p-3 backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <List className="h-4 w-4" />
          <span>{t("pdf.outline.title")}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-[70vh] overflow-y-auto rounded border border-border p-2">
        {isLoading ? (
          <div className="p-2 text-xs text-muted-foreground">{t("pdf.outline.loading")}</div>
        ) : items.length === 0 ? (
          <div className="p-2 text-xs text-muted-foreground">{t("pdf.outline.empty")}</div>
        ) : (
          items.map((item, index) => (
            <OutlineNode
              key={`${item.title}:${item.page}:${index}`}
              item={item}
              depth={0}
              onNavigateToPage={onNavigateToPage}
            />
          ))
        )}
      </div>
    </div>
  );
}

function OutlineNode({
  item,
  depth,
  onNavigateToPage,
}: {
  item: ResolvedPdfOutlineItem;
  depth: number;
  onNavigateToPage: (page: number) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = item.children.length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          onNavigateToPage(item.page);
          if (hasChildren) {
            setExpanded((previous) => !previous);
          }
        }}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        title={`Page ${item.page}`}
      >
        {hasChildren ? (
          expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="truncate">{item.title}</span>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{item.page}</span>
      </button>
      {hasChildren && expanded ? (
        item.children.map((child, index) => (
          <OutlineNode
            key={`${child.title}:${child.page}:${index}`}
            item={child}
            depth={depth + 1}
            onNavigateToPage={onNavigateToPage}
          />
        ))
      ) : null}
    </div>
  );
}
