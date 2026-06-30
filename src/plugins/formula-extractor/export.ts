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

export function exportFormulaAsMarkdown(formula: ExtractedFormula): string {
  return wrapLatexForMarkdown(formula.latex, formula.displayMode);
}

export function exportFormulaAsLatex(formula: ExtractedFormula): string {
  return formula.latex;
}
