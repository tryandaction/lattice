"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Highlighter, List, Loader2, Search, ZoomIn, ZoomOut } from "lucide-react";
import type { RenderTask } from "pdfjs-dist";
import { useI18n } from "@/hooks/use-i18n";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { buildPersistedFileViewStateKey, loadPersistedFileViewState, savePersistedFileViewState } from "@/lib/file-view-state";
import { buildDesktopPdfReaderEditorState, createDefaultPdfNavigationState, normalizePdfNavigationState, readDesktopPdfNavigationState } from "@/lib/desktop-pdf-view-state";
import { createPdfDocumentSessionController, isStalePdfSessionError } from "@/lib/pdf-document-session-controller";
import { readCachedPdfViewState } from "@/lib/pdf-view-state";
import { DesktopPdfSearchPanel, type DesktopPdfSearchMatch } from "./desktop-pdf-search-panel";
import { DesktopPdfOutlinePanel } from "./desktop-pdf-outline-panel";
import type { DesktopPdfMode, PdfNavigationState, PdfSearchTaskState, ResolvedPdfOutlineItem } from "@/types/pdf-runtime";

const DesktopPdfHighlighter = dynamic(
  () => import("./pdf-highlighter-adapter").then((mod) => mod.PDFHighlighterAdapter),
  { ssr: false },
);

const DESKTOP_MIN_SCALE = 0.5;
const DESKTOP_HEAVY_DOCUMENT_PAGE_THRESHOLD = 200;
const DESKTOP_NORMAL_MAX_SCALE = 1.8;
const DESKTOP_HEAVY_MAX_SCALE = 1.35;

interface DesktopPdfReaderShellProps {
  content: ArrayBuffer;
  fileName: string;
  paneId?: string;
  fileId: string;
  filePath: string;
  fileHandle?: FileSystemFileHandle;
  rootHandle?: FileSystemDirectoryHandle | null;
  canAnnotate?: boolean;
  hasPersistedAnnotations?: boolean;
}

interface CanvasMetrics {
  renderedScale: number;
  pageWidth: number;
  pageHeight: number;
}

function createIdleSearchTaskState(): PdfSearchTaskState {
  return {
    query: "",
    extractedPages: 0,
    totalPages: 0,
    status: "idle",
  };
}

function getDesktopMaxScale(numPages: number): number {
  return numPages >= DESKTOP_HEAVY_DOCUMENT_PAGE_THRESHOLD
    ? DESKTOP_HEAVY_MAX_SCALE
    : DESKTOP_NORMAL_MAX_SCALE;
}

function deriveNavigationStateFromHighlighter(fileId: string): PdfNavigationState | null {
  const editorState = useContentCacheStore.getState().getEditorState(fileId);
  const pdfState = readCachedPdfViewState(editorState);
  if (!pdfState) {
    return null;
  }

  return normalizePdfNavigationState({
    currentPage: pdfState.anchor?.pageNumber ?? 1,
    zoomMode: pdfState.zoomMode === "fit-page" ? "fit-page" : "manual",
    zoomScale: pdfState.scale,
  });
}

