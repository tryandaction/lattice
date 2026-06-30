import mammoth from "mammoth";
import { recognizeFormulaImageWithPix2tex } from "@/lib/formula-ocr";
import { FORMULA_EXTRACTOR_PLUGIN_ID } from "@/lib/plugins/defaults";
import type { PluginContext, PluginModule } from "@/lib/plugins/types";
import { normalizeFormulaInput } from "@/lib/formula-utils";
import { extractFormulasFromSource } from "./extractors";
import {
  exportFormulaAsLatex,
  exportFormulaAsMarkdown,
  exportFormulaResultsAsLatex,
  exportFormulaResultsAsMarkdown,
} from "./export";
import type { FormulaExtractionResult, FormulaExtractionScope } from "./types";

const PANEL_ID = "formula-extractor.results";

let latestResult: FormulaExtractionResult | null = null;
let currentContext: PluginContext | null = null;
let activeScan: Promise<void> | null = null;
let activeOcrScan: Promise<void> | null = null;

async function extractDocxRawText(arrayBuffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

function updatePanel(ctx: PluginContext, props: Record<string, unknown>) {
  ctx.panels.update(PANEL_ID, {
    kind: "formula-extractor.results",
    result: latestResult,
    ...props,
  });
}

async function scan(scope: FormulaExtractionScope = "document") {
  const ctx = currentContext;
  if (!ctx) return;

  updatePanel(ctx, { busy: true, error: null, scope });
  await ctx.ui.openPanel(PANEL_ID);

  try {
    const active = await ctx.document.getActive();
    const selectionText = await ctx.document.getSelectionText();
    const content = active.viewerType === "pdf"
      ? { info: active }
      : await ctx.document.readCurrent();
    let text = content.text ?? "";
    const arrayBuffer = content.arrayBuffer;
    if (active.viewerType === "docx" && arrayBuffer) {
      text = await extractDocxRawText(arrayBuffer).catch(() => text);
    }
    const pdfPages = active.viewerType === "pdf" && scope !== "selection"
      ? await ctx.document.getPdfTextPages({
          scope: scope === "current-page" ? "current-page" : "all",
        })
      : undefined;

    latestResult = await extractFormulasFromSource({
      viewerType: active.viewerType,
      filePath: active.filePath,
      fileName: active.fileName,
      text,
      arrayBuffer,
      selectionText,
      pdfPages,
      scope,
    });
    updatePanel(ctx, { busy: false, error: null, scope });
    ctx.notice.show(`Formula Extractor: ${latestResult.formulas.length} formulas found.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updatePanel(ctx, { busy: false, error: message, scope });
    ctx.notice.show(`Formula Extractor failed: ${message}`);
  }
}

function queueScan(scope: FormulaExtractionScope = "document") {
  if (activeScan) return activeScan;
  activeScan = scan(scope).finally(() => {
    activeScan = null;
  });
  return activeScan;
}

async function scanSelectionWithOcr() {
  const ctx = currentContext;
  if (!ctx) return;

  updatePanel(ctx, { busy: true, error: null, scope: "selection" });
  await ctx.ui.openPanel(PANEL_ID);

  try {
    const active = await ctx.document.getActive();
    if (active.viewerType !== "pdf") {
      throw new Error("Formula OCR currently works on PDF selections.");
    }
    const image = await ctx.document.getPdfSelectionImage();
    if (!image) {
      throw new Error("Select a single formula region in the PDF first, then run OCR selection.");
    }
    const ocr = await recognizeFormulaImageWithPix2tex({ imageDataUrl: image.dataUrl });
    const normalized = normalizeFormulaInput(ocr.latex, { preferDisplay: true });
    const formula = {
      id: `ocr-${Date.now()}`,
      source: "pdf" as const,
      kind: "ocr" as const,
      page: image.pageNumber,
      bbox: image.bbox,
      target: {
        viewerType: "pdf" as const,
        page: image.pageNumber,
        bbox: image.bbox,
        quote: normalized.latex,
      },
      confidence: 0.92,
      latex: normalized.latex || ocr.latex,
      rawText: ocr.latex,
      displayMode: true,
      context: `OCR via ${ocr.backend}`,
      needsReview: true,
    };
    latestResult = {
      sourceFile: active.filePath ?? active.fileName,
      viewerType: "pdf",
      scope: "selection",
      formulas: [formula, ...(latestResult?.formulas ?? [])],
      hiddenCandidates: latestResult?.hiddenCandidates ?? [],
      scannedAt: Date.now(),
      warnings: [...(latestResult?.warnings ?? []), "ocr-selection-review"],
    };
    updatePanel(ctx, { busy: false, error: null, scope: "selection" });
    ctx.notice.show("Formula OCR complete. Review the LaTeX before exporting.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updatePanel(ctx, { busy: false, error: message, scope: "selection" });
    ctx.notice.show(`Formula OCR failed: ${message}`);
  }
}

function queueOcrSelectionScan() {
  if (activeOcrScan) return activeOcrScan;
  activeOcrScan = scanSelectionWithOcr().finally(() => {
    activeOcrScan = null;
  });
  return activeOcrScan;
}

function findFormula(formulaId: string) {
  return latestResult?.formulas.find((item) => item.id === formulaId) ?? null;
}

async function copyFormulaLatex(formulaId: string) {
  const ctx = currentContext;
  if (!ctx || !latestResult) return;
  const formula = findFormula(formulaId);
  if (!formula) return;
  await ctx.clipboard.writeText(exportFormulaAsLatex(formula));
  ctx.notice.show("Formula copied as LaTeX.");
}

async function copyFormulaMarkdown(formulaId: string) {
  const ctx = currentContext;
  if (!ctx || !latestResult) return;
  const formula = findFormula(formulaId);
  if (!formula) return;
  await ctx.clipboard.writeText(exportFormulaAsMarkdown(formula));
  ctx.notice.show("Formula copied as Markdown.");
}

async function revealFormula(formulaId: string) {
  const ctx = currentContext;
  if (!ctx || !latestResult) return;
  const formula = latestResult.formulas.find((item) => item.id === formulaId);
  if (!formula?.target) return;
  const ok = await ctx.document.reveal(formula.target);
  if (!ok) {
    ctx.notice.show("Could not locate this formula in the current document.");
  }
}

async function exportLatest(format: "markdown" | "latex") {
  const ctx = currentContext;
  if (!ctx || !latestResult) return;
  const content = format === "markdown"
    ? exportFormulaResultsAsMarkdown(latestResult.formulas)
    : exportFormulaResultsAsLatex(latestResult.formulas);
  const extension = format === "markdown" ? "md" : "tex";
  await ctx.exportFile({
    suggestedName: `formulas.${extension}`,
    content,
    mimeType: "text/plain;charset=utf-8",
  });
}

export const formulaExtractorPlugin: PluginModule = {
  manifest: {
    id: FORMULA_EXTRACTOR_PLUGIN_ID,
    name: "Formula Extractor",
    version: "1.0.0",
    description: "Extract formulas from the active PDF, DOCX, Markdown, or HTML document.",
    author: "Lattice",
    category: "official",
    entry: "builtin:formula-extractor",
    permissions: [
      "read-current-document",
      "clipboard-write",
      "export-file",
      "ui:commands",
      "ui:panels",
    ],
    activationEvents: ["onStartupFinished", "onCommand:formula-extractor.extract.document"],
    recommended: true,
    defaultEnabled: true,
    contributes: {
      commands: [
        { id: "formula-extractor.extract.document", title: "Extract formulas" },
        { id: "formula-extractor.extract.current-page", title: "Extract formulas from current page" },
        { id: "formula-extractor.extract.selection", title: "Extract formulas from selection" },
        { id: "formula-extractor.ocr.selection", title: "OCR selected formula region" },
      ],
      panels: [
        {
          id: PANEL_ID,
          title: "Formula Extractor",
          icon: "sigma",
          schema: {
            type: "custom",
            title: "Formula Extractor",
            description: "Formulas detected in the active document.",
            props: {
              kind: "formula-extractor.results",
              result: null,
              busy: false,
              error: null,
            },
          },
          actions: [],
        },
      ],
    },
  },
  activate(ctx) {
    currentContext = ctx;
    ctx.panels.register({
      id: PANEL_ID,
      title: "Formula Extractor",
      icon: "sigma",
      schema: {
        type: "custom",
        title: "Formula Extractor",
        description: "Formulas detected in the active document.",
        props: {
          kind: "formula-extractor.results",
          result: latestResult,
          busy: false,
          error: null,
        },
      },
      actions: [],
    });
    ctx.commands.register({
      id: "formula-extractor.extract.document",
      title: "Extract formulas",
      shortcut: "Ctrl+Shift+E",
      run: () => queueScan("document"),
    });
    ctx.commands.register({
      id: "formula-extractor.extract.current-page",
      title: "Extract formulas from current page",
      run: () => queueScan("current-page"),
    });
    ctx.commands.register({
      id: "formula-extractor.extract.selection",
      title: "Extract formulas from selection",
      run: () => queueScan("selection"),
    });
    ctx.commands.register({
      id: "formula-extractor.ocr.selection",
      title: "OCR selected formula region",
      run: () => queueOcrSelectionScan(),
    });
    ctx.commands.register({
      id: "formula-extractor.copy-formula-latex",
      title: "Copy formula as LaTeX",
      run: (payload) => {
        const formulaId = typeof payload === "object" && payload && "formulaId" in payload
          ? String((payload as { formulaId?: unknown }).formulaId ?? "")
          : "";
        return copyFormulaLatex(formulaId);
      },
    });
    ctx.commands.register({
      id: "formula-extractor.copy-formula-markdown",
      title: "Copy formula as Markdown",
      run: (payload) => {
        const formulaId = typeof payload === "object" && payload && "formulaId" in payload
          ? String((payload as { formulaId?: unknown }).formulaId ?? "")
          : "";
        return copyFormulaMarkdown(formulaId);
      },
    });
    ctx.commands.register({
      id: "formula-extractor.copy-formula",
      title: "Copy formula as LaTeX",
      run: (payload) => {
        const formulaId = typeof payload === "object" && payload && "formulaId" in payload
          ? String((payload as { formulaId?: unknown }).formulaId ?? "")
          : "";
        return copyFormulaLatex(formulaId);
      },
    });
    ctx.commands.register({
      id: "formula-extractor.reveal-formula",
      title: "Reveal formula in document",
      run: (payload) => {
        const formulaId = typeof payload === "object" && payload && "formulaId" in payload
          ? String((payload as { formulaId?: unknown }).formulaId ?? "")
          : "";
        return revealFormula(formulaId);
      },
    });
    ctx.commands.register({
      id: "formula-extractor.export-markdown",
      title: "Export formulas.md",
      run: () => exportLatest("markdown"),
    });
    ctx.commands.register({
      id: "formula-extractor.export-latex",
      title: "Export formulas.tex",
      run: () => exportLatest("latex"),
    });
  },
  deactivate() {
    latestResult = null;
    currentContext = null;
    activeScan = null;
  },
};
