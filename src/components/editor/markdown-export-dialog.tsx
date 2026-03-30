"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Eye, FileText, FileType2, Loader2, NotebookPen, TextCursorInput, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildMarkdownExportPreview,
  exportMarkdownDocument,
  loadMarkdownExportAnnotations,
  type MarkdownExportAnnotationMode,
  type MarkdownExportFormat,
  type MarkdownExportVisualMode,
} from "@/lib/markdown-export";
import {
  dismissExportToast,
  showExportToast,
  updateExportToast,
} from "@/components/ui/export-toast";
import { useI18n } from "@/hooks/use-i18n";

interface MarkdownExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  content: string;
  fileName: string;
  filePath?: string;
  rootHandle?: FileSystemDirectoryHandle | null;
}

export function MarkdownExportDialog({
  isOpen,
  onClose,
  content,
  fileName,
  filePath,
  rootHandle,
}: MarkdownExportDialogProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState(fileName.replace(/\.[^.]+$/, "") || fileName);
  const [format, setFormat] = useState<MarkdownExportFormat>("docx");
  const [annotationMode, setAnnotationMode] = useState<MarkdownExportAnnotationMode>("appendix");
  const [visualMode, setVisualMode] = useState<MarkdownExportVisualMode>("document");
  const [annotationsEnabled, setAnnotationsEnabled] = useState(true);
  const [annotationsCount, setAnnotationsCount] = useState(0);
  const [isLoadingAnnotations, setIsLoadingAnnotations] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Awaited<ReturnType<typeof loadMarkdownExportAnnotations>>>([]);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewEntryCount, setPreviewEntryCount] = useState(0);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const texts = useMemo(() => ({
    loadAnnotationsFailed: t("export.markdown.loadAnnotationsFailed"),
    previewFailed: t("export.markdown.previewFailed"),
    exportFailed: t("export.markdown.exportFailed"),
    exportProgress: t("export.markdown.exportProgress"),
    exportCompleted: t("export.markdown.exportCompleted"),
    exportFailedToast: t("export.markdown.exportFailedToast"),
    title: t("export.markdown.title"),
    subtitle: t("export.markdown.subtitle"),
    exportTitle: t("export.markdown.exportTitle"),
    exportTitleHint: t("export.markdown.exportTitleHint"),
    exportTitlePlaceholder: t("export.markdown.exportTitlePlaceholder"),
    formatTitle: t("export.markdown.formatTitle"),
    formatHint: t("export.markdown.formatHint"),
    annotationTitle: t("export.markdown.annotationTitle"),
    annotationDetected: t("export.markdown.annotationDetected", {
      count: isLoadingAnnotations ? "..." : annotationsCount,
    }),
    includeAnnotations: t("export.markdown.includeAnnotations"),
    visualTitle: t("export.markdown.visualTitle"),
    visualHint: t("export.markdown.visualHint"),
    visualDocument: t("export.markdown.visualDocument"),
    visualDocumentHint: t("export.markdown.visualDocumentHint"),
    visualRendered: t("export.markdown.visualRendered"),
    visualRenderedHint: t("export.markdown.visualRenderedHint"),
    currentFile: t("export.markdown.currentFile"),
    outputMode: t("export.markdown.outputMode"),
    documentTitle: t("export.markdown.documentTitle"),
    notSet: t("export.markdown.notSet"),
    exportModelHint: t("export.markdown.exportModelHint"),
    previewTitle: t("export.markdown.previewTitle"),
    previewHint: t("export.markdown.previewHint"),
    sourceCount: t("export.markdown.sourceCount", { count: previewEntryCount }),
    previewLoading: t("export.markdown.previewLoading"),
    previewUnavailable: t("export.markdown.previewUnavailable"),
    noAnnotations: t("export.markdown.noAnnotations"),
    annotationSummary: t("export.markdown.annotationSummary", { count: annotationsCount }),
    cancel: t("common.cancel"),
    export: t("workbench.commandBar.export"),
    formatDocxHint: t("export.markdown.formatDocxHint"),
    formatPdfHint: t("export.markdown.formatPdfHint"),
    modeCleanTitle: t("export.markdown.modeCleanTitle"),
    modeAppendixTitle: t("export.markdown.modeAppendixTitle"),
    modeStudyTitle: t("export.markdown.modeStudyTitle"),
    modeCleanHint: t("export.markdown.modeCleanHint"),
    modeAppendixHint: t("export.markdown.modeAppendixHint"),
    modeStudyHint: t("export.markdown.modeStudyHint"),
  }), [annotationsCount, isLoadingAnnotations, previewEntryCount, t]);

  const formatOptions = useMemo<Array<{
    value: MarkdownExportFormat;
    title: string;
    description: string;
    icon: typeof FileText;
  }>>(() => [
    {
      value: "docx",
      title: "DOCX",
      description: texts.formatDocxHint,
      icon: FileType2,
    },
    {
      value: "pdf",
      title: "PDF",
      description: texts.formatPdfHint,
      icon: FileText,
    },
  ], [texts.formatDocxHint, texts.formatPdfHint]);

  const modeOptions = useMemo<Array<{
    value: MarkdownExportAnnotationMode;
    title: string;
    description: string;
    icon: typeof Download;
  }>>(() => [
    {
      value: "clean",
      title: texts.modeCleanTitle,
      description: texts.modeCleanHint,
      icon: Download,
    },
    {
      value: "appendix",
      title: texts.modeAppendixTitle,
      description: texts.modeAppendixHint,
      icon: FileText,
    },
    {
      value: "study-note",
      title: texts.modeStudyTitle,
      description: texts.modeStudyHint,
      icon: NotebookPen,
    },
  ], [texts.modeAppendixHint, texts.modeAppendixTitle, texts.modeCleanHint, texts.modeCleanTitle, texts.modeStudyHint, texts.modeStudyTitle]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setTitle(fileName.replace(/\.[^.]+$/, "") || fileName);
    setIsLoadingAnnotations(true);
    setError(null);

    loadMarkdownExportAnnotations(rootHandle, filePath, fileName)
      .then((items) => {
        if (cancelled) return;
        setAnnotations(items);
        setAnnotationsCount(items.length);
        setAnnotationsEnabled(items.length > 0);
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.error("Failed to load export annotations:", loadError);
        setError(loadError instanceof Error ? loadError.message : texts.loadAnnotationsFailed);
        setAnnotations([]);
        setAnnotationsCount(0);
        setAnnotationsEnabled(false);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingAnnotations(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fileName, filePath, isOpen, rootHandle, texts.loadAnnotationsFailed]);

  const effectiveMode = useMemo<MarkdownExportAnnotationMode>(() => {
    if (!annotationsEnabled) {
      return "clean";
    }
    return annotationMode;
  }, [annotationMode, annotationsEnabled]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setIsPreviewLoading(true);
      setPreviewError(null);

      try {
        const preview = await buildMarkdownExportPreview(content, {
          format,
          title,
          fileName,
          filePath,
          annotationMode: effectiveMode,
          includeAnnotations: annotationsEnabled,
          visualMode,
          annotations,
          rootHandle,
        });

        if (cancelled) return;
        setPreviewHtml(preview.html);
        setPreviewEntryCount(preview.entryCount);
      } catch (previewBuildError) {
        if (cancelled) return;
        console.error("Failed to build markdown export preview:", previewBuildError);
        setPreviewHtml("");
        setPreviewEntryCount(0);
        setPreviewError(previewBuildError instanceof Error ? previewBuildError.message : texts.previewFailed);
      } finally {
        if (!cancelled) {
          setIsPreviewLoading(false);
        }
      }
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    annotations,
    annotationsEnabled,
    content,
    effectiveMode,
    fileName,
    filePath,
    format,
    isOpen,
    rootHandle,
    title,
    texts.previewFailed,
    visualMode,
  ]);

  if (!isOpen) {
    return null;
  }

  const handleExport = async () => {
    if (isExporting) return;

    setIsExporting(true);
    setError(null);
    const toastId = showExportToast({
      type: "progress",
      message: texts.exportProgress,
      progress: 10,
    });

    try {
      updateExportToast(toastId, { progress: 35 });
      const result = await exportMarkdownDocument(content, {
        format,
        title,
        fileName,
        filePath,
        annotationMode: effectiveMode,
        includeAnnotations: annotationsEnabled,
        visualMode,
        annotations,
        rootHandle,
      });
      updateExportToast(toastId, { progress: 100 });
      dismissExportToast(toastId);

      if (result.cancelled) {
        return;
      }

      if (!result.success) {
        throw new Error(result.error || texts.exportFailed);
      }

      showExportToast({
        type: "success",
        message: texts.exportCompleted,
        filePath: result.filePath,
      });
      onClose();
    } catch (exportError) {
      dismissExportToast(toastId);
      const message = exportError instanceof Error ? exportError.message : texts.exportFailed;
      setError(message);
      showExportToast({
        type: "error",
        message: texts.exportFailedToast,
        error: message,
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[180] flex items-start justify-center overflow-y-auto bg-black/50 px-4 pb-4 pt-6 md:pt-20" onClick={onClose}>
      <div
        className="flex w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl max-h-[calc(100vh-2rem)] md:max-h-[calc(100vh-6rem)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border px-6 py-5">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">{texts.title}</h2>
            <p className="text-sm text-muted-foreground">{texts.subtitle}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 gap-6 overflow-hidden px-6 py-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
          <div className="grid min-h-0 gap-6 overflow-y-auto pr-1">
            <section className="space-y-3 rounded-xl border border-border p-4">
              <div className="flex items-center gap-2">
                <TextCursorInput className="h-4 w-4" />
                <div>
                  <h3 className="text-sm font-medium">{texts.exportTitle}</h3>
                  <p className="text-xs text-muted-foreground">{texts.exportTitleHint}</p>
                </div>
              </div>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={texts.exportTitlePlaceholder}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
              />
            </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">{texts.formatTitle}</h3>
              <p className="text-xs text-muted-foreground">{texts.formatHint}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {formatOptions.map((option) => {
                const Icon = option.icon;
                const active = option.value === format;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFormat(option.value)}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      <span className="font-medium">{option.title}</span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{option.description}</p>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
            <div className="space-y-3 rounded-xl border border-border p-4">
              <div>
                <h3 className="text-sm font-medium">{texts.annotationTitle}</h3>
                <p className="text-xs text-muted-foreground">{texts.annotationDetected}</p>
              </div>

              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={annotationsEnabled}
                  disabled={annotationsCount === 0}
                  onChange={(event) => setAnnotationsEnabled(event.target.checked)}
                />
                <span>{texts.includeAnnotations}</span>
              </label>

              <div className="grid gap-3">
                {modeOptions.map((option) => {
                  const Icon = option.icon;
                  const active = option.value === effectiveMode;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      disabled={!annotationsEnabled && option.value !== "clean"}
                      onClick={() => setAnnotationMode(option.value)}
                      className={`rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        <span className="font-medium">{option.title}</span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{option.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4 rounded-xl border border-border p-4">
              <div>
                <h3 className="text-sm font-medium">{texts.visualTitle}</h3>
                <p className="text-xs text-muted-foreground">{texts.visualHint}</p>
              </div>

              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={() => setVisualMode("document")}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    visualMode === "document" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="font-medium">{texts.visualDocument}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{texts.visualDocumentHint}</p>
                </button>
                <button
                  type="button"
                  onClick={() => setVisualMode("rendered")}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    visualMode === "rendered" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="font-medium">{texts.visualRendered}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{texts.visualRenderedHint}</p>
                </button>
              </div>

              <div className="rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">
                <p>{texts.currentFile}：{fileName}</p>
                <p>{texts.outputMode}：{format.toUpperCase()} / {effectiveMode} / {visualMode}</p>
                <p>{texts.documentTitle}：{title || texts.notSet}</p>
                <p>{texts.exportModelHint}</p>
              </div>
            </div>
          </section>

          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          </div>

          <section className="flex min-h-[360px] min-h-0 flex-col rounded-xl border border-border bg-muted/20 xl:min-h-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                <div>
                  <h3 className="text-sm font-medium">{texts.previewTitle}</h3>
                  <p className="text-xs text-muted-foreground">{texts.previewHint}</p>
                </div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <div>{texts.sourceCount}</div>
                <div>{format.toUpperCase()} / {visualMode}</div>
              </div>
            </div>

            <div className="relative min-h-0 flex-1 overflow-hidden">
              {isPreviewLoading ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {texts.previewLoading}
                </div>
              ) : previewError ? (
                <div className="flex h-full items-center justify-center px-6 text-sm text-destructive">
                  {previewError}
                </div>
              ) : previewHtml ? (
                <iframe
                  title={texts.previewTitle}
                  sandbox=""
                  srcDoc={previewHtml}
                  className="h-full w-full rounded-b-xl bg-white"
                />
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                  {texts.previewUnavailable}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <p className="text-xs text-muted-foreground">
            {annotationsCount === 0
              ? texts.noAnnotations
              : texts.annotationSummary}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={isExporting}>
              {texts.cancel}
            </Button>
            <Button onClick={handleExport} disabled={isExporting || isLoadingAnnotations}>
              {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {texts.export}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MarkdownExportDialog;
