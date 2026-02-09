"use client";

import { useEffect } from "react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error("[App Error]", error);
  }, [error]);

  const handleClearStorage = () => {
    const confirmed = window.confirm(
      "⚠️ 危险操作检测！\n操作类型：清空本地缓存\n影响范围：本地设置/插件缓存/临时状态\n风险评估：将丢失本地偏好设置，需要重新配置\n\n请确认是否继续？"
    );
    if (!confirmed) return;
    try {
      localStorage.clear();
      sessionStorage.clear();
      if ("caches" in window) {
        void caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))));
      }
    } catch (err) {
      console.warn("Failed to clear storage", err);
    } finally {
      window.location.reload();
    }
  };

  return (
    <html lang="zh-CN">
      <body className="bg-background text-foreground">
        <div className="min-h-screen flex flex-col items-center justify-center p-6">
          <div className="max-w-2xl w-full space-y-4">
            <h1 className="text-xl font-semibold">应用加载失败</h1>
            <p className="text-sm text-muted-foreground">
              检测到客户端运行时异常。请先尝试刷新或清空本地缓存。
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={reset}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                重新加载
              </button>
              <button
                onClick={handleClearStorage}
                className="px-4 py-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                清空本地缓存并重载
              </button>
            </div>
            <details className="rounded-md border border-border bg-muted/30 p-3">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                技术详情
              </summary>
              <pre className="mt-2 whitespace-pre-wrap text-xs">
                {error?.stack || error?.message || "No stack trace available"}
              </pre>
            </details>
          </div>
        </div>
      </body>
    </html>
  );
}
