import type { PdfRenderedPageContext, PdfSelectionResolutionResult } from './pdf-selection-reconciler';
import type { PdfCanonicalSelection } from './pdf-selection-session';
import { buildRenderedPdfPageTextModel, resolvePdfPageTextOffset } from './pdf-page-text-cache';
import { buildPdfTextKernelAnchor, buildPdfTextKernelPage } from './pdf-text-kernel';
import { buildPdfReadingOrderedPage } from './pdf-reading-order-selection';
import { resolvePdfPointerBoundary } from './pdf-canonical-text-anchoring';

export function combinePdfPageSelections(pages: PdfCanonicalSelection[]): PdfCanonicalSelection {
  const first = pages[0];
  if (!first) throw new Error('A PDF selection must contain at least one page.');
  const text = pages.map(page => page.textQuote.exact).join('\n\n');
  return { ...first, text, textQuote: { ...first.textQuote, exact: text },
    pageSelections: pages, viewportRects: pages.flatMap(page => page.viewportRects) };
}

/** Resolve all selected pages before persisting any annotation. */
export function resolvePdfMultiPageSelection(input: { range: Range; pages: PdfRenderedPageContext[]; dragStartPoint?:{x:number;y:number};dragEndPoint?:{x:number;y:number} }): PdfSelectionResolutionResult {
  const pageFor = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('[data-page-number]');
  const pageAt=(p:{x:number;y:number}|undefined)=>p?input.pages.find(page=>{const r=page.element.getBoundingClientRect();return p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom;}):undefined;
  const pointerStart=pageAt(input.dragStartPoint),pointerEnd=pageAt(input.dragEndPoint);
  const usePointer=pointerStart&&pointerEnd&&pointerStart.pageNumber!==pointerEnd.pageNumber;
  const start = usePointer?Math.min(pointerStart.pageNumber,pointerEnd.pageNumber):Number(pageFor(input.range.startContainer)?.dataset.pageNumber);
  const end = usePointer?Math.max(pointerStart.pageNumber,pointerEnd.pageNumber):Number(pageFor(input.range.endContainer)?.dataset.pageNumber);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end <= start) {
    return { ok: false, reason: 'missing-page', viewportRects: [] };
  }
  const selections: PdfCanonicalSelection[] = [];
  for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
    const page = input.pages.find(candidate => candidate.pageNumber === pageNumber);
    if (!page) return { ok: false, reason: 'missing-page', viewportRects: [] };
    const model = buildRenderedPdfPageTextModel(page.element);
    if (!model) return { ok: false, reason: 'missing-text-layer', viewportRects: [] };
    let startOffset = pageNumber === start && !usePointer ? resolvePdfPageTextOffset({ model,
      container: input.range.startContainer, offset: input.range.startOffset, affinity: 'start' }) : 0;
    let endOffset = pageNumber === end && !usePointer ? resolvePdfPageTextOffset({ model,
      container: input.range.endContainer, offset: input.range.endOffset, affinity: 'end' }) : model.normalizedText.length;
    if (startOffset !== null && endOffset === startOffset && (pageNumber === start || pageNumber === end)) continue;
    if (startOffset === null || endOffset === null || endOffset <= startOffset) {
      return { ok: false, reason: 'unresolved-text', viewportRects: [] };
    }
    const r=page.element.getBoundingClientRect();
    const local=(p:{x:number;y:number}|undefined)=>p?{x:p.x-r.left,y:p.y-r.top}:undefined;
    const firstPoint=usePointer?(pointerStart.pageNumber===start?input.dragStartPoint:input.dragEndPoint):undefined;
    const lastPoint=usePointer?(pointerStart.pageNumber===end?input.dragStartPoint:input.dragEndPoint):undefined;
    const ordered=buildPdfReadingOrderedPage({model,startOffset,endOffset,startPoint:pageNumber===start?local(firstPoint):undefined,endPoint:pageNumber===end?local(lastPoint):undefined});
    if(ordered){selections.push(ordered);continue;}
    if(pageNumber===start&&firstPoint)startOffset=resolvePdfPointerBoundary({model,point:firstPoint,pageRect:r,side:'start'})?.offset??null;
    if(pageNumber===end&&lastPoint)endOffset=resolvePdfPointerBoundary({model,point:lastPoint,pageRect:r,side:'end'})?.offset??null;
    if(startOffset===null||endOffset===null||endOffset<=startOffset)return {ok:false,reason:'unresolved-text',viewportRects:[]};
    const kernel = buildPdfTextKernelPage({ model });
    const anchor = buildPdfTextKernelAnchor({ page: kernel, model, startCharIndex: startOffset, endCharIndex: endOffset });
    if (!anchor || !anchor.text.trim() || !anchor.rects.length) return { ok: false, reason: 'unresolved-text', viewportRects: [] };
    selections.push({ pageNumber, startOffset: anchor.startCharIndex, endOffset: anchor.endCharIndex,
      text: anchor.text, textQuote: anchor.quote, pageRects: anchor.rects, quads: anchor.quads,
      textKernelVersion: anchor.modelVersion, textSource: anchor.quote.source, textConfidence: anchor.confidence,
      viewportRects: anchor.rects.map(rect => ({ pageNumber, left: rect.x1 * page.width, top: rect.y1 * page.height,
        width: (rect.x2 - rect.x1) * page.width, height: (rect.y2 - rect.y1) * page.height })),
    });
  }
  return selections.length > 0 ? { ok: true, selection: combinePdfPageSelections(selections) }
    : { ok: false, reason: 'unresolved-text', viewportRects: [] };
}
