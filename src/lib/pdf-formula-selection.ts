import type { PdfCanonicalSelection } from './pdf-selection-session';
import type { PdfTextKernelPage } from './pdf-text-kernel';
import type { ImageAnnotationPreview } from '@/types/universal-annotation';
import { inferPdfFormulaFromSelection, type PdfFormulaGlyph } from './pdf-formula-structure';
import { detectPdfFormulaRules } from './pdf-formula-rules';

/** Rendering layers may normalize script height; mathematical structure uses source glyphs. */
export function remapPdfFormulaSelection(selection: PdfCanonicalSelection, kernel: PdfTextKernelPage): PdfCanonicalSelection {
    const chars = kernel.chars.filter(c => c.text.trim() && selection.pageRects.some(r => {
        const b = c.pdfRect, x = (b.x1 + b.x2) / 2, h = b.y2 - b.y1;
        // Native text selection frequently clips raised/lowered glyphs. Once a
        // formula is suspected, the horizontal formula span is authoritative.
        return x >= r.x1 - .01 && x <= r.x2 + .01
            && b.y2 >= r.y1 - Math.max(h, r.y2 - r.y1)
            && b.y1 <= r.y2 + Math.max(h, r.y2 - r.y1);
    }));
    if (!chars.length) return selection;
    const startOffset = Math.min(...chars.map(c => c.charIndex));
    const endOffset = Math.max(...chars.map(c => c.charIndex + c.text.length));
    const text = kernel.normalizedText.slice(startOffset, endOffset);
    return { ...selection, startOffset, endOffset, text, textQuote: { ...selection.textQuote, exact: text } };
}
/** Synchronous local recognition keeps clipboard actions inside the click gesture. */
export function enrichPdfFormulaSelection(selection: PdfCanonicalSelection, kernel: PdfTextKernelPage, canvas?: HTMLCanvasElement | null, force = false, pointer?: {
    start: {
        x: number;
        y: number;
    };
    end: {
        x: number;
        y: number;
    };
}): PdfCanonicalSelection {
    if (selection.formula || selection.readingOrder || selection.pageSelections?.length || kernel.pageNumber !== selection.pageNumber)
        return selection;
    let text = selection.textQuote.exact;
    if (!force && (!/[=+−±×÷∑∏∫∂∇ℏα-ωΑ-Ω_^]/u.test(text) || /\b(?:the|this|that|where|from|with|which|when|result|using|and|are|is)\b|[㐀-鿿]/iu.test(text)))
        return selection;
    if (pointer) {
        const hit = (point: {
            x: number;
            y: number;
        }) => kernel.chars.filter(c => c.text.trim()).map(c => { const r = c.pdfRect; return { c, d: Math.hypot(Math.max(0, r.x1 * kernel.viewportWidth - point.x, point.x - r.x2 * kernel.viewportWidth), Math.max(0, r.y1 * kernel.viewportHeight - point.y, point.y - r.y2 * kernel.viewportHeight)) }; }).sort((a, b) => a.d - b.d)[0];
        const start = hit(pointer.start), end = hit(pointer.end);
        if (start && end && start.d <= 3 && end.d <= 3) {
            const from = Math.min(start.c.charIndex, end.c.charIndex), to = Math.max(start.c.charIndex + start.c.text.length, end.c.charIndex + end.c.text.length);
            const next = kernel.normalizedText.slice(from, to);
            if (next.length <= 1500 && !/[㐀-鿿]|\b(?:the|this|where|from|with|which|when|using|and|are)\b/iu.test(next)) {
                text = next;
                selection = { ...selection, startOffset: from, endOffset: to, text, textQuote: { ...selection.textQuote, exact: text } };
            }
        }
    }
    let selected = kernel.chars.filter(c => c.charIndex >= selection.startOffset && c.charIndex < selection.endOffset && c.text.trim());
    const sizes = selected.filter(c => !/[()[\]]/.test(c.text)).map(c => c.pdfRect.y2 - c.pdfRect.y1).sort((a, b) => a - b);
    const em = sizes[Math.floor(sizes.length / 2)];
    const brackets = selected.filter(c => /^[()[\]]$/.test(c.text) && (c.pdfRect.y2 - c.pdfRect.y1) > em * 1.5);
    if (brackets.length >= 2) {
        const b = { x1: Math.min(...selected.map(c => c.pdfRect.x1)), x2: Math.max(...selected.map(c => c.pdfRect.x2)), y1: Math.min(...brackets.map(c => c.pdfRect.y1)), y2: Math.max(...brackets.map(c => c.pdfRect.y2)) };
        const inside = kernel.chars.filter(c => c.text.trim() && c.pdfRect.x1 >= b.x1 - .002 && c.pdfRect.x2 <= b.x2 + .002 && (c.pdfRect.y1 + c.pdfRect.y2) / 2 >= b.y1 - em * .25 && (c.pdfRect.y1 + c.pdfRect.y2) / 2 <= b.y2 + em * .25);
        if (inside.length >= selected.length && inside.length < 500) {
            selected = inside;
            text = inside.map(c => c.text).join('');
            selection = { ...selection, startOffset: Math.min(...inside.map(c => c.charIndex)), endOffset: Math.max(...inside.map(c => c.charIndex + c.text.length)), text, textQuote: { ...selection.textQuote, exact: text } };
        }
    }
    if (!selected.length || !kernel.viewportWidth || !kernel.viewportHeight)
        return selection;
    const chars: PdfFormulaGlyph[] = selected.map(c => ({ text: c.text, ...c.pdfRect, x1: c.pdfRect.x1 * kernel.viewportWidth, x2: c.pdfRect.x2 * kernel.viewportWidth, y1: c.pdfRect.y1 * kernel.viewportHeight, y2: c.pdfRect.y2 * kernel.viewportHeight }));
    const rects = selection.pageRects.map(r => ({ x1: r.x1 * kernel.viewportWidth, x2: r.x2 * kernel.viewportWidth, y1: r.y1 * kernel.viewportHeight, y2: r.y2 * kernel.viewportHeight }));
    const bounds = { x1: Math.min(...chars.map(c => c.x1)), y1: Math.min(...chars.map(c => c.y1)), x2: Math.max(...chars.map(c => c.x2)), y2: Math.max(...chars.map(c => c.y2)) };
    let formulaPreview: ImageAnnotationPreview | undefined;
    let rules: PdfFormulaGlyph[] = [];
    let inkRows: {data:Uint8ClampedArray;width:number;height:number;x:number;y:number;sx:number;sy:number}|undefined;
    if (canvas?.width && canvas.height) {
        try {
            const sx = canvas.width / kernel.viewportWidth, sy = canvas.height / kernel.viewportHeight;
            const paddingX=Math.max(3,Math.ceil(em*kernel.viewportHeight*sx*.7)),paddingY=Math.max(3,Math.ceil(Math.max(...chars.map(c=>c.y2-c.y1))*sy*.4));
            const x = Math.max(0, Math.floor(bounds.x1 * sx) - paddingX), y = Math.max(0, Math.floor(bounds.y1 * sy) - paddingY);
            const width = Math.min(canvas.width - x, Math.ceil(bounds.x2 * sx) - x + paddingX), height = Math.min(canvas.height - y, Math.ceil(bounds.y2 * sy) - y + paddingY);
            if (width > 0 && height > 0 && width * height <= 4000000) {
                const crop = document.createElement('canvas');
                crop.width = width;
                crop.height = height;
                const ctx = crop.getContext('2d');
                if (ctx) {
                    ctx.fillStyle = 'white';
                    ctx.fillRect(0, 0, width, height);
                    ctx.drawImage(canvas, x, y, width, height, 0, 0, width, height);
                    const pixels=ctx.getImageData(0,0,width,height).data;
                    inkRows={data:pixels,width,height,x,y,sx,sy};
                    rules = detectPdfFormulaRules({ data: pixels, width, height, glyphs: chars.map(g => ({ ...g, x1: g.x1 * sx - x, x2: g.x2 * sx - x, y1: g.y1 * sy - y, y2: g.y2 * sy - y })) }).map(r => ({ ...r, x1: (r.x1 + x) / sx, x2: (r.x2 + x) / sx, y1: (r.y1 + y) / sy, y2: (r.y2 + y) / sy }));
                    formulaPreview = { type: 'image', dataUrl: crop.toDataURL('image/png'), width, height };
                }
            }
        }
        catch { /* No canvas pixels: preserve the source and expose manual correction instead. */ }
    }
    const inference = inferPdfFormulaFromSelection({ text: text + rules.map(r => r.text).join(''), chars: [...chars, ...rules], rects });
    if (inference.status === 'unavailable' && !force)
        return selection;
    // Avoid inviting formula actions for ordinary prose even when glyph mapping differs.
    if (!force && !/[=+−±×÷∑∏∫∂∇ℏα-ωΑ-Ω_^]/u.test(text))
        return selection;
    const ready = inference.status === 'ready';
    if(inference.bounds && inkRows){
        const image=inkRows,b=inference.bounds;
        const left=Math.max(0,Math.floor(b.x1*image.sx-image.x)),right=Math.min(image.width,Math.ceil(b.x2*image.sx-image.x));
        const hasInk=(row:number)=>{for(let col=left;col<right;col++){const i=(row*image.width+col)*4;if(image.data[i+3]>200&&Math.max(image.data[i],image.data[i+1],image.data[i+2])<100)return true;}return false;};
        let top=Math.max(0,Math.floor(b.y1*image.sy-image.y)),bottom=Math.min(image.height,Math.ceil(b.y2*image.sy-image.y));
        while(top>0&&hasInk(top-1))top--;
        while(bottom<image.height&&hasInk(bottom))bottom++;
        b.y1=Math.min(b.y1,(top+image.y)/image.sy);b.y2=Math.max(b.y2,(bottom+image.y)/image.sy);
    }
    // The original formula region is known even when its TeX needs correction.
    const normalized = inference.bounds ? [{ x1: inference.bounds.x1 / kernel.viewportWidth, x2: inference.bounds.x2 / kernel.viewportWidth, y1: inference.bounds.y1 / kernel.viewportHeight, y2: inference.bounds.y2 / kernel.viewportHeight }] : selection.pageRects;
    return { ...selection, formula: { latex: inference.latex, rawText: text, status: ready ? 'ready' : 'needs-review', source: 'geometry', originalRects: selected.map(c => ({ ...c.pdfRect })) }, formulaPreview, pageRects: normalized,
        viewportRects: normalized.map(r => ({ pageNumber: selection.pageNumber, left: r.x1 * kernel.viewportWidth, top: r.y1 * kernel.viewportHeight, width: (r.x2 - r.x1) * kernel.viewportWidth, height: (r.y2 - r.y1) * kernel.viewportHeight })),
        quads: normalized.map(r => ({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y1, x3: r.x2, y3: r.y2, x4: r.x1, y4: r.y2 })) };
}
