"use client";

import { X } from "lucide-react";
import { useMemo } from "react";
import { computeDiff } from "@/lib/ai/diff-utils";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/use-i18n";

export interface FileCompareDialogInput {
  leftName: string;
  leftPath: string;
  leftContent: string;
  rightName: string;
  rightPath: string;
  rightContent: string;
}

interface FileCompareDialogProps {
  compare: FileCompareDialogInput;
  onClose: () => void;
}

export function FileCompareDialog({ compare, onClose }: FileCompareDialogProps) {
  const { t } = useI18n();
  const diff = useMemo(
    () => computeDiff(compare.leftContent, compare.rightContent),
    [compare.leftContent, compare.rightContent],
  );

  return (
    <div className="fixed inset-0 z-[175] flex items-start justify-center overflow-hidden bg-black/45 px-4 pb-4 pt-8 backdrop-blur-sm md:pt-16">
      <div className="flex h-[min(82vh,760px)] w-full max-w-6xl flex-col overflow-hidden rounded-md border border-border bg-background shadow-xl">
        <div className="flex min-h-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {t("explorer.compare.title")}
            </h2>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate">{compare.leftPath}</span>
              <span>↔</span>
              <span className="truncate">{compare.rightPath}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 border-b border-border bg-muted/35 text-xs">
          <div className="min-w-0 border-r border-border px-4 py-2">
            <div className="truncate font-medium text-foreground">{compare.leftName}</div>
            <div className="truncate text-muted-foreground">{compare.leftPath}</div>
          </div>
          <div className="min-w-0 px-4 py-2">
            <div className="truncate font-medium text-foreground">{compare.rightName}</div>
            <div className="truncate text-muted-foreground">{compare.rightPath}</div>
          </div>
        </div>

        <div className="flex items-center gap-4 border-b border-border px-4 py-2 text-xs text-muted-foreground">
          <span className="text-green-600 dark:text-green-400">+{diff.additions}</span>
          <span className="text-red-600 dark:text-red-400">-{diff.deletions}</span>
          <span>{t("explorer.compare.unchanged", { count: diff.unchanged })}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-[var(--code-shell-bg)] font-mono text-xs">
          {diff.lines.map((line, index) => (
            <div
              key={`${line.type}-${line.oldLineNum ?? ""}-${line.newLineNum ?? ""}-${index}`}
              className={cn(
                "grid min-w-[720px] grid-cols-[4rem_4rem_1fr] border-b border-border/30",
                line.type === "added" && "bg-green-500/10",
                line.type === "removed" && "bg-red-500/10",
              )}
            >
              <span className="select-none border-r border-border/40 px-2 py-0.5 text-right text-muted-foreground">
                {line.oldLineNum ?? ""}
              </span>
              <span className="select-none border-r border-border/40 px-2 py-0.5 text-right text-muted-foreground">
                {line.newLineNum ?? ""}
              </span>
              <span
                className={cn(
                  "whitespace-pre-wrap break-words px-3 py-0.5",
                  line.type === "added" && "text-green-700 dark:text-green-300",
                  line.type === "removed" && "text-red-700 dark:text-red-300",
                  line.type === "unchanged" && "text-foreground/85",
                )}
              >
                <span className="mr-2 select-none text-muted-foreground">
                  {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
                </span>
                {line.content || "\u00A0"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
