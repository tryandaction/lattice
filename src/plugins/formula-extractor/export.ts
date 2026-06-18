import { wrapLatexForMarkdown } from "@/lib/formula-utils";
import type { ExtractedFormula } from "./types";

export function exportFormulaResultsAsMarkdown(formulas: ExtractedFormula[]): string {
  if (formulas.length === 0) return "";
  return formulas
    .map((formula) => wrapLatexForMarkdown(formula.latex, formula.displayMode))
    .filter(Boolean)
    .join("\n\n");
}

export function exportFormulaResultsAsLatex(formulas: ExtractedFormula[]): string {
  return formulas.map((formula) => formula.latex).filter(Boolean).join("\n\n");
}

export function exportFormulaResultsAsJson(formulas: ExtractedFormula[]): string {
  return JSON.stringify(
    formulas.map((formula) => ({
      source: formula.source,
      page: formula.page,
      confidence: formula.confidence,
      bbox: formula.bbox,
      latex: formula.latex,
      rawText: formula.rawText,
      context: formula.context,
      needsReview: formula.needsReview,
    })),
    null,
    2,
  );
}
