"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, RefreshCcw, Copy, X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { useAnnotationStore } from "@/stores/annotation-store";
import { buildAiContext } from "@/lib/ai/context-builder";
import { migrateLegacyAnnotation } from "@/lib/annotation-migration";
import { deriveFileId } from "@/lib/annotation-storage";
import { getFileExtension, isBinaryFile } from "@/lib/file-utils";
import { cn } from "@/lib/utils";
import type { AiContextItem } from "@/lib/ai/types";
import type { AnnotationItem } from "@/types/universal-annotation";

export interface AiContextDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type ContextStatus = "idle" | "loading" | "ready" | "empty" | "error";

export function AiContextDialog({ isOpen, onClose }: AiContextDialogProps) {
  const { t } = useI18n();
  const settings = useSettingsStore((state) => state.settings);
  const activeTab = useWorkspaceStore((state) => state.getActiveTab());
  const getCachedContent = useContentCacheStore((state) => state.getContent);
  const getAnnotationsForFile = useAnnotationStore((state) => state.getAnnotationsForFile);
  const [status, setStatus] = useState<ContextStatus>("idle");
  const [contextText, setContextText] = useState("");
  const [contextItems, setContextItems] = useState<AiContextItem[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [includeAnnotations, setIncludeAnnotations] = useState(true);
  const [meta, setMeta] = useState({
    fileName: "",
    filePath: "",
    contentLength: 0,
    annotationCount: 0,
    contextLength: 0,
  });

  const hasActiveFile = Boolean(activeTab?.filePath);

  const buildContext = useCallback(async () => {
    if (!settings.aiEnabled) {
      setStatus("empty");
      setErrorMessage(t("ai.context.disabled"));
      setContextText("");
      setContextItems([]);
      return;
    }

    if (!activeTab) {
      setStatus("empty");
      setErrorMessage(t("ai.context.noFile"));
      setContextText("");
      setContextItems([]);
      return;
    }

    setStatus("loading");
    setErrorMessage("");

    let content: string | null = null;
    const cached = getCachedContent(activeTab.id);
    if (cached && typeof cached.content === "string") {
      content = cached.content;
    } else {
      try {
        const file = await activeTab.fileHandle.getFile();
        const extension = getFileExtension(file.name);
    if (isBinaryFile(extension)) {
      setStatus("error");
      setErrorMessage(t("ai.context.binary"));
      setContextText("");
      setContextItems([]);
      return;
    }
        content = await file.text();
      } catch (error) {
        console.error("Failed to read file for AI context:", error);
        setStatus("error");
        setErrorMessage(t("ai.context.readError"));
        setContextText("");
        setContextItems([]);
        return;
      }
    }

    if (!content) {
      setStatus("empty");
      setErrorMessage(t("ai.context.noContent"));
      setContextText("");
      setContextItems([]);
      return;
    }

    let annotationsCount = 0;
    let migratedAnnotations: AnnotationItem[] = [];
    try {
      const fileId = deriveFileId(activeTab.filePath || activeTab.fileName);
      const legacy = getAnnotationsForFile(fileId);
      if (includeAnnotations) {
        migratedAnnotations = legacy.map(migrateLegacyAnnotation);
        annotationsCount = migratedAnnotations.length;
      }
    } catch (error) {
      console.warn("Failed to prepare annotations for AI context:", error);
    }

    let context: ReturnType<typeof buildAiContext>;
    try {
      context = buildAiContext({
        filePath: activeTab.filePath || activeTab.fileName,
        content,
        annotations: includeAnnotations ? migratedAnnotations : undefined,
      });
    } catch (error) {
      console.error("Failed to build AI context:", error);
      setStatus("error");
      setErrorMessage(t("ai.context.readError"));
      setContextText("");
      setContextItems([]);
      return;
    }

    let prompt = "";
    try {
      prompt = context.toPrompt();
    } catch (error) {
      console.error("Failed to format AI context:", error);
      setStatus("error");
      setErrorMessage(t("ai.context.readError"));
      setContextText("");
      setContextItems([]);
      return;
    }
    setContextText(prompt);
    setContextItems(context.items);
    setMeta({
      fileName: activeTab.fileName,
      filePath: activeTab.filePath,
      contentLength: content.length,
      annotationCount: annotationsCount,
      contextLength: prompt.length,
    });
    setStatus("ready");
  }, [activeTab, getCachedContent, getAnnotationsForFile, includeAnnotations, settings.aiEnabled, t]);

  useEffect(() => {
    if (!isOpen) return;
    void buildContext();
  }, [isOpen, buildContext]);

  const summaryItems = useMemo(() => [
    { label: t("ai.context.summary.file"), value: meta.fileName || "-" },
    { label: t("ai.context.summary.path"), value: meta.filePath || "-" },
    { label: t("ai.context.summary.contentLength"), value: String(meta.contentLength) },
    { label: t("ai.context.summary.annotations"), value: String(meta.annotationCount) },
    { label: t("ai.context.summary.contextLength"), value: String(meta.contextLength) },
  ], [meta, t]);

  const handleExportJson = useCallback(() => {
    if (status !== "ready") return;
    try {
      const payload = JSON.stringify({ items: contextItems }, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "lattice-ai-context.json";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.warn("Failed to export AI context JSON:", error);
    }
  }, [contextItems, status]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-3xl rounded-xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">{t("ai.context.title")}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            aria-label={t("common.close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              {t("ai.context.description")}
            </p>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  checked={includeAnnotations}
                  onChange={(event) => setIncludeAnnotations(event.target.checked)}
                  disabled={!settings.aiEnabled}
                />
                {t("ai.context.includeAnnotations")}
              </label>
              <button
                type="button"
                onClick={() => void buildContext()}
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-border",
                  "text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                )}
                disabled={!settings.aiEnabled || !hasActiveFile}
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                {t("ai.context.refresh")}
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(contextText);
                  } catch (error) {
                    console.warn("Failed to copy AI context:", error);
                  }
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-border",
                  "text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                )}
                disabled={!settings.aiEnabled || status !== "ready"}
              >
                <Copy className="h-3.5 w-3.5" />
                {t("ai.context.copy")}
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const payload = JSON.stringify({ items: contextItems }, null, 2);
                    await navigator.clipboard.writeText(payload);
                  } catch (error) {
                    console.warn("Failed to copy AI context JSON:", error);
                  }
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-border",
                  "text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                )}
                disabled={!settings.aiEnabled || status !== "ready"}
              >
                <Copy className="h-3.5 w-3.5" />
                {t("ai.context.copyJson")}
              </button>
              <button
                type="button"
                onClick={handleExportJson}
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-border",
                  "text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                )}
                disabled={!settings.aiEnabled || status !== "ready"}
              >
                <Copy className="h-3.5 w-3.5" />
                {t("ai.context.exportJson")}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (status !== "ready") return;
                  try {
                    const blob = new Blob([contextText], { type: "text/markdown" });
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement("a");
                    anchor.href = url;
                    anchor.download = "lattice-ai-context.md";
                    anchor.click();
                    URL.revokeObjectURL(url);
                  } catch (error) {
                    console.warn("Failed to export AI context markdown:", error);
                  }
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-border",
                  "text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                )}
                disabled={!settings.aiEnabled || status !== "ready"}
              >
                <Copy className="h-3.5 w-3.5" />
                {t("ai.context.exportMarkdown")}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            {summaryItems.map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <span className="text-muted-foreground/80">{item.label}</span>
                <span className="truncate text-foreground">{item.value}</span>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-border bg-background p-3">
            {status === "loading" && (
              <div className="text-sm text-muted-foreground">{t("ai.context.loading")}</div>
            )}
            {status === "ready" && (
              <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap text-xs text-foreground">
                {contextText}
              </pre>
            )}
            {status !== "loading" && status !== "ready" && (
              <div className="text-sm text-muted-foreground">{errorMessage}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
