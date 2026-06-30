"use client";

import { useEffect } from "react";
import { detectErrorPageLocale, getErrorPageCopy } from "@/lib/error-page-i18n";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: GlobalErrorProps) {
  const locale = detectErrorPageLocale();
  const copy = getErrorPageCopy(locale);

  useEffect(() => {
    console.error("[App Error]", error);
  }, [error]);

  const handleClearStorage = () => {
    const confirmed = window.confirm(copy.clearStorageConfirm);
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
    <div className="min-h-screen bg-background text-foreground" lang={locale}>
      <div className="flex min-h-screen flex-col items-center justify-center p-6">
        <div className="w-full max-w-2xl space-y-4">
          <h1 className="text-xl font-semibold">{copy.title}</h1>
          <p className="text-sm text-muted-foreground">{copy.description}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="rounded-md bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {copy.reload}
            </button>
            <button
              type="button"
              onClick={handleClearStorage}
              className="rounded-md border border-border px-4 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {copy.clearStorage}
            </button>
          </div>
          <details className="rounded-md border border-border bg-muted/30 p-3">
            <summary className="cursor-pointer text-xs text-muted-foreground">{copy.technicalDetails}</summary>
            <pre className="mt-2 whitespace-pre-wrap text-xs">
              {error?.stack || error?.message || "No stack trace available"}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}
