import type { PdfFormulaGlyph } from './pdf-formula-structure';
/** Detect painted fraction rules omitted by PDF text extraction. All units are crop pixels. */
export function detectPdfFormulaRules(input: {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    glyphs: readonly PdfFormulaGlyph[];
}): PdfFormulaGlyph[] {
    const { data, width, height, glyphs } = input;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 4000000 || data.length !== width * height * 4 || !glyphs.length)
        return [];
    const sizes = glyphs.map(g => g.y2 - g.y1).filter(h => h > 2).sort((a, b) => a - b);
    const em = sizes[Math.floor(sizes.length / 2)];
    if (!em)
        return [];
    const runs: PdfFormulaGlyph[] = [];
    for (let y = 0; y < height; y++) {
        let start = -1;
        for (let x = 0; x <= width; x++) {
            const i = (y * width + x) * 4;
            // Thin vector rules can rasterize as gray at reduced PDF zoom.
            const dark = x < width && data[i + 3] > 200 && Math.max(data[i], data[i + 1], data[i + 2]) < 180;
            if (dark && start < 0)
                start = x;
            if (!dark && start >= 0) {
                if (x - start > em * 0.6) {
                    const previous = runs.findLast(r => r.y2 === y && Math.abs(r.x1 - start) <= 2 && Math.abs(r.x2 - x) <= 2);
                    if (previous) {
                        previous.y2 = y + 1;
                        previous.x1 = Math.min(previous.x1, start);
                        previous.x2 = Math.max(previous.x2, x);
                    }
                    else
                        runs.push({ text: '−', x1: start, y1: y, x2: x, y2: y + 1 });
                }
                start = -1;
            }
        }
    }
    return runs.filter(r => r.y2 - r.y1 <= Math.max(2, em * 0.2)
        && !glyphs.some(g => g.x1 < r.x2 && g.x2 > r.x1 && g.y1 < r.y2 && g.y2 > r.y1)
        && glyphs.some(g => g.x1 >= r.x1 - em * 0.1 && g.x2 <= r.x2 + em * 0.1 && g.y2 <= r.y1 && r.y1 - g.y2 < em * 2)
        && glyphs.some(g => g.x1 >= r.x1 - em * 0.1 && g.x2 <= r.x2 + em * 0.1 && g.y1 >= r.y2 && g.y1 - r.y2 < em * 2)).slice(0, 50);
}
