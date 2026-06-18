"use client";

import { Copy, Download, RefreshCcw } from "lucide-react";
import { runPluginCommand } from "@/lib/plugins/runtime";
import { cn } from "@/lib/utils";
import type { FormulaExtractionResult } from "./types";

interface FormulaExtractorPanelProps {
  result?: FormulaExtractionResult | null;
  busy?: boolean;
  error?: string | null;
}

function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function sourceLabel(result: FormulaExtractionResult | null | undefined): string {
  if (!result) return "No scan yet";
  const source = result.sourceFile || result.viewerType;
  return `${source} - ${result.formulas.length} formula${result.formulas.length === 1 ? "" : "s"}`;
}

export function FormulaExtractorPanel({ result, busy = false, error = null }: FormulaExtractorPanelProps) {
  const formulas = result?.formulas ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-foreground">{sourceLabel(result)}</div>
          {result && (
            <div className="mt-1 text-xs text-muted-foreground">
              Scope: {result.scope} - {new Date(result.scannedAt).toLocaleTimeString()}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => void runPluginCommand("formula-extractor.extract.document")}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Rescan
          </button>
          <button
            type="button"
            onClick={() => void runPluginCommand("formula-extractor.copy-all-markdown")}
            disabled={busy || formulas.length === 0}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy Markdown
          </button>
          <button
            type="button"
            onClick={() => void runPluginCommand("formula-extractor.export-markdown")}
            disabled={busy || formulas.length === 0}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            .md
          </button>
          <button
            type="button"
            onClick={() => void runPluginCommand("formula-extractor.export-latex")}
            disabled={busy || formulas.length === 0}
            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            .tex
          </button>
          <button
            type="button"
            onClick={() => void runPluginCommand("formula-extractor.export-json")}
            disabled={busy || formulas.length === 0}
            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            .json
          </button>
        </div>
      </div>

      {busy && (
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Scanning active document...
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {result?.warnings.length ? (
        <div className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
          {result.warnings.join(", ")}
        </div>
      ) : null}

      {!busy && formulas.length === 0 && (
        <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
          Run extraction from the command bar or use Rescan.
        </div>
      )}

      <div className="space-y-2">
        {formulas.map((formula) => (
          <div key={formula.id} className="rounded-lg border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {formula.page ? <span>Page {formula.page}</span> : null}
                  {formula.location ? <span>{formula.location}</span> : null}
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5",
                      formula.needsReview
                        ? "border-amber-300 text-amber-700 dark:text-amber-300"
                        : "border-primary/30 text-primary",
                    )}
                  >
                    {formatConfidence(formula.confidence)}
                  </span>
                  {formula.needsReview ? <span>Needs review</span> : null}
                </div>
                <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-muted/50 p-2 text-xs text-foreground">
                  <code>{formula.latex}</code>
                </pre>
                {formula.context && (
                  <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                    {formula.context}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <button
                  type="button"
                  onClick={() => void runPluginCommand("formula-extractor.copy-formula", { formulaId: formula.id })}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Copy className="h-3.5 w-3.5" />
                  LaTeX
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
