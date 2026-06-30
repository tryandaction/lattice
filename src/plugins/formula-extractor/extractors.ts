import JSZip from "jszip";
import { convertMathmlToLatex, convertOmmlToLatex, convertTextToLatex, detectLatexPatterns } from "@/lib/markdown-converter";
import { normalizeFormulaInput } from "@/lib/formula-utils";
import type { PluginPdfTextPage, PluginViewerType } from "@/lib/plugins/types";
import type {
  ExtractedFormula,
  FormulaExtractionResult,
  FormulaExtractionSource,
  FormulaExtractionScope,
  HiddenFormulaCandidate,
  HiddenFormulaCandidateReason,
} from "./types";

type Candidate = Omit<ExtractedFormula, "id"> & { order?: number };
type FormulaBBox = NonNullable<ExtractedFormula["bbox"]>;
type PdfTextItem = NonNullable<PluginPdfTextPage["items"]>[number];
type CandidateCollector = {
  accepted: Candidate[];
  hidden: HiddenFormulaCandidate[];
};

const EXPLICIT_MATH_PATTERNS: Array<{ regex: RegExp; displayMode: boolean }> = [
  { regex: /(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$/g, displayMode: true },
  { regex: /\\\[([\s\S]+?)\\\]/g, displayMode: true },
  { regex: /\\\(([\s\S]+?)\\\)/g, displayMode: false },
  { regex: /(?<!\\)(?<!\$)\$(?!\$)([^$\n]+?)(?<!\\)\$(?!\$)/g, displayMode: false },
];

const SYMBOLIC_MATH_RE = /[=+\-/*^_{}()[\]<>|]|[\u00B1\u00D7\u00F7\u2200-\u22FF]/;
const GREEK_RE = /[\u0370-\u03FF]/;
const LATEX_COMMAND_RE = /\\[a-zA-Z]+(?:\{[^{}]*\})?/;
const WORD_RE = /[A-Za-z]{2,}/g;
const EQUATION_NUMBER_RE = /^\(?\d+(?:\.\d+)?\)?$/;
const INLINE_PROSE_END_RE = /[.!?。！？]$/;
const SENTENCE_START_RE = /^(the|this|that|these|those|where|when|because|therefore|from|with|using|figure|table|section)\b/i;
const MATH_VARIABLE_RE = /(?:^|[^A-Za-z])(?:[A-Za-z]|[\u0370-\u03FF])(?:\s*(?:[_^]\s*(?:\{[^{}]+\}|[A-Za-z0-9\\]+)|\d+))?(?:[^A-Za-z]|$)/;
const INLINE_PROSE_TERMINATOR_RE = /[.!?。！？]$/;
const RELATION_RE = /[=≈≃≅∼≡≤≥<>]/;

const GREEK_LATEX: Record<string, string> = {
  α: "\\alpha", β: "\\beta", γ: "\\gamma", δ: "\\delta", ε: "\\epsilon", ζ: "\\zeta",
  η: "\\eta", θ: "\\theta", ι: "\\iota", κ: "\\kappa", λ: "\\lambda", μ: "\\mu",
  ν: "\\nu", ξ: "\\xi", π: "\\pi", ρ: "\\rho", σ: "\\sigma", τ: "\\tau",
  υ: "\\upsilon", φ: "\\phi", χ: "\\chi", ψ: "\\psi", ω: "\\omega",
  ϕ: "\\varphi", ϵ: "\\varepsilon", ϑ: "\\vartheta", ϱ: "\\varrho", ς: "\\varsigma",
  Γ: "\\Gamma", Δ: "\\Delta", Θ: "\\Theta", Λ: "\\Lambda", Ξ: "\\Xi", Π: "\\Pi",
  Σ: "\\Sigma", Υ: "\\Upsilon", Φ: "\\Phi", Ψ: "\\Psi", Ω: "\\Omega",
};

const MATH_SYMBOL_LATEX: Record<string, string> = {
  "−": "-", "–": "-", "—": "-", "∕": "/", "⁄": "/",
  "×": "\\times", "·": "\\cdot", "⋅": "\\cdot", "±": "\\pm", "∓": "\\mp",
  "≤": "\\leq", "≥": "\\geq", "≠": "\\neq", "≈": "\\approx", "≃": "\\simeq",
  "≅": "\\cong", "≡": "\\equiv", "∼": "\\sim", "∝": "\\propto",
  "∞": "\\infty", "∂": "\\partial", "∇": "\\nabla", "√": "\\sqrt{}",
  "∫": "\\int", "∑": "\\sum", "∏": "\\prod",
  "→": "\\rightarrow", "←": "\\leftarrow", "↔": "\\leftrightarrow",
  "⇒": "\\Rightarrow", "⇐": "\\Leftarrow", "⇔": "\\Leftrightarrow",
  "⟨": "\\langle", "⟩": "\\rangle", "〈": "\\langle", "〉": "\\rangle",
  "′": "'", "″": "''", "‴": "'''",
};

const SUPERSCRIPT_LATEX: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-", "⁼": "=", "⁽": "(", "⁾": ")", "ⁿ": "n", "ⁱ": "i",
  "ᵃ": "a", "ᵇ": "b", "ᶜ": "c", "ᵈ": "d", "ᵉ": "e", "ᶠ": "f", "ᵍ": "g", "ʰ": "h", "ʲ": "j",
  "ᵏ": "k", "ˡ": "l", "ᵐ": "m", "ᵒ": "o", "ᵖ": "p", "ʳ": "r", "ˢ": "s", "ᵗ": "t",
  "ᵘ": "u", "ᵛ": "v", "ʷ": "w", "ˣ": "x", "ʸ": "y", "ᶻ": "z",
};

const SUBSCRIPT_LATEX: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  "₊": "+", "₋": "-", "₌": "=", "₍": "(", "₎": ")",
  "ₐ": "a", "ₑ": "e", "ₕ": "h", "ᵢ": "i", "ⱼ": "j", "ₖ": "k", "ₗ": "l", "ₘ": "m",
  "ₙ": "n", "ₒ": "o", "ₚ": "p", "ᵣ": "r", "ₛ": "s", "ₜ": "t", "ᵤ": "u", "ₓ": "x",
};

const COMMON_PROSE_TOKENS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "for", "from", "in", "is", "it",
  "of", "on", "or", "so", "the", "to", "we", "with", "where", "which", "while", "when",
]);

function getWordMatches(text: string): string[] {
  return text.match(WORD_RE) ?? [];
}

function hasStrongMathCore(text: string): boolean {
  return (
    /[A-Za-z\u0370-\u03FF0-9)}\\]\s*(?:=|\u2248|\u2243|\u2245|\u2264|\u2265|<|>)\s*[A-Za-z\u0370-\u03FF0-9({\\]/.test(text) ||
    /\\(?:frac|sum|int|prod|sqrt|partial|nabla|lim|sin|cos|tan|log|exp|hbar|tau|alpha|beta|gamma|delta|mu|pi|lambda|Delta|Gamma)\b/.test(text) ||
    /[\u2211\u222B\u220F\u221A\u2202\u2207]/.test(text)
  );
}

function isProseDominatedFormulaCandidate(text: string): boolean {
  const trimmed = text.trim();
  const words = getWordMatches(trimmed);
  if (words.length < 12 && trimmed.length <= 180) return false;

  const commonTokenCount = words.filter((word) => COMMON_PROSE_TOKENS.has(word.toLowerCase())).length;
  const longWordCount = words.filter((word) => word.length >= 5).length;
  const proseRatio = words.length > 0 ? commonTokenCount / words.length : 0;
  const sentenceLike = /[.!?]\s+(?:[A-Z]|The|This|These|However|Nevertheless)\b/.test(trimmed);
  const strongMathCore = hasStrongMathCore(trimmed);
  const mathCommandCount = (trimmed.match(/\\[A-Za-z]+/g) ?? []).length;

  if (!strongMathCore && (words.length >= 12 || sentenceLike)) return true;
  if (words.length >= 18 && longWordCount >= 6 && mathCommandCount <= 2) return true;
  if (words.length >= 14 && proseRatio >= 0.2 && mathCommandCount <= 2) return true;
  return false;
}

function hasSuspiciousPdfTextLayerNoise(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.length > 220 && !hasStrongMathCore(trimmed)) return true;
  if (isProseDominatedFormulaCandidate(trimmed)) return true;
  const replacementLikeCount = (trimmed.match(/[□�]/g) ?? []).length;
  if (replacementLikeCount >= 3 && getWordMatches(trimmed).length >= 8) return true;
  return false;
}

function hidePdfCandidate(
  collector: CandidateCollector,
  input: {
    page?: number;
    reason: HiddenFormulaCandidateReason;
    rawText: string;
    score?: number;
    bbox?: FormulaBBox;
  },
) {
  const rawText = input.rawText.trim();
  if (!rawText) return;
  const duplicate = collector.hidden.some((candidate) => (
    candidate.page === input.page &&
    candidate.rawText === rawText &&
    candidate.reason === input.reason
  ));
  if (duplicate) return;
  collector.hidden.push({
    page: input.page,
    reason: input.reason,
    rawText,
    score: input.score,
    bbox: input.bbox,
  });
}

function getFormulaStructureFeatures(text: string) {
  const normalized = normalizePhysicsFormulaText(text);
  const words = getWordMatches(text);
  const relation = /[A-Za-z\u0370-\u03FF0-9)}\\]\s*(?:=|\u2248|\u2243|\u2245|\u2264|\u2265|<|>)\s*[A-Za-z\u0370-\u03FF0-9({\\]/.test(text);
  const command = /\\(?:frac|sum|int|prod|sqrt|partial|nabla|lim|sin|cos|tan|log|exp|hbar|tau|alpha|beta|gamma|delta|mu|pi|lambda|Delta|Gamma|left|right|begin|end)\b/.test(normalized);
  const operator = /[\u2211\u222B\u220F\u221A\u2202\u2207]/.test(text) || /\\(?:sum|int|prod|sqrt|frac)\b/.test(normalized);
  const fraction = /\\frac\{|(?:^|[^A-Za-z])(?:\d+|[A-Za-z\\][A-Za-z0-9\\{}_^]*)\s*\/\s*(?:\d+|[A-Za-z\\][A-Za-z0-9\\{}_^]*)/.test(normalized);
  const scripts = /[A-Za-z\u0370-\u03FF0-9\\][_^](?:\{|[A-Za-z0-9\\])|[A-Za-z\u0370-\u03FF]\d/.test(normalized);
  const bracketStructure = /(?:\\left|[([{|])[^.!?]{1,160}(?:\\right|[\])}>])/.test(normalized);
  const symbolCount = [...normalized].filter((char) => /[=+\-/*^_{}()[\]<>|\\]|\d|[\u00B1\u00D7\u00F7\u2200-\u22FF]/.test(char)).length;
  const symbolDensity = symbolCount / Math.max(1, normalized.replace(/\s+/g, "").length);
  const proseWords = words.filter((word) => COMMON_PROSE_TOKENS.has(word.toLowerCase())).length;
  return {
    normalized,
    words,
    relation,
    command,
    operator,
    fraction,
    scripts,
    bracketStructure,
    symbolDensity,
    proseWords,
    structureCount: [relation, command, operator, fraction, scripts, bracketStructure].filter(Boolean).length,
  };
}

function consumeScriptRun(input: string, start: number, map: Record<string, string>): { value: string; end: number } {
  let value = "";
  let index = start;
  while (index < input.length) {
    const char = input[index];
    const mapped = map[char];
    if (!mapped) break;
    value += mapped;
    index += char.length;
  }
  return { value, end: index };
}

function normalizePhysicsFormulaText(raw: string): string {
  if (/\\[A-Za-z]+/.test(raw)) {
    return raw.trim();
  }
  let text = raw
    .replace(/\u00A0/g, " ")
    .replace(/[−–—]/g, "-")
    .replace(/[∕⁄]/g, "/")
    .replace(/\s+/g, " ")
    .trim();

  text = text.replace(/\br\s*\|\s*r\s*\|\s*r\b/g, "r | r | r");

  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (SUPERSCRIPT_LATEX[char]) {
      const run = consumeScriptRun(text, index, SUPERSCRIPT_LATEX);
      result += `^{${run.value}}`;
      index = run.end - 1;
      continue;
    }
    if (SUBSCRIPT_LATEX[char]) {
      const run = consumeScriptRun(text, index, SUBSCRIPT_LATEX);
      result += `_{${run.value}}`;
      index = run.end - 1;
      continue;
    }
    result += GREEK_LATEX[char] ?? MATH_SYMBOL_LATEX[char] ?? char;
  }

  return result
    .replace(/\\(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|varphi|varepsilon|vartheta|varrho|varsigma)([A-Za-z]{1,4})(?=\b|[()=+\-*/\]\s])/g, "\\$1_{$2}")
    .replace(/\b([A-Za-z\\]+)(\d+)\b/g, "$1_{$2}")
    .replace(/\b([A-Za-z])\s+(\d{1,3})(?=\s*(?:[({=+\-*/<>]|$))/g, "$1_{$2}")
    .replace(/\\(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|varphi|varepsilon|vartheta|varrho|varsigma|Delta|Gamma|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)\s+([A-Za-z0-9]{1,4})(?=\s*(?:[({=+\-*/<>]|$))/g, "\\$1_{$2}")
    .replace(/([A-Za-z\\])\s+_\{/g, "$1_{")
    .replace(/([A-Za-z\\])\s+\^\{/g, "$1^{")
    .replace(/\s*([=+\-*/<>])\s*/g, " $1 ")
    .replace(/\s*(\\(?:leq|geq|neq|approx|simeq|cong|equiv|sim|propto|times|cdot))\s*/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLatex(raw: string, displayMode: boolean): { latex: string; displayMode: boolean } {
  const normalized = normalizeFormulaInput(normalizePhysicsFormulaText(raw), { preferDisplay: displayMode });
  return {
    latex: normalized.latex || raw.trim(),
    displayMode: normalized.displayMode || displayMode,
  };
}

function isLikelyProse(text: string): boolean {
  const trimmed = text.trim();
  const words = trimmed.match(WORD_RE) ?? [];
  if (RELATION_RE.test(trimmed) || LATEX_COMMAND_RE.test(trimmed)) return false;
  if (words.length >= 9 && !LATEX_COMMAND_RE.test(trimmed)) return true;
  if (SENTENCE_START_RE.test(trimmed) && words.length >= 5) return true;
  if (INLINE_PROSE_END_RE.test(trimmed) && words.length >= 6 && !LATEX_COMMAND_RE.test(trimmed)) return true;
  if (INLINE_PROSE_TERMINATOR_RE.test(trimmed) && words.length >= 6 && !LATEX_COMMAND_RE.test(trimmed)) return true;
  return false;
}

function buildTarget(candidate: Pick<Candidate, "source" | "page" | "bbox" | "rawText" | "location">) {
  return {
    viewerType: candidate.source,
    page: candidate.page,
    bbox: candidate.bbox,
    quote: candidate.rawText,
    location: candidate.location,
  };
}

function pushCandidate(candidates: Candidate[], candidate: Candidate) {
  const latex = candidate.latex.trim();
  if (!latex) return;
  if (latex.length === 1 && !/[a-zA-Z\u0370-\u03FF0-9]/.test(latex)) return;
  if (
    candidate.source === "pdf" &&
    candidate.kind === "text-layer" &&
    (hasSuspiciousPdfTextLayerNoise(candidate.rawText) || hasSuspiciousPdfTextLayerNoise(latex))
  ) {
    return;
  }
  if (isLikelyProse(latex) && candidate.confidence < 0.9) return;
  const duplicate = candidates.some((item) => (
    item.latex === latex &&
    item.source === candidate.source &&
    item.page === candidate.page &&
    (item.location === candidate.location || candidate.source === "pdf")
  ));
  if (duplicate) return;
  candidates.push({
    ...candidate,
    latex,
    target: candidate.target ?? buildTarget(candidate),
  });
}

function mergeBboxes(boxes: Array<FormulaBBox | undefined>): FormulaBBox | undefined {
  const valid = boxes.filter((box): box is FormulaBBox => Boolean(box));
  if (valid.length === 0) return undefined;
  return {
    x1: Math.max(0, Math.min(...valid.map((box) => box.x1))),
    y1: Math.max(0, Math.min(...valid.map((box) => box.y1))),
    x2: Math.min(1, Math.max(...valid.map((box) => box.x2))),
    y2: Math.min(1, Math.max(...valid.map((box) => box.y2))),
  };
}

function buildContext(text: string, start: number, end: number): string {
  const left = text.slice(Math.max(0, start - 80), start).trim();
  const right = text.slice(end, Math.min(text.length, end + 80)).trim();
  return [left, right].filter(Boolean).join(" ... ");
}

function finalize(candidates: Candidate[]): ExtractedFormula[] {
  return [...candidates].sort((left, right) => (left.order ?? 0) - (right.order ?? 0)).map((candidate, index) => ({
    source: candidate.source,
    kind: candidate.kind,
    page: candidate.page,
    location: candidate.location,
    bbox: candidate.bbox,
    target: candidate.target ?? buildTarget(candidate),
    latex: candidate.latex,
    rawText: candidate.rawText,
    displayMode: candidate.displayMode,
    context: candidate.context,
    id: `formula-${index + 1}`,
    confidence: Math.max(0, Math.min(1, candidate.confidence)),
    needsReview: candidate.needsReview ?? candidate.confidence < 0.72,
  }));
}

function extractDelimitedFormulas(input: {
  text: string;
  source: PluginViewerType;
  page?: number;
  location?: string;
  baseConfidence?: number;
  bbox?: FormulaBBox;
}): Candidate[] {
  const candidates: Candidate[] = [];
  const occupied: Array<{ start: number; end: number }> = [];

  for (const pattern of EXPLICIT_MATH_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(input.text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (occupied.some((range) => start < range.end && end > range.start)) {
        continue;
      }
      occupied.push({ start, end });
      const normalized = normalizeLatex(match[1], pattern.displayMode);
      pushCandidate(candidates, {
        source: input.source,
        kind: "explicit",
        page: input.page,
        location: input.location,
        bbox: input.bbox,
        confidence: input.baseConfidence ?? 0.96,
        latex: normalized.latex,
        rawText: match[0],
        displayMode: normalized.displayMode,
        context: buildContext(input.text, start, end),
        order: start,
      });
    }
  }

  return candidates;
}

function scoreFormulaLikeText(text: string): number {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 3) return 0;
  if (EQUATION_NUMBER_RE.test(trimmed)) return 0;
  if (/^\[[\d,\s-]+\]$/.test(trimmed)) return 0;
  if (trimmed.length > 260 && !LATEX_COMMAND_RE.test(trimmed)) return 0;
  if (isProseDominatedFormulaCandidate(trimmed)) return 0;
  if (isLikelyProse(trimmed)) return 0;

  const compact = trimmed.replace(/\s+/g, "");
  const wordMatches = getWordMatches(trimmed);
  const longWords = wordMatches.filter((word) => word.length >= 5).length;
  const symbolCount = [...trimmed].filter((char) => /[=+\-/*^_{}()[\]<>]|[\u00B1\u00D7\u00F7\u2200-\u22FF]/.test(char)).length;
  const digitCount = [...trimmed].filter((char) => /\d/.test(char)).length;
  const hasLatex = detectLatexPatterns(trimmed) || LATEX_COMMAND_RE.test(trimmed);
  const hasGreek = GREEK_RE.test(trimmed);
  const hasEquation = /[A-Za-z\u0370-\u03FF0-9)}\\]\s*(?:=|\u2248|\u2243|\u2245|\u2264|\u2265|<|>)\s*[A-Za-z\u0370-\u03FF0-9({\\]/.test(trimmed);
  const hasSubSup = /[A-Za-z\u0370-\u03FF0-9\\][_^][{A-Za-z0-9\\]/.test(trimmed) || /[A-Za-z\u0370-\u03FF]\d/.test(trimmed) || /[₀-₉⁰-⁹ᵃ-ᶻ]/.test(trimmed);
  const hasOperator = /(?:\\(?:sum|int|prod|frac|sqrt|partial|nabla|lim|sin|cos|tan|log|exp)\b|[\u2211\u222B\u220F\u221A\u2202\u2207])/.test(trimmed);
  const hasBracketedQuantumState = /[|⟨〈].+[>⟩〉|]/.test(trimmed);
  const hasMatrixElement = /[⟨〈<].+\|.+\|.+[⟩〉>]/.test(trimmed);
  const hasFractionLike = /(?:^|[^A-Za-z])\d+\s*\/\s*[A-Za-z0-9\\]|[A-Za-z0-9\\]\s*\/\s*[A-Za-z0-9\\]/.test(trimmed);
  const hasPhysicsSymbol = /\\(?:tau|alpha|beta|gamma|delta|mu|pi|hbar|ell|lambda|Delta|Gamma)\b/.test(normalizePhysicsFormulaText(trimmed));
  const hasVariable = MATH_VARIABLE_RE.test(trimmed);
  const proseTokenCount = wordMatches.filter((word) => COMMON_PROSE_TOKENS.has(word.toLowerCase())).length;

  let score = 0;
  if (hasLatex) score += 0.46;
  if (hasEquation) score += 0.48;
  if (hasOperator) score += 0.22;
  if (hasGreek) score += 0.16;
  if (hasSubSup) score += 0.18;
  if (hasBracketedQuantumState) score += 0.24;
  if (hasMatrixElement) score += 0.34;
  if (hasFractionLike) score += 0.18;
  if (hasPhysicsSymbol) score += 0.18;
  if (hasVariable && symbolCount > 0) score += 0.08;
  if (hasEquation && symbolCount >= 1) score += 0.08;
  if (symbolCount >= 2) score += 0.18;
  if (digitCount > 0 && symbolCount > 0) score += 0.08;
  if (compact.length <= 140 && wordMatches.length <= 10) score += 0.08;
  if (compact.length <= 6 && !hasEquation && !hasLatex && !hasOperator) score -= 0.22;
  if (longWords >= 3 && !hasLatex && !hasEquation) score -= 0.28;
  if (proseTokenCount >= 4 && !hasEquation && !hasLatex) score -= 0.28;
  if (!SYMBOLIC_MATH_RE.test(trimmed) && !hasGreek && !hasLatex) score -= 0.4;
  if (INLINE_PROSE_TERMINATOR_RE.test(trimmed) && wordMatches.length > 5 && !hasLatex && !hasEquation) score -= 0.24;

  return Math.max(0, Math.min(1, score));
}

function extractEquationBody(line: string): string {
  const withoutTrailingNumber = line.replace(/\s+\(?\d+(?:\.\d+)?\)?$/, "").trim();
  const colonTail = withoutTrailingNumber.includes(":")
    ? withoutTrailingNumber.slice(withoutTrailingNumber.lastIndexOf(":") + 1).trim()
    : "";
  if (colonTail && scoreFormulaLikeText(colonTail) >= scoreFormulaLikeText(withoutTrailingNumber)) {
    return colonTail;
  }
  return withoutTrailingNumber;
}

function extractHeuristicFormulaLines(input: {
  text: string;
  source: PluginViewerType;
  page?: number;
  locationPrefix?: string;
  baseConfidence?: number;
  bbox?: FormulaBBox;
}): Candidate[] {
  const candidates: Candidate[] = [];
  const lines = input.text
    .split(/\r?\n|(?<=\s)\s{2,}/)
    .map((line) => line.trim())
    .filter(Boolean);

  lines.forEach((line, index) => {
    const formulaText = extractEquationBody(line);
    const score = scoreFormulaLikeText(formulaText);
    const threshold = input.source === "pdf" ? 0.64 : 0.6;
    if (score < threshold) return;
    const derivedFromContextLine = formulaText !== line.replace(/\s+\(?\d+(?:\.\d+)?\)?$/, "").trim();
    const needsReview = score < 0.72 || (input.source === "pdf" && derivedFromContextLine);
    const confidenceCap = needsReview ? 0.76 : 0.9;
    const normalized = normalizeLatex(convertTextToLatex(formulaText), score >= 0.78);
    pushCandidate(candidates, {
      source: input.source,
      kind: "text-layer",
      page: input.page,
      location: input.locationPrefix ? `${input.locationPrefix}:${index + 1}` : `line:${index + 1}`,
      bbox: input.bbox,
      confidence: Math.min(confidenceCap, Math.max(input.baseConfidence ?? 0.62, score)),
      latex: normalized.latex,
      rawText: line,
      displayMode: normalized.displayMode || score >= 0.78,
      context: line,
      needsReview,
      order: index,
    });
  });

  return candidates;
}

export function extractMarkdownFormulas(text: string, source: PluginViewerType = "md"): ExtractedFormula[] {
  return finalize([
    ...extractDelimitedFormulas({ text, source, baseConfidence: 0.98 }),
  ]);
}

function extractHtmlMathNodes(html: string): Candidate[] {
  if (typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const candidates: Candidate[] = [];

  doc.querySelectorAll("script[type^='math/tex']").forEach((node, index) => {
    const raw = node.textContent ?? "";
    const displayMode = /mode=display/i.test(node.getAttribute("type") ?? "");
    const normalized = normalizeLatex(raw, displayMode);
    pushCandidate(candidates, {
      source: "html",
      kind: "explicit",
      location: `math-script:${index + 1}`,
      confidence: 0.98,
      latex: normalized.latex,
      rawText: raw,
      displayMode: normalized.displayMode,
    });
  });

  doc.querySelectorAll("annotation[encoding='application/x-tex'], annotation[encoding='application/x-latex']").forEach((node, index) => {
    const raw = node.textContent ?? "";
    const normalized = normalizeLatex(raw, true);
    pushCandidate(candidates, {
      source: "html",
      kind: "explicit",
      location: `tex-annotation:${index + 1}`,
      confidence: 0.96,
      latex: normalized.latex,
      rawText: raw,
      displayMode: normalized.displayMode,
    });
  });

  doc.querySelectorAll("math").forEach((node, index) => {
    const raw = node.outerHTML;
    const latex = convertMathmlToLatex(raw).trim();
    if (!latex) return;
    pushCandidate(candidates, {
      source: "html",
      kind: "mathml",
      location: `mathml:${index + 1}`,
      confidence: 0.9,
      latex,
      rawText: raw,
      displayMode: true,
    });
  });

  doc.querySelectorAll("[data-latex], [latex]").forEach((node, index) => {
    const element = node as HTMLElement;
    const raw = element.getAttribute("data-latex") ?? element.getAttribute("latex") ?? "";
    const normalized = normalizeLatex(raw, element.className.includes("block"));
    pushCandidate(candidates, {
      source: "html",
      kind: "explicit",
      location: `latex-attribute:${index + 1}`,
      confidence: 0.94,
      latex: normalized.latex,
      rawText: raw,
      displayMode: normalized.displayMode,
    });
  });

  return candidates;
}

export function extractHtmlFormulas(html: string): ExtractedFormula[] {
  return finalize([
    ...extractHtmlMathNodes(html),
    ...extractDelimitedFormulas({ text: html, source: "html", baseConfidence: 0.92 }),
  ]);
}

type PdfVisualLine = {
  items: Array<PdfTextItem & { order: number }>;
  text: string;
  bbox?: FormulaBBox;
  top: number;
  bottom: number;
  left: number;
  right: number;
  lineIndex: number;
  blockIndex?: number;
  columnIndex?: number;
};

function getItemTop(item: PdfTextItem): number {
  return item.bbox?.y1 ?? 0;
}

function getItemLeft(item: PdfTextItem): number {
  return item.bbox?.x1 ?? 0;
}

function joinPdfLineItems(items: PdfTextItem[]): string {
  let text = "";
  for (const item of items) {
    const part = (item.normalizedText || item.text || "").trim();
    if (!part) continue;
    const previous = text[text.length - 1] ?? "";
    const next = part[0] ?? "";
    const needsSpace = Boolean(previous && next && (
      /[=<>+\-*/]/.test(previous) ||
      /[=<>+\-*/]/.test(next) ||
      (/[A-Za-z0-9)}\]]/.test(previous) && /[A-Za-z0-9({[\\]/.test(next))
    ));
    text += `${needsSpace ? " " : ""}${part}`;
  }
  return text.trim();
}

function createPdfVisualLine(items: Array<PdfTextItem & { order: number }>, fallbackIndex: number): PdfVisualLine {
  const ordered = items.slice().sort((left, right) => getItemLeft(left) - getItemLeft(right) || left.order - right.order);
  const bbox = mergeBboxes(ordered.map((item) => item.bbox));
  return {
    items: ordered,
    text: joinPdfLineItems(ordered),
    bbox,
    top: bbox?.y1 ?? Math.min(...ordered.map(getItemTop)),
    bottom: bbox?.y2 ?? Math.max(...ordered.map((item) => item.bbox?.y2 ?? getItemTop(item))),
    left: bbox?.x1 ?? Math.min(...ordered.map(getItemLeft)),
    right: bbox?.x2 ?? Math.max(...ordered.map((item) => item.bbox?.x2 ?? getItemLeft(item))),
    lineIndex: ordered[0]?.lineIndex ?? fallbackIndex,
    blockIndex: ordered[0]?.blockIndex,
    columnIndex: ordered[0]?.columnIndex,
  };
}

function groupPdfItemsByVisualLine(items: PdfTextItem[]): PdfVisualLine[] {
  const indexed = items
    .map((item, order) => ({ ...item, order }))
    .filter((item) => (item.normalizedText || item.text || "").trim())
    .sort((left, right) => (
      (left.columnIndex ?? 0) - (right.columnIndex ?? 0) ||
      getItemTop(left) - getItemTop(right) ||
      getItemLeft(left) - getItemLeft(right) ||
      left.order - right.order
    ));

  if (indexed.length === 0) return [];

  const buckets: Array<Array<PdfTextItem & { order: number }>> = [];
  indexed.forEach((item) => {
    const itemCenterY = item.bbox ? (item.bbox.y1 + item.bbox.y2) / 2 : getItemTop(item);
    const explicitKeyMatch = buckets.find((bucket) => {
      const first = bucket[0];
      if (!first) return false;
      const firstCenterY = first.bbox ? (first.bbox.y1 + first.bbox.y2) / 2 : getItemTop(first);
      const firstHeight = Math.max(0.006, (first.bbox?.y2 ?? firstCenterY) - (first.bbox?.y1 ?? firstCenterY));
      const itemHeight = Math.max(0.006, (item.bbox?.y2 ?? itemCenterY) - (item.bbox?.y1 ?? itemCenterY));
      const geometricallySameRow = !first.bbox || !item.bbox
        ? true
        : Math.abs(itemCenterY - firstCenterY) <= Math.max(0.018, Math.max(firstHeight, itemHeight) * 1.35);
      return (
        typeof item.lineIndex === "number" &&
        typeof first.lineIndex === "number" &&
        item.lineIndex === first.lineIndex &&
        (
          item.blockIndex === undefined ||
          first.blockIndex === undefined ||
          item.blockIndex === first.blockIndex
        ) &&
        (
          item.columnIndex === undefined ||
          first.columnIndex === undefined ||
          item.columnIndex === first.columnIndex
        ) &&
        geometricallySameRow
      );
    });
    if (explicitKeyMatch) {
      explicitKeyMatch.push(item);
      return;
    }

    const geometricMatch = buckets.find((bucket) => {
      const line = createPdfVisualLine(bucket, buckets.indexOf(bucket));
      const sameBlock = (
        item.blockIndex === undefined ||
        line.blockIndex === undefined ||
        item.blockIndex === line.blockIndex
      );
      if (!sameBlock) {
        return false;
      }
      const lineCenterY = (line.top + line.bottom) / 2;
      const lineHeight = Math.max(0.006, line.bottom - line.top);
      const itemHeight = Math.max(0.006, (item.bbox?.y2 ?? itemCenterY) - (item.bbox?.y1 ?? itemCenterY));
      const sameColumn = (item.columnIndex ?? line.columnIndex ?? 0) === (line.columnIndex ?? item.columnIndex ?? 0);
      const looksLikeScript = Math.min(lineHeight, itemHeight) <= Math.max(lineHeight, itemHeight) * 0.72;
      return sameColumn && (
        Math.abs(itemCenterY - lineCenterY) <= Math.max(0.01, Math.max(lineHeight, itemHeight) * 0.72) ||
        (
          looksLikeScript &&
          item.bbox &&
          item.bbox.x1 >= line.left - 0.02 &&
          item.bbox.x1 <= line.right + 0.08 &&
          Math.max(0, Math.max(line.top, item.bbox.y1) - Math.min(line.bottom, item.bbox.y2)) <= Math.max(0.012, lineHeight * 0.5)
        )
      );
    });

    if (geometricMatch) {
      geometricMatch.push(item);
    } else {
      buckets.push([item]);
    }
  });

  return buckets
    .map((bucket, index) => createPdfVisualLine(bucket, index))
    .sort((left, right) => (
      (left.columnIndex ?? 0) - (right.columnIndex ?? 0) ||
      left.top - right.top ||
      left.left - right.left
    ));
}

function isLikelyEquationNumberLine(line: PdfVisualLine): boolean {
  return EQUATION_NUMBER_RE.test(line.text.trim()) && line.text.trim().length <= 6;
}

function getPdfLineFormulaText(line: PdfVisualLine): string {
  const raw = extractEquationBody(line.text);
  return normalizePhysicsFormulaText(raw)
    .replace(/\b([A-Za-z\\]+)_\{?(\d+)\}?\s*\/\s*([A-Za-z0-9\\{}]+)\b/g, "\\frac{$1_{$2}}{$3}")
    .replace(/\b1\s*\/\s*([A-Za-z\\]+_\{?[^{}\s]+\}?)\b/g, "\\frac{1}{$1}");
}

function shouldKeepPdfFormulaLine(line: PdfVisualLine, score: number): boolean {
  if (score >= 0.58) return true;
  const text = line.text.trim();
  if (RELATION_RE.test(text) && /[A-Za-z\u0370-\u03FF\\]/.test(text) && score >= 0.44) return true;
  if (/[₀-₉⁰-⁹ᵃ-ᶻ]/.test(text) && SYMBOLIC_MATH_RE.test(text) && score >= 0.42) return true;
  return false;
}

type PdfDisplayFormulaLineVerdict =
  | { accepted: true; formulaText: string; score: number }
  | { accepted: false; reason: HiddenFormulaCandidateReason; formulaText: string; score: number };

function getPdfDisplayLineFormulaText(line: PdfVisualLine): string {
  const raw = extractEquationBody(line.text);
  return normalizePhysicsFormulaText(raw)
    .replace(/\b([A-Za-z\\]+)_\{?(\d+)\}?\s*\/\s*([A-Za-z0-9\\{}]+)\b/g, "\\frac{$1_{$2}}{$3}")
    .replace(/\b([A-Za-z\\]+)\s*\/\s*([A-Za-z0-9\\{}]+)\b/g, "\\frac{$1}{$2}")
    .replace(/\b1\s*\/\s*([A-Za-z\\]+_\{?[^{}\s]+\}?)\b/g, "\\frac{1}{$1}");
}

function getPdfDisplayLineWidth(line: PdfVisualLine): number {
  return Math.max(0, line.right - line.left);
}

function getPdfDisplayLineHeight(line: PdfVisualLine): number {
  return Math.max(0.004, line.bottom - line.top);
}

function getPdfDisplayLineCenterX(line: PdfVisualLine): number {
  return (line.left + line.right) / 2;
}

function isCitationOrNumberOnly(text: string): boolean {
  const trimmed = text.trim();
  return (
    EQUATION_NUMBER_RE.test(trimmed) ||
    /^\(?\d+(?:\.\d+)*\)?$/.test(trimmed) ||
    /^\[[\d,\s-]+\]$/.test(trimmed)
  );
}

function hasPdfDisplayFormulaLayout(line: PdfVisualLine, structureCount: number): boolean {
  const width = getPdfDisplayLineWidth(line);
  const centerDistance = Math.abs(getPdfDisplayLineCenterX(line) - 0.5);
  const columnWidth = line.columnIndex === undefined ? 1 : 0.5;
  return (
    width <= columnWidth * 0.74 ||
    centerDistance <= 0.2 ||
    structureCount >= 3
  );
}

function isPdfDisplayFormulaProseLike(text: string, structureCount: number, symbolDensity: number): boolean {
  const trimmed = text.trim();
  const words = getWordMatches(trimmed);
  if (words.length === 0) return false;
  const proseRatio = words.filter((word) => COMMON_PROSE_TOKENS.has(word.toLowerCase())).length / words.length;
  const sentenceBreaks = (trimmed.match(/[.!?]\s+[A-Z]/g) ?? []).length;
  const longAlphaRuns = (trimmed.match(/[A-Za-z]{14,}/g) ?? []).length;
  const captionWords = words.filter((word) => /^(article|figure|fig|table|extended|data|preparation|circuit|prepared|adding|extra|gates?|doi|nature|physics)$/i.test(word)).length;
  if (trimmed.length > 180 && words.length >= 18 && structureCount <= 2) return true;
  if (sentenceBreaks >= 1 && words.length >= 10 && structureCount <= 2) return true;
  if (SENTENCE_START_RE.test(trimmed) && words.length >= 7 && structureCount <= 2) return true;
  if (captionWords >= 2 && words.length >= 5) return true;
  if (longAlphaRuns >= 1 && words.length >= 3 && structureCount <= 2) return true;
  if (words.length >= 14 && proseRatio >= 0.22 && structureCount <= 2 && symbolDensity < 0.34) return true;
  return false;
}

function isPdfMetadataOrUrlText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    /https?:\/\/|www\.|doi\.org|10\.\d{4,9}\//.test(normalized) ||
    /^article\s+https?:/.test(normalized) ||
    /^article\s+doi/.test(normalized) ||
    /\bnature\s+physics\b/.test(normalized)
  );
}

function hasDisplayFormulaCore(features: ReturnType<typeof getFormulaStructureFeatures>, formulaText: string): boolean {
  const strongCore = hasStrongMathCore(formulaText);
  return (
    strongCore ||
    features.operator ||
    features.fraction ||
    features.command ||
    features.relation ||
    (features.scripts && features.symbolDensity >= 0.24 && features.words.length <= 6)
  );
}

function classifyPdfDisplayFormulaLine(line: PdfVisualLine): PdfDisplayFormulaLineVerdict {
  const rawText = line.text.trim();
  const formulaText = getPdfDisplayLineFormulaText(line);
  const features = getFormulaStructureFeatures(formulaText);
  const score = Math.max(
    scoreFormulaLikeText(formulaText),
    Math.min(1, features.symbolDensity + features.structureCount * 0.12),
  );

  if (!line.bbox || getPdfDisplayLineWidth(line) <= 0 || getPdfDisplayLineHeight(line) <= 0) {
    return { accepted: false, reason: "no-geometry", formulaText, score };
  }
  if (isLikelyEquationNumberLine(line) || isCitationOrNumberOnly(rawText)) {
    return { accepted: false, reason: "citation-or-number", formulaText, score };
  }
  if (isPdfMetadataOrUrlText(rawText) || isPdfMetadataOrUrlText(formulaText)) {
    return { accepted: false, reason: "prose-like", formulaText, score };
  }
  if (rawText.length > 220 || features.words.length > 26) {
    return { accepted: false, reason: "too-long", formulaText, score };
  }
  if (isPdfDisplayFormulaProseLike(rawText, features.structureCount, features.symbolDensity)) {
    return { accepted: false, reason: "prose-like", formulaText, score };
  }
  if (!hasDisplayFormulaCore(features, formulaText)) {
    return { accepted: false, reason: "low-symbol-density", formulaText, score };
  }
  if (!hasPdfDisplayFormulaLayout(line, features.structureCount)) {
    return { accepted: false, reason: "layout-not-display", formulaText, score };
  }
  if (features.structureCount === 0 && !hasStrongMathCore(formulaText)) {
    return { accepted: false, reason: "low-symbol-density", formulaText, score };
  }
  if (features.symbolDensity < 0.16 && features.structureCount < 2 && !hasStrongMathCore(formulaText)) {
    return { accepted: false, reason: "low-symbol-density", formulaText, score };
  }
  if (score < 0.54 && features.structureCount < 2) {
    return { accepted: false, reason: "low-symbol-density", formulaText, score };
  }

  return { accepted: true, formulaText, score: Math.max(0.68, score) };
}

function shouldMergePdfDisplayFormulaLines(previous: PdfVisualLine, next: PdfVisualLine): boolean {
  const sameColumn = (previous.columnIndex ?? 0) === (next.columnIndex ?? 0);
  if (!sameColumn) return false;
  const sameBlock = (
    previous.blockIndex === undefined ||
    next.blockIndex === undefined ||
    previous.blockIndex === next.blockIndex
  );
  if (!sameBlock) return false;
  const verticalGap = next.top - previous.bottom;
  if (verticalGap < -0.01) return false;
  const maxLineHeight = Math.max(getPdfDisplayLineHeight(previous), getPdfDisplayLineHeight(next));
  if (verticalGap > Math.max(0.045, maxLineHeight * 1.75)) return false;
  const horizontalOverlap = Math.min(previous.right, next.right) - Math.max(previous.left, next.left);
  const minWidth = Math.min(getPdfDisplayLineWidth(previous), getPdfDisplayLineWidth(next));
  const centerDistance = Math.abs(getPdfDisplayLineCenterX(previous) - getPdfDisplayLineCenterX(next));
  return horizontalOverlap >= Math.max(0.015, minWidth * 0.18) || centerDistance <= 0.16;
}

function buildPdfDisplayFormulaLatex(lines: PdfVisualLine[]): { latex: string; rawText: string; confidenceHint: number } {
  const rawText = lines.map((line) => line.text.trim()).filter(Boolean).join("\n");
  const latexLines = lines
    .map((line) => normalizeLatex(convertTextToLatex(getPdfDisplayLineFormulaText(line)), true).latex)
    .filter(Boolean);
  const latex = latexLines.length > 1
    ? `\\begin{aligned}\n${latexLines.join(" \\\\\n")}\n\\end{aligned}`
    : latexLines[0] ?? normalizeLatex(convertTextToLatex(rawText), true).latex;
  const confidenceHint = lines.reduce((sum, line) => sum + classifyPdfDisplayFormulaLine(line).score, 0) / Math.max(1, lines.length);
  return { latex, rawText, confidenceHint };
}

function extractPdfDisplayFormulaBlocks(page: PluginPdfTextPage): CandidateCollector {
  const collector: CandidateCollector = { accepted: [], hidden: [] };
  const items = page.items ?? [];
  if (items.length === 0) {
    if (page.text.trim()) {
      hidePdfCandidate(collector, {
        page: page.pageNumber,
        reason: "no-geometry",
        rawText: page.text.slice(0, 260),
      });
    }
    return collector;
  }

  const lines = groupPdfItemsByVisualLine(items);
  const verdicts = lines.map((line) => classifyPdfDisplayFormulaLine(line));

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const verdict = verdicts[index];
    if (!verdict?.accepted) {
      hidePdfCandidate(collector, {
        page: page.pageNumber,
        reason: verdict?.reason ?? "low-symbol-density",
        rawText: line.text,
        score: verdict?.score,
        bbox: line.bbox,
      });
      continue;
    }

    const blockLines = [line];
    let scoreSum = verdict.score;
    let cursor = index + 1;
    while (
      cursor < lines.length &&
      verdicts[cursor]?.accepted &&
      shouldMergePdfDisplayFormulaLines(blockLines[blockLines.length - 1], lines[cursor])
    ) {
      blockLines.push(lines[cursor]);
      scoreSum += verdicts[cursor]?.score ?? 0;
      cursor += 1;
    }

    const { latex, rawText, confidenceHint } = buildPdfDisplayFormulaLatex(blockLines);
    const bbox = mergeBboxes(blockLines.map((blockLine) => blockLine.bbox));
    const confidence = Math.min(
      0.96,
      Math.max(page.source === "rendered-text-layer" ? 0.78 : 0.84, confidenceHint, scoreSum / blockLines.length),
    );
    pushCandidate(collector.accepted, {
      source: "pdf",
      kind: "text-layer",
      page: page.pageNumber,
      location: `page:${page.pageNumber}:line:${blockLines[0].lineIndex}-${blockLines[blockLines.length - 1].lineIndex}`,
      bbox,
      confidence,
      latex,
      rawText,
      displayMode: true,
      context: rawText,
      needsReview: false,
      order: (page.pageNumber * 10000) + index,
    });
    index = cursor - 1;
  }

  return collector;
}

export function extractPdfFormulasFromPagesWithDiagnostics(
  pages: PluginPdfTextPage[],
  options: { allowTextFallback?: boolean } = {},
): { formulas: ExtractedFormula[]; hiddenCandidates: HiddenFormulaCandidate[] } {
  const collector: CandidateCollector = { accepted: [], hidden: [] };
  for (const page of pages) {
    const itemCollector = extractPdfDisplayFormulaBlocks(page);
    collector.accepted.push(...itemCollector.accepted);
    collector.hidden.push(...itemCollector.hidden);

    if (options.allowTextFallback && itemCollector.accepted.length === 0) {
      collector.accepted.push(
        ...extractDelimitedFormulas({
          text: page.text,
          source: "pdf",
          page: page.pageNumber,
          location: `page:${page.pageNumber}:selection`,
          baseConfidence: 0.78,
        }),
        ...extractHeuristicFormulaLines({
          text: page.text,
          source: "pdf",
          page: page.pageNumber,
          locationPrefix: `page:${page.pageNumber}:selection`,
          baseConfidence: page.source === "rendered-text-layer" ? 0.66 : 0.72,
        }),
      );
    }
  }
  return {
    formulas: finalize(collector.accepted),
    hiddenCandidates: collector.hidden,
  };
}

export function extractPdfFormulasFromPages(
  pages: PluginPdfTextPage[],
  options: { allowTextFallback?: boolean } = {},
): ExtractedFormula[] {
  return extractPdfFormulasFromPagesWithDiagnostics(pages, options).formulas;
}

async function extractOmmlFromDocx(arrayBuffer: ArrayBuffer): Promise<Candidate[]> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) return [];
  const matches = documentXml.match(/<m:oMathPara[\s\S]*?<\/m:oMathPara>|<m:oMath[\s\S]*?<\/m:oMath>/g) ?? [];
  const candidates: Candidate[] = [];
  matches.forEach((raw, index) => {
    const latex = convertOmmlToLatex(raw).trim();
    if (!latex) return;
    pushCandidate(candidates, {
      source: "docx",
      kind: "omml",
      location: `omml:${index + 1}`,
      confidence: 0.88,
      latex,
      rawText: raw,
      displayMode: true,
      order: index,
    });
  });
  return candidates;
}

