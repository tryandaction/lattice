"use client";

import { startTransition, useState, useCallback, useRef, useEffect, useMemo } from "react";
import { X, ChevronUp, ChevronDown, Search } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useI18n } from "@/hooks/use-i18n";
import { getPreferredPdfPageSearchText } from "@/lib/pdf-page-text-engine";
import { searchPdfPageTextModel, type PdfSearchMatch, type PdfSearchOptions } from "@/lib/pdf-search";
import { buildRenderedPdfPageTextModel, type PdfPageTextModel } from "@/lib/pdf-page-text-cache";

interface PdfSearchOverlayProps {
  pdfDocument: PDFDocumentProxy | null;
  fileHandle?: FileSystemFileHandle | null;
  numPages: number;
  currentPage?: number | null;
  onNavigateToMatch?: (match: PdfSearchMatch) => void;
  onNavigateToPage?: (page: number, rects?: PdfSearchMatch["rects"]) => void;
  onActiveMatchChange?: (match: PdfSearchMatch | null) => void;
  onMatchesChange?: (matches: PdfSearchMatch[]) => void;
  getTextModelForPage?: (page: number) => PdfPageTextModel | null;
  isOpen: boolean;
  onClose: () => void;
  initialQuery?: string;
}

function createFallbackSearchModel(pageNumber: number, text: string): PdfPageTextModel {
  return {
    pageNumber,
    viewportWidth: 1,
    viewportHeight: 1,
    textContent: { items: [], styles: {}, lang: null },
    items: [],
    normalizedText: text,
    itemRects: [],
    segments: [
      {
        itemIndex: 0,
        text,
        normalizedText: text,
        hasEOL: false,
        pageTextStart: 0,
        pageTextEnd: text.length,
      },
    ],
  };
}

function buildSearchPageOrder(numPages: number, currentPage?: number | null): number[] {
  const anchorPage = Number.isInteger(currentPage ?? NaN) && (currentPage ?? 0) > 0
    ? Math.min(numPages, Math.max(1, currentPage ?? 1))
    : 1;

  return Array.from({ length: numPages }, (_, index) => index + 1)
    .sort((left, right) => {
      const distance = Math.abs(left - anchorPage) - Math.abs(right - anchorPage);
      return distance || left - right;
    });
}

function waitForSearchIndexingSlice(): Promise<void> {
  return new Promise((resolve) => {
    const win = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    if (typeof win.requestIdleCallback === "function") {
      win.requestIdleCallback(() => resolve(), { timeout: 80 });
      return;
    }
    window.requestAnimationFrame(() => resolve());
  });
}

function isSameSearchResult(
  left: PdfSearchMatch | null | undefined,
  right: PdfSearchMatch | null | undefined,
): boolean {
  return Boolean(
    left &&
      right &&
      left.page === right.page &&
      left.normalizedIndex === right.normalizedIndex &&
      left.normalizedQuery === right.normalizedQuery &&
      left.caseSensitive === right.caseSensitive &&
      left.entireWord === right.entireWord
  );
}

