"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { buildPdfEditorState, DEFAULT_PDF_VIEWPORT_ANCHOR } from "@/lib/pdf-view-state";
import { buildPersistedFileViewStateKey, deletePersistedFileViewState } from "@/lib/file-view-state";
import { createUniversalAnnotationFile, generateFileId, saveAnnotationsToDisk } from "@/lib/universal-annotation-storage";
import { deletePdfItemWorkspace } from "@/lib/pdf-item";

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
  plain: PdfFixture;
}

interface PaneSnapshot {
  zoom: string | null;
  scrollTop: number;
  scrollLeft: number;
  visiblePage: number | null;
  anchorPage: number | null;
  anchorTopRatio: number | null;
  anchorLeftRatio: number | null;
  restoreStatus: string | null;
  restoreOk: string | null;
  restoreDeltaTop: number | null;
  restoreDeltaLeft: number | null;
  selectionPhase: string | null;
  selectionSource: string | null;
  selectionPreview: string | null;
  selectionPageCount: number | null;
  copyPayload: string | null;
}

function resolveZoomState(zoomLabel: string | null): { zoomMode: "manual" | "fit-width" | "fit-page"; scale: number } {
  if (zoomLabel === "适宽") {
    return { zoomMode: "fit-width", scale: 1 };
  }
  if (zoomLabel === "适页") {
    return { zoomMode: "fit-page", scale: 1 };
  }

  const numeric = Number((zoomLabel ?? "").replace("%", ""));
  return {
    zoomMode: "manual",
    scale: Number.isFinite(numeric) && numeric > 0 ? numeric / 100 : 1,
  };
}

function findMostScrollableElement(scope: ParentNode | null): HTMLElement | null {
  if (!scope) {
    return null;
  }

  const candidates = Array.from(scope.querySelectorAll<HTMLElement>("*"));
  candidates.sort((left, right) => {
    const leftOverflow = (left.scrollHeight - left.clientHeight) + (left.scrollWidth - left.clientWidth);
    const rightOverflow = (right.scrollHeight - right.clientHeight) + (right.scrollWidth - right.clientWidth);
    return rightOverflow - leftOverflow;
  });

  return candidates[0] ?? null;
}

function getPdfDiagnosticsScrollContainer(shell: ParentNode | null, paneId: string): HTMLElement | null {
  if (!shell) {
    return null;
  }

  const preferred = document.querySelector<HTMLElement>(`[data-testid="pdf-viewer-container-${paneId}"]`)
    ?? shell.querySelector<HTMLElement>(`[data-testid="pdf-scroll-container-${paneId}"]`);

  return preferred ?? findMostScrollableElement(shell);
}

