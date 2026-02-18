"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { X, ChevronUp, ChevronDown } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useI18n } from "@/hooks/use-i18n";

interface SearchMatch {
  page: number;
  index: number;
}

interface PdfSearchOverlayProps {
  pdfDocument: PDFDocumentProxy | null;
  numPages: number;
  onNavigateToPage: (page: number) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function PdfSearchOverlay({
  pdfDocument,
  numPages,
  onNavigateToPage,
  isOpen,
  onClose,
}: PdfSearchOverlayProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [currentMatch, setCurrentMatch] = useState(-1);
  const [pageTexts, setPageTexts] = useState<Map<number, string>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Extract text from all pages
  useEffect(() => {
    if (!pdfDocument || numPages === 0) return;
    let cancelled = false;
    async function extractTexts() {
      const texts = new Map<number, string>();
      for (let i = 1; i <= numPages; i++) {
        if (cancelled) return;
        try {
          const page = await pdfDocument!.getPage(i);
          const tc = await page.getTextContent();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const str = tc.items.map((item: any) => item.str ?? "").join(" ");
          texts.set(i, str.toLowerCase());
        } catch { /* skip page */ }
      }
      if (!cancelled) setPageTexts(texts);
    }
    extractTexts();
    return () => { cancelled = true; };
  }, [pdfDocument, numPages]);

  // Debounced search
  const doSearch = useCallback((q: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!q.trim()) {
      setMatches([]);
      setCurrentMatch(-1);
      return;
    }
    searchTimer.current = setTimeout(() => {
      const needle = q.toLowerCase();
      const found: SearchMatch[] = [];
      for (let page = 1; page <= numPages; page++) {
        const text = pageTexts.get(page);
        if (!text) continue;
        let idx = 0;
        while ((idx = text.indexOf(needle, idx)) !== -1) {
          found.push({ page, index: idx });
          idx += needle.length;
        }
      }
      setMatches(found);
      setCurrentMatch(found.length > 0 ? 0 : -1);
      if (found.length > 0) onNavigateToPage(found[0].page);
    }, 300);
  }, [numPages, pageTexts, onNavigateToPage]);

  const handleQueryChange = useCallback((val: string) => {
    setQuery(val);
    doSearch(val);
  }, [doSearch]);

  const goToMatch = useCallback((direction: 1 | -1) => {
    if (matches.length === 0) return;
    const next = (currentMatch + direction + matches.length) % matches.length;
    setCurrentMatch(next);
    onNavigateToPage(matches[next].page);
  }, [matches, currentMatch, onNavigateToPage]);

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
    <div className="absolute top-2 right-2 z-50 flex items-center gap-1 rounded-lg border border-border bg-background/95 px-2 py-1.5 shadow-lg backdrop-blur-sm">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('pdf.search.placeholder')}
        className="w-48 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
      />
      {query && (
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {matches.length > 0 ? `${currentMatch + 1}/${matches.length}` : t('pdf.search.noMatch')}
        </span>
      )}
      <button
        onClick={() => goToMatch(-1)}
        disabled={matches.length === 0}
        className="p-0.5 rounded hover:bg-accent disabled:opacity-30 transition-colors"
        title={t('pdf.search.prevMatch')}
      >
        <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <button
        onClick={() => goToMatch(1)}
        disabled={matches.length === 0}
        className="p-0.5 rounded hover:bg-accent disabled:opacity-30 transition-colors"
        title={t('pdf.search.nextMatch')}
      >
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <button
        onClick={onClose}
        className="p-0.5 rounded hover:bg-accent transition-colors"
        title={t('pdf.search.close')}
      >
        <X className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  );
}