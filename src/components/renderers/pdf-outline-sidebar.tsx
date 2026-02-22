"use client";

import { useState, useEffect } from "react";
import { ChevronRight, ChevronDown, List } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useI18n } from "@/hooks/use-i18n";

interface OutlineItem {
  title: string;
  page: number;
  children: OutlineItem[];
}

interface PdfOutlineSidebarProps {
  pdfDocument: PDFDocumentProxy | null;
  onNavigateToPage: (page: number) => void;
  isOpen: boolean;
  onClose: () => void;
}

async function resolveOutline(
  pdfDocument: PDFDocumentProxy,
  items: Array<{ title: string; dest: unknown; items?: unknown[] }>
): Promise<OutlineItem[]> {
  const result: OutlineItem[] = [];
  for (const item of items) {
    let page = 1;
    try {
      let dest = item.dest;
      if (typeof dest === "string") {
        dest = await pdfDocument.getDestination(dest);
      }
      if (Array.isArray(dest) && dest[0]) {
        const pageIndex = await pdfDocument.getPageIndex(dest[0]);
        page = pageIndex + 1;
      }
    } catch { /* fallback to page 1 */ }
    const children = item.items?.length
      ? await resolveOutline(pdfDocument, item.items as typeof items)
      : [];
    result.push({ title: item.title, page, children });
  }
  return result;
}

export function PdfOutlineSidebar({
  pdfDocument,
  onNavigateToPage,
  isOpen,
  onClose,
}: PdfOutlineSidebarProps) {
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [noOutline, setNoOutline] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!pdfDocument || !isOpen) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const raw = await pdfDocument.getOutline();
        if (cancelled) return;
        if (!raw || raw.length === 0) {
          setNoOutline(true);
          setOutline([]);
        } else {
          const resolved = await resolveOutline(pdfDocument, raw as Array<{ title: string; dest: unknown; items?: unknown[] }>);
          if (!cancelled) {
            setOutline(resolved);
            setNoOutline(false);
          }
        }
      } catch {
        if (!cancelled) setNoOutline(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pdfDocument, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="w-56 border-r border-border bg-background flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <List className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">{t('pdf.outline.title')}</span>
        </div>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {loading && <p className="text-xs text-muted-foreground p-2">{t('pdf.outline.loading')}</p>}
        {noOutline && !loading && (
          <p className="text-xs text-muted-foreground p-2">{t('pdf.outline.empty')}</p>
        )}
        {!loading && outline.map((item, i) => (
          <OutlineNode key={i} item={item} onNavigateToPage={onNavigateToPage} depth={0} />
        ))}
      </div>
    </div>
  );
}

function OutlineNode({
  item,
  onNavigateToPage,
  depth,
}: {
  item: OutlineItem;
  onNavigateToPage: (page: number) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = item.children.length > 0;

  return (
    <div>
      <button
        onClick={() => {
          onNavigateToPage(item.page);
          if (hasChildren) setExpanded((p) => !p);
        }}
        className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-xs hover:bg-accent transition-colors"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        title={`Page ${item.page}`}
      >
        {hasChildren ? (
          expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="truncate">{item.title}</span>
        <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{item.page}</span>
      </button>
      {hasChildren && expanded && item.children.map((child, i) => (
        <OutlineNode key={i} item={child} onNavigateToPage={onNavigateToPage} depth={depth + 1} />
      ))}
    </div>
  );
}