function PaneStateCard({ title, snapshot, paneTestId }: { title: string; snapshot: PaneSnapshot | null; paneTestId: string }) {
  return (
    <div className="rounded-lg border border-border p-3 text-xs leading-6">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div>Zoom: <span data-testid={`${paneTestId}-zoom`}>{snapshot?.zoom ?? "未就绪"}</span></div>
      <div>ScrollTop: <span data-testid={`${paneTestId}-scroll-top`}>{Math.round(snapshot?.scrollTop ?? 0)}</span></div>
      <div>ScrollLeft: <span data-testid={`${paneTestId}-scroll-left`}>{Math.round(snapshot?.scrollLeft ?? 0)}</span></div>
      <div>Visible Page: <span data-testid={`${paneTestId}-visible-page`}>{snapshot?.visiblePage ?? 0}</span></div>
      <div>Anchor Page: <span data-testid={`${paneTestId}-anchor-page`}>{snapshot?.anchorPage ?? 0}</span></div>
      <div>Restore Status: <span data-testid={`${paneTestId}-restore-status`}>{snapshot?.restoreStatus ?? "未就绪"}</span></div>
      <div>Restore OK: <span data-testid={`${paneTestId}-restore-ok`}>{snapshot?.restoreOk ?? "false"}</span></div>
      <div>Anchor Delta Top: <span data-testid={`${paneTestId}-restore-delta-top`}>{snapshot?.restoreDeltaTop ?? -1}</span></div>
      <div>Anchor Delta Left: <span data-testid={`${paneTestId}-restore-delta-left`}>{snapshot?.restoreDeltaLeft ?? -1}</span></div>
      <div>Selection Phase: <span data-testid={`${paneTestId}-selection-phase`}>{snapshot?.selectionPhase ?? "未就绪"}</span></div>
      <div>Selection Source: <span data-testid={`${paneTestId}-selection-source`}>{snapshot?.selectionSource ?? "none"}</span></div>
      <div>Selection Pages: <span data-testid={`${paneTestId}-selection-page-count`}>{snapshot?.selectionPageCount ?? 0}</span></div>
      <div>Copy Payload: <span data-testid={`${paneTestId}-copy-payload`}>{snapshot?.copyPayload ?? ""}</span></div>
    </div>
  );
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

export function PdfRegressionDiagnostics() {
  const imageHandleHref = resolveAppRoute("/diagnostics/image-annotation");
  const selectionHref = resolveAppRoute("/diagnostics/selection-ai");
  const [workspace, setWorkspace] = useState<DiagnosticsWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rightVariant, setRightVariant] = useState<"a" | "b">("a");
  const [compactLayout, setCompactLayout] = useState(false);
  const [leftSnapshot, setLeftSnapshot] = useState<PaneSnapshot | null>(null);
  const [rightSnapshot, setRightSnapshot] = useState<PaneSnapshot | null>(null);

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
        const plainFileId = `${sessionId}-plain`;

        const [leftBuffer, rightABuffer, rightBBuffer, plainBuffer] = await Promise.all([
          createSamplePdfBuffer("Left regression fixture"),
          createSamplePdfBuffer("Right regression fixture A"),
          createSamplePdfBuffer("Right regression fixture B"),
          createSamplePdfBuffer("Plain routing fixture", 4),
        ]);

        const [leftHandle, rightAHandle, rightBHandle, plainHandle] = await Promise.all([
          writeArrayBufferFile(pdfDirectory, "left-fixture.pdf", leftBuffer),
          writeArrayBufferFile(pdfDirectory, "right-fixture-a.pdf", rightABuffer),
          writeArrayBufferFile(pdfDirectory, "right-fixture-b.pdf", rightBBuffer),
          writeArrayBufferFile(pdfDirectory, "plain-fixture.pdf", plainBuffer),
        ]);

        await Promise.all([
          seedPdfAnnotation(rootHandle, generateFileId("pdf/left-fixture.pdf"), 1),
          seedPdfAnnotation(rootHandle, generateFileId("pdf/right-fixture-a.pdf"), 1),
          seedPdfAnnotation(rootHandle, generateFileId("pdf/right-fixture-b.pdf"), 2),
        ]);
        await deletePdfItemWorkspace(rootHandle, "pdf/plain-fixture.pdf");

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
          buildPersistedFileViewStateKey({
            kind: "pdf",
            workspaceRootPath,
            filePath: "pdf/plain-fixture.pdf",
            fallbackName: "plain-fixture.pdf",
          }),
        ];

        await Promise.all(persistedKeys.map((key) => deletePersistedFileViewState(key)));
        const contentCache = useContentCacheStore.getState();
        contentCache.clearCache();

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
          plain: {
            fileId: plainFileId,
            fileName: "plain-fixture.pdf",
            filePath: "pdf/plain-fixture.pdf",
            content: plainBuffer,
            fileHandle: plainHandle,
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

  useEffect(() => {
    const timer = window.setInterval(() => {
      const readSnapshot = (paneId: string): PaneSnapshot | null => {
        const zoomLabel = document.querySelector<HTMLElement>(`[data-testid="pdf-zoom-label-${paneId}"]`);
        const shell = document.querySelector<HTMLElement>(`[data-testid="${paneId === "pdf-left-pane" ? "pdf-left-shell" : "pdf-right-shell"}"]`);
        const scrollContainer = getPdfDiagnosticsScrollContainer(shell, paneId);
        const anchorPage = document.querySelector<HTMLElement>(`[data-testid="pdf-anchor-page-${paneId}"]`);
        const anchorTopRatio = document.querySelector<HTMLElement>(`[data-testid="pdf-anchor-top-ratio-${paneId}"]`);
        const anchorLeftRatio = document.querySelector<HTMLElement>(`[data-testid="pdf-anchor-left-ratio-${paneId}"]`);
        const restoreStatus = document.querySelector<HTMLElement>(`[data-testid="pdf-restore-status-${paneId}"]`);
        const restoreOk = document.querySelector<HTMLElement>(`[data-testid="pdf-restore-ok-${paneId}"]`);
        const restoreDeltaTop = document.querySelector<HTMLElement>(`[data-testid="pdf-restore-delta-top-${paneId}"]`);
        const restoreDeltaLeft = document.querySelector<HTMLElement>(`[data-testid="pdf-restore-delta-left-${paneId}"]`);
        const selectionPhase = document.querySelector<HTMLElement>(`[data-testid="pdf-selection-phase-${paneId}"]`);
        const selectionSource = document.querySelector<HTMLElement>(`[data-testid="pdf-selection-source-${paneId}"]`);
        const selectionPreview = document.querySelector<HTMLElement>(`[data-testid="pdf-selection-preview-${paneId}"]`);
        const selectionPageCount = document.querySelector<HTMLElement>(`[data-testid="pdf-selection-page-count-${paneId}"]`);
        const copyPayload = document.querySelector<HTMLElement>(`[data-testid="pdf-copy-payload-${paneId}"]`);
        if (!zoomLabel || !scrollContainer || !shell) {
          return null;
        }

        const visiblePage = Array.from(shell.querySelectorAll<HTMLElement>("[data-page-number]")).find((page) => {
          const pageRect = page.getBoundingClientRect();
          const shellRect = shell.getBoundingClientRect();
          return pageRect.bottom > shellRect.top + 48 && pageRect.top < shellRect.bottom - 48;
        });

        return {
          zoom: zoomLabel.textContent,
          scrollTop: scrollContainer.scrollTop,
          scrollLeft: scrollContainer.scrollLeft,
          visiblePage: visiblePage?.dataset.pageNumber ? Number(visiblePage.dataset.pageNumber) : null,
          anchorPage: anchorPage?.textContent ? Number(anchorPage.textContent) : null,
          anchorTopRatio: anchorTopRatio?.textContent ? Number(anchorTopRatio.textContent) : null,
          anchorLeftRatio: anchorLeftRatio?.textContent ? Number(anchorLeftRatio.textContent) : null,
          restoreStatus: restoreStatus?.textContent ?? null,
          restoreOk: restoreOk?.textContent ?? null,
          restoreDeltaTop: restoreDeltaTop?.textContent ? Number(restoreDeltaTop.textContent) : null,
          restoreDeltaLeft: restoreDeltaLeft?.textContent ? Number(restoreDeltaLeft.textContent) : null,
          selectionPhase: selectionPhase?.textContent ?? null,
          selectionSource: selectionSource?.textContent ?? null,
          selectionPreview: selectionPreview?.textContent ?? null,
          selectionPageCount: selectionPageCount?.textContent ? Number(selectionPageCount.textContent) : null,
          copyPayload: copyPayload?.textContent ?? null,
        };
      };

      setLeftSnapshot(readSnapshot("pdf-left-pane"));
      setRightSnapshot(readSnapshot("pdf-right-pane"));
    }, 250);

    return () => window.clearInterval(timer);
  }, []);

  const rightFixture = useMemo(() => {
    if (!workspace) {
      return null;
    }
    return rightVariant === "a" ? workspace.rightA : workspace.rightB;
  }, [rightVariant, workspace]);

  const scrollPaneToPage = (shellTestId: string, pageNumber: number) => {
    let attemptsLeft = 120;

    const attemptScroll = () => {
      const shell = document.querySelector<HTMLElement>(`[data-testid="${shellTestId}"]`);
      const scrollContainer = getPdfDiagnosticsScrollContainer(shell, "pdf-right-pane");
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

  const persistRightSnapshot = useCallback(() => {
    const currentFixture = rightVariant === "a" ? workspace?.rightA : workspace?.rightB;
    if (!currentFixture) {
      return;
    }

    const readValue = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.textContent?.trim() ?? null;
    const shell = document.querySelector<HTMLElement>('[data-testid="pdf-right-shell"]');
    const scrollContainer = getPdfDiagnosticsScrollContainer(shell, "pdf-right-pane");
    const domSnapshot: PaneSnapshot = {
      zoom: readValue("pdf-zoom-label-pdf-right-pane") ?? readValue("pdf-right-state-zoom"),
      scrollTop: scrollContainer?.scrollTop ?? Number(readValue("pdf-right-state-scroll-top") ?? "0"),
      scrollLeft: scrollContainer?.scrollLeft ?? Number(readValue("pdf-right-state-scroll-left") ?? "0"),
      visiblePage: Number(readValue("pdf-right-state-visible-page") ?? "0") || null,
      anchorPage: Number(readValue("pdf-anchor-page-pdf-right-pane") ?? readValue("pdf-right-state-anchor-page") ?? "0") || null,
      anchorTopRatio: readValue("pdf-anchor-top-ratio-pdf-right-pane") ? Number(readValue("pdf-anchor-top-ratio-pdf-right-pane")) : null,
      anchorLeftRatio: readValue("pdf-anchor-left-ratio-pdf-right-pane") ? Number(readValue("pdf-anchor-left-ratio-pdf-right-pane")) : null,
      restoreStatus: readValue("pdf-right-state-restore-status"),
      restoreOk: readValue("pdf-right-state-restore-ok"),
      restoreDeltaTop: Number(readValue("pdf-right-state-restore-delta-top") ?? "-1"),
      restoreDeltaLeft: Number(readValue("pdf-right-state-restore-delta-left") ?? "-1"),
      selectionPhase: readValue("pdf-right-state-selection-phase"),
      selectionSource: readValue("pdf-right-state-selection-source"),
      selectionPreview: readValue("pdf-right-state-selection-preview"),
      selectionPageCount: Number(readValue("pdf-right-state-selection-page-count") ?? "0") || null,
      copyPayload: readValue("pdf-right-state-copy-payload"),
    };

    const snapshot = (
      domSnapshot.anchorPage &&
      domSnapshot.anchorTopRatio !== null &&
      domSnapshot.anchorLeftRatio !== null
    )
      ? domSnapshot
      : rightSnapshot;
    if (
      !snapshot?.anchorPage ||
      snapshot.anchorTopRatio === null ||
      snapshot.anchorLeftRatio === null
    ) {
      return;
    }

    const { zoomMode, scale } = resolveZoomState(snapshot.zoom);
    useContentCacheStore.getState().saveEditorState(currentFixture.fileId, buildPdfEditorState({
      scale,
      zoomMode,
      showSidebar: false,
      anchor: {
        pageNumber: snapshot.anchorPage,
        pageOffsetTopRatio: snapshot.anchorTopRatio ?? 0,
        pageOffsetLeftRatio: snapshot.anchorLeftRatio ?? 0,
        viewportAnchorX: DEFAULT_PDF_VIEWPORT_ANCHOR.x,
        viewportAnchorY: DEFAULT_PDF_VIEWPORT_ANCHOR.y,
        captureRevision: 0,
      },
      scrollTop: snapshot.scrollTop,
      scrollLeft: snapshot.scrollLeft,
    }));
  }, [rightSnapshot, rightVariant, workspace]);

  if (error) {
    return <div className="p-6 text-sm text-destructive">{error}</div>;
  }

  if (!workspace || !rightFixture) {
    return <div className="p-6 text-sm text-muted-foreground">正在准备 PDF regression fixtures…</div>;
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground" data-testid="pdf-regression-ready">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-medium">PDF Split Regression</h1>
          <p className="text-xs text-muted-foreground">
            用于验证双分屏布局、pane 作用域缩放、阅读位置保持和切文件恢复。
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
            激活左侧
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
            激活右侧
          </button>
          <button
            type="button"
            data-testid="toggle-right-file"
            onClick={() => {
              try {
                persistRightSnapshot();
              } catch (error) {
                console.error("Failed to persist right snapshot before switching fixture:", error);
              }
              setRightVariant((value) => value === "a" ? "b" : "a");
            }}
            className="rounded border border-border px-3 py-1 hover:bg-muted"
          >
            切换右侧文件
          </button>
          <button
            type="button"
            data-testid="scroll-right-to-page-6"
            onClick={() => scrollPaneToPage("pdf-right-shell", 6)}
            className="rounded border border-border px-3 py-1 hover:bg-muted"
          >
            右侧跳到第 6 页
          </button>
          <button
            type="button"
            data-testid="toggle-pdf-compact-layout"
            onClick={() => setCompactLayout((value) => !value)}
            className="rounded border border-border px-3 py-1 hover:bg-muted"
          >
            切换紧凑布局
          </button>
          <Link href={imageHandleHref} className="rounded border border-border px-3 py-1 hover:bg-muted">
            图片句柄诊断
          </Link>
          <Link href={selectionHref} className="rounded border border-border px-3 py-1 hover:bg-muted">
            Selection AI 诊断
          </Link>
        </div>
      </header>

      <main className={`grid min-h-0 flex-1 gap-3 overflow-hidden p-3 ${compactLayout ? "grid-cols-[1fr_0.82fr_0.7fr_320px]" : "grid-cols-[1fr_1fr_0.85fr_320px]"}`}>
        <section className="min-h-0 overflow-hidden rounded-xl border border-border" data-testid="pdf-left-shell">
          <UniversalFileViewer
            key={workspace.left.fileId}
            paneId="pdf-left-pane"
            handle={workspace.left.fileHandle}
            rootHandle={workspace.rootHandle}
            content={workspace.left.content}
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
            content={rightFixture.content}
            isLoading={false}
            error={null}
            fileId={rightFixture.fileId}
            filePath={rightFixture.filePath}
          />
        </section>

        <section className="min-h-0 overflow-hidden rounded-xl border border-border" data-testid="pdf-plain-shell">
          <UniversalFileViewer
            key={workspace.plain.fileId}
            paneId="pdf-plain-pane"
            handle={workspace.plain.fileHandle}
            rootHandle={workspace.rootHandle}
            content={workspace.plain.content}
            isLoading={false}
            error={null}
            fileId={workspace.plain.fileId}
            filePath={workspace.plain.filePath}
          />
        </section>

        <aside className="space-y-3 overflow-auto rounded-xl border border-border p-3 text-xs text-muted-foreground">
          <div className="rounded-lg border border-dashed border-border p-3 leading-6">
            右侧当前文件：<span data-testid="right-file-indicator">{rightFixture.fileName}</span>
            <br />
            浏览器回归会验证：
            <br />
            1. 右侧 pane 不超出屏幕
            <br />
            2. 键盘/滚轮只作用于当前 pane
            <br />
            3. 缩放与适宽后阅读位置保持
            <br />
            4. 切走再切回恢复进度
            <br />
            5. 紧凑布局切换后 anchor 不漂移
            <br />
            6. 原生拖选后 transient overlay 不整页染蓝
            <br />
            7. 取消/提交 transient selection 后残影会清掉
            <br />
            8. 复制优先使用原生选区文本
            <br />
            9. 暗色模式下 PDF 页面与 chrome 对比正常
          </div>
          <PaneStateCard title="左侧 pane" snapshot={leftSnapshot} paneTestId="pdf-left-state" />
          <PaneStateCard title="右侧 pane" snapshot={rightSnapshot} paneTestId="pdf-right-state" />
        </aside>
      </main>
    </div>
  );
}
