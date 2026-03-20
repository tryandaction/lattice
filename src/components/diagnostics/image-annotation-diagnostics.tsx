"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ImageTldrawAdapter } from "@/components/renderers/image-tldraw-adapter";
import { resolveAppRoute } from "@/lib/app-route";
import {
  ensureSubdirectory,
  getDiagnosticsWorkspaceHandle,
  loadPublicAssetBuffer,
  writeArrayBufferFile,
} from "./browser-regression-utils";
import { deserializeAnnotationFile, ensureAnnotationsDirectory, generateFileId } from "@/lib/universal-annotation-storage";

interface ImageWorkspaceState {
  rootHandle: FileSystemDirectoryHandle;
  fileHandle: FileSystemFileHandle;
  filePath: string;
  content: ArrayBuffer;
  mimeType: string;
}

interface ImageDiagnosticsSnapshot {
  isReady: boolean;
  shapeCount: number;
  annotationId: string | null;
}

export function ImageAnnotationDiagnostics() {
  const imageViewerHref = resolveAppRoute("/diagnostics/image-viewer");
  const pdfRegressionHref = resolveAppRoute("/diagnostics/pdf-regression");
  const [workspace, setWorkspace] = useState<ImageWorkspaceState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderNonce, setRenderNonce] = useState(0);
  const [sampleNonce, setSampleNonce] = useState(0);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [adapterSnapshot, setAdapterSnapshot] = useState<ImageDiagnosticsSnapshot>({
    isReady: false,
    shapeCount: 0,
    annotationId: null,
  });
  const [sidecarSummary, setSidecarSummary] = useState<{
    fileId: string;
    annotationCount: number;
    hasImageAnnotation: boolean;
  } | null>(null);

  useEffect(() => {
    let disposed = false;

    const setup = async () => {
      try {
        const content = await loadPublicAssetBuffer("/icons/icon-512x512.png");
        const rootHandle = await getDiagnosticsWorkspaceHandle();
        const figuresDirectory = await ensureSubdirectory(rootHandle, "figures");
        const fileHandle = await writeArrayBufferFile(figuresDirectory, "diagnostic-figure.png", content);

        if (disposed) {
          return;
        }

        setWorkspace({
          rootHandle,
          fileHandle,
          filePath: "figures/diagnostic-figure.png",
          content,
          mimeType: "image/png",
        });
        setLoadedAt(Date.now());
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

  if (error) {
    return <div className="p-6 text-sm text-destructive">{error}</div>;
  }

  if (!workspace) {
    return <div className="p-6 text-sm text-muted-foreground">正在准备 image annotation diagnostics workspace…</div>;
  }

  const readSidecarState = async () => {
    const fileId = generateFileId(workspace.filePath);

    try {
      const annotationsDir = await ensureAnnotationsDirectory(workspace.rootHandle);
      const sidecarHandle = await annotationsDir.getFileHandle(`${fileId}.json`);
      const content = await (await sidecarHandle.getFile()).text();
      const parsed = deserializeAnnotationFile(content);
      setSidecarSummary({
        fileId,
        annotationCount: parsed?.annotations.length ?? 0,
        hasImageAnnotation: !!parsed?.annotations.some((annotation) => annotation.target.type === "image"),
      });
    } catch {
      setSidecarSummary({
        fileId,
        annotationCount: 0,
        hasImageAnnotation: false,
      });
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground" data-testid="image-annotation-ready">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-medium">Image Annotation Handle Diagnostics</h1>
          <p className="text-xs text-muted-foreground">
            使用 OPFS workspace file handle 验证图片标注链路、重渲染稳定性与 sidecar 派生路径。
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2 text-xs">
          <button
            type="button"
            data-testid="create-image-sample-annotation"
            onClick={() => setSampleNonce((value) => value + 1)}
            className="rounded border border-border px-3 py-1 hover:bg-muted"
          >
            创建样例标注
          </button>
          <button
            type="button"
            data-testid="read-image-annotation-sidecar"
            onClick={() => void readSidecarState()}
            className="rounded border border-border px-3 py-1 hover:bg-muted"
          >
            读取 sidecar
          </button>
          <button
            type="button"
            data-testid="force-image-annotation-remount"
            onClick={() => setRenderNonce((value) => value + 1)}
            className="rounded border border-border px-3 py-1 hover:bg-muted"
          >
            重新挂载
          </button>
          <Link href={imageViewerHref} className="rounded border border-border px-3 py-1 hover:bg-muted">
            图片显示诊断
          </Link>
          <Link href={pdfRegressionHref} className="rounded border border-border px-3 py-1 hover:bg-muted">
            PDF 分屏诊断
          </Link>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[1fr_320px] gap-3 overflow-hidden p-3">
        <section className="min-h-0 overflow-hidden rounded-xl border border-border">
          <ImageTldrawAdapter
            key={`${workspace.filePath}:${renderNonce}`}
            content={workspace.content}
            fileName="diagnostic-figure.png"
            mimeType={workspace.mimeType}
            fileHandle={workspace.fileHandle}
            rootHandle={workspace.rootHandle}
            filePath={workspace.filePath}
            diagnosticsSampleNonce={sampleNonce}
            onDiagnosticsSnapshot={setAdapterSnapshot}
          />
        </section>

        <aside className="space-y-3 overflow-auto rounded-xl border border-border p-3 text-xs text-muted-foreground">
          <div className="rounded-lg border border-dashed border-border p-3 leading-6">
            workspace root：<span data-testid="image-workspace-name">{workspace.rootHandle.name}</span>
            <br />
            file path：<span data-testid="image-workspace-path">{workspace.filePath}</span>
            <br />
            已加载时间：{loadedAt ? new Date(loadedAt).toLocaleTimeString() : "未加载"}
            <br />
            重挂载次数：<span data-testid="image-annotation-rerender-count">{renderNonce}</span>
            <br />
            当前 shape 数：<span data-testid="image-annotation-shape-count">{adapterSnapshot.shapeCount}</span>
            <br />
            当前 annotationId：<span data-testid="image-annotation-current-id">{adapterSnapshot.annotationId ?? "无"}</span>
            <br />
            Adapter Ready：<span data-testid="image-annotation-adapter-ready">{adapterSnapshot.isReady ? "true" : "false"}</span>
          </div>
          <div className="rounded-lg border border-border p-3 leading-6">
            浏览器回归会验证：
            <br />
            1. 使用真实 workspace handle 成功加载
            <br />
            2. 创建样例标注并触发 sidecar 保存
            <br />
            3. 强制重挂载后样例标注仍恢复
            <br />
            4. 不出现图片/画布初始化错误
          </div>
          <div className="rounded-lg border border-border p-3 leading-6">
            Sidecar fileId：<span data-testid="image-annotation-sidecar-fileid">{sidecarSummary?.fileId ?? "未读取"}</span>
            <br />
            Sidecar annotation 数：<span data-testid="image-annotation-sidecar-count">{sidecarSummary?.annotationCount ?? 0}</span>
            <br />
            Sidecar 含 image target：<span data-testid="image-annotation-sidecar-has-image">{sidecarSummary?.hasImageAnnotation ? "true" : "false"}</span>
          </div>
        </aside>
      </main>
    </div>
  );
}
