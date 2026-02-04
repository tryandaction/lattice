import {
  normalizeMathDelimiters,
  convertMathmlToLatex,
  convertOmmlToLatex,
  detectLatexPatterns,
} from "@/lib/markdown-converter";

export type FormulaSource = "markdown" | "latex" | "mathml" | "omml" | "unknown";

export interface NormalizedFormula {
  latex: string;
  displayMode: boolean;
  source: FormulaSource;
  warnings: string[];
}

const BLOCK_WRAPPER = /^\$\$([\s\S]+)\$\$$/;
const INLINE_WRAPPER = /^\$([\s\S]+)\$$/;
const BLOCK_ENV_REGEX =
  /\\begin\{(equation|align|gather|multline|cases|matrix|pmatrix|bmatrix|aligned|split|eqnarray)\*?\}/i;

function detectUnbalancedDollar(text: string): boolean {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "$" && text[i - 1] !== "\\") {
      count++;
    }
  }
  return count % 2 === 1;
}

export function normalizeFormulaInput(
  raw: string,
  options: { preferDisplay?: boolean } = {}
): NormalizedFormula {
  const warnings: string[] = [];
  const input = (raw ?? "").trim();

  if (!input) {
    return {
      latex: "",
      displayMode: Boolean(options.preferDisplay),
      source: "unknown",
      warnings: ["empty-input"],
    };
  }

  if (/<math[\s>]/i.test(input)) {
    const latex = convertMathmlToLatex(input).trim();
    return {
      latex,
      displayMode: options.preferDisplay ?? true,
      source: "mathml",
      warnings: latex ? [] : ["mathml-conversion-failed"],
    };
  }

  if (/<m:oMath[\s>]|<oMath[\s>]/i.test(input)) {
    const latex = convertOmmlToLatex(input).trim();
    return {
      latex,
      displayMode: options.preferDisplay ?? true,
      source: "omml",
      warnings: latex ? [] : ["omml-conversion-failed"],
    };
  }

  const normalized = normalizeMathDelimiters(input).trim();

  const blockMatch = normalized.match(BLOCK_WRAPPER);
  if (blockMatch) {
    return {
      latex: blockMatch[1].trim(),
      displayMode: true,
      source: "markdown",
      warnings: [],
    };
  }

  const inlineMatch = normalized.match(INLINE_WRAPPER);
  if (inlineMatch) {
    const inlineLatex = inlineMatch[1].trim();
    const hasNewline = inlineLatex.includes("\n");
    if (hasNewline) {
      warnings.push("inline-math-multiline");
    }
    return {
      latex: inlineLatex,
      displayMode: options.preferDisplay ?? hasNewline,
      source: "markdown",
      warnings,
    };
  }

  if (detectUnbalancedDollar(normalized)) {
    warnings.push("unbalanced-dollar");
  }

  const displayMode =
    options.preferDisplay ?? (normalized.includes("\n") || BLOCK_ENV_REGEX.test(normalized));

  const source: FormulaSource = detectLatexPatterns(normalized) ? "latex" : "unknown";

  return {
    latex: normalized,
    displayMode,
    source,
    warnings,
  };
}

export function wrapLatexForMarkdown(latex: string, displayMode: boolean): string {
  const trimmed = (latex ?? "").trim();
  if (!trimmed) return "";

  if (displayMode) {
    if (trimmed.includes("\n")) {
      return `$$\n${trimmed}\n$$`;
    }
    return `$$${trimmed}$$`;
  }

  return `$${trimmed}$`;
}

export function formatFormulaForClipboard(
  latex: string,
  format: "latex" | "markdown",
  displayMode: boolean
): string {
  const trimmed = (latex ?? "").trim();
  if (!trimmed) return "";
  return format === "markdown"
    ? wrapLatexForMarkdown(trimmed, displayMode)
    : trimmed;
}
