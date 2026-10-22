import { convertCharToLatex } from "./markdown-converter";

/** Geometry is top-left based and must use one consistent coordinate scale. */
export interface PdfFormulaRect { x1: number; y1: number; x2: number; y2: number }
export interface PdfFormulaGlyph extends PdfFormulaRect { text: string }
export interface PdfFormulaInference {
  latex?: string;
  status: "ready" | "needs-review" | "unavailable";
  reason?: string;
  rects: PdfFormulaRect[];
  bounds: PdfFormulaRect | null;
}
export interface PdfFormulaSelection {
  text: string;
  chars: readonly PdfFormulaGlyph[];
  rects: readonly PdfFormulaRect[];
}

interface Atom extends PdfFormulaRect {
  raw: string;
  latex: string;
  /** Nominal glyph height and mathematical axis survive structural grouping. */
  em: number;
  axis: number;
  structured: boolean;
}

class UncertainLayout extends Error {}
const MACRONS = /^[¯̄]$/u;
const RULES = /^[-−―_]$/u;
const PROSE_WORDS = /\b(?:the|this|that|where|from|with|which|when|result|using|equation|and|are|is)\b/i;
const MATH_FUNCTIONS = new Set(["sin", "cos", "tan", "log", "exp", "lim", "det", "max", "min"]);
const MATH_EVIDENCE = /[=+−*/<>±×÷≈≃≡≤≥≠∑∏∫∂∇ℏα-ωΑ-Ω_^⁰-⁹₀-₉]/u;

const width = (rect: PdfFormulaRect) => rect.x2 - rect.x1;
const height = (rect: PdfFormulaRect) => rect.y2 - rect.y1;
const centerX = (rect: PdfFormulaRect) => (rect.x1 + rect.x2) / 2;
const centerY = (rect: PdfFormulaRect) => (rect.y1 + rect.y2) / 2;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const validRect = (rect: PdfFormulaRect) =>
  [rect.x1, rect.y1, rect.x2, rect.y2].every(Number.isFinite) && width(rect) > 0 && height(rect) > 0;

function boundsOf(rects: readonly PdfFormulaRect[]): PdfFormulaRect | null {
  if (!rects.length) return null;
  return { x1: Math.min(...rects.map((rect) => rect.x1)), y1: Math.min(...rects.map((rect) => rect.y1)),
    x2: Math.max(...rects.map((rect) => rect.x2)), y2: Math.max(...rects.map((rect) => rect.y2)) };
}

function joinLatex(parts: string[]): string {
  return parts.reduce((result, part) => result + (/\\[A-Za-z]+$/.test(result) && /^[A-Za-z]/.test(part) ? " " : "") + part, "");
}

