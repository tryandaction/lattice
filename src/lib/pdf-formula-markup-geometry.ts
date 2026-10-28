import type { BoundingBox } from '@/types/universal-annotation';

/** Already selected, verified formula glyphs in source order and normalized top-left page coordinates. */
export interface PdfFormulaMarkupGlyph extends BoundingBox { text: string }
export interface PdfFormulaMarkupGeometry {
  /** One envelope for the selected expression, including scalable delimiters. */
  highlightRects: BoundingBox[];
  /** Full logical equation/matrix-row boxes; the stroke belongs below each y2. */
  underlineRects: BoundingBox[];
  equationRows: BoundingBox[];
}

const centerY = (box: BoundingBox) => (box.y1 + box.y2) / 2;
const valid = (box: BoundingBox) => [box.x1, box.y1, box.x2, box.y2].every(Number.isFinite)
  && box.x1 >= 0 && box.y1 >= 0 && box.x2 <= 1 && box.y2 <= 1 && box.x2 > box.x1 && box.y2 > box.y1;
const bounds = (boxes: readonly BoundingBox[]): BoundingBox => ({ x1: Math.min(...boxes.map(box => box.x1)),
  y1: Math.min(...boxes.map(box => box.y1)), x2: Math.max(...boxes.map(box => box.x2)), y2: Math.max(...boxes.map(box => box.y2)) });
const median = (values: number[]) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];

function foldSplitDelimiters(glyphs: PdfFormulaMarkupGlyph[], em: number) {
  const families = [
    { top: '\uf8eb', middle: '\uf8ec', bottom: '\uf8ed', text: '(' },
    { top: '\uf8f6', middle: '\uf8f7', bottom: '\uf8f8', text: ')' },
    { top: '\uf8ee', middle: '\uf8ef', bottom: '\uf8f0', text: '[' },
    { top: '\uf8f9', middle: '\uf8fa', bottom: '\uf8fb', text: ']' },
    { top: '\u239b', middle: '\u239c', bottom: '\u239d', text: '(' },
    { top: '\u239e', middle: '\u239f', bottom: '\u23a0', text: ')' },
    { top: '\u23a1', middle: '\u23a2', bottom: '\u23a3', text: '[' },
    { top: '\u23a4', middle: '\u23a5', bottom: '\u23a6', text: ']' },
  ];
  const used = new Set<PdfFormulaMarkupGlyph>(), folded: PdfFormulaMarkupGlyph[] = [];
  for (const family of families) for (const top of glyphs.filter(glyph => glyph.text === family.top)) {
    const pieces = glyphs.filter(glyph => !used.has(glyph) && [family.top, family.middle, family.bottom].includes(glyph.text)
      && Math.abs((glyph.x1 + glyph.x2) / 2 - (top.x1 + top.x2) / 2) <= em * .4 && glyph.y1 >= top.y1)
      .sort((left, right) => left.y1 - right.y1);
    const bottom = pieces.findIndex(glyph => glyph.text === family.bottom);
    if (pieces[0] !== top || bottom < 1) continue;
    const chain = pieces.slice(0, bottom + 1);
    if (chain.slice(1, -1).some(glyph => glyph.text !== family.middle)
      || chain.some((glyph, index) => index > 0 && glyph.y1 - chain[index - 1].y2 > em * .5)) continue;
    const box = bounds(chain);
    if (box.y2 - box.y1 <= em * 2.2) continue;
    chain.forEach(glyph => used.add(glyph)); folded.push({ text: family.text, ...box });
  }
  return [...glyphs.filter(glyph => !used.has(glyph)), ...folded];
}

function withoutSeparatedEquationNumber(glyphs: PdfFormulaMarkupGlyph[], em: number) {
  const sorted = [...glyphs].sort((left, right) => left.x1 - right.x1 || left.y1 - right.y1);
  for (let index = sorted.length - 1; index > 0; index -= 1) {
    const left = sorted.slice(0, index), right = sorted.slice(index);
    if (right[0].x1 - Math.max(...left.map(glyph => glyph.x2)) < em * 3) continue;
    if (!/^\(\d+(?:\.\d+)?[a-z]?\)$/u.test(right.map(glyph => glyph.text).join(''))) continue;
    if (Math.max(...right.map(centerY)) - Math.min(...right.map(centerY)) > em * .5) continue;
    return left;
  }
  return glyphs;
}

