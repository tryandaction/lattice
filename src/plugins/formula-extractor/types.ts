import type { PluginDocumentRevealTarget, PluginPdfTextPage, PluginViewerType } from "@/lib/plugins/types";

export type FormulaOutputFormat = "markdown" | "latex";
export type FormulaExtractionScope = "document" | "current-page" | "selection";

export interface FormulaExtractionSource {
  viewerType: PluginViewerType;
  filePath?: string | null;
  fileName?: string | null;
  text?: string;
  arrayBuffer?: ArrayBuffer;
  selectionText?: string;
  pdfPages?: PluginPdfTextPage[];
  scope?: FormulaExtractionScope;
}

export interface ExtractedFormula {
  id: string;
  source: PluginViewerType;
  kind: "explicit" | "text-layer" | "omml" | "mathml" | "ocr";
  page?: number;
  location?: string;
  confidence: number;
  bbox?: { x1: number; y1: number; x2: number; y2: number };
  target?: PluginDocumentRevealTarget;
  latex: string;
  rawText: string;
  displayMode: boolean;
  context?: string;
  needsReview?: boolean;
}

export type HiddenFormulaCandidateReason =
  | "prose-like"
  | "too-long"
  | "no-geometry"
  | "low-symbol-density"
  | "citation-or-number"
  | "layout-not-display"
  | "duplicate";

export interface HiddenFormulaCandidate {
  page?: number;
  reason: HiddenFormulaCandidateReason;
  rawText: string;
  score?: number;
  bbox?: { x1: number; y1: number; x2: number; y2: number };
}

export interface FormulaExtractionResult {
  sourceFile?: string | null;
  viewerType: PluginViewerType;
  scope: FormulaExtractionScope;
  formulas: ExtractedFormula[];
  hiddenCandidates?: HiddenFormulaCandidate[];
  scannedAt: number;
  warnings: string[];
}
