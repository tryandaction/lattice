"use client";

import { startTransition, useState, useCallback, useRef, useEffect } from "react";
import { X, ChevronUp, ChevronDown } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useI18n } from "@/hooks/use-i18n";
import { getPreferredPdfPageSearchText } from "@/lib/pdf-page-text-engine";
import { searchPdfPageTextModel, type PdfSearchMatch } from "@/lib/pdf-search";
import { buildRenderedPdfPageTextModel } from "@/lib/pdf-page-text-cache";

interface PdfSearchOverlayProps {
  pdfDocument: PDFDocumentProxy | null;
  fileHandle?: FileSystemFileHandle | null;
  numPages: number;
  onNavigateToPage: (page: number, rects?: PdfSearchMatch["rects"]) => void;
  onActiveMatchChange?: (match: PdfSearchMatch | null) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function PdfSearchOverlay({
  pdfDocument,
  fileHandle,
  numPages,
  onNavigateToPage,
  onActiveMatchChange,
  isOpen,
  onClose,
}: PdfSearchOverlayProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<PdfSearchMatch[]>([]);
  const [currentMatch, setCurrentMatch] = useState(-1);
  const [pageTexts, setPageTexts] = useState<Map<number, string>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const documentTokenRef = useRef(0);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    documentTokenRef.current += 1;
    startTransition(() => {
      setPageTexts(new Map());
      setMatches([]);
      setCurrentMatch(-1);
    });
    onActiveMatchChange?.(null);
  }, [onActiveMatchChange, pdfDocument]);

  useEffect(() => {
    if (!isOpen || !pdfDocument || numPages === 0) {
      return;
    }
    const activeDocument = pdfDocument as PDFDocumentProxy;
    const activeToken = documentTokenRef.current;

    if (pageTexts.size === numPages) {
      return;
    }

    let cancelled = false;

    async function extractTexts() {
      const texts = new Map<number, string>();
      const batchSize = 3;

      for (let i = 1; i <= numPages; i += batchSize) {
        const pageNumbers = Array.from(
          { length: Math.min(batchSize, numPages - i + 1) },
          (_, index) => i + index,
        );

        for (const pageNumber of pageNumbers) {
          if (cancelled) {
            return;
          }

          try {
            const text = await getPreferredPdfPageSearchText({
              pdfDocument: activeDocument,
              fileHandle,
              pageNumber,
            });
            texts.set(pageNumber, text.toLowerCase());
          } catch {
            // Ignore page extraction failures so search can continue on the rest.
          }
        }

        if (i + batchSize <= numPages) {
          await new Promise<void>((resolve) => {
            window.requestAnimationFrame(() => resolve());
          });
        }
      }

      if (!cancelled && documentTokenRef.current === activeToken) {
        setPageTexts(texts);
      }
    }

    void extractTexts();

    return () => {
      cancelled = true;
    };
  }, [fileHandle, isOpen, numPages, pageTexts.size, pdfDocument]);

  const buildPreview = useCallback((text: string, start: number, queryText: string) => {
    const windowSize = 36;
    const previewStart = Math.max(0, start - windowSize);
    const previewEnd = Math.min(text.length, start + queryText.length + windowSize);
    const prefix = previewStart > 0 ? "…" : "";
    const suffix = previewEnd < text.length ? "…" : "";
    return `${prefix}${text.slice(previewStart, previewEnd)}${suffix}`;
  }, []);

  const doSearch = useCallback((q: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!q.trim()) {
        setMatches([]);
        setCurrentMatch(-1);
        onActiveMatchChange?.(null);
        return;
      }
      searchTimer.current = setTimeout(() => {
        const needle = q.toLowerCase();
      const found: PdfSearchMatch[] = [];
      for (let page = 1; page <= numPages; page++) {
        const pageElement = document.querySelector<HTMLElement>(`[data-page-number="${page}"]`);
        const renderedModel = pageElement ? buildRenderedPdfPageTextModel(pageElement) : null;
        if (renderedModel) {
          found.push(...searchPdfPageTextModel(renderedModel, needle));
          continue;
        }

        const text = pageTexts.get(page);
        if (!text) continue;
        let idx = 0;
        while ((idx = text.indexOf(needle, idx)) !== -1) {
          found.push({
            page,
            index: idx,
            preview: buildPreview(text, idx, needle),
            rects: [],
          });
          idx += needle.length;
        }
      }
      setMatches(found);
      setCurrentMatch(found.length > 0 ? 0 : -1);
      if (found.length > 0) {
        onNavigateToPage(found[0].page, found[0].rects);
        onActiveMatchChange?.(found[0]);
      } else {
        onActiveMatchChange?.(null);
      }
    }, 300);
  }, [buildPreview, numPages, onActiveMatchChange, onNavigateToPage, pageTexts]);

  const handleQueryChange = useCallback((val: string) => {
    setQuery(val);
    doSearch(val);
  }, [doSearch]);

  const goToMatch = useCallback((direction: 1 | -1) => {
    if (matches.length === 0) return;
    const next = (currentMatch + direction + matches.length) % matches.length;
    setCurrentMatch(next);
    onNavigateToPage(matches[next].page, matches[next].rects);
    onActiveMatchChange?.(matches[next]);
  }, [matches, currentMatch, onActiveMatchChange, onNavigateToPage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      goToMatch(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }, [goToMatch, onClose]);

  if (!isOpen) return null;

  return (
    <div className="absolute top-2 right-2 z-50 w-80 rounded-lg border border-border bg-background/95 px-2 py-2 shadow-lg backdrop-blur-sm">
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("pdf.search.placeholder")}
          className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {matches.length > 0 ? `${currentMatch + 1}/${matches.length}` : t("pdf.search.noMatch")}
          </span>
        )}
        <button
          onClick={() => goToMatch(-1)}
          disabled={matches.length === 0}
          className="p-0.5 rounded hover:bg-accent disabled:opacity-30 transition-colors"
          title={t("pdf.search.prevMatch")}
        >
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button
          onClick={() => goToMatch(1)}
          disabled={matches.length === 0}
          className="p-0.5 rounded hover:bg-accent disabled:opacity-30 transition-colors"
          title={t("pdf.search.nextMatch")}
        >
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-accent transition-colors"
          title={t("pdf.search.close")}
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      {query ? (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-border/60 bg-background/70">
          {matches.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">{t("pdf.search.noMatch")}</div>
          ) : (
            matches.slice(0, 80).map((match, index) => (
              <button
                key={`${match.page}-${match.index}-${index}`}
                type="button"
                onClick={() => {
                  setCurrentMatch(index);
                  onNavigateToPage(match.page, match.rects);
                  onActiveMatchChange?.(match);
                }}
                className={`w-full border-b border-border/50 px-3 py-2 text-left text-[11px] transition-colors last:border-b-0 hover:bg-accent/50 ${
                  index === currentMatch ? "bg-accent/60" : ""
                }`}
              >
                <div className="font-medium text-foreground">Page {match.page}</div>
                <div className="mt-0.5 line-clamp-2 text-muted-foreground">{match.preview}</div>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
