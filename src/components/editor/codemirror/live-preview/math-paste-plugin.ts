/**
 * Math Paste Plugin for CodeMirror Live Preview
 * Detects pasted LaTeX/MathML/OMML and inserts normalized Markdown math.
 */

import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { normalizeFormulaInput, wrapLatexForMarkdown } from "@/lib/formula-utils";
import { detectLatexPatterns } from "@/lib/markdown-converter";

const MATHML_REGEX = /<math[\s>]/i;
const OMML_REGEX = /<m:oMath[\s>]|<oMath[\s>]/i;
const BLOCK_WRAPPER_REGEX =
  /^\s*(\$\$[\s\S]*\$\$|\\\[[\s\S]*\\\]|\\begin\{[a-zA-Z*]+\}[\s\S]*\\end\{[a-zA-Z*]+\})\s*$/;
const INLINE_WRAPPER_REGEX =
  /^\s*(\$[^$\n]+\$|\\\([\s\S]*\\\))\s*$/;

function looksLikeMarkdownBlock(text: string): boolean {
  return /(^|\n)\s*(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>|\|.+\|)/.test(text) ||
    /```[\s\S]*```/.test(text);
}

function isLikelyStandaloneFormula(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (MATHML_REGEX.test(trimmed) || OMML_REGEX.test(trimmed)) return true;
  if (BLOCK_WRAPPER_REGEX.test(trimmed) || INLINE_WRAPPER_REGEX.test(trimmed)) return true;

  if (!detectLatexPatterns(trimmed)) return false;
  if (trimmed.length > 500) return false;
  if (looksLikeMarkdownBlock(trimmed)) return false;

  // Avoid intercepting normal sentences unless explicitly delimited
  if (/[.!?]/.test(trimmed) && !/\\text\{/.test(trimmed)) return false;

  // Allow multi-line LaTeX if it looks like an environment
  if (trimmed.includes("\n") && !/\\begin\{/.test(trimmed)) return false;

  return true;
}

function insertFormula(view: EditorView, latex: string, displayMode: boolean): boolean {
  const markdown = wrapLatexForMarkdown(latex, displayMode);
  if (!markdown) return false;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: markdown },
    selection: EditorSelection.cursor(from + markdown.length),
  });
  return true;
}

/**
 * Create math paste extension
 */
export function createMathPasteExtension() {
  return EditorView.domEventHandlers({
    paste: (event, view) => {
      const clipboardData = event.clipboardData;
      if (!clipboardData) return false;

      const text = clipboardData.getData("text/plain");
      if (!text) return false;

      if (!isLikelyStandaloneFormula(text)) return false;

      const normalized = normalizeFormulaInput(text);
      if (!normalized.latex) return false;

      event.preventDefault();
      event.stopPropagation();
      return insertFormula(view, normalized.latex, normalized.displayMode);
    },
  });
}

export const mathPasteExtension = createMathPasteExtension();