function DesktopPdfCanvasPage({
  controller,
  generationId,
  pageNumber,
  numPages,
  navigationState,
  viewportWidth,
  viewportHeight,
  onMetrics,
  onRenderError,
}: {
  controller: ReturnType<typeof createPdfDocumentSessionController>;
  generationId: number;
  pageNumber: number;
  numPages: number;
  navigationState: PdfNavigationState;
  viewportWidth: number;
  viewportHeight: number;
  onMetrics: (metrics: CanvasMetrics) => void;
  onRenderError: (message: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let disposed = false;

    const keepPages = [pageNumber - 1, pageNumber, pageNumber + 1].filter((candidate) => candidate >= 1 && candidate <= numPages);

    const renderPage = async () => {
      try {
        const [page] = await Promise.all([
          controller.loadPage(pageNumber, generationId, keepPages),
          ...keepPages.filter((candidate) => candidate !== pageNumber).map((candidate) => controller.loadPage(candidate, generationId, keepPages).catch(() => null)),
        ]);

        if (disposed) {
          return;
        }

        const baseViewport = page.getViewport({ scale: 1 });
        const fitScale = Math.max(
          DESKTOP_MIN_SCALE,
          Math.min(
            getDesktopMaxScale(numPages),
            Math.min(
              Math.max(1, viewportWidth - 32) / baseViewport.width,
              Math.max(1, viewportHeight - 32) / baseViewport.height,
            ),
          ),
        );
        const renderScale = navigationState.zoomMode === "fit-page"
          ? fitScale
          : Math.max(DESKTOP_MIN_SCALE, Math.min(getDesktopMaxScale(numPages), navigationState.zoomScale));
        const viewport = page.getViewport({ scale: renderScale });
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d", { alpha: false });
        if (!canvas || !context) {
          return;
        }

        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        renderTaskRef.current?.cancel();
        const renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
        });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (disposed) {
          return;
        }

        onMetrics({
          renderedScale: renderScale,
          pageWidth: baseViewport.width,
          pageHeight: baseViewport.height,
        });
        onRenderError(null);
        setIsReady(true);
      } catch (error) {
        if (disposed || isStalePdfSessionError(error)) {
          return;
        }
        onRenderError(error instanceof Error ? error.message : "Failed to render page");
      }
    };

    void renderPage();

    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [controller, generationId, navigationState, numPages, onMetrics, onRenderError, pageNumber, viewportHeight, viewportWidth]);

  return (
    <div className="flex min-h-full items-start justify-center">
      {!isReady ? (
        <div className="flex h-full min-h-[240px] items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : null}
      <canvas
        ref={canvasRef}
        className={`rounded bg-white shadow-lg ${isReady ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}

export function DesktopPdfReaderShell({
  content,
  fileName,
  paneId,
  fileId,
  filePath,
  fileHandle,
  rootHandle,
  canAnnotate = false,
  hasPersistedAnnotations = false,
}: DesktopPdfReaderShellProps) {
  const { t } = useI18n();
  const workspaceKey = useWorkspaceStore((state) => state.workspaceIdentity?.workspaceKey ?? null);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const saveEditorState = useContentCacheStore((state) => state.saveEditorState);
  const controllerRef = useRef(createPdfDocumentSessionController());
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const searchRunIdRef = useRef(0);
  const [mode, setMode] = useState<DesktopPdfMode>("reader");
  const [generationId, setGenerationId] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [isLoadingDocument, setIsLoadingDocument] = useState(true);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineItems, setOutlineItems] = useState<ResolvedPdfOutlineItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [navigationState, setNavigationState] = useState<PdfNavigationState>(createDefaultPdfNavigationState);
  const [pageInput, setPageInput] = useState("1");
  const [pageInputFocused, setPageInputFocused] = useState(false);
  const [renderedScale, setRenderedScale] = useState(1);
  const [viewportSize, setViewportSize] = useState({ width: 1200, height: 900 });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchTaskState, setSearchTaskState] = useState<PdfSearchTaskState>(createIdleSearchTaskState);
  const [searchMatches, setSearchMatches] = useState<DesktopPdfSearchMatch[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [isNavigationHydrated, setIsNavigationHydrated] = useState(false);

  const persistedKey = useMemo(() => buildPersistedFileViewStateKey({
    kind: "pdf-desktop",
    workspaceKey,
    workspaceRootPath,
    filePath,
    fallbackName: fileName,
  }), [fileName, filePath, workspaceKey, workspaceRootPath]);

  const currentPage = navigationState.currentPage;
  const maxManualScale = getDesktopMaxScale(numPages);

  useEffect(() => {
    const container = viewportRef.current;
    if (!container) {
      return;
    }

    const update = () => {
      setViewportSize((previous) => {
        const next = {
          width: container.clientWidth,
          height: container.clientHeight,
        };
        return previous.width === next.width && previous.height === next.height ? previous : next;
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    setIsNavigationHydrated(false);

    const hydrateNavigation = async () => {
      const cached = readDesktopPdfNavigationState(useContentCacheStore.getState().getEditorState(fileId));
      if (cached) {
        if (!disposed) {
          setNavigationState(cached);
          setIsNavigationHydrated(true);
        }
        return;
      }

      const persisted = readDesktopPdfNavigationState(await loadPersistedFileViewState(persistedKey));
      if (!disposed) {
        if (persisted) {
          setNavigationState(persisted);
        }
        setIsNavigationHydrated(true);
      }
    };

    void hydrateNavigation();
    return () => {
      disposed = true;
    };
  }, [fileId, persistedKey]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (mode === "annotate") {
      controller.cancelPendingWork();
      void controller.destroyDocument();
      setIsLoadingDocument(false);
      setGenerationId(0);
      return;
    }

    let disposed = false;
    setIsLoadingDocument(true);
    setError(null);
    setOutlineItems([]);
    setOutlineLoading(false);

    const load = async () => {
      try {
        const loaded = await controller.loadDocument(new Uint8Array(content));
        if (disposed) {
          return;
        }
        setGenerationId(loaded.generationId);
        setNumPages(loaded.document.numPages);
        setNavigationState((previous) => normalizePdfNavigationState({
          ...previous,
          currentPage: Math.min(Math.max(1, previous.currentPage), loaded.document.numPages || 1),
        }));
      } catch (loadError) {
        if (disposed || isStalePdfSessionError(loadError)) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Failed to load PDF");
      } finally {
        if (!disposed) {
          setIsLoadingDocument(false);
        }
      }
    };

    void load();

    return () => {
      disposed = true;
      controller.cancelPendingWork();
      void controller.destroyDocument();
    };
  }, [content, mode]);

  useEffect(() => {
    if (pageInputFocused) {
      return;
    }
    setPageInput(String(currentPage));
  }, [currentPage, pageInputFocused]);

  useEffect(() => {
    if (!isNavigationHydrated) {
      return;
    }
    const nextState = buildDesktopPdfReaderEditorState(navigationState);
    saveEditorState(fileId, nextState);
    void savePersistedFileViewState(persistedKey, nextState);
  }, [fileId, isNavigationHydrated, navigationState, persistedKey, saveEditorState]);

  useEffect(() => {
    if (mode !== "search" || !searchQuery.trim() || generationId === 0 || numPages === 0) {
      searchRunIdRef.current += 1;
      setSearchTaskState(searchQuery.trim() ? {
        query: searchQuery,
        extractedPages: 0,
        totalPages: numPages,
        status: "cancelled",
      } : createIdleSearchTaskState());
      setSearchMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }

    let disposed = false;
    const runId = ++searchRunIdRef.current;
    const needle = searchQuery.toLowerCase();
    const nextMatches: DesktopPdfSearchMatch[] = [];

    setSearchTaskState({
      query: searchQuery,
      extractedPages: 0,
      totalPages: numPages,
      status: "extracting",
    });
    setSearchMatches([]);
    setCurrentMatchIndex(-1);

    const runSearch = async () => {
      try {
        for (let page = 1; page <= numPages; page += 1) {
          if (disposed || runId !== searchRunIdRef.current) {
            return;
          }

          const pageText = await controllerRef.current.loadTextForPage(page, generationId);
          let startIndex = 0;
          while (startIndex < pageText.length) {
            const matchIndex = pageText.indexOf(needle, startIndex);
            if (matchIndex === -1) {
              break;
            }
            nextMatches.push({ page, index: matchIndex });
            startIndex = matchIndex + Math.max(1, needle.length);
          }

          if (!disposed) {
            setSearchTaskState({
              query: searchQuery,
              extractedPages: page,
              totalPages: numPages,
              status: page === numPages ? "ready" : "extracting",
            });
          }

          if (page % 6 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }

        if (!disposed && runId === searchRunIdRef.current) {
          setSearchMatches(nextMatches);
          setCurrentMatchIndex(nextMatches.length > 0 ? 0 : -1);
          if (nextMatches[0]) {
            setNavigationState((previous) => ({
              ...previous,
              currentPage: nextMatches[0].page,
            }));
          }
        }
      } catch (searchError) {
        if (!disposed && !isStalePdfSessionError(searchError)) {
          setSearchTaskState({
            query: searchQuery,
            extractedPages: 0,
            totalPages: numPages,
            status: "error",
          });
        }
      }
    };

    void runSearch();

    return () => {
      disposed = true;
    };
  }, [generationId, mode, numPages, searchQuery]);

  useEffect(() => {
    if (mode !== "outline" || generationId === 0) {
      return;
    }

    let disposed = false;
    setOutlineLoading(true);

    const loadOutline = async () => {
      try {
        const items = await controllerRef.current.loadOutline(generationId);
        if (!disposed) {
          setOutlineItems(items);
        }
      } catch (outlineError) {
        if (!disposed && !isStalePdfSessionError(outlineError)) {
          setOutlineItems([]);
        }
      } finally {
        if (!disposed) {
          setOutlineLoading(false);
        }
      }
    };

    void loadOutline();

    return () => {
      disposed = true;
    };
  }, [generationId, mode]);

  const handleMetrics = useCallback((metrics: CanvasMetrics) => {
    setRenderedScale(metrics.renderedScale);
  }, []);

  const handleRenderError = useCallback((message: string | null) => {
    setError(message);
  }, []);

  const navigateToPage = useCallback((page: number) => {
    setNavigationState((previous) => ({
      ...previous,
      currentPage: Math.min(Math.max(1, page), Math.max(1, numPages)),
    }));
  }, [numPages]);

  const openSearchMode = useCallback(() => {
    setMode((previous) => previous === "search" ? "reader" : "search");
  }, []);

  const openOutlineMode = useCallback(() => {
    setMode((previous) => previous === "outline" ? "reader" : "outline");
  }, []);

  const closeSidePanelModes = useCallback(() => {
    setMode("reader");
  }, []);

  const handleSelectMatch = useCallback((index: number) => {
    const match = searchMatches[index];
    if (!match) {
      return;
    }
    setCurrentMatchIndex(index);
    navigateToPage(match.page);
  }, [navigateToPage, searchMatches]);

  const goToRelativeMatch = useCallback((direction: 1 | -1) => {
    if (searchMatches.length === 0) {
      return;
    }
    const nextIndex = (currentMatchIndex + direction + searchMatches.length) % searchMatches.length;
    handleSelectMatch(nextIndex);
  }, [currentMatchIndex, handleSelectMatch, searchMatches.length]);

  const handleExitAnnotationMode = useCallback(() => {
    const restored = deriveNavigationStateFromHighlighter(fileId);
    if (restored) {
      setNavigationState(restored);
    }
    setMode("reader");
  }, [fileId]);

  const zoomIn = useCallback(() => {
    setNavigationState((previous) => ({
      currentPage: previous.currentPage,
      zoomMode: "manual",
      zoomScale: Math.min(previous.zoomScale + 0.2, maxManualScale),
    }));
  }, [maxManualScale]);

  const zoomOut = useCallback(() => {
    setNavigationState((previous) => ({
      currentPage: previous.currentPage,
      zoomMode: "manual",
      zoomScale: Math.max(previous.zoomScale - 0.2, DESKTOP_MIN_SCALE),
    }));
  }, []);

  const setFitPage = useCallback(() => {
    setNavigationState((previous) => ({
      ...previous,
      zoomMode: "fit-page",
    }));
  }, []);

  const displayScale = navigationState.zoomMode === "fit-page" ? renderedScale : navigationState.zoomScale;

  if (mode === "annotate" && fileHandle && rootHandle && paneId) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
        <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={handleExitAnnotationMode}
              className="rounded border border-border px-3 py-1 text-xs hover:bg-accent"
            >
              Reader
            </button>
            <span className="truncate text-sm text-muted-foreground">{fileName}</span>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <DesktopPdfHighlighter
            key={`desktop-annotate:${fileId}:${filePath}`}
            content={content}
            fileName={fileName}
            fileHandle={fileHandle}
            rootHandle={rootHandle}
            paneId={paneId}
            fileId={fileId}
            filePath={filePath}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background" data-testid={paneId ? `desktop-pdf-reader-${paneId}` : "desktop-pdf-reader"}>
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm text-muted-foreground">{fileName}</div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => navigateToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="rounded p-1 hover:bg-muted disabled:opacity-40"
              title="Previous page"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <input
              type="text"
              value={pageInputFocused ? pageInput : String(currentPage)}
              onChange={(event) => setPageInput(event.target.value)}
              onFocus={() => setPageInputFocused(true)}
              onBlur={() => {
                setPageInputFocused(false);
                const nextPage = Number.parseInt(pageInput, 10);
                if (Number.isFinite(nextPage)) {
                  navigateToPage(nextPage);
                } else {
                  setPageInput(String(currentPage));
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  const nextPage = Number.parseInt(pageInput, 10);
                  if (Number.isFinite(nextPage)) {
                    navigateToPage(nextPage);
                  }
                }
              }}
              className="w-12 rounded border border-border bg-background px-2 py-0.5 text-center text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-sm text-muted-foreground">of {numPages || "…"}</span>
            <button
              type="button"
              onClick={() => navigateToPage(currentPage + 1)}
              disabled={numPages === 0 || currentPage >= numPages}
              className="rounded p-1 hover:bg-muted disabled:opacity-40"
              title="Next page"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={zoomOut}
              disabled={navigationState.zoomMode === "manual" && navigationState.zoomScale <= DESKTOP_MIN_SCALE}
              className="rounded p-1 hover:bg-muted disabled:opacity-40"
              title={t("pdf.zoomOut")}
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="min-w-[4rem] text-center text-sm">{Math.round(displayScale * 100)}%</span>
            <button
              type="button"
              onClick={zoomIn}
              disabled={navigationState.zoomMode === "manual" && navigationState.zoomScale >= maxManualScale}
              className="rounded p-1 hover:bg-muted disabled:opacity-40"
              title={t("pdf.zoomIn")}
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={setFitPage}
              className={`rounded border px-2 py-1 text-xs ${navigationState.zoomMode === "fit-page" ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}
            >
              {t("pdf.fitPage")}
            </button>
          </div>

          <button
            type="button"
            onClick={openSearchMode}
            className={`rounded p-1 ${mode === "search" ? "bg-muted" : "hover:bg-muted"}`}
            title={t("pdf.search.open")}
          >
            <Search className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={openOutlineMode}
            className={`rounded p-1 ${mode === "outline" ? "bg-muted" : "hover:bg-muted"}`}
            title={t("pdf.outline.toggle")}
          >
            <List className="h-4 w-4" />
          </button>

          {canAnnotate && fileHandle && rootHandle && paneId ? (
            <button
              type="button"
              onClick={() => setMode("annotate")}
              className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors ${
                hasPersistedAnnotations
                  ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                  : "border-border bg-background hover:bg-muted"
              }`}
            >
              <Highlighter className="h-3.5 w-3.5" />
              <span>{t("pdf.workspace.note.annotation")}</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div ref={viewportRef} className="min-h-0 flex-1 overflow-auto bg-muted/30 p-4">
          {isLoadingDocument ? (
            <div className="flex h-full min-h-[240px] items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading PDF…</span>
            </div>
          ) : error ? (
            <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-destructive">
              {error}
            </div>
          ) : generationId > 0 ? (
            <DesktopPdfCanvasPage
              key={`${fileId}:${generationId}:${currentPage}:${navigationState.zoomMode}:${navigationState.zoomScale.toFixed(2)}:${viewportSize.width}x${viewportSize.height}`}
              controller={controllerRef.current}
              generationId={generationId}
              pageNumber={currentPage}
              numPages={numPages}
              navigationState={navigationState}
              viewportWidth={viewportSize.width}
              viewportHeight={viewportSize.height}
              onMetrics={handleMetrics}
              onRenderError={handleRenderError}
            />
          ) : null}
        </div>

        <DesktopPdfSearchPanel
          isOpen={mode === "search"}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          taskState={searchTaskState}
          matches={searchMatches}
          currentMatchIndex={currentMatchIndex}
          onSelectMatch={handleSelectMatch}
          onPreviousMatch={() => goToRelativeMatch(-1)}
          onNextMatch={() => goToRelativeMatch(1)}
          onClose={closeSidePanelModes}
        />

        <DesktopPdfOutlinePanel
          isOpen={mode === "outline"}
          isLoading={outlineLoading}
          items={outlineItems}
          onNavigateToPage={navigateToPage}
          onClose={closeSidePanelModes}
        />
      </div>
    </div>
  );
}