export async function extractDocxFormulas(input: { text?: string; arrayBuffer?: ArrayBuffer }): Promise<ExtractedFormula[]> {
  const candidates: Candidate[] = [];
  if (input.arrayBuffer) {
    try {
      candidates.push(...await extractOmmlFromDocx(input.arrayBuffer));
    } catch {
      // Fall back to text heuristics below.
    }
  }
  if (input.text) {
    candidates.push(
      ...extractDelimitedFormulas({ text: input.text, source: "docx", baseConfidence: 0.86 }),
      ...extractHeuristicFormulaLines({ text: input.text, source: "docx", baseConfidence: 0.62 }),
    );
  }
  return finalize(candidates);
}

export async function extractFormulasFromSource(source: FormulaExtractionSource): Promise<FormulaExtractionResult> {
  const scope: FormulaExtractionScope = source.scope ?? "document";
  const warnings: string[] = [];
  const text = scope === "selection" ? source.selectionText ?? source.text ?? "" : source.text ?? "";
  let formulas: ExtractedFormula[] = [];
  let hiddenCandidates: HiddenFormulaCandidate[] = [];

  if (scope === "selection" && !text.trim()) {
    warnings.push("empty-selection");
  }

  if (source.viewerType === "md") {
    formulas = extractMarkdownFormulas(text, "md");
  } else if (source.viewerType === "html") {
    formulas = extractHtmlFormulas(text);
  } else if (source.viewerType === "pdf") {
    const pages = source.pdfPages ?? (text ? [{ pageNumber: 1, text, visible: true, source: "unknown" as const }] : []);
    const result = extractPdfFormulasFromPagesWithDiagnostics(pages, { allowTextFallback: scope === "selection" });
    formulas = result.formulas;
    hiddenCandidates = result.hiddenCandidates;
  } else if (source.viewerType === "docx") {
    formulas = await extractDocxFormulas({ text, arrayBuffer: source.arrayBuffer });
  } else {
    formulas = finalize([
      ...extractDelimitedFormulas({ text, source: "unknown", baseConfidence: 0.82 }),
      ...extractHeuristicFormulaLines({ text, source: "unknown", baseConfidence: 0.58 }),
    ]);
  }

  if (formulas.length === 0) {
    warnings.push("no-formulas-detected");
  }

  return {
    sourceFile: source.filePath ?? source.fileName ?? null,
    viewerType: source.viewerType,
    scope,
    formulas,
    hiddenCandidates,
    scannedAt: Date.now(),
    warnings,
  };
}