function matrixDelimiterPairs(glyphs: PdfFormulaMarkupGlyph[], em: number) {
  return glyphs.filter(glyph => /^[([]$/u.test(glyph.text) && glyph.y2 - glyph.y1 > em * 2.2)
    .flatMap(open => {
      const close = glyphs.filter(glyph => glyph.text === (open.text === '(' ? ')' : ']') && glyph.x1 > open.x2
        && Math.abs(glyph.y1 - open.y1) <= em * .6 && Math.abs(glyph.y2 - open.y2) <= em * .6)
        .sort((left, right) => left.x1 - right.x1)[0];
      return close ? [{ open, close }] : [];
    });
}

function formulaColumns(glyphs: PdfFormulaMarkupGlyph[], em: number) {
  const columns: PdfFormulaMarkupGlyph[][] = [];
  const matrixRightEdges = new Map(matrixDelimiterPairs(glyphs, em).map(({ open, close }) => [open, close.x2]));
  let right = Number.NEGATIVE_INFINITY;
  for (const glyph of [...glyphs].sort((left, other) => left.x1 - other.x1)) {
    // A verified pair of tall delimiters encloses one expression even when its
    // sparse cells have larger gaps than the page-column separation threshold.
    const glyphRight = Math.max(glyph.x2, matrixRightEdges.get(glyph) ?? glyph.x2);
    if (!columns.length || glyph.x1 - right > Math.max(.035, em * 3)) {
      columns.push([glyph]); right = glyphRight;
    } else {
      columns[columns.length - 1].push(glyph); right = Math.max(right, glyphRight);
    }
  }
  return columns.map(column => column.sort((left, right) => glyphs.indexOf(left) - glyphs.indexOf(right)));
}

function visualBands(glyphs: PdfFormulaMarkupGlyph[], em: number) {
  const bands: PdfFormulaMarkupGlyph[][] = [];
  let bottom = Number.NEGATIVE_INFINITY;
  for (const glyph of [...glyphs].sort((left, right) => left.y1 - right.y1 || left.x1 - right.x1)) {
    if (!bands.length || glyph.y1 - bottom > em * .4) {
      bands.push([glyph]); bottom = glyph.y2;
    } else {
      bands[bands.length - 1].push(glyph); bottom = Math.max(bottom, glyph.y2);
    }
  }
  return bands;
}

function matrixRows(glyphs: PdfFormulaMarkupGlyph[], em: number): BoundingBox[] | null {
  for (const { open, close } of matrixDelimiterPairs(glyphs, em)) {
    const inside = glyphs.filter(glyph => glyph !== open && glyph !== close && glyph.x1 >= open.x2 && glyph.x2 <= close.x1
      && centerY(glyph) >= open.y1 && centerY(glyph) <= open.y2);
    const cellColumns: PdfFormulaMarkupGlyph[][] = [];
    let right = Number.NEGATIVE_INFINITY;
    for (const glyph of [...inside].sort((left, other) => left.x1 - other.x1)) {
      if (!cellColumns.length || glyph.x1 - right > em * .6) { cellColumns.push([glyph]); right = glyph.x2; }
      else { cellColumns[cellColumns.length - 1].push(glyph); right = Math.max(right, glyph.x2); }
    }
    // A plain column supplies stable mathematical row axes even when adjacent
    // fraction columns have numerators/denominators almost touching next rows.
    const candidates = cellColumns.map(column => visualBands(column, em)).filter(bands => bands.length >= 2
      && bands.every(band => { const box = bounds(band); return box.y2 - box.y1 <= em * 1.9; }));
    const reference = candidates.sort((left, other) => left.length - other.length)[0];
    const bands = reference ? reference.map(() => [] as PdfFormulaMarkupGlyph[]) : visualBands(inside, em);
    if (reference) for (const glyph of inside) {
      const nearest = reference.reduce((best, band, index) => Math.abs(centerY(glyph) - centerY(bounds(band)))
        < Math.abs(centerY(glyph) - centerY(bounds(reference[best]))) ? index : best, 0);
      bands[nearest].push(glyph);
    }
    if (bands.length < 2) continue;
    // Delimiter height encloses the matrix, but must not drag all underlines
    // down to its bottom. LHS/coefficient glyphs belong to the nearest row.
    const outside = glyphs.filter(glyph => glyph !== open && glyph !== close && !inside.includes(glyph));
    for (const glyph of outside) {
      const nearest = bands.reduce((best, band, index) => Math.abs(centerY(glyph) - centerY(bounds(band)))
        < Math.abs(centerY(glyph) - centerY(bounds(bands[best]))) ? index : best, 0);
      bands[nearest].push(glyph);
    }
    return bands.map(bounds);
  }
  return null;
}

function equationRows(glyphs: PdfFormulaMarkupGlyph[], em: number): BoundingBox[] {
  const matrix = matrixRows(glyphs, em);
  if (matrix) return matrix;
  const equalIndices = glyphs.flatMap((glyph, index) => glyph.text === '=' ? [index] : []);
  if (equalIndices.length > 1 && equalIndices.slice(1).every((index, ordinal) => centerY(glyphs[index]) - centerY(glyphs[equalIndices[ordinal]]) > em * 1.2)) {
    const starts = [0];
    for (let ordinal = 1; ordinal < equalIndices.length; ordinal += 1) {
      const equalIndex = equalIndices[ordinal], equal = glyphs[equalIndex];
      const leftHandSide = glyphs.findIndex((glyph, index) => index > equalIndices[ordinal - 1] && index < equalIndex
        && glyph.x2 <= equal.x1 + em * .7 && Math.abs(centerY(glyph) - centerY(equal)) <= em * 1.8);
      if (leftHandSide < 0) break;
      starts.push(leftHandSide);
    }
    if (starts.length === equalIndices.length) return starts.map((start, ordinal) => bounds(glyphs.slice(start, starts[ordinal + 1])));
  }
  const anchors = glyphs.filter(glyph => /^[=<>≤≥≈≃≡≠]$/u.test(glyph.text));
  if (!anchors.length) return visualBands(glyphs, em).map(bounds);
  const axes: number[] = [];
  for (const anchor of [...anchors].sort((left, right) => centerY(left) - centerY(right))) {
    const axis = centerY(anchor);
    if (!axes.some(value => Math.abs(value - axis) <= em * .65)) axes.push(axis);
  }
  const rows: PdfFormulaMarkupGlyph[][] = axes.map(() => []);
  for (const glyph of glyphs) {
    const nearest = axes.reduce((best, axis, index) => Math.abs(centerY(glyph) - axis) < Math.abs(centerY(glyph) - axes[best]) ? index : best, 0);
    rows[nearest].push(glyph);
  }
  return rows.filter(row => row.length).map(bounds);
}

/**
 * Geometry only: not OCR, not a LaTeX recognizer, and never a whole-page search.
 * The caller supplies glyphs belonging to one verified formula selection.
 * Fractions use the relation's mathematical baseline so numerator/denominator
 * fragments are one logical row; bounds retain scripts and denominators.
 */
export function buildPdfFormulaMarkupGeometry(input: { glyphs: readonly PdfFormulaMarkupGlyph[] }): PdfFormulaMarkupGeometry {
  const glyphs = input.glyphs.filter(glyph => glyph.text.trim() && valid(glyph));
  if (!glyphs.length) return { highlightRects: [], underlineRects: [], equationRows: [] };
  const ordinary = glyphs.filter(glyph => !/^[()[\]]$/u.test(glyph.text) && glyph.y2 - glyph.y1 > .001);
  const em = median((ordinary.length ? ordinary : glyphs).map(glyph => glyph.y2 - glyph.y1));
  const selected = foldSplitDelimiters(withoutSeparatedEquationNumber(glyphs, em), em);
  const columns = formulaColumns(selected, em);
  const rows = columns.flatMap(column => equationRows(column, em))
    .sort((left, right) => left.y1 - right.y1 || left.x1 - right.x1);
  return { highlightRects: columns.map(bounds), underlineRects: rows, equationRows: rows.map(row => ({ ...row })) };
}
