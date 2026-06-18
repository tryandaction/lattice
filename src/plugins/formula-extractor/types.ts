import type { PluginPdfTextPage, PluginViewerType } from "@/lib/plugins/types";

export type FormulaOutputFormat = "markdown" | "latex" | "json";
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
  page?: number;
  location?: string;
  confidence: number;
  bbox?: { x1: number; y1: number; x2: number; y2: number };
  latex: string;
  rawText: string;
  displayMode: boolean;
  context?: string;
  needsReview?: boolean;
}

export interface FormulaExtractionResult {
  sourceFile?: string | null;
  viewerType: PluginViewerType;
  scope: FormulaExtractionScope;
  formulas: ExtractedFormula[];
  scannedAt: number;
  warnings: string[];
}
