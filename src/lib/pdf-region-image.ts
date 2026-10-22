import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { BoundingBox } from '@/types/universal-annotation';
import type { PluginPdfSelectionImage } from './plugins/types';
import {t} from '@/lib/i18n';

export interface PdfImageRegion { pageNumber: number; bbox: BoundingBox }

/** Region geometry is independent of text anchors and of the viewer's CSS zoom. */
export function pdfImageRegion(pageNumber: number, rects: readonly BoundingBox[], pages: readonly number[] = [pageNumber]): PdfImageRegion | null {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pages.length !== 1 || pages[0] !== pageNumber || !rects.length) return null;
  if (rects.some(r => ![r.x1, r.y1, r.x2, r.y2].every(Number.isFinite)
    || r.x1 < 0 || r.y1 < 0 || r.x2 > 1 || r.y2 > 1 || r.x2 <= r.x1 || r.y2 <= r.y1)) return null;
  return { pageNumber, bbox: { x1: Math.min(...rects.map(r => r.x1)), y1: Math.min(...rects.map(r => r.y1)),
    x2: Math.max(...rects.map(r => r.x2)), y2: Math.max(...rects.map(r => r.y2)) } };
}

let renderTail: Promise<void> = Promise.resolve();
async function waitForRenderTurn(previous: Promise<void>, signal?: AbortSignal) {
  if (!signal) return previous;
  signal.throwIfAborted();
  let abort!: () => void;
  try {
    await Promise.race([previous, new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', abort); }
}
/** At most one independent OCR raster is rendered at a time across panes. */
export async function renderPdfRegionImage(input: {
  pdfDocument: PDFDocumentProxy; region: PdfImageRegion;
  identity: NonNullable<PluginPdfSelectionImage['document']>; selectionToken: number;
  signal?: AbortSignal; isCurrent: () => boolean;
  createCanvas?: () => HTMLCanvasElement;
}): Promise<PluginPdfSelectionImage> {
  const check = () => {
    input.signal?.throwIfAborted();
    if (!input.isCurrent()) throw new DOMException(t('formula.region.sourceChanged'), 'AbortError');
  };
  check();
  const region = pdfImageRegion(input.region.pageNumber, [input.region.bbox]);
  if (!region || region.pageNumber > input.pdfDocument.numPages) throw new Error(t('formula.region.invalid'));
  const previous = renderTail;
  let release!: () => void;
  const ownTurn = new Promise<void>(resolve => { release = resolve; });
  renderTail = previous.then(() => ownTurn);
  let canvas: HTMLCanvasElement | undefined;
  let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
  const cancel = () => task?.cancel();
  try {
    await waitForRenderTurn(previous, input.signal);
    check();
    const page = await input.pdfDocument.getPage(region.pageNumber);
    check();
    const base = page.getViewport({ scale: 1 });
    if (!(base.width > 0 && base.height > 0)) throw new Error(t('formula.region.pageUnavailable'));
    const bbox = region.bbox;
    // Six PDF units of source context, independent of display zoom or DPR.
    const padded = { x1: Math.max(0, bbox.x1 - 6 / base.width), y1: Math.max(0, bbox.y1 - 6 / base.height),
      x2: Math.min(1, bbox.x2 + 6 / base.width), y2: Math.min(1, bbox.y2 + 6 / base.height) };
    const width = (padded.x2 - padded.x1) * base.width, height = (padded.y2 - padded.y1) * base.height;
    const scale = Math.min(3, 4094 / Math.max(width, height), Math.sqrt(3_990_000 / (width * height)));
    const viewport = page.getViewport({ scale });
    const left = Math.floor(padded.x1 * viewport.width + 1e-8), top = Math.floor(padded.y1 * viewport.height + 1e-8);
    const right = Math.ceil(padded.x2 * viewport.width - 1e-8), bottom = Math.ceil(padded.y2 * viewport.height - 1e-8);
    canvas = input.createCanvas?.() ?? document.createElement('canvas');
    canvas.width = Math.max(1, right - left); canvas.height = Math.max(1, bottom - top);
    const context = canvas.getContext('2d');
    if (!context) throw new Error(t('formula.region.renderUnavailable'));
    check();
    task = page.render({ canvas, canvasContext: context, viewport, transform: [1, 0, 0, 1, -left, -top], background: 'rgb(255,255,255)' });
    input.signal?.addEventListener('abort', cancel, { once: true });
    await task.promise;
    check();
    return { pageNumber: region.pageNumber, bbox: { ...bbox },
      imageBbox: { x1: left / viewport.width, y1: top / viewport.height, x2: right / viewport.width, y2: bottom / viewport.height },
      dataUrl: canvas.toDataURL('image/png'), mimeType: 'image/png', width: canvas.width, height: canvas.height,
      source: 'current-selection', document: { ...input.identity }, selectionToken: input.selectionToken };
  } finally {
    input.signal?.removeEventListener('abort', cancel);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    release();
  }
}
