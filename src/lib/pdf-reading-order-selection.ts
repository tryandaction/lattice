import type { PdfCanonicalChar } from './pdf-canonical-text-anchoring';
import { buildPdfCanonicalChars, resolvePdfVisualColumnScope } from './pdf-canonical-text-anchoring';
import type { PdfPageTextModel } from './pdf-page-text-cache';
import type { PdfCanonicalSelection } from './pdf-selection-session';
type Point = {
    x: number;
    y: number;
};
function orderPdfColumnChars(chars: readonly PdfCanonicalChar[], gutter: number): PdfCanonicalChar[] {
    const items = new Map<number, { left: number; right: number; top: number; bottom: number }>();
    for (const char of chars) {
        const item = items.get(char.itemIndex);
        items.set(char.itemIndex, item ? { left: Math.min(item.left, char.left), right: Math.max(item.right, char.right), top: Math.min(item.top, char.top), bottom: Math.max(item.bottom, char.bottom) }
            : { left: char.left, right: char.right, top: char.top, bottom: char.bottom });
    }
    const spanning = [...items].filter(([, item]) => item.left < gutter && item.right > gutter).sort((a, b) => a[1].top - b[1].top);
    const bands = new Map(chars.map(char => {
        const index = spanning.findIndex(([itemIndex]) => itemIndex === char.itemIndex);
        return [char, index >= 0 ? index * 2 + 1 : spanning.filter(([, item]) => item.bottom < char.centerY).length * 2];
    }));
    return [...chars].sort((a, b) => bands.get(a)! - bands.get(b)!
        || (bands.get(a)! % 2 ? a.left - b.left : Number(a.centerX >= gutter) - Number(b.centerX >= gutter)
            || (Math.abs(a.centerY - b.centerY) > Math.min(a.height, b.height) * .6 ? a.centerY - b.centerY : a.left - b.left)));
}
export function selectPdfReadingOrderChars(input: {
    chars: readonly PdfCanonicalChar[];
    gutter: number;
    start: Point;
    end: Point;
}): PdfCanonicalChar[] | null {
    const { gutter } = input;
    if ((input.start.x < gutter) === (input.end.x < gutter))
        return null;
    const distance = (c: PdfCanonicalChar, p: Point) => Math.hypot(Math.max(0, c.left - p.x, p.x - c.right), Math.max(0, c.top - p.y, p.y - c.bottom));
    const nearest = (p: Point) => input.chars.filter(c => c.text.trim()).map(c => ({ c, d: distance(c, p) })).sort((a, b) => a.d - b.d || Math.abs(a.c.centerY - p.y) - Math.abs(b.c.centerY - p.y))[0];
    const a = nearest(input.start), b = nearest(input.end);
    if (!a || !b || a.d > Math.max(3, a.c.height * .25) || b.d > Math.max(3, b.c.height * .25))
        return null;
    const left = input.start.x < gutter ? { hit: a.c, point: input.start } : { hit: b.c, point: input.end };
    const right = input.start.x < gutter ? { hit: b.c, point: input.end } : { hit: a.c, point: input.start };
    const sameRow = Math.abs(left.hit.centerY - right.hit.centerY) <= Math.min(left.hit.height, right.hit.height) * .6;
    const ordered = orderPdfColumnChars(input.chars.filter(c => c.text.trim()
        && (!sameRow || Math.abs(c.centerY - left.hit.centerY) <= Math.max(c.height, left.hit.height) * .65)), gutter);
    const first = ordered.indexOf(left.hit) <= ordered.indexOf(right.hit) ? left : right;
    const last = first === left ? right : left;
    const from = ordered.indexOf(first.hit) + Number(first.point.x > first.hit.centerX);
    const to = ordered.indexOf(last.hit) - Number(last.point.x < last.hit.centerX);
    return from >= 0 && to >= from ? ordered.slice(from, to + 1) : null;
}
export function pdfReadingOrderText(chars: readonly PdfCanonicalChar[]): string {
    let text = '';
    let prev: PdfCanonicalChar | undefined;
    for (const c of chars) {
        if (prev) {
            const differentLine = Math.abs(c.centerY - prev.centerY) > Math.min(c.height, prev.height) * .6;
            if (differentLine || c.left - prev.right > Math.min(c.height, prev.height) * .15 || c.left < prev.left)
                text += ' ';
        }
        text += c.text;
        prev = c;
    }
    return text.trim();
}
/** Page-local subrange in visual reading order, independent of PDF content-stream order. */
export function buildPdfReadingOrderedPage(input: {
    model: PdfPageTextModel;
    startOffset: number;
    endOffset: number;
    startPoint?: Point;
    endPoint?: Point;
}): PdfCanonicalSelection | null {
    const { model } = input;
    const chars = buildPdfCanonicalChars(model).filter(c => c.text.trim() && c.width > 0 && c.height > 0);
    if (!chars.length)
        return null;
    // A title or full-width caption fills the physical gutter. Detect columns
    // from the remaining text, then keep each spanning row between body bands.
    const spanningRows = model.itemRects.filter(rect => rect.width >= model.viewportWidth * .6
        && rect.left < model.viewportWidth * .3 && rect.left + rect.width > model.viewportWidth * .7)
        .sort((a, b) => a.top - b.top);
    const spanningItems = new Set(spanningRows.map(rect => rect.itemIndex));
    const bodyChars = chars.filter(char => !spanningItems.has(char.itemIndex));
    const scope = resolvePdfVisualColumnScope({ chars: bodyChars, viewportWidth: model.viewportWidth, startX: model.viewportWidth * .25, endX: model.viewportWidth * .25 });
    if (!scope)
        return null;
    const gutter = scope.boundaryX;
    const ordered = orderPdfColumnChars(chars, gutter);
    const pointChar = (p: Point) => [...chars].sort((a, b) => Math.hypot(Math.max(0, a.left - p.x, p.x - a.right), Math.max(0, a.top - p.y, p.y - a.bottom)) - Math.hypot(Math.max(0, b.left - p.x, p.x - b.right), Math.max(0, b.top - p.y, p.y - b.bottom)))[0];
    const startChar = input.startPoint ? pointChar(input.startPoint) : input.startOffset === 0 ? ordered[0] : chars.find(c => c.normalizedEnd > input.startOffset && c.normalizedStart >= input.startOffset);
    const endChar = input.endPoint ? pointChar(input.endPoint) : input.endOffset === model.normalizedText.length ? ordered.at(-1) : [...chars].reverse().find(c => c.normalizedStart < input.endOffset && c.normalizedEnd <= input.endOffset);
    if (!startChar || !endChar)
        return null;
    const from = ordered.indexOf(startChar) + (input.startPoint && input.startPoint.x > startChar.centerX ? 1 : 0);
    const to = ordered.indexOf(endChar) - (input.endPoint && input.endPoint.x < endChar.centerX ? 1 : 0);
    if (to < from)
        return null;
    const selected = ordered.slice(from, to + 1);
    const text = pdfReadingOrderText(selected);
    const rects: Array<{
        x1: number;
        y1: number;
        x2: number;
        y2: number;
    }> = [];
    for (const c of selected) {
        const r = { x1: c.left / model.viewportWidth, y1: c.top / model.viewportHeight, x2: c.right / model.viewportWidth, y2: c.bottom / model.viewportHeight };
        const prev = rects.at(-1);
        if (prev && Math.abs(prev.y1 - r.y1) < c.height / model.viewportHeight * .35 && r.x1 >= prev.x1 && r.x1 - prev.x2 <= c.height / model.viewportWidth * .5) {
            prev.x2 = Math.max(prev.x2, r.x2);
            prev.y1 = Math.min(prev.y1, r.y1);
            prev.y2 = Math.max(prev.y2, r.y2);
        }
        else
            rects.push(r);
    }
    return { readingOrder: true, pageNumber: model.pageNumber, startOffset: Math.min(...selected.map(c => c.normalizedStart)), endOffset: Math.max(...selected.map(c => c.normalizedEnd)), text, textQuote: { exact: text, prefix: '', suffix: '', source: 'pdfjs-text-model', confidence: 'exact' }, pageRects: rects, viewportRects: rects.map(r => ({ pageNumber: model.pageNumber, left: r.x1 * model.viewportWidth, top: r.y1 * model.viewportHeight, width: (r.x2 - r.x1) * model.viewportWidth, height: (r.y2 - r.y1) * model.viewportHeight })), quads: rects.map(r => ({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y1, x3: r.x2, y3: r.y2, x4: r.x1, y4: r.y2 })) };
}
