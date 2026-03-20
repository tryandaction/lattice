"use client";

import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import { ImageViewer } from "@/components/renderers/image-viewer";
import { resolveAppRoute } from "@/lib/app-route";

interface AssetOption {
  id: string;
  label: string;
  url: string;
  mimeType: string;
}

const ASSETS: AssetOption[] = [
  {
    id: "image",
    label: "Icon 512",
    url: "/icons/icon-512x512.png",
    mimeType: "image/png",
  },
  {
    id: "favicon",
    label: "Apple Touch",
    url: "/apple-touch-icon.png",
    mimeType: "image/png",
  },
];

export function ImageRendererDiagnostics() {
  const guideHref = resolveAppRoute("/guide");
  const imageAnnotationHref = resolveAppRoute("/diagnostics/image-annotation");
  const pdfRegressionHref = resolveAppRoute("/diagnostics/pdf-regression");
  const [selectedId, setSelectedId] = useState(ASSETS[0].id);
  const [content, setContent] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [renderNonce, setRenderNonce] = useState(0);
  const [heartbeatCount, setHeartbeatCount] = useState(0);
  const [lastHeartbeatOkAt, setLastHeartbeatOkAt] = useState<number | null>(null);
  const [lastHeartbeatState, setLastHeartbeatState] = useState<{
    visible: boolean;
    naturalWidth: number;
    naturalHeight: number;
    src: string | null;
  } | null>(null);

  const selected = ASSETS.find((asset) => asset.id === selectedId) ?? ASSETS[0];

  useEffect(() => {
    let alive = true;
    startTransition(() => {
      setContent(null);
      setError(null);
      setLoadedAt(null);
    });

    fetch(selected.url)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load ${selected.url}: ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (!alive) return;
        setContent(buffer);
        setLoadedAt(Date.now());
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      alive = false;
    };
  }, [selected.url]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const image = document.querySelector<HTMLImageElement>('img[alt]');
      const visible = Boolean(image && image.isConnected && image.naturalWidth > 0 && image.naturalHeight > 0);

      startTransition(() => {
        setHeartbeatCount((value) => value + 1);
        setLastHeartbeatState({
          visible,
          naturalWidth: image?.naturalWidth ?? 0,
          naturalHeight: image?.naturalHeight ?? 0,
          src: image?.getAttribute('src') ?? null,
        });
        if (visible) {
          setLastHeartbeatOkAt(Date.now());
        }
      });
    }, 2000);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-medium">Image Renderer Diagnostics</h1>
          <p className="text-xs text-muted-foreground">
            用于验证图片在真实页面里是否会在加载后消失。
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {ASSETS.map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => setSelectedId(asset.id)}
              className={`rounded px-2 py-1 ${asset.id === selectedId ? "bg-muted text-foreground" : "hover:bg-muted/50"}`}
            >
              {asset.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setRenderNonce((value) => value + 1)}
            className="rounded border border-border px-3 py-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            强制重渲染
          </button>
          <Link
            href={imageAnnotationHref}
            className="rounded border border-border px-3 py-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            图片句柄诊断
          </Link>
          <Link
            href={pdfRegressionHref}
            className="rounded border border-border px-3 py-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            PDF 分屏诊断
          </Link>
          <Link
            href={guideHref}
            className="rounded border border-border px-3 py-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            用户指南
          </Link>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        <section className="flex-1 overflow-hidden">
          {error ? (
            <div className="p-4 text-sm text-destructive">{error}</div>
          ) : content ? (
            <ImageViewer
              key={`${selected.id}:${renderNonce}`}
              content={content}
              fileName={selected.url.replace(/^\//, "")}
              mimeType={selected.mimeType}
            />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">加载中...</div>
          )}
        </section>

        <aside className="w-80 border-l border-border p-4 text-xs text-muted-foreground">
          <div className="text-sm font-medium text-foreground">诊断信息</div>
          <div className="mt-3 space-y-2">
            <div>当前资源：{selected.url}</div>
            <div>Mime Type：{selected.mimeType}</div>
            <div>已加载时间：{loadedAt ? new Date(loadedAt).toLocaleTimeString() : "未加载"}</div>
            <div>重渲染次数：{renderNonce}</div>
            <div>心跳次数：{heartbeatCount}</div>
            <div>最后成功心跳：{lastHeartbeatOkAt ? new Date(lastHeartbeatOkAt).toLocaleTimeString() : "尚未检测到有效图片"}</div>
            <div>当前检测：{lastHeartbeatState?.visible ? "图片可见" : "图片不可见"}</div>
            <div>当前尺寸：{lastHeartbeatState ? `${lastHeartbeatState.naturalWidth} × ${lastHeartbeatState.naturalHeight}` : "未知"}</div>
            <div className="break-all">当前 src：{lastHeartbeatState?.src ?? "未记录"}</div>
            <div className="rounded border border-dashed border-border p-3 leading-6">
              如果图片会在几秒后消失，这个页面最容易复现。保持页面停留一段时间，观察图片是否仍持续可见。
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