function glyphLatex(text: string): string {
  const parts: string[] = [];
  for (const char of text.normalize("NFD")) {
    if (/\s/u.test(char)) continue;
    if (char === "̄") {
      const base = parts.pop();
      if (!base) throw new UncertainLayout("unattached-accent");
      parts.push(`\\bar{${base}}`);
      continue;
    }
    // Structural tokens need geometry; a root sign alone does not identify its radicand.
    if (/[\\_^$&#%√]/u.test(char)) throw new UncertainLayout("unsupported-structural-glyph");
    const latex = convertCharToLatex(char);
    if (latex === char && !(/[A-Za-z0-9]/u.test(char) || "=+-*/.,;:!?()[]{}|<>¯".includes(char))) {
      throw new UncertainLayout("unsupported-glyph");
    }
    parts.push(char === "{" ? "\\{" : char === "}" ? "\\}" : latex);
  }
  return joinLatex(parts);
}

function isScriptBase(atom: Atom): boolean {
  return atom.structured || !"=+-−*/<>()[]{},;:|¯̄≤≥≠".includes(atom.raw);
}

/** Only explicit horizontal separation permits removing a right equation label. */
function withoutEquationNumber(atoms: Atom[], em: number): Atom[] {
  const sorted = [...atoms].sort((a, b) => a.x1 - b.x1);
  for (let index = sorted.length - 1; index > 0; index -= 1) {
    const left = sorted.slice(0, index);
    const right = sorted.slice(index);
    if (right[0].x1 - Math.max(...left.map((atom) => atom.x2)) < 3 * em) continue;
    if (/^\(\d+(?:\.\d+)?[a-z]?\)$/.test(right.map((atom) => atom.raw).join("")) &&
        Math.max(...right.map((atom) => atom.axis)) - Math.min(...right.map((atom) => atom.axis)) < em * 0.25 &&
        MATH_EVIDENCE.test(left.map((atom) => atom.raw).join(""))) return left;
  }
  return atoms;
}

function collapseAccents(atoms: Atom[]): Atom[] {
  let remaining = [...atoms];
  for (const accent of atoms.filter((atom) => MACRONS.test(atom.raw))) {
    const bases = remaining.filter((atom) => atom !== accent && isScriptBase(atom) &&
      accent.y2 <= atom.y1 + atom.em * 0.15 && atom.y1 - accent.y2 <= atom.em * 0.6 &&
      Math.abs(centerX(accent) - centerX(atom)) < atom.em * 0.3 && width(accent) <= width(atom) * 1.4);
    if (bases.length !== 1) throw new UncertainLayout("unattached-accent");
    const base = bases[0];
    const combined = { ...base, ...boundsOf([base, accent])!, latex: `\\bar{${base.latex}}`, structured: true };
    remaining = remaining.filter((atom) => atom !== base && atom !== accent).concat(combined);
  }
  return remaining;
}

/** Small displaced runs attach only to a nearby, larger glyph on their left. */
function collapseScripts(atoms: Atom[]): Atom[] {
  let remaining = [...atoms];
  const bases = [...atoms].sort((a, b) => b.em - a.em || a.x1 - b.x1);
  for (const base of bases) {
    if (!remaining.includes(base) || !isScriptBase(base)) continue;
    const groups: { upper: Atom[]; lower: Atom[] } = { upper: [], lower: [] };
    for (const side of ["upper", "lower"] as const) {
      const candidates = remaining.filter((atom) => atom !== base && atom.em <= base.em * 0.82 &&
        !(RULES.test(atom.raw) && height(atom) < base.em * 0.22) && !MACRONS.test(atom.raw) &&
        atom.x1 >= base.x2 - base.em * 0.18 &&
        (side === "upper" ? base.axis - atom.axis : atom.axis - base.axis) > base.em * 0.24 &&
        Math.abs(base.axis - atom.axis) <= base.em * 1.05).sort((a, b) => a.x1 - b.x1);
      let edge = base.x2;
      for (const candidate of candidates) {
        const run = groups[side];
        if (candidate.x1 - edge > base.em * (run.length ? 0.38 : 0.5)) break;
        if (run.length && Math.abs(candidate.axis - run[0].axis) > candidate.em * 0.3) continue;
        // A following full-size base terminates the script run.
        if (remaining.some((atom) => atom !== base && atom.em > base.em * 0.82 &&
          Math.abs(atom.axis - base.axis) < base.em * 0.3 && atom.x1 >= base.x2 && atom.x1 < candidate.x1)) break;
        run.push(candidate);
        edge = Math.max(edge, candidate.x2);
      }
    }
    const attached = [...groups.upper, ...groups.lower];
    if (!attached.length) continue;
    const sub = groups.lower.length ? `_{${serializeLine(groups.lower)}}` : "";
    const sup = groups.upper.length ? `^{${serializeLine(groups.upper)}}` : "";
    const combined = { ...base, ...boundsOf([base, ...attached])!, latex: `${base.latex}${sub}${sup}`, structured: true };
    remaining = remaining.filter((atom) => atom !== base && !attached.includes(atom)).concat(combined);
  }
  return remaining;
}

function collapseFractions(atoms: Atom[], em: number): Atom[] {
  let remaining = [...atoms];
  const bars = atoms.filter((atom) => RULES.test(atom.raw) && height(atom) < em * 0.22 && width(atom) > em * 0.6)
    .sort((a, b) => width(a) - width(b));
  for (const bar of bars) {
    if (!remaining.includes(bar)) continue;
    const candidates = remaining.filter((atom) => atom !== bar &&
      atom.x1 >= bar.x1 - em * 0.12 && atom.x2 <= bar.x2 + em * 0.12 &&
      Math.abs(atom.axis - bar.axis) < em * 2.2);
    const above = candidates.filter((atom) => atom.y2 <= bar.y1 + em * 0.1);
    const below = candidates.filter((atom) => atom.y1 >= bar.y2 - em * 0.1);
    if (!above.length || !below.length) throw new UncertainLayout("unsupported-rule");
    const numeratorAxis = Math.max(...above.map((atom) => atom.axis));
    const denominatorAxis = Math.min(...below.map((atom) => atom.axis));
    const numerator = above.filter((atom) => numeratorAxis - atom.axis < em * 0.45);
    const denominator = below.filter((atom) => atom.axis - denominatorAxis < em * 0.45);
    if (bar.y1 - Math.max(...numerator.map((atom) => atom.y2)) > em * 0.8 ||
        Math.min(...denominator.map((atom) => atom.y1)) - bar.y2 > em * 0.8) {
      throw new UncertainLayout("disconnected-fraction");
    }
    const used = [bar, ...numerator, ...denominator];
    const combined: Atom = { ...boundsOf(used)!, raw: "",
      latex: `\\frac{${serializeLine(numerator)}}{${serializeLine(denominator)}}`,
      axis: bar.axis, em: Math.max(...numerator.concat(denominator).map((atom) => atom.em)), structured: true };
    remaining = remaining.filter((atom) => !used.includes(atom)).concat(combined);
  }
  return remaining;
}

function rowGroups(atoms: Atom[]): Atom[][] {
  const rows: Atom[][] = [];
  for (const atom of [...atoms].sort((a, b) => a.axis - b.axis)) {
    const row = rows.find((candidate) => Math.abs(median(candidate.map((item) => item.axis)) - atom.axis) <=
      Math.max(atom.em, median(candidate.map((item) => item.em))) * 0.4);
    if (row) row.push(atom); else rows.push([atom]);
  }
  return rows;
}

function matrixCells(rows: Atom[][], em: number): Atom[][][] {
  if (rows.length !== 2) throw new UncertainLayout("unsupported-matrix-shape");
  const gaps = rows.map((row) => {
    const sorted = [...row].sort((a, b) => a.x1 - b.x1);
    return sorted.slice(1).map((atom, index) => ({ left: sorted[index].x2, right: atom.x1 }))
      .filter((gap) => gap.right - gap.left >= em);
  });
  const cuts = gaps[0].flatMap((top) => gaps[1].map((bottom) => ({ left: Math.max(top.left, bottom.left),
    right: Math.min(top.right, bottom.right) }))).filter((gap) => gap.right - gap.left >= em * 0.6);
  if (cuts.length !== 1) throw new UncertainLayout("ambiguous-matrix-columns");
  const split = (cuts[0].left + cuts[0].right) / 2;
  return rows.map((row) => [row.filter((atom) => atom.x2 < split), row.filter((atom) => atom.x1 > split)]);
}

function collapseMatrices(atoms: Atom[], em: number): Atom[] {
  let remaining = [...atoms];
  const openings = atoms.filter((atom) => /^[([]$/.test(atom.raw) && height(atom) > em * 1.8);
  for (const open of openings) {
    if (!remaining.includes(open)) continue;
    const matching = open.raw === "(" ? ")" : "]";
    const close = remaining.filter((atom) => atom.raw === matching && atom.x1 > open.x2 &&
      Math.abs(atom.y1 - open.y1) < em * 0.5 && Math.abs(atom.y2 - open.y2) < em * 0.5)
      .sort((a, b) => a.x1 - b.x1)[0];
    if (!close) throw new UncertainLayout("unmatched-scalable-delimiter");
    const inside = remaining.filter((atom) => atom !== open && atom !== close && atom.x1 >= open.x2 &&
      atom.x2 <= close.x1 && atom.axis >= open.y1 - em * 0.5 && atom.axis <= open.y2 + em * 0.5);
    if (!inside.length) throw new UncertainLayout("empty-scalable-delimiter");
    const rows = rowGroups(inside);
    let latex: string;
    if (rows.length === 1) {
      latex = `\\left${open.raw}${serializeLine(inside)}\\right${close.raw}`;
    } else {
      const cells = matrixCells(rows, em);
      const environment = open.raw === "(" ? "pmatrix" : "bmatrix";
      latex = `\\begin{${environment}}${cells.map((row) => row.map(serializeLine).join(" & ")).join(" \\\\ ")}\\end{${environment}}`;
    }
    const used = [open, close, ...inside];
    const combined: Atom = { ...boundsOf(used)!, raw: "", latex, axis: (Math.min(...inside.map(atom => atom.axis)) + Math.max(...inside.map(atom => atom.axis))) / 2, em, structured: true };
    remaining = remaining.filter((atom) => !used.includes(atom)).concat(combined);
  }
  return remaining;
}

function serializeLine(atoms: Atom[]): string {
  if (!atoms.length || rowGroups(atoms).length !== 1) throw new UncertainLayout("unsupported-multiline-layout");
  const sorted = [...atoms].sort((a, b) => a.x1 - b.x1);
  const em = median(atoms.map((atom) => atom.em));
  const delimiters: string[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const atom = sorted[index];
    if (index && atom.x1 - sorted[index - 1].x2 > em * 3) throw new UncertainLayout("disconnected-columns");
    if (index && atom.x1 < sorted[index - 1].x2 - em * 0.25) throw new UncertainLayout("overlapping-glyphs");
    for (const char of atom.structured ? "" : atom.raw) {
      if (["(", "[", "{"].includes(char)) delimiters.push(char);
      if ([")", "]", "}"].includes(char) && delimiters.pop() !== ({ ")": "(", "]": "[", "}": "{" }[char])) {
        throw new UncertainLayout("unmatched-delimiter");
      }
    }
  }
  if (delimiters.length) throw new UncertainLayout("unmatched-delimiter");
  const syntax = sorted.map((atom) => atom.structured ? "0" : atom.raw).join("").replace(/\s/gu, "");
  if (/[_^]/u.test(syntax) || /^[=*/<>×÷≈≃≡≤≥≠]/u.test(syntax) ||
      /[=+−*/<>±×÷≈≃≡≤≥≠-]$/u.test(syntax) ||
      /[=+−*/<>±×÷≈≃≡≤≥≠-][=*/<>×÷≈≃≡≤≥≠]/u.test(syntax)) {
    throw new UncertainLayout("incomplete-or-unsupported-expression");
  }
  return joinLatex(sorted.map((atom) => atom.latex));
}

/**
 * A conservative local structure recognizer, not OCR. `ready` means the observed
 * glyphs fit a supported deterministic layout; it cannot certify that a PDF text
 * layer contains every painted symbol. Missing vector bars, prose, ambiguous
 * rows or columns never produce a guessed reliable LaTeX formula.
 */
export function inferPdfFormulaFromSelection(input: PdfFormulaSelection): PdfFormulaInference {
  const rects = input.rects.filter(validRect).map((rect) => ({ ...rect }));
  const fallback = (status: "needs-review" | "unavailable", reason: string): PdfFormulaInference => ({
    status, reason, rects, bounds: boundsOf(rects),
  });
  const text = input.text.trim();
  if (!text) return fallback("unavailable", "empty-selection");
  if (PROSE_WORDS.test(text) || /[㐀-鿿]/u.test(text)) {
    return fallback("unavailable", "prose-selection");
  }
  if (!input.chars.length || input.chars.length > 500 || text.length > 1500 || input.chars.some((char) => !validRect(char))) {
    return fallback("needs-review", "missing-or-invalid-glyph-geometry");
  }
  // Selection order may vary, but omission or substitution must never be silently accepted.
  const glyphInventory = (value: string) => [...value.normalize("NFD").replace(/\s/gu, "")].sort().join("");
  if (glyphInventory(text) !== glyphInventory(input.chars.map((char) => char.text).join(""))) {
    return fallback("needs-review", "text-glyph-mismatch");
  }
  try {
    let atoms: Atom[] = input.chars.filter((char) => char.text.trim()).map((char) => ({ ...char,
      raw: char.text, latex: MACRONS.test(char.text) || RULES.test(char.text) ? convertCharToLatex(char.text) : glyphLatex(char.text),
      em: height(char), axis: centerY(char), structured: false }));
    if (!atoms.length) return fallback("needs-review", "missing-glyph-geometry");
    const normal = atoms.filter((atom) => !/^[()[\]¯̄]$/.test(atom.raw) && !RULES.test(atom.raw));
    // Script-heavy equations can contain more small glyphs than body glyphs.
    const sizes = (normal.length ? normal : atoms).map((atom) => atom.em).sort((a, b) => a - b);
    const em = sizes[Math.floor((sizes.length - 1) * 0.75)];
    atoms = withoutEquationNumber(atoms, em);
    // Reading-order text may concatenate matrix cells; only visual runs are words.
    const proseRuns = rowGroups(atoms).map((row) => {
      const sorted = [...row].sort((a, b) => a.x1 - b.x1);
      return sorted.map((atom, index) => (index && atom.x1 - sorted[index - 1].x2 > em * 0.25 ? " " : "") + atom.raw).join("");
    });
    if (proseRuns.some((run) => (run.match(/[A-Za-z]{4,}/g) ?? []).some((word) => !MATH_FUNCTIONS.has(word)))) {
      return fallback("unavailable", "prose-selection");
    }
    atoms = collapseAccents(atoms);
    atoms = collapseScripts(atoms);
    atoms = collapseFractions(atoms, em);
    atoms = collapseMatrices(atoms, em);
    const latex = serializeLine(atoms);
    if (!MATH_EVIDENCE.test(text) && !atoms.some((atom) => atom.structured)) return fallback("unavailable", "no-math-evidence");
    const bounds = boundsOf(atoms)!;
    return { status: "ready", latex, rects: [bounds], bounds };
  } catch (error) {
    if (error instanceof UncertainLayout) return fallback("needs-review", error.message);
    throw error;
  }
}
