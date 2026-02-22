import katex from "katex";
import { getKaTeXOptions } from "@/lib/katex-config";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Render LaTeX to HTML using KaTeX with fallback
 */
export function renderLatex(latex: string, displayMode: boolean): string {
  try {
    let processedLatex = latex;
    processedLatex = processedLatex.replace(/(?<!\\)%/g, "\\%");
    processedLatex = processedLatex.replace(/(?<!\\)#(?!\d)/g, "\\#");

    return katex.renderToString(processedLatex, {
      ...getKaTeXOptions(displayMode),
      output: "html",
    });
  } catch (error) {
    console.warn("KaTeX render failed:", latex, error);
    const errorMsg = error instanceof Error ? error.message : "Render error";
    const escapedLatex = escapeHtml(latex);
    const delimiter = displayMode ? "$$" : "$";
    return `<span class="formula-error" title="${escapeHtml(errorMsg)}">${delimiter}${escapedLatex}${delimiter}</span>`;
  }
}
