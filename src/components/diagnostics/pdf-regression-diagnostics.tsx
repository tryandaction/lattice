"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { UniversalFileViewer } from "@/components/main-area/universal-file-viewer";
import { PDFHighlighterAdapter } from "@/components/renderers/pdf-highlighter-adapter";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { resolveAppRoute } from "@/lib/app-route";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { createEmptyPane } from "@/lib/layout-utils";
import {
  createSamplePdfBuffer,
  ensureSubdirectory,
  getDiagnosticsWorkspaceHandle,
  writeArrayBufferFile,
} from "./browser-regression-utils";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { buildPersistedFileViewStateKey, deletePersistedFileViewState } from "@/lib/file-view-state";
import { createUniversalAnnotationFile, generateFileId, saveAnnotationsToDisk } from "@/lib/universal-annotation-storage";
import { loadPdfJsDocument } from "@/lib/pdf-js-document-loader";
import { readDesktopFileBytesRaw } from "@/lib/desktop-preview";
import { isTauriHost } from "@/lib/storage-adapter";

interface PdfFixture {
  fileId: string;
  fileName: string;
  filePath: string;
  content: ArrayBuffer;
  fileHandle: FileSystemFileHandle;
}

interface DiagnosticsWorkspace {
  rootHandle: FileSystemDirectoryHandle;
  left: PdfFixture;
  rightA: PdfFixture;
  rightB: PdfFixture;
}

function createTextQuote(exact: string) {
  return {
    exact,
    prefix: "",
    suffix: "",
    source: "pdfjs-text-model" as const,
    confidence: "exact" as const,
  };
}

function assertDiagnosticsPdfBuffer(buffer: ArrayBuffer, label: string): ArrayBuffer {
  const bytes = new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength));
  const header = String.fromCharCode(...bytes);
  if (header !== "%PDF-") {
    throw new Error(`Diagnostics PDF source did not return PDF bytes: ${label}`);
  }
  return buffer;
}

