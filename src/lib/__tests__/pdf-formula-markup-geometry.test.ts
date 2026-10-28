import { describe, expect, it } from 'vitest';
import { buildPdfFormulaMarkupGeometry, type PdfFormulaMarkupGlyph } from '../pdf-formula-markup-geometry';
import actualFormulaGlyphs from './fixtures/pdf-formula-markup-glyphs.json';

const glyph = (text: string, x1: number, y1: number, x2: number, y2: number): PdfFormulaMarkupGlyph => ({ text, x1, y1, x2, y2 });
const fractionRow = (y: number) => [
  glyph('Q', .2, y + .014, .23, y + .034), glyph('=', .24, y + .014, .26, y + .034),
  glyph('4p(1+p²)', .28, y, .43, y + .02), glyph('3q', .34, y + .04, .39, y + .06),
  glyph('>', .46, y + .014, .48, y + .034), glyph('0', .49, y + .014, .51, y + .034),
];

describe('PDF formula markup geometry', () => {
  it('covers a real PDF matrix with split TeX delimiters and keeps its three complete rows', () => {
    const geometry = buildPdfFormulaMarkupGeometry({ glyphs: actualFormulaGlyphs.matrix });
    expect(geometry.highlightRects).toHaveLength(1);
    expect(geometry.highlightRects[0].y1).toBeLessThan(.244);
    expect(geometry.highlightRects[0].y2).toBeGreaterThan(.32);
    expect(geometry.underlineRects).toHaveLength(3);
  });
  it('places three real PDF fractional-equation underlines below all denominators', () => {
    const geometry = buildPdfFormulaMarkupGeometry({ glyphs: actualFormulaGlyphs.fractions });
    expect(geometry.underlineRects).toHaveLength(3);
    for (const rect of geometry.underlineRects) {
      const inRow = actualFormulaGlyphs.fractions.filter(glyph => (glyph.y1 + glyph.y2) / 2 >= rect.y1 && (glyph.y1 + glyph.y2) / 2 <= rect.y2);
      expect(rect.y2).toBe(Math.max(...inRow.map(glyph => glyph.y2)));
    }
  });
  it('underlines each complete fractional equation below its denominator, never each text fragment', () => {
    const geometry = buildPdfFormulaMarkupGeometry({ glyphs: [...fractionRow(.2), ...fractionRow(.32), ...fractionRow(.44)] });
    expect(geometry.underlineRects).toHaveLength(3);
    expect(geometry.underlineRects.map(rect => Number(rect.y2.toFixed(4)))).toEqual([.26, .38, .5]);
    expect(geometry.underlineRects.every(rect => rect.x1 === .2 && rect.x2 === .51)).toBe(true);
    expect(geometry.highlightRects).toEqual([{ x1: .2, y1: .2, x2: .51, y2: .5 }]);
  });

  it('includes lowered scripts in each equation bottom and keeps a right equation label out of markup', () => {
    const geometry = buildPdfFormulaMarkupGeometry({ glyphs: [...fractionRow(.2),
      glyph('i', .222, .232, .231, .245), glyph('(74)', .75, .214, .8, .234)] });
    expect(geometry.underlineRects).toEqual([{ x1: .2, y1: .2, x2: .51, y2: .26 }]);
    expect(geometry.highlightRects[0].x2).toBe(.51);
  });

  it('highlights an entire matrix but underlines its visual rows without tall delimiters joining them', () => {
    const geometry = buildPdfFormulaMarkupGeometry({ glyphs: [
      glyph('M', .1, .24, .13, .26), glyph('=', .15, .24, .17, .26),
      glyph('(', .2, .19, .21, .34), glyph(')', .6, .19, .61, .34),
      glyph('4p²', .24, .2, .3, .22), glyph('4pq', .36, .2, .43, .22), glyph('8p²', .49, .2, .56, .22),
      glyph('4pq', .24, .25, .31, .27), glyph('4q²', .36, .25, .43, .27), glyph('8q²', .49, .25, .56, .27),
      glyph('8p²', .24, .3, .31, .32), glyph('8q²', .36, .3, .43, .32), glyph('16pq', .49, .3, .58, .32),
    ] });
    expect(geometry.highlightRects).toEqual([{ x1: .1, y1: .19, x2: .61, y2: .34 }]);
    expect(geometry.underlineRects).toHaveLength(3);
    expect(geometry.underlineRects.map(rect => rect.y2)).toEqual([.22, .27, .32]);
    expect(geometry.underlineRects[0].x1).toBe(.24);
    expect(geometry.underlineRects[1].x1).toBe(.1);
  });

  it('keeps fractional matrix cells in their matrix row rather than underlining numerator and denominator', () => {
    const geometry = buildPdfFormulaMarkupGeometry({ glyphs: [
      glyph('M', .1, .27, .13, .29), glyph('=', .15, .27, .17, .29),
      glyph('(', .2, .19, .21, .43), glyph(')', .6, .19, .61, .43),
      glyph('4p(1+p²)', .24, .2, .31, .22), glyph('q', .27, .238, .29, .258),
      glyph('4pq', .36, .217, .43, .239), glyph('8p²', .49, .217, .56, .239),
      glyph('4pq', .24, .3, .31, .32), glyph('4q(1+q²)', .36, .283, .44, .303), glyph('p', .39, .321, .41, .341),
      glyph('8q²', .49, .3, .56, .32),
      glyph('8p²', .24, .39, .31, .41), glyph('8q²', .36, .39, .43, .41), glyph('16pq', .49, .39, .58, .41),
    ] });
    expect(geometry.underlineRects).toHaveLength(3);
    expect(geometry.underlineRects.map(rect => rect.y2)).toEqual([.258, .341, .41]);
  });

  it('does not join independently aligned equations across separate columns', () => {
    const right = fractionRow(.2).map(item => ({ ...item, x1: item.x1 + .45, x2: item.x2 + .45 }));
    const geometry = buildPdfFormulaMarkupGeometry({ glyphs: [...fractionRow(.2), ...right] });
    expect(geometry.underlineRects).toHaveLength(2);
    expect(geometry.underlineRects[0].x2).toBeLessThan(geometry.underlineRects[1].x1);
    expect(geometry.highlightRects).toHaveLength(2);
    expect(geometry.highlightRects[0].x2).toBeLessThan(geometry.highlightRects[1].x1);
  });

  it('ignores invalid or empty geometry and never mutates the source glyphs', () => {
    const glyphs = [...fractionRow(.2), glyph('', 0, 0, .1, .1), glyph('x', Number.NaN, .2, .3, .4)];
    const original = structuredClone(glyphs);
    const geometry = buildPdfFormulaMarkupGeometry({ glyphs });
    expect(geometry.underlineRects).toHaveLength(1);
    expect(glyphs).toEqual(original);
    expect(buildPdfFormulaMarkupGeometry({ glyphs: [] })).toEqual({ highlightRects: [], underlineRects: [], equationRows: [] });
  });

  it('keeps sparse matrix columns inside their enclosing delimiters as one highlight block', () => {
    const glyphs = [
      glyph('M', .10, .24, .13, .26), glyph('=', .15, .24, .17, .26),
      glyph('(', .20, .19, .21, .34), glyph(')', .60, .19, .61, .34),
      glyph('1', .24, .20, .25, .22), glyph('2', .40, .20, .41, .22),
      glyph('3', .24, .25, .25, .27), glyph('4', .40, .25, .41, .27),
      glyph('5', .24, .30, .25, .32), glyph('6', .40, .30, .41, .32),
    ];
    const original = structuredClone(glyphs);
    const geometry = buildPdfFormulaMarkupGeometry({ glyphs });
    expect(geometry.highlightRects).toEqual([{ x1: .10, y1: .19, x2: .61, y2: .34 }]);
    expect(geometry.underlineRects).toHaveLength(3);
    expect(geometry.underlineRects.map(rect => rect.y2)).toEqual([.22, .27, .32]);
    expect(glyphs).toEqual(original);
  });

  it('keeps separately enclosed sparse matrices in separate page columns', () => {
    const left = [
      glyph('(', .05, .19, .06, .34), glyph(')', .43, .19, .44, .34),
      glyph('1', .10, .20, .11, .22), glyph('2', .33, .20, .34, .22),
      glyph('3', .10, .25, .11, .27), glyph('4', .33, .25, .34, .27),
      glyph('5', .10, .30, .11, .32), glyph('6', .33, .30, .34, .32),
    ];
    const right = left.map(item => ({ ...item, x1: item.x1 + .5, x2: item.x2 + .5 }));
    const geometry = buildPdfFormulaMarkupGeometry({ glyphs: [...left, ...right] });
    expect(geometry.highlightRects).toEqual([
      { x1: .05, y1: .19, x2: .44, y2: .34 },
      { x1: .55, y1: .19, x2: .94, y2: .34 },
    ]);
    expect(geometry.underlineRects).toHaveLength(6);
    expect(geometry.underlineRects.every(rect => rect.x2 < .5 || rect.x1 > .5)).toBe(true);
  });
});