export function PdfSearchOverlay({
  pdfDocument,
  fileHandle,
  numPages,
  currentPage,
  onNavigateToMatch,
  onNavigateToPage,
  onActiveMatchChange,
  onMatchesChange,
  getTextModelForPage,
  isOpen,
  onClose,
  initialQuery,
}: PdfSearchOverlayProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<PdfSearchMatch[]>([]);
  const [currentMatch, setCurrentMatch] = useState(-1);
  const [pageTexts, setPageTexts] = useState<Map<number, string>>(new Map());
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [entireWord, setEntireWord] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const documentTokenRef = useRef(0);
  const pageTextsRef = useRef<Map<number, string>>(new Map());
  const activeMatchRef = useRef<PdfSearchMatch | null>(null);
  const onActiveMatchChangeRef = useRef(onActiveMatchChange);
  const onMatchesChangeRef = useRef(onMatchesChange);
  const searchOptions = useMemo<PdfSearchOptions>(() => ({
    caseSensitive,
    entireWord,
  }), [caseSensitive, entireWord]);
  useEffect(() => {
    onActiveMatchChangeRef.current = onActiveMatchChange;
    onMatchesChangeRef.current = onMatchesChange;
  }, [onActiveMatchChange, onMatchesChange]);
  const stopOverlayEvent = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
  }, []);
  const updateActiveMatch = useCallback((match: PdfSearchMatch | null) => {
    activeMatchRef.current = match;
    onActiveMatchChangeRef.current?.(match);
  }, []);
  const closeSearch = useCallback(() => {
    onMatchesChangeRef.current?.([]);
    updateActiveMatch(null);
    onClose();
  }, [onClose, updateActiveMatch]);
  const navigateToMatch = useCallback((match: PdfSearchMatch) => {
    if (onNavigateToMatch) {
      onNavigateToMatch(match);
      return;
    }
    onNavigateToPage?.(match.page, match.rects);
  }, [onNavigateToMatch, onNavigateToPage]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      onMatchesChangeRef.current?.([]);
      updateActiveMatch(null);
    }
  }, [isOpen, updateActiveMatch]);

  useEffect(() => {
    documentTokenRef.current += 1;
    pageTextsRef.current = new Map();
    startTransition(() => {
      setPageTexts(new Map());
      setMatches([]);
      setCurrentMatch(-1);
    });
    onMatchesChangeRef.current?.([]);
    updateActiveMatch(null);
  }, [pdfDocument, updateActiveMatch]);

  useEffect(() => {
    if (!isOpen || !pdfDocument || numPages === 0 || !query.trim()) {
      return;
    }
    const activeDocument = pdfDocument as PDFDocumentProxy;
    const activeToken = documentTokenRef.current;
    const pageOrder = buildSearchPageOrder(numPages, currentPage);

    if (pageTextsRef.current.size === numPages) {
      return;
    }

    let cancelled = false;

    async function extractTexts() {
      const batchSize = 3;

      for (let i = 0; i < pageOrder.length; i += batchSize) {
        const pageNumbers = pageOrder.slice(i, i + batchSize);
        let changed = false;

        for (const pageNumber of pageNumbers) {
          if (cancelled) {
            return;
          }
          if (pageTextsRef.current.has(pageNumber)) {
            continue;
          }

          try {
            const text = await getPreferredPdfPageSearchText({
              pdfDocument: activeDocument,
              fileHandle,
              pageNumber,
            });
            pageTextsRef.current.set(pageNumber, text);
            changed = true;
          } catch {
            // Ignore page extraction failures so search can continue on the rest.
          }
        }

        if (!cancelled && changed && documentTokenRef.current === activeToken) {
          const nextTexts = new Map(pageTextsRef.current);
          startTransition(() => {
            setPageTexts(nextTexts);
          });
        }

        if (i + batchSize < pageOrder.length) {
          await waitForSearchIndexingSlice();
        }
      }
    }

    void extractTexts();

    return () => {
      cancelled = true;
    };
  }, [currentPage, fileHandle, isOpen, numPages, pdfDocument, query]);

  const doSearch = useCallback((q: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!q.trim()) {
      setMatches([]);
      setCurrentMatch(-1);
      onMatchesChangeRef.current?.([]);
      updateActiveMatch(null);
      return;
    }
    searchTimer.current = setTimeout(() => {
      const found: PdfSearchMatch[] = [];
      for (let page = 1; page <= numPages; page++) {
        const providedModel = getTextModelForPage?.(page) ?? null;
        const pageElement = providedModel
          ? null
          : document.querySelector<HTMLElement>(`[data-page-number="${page}"]`);
        const renderedModel = providedModel ?? (pageElement ? buildRenderedPdfPageTextModel(pageElement) : null);
        if (renderedModel) {
          found.push(...searchPdfPageTextModel(renderedModel, q, searchOptions));
          continue;
        }

        const text = pageTexts.get(page);
        if (!text) continue;
        found.push(...searchPdfPageTextModel(createFallbackSearchModel(page, text), q, searchOptions));
      }
      setMatches(found);
      onMatchesChangeRef.current?.(found);
      const previousActiveMatch = activeMatchRef.current;
      const nextActiveIndex = previousActiveMatch
        ? found.findIndex((match) => isSameSearchResult(match, previousActiveMatch))
        : -1;
      const nextActiveMatch = nextActiveIndex >= 0 ? found[nextActiveIndex] : null;
      setCurrentMatch(nextActiveIndex);
      updateActiveMatch(nextActiveMatch);
    }, 300);
  }, [getTextModelForPage, numPages, pageTexts, searchOptions, updateActiveMatch]);

  const handleQueryChange = useCallback((val: string) => {
    setQuery(val);
  }, []);

  useEffect(() => {
    if (!isOpen || typeof initialQuery !== "string") {
      return;
    }
    const nextQuery = initialQuery.trim();
    if (!nextQuery || nextQuery === query) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setQuery(nextQuery);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [initialQuery, isOpen, query]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const timeout = window.setTimeout(() => {
      doSearch(query);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [doSearch, isOpen, query]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) {
        clearTimeout(searchTimer.current);
      }
    };
  }, []);

  const nearestMatchIndex = useMemo(() => {
    if (matches.length === 0) return -1;
    const page = Number.isInteger(currentPage ?? NaN) && (currentPage ?? 0) > 0
      ? currentPage ?? 1
      : 1;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    matches.forEach((match, index) => {
      const distance = Math.abs(match.page - page);
      if (
        distance < bestDistance ||
        (distance === bestDistance && match.page >= page && matches[bestIndex]?.page < page)
      ) {
        bestIndex = index;
        bestDistance = distance;
      }
    });
    return bestIndex;
  }, [currentPage, matches]);

  const goToMatch = useCallback((direction: 1 | -1) => {
    if (matches.length === 0) return;
    const nearestBase = nearestMatchIndex >= 0 ? nearestMatchIndex : direction > 0 ? -1 : 0;
    const baseIndex = currentMatch >= 0 ? currentMatch : direction > 0 ? nearestBase - 1 : nearestBase + 1;
    const next = (baseIndex + direction + matches.length) % matches.length;
    setCurrentMatch(next);
    navigateToMatch(matches[next]);
    updateActiveMatch(matches[next]);
  }, [matches, currentMatch, nearestMatchIndex, navigateToMatch, updateActiveMatch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      goToMatch(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
    }
  }, [closeSearch, goToMatch]);

  useEffect(() => {
    if (!isOpen || nearestMatchIndex < 0) return;
    const container = resultsRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-pdf-search-result-index="${nearestMatchIndex}"]`);
    if (typeof target?.scrollIntoView === "function") {
      target.scrollIntoView({ block: "nearest" });
    }
  }, [isOpen, nearestMatchIndex, matches]);

  if (!isOpen) return null;

  const resultLabel = query.trim()
    ? matches.length > 0
      ? t("pdf.search.resultsCount").replace("{count}", String(matches.length))
      : t("pdf.search.noResults")
    : t("pdf.search.ready");
  const activeMatchLabel = matches.length > 0 && currentMatch >= 0
    ? `${currentMatch + 1}/${matches.length}`
    : t("pdf.search.noMatch");

  return (
    <div
      className="fixed right-5 top-20 z-[1000] w-[min(340px,calc(100vw-2rem))] rounded-lg border border-border/80 bg-background/95 shadow-2xl shadow-black/10 backdrop-blur-md"
      data-pdf-search-overlay="true"
      data-testid="pdf-search-overlay"
      onPointerDown={stopOverlayEvent}
      onPointerUp={stopOverlayEvent}
      onMouseDown={stopOverlayEvent}
      onMouseUp={stopOverlayEvent}
      onClick={stopOverlayEvent}
      onDoubleClick={stopOverlayEvent}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("pdf.search.placeholder")}
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
        <span className="min-w-12 whitespace-nowrap text-right text-[11px] font-medium tabular-nums text-muted-foreground">
          {query ? activeMatchLabel : ""}
        </span>
        <button
          type="button"
          onPointerDown={stopOverlayEvent}
          onClick={(event) => {
            event.stopPropagation();
            goToMatch(-1);
          }}
          disabled={matches.length === 0}
          className="rounded p-1 transition-colors hover:bg-accent disabled:opacity-30"
          title={t("pdf.search.prevMatch")}
        >
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button
          type="button"
          onPointerDown={stopOverlayEvent}
          onClick={(event) => {
            event.stopPropagation();
            goToMatch(1);
          }}
          disabled={matches.length === 0}
          className="rounded p-1 transition-colors hover:bg-accent disabled:opacity-30"
          title={t("pdf.search.nextMatch")}
        >
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button
          type="button"
          onPointerDown={stopOverlayEvent}
          onClick={(event) => {
            event.stopPropagation();
            closeSearch();
          }}
          className="rounded p-1 transition-colors hover:bg-accent"
          title={t("pdf.search.close")}
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0 text-[11px] text-muted-foreground">
          {resultLabel}
        </div>
        <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-pressed={caseSensitive}
          onPointerDown={stopOverlayEvent}
          onClick={(event) => {
            event.stopPropagation();
            setCaseSensitive((current) => !current);
          }}
          className={`h-6 min-w-7 rounded border px-1.5 text-[10px] font-medium transition-colors ${
            caseSensitive
              ? "border-primary/60 bg-primary/10 text-primary"
              : "border-border/70 text-muted-foreground hover:bg-accent"
          }`}
          title={t("pdf.search.matchCase")}
        >
          Aa
        </button>
        <button
          type="button"
          aria-pressed={entireWord}
          onPointerDown={stopOverlayEvent}
          onClick={(event) => {
            event.stopPropagation();
            setEntireWord((current) => !current);
          }}
          className={`h-6 min-w-7 rounded border px-1.5 text-[10px] font-medium transition-colors ${
            entireWord
              ? "border-primary/60 bg-primary/10 text-primary"
              : "border-border/70 text-muted-foreground hover:bg-accent"
          }`}
          title={t("pdf.search.wholeWord")}
        >
          W
        </button>
        </div>
      </div>

      {query ? (
        <div
          ref={resultsRef}
          className="max-h-[9.75rem] overflow-y-auto border-t border-border/60 bg-background/80"
          data-testid="pdf-search-results-list"
        >
          {matches.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-muted-foreground">{t("pdf.search.noResults")}</div>
          ) : (
            matches.map((match, index) => (
              <button
                key={`${match.page}-${match.index}-${index}`}
                type="button"
                data-pdf-search-result-index={index}
                onPointerDown={stopOverlayEvent}
                onClick={(event) => {
                  event.stopPropagation();
                  setCurrentMatch(index);
                  navigateToMatch(match);
                  updateActiveMatch(match);
                }}
                className={`w-full border-b border-border/45 px-3 py-2.5 text-left text-[11px] transition-colors last:border-b-0 hover:bg-accent/45 ${
                  index === currentMatch ? "bg-primary/10" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-foreground">
                    {t("pdf.search.pageLabel").replace("{page}", String(match.page))}
                  </div>
                  <div className="text-[10px] tabular-nums text-muted-foreground">
                    {index + 1}/{matches.length}
                  </div>
                </div>
                <div className="mt-1 line-clamp-2 leading-relaxed text-muted-foreground">{match.preview}</div>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
