import mammoth from "mammoth";
import { FORMULA_EXTRACTOR_PLUGIN_ID } from "@/lib/plugins/defaults";
import type { PluginContext, PluginModule } from "@/lib/plugins/types";
import { extractFormulasFromSource } from "./extractors";
import {
  exportFormulaResultsAsJson,
  exportFormulaResultsAsLatex,
  exportFormulaResultsAsMarkdown,
} from "./export";
import type { FormulaExtractionResult, FormulaExtractionScope } from "./types";

const PANEL_ID = "formula-extractor.results";

let latestResult: FormulaExtractionResult | null = null;
let currentContext: PluginContext | null = null;

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
    const pdfPages = active.viewerType === "pdf"
      ? await ctx.document.getPdfTextPages({
          scope: scope === "current-page" ? "current-page" : "visible",
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

async function copyFormula(formulaId: string) {
  const ctx = currentContext;
  if (!ctx || !latestResult) return;
  const formula = latestResult.formulas.find((item) => item.id === formulaId);
  if (!formula) return;
  await ctx.clipboard.writeText(formula.latex);
  ctx.notice.show("Formula copied as LaTeX.");
}

async function copyAllMarkdown() {
  const ctx = currentContext;
  if (!ctx || !latestResult) return;
  await ctx.clipboard.writeText(exportFormulaResultsAsMarkdown(latestResult.formulas));
  ctx.notice.show("All formulas copied as Markdown.");
}

async function exportLatest(format: "markdown" | "latex" | "json") {
  const ctx = currentContext;
  if (!ctx || !latestResult) return;
  const content = format === "markdown"
    ? exportFormulaResultsAsMarkdown(latestResult.formulas)
    : format === "latex"
      ? exportFormulaResultsAsLatex(latestResult.formulas)
      : exportFormulaResultsAsJson(latestResult.formulas);
  const extension = format === "markdown" ? "md" : format === "latex" ? "tex" : "json";
  const mimeType = format === "json"
    ? "application/json;charset=utf-8"
    : "text/plain;charset=utf-8";
  await ctx.exportFile({
    suggestedName: `formulas.${extension}`,
    content,
    mimeType,
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
          actions: [
            { id: "formula-extractor.extract.document", title: "Rescan" },
            { id: "formula-extractor.copy-all-markdown", title: "Copy Markdown" },
            { id: "formula-extractor.export-markdown", title: "Export .md" },
            { id: "formula-extractor.export-latex", title: "Export .tex" },
            { id: "formula-extractor.export-json", title: "Export .json" },
          ],
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
      actions: [
        { id: "formula-extractor.extract.document", title: "Rescan" },
        { id: "formula-extractor.copy-all-markdown", title: "Copy Markdown" },
        { id: "formula-extractor.export-markdown", title: "Export .md" },
        { id: "formula-extractor.export-latex", title: "Export .tex" },
        { id: "formula-extractor.export-json", title: "Export .json" },
      ],
    });
    ctx.commands.register({
      id: "formula-extractor.extract.document",
      title: "Extract formulas",
      shortcut: "Ctrl+Shift+E",
      run: () => scan("document"),
    });
    ctx.commands.register({
      id: "formula-extractor.extract.current-page",
      title: "Extract formulas from current page",
      run: () => scan("current-page"),
    });
    ctx.commands.register({
      id: "formula-extractor.extract.selection",
      title: "Extract formulas from selection",
      run: () => scan("selection"),
    });
    ctx.commands.register({
      id: "formula-extractor.copy-formula",
      title: "Copy formula as LaTeX",
      run: (payload) => {
        const formulaId = typeof payload === "object" && payload && "formulaId" in payload
          ? String((payload as { formulaId?: unknown }).formulaId ?? "")
          : "";
        return copyFormula(formulaId);
      },
    });
    ctx.commands.register({
      id: "formula-extractor.copy-all-markdown",
      title: "Copy all formulas as Markdown",
      run: copyAllMarkdown,
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
    ctx.commands.register({
      id: "formula-extractor.export-json",
      title: "Export formulas.json",
      run: () => exportLatest("json"),
    });
  },
  deactivate() {
    latestResult = null;
    currentContext = null;
  },
};
