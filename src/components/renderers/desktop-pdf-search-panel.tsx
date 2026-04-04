"use client";

import { useMemo } from "react";
import { ChevronDown, ChevronUp, Loader2, Search, X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import type { PdfSearchTaskState } from "@/types/pdf-runtime";

export interface DesktopPdfSearchMatch {
  page: number;
  index: number;
}

interface DesktopPdfSearchPanelProps {
  isOpen: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  taskState: PdfSearchTaskState;
  matches: DesktopPdfSearchMatch[];
  currentMatchIndex: number;
  onSelectMatch: (index: number) => void;
  onPreviousMatch: () => void;
  onNextMatch: () => void;
  onClose: () => void;
}

export function DesktopPdfSearchPanel({
  isOpen,
  query,
  onQueryChange,
  taskState,
  matches,
  currentMatchIndex,
  onSelectMatch,
  onPreviousMatch,
  onNextMatch,
  onClose,
}: DesktopPdfSearchPanelProps) {
  const { t } = useI18n();

  const statusLabel = useMemo(() => {
    if (!query.trim()) {
      return t("pdf.search.placeholder");
    }
    if (taskState.status === "extracting") {
      return `${taskState.extractedPages}/${taskState.totalPages}`;
    }
    if (matches.length === 0) {
      return t("pdf.search.noMatch");
    }
    return `${Math.max(0, currentMatchIndex) + 1}/${matches.length}`;
  }, [currentMatchIndex, matches.length, query, t, taskState.extractedPages, taskState.status, taskState.totalPages]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="w-72 shrink-0 border-l border-border bg-background/95 p-3 backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Search className="h-4 w-4" />
          <span>{t("pdf.search.open")}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("pdf.search.placeholder")}
          className="flex-1 rounded border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="button"
          onClick={onPreviousMatch}
          disabled={matches.length === 0}
          className="rounded border border-border p-2 text-muted-foreground hover:bg-accent disabled:opacity-40"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onNextMatch}
          disabled={matches.length === 0}
          className="rounded border border-border p-2 text-muted-foreground hover:bg-accent disabled:opacity-40"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>{statusLabel}</span>
        {taskState.status === "extracting" ? (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>{taskState.extractedPages}/{taskState.totalPages}</span>
          </span>
        ) : null}
      </div>

      <div className="mt-4 max-h-[40vh] overflow-y-auto rounded border border-border">
        {matches.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground">
            {query.trim() ? t("pdf.search.noMatch") : t("pdf.search.placeholder")}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {matches.slice(0, 100).map((match, index) => (
              <button
                key={`${match.page}:${match.index}:${index}`}
                type="button"
                onClick={() => onSelectMatch(index)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors ${
                  index === currentMatchIndex ? "bg-primary/10 text-primary" : "hover:bg-accent"
                }`}
              >
                <span>Page {match.page}</span>
                <span className="text-muted-foreground">#{index + 1}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
