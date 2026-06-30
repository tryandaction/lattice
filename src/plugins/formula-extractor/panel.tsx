"use client";

import { useState } from "react";
import { Copy, FileDown, ScanLine, RefreshCcw } from "lucide-react";
import { renderLatexSafe } from "@/lib/formula-converter";
import { runPluginCommand } from "@/lib/plugins/runtime";
import { cn } from "@/lib/utils";
import type { ExtractedFormula, FormulaExtractionResult, HiddenFormulaCandidate } from "./types";

interface FormulaExtractorPanelProps {
  result?: FormulaExtractionResult | null;
  busy?: boolean;
  error?: string | null;
}

function sourceLabel(result: FormulaExtractionResult | null | undefined): string {
  if (!result) return "Formula Extractor";
  return result.sourceFile || result.viewerType.toUpperCase();
}

function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function getFormulaMeta(formula: ExtractedFormula): string {
  const parts = [
    formula.page ? `Page ${formula.page}` : null,
    formula.kind === "explicit" ? "source math" : formula.kind,
  ].filter(Boolean);
  return parts.join(" - ");
}

async function runFormulaCommand(
  commandId: string,
  payload: unknown,
  onError: (message: string) => void,
) {
  try {
    await runPluginCommand(commandId, payload);
    onError("");
  } catch (error) {
    onError(error instanceof Error ? error.message : String(error));
  }
}

function FormulaPreview({ formula }: { formula: ExtractedFormula }) {
  const rendered = renderLatexSafe(formula.latex, formula.displayMode);
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-md border bg-background px-3 py-3",
        formula.displayMode ? "text-center" : "text-left",
        rendered.success ? "border-border" : "border-amber-300/70 bg-amber-50/70 dark:bg-amber-950/20",
      )}
      data-testid="formula-rendered-preview"
    >
      <div
        className="formula-extractor-katex min-w-0 text-sm text-foreground"
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
    </div>
  );
}

function FormulaRow({ formula, onCommandError }: { formula: ExtractedFormula; onCommandError: (message: string) => void }) {
  return (
    <article className="group rounded-md border border-border bg-background shadow-sm transition-colors hover:border-primary/40">
      <button
        type="button"
        onClick={() => void runFormulaCommand("formula-extractor.reveal-formula", { formulaId: formula.id }, onCommandError)}
        className="block w-full p-3 text-left"
      >
        <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{getFormulaMeta(formula)}</span>
          <span className="shrink-0">{formatConfidence(formula.confidence)}</span>
        </div>
        <FormulaPreview formula={formula} />
        {formula.context ? (
          <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">{formula.context}</div>
        ) : null}
      </button>
      <div className="grid grid-cols-2 gap-1 border-t border-border px-3 py-2">
        <button
          type="button"
          onClick={() => void runFormulaCommand("formula-extractor.copy-formula-latex", { formulaId: formula.id }, onCommandError)}
          className="inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Copy className="h-3.5 w-3.5" />
          Copy LaTeX
        </button>
        <button
          type="button"
          onClick={() => void runFormulaCommand("formula-extractor.copy-formula-markdown", { formulaId: formula.id }, onCommandError)}
          className="inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Copy className="h-3.5 w-3.5" />
          Copy Markdown
        </button>
      </div>
    </article>
  );
}

function hiddenCandidateLabel(candidate: HiddenFormulaCandidate): string {
  return [
    candidate.page ? `Page ${candidate.page}` : null,
    candidate.reason,
    typeof candidate.score === "number" ? formatConfidence(candidate.score) : null,
  ].filter(Boolean).join(" - ");
}

export function FormulaExtractorPanel({ result, busy = false, error = null }: FormulaExtractorPanelProps) {
  const formulas = result?.formulas ?? [];
  const hiddenCandidates = result?.hiddenCandidates ?? [];
  const [commandError, setCommandError] = useState("");

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{sourceLabel(result)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {result ? `${formulas.length} reliable formulas` : "No scan yet"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void runFormulaCommand("formula-extractor.extract.document", undefined, setCommandError)}
            disabled={busy}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCcw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
            Scan
          </button>
        </div>

        <button
          type="button"
          onClick={() => void runFormulaCommand("formula-extractor.ocr.selection", undefined, setCommandError)}
          disabled={busy}
          className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 text-xs text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
        >
          <ScanLine className={cn("h-3.5 w-3.5", busy && "animate-pulse")} />
          OCR selection
        </button>

        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => void runFormulaCommand("formula-extractor.export-markdown", undefined, setCommandError)}
            disabled={busy || formulas.length === 0}
            className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <FileDown className="h-3.5 w-3.5" />
            .md
          </button>
          <button
            type="button"
            onClick={() => void runFormulaCommand("formula-extractor.export-latex", undefined, setCommandError)}
            disabled={busy || formulas.length === 0}
            className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <FileDown className="h-3.5 w-3.5" />
            .tex
          </button>
        </div>
      </div>

      {busy ? (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Scanning the active document...
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {commandError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {commandError}
        </div>
      ) : null}

      {!busy && formulas.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
          {result ? "No reliable formulas found. Try selecting a formula region and scan the selection." : "Click Scan to extract formulas from the active document."}
        </div>
      ) : null}

      <div className="space-y-2">
        {formulas.map((formula) => (
          <FormulaRow key={formula.id} formula={formula} onCommandError={setCommandError} />
        ))}
      </div>

      {hiddenCandidates.length > 0 ? (
        <details className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none font-medium text-foreground">
            Diagnostics / Hidden candidates ({hiddenCandidates.length})
          </summary>
          <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
            {hiddenCandidates.slice(0, 60).map((candidate, index) => (
              <div key={`${candidate.page ?? "x"}-${candidate.reason}-${index}`} className="rounded-md border border-border bg-background p-2">
                <div className="mb-1 font-medium text-muted-foreground">{hiddenCandidateLabel(candidate)}</div>
                <div className="line-clamp-3 break-words">{candidate.rawText}</div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