async function loadDiagnosticsPdfBuffer(input: { url: string; desktopPath?: string | null }): Promise<ArrayBuffer> {
  if (input.desktopPath && isTauriHost()) {
    const bytes = await readDesktopFileBytesRaw(input.desktopPath);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return assertDiagnosticsPdfBuffer(buffer, input.desktopPath);
  }

  const url = input.url;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load diagnostics PDF: ${url} (${response.status})`);
  }
  return assertDiagnosticsPdfBuffer(await response.arrayBuffer(), url);
}

function sanitizeDiagnosticsPdfName(name: string): string {
  const leafName = name.split(/[\\/]/).filter(Boolean).pop()?.trim() || "diagnostics-real.pdf";
  const sanitized = leafName.replace(/[^\w.()[\] -]+/g, "_");
  return sanitized.toLowerCase().endsWith(".pdf") ? sanitized : `${sanitized}.pdf`;
}

async function seedPdfAnnotation(
  rootHandle: FileSystemDirectoryHandle,
  fileId: string,
  page: number,
  options?: { interactionSet?: boolean },
) {
  const annotationFile = createUniversalAnnotationFile(fileId, "pdf");
  const createdAt = Date.now();
  annotationFile.annotations = [
    {
      id: `ann-${fileId}`,
      target: {
        type: "pdf",
        page,
        rects: [
          { x1: 0.12, y1: 0.18, x2: 0.46, y2: 0.22 },
        ],
      },
      style: {
        color: "#FFEB3B",
        type: "highlight",
      },
      content: `Diagnostic highlight on page ${page}`,
      comment: "Regression seed",
      author: "diagnostics",
      createdAt,
    },
  ];

  if (options?.interactionSet) {
    const targetQuote = createTextQuote("Fig. 5, that tend to cause shifts in opposite directions");
    annotationFile.annotations.push(
      {
        id: "ann-real-highlight",
        target: {
          type: "pdf",
          page,
          rects: [
            { x1: 0.081, y1: 0.292, x2: 0.482, y2: 0.315 },
            { x1: 0.081, y1: 0.318, x2: 0.310, y2: 0.340 },
          ],
          textQuote: targetQuote,
        },
        style: { color: "#FFEB3B", type: "highlight" },
        content: targetQuote.exact,
        author: "diagnostics",
        createdAt: createdAt + 1,
      },
      {
        id: "ann-real-underline",
        target: {
          type: "pdf",
          page,
          rects: [{ x1: 0.081, y1: 0.333, x2: 0.280, y2: 0.338 }],
          textQuote: createTextQuote("Stark shifts below 1 MHz"),
        },
        style: { color: "#2196F3", type: "underline", underlineStyle: "solid" },
        content: "Stark shifts below 1 MHz",
        author: "diagnostics",
        createdAt: createdAt + 2,
      },
      {
        id: "ann-real-area",
        target: {
          type: "pdf",
          page,
          rects: [{ x1: 0.56, y1: 0.18, x2: 0.76, y2: 0.28 }],
        },
        style: { color: "#4CAF50", type: "area" },
        content: "Diagnostic area",
        author: "diagnostics",
        createdAt: createdAt + 3,
      },
      {
        id: "ann-real-text",
        target: {
          type: "pdf",
          page,
          rects: [{ x1: 0.56, y1: 0.33, x2: 0.72, y2: 0.37 }],
        },
        style: {
          color: "#FFFFFF",
          type: "text",
          textStyle: { textColor: "#111111", fontSize: 14 },
        },
        content: "Real PDF text note",
        author: "diagnostics",
        createdAt: createdAt + 4,
      },
      {
        id: "ann-real-pin",
        target: {
          type: "pdf",
          page,
          rects: [{ x1: 0.79, y1: 0.18, x2: 0.81, y2: 0.20 }],
        },
        style: { color: "#FFC107", type: "area" },
        comment: "Real PDF pin",
        author: "diagnostics",
        createdAt: createdAt + 5,
      },
      {
        id: "ann-real-ink",
        target: {
          type: "pdf",
          page,
          rects: [{ x1: 0.56, y1: 0.44, x2: 0.78, y2: 0.53 }],
        },
        style: { color: "#FF5252", type: "ink" },
        content: JSON.stringify({
          paths: [[
            { x: 0.56, y: 0.44 },
            { x: 0.66, y: 0.49 },
            { x: 0.78, y: 0.53 },
          ]],
          width: 5,
        }),
        author: "diagnostics",
        createdAt: createdAt + 6,
      },
    );
  }

  await saveAnnotationsToDisk(annotationFile, rootHandle);
}

function findPdfDiagnosticsScrollContainer(shell: ParentNode | null | undefined, paneId: string): HTMLElement | null {
  if (!shell) {
    return null;
  }

  const preferred = document.querySelector<HTMLElement>(`[data-testid="pdf-viewer-container-${paneId}"]`)
    ?? shell.querySelector<HTMLElement>(`[data-testid="pdf-scroll-container-${paneId}"]`);
  if (preferred) {
    return preferred;
  }

  const candidates = Array.from(shell.querySelectorAll<HTMLElement>("*"));
  candidates.sort((left, right) => {
    const leftOverflow = (left.scrollHeight - left.clientHeight) + (left.scrollWidth - left.clientWidth);
    const rightOverflow = (right.scrollHeight - right.clientHeight) + (right.scrollWidth - right.clientWidth);
    return rightOverflow - leftOverflow;
  });
  return candidates[0] ?? null;
}

export function PdfRegressionDiagnostics() {
  const imageHandleHref = resolveAppRoute("/diagnostics/image-annotation");
  const selectionHref = resolveAppRoute("/diagnostics/selection-ai");
  const singlePaneMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("singlePane");
  const directHighlighterMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("directHighlighter");
  const stableStateMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("stableState");
  const resetViewStateMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("resetViewState");
  const realPdfMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("realPdf");
  const realPdfUrl = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("realPdfUrl") || "/__lattice-diagnostics/saffman-real.pdf"
    : "/__lattice-diagnostics/saffman-real.pdf";
  const realPdfDesktopPath = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("realPdfPath")
    : null;
  const realPdfFileName = sanitizeDiagnosticsPdfName(typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("realPdfName") || "saffman-real.pdf"
    : "saffman-real.pdf");
  const realPdfSeedPage = Math.max(1, Number(typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("realPdfPage") || "7"
    : "7"));
  const [workspace, setWorkspace] = useState<DiagnosticsWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rightVariant, setRightVariant] = useState<"a" | "b">("a");
  const [compactLayout, setCompactLayout] = useState(false);
  const [preloadedLeftDocument, setPreloadedLeftDocument] = useState<PDFDocumentProxy | null>(null);
  const [preloadedRightDocument, setPreloadedRightDocument] = useState<PDFDocumentProxy | null>(null);

  const rightFixture = useMemo(() => {
    if (!workspace) {
      return null;
    }
    return rightVariant === "a" ? workspace.rightA : workspace.rightB;
  }, [rightVariant, workspace]);

  useEffect(() => {
    let disposed = false;

    const setup = async () => {
      try {
        const rootHandle = await getDiagnosticsWorkspaceHandle();
        const pdfDirectory = await ensureSubdirectory(rootHandle, "pdf");
        const sessionId = stableStateMode ? "pdf-regression-stable" : `pdf-regression-${Date.now()}`;
        const workspaceRootPath = `${rootHandle.name}/${sessionId}`;
        const leftFilePath = realPdfMode ? `pdf/${realPdfFileName}` : "pdf/left-fixture.pdf";
        const rightAFilePath = "pdf/right-fixture-a.pdf";
        const rightBFilePath = "pdf/right-fixture-b.pdf";
        const leftFileId = generateFileId(leftFilePath);
        const rightAFileId = generateFileId(rightAFilePath);
        const rightBFileId = generateFileId(rightBFilePath);

        const [leftBuffer, rightABuffer, rightBBuffer] = await Promise.all([
          realPdfMode
            ? loadDiagnosticsPdfBuffer({ url: realPdfUrl, desktopPath: realPdfDesktopPath })
            : createSamplePdfBuffer("Left regression fixture", 1),
          createSamplePdfBuffer("Right regression fixture A", 2),
          createSamplePdfBuffer("Right regression fixture B", 2),
        ]);

        const [leftHandle, rightAHandle, rightBHandle] = await Promise.all([
          writeArrayBufferFile(pdfDirectory, realPdfMode ? realPdfFileName : "left-fixture.pdf", leftBuffer.slice(0)),
          writeArrayBufferFile(pdfDirectory, "right-fixture-a.pdf", rightABuffer.slice(0)),
          writeArrayBufferFile(pdfDirectory, "right-fixture-b.pdf", rightBBuffer.slice(0)),
        ]);

        await Promise.all([
          seedPdfAnnotation(rootHandle, leftFileId, realPdfMode ? realPdfSeedPage : 1, {
            interactionSet: realPdfMode,
          }),
          seedPdfAnnotation(rootHandle, rightAFileId, 1),
          seedPdfAnnotation(rootHandle, rightBFileId, 2),
        ]);

        if (disposed) {
          return;
        }

        const persistedKeys = [
          buildPersistedFileViewStateKey({
            kind: "pdf",
            workspaceRootPath,
            filePath: leftFilePath,
            fallbackName: realPdfMode ? realPdfFileName : "left-fixture.pdf",
          }),
          buildPersistedFileViewStateKey({
            kind: "pdf",
            workspaceRootPath,
            filePath: rightAFilePath,
            fallbackName: "right-fixture-a.pdf",
          }),
          buildPersistedFileViewStateKey({
            kind: "pdf",
            workspaceRootPath,
            filePath: rightBFilePath,
            fallbackName: "right-fixture-b.pdf",
          }),
        ];

        if (!stableStateMode || resetViewStateMode) {
          await Promise.all(persistedKeys.map((key) => deletePersistedFileViewState(key)));
        }
        useContentCacheStore.getState().clearCache();

        useWorkspaceStore.setState({
          rootHandle,
          workspaceRootPath,
          layout: {
            root: createEmptyPane("pdf-left-pane"),
            activePaneId: "pdf-left-pane",
          },
        });

        setWorkspace({
          rootHandle,
          left: {
            fileId: leftFileId,
            fileName: realPdfMode ? realPdfFileName : "left-fixture.pdf",
            filePath: leftFilePath,
            content: leftBuffer,
            fileHandle: leftHandle,
          },
          rightA: {
            fileId: rightAFileId,
            fileName: "right-fixture-a.pdf",
            filePath: rightAFilePath,
            content: rightABuffer,
            fileHandle: rightAHandle,
          },
          rightB: {
            fileId: rightBFileId,
            fileName: "right-fixture-b.pdf",
            filePath: rightBFilePath,
            content: rightBBuffer,
            fileHandle: rightBHandle,
          },
        });
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    void setup();

    return () => {
      disposed = true;
    };
  }, [realPdfDesktopPath, realPdfFileName, realPdfMode, realPdfSeedPage, realPdfUrl, resetViewStateMode, stableStateMode]);

  useEffect(() => {
    if (!directHighlighterMode || !workspace || !rightFixture) {
      setPreloadedLeftDocument(null);
      setPreloadedRightDocument(null);
      return;
    }

    let disposed = false;
    setPreloadedLeftDocument(null);
    setPreloadedRightDocument(null);
    void Promise.all([
      loadPdfJsDocument({
        data: workspace.left.content,
        label: "PDF regression direct highlighter left",
        timeoutMs: realPdfMode ? 45000 : 20000,
      }),
      loadPdfJsDocument({
        data: rightFixture.content,
        label: "PDF regression direct highlighter right",
        timeoutMs: 20000,
      }),
    ]).then(([leftDocument, rightDocument]) => {
      if (disposed) {
        void leftDocument.destroy();
        void rightDocument.destroy();
        return;
      }
      setPreloadedLeftDocument(leftDocument);
      setPreloadedRightDocument(rightDocument);
    }).catch((err) => {
      if (!disposed) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });

    return () => {
      disposed = true;
    };
  }, [directHighlighterMode, rightFixture, workspace]);

  const scrollPaneToPage = (shellTestId: string, paneId: string, pageNumber: number) => {
    let attemptsLeft = 120;

    const attemptScroll = () => {
      const diagnosticsWindow = window as Window & {
        __latticePdfDiagnostics?: Record<string, {
          scrollToPage?: (pageNumber: number) => boolean;
        }>;
      };
      if (diagnosticsWindow.__latticePdfDiagnostics?.[paneId]?.scrollToPage?.(pageNumber)) {
        return;
      }

      const shell = document.querySelector<HTMLElement>(`[data-testid="${shellTestId}"]`);
      const scrollContainer = findPdfDiagnosticsScrollContainer(shell, paneId);
      const page = shell?.querySelector<HTMLElement>(`[data-page-number="${pageNumber}"]`);
      if (page) {
        page.scrollIntoView({ behavior: "auto", block: "center" });
        return;
      }

      const firstPage = shell?.querySelector<HTMLElement>('[data-page-number="1"]');
      if (scrollContainer && firstPage) {
        const estimatedPageHeight = firstPage.getBoundingClientRect().height + 24;
        scrollContainer.scrollTo({
          top: Math.max(0, estimatedPageHeight * (pageNumber - 1)),
          behavior: "auto",
        });
      }

      attemptsLeft -= 1;
      if (attemptsLeft > 0) {
        window.requestAnimationFrame(attemptScroll);
      }
    };

    void window.requestAnimationFrame(attemptScroll);
  };

  if (error) {
    return <div className="p-6 text-sm text-destructive">{error}</div>;
  }

  if (!workspace || !rightFixture) {
    return <div className="p-6 text-sm text-muted-foreground">Preparing PDF regression fixtures...</div>;
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground" data-testid="pdf-regression-ready">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-medium">PDF Split Regression</h1>
          <p className="text-xs text-muted-foreground">
            Lightweight PDF diagnostics focused on split panes, scoped zoom, file switching, and annotation stability.
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2 text-xs">
          <button
            type="button"
            data-testid="activate-left-pane"
            onClick={() => useWorkspaceStore.setState((state) => ({
              layout: {
                ...state.layout,
                activePaneId: "pdf-left-pane",
              },
            }))}
            className="rounded border border-border px-3 py-1 hover:bg-muted"
          >
            Activate left
          </button>
          <button
            type="button"
            data-testid="activate-right-pane"
            onClick={() => useWorkspaceStore.setState((state) => ({
              layout: {
                ...state.layout,
                activePaneId: "pdf-right-pane",
              },
            }))}
            className="rounded border border-border px-3 py-1 hover:bg-muted"
          >
            Activate right
          </button>
          <button
            type="button"
            data-testid="toggle-right-file"
            onClick={() => setRightVariant((value) => value === "a" ? "b" : "a")}
            className="rounded border border-border px-3 py-1 hover:bg-muted"
          >
            Toggle right file
          </button>
          <button
            type="button"
            data-testid="scroll-right-to-page-2"
            onClick={() => scrollPaneToPage("pdf-right-shell", "pdf-right-pane", 2)}
            className="rounded border border-border px-3 py-1 hover:bg-muted"
          >
            Scroll right to page 2
          </button>
          <button
            type="button"
            data-testid="toggle-pdf-compact-layout"
            onClick={() => setCompactLayout((value) => !value)}
            className="rounded border border-border px-3 py-1 hover:bg-muted"
          >
            Toggle compact layout
          </button>
          <Link href={imageHandleHref} className="rounded border border-border px-3 py-1 hover:bg-muted">
            Image diagnostics
          </Link>
          <Link href={selectionHref} className="rounded border border-border px-3 py-1 hover:bg-muted">
            Selection AI
          </Link>
        </div>
      </header>

      <main className={`grid min-h-0 flex-1 gap-3 overflow-hidden p-3 ${singlePaneMode ? "grid-cols-1" : compactLayout ? "grid-cols-[1fr_0.9fr]" : "grid-cols-[1fr_1fr]"}`}>
        <section className="min-h-0 overflow-hidden rounded-xl border border-border" data-testid="pdf-left-shell">
          {directHighlighterMode && !preloadedLeftDocument ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Preparing direct PDF highlighter...
            </div>
          ) : directHighlighterMode ? (
            <PDFHighlighterAdapter
              key={workspace.left.fileId}
              paneId="pdf-left-pane"
              fileHandle={workspace.left.fileHandle}
              rootHandle={workspace.rootHandle}
              source={{ kind: "buffer", data: workspace.left.content }}
              fileName={workspace.left.fileName}
              fileId={workspace.left.fileId}
              filePath={workspace.left.filePath}
              preloadedPdfDocument={preloadedLeftDocument}
            />
          ) : (
            <UniversalFileViewer
              key={workspace.left.fileId}
              paneId="pdf-left-pane"
              handle={workspace.left.fileHandle}
              rootHandle={workspace.rootHandle}
              content={{ kind: "buffer", data: workspace.left.content }}
              isLoading={false}
              error={null}
              fileId={workspace.left.fileId}
              filePath={workspace.left.filePath}
            />
          )}
        </section>

        {!singlePaneMode ? (
          <section className="min-h-0 overflow-hidden rounded-xl border border-border" data-testid="pdf-right-shell">
            {directHighlighterMode && !preloadedRightDocument ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Preparing direct PDF highlighter...
              </div>
            ) : directHighlighterMode ? (
              <PDFHighlighterAdapter
                key={rightFixture.fileId}
                paneId="pdf-right-pane"
                fileHandle={rightFixture.fileHandle}
                rootHandle={workspace.rootHandle}
                source={{ kind: "buffer", data: rightFixture.content }}
                fileName={rightFixture.fileName}
                fileId={rightFixture.fileId}
                filePath={rightFixture.filePath}
                preloadedPdfDocument={preloadedRightDocument}
              />
            ) : (
              <UniversalFileViewer
                key={rightFixture.fileId}
                paneId="pdf-right-pane"
                handle={rightFixture.fileHandle}
                rootHandle={workspace.rootHandle}
                content={{ kind: "buffer", data: rightFixture.content }}
                isLoading={false}
                error={null}
                fileId={rightFixture.fileId}
                filePath={rightFixture.filePath}
              />
            )}
          </section>
        ) : null}
      </main>

      <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        Right file: <span data-testid="right-file-indicator">{rightFixture.fileName}</span>
      </div>
    </div>
  );
}
