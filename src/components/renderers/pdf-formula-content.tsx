"use client";

import { useMemo, useState } from "react";
import "katex/dist/katex.min.css";
import { useI18n } from "@/hooks/use-i18n";
import type { TranslationKey } from "@/lib/i18n";
import { renderStrictFormula } from "@/lib/strict-formula-renderer";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import type { ImageAnnotationPreview, PdfFormulaAnnotation } from "@/types/universal-annotation";

interface PdfFormulaContentProps {
  formula: PdfFormulaAnnotation;
  preview?: ImageAnnotationPreview;
  onChange?: (formula: PdfFormulaAnnotation) => void | Promise<void>;
  onRecognize?: () => Promise<void>;
  compact?: boolean;
}

const BUTTON_CLASS = "rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";

export function PdfFormulaContent({ formula, preview, onChange, onRecognize, compact = false }: PdfFormulaContentProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ key: TranslationKey; error: boolean } | null>(null);
  const html = useMemo(
    () => formula.status === "ready" && !(formula.recognitionTruncated&&formula.latex?.trim()===(formula.initialLatex??formula.originalLatex)?.trim()) ? renderStrictFormula(formula.latex) : null,
    [formula.status, formula.latex,formula.recognitionTruncated,formula.initialLatex,formula.originalLatex],
  );
  const renderable = html !== null;
  const sourcePreview = preview?.dataUrl.startsWith("data:image/png;base64,") ? preview : undefined;

  async function copyFormula(format: "latex" | "markdown") {
    if (!renderable || !formula.latex) return;
    setFeedback(null);
    try {
      const latex = formula.latex.trim();
      const copied = await copyToClipboard(format === "latex" ? latex : "$$\n" + latex + "\n$$");
      if (!copied) throw new Error("clipboard unavailable");
      setFeedback({ key: "pdf.formula.copied", error: false });
    } catch {
      setFeedback({ key: "pdf.formula.copyFailed", error: true });
    }
  }

  async function applyCorrection() {
    const latex = (draft ?? formula.latex ?? "").trim();
    if (!renderStrictFormula(latex)||formula.recognitionTruncated&&latex===(formula.initialLatex??formula.originalLatex??formula.latex)?.trim()) {
      setFeedback({ key: "pdf.formula.invalid", error: true });
      return;
    }
    try {
      await onChange?.({ ...formula, latex, status: "ready", source: "manual" });
      setFeedback({ key: "pdf.formula.applied", error: false });
      setDraft(null);
    } catch {
      setFeedback({ key: "pdf.formula.saveFailed", error: true });
    }
  }

  async function recognizeFormula() {
    if (!onRecognize || recognizing) return;
    setRecognizing(true);
    setRecognitionError(null);
    setFeedback(null);
    try {
      await onRecognize();
    } catch (error) {
      setFeedback({ key: "pdf.formula.recognizeFailed", error: true });
      setRecognitionError(error instanceof Error ? error.message : null);
    } finally {
      setRecognizing(false);
    }
  }

  return (
    <div className={cn("min-w-0 space-y-1", compact ? "text-xs" : "text-sm")}>
      {renderable ? (
        <div
          className="overflow-x-auto rounded bg-background px-2 py-1 [&_.katex-display]:my-1"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <>
          {sourcePreview ? (
            // This is the original local PNG; preserve the whole formula crop.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={sourcePreview.dataUrl}
              alt={t("pdf.formula.originalPreview")}
              width={sourcePreview.width}
              height={sourcePreview.height}
              className="block h-auto max-w-full rounded bg-white object-contain"
            />
          ) : (
            <p className="whitespace-pre-wrap break-words text-muted-foreground">{formula.rawText || formula.latex || t("pdf.formula.noSource")}</p>
          )}
          <p className="text-xs text-amber-700 dark:text-amber-400">{t("pdf.formula.needsReview")}</p>
        </>
      )}

      {renderable && sourcePreview && <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">{t('pdf.formula.compareSource')}</summary>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={sourcePreview.dataUrl} alt={t('pdf.formula.originalPreview')} width={sourcePreview.width} height={sourcePreview.height} className="mt-1 h-auto max-w-full rounded bg-white" />
      </details>}
      {formula.originalLatex!==undefined&&<details className="text-xs text-muted-foreground"><summary>{t('formula.review.originalPrediction')}</summary><pre className="whitespace-pre-wrap break-words">{formula.originalLatex}</pre></details>}
      {formula.recognitionTruncated&&<p className="text-xs text-amber-700 dark:text-amber-400">{t('formula.review.truncated')}</p>}
      <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className={BUTTON_CLASS} disabled={!renderable} onClick={() => void copyFormula("latex")}>{t("pdf.formula.copyLatex")}</button>
          <button type="button" className={BUTTON_CLASS} disabled={!renderable} onClick={() => void copyFormula("markdown")}>{t("pdf.formula.copyMarkdown")}</button>
          {onRecognize ? (
            <button type="button" className={BUTTON_CLASS} disabled={recognizing} onClick={() => void recognizeFormula()}>
              {t(recognizing ? "pdf.formula.recognizing" : "pdf.formula.recognize")}
            </button>
          ) : null}
        </div>

        {onChange ? (
          <details className="mt-1 text-xs">
            <summary className="cursor-pointer rounded py-1 text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">{t("pdf.formula.correct")}</summary>
            <label className="block space-y-1">
              <span className="text-muted-foreground">{t("pdf.formula.latexLabel")}</span>
              <textarea
                className="block min-h-16 w-full resize-y rounded border bg-background p-2 font-mono text-xs focus-visible:outline-2 focus-visible:outline-ring"
                value={draft ?? formula.latex ?? ""}
                onChange={(event) => { setDraft(event.target.value); setFeedback(null); }}
                rows={3}
                maxLength={20000}
                spellCheck={false}
              />
            </label>
            <button type="button" className={BUTTON_CLASS} onClick={applyCorrection}>{t("pdf.formula.apply")}</button>
          </details>
        ) : null}
      </div>

      {feedback ? (
        <p role={feedback.error ? "alert" : "status"} className={cn("text-xs", feedback.error ? "text-destructive" : "text-muted-foreground")}>
          {t(feedback.key)}
        </p>
      ) : null}
      {recognitionError && <p className="break-words text-xs text-destructive" data-testid="pdf-formula-recognition-error">{recognitionError}</p>}
    </div>
  );
}
