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

interface MarkdownExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  content: string;
  fileName: string;
  filePath?: string;
  rootHandle?: FileSystemDirectoryHandle | null;
}

const FORMAT_OPTIONS: Array<{
  value: MarkdownExportFormat;
  title: string;
  description: string;
  icon: typeof FileText;
}> = [
  {
    value: "docx",
    title: "DOCX",
    description: "适合继续编辑、共享与归档",
    icon: FileType2,
  },
  {
    value: "pdf",
    title: "PDF",
    description: "导出当前渲染效果，更适合定稿分享",
    icon: FileText,
  },
];

const MODE_OPTIONS: Array<{
  value: MarkdownExportAnnotationMode;
  title: string;
  description: string;
  icon: typeof Download;
}> = [
  {
    value: "clean",
    title: "Clean",
    description: "只导出正文，不附带标注",
    icon: Download,
  },
  {
    value: "appendix",
    title: "Appendix",
    description: "正文纯净，标注和来源整理到文末附录",
    icon: FileText,
  },
  {
    value: "study-note",
    title: "Study Note",
    description: "把标注整理成更适合学习与科研复盘的导出稿",
    icon: NotebookPen,
  },
];

export function MarkdownExportDialog({
  isOpen,
  onClose,
  content,
  fileName,
  filePath,
  rootHandle,
}: MarkdownExportDialogProps) {
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
        setError(loadError instanceof Error ? loadError.message : "加载标注失败");
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
  }, [fileName, filePath, isOpen, rootHandle]);

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
        setPreviewError(previewBuildError instanceof Error ? previewBuildError.message : "预览生成失败");
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
      message: "Exporting markdown document...",
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
        throw new Error(result.error || "导出失败");
      }

      showExportToast({
        type: "success",
        message: "Markdown export completed",
        filePath: result.filePath,
      });
      onClose();
    } catch (exportError) {
      dismissExportToast(toastId);
      const message = exportError instanceof Error ? exportError.message : "导出失败";
      setError(message);
      showExportToast({
        type: "error",
        message: "Markdown export failed",
        error: message,
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        className="w-full max-w-6xl rounded-2xl border border-border bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border px-6 py-5">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">导出 Markdown 文档</h2>
            <p className="text-sm text-muted-foreground">
              公式、代码块、表格、引用块与标题层级会按渲染结构导出，DOCX 与 PDF 共用同一套导出模型。
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid gap-6 px-6 py-5 xl:grid-cols-[1.05fr_minmax(360px,0.95fr)]">
          <div className="grid gap-6">
            <section className="space-y-3 rounded-xl border border-border p-4">
              <div className="flex items-center gap-2">
                <TextCursorInput className="h-4 w-4" />
                <div>
                  <h3 className="text-sm font-medium">导出标题</h3>
                  <p className="text-xs text-muted-foreground">用于导出文档首页标题与最终成品文档信息头部。</p>
                </div>
              </div>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="输入导出标题"
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
              />
            </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">导出格式</h3>
              <p className="text-xs text-muted-foreground">为最终交付物选择目标格式。</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {FORMAT_OPTIONS.map((option) => {
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
                <h3 className="text-sm font-medium">标注导出策略</h3>
                <p className="text-xs text-muted-foreground">
                  当前检测到 {isLoadingAnnotations ? "..." : annotationsCount} 条当前文件侧车标注。
                </p>
              </div>

              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={annotationsEnabled}
                  disabled={annotationsCount === 0}
                  onChange={(event) => setAnnotationsEnabled(event.target.checked)}
                />
                <span>包含当前文件标注与来源信息</span>
              </label>

              <div className="grid gap-3">
                {MODE_OPTIONS.map((option) => {
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
                <h3 className="text-sm font-medium">渲染视图</h3>
                <p className="text-xs text-muted-foreground">
                  是否以当前可视化渲染风格导出，而不是默认文档版式。
                </p>
              </div>

              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={() => setVisualMode("document")}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    visualMode === "document" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="font-medium">文档版式</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    更适合打印、提交与正式阅读。
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setVisualMode("rendered")}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    visualMode === "rendered" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="font-medium">当前渲染视图</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    更接近应用内阅读效果，适合代码块、引用与视觉强调保留。
                  </p>
                </button>
              </div>

              <div className="rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">
                <p>当前文件：{fileName}</p>
                <p>输出模式：{format.toUpperCase()} / {effectiveMode} / {visualMode}</p>
                <p>文档标题：{title || "未设置"}</p>
                <p>说明：PDF 走渲染快照链路，DOCX 走结构化 HTML 导入链路。</p>
              </div>
            </div>
          </section>

          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          </div>

          <section className="flex min-h-[640px] flex-col rounded-xl border border-border bg-muted/20">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                <div>
                  <h3 className="text-sm font-medium">导出预览</h3>
                  <p className="text-xs text-muted-foreground">
                    预览当前导出配置下的成品文档结构。
                  </p>
                </div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <div>{previewEntryCount} 条来源项</div>
                <div>{format.toUpperCase()} / {visualMode}</div>
              </div>
            </div>

            <div className="relative flex-1">
              {isPreviewLoading ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在生成预览...
                </div>
              ) : previewError ? (
                <div className="flex h-full items-center justify-center px-6 text-sm text-destructive">
                  {previewError}
                </div>
              ) : previewHtml ? (
                <iframe
                  title="Markdown export preview"
                  sandbox=""
                  srcDoc={previewHtml}
                  className="h-full w-full rounded-b-xl bg-white"
                />
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                  预览暂不可用
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <p className="text-xs text-muted-foreground">
            {annotationsCount === 0
              ? "当前文件未发现侧车标注，将仅导出正文结构。"
              : `本次可带出 ${annotationsCount} 条标注及其来源定位。`}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={isExporting}>
              取消
            </Button>
            <Button onClick={handleExport} disabled={isExporting || isLoadingAnnotations}>
              {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              导出
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MarkdownExportDialog;
