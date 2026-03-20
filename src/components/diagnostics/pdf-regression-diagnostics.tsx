"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PDFHighlighterAdapter } from "@/components/renderers/pdf-highlighter-adapter";
import { resolveAppRoute } from "@/lib/app-route";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { createEmptyPane } from "@/lib/layout-utils";
import {
  createSamplePdfBuffer,
  ensureSubdirectory,
  getDiagnosticsWorkspaceHandle,
  writeArrayBufferFile,
} from "./browser-regression-utils";

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
    </div>
  );
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

        const [leftBuffer, rightABuffer, rightBBuffer] = await Promise.all([
          createSamplePdfBuffer("Left regression fixture"),
          createSamplePdfBuffer("Right regression fixture A"),
          createSamplePdfBuffer("Right regression fixture B"),
        ]);

        const [leftHandle, rightAHandle, rightBHandle] = await Promise.all([
          writeArrayBufferFile(pdfDirectory, "left-fixture.pdf", leftBuffer),
          writeArrayBufferFile(pdfDirectory, "right-fixture-a.pdf", rightABuffer),
          writeArrayBufferFile(pdfDirectory, "right-fixture-b.pdf", rightBBuffer),
        ]);

        if (disposed) {
          return;
        }

        useWorkspaceStore.setState({
          layout: {
            root: createEmptyPane("pdf-left-pane"),
            activePaneId: "pdf-left-pane",
          },
        });

        setWorkspace({
          rootHandle,
          left: {
            fileId: "diagnostics-pdf-left",
            fileName: "left-fixture.pdf",
            filePath: "pdf/left-fixture.pdf",
            content: leftBuffer,
            fileHandle: leftHandle,
          },
          rightA: {
            fileId: "diagnostics-pdf-right-a",
            fileName: "right-fixture-a.pdf",
            filePath: "pdf/right-fixture-a.pdf",
            content: rightABuffer,
            fileHandle: rightAHandle,
          },
          rightB: {
            fileId: "diagnostics-pdf-right-b",
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

  useEffect(() => {
    const timer = window.setInterval(() => {
      const readSnapshot = (paneId: string): PaneSnapshot | null => {
        const zoomLabel = document.querySelector<HTMLElement>(`[data-testid="pdf-zoom-label-${paneId}"]`);
        const scrollContainer = document.querySelector<HTMLElement>(`[data-testid="pdf-viewer-container-${paneId}"]`)
          ?? document.querySelector<HTMLElement>(`[data-testid="pdf-scroll-container-${paneId}"]`);
        const shell = document.querySelector<HTMLElement>(`[data-testid="${paneId === "pdf-left-pane" ? "pdf-left-shell" : "pdf-right-shell"}"]`);
        const anchorPage = document.querySelector<HTMLElement>(`[data-testid="pdf-anchor-page-${paneId}"]`);
        const anchorTopRatio = document.querySelector<HTMLElement>(`[data-testid="pdf-anchor-top-ratio-${paneId}"]`);
        const anchorLeftRatio = document.querySelector<HTMLElement>(`[data-testid="pdf-anchor-left-ratio-${paneId}"]`);
        const restoreStatus = document.querySelector<HTMLElement>(`[data-testid="pdf-restore-status-${paneId}"]`);
        const restoreOk = document.querySelector<HTMLElement>(`[data-testid="pdf-restore-ok-${paneId}"]`);
        const restoreDeltaTop = document.querySelector<HTMLElement>(`[data-testid="pdf-restore-delta-top-${paneId}"]`);
        const restoreDeltaLeft = document.querySelector<HTMLElement>(`[data-testid="pdf-restore-delta-left-${paneId}"]`);
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
    const shell = document.querySelector<HTMLElement>(`[data-testid="${shellTestId}"]`);
    const page = shell?.querySelector<HTMLElement>(`[data-page-number="${pageNumber}"]`);
    page?.scrollIntoView({ behavior: "auto", block: "center" });
  };

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
            onClick={() => setRightVariant((value) => value === "a" ? "b" : "a")}
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

      <main className={`grid min-h-0 flex-1 gap-3 overflow-hidden p-3 ${compactLayout ? "grid-cols-[1fr_0.82fr_320px]" : "grid-cols-[1fr_1fr_320px]"}`}>
        <section className="min-h-0 overflow-hidden rounded-xl border border-border" data-testid="pdf-left-shell">
          <PDFHighlighterAdapter
            content={workspace.left.content}
            fileName={workspace.left.fileName}
            fileHandle={workspace.left.fileHandle}
            rootHandle={workspace.rootHandle}
            paneId="pdf-left-pane"
            fileId={workspace.left.fileId}
            filePath={workspace.left.filePath}
          />
        </section>

        <section className="min-h-0 overflow-hidden rounded-xl border border-border" data-testid="pdf-right-shell">
          <PDFHighlighterAdapter
            content={rightFixture.content}
            fileName={rightFixture.fileName}
            fileHandle={rightFixture.fileHandle}
            rootHandle={workspace.rootHandle}
            paneId="pdf-right-pane"
            fileId={rightFixture.fileId}
            filePath={rightFixture.filePath}
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
          </div>
          <PaneStateCard title="左侧 pane" snapshot={leftSnapshot} paneTestId="pdf-left-state" />
          <PaneStateCard title="右侧 pane" snapshot={rightSnapshot} paneTestId="pdf-right-state" />
        </aside>
      </main>
    </div>
  );
}
