"use client";

/**
 * Diff Preview Component
 * Shows side-by-side or inline diff of AI-suggested changes
 * with Accept/Reject actions
 */

import { useMemo, useCallback } from "react";
import { Check, X, Copy } from "lucide-react";
import { computeDiff, applyDiff } from "@/lib/ai/diff-utils";
import { cn } from "@/lib/utils";

interface DiffPreviewProps {
  original: string;
  modified: string;
  onAccept: (result: string) => void;
  onReject: () => void;
  className?: string;
}

export function DiffPreview({ original, modified, onAccept, onReject, className }: DiffPreviewProps) {
  const diff = useMemo(() => computeDiff(original, modified), [original, modified]);

  const handleAccept = useCallback(() => {
    onAccept(applyDiff(original, diff));
  }, [original, diff, onAccept]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(modified);
    } catch { /* ignore */ }
  }, [modified]);

  return (
    <div className={cn("rounded-lg border border-border overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="text-green-500">+{diff.additions}</span>
          <span className="text-red-500">-{diff.deletions}</span>
          <span>{diff.unchanged} unchanged</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Copy modified text"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onReject}
            className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
            title="Reject changes"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleAccept}
            className="p-1.5 rounded hover:bg-green-500/10 text-muted-foreground hover:text-green-500 transition-colors"
            title="Accept changes"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Diff lines */}
      <div className="overflow-auto max-h-80 text-xs font-mono">
        {diff.lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              "px-3 py-0.5 flex",
              line.type === "added" && "bg-green-500/10 text-green-400",
              line.type === "removed" && "bg-red-500/10 text-red-400 line-through opacity-70",
              line.type === "unchanged" && "text-muted-foreground"
            )}
          >
            <span className="w-5 shrink-0 text-right mr-2 opacity-40 select-none">
              {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
            </span>
            <span className="whitespace-pre-wrap break-all">{line.content || "\u00A0"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
