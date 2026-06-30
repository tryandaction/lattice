"use client";

import { useEffect, useState } from "react";
import { X, Download, Zap, FolderOpen, Gauge } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { isTauriHost } from "@/lib/storage-adapter";

export function DownloadAppDialog() {
  const { t } = useI18n();
  const isDesktopApp = isTauriHost();
  const [isOpen, setIsOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    if (isDesktopApp) return;

    const dismissed = localStorage.getItem("lattice-download-dismissed");
    if (dismissed === "true") return;

    const timer = setTimeout(() => {
      setIsOpen(true);
    }, 2000);

    return () => clearTimeout(timer);
  }, [isDesktopApp]);

  const handleClose = () => {
    if (dontShowAgain) {
      localStorage.setItem("lattice-download-dismissed", "true");
    }
    setIsOpen(false);
  };

  if (isDesktopApp || !isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 pb-4 pt-6 backdrop-blur-sm md:pt-20">
      <div
        className="relative max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card text-card-foreground shadow-2xl md:max-h-[calc(100vh-6rem)]"
        data-testid="download-app-dialog"
      >
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-4 top-4 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t("common.close")}
        >
          <X className="h-5 w-5" />
        </button>

        <div className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Download className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">{t("downloadApp.title")}</h2>
              <p className="text-sm text-muted-foreground">{t("downloadApp.subtitle")}</p>
            </div>
          </div>

          <div className="mb-6 space-y-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-md bg-emerald-500/10 p-1.5">
                <Zap className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <h3 className="font-medium text-foreground">{t("downloadApp.benefit.performance.title")}</h3>
                <p className="text-sm text-muted-foreground">{t("downloadApp.benefit.performance.description")}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-md bg-violet-500/10 p-1.5">
                <FolderOpen className="h-4 w-4 text-violet-500" />
              </div>
              <div>
                <h3 className="font-medium text-foreground">{t("downloadApp.benefit.workspace.title")}</h3>
                <p className="text-sm text-muted-foreground">{t("downloadApp.benefit.workspace.description")}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-md bg-amber-500/10 p-1.5">
                <Gauge className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <h3 className="font-medium text-foreground">{t("downloadApp.benefit.native.title")}</h3>
                <p className="text-sm text-muted-foreground">{t("downloadApp.benefit.native.description")}</p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <a
              href="https://github.com/tryandaction/lattice/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              onClick={handleClose}
            >
              <Download className="h-5 w-5" />
              {t("downloadApp.download")}
            </a>

            <button
              type="button"
              onClick={handleClose}
              className="w-full px-4 py-2 font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("downloadApp.continueWeb")}
            </button>
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
              />
              <span className="text-sm text-muted-foreground">{t("downloadApp.dontShowAgain")}</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
