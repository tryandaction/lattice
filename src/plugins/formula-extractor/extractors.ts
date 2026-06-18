import JSZip from "jszip";
import { convertMathmlToLatex, convertOmmlToLatex, convertTextToLatex, detectLatexPatterns } from "@/lib/markdown-converter";
import { normalizeFormulaInput } from "@/lib/formula-utils";
import type { PluginPdfTextPage, PluginViewerType } from "@/lib/plugins/types";
import type { ExtractedFormula, FormulaExtractionResult, FormulaExtractionSource, FormulaExtractionScope } from "./types";

type Candidate = Omit<ExtractedFormula, "id"> & { order?: number };

const EXPLICIT_MATH_PATTERNS: Array<{ regex: RegExp; displayMode: boolean }> = [
  { regex: /(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$/g, displayMode: true },
  { regex: /\\\[([\s\S]+?)\\\]/g, displayMode: true },
  { regex: /\\\(([\s\S]+?)\\\)/g, displayMode: false },
  { regex: /(?<!\\)(?<!\$)\$(?!\$)([^$\n]+?)(?<!\\)\$(?!\$)/g, displayMode: false },
];

const SYMBOLIC_MATH_RE = /[=∑Σ∫√∞≈≠≤≥±×÷∂∇→←↔∈∉⊂⊆⊗⊕]|[_^{}]/;
const GREEK_RE = /[α-ωΑ-Ω]/;
const LATEX_COMMAND_RE = /\\[a-zA-Z]+(?:\{[^{}]*\})?/;
const WORD_RE = /[A-Za-z]{2,}/g;
const EQUATION_NUMBER_RE = /^\(?\d+(?:\.\d+)?\)?$/;

function normalizeLatex(raw: string, displayMode: boolean): { latex: string; displayMode: boolean } {
  const normalized = normalizeFormulaInput(raw, { preferDisplay: displayMode });
  return {
    latex: normalized.latex || raw.trim(),
    displayMode: normalized.displayMode || displayMode,
  };
}

function pushCandidate(candidates: Candidate[], candidate: Candidate) {
  const latex = candidate.latex.trim();
  if (!latex) return;
  if (latex.length === 1 && !/[a-zA-Zα-ωΑ-Ω0-9]/.test(latex)) return;
  const duplicate = candidates.some((item) => (
    item.latex === latex &&
    item.page === candidate.page &&
    item.location === candidate.location
  ));
  if (duplicate) return;
  candidates.push({ ...candidate, latex });
}

function buildContext(text: string, start: number, end: number): string {
  const left = text.slice(Math.max(0, start - 80), start).trim();
  const right = text.slice(end, Math.min(text.length, end + 80)).trim();
  return [left, right].filter(Boolean).join(" ... ");
}

function finalize(candidates: Candidate[]): ExtractedFormula[] {
  return [...candidates].sort((left, right) => (left.order ?? 0) - (right.order ?? 0)).map((candidate, index) => ({
    source: candidate.source,
    page: candidate.page,
    location: candidate.location,
    bbox: candidate.bbox,
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
        page: input.page,
        location: input.location,
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

  const compact = trimmed.replace(/\s+/g, "");
  const wordMatches = trimmed.match(WORD_RE) ?? [];
  const longWords = wordMatches.filter((word) => word.length >= 5).length;
  const symbolCount = [...trimmed].filter((char) => /[=+\-/*^_{}()[\]<>∑Σ∫√∞≈≠≤≥±×÷∂∇]/.test(char)).length;
  const digitCount = [...trimmed].filter((char) => /\d/.test(char)).length;
  const hasLatex = detectLatexPatterns(trimmed) || LATEX_COMMAND_RE.test(trimmed);
  const hasGreek = GREEK_RE.test(trimmed);
  const hasEquation = /[A-Za-zα-ωΑ-Ω0-9)]\s*[=≈≠≤≥]\s*[A-Za-zα-ωΑ-Ω0-9(\\]/.test(trimmed);
  const hasSubSup = /[A-Za-zα-ωΑ-Ω0-9][_^][{A-Za-z0-9\\]/.test(trimmed) || /[A-Za-zα-ωΑ-Ω]\d/.test(trimmed);

  let score = 0;
  if (hasLatex) score += 0.42;
  if (hasEquation) score += 0.46;
  if (hasGreek) score += 0.18;
  if (hasSubSup) score += 0.18;
  if (hasEquation && symbolCount >= 1) score += 0.08;
  if (symbolCount >= 2) score += 0.18;
  if (digitCount > 0 && symbolCount > 0) score += 0.08;
  if (compact.length <= 96 && wordMatches.length <= 8) score += 0.08;
  if (longWords >= 3 && !hasLatex) score -= 0.28;
  if (!SYMBOLIC_MATH_RE.test(trimmed) && !hasGreek && !hasLatex) score -= 0.4;
  if (/[.!?]$/.test(trimmed) && wordMatches.length > 5 && !hasLatex) score -= 0.2;

  return Math.max(0, Math.min(1, score));
}

function extractHeuristicFormulaLines(input: {
  text: string;
  source: PluginViewerType;
  page?: number;
  locationPrefix?: string;
  baseConfidence?: number;
}): Candidate[] {
  const candidates: Candidate[] = [];
  const lines = input.text
    .split(/\r?\n|(?<=\s)\s{2,}/)
    .map((line) => line.trim())
    .filter(Boolean);

  lines.forEach((line, index) => {
    const withoutTrailingNumber = line.replace(/\s+\(?\d+(?:\.\d+)?\)?$/, "").trim();
    const colonTail = withoutTrailingNumber.includes(":")
      ? withoutTrailingNumber.slice(withoutTrailingNumber.lastIndexOf(":") + 1).trim()
      : "";
    const fullScore = scoreFormulaLikeText(withoutTrailingNumber);
    const tailScore = scoreFormulaLikeText(colonTail);
    const formulaText = tailScore >= fullScore && tailScore >= 0.58 ? colonTail : withoutTrailingNumber;
    const score = Math.max(fullScore, tailScore);
    if (score < 0.58) return;
    const normalized = normalizeLatex(convertTextToLatex(formulaText), score >= 0.78);
    pushCandidate(candidates, {
      source: input.source,
      page: input.page,
      location: input.locationPrefix ? `${input.locationPrefix}:${index + 1}` : `line:${index + 1}`,
      confidence: Math.min(0.9, Math.max(input.baseConfidence ?? 0.62, score)),
      latex: normalized.latex,
      rawText: line,
      displayMode: normalized.displayMode || score >= 0.78,
      context: line,
      needsReview: score < 0.72,
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

export function extractPdfFormulasFromPages(pages: PluginPdfTextPage[]): ExtractedFormula[] {
  const candidates: Candidate[] = [];
  for (const page of pages) {
    candidates.push(
      ...extractDelimitedFormulas({
        text: page.text,
        source: "pdf",
        page: page.pageNumber,
        location: `page:${page.pageNumber}`,
        baseConfidence: 0.9,
      }),
      ...extractHeuristicFormulaLines({
        text: page.text,
        source: "pdf",
        page: page.pageNumber,
        locationPrefix: `page:${page.pageNumber}`,
        baseConfidence: page.source === "rendered-text-layer" ? 0.66 : 0.72,
      }),
    );
  }
  return finalize(candidates);
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
      location: `omml:${index + 1}`,
      confidence: 0.88,
      latex,
      rawText: raw,
      displayMode: true,
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

  if (scope === "selection" && !text.trim()) {
    warnings.push("empty-selection");
  }

  if (source.viewerType === "md") {
    formulas = extractMarkdownFormulas(text, "md");
  } else if (source.viewerType === "html") {
    formulas = extractHtmlFormulas(text);
  } else if (source.viewerType === "pdf") {
    const pages = source.pdfPages ?? (text ? [{ pageNumber: 1, text, visible: true, source: "unknown" as const }] : []);
    formulas = extractPdfFormulasFromPages(pages);
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
    scannedAt: Date.now(),
    warnings,
  };
}
