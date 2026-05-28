"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { UniversalFileViewer } from "@/components/main-area/universal-file-viewer";
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

async function seedPdfAnnotation(rootHandle: FileSystemDirectoryHandle, fileId: string, page: number) {
  const annotationFile = createUniversalAnnotationFile(fileId, "pdf");
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
      createdAt: Date.now(),
    },
  ];

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
  const [workspace, setWorkspace] = useState<DiagnosticsWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rightVariant, setRightVariant] = useState<"a" | "b">("a");
  const [compactLayout, setCompactLayout] = useState(false);

  useEffect(() => {
    let disposed = false;

    const setup = async () => {
      try {
        const rootHandle = await getDiagnosticsWorkspaceHandle();
        const pdfDirectory = await ensureSubdirectory(rootHandle, "pdf");
        const sessionId = `pdf-regression-${Date.now()}`;
        const workspaceRootPath = `${rootHandle.name}/${sessionId}`;
        const leftFileId = `${sessionId}-left`;
        const rightAFileId = `${sessionId}-right-a`;
        const rightBFileId = `${sessionId}-right-b`;

        const [leftBuffer, rightABuffer, rightBBuffer] = await Promise.all([
          createSamplePdfBuffer("Left regression fixture", 1),
          createSamplePdfBuffer("Right regression fixture A", 2),
          createSamplePdfBuffer("Right regression fixture B", 2),
        ]);

        const [leftHandle, rightAHandle, rightBHandle] = await Promise.all([
          writeArrayBufferFile(pdfDirectory, "left-fixture.pdf", leftBuffer),
          writeArrayBufferFile(pdfDirectory, "right-fixture-a.pdf", rightABuffer),
          writeArrayBufferFile(pdfDirectory, "right-fixture-b.pdf", rightBBuffer),
        ]);

        await Promise.all([
          seedPdfAnnotation(rootHandle, generateFileId("pdf/left-fixture.pdf"), 1),
          seedPdfAnnotation(rootHandle, generateFileId("pdf/right-fixture-a.pdf"), 1),
          seedPdfAnnotation(rootHandle, generateFileId("pdf/right-fixture-b.pdf"), 2),
        ]);

        if (disposed) {
          return;
        }

        const persistedKeys = [
          buildPersistedFileViewStateKey({
            kind: "pdf",
            workspaceRootPath,
            filePath: "pdf/left-fixture.pdf",
            fallbackName: "left-fixture.pdf",
          }),
          buildPersistedFileViewStateKey({
            kind: "pdf",
            workspaceRootPath,
            filePath: "pdf/right-fixture-a.pdf",
            fallbackName: "right-fixture-a.pdf",
          }),
          buildPersistedFileViewStateKey({
            kind: "pdf",
            workspaceRootPath,
            filePath: "pdf/right-fixture-b.pdf",
            fallbackName: "right-fixture-b.pdf",
          }),
        ];

        await Promise.all(persistedKeys.map((key) => deletePersistedFileViewState(key)));
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
            fileName: "left-fixture.pdf",
            filePath: "pdf/left-fixture.pdf",
            content: leftBuffer,
            fileHandle: leftHandle,
          },
          rightA: {
            fileId: rightAFileId,
            fileName: "right-fixture-a.pdf",
            filePath: "pdf/right-fixture-a.pdf",
            content: rightABuffer,
            fileHandle: rightAHandle,
          },
          rightB: {
            fileId: rightBFileId,
            fileName: "right-fixture-b.pdf",
            filePath: "pdf/right-fixture-b.pdf",
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
  }, []);

  const rightFixture = useMemo(() => {
    if (!workspace) {
      return null;
    }
    return rightVariant === "a" ? workspace.rightA : workspace.rightB;
  }, [rightVariant, workspace]);

  const scrollPaneToPage = (shellTestId: string, paneId: string, pageNumber: number) => {
    let attemptsLeft = 120;

    const attemptScroll = () => {
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

      <main className={`grid min-h-0 flex-1 gap-3 overflow-hidden p-3 ${compactLayout ? "grid-cols-[1fr_0.9fr]" : "grid-cols-[1fr_1fr]"}`}>
        <section className="min-h-0 overflow-hidden rounded-xl border border-border" data-testid="pdf-left-shell">
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
        </section>

        <section className="min-h-0 overflow-hidden rounded-xl border border-border" data-testid="pdf-right-shell">
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
        </section>
      </main>

      <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        Right file: <span data-testid="right-file-indicator">{rightFixture.fileName}</span>
      </div>
    </div>
  );
}
