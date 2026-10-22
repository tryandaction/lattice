import { beforeEach,describe, expect, it, vi } from 'vitest';
import {setLocale} from '@/lib/i18n';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pdfImageRegion, renderPdfRegionImage } from '../pdf-region-image';

const bbox = { x1: .2, y1: .3, x2: .6, y2: .4 };
function fixture(width = 600, height = 800) {
  const canvas = { width: 0, height: 0, getContext: () => ({}), toDataURL: vi.fn(() => 'data:image/png;base64,pixels') } as unknown as HTMLCanvasElement;
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const page = { getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: width * scale, height: height * scale })), render };
  const pdf = { numPages: 3, getPage: vi.fn(async () => page) } as unknown as PDFDocumentProxy;
  return { canvas, page, render, pdf, input: { pdfDocument: pdf, region: { pageNumber: 2, bbox }, identity: { filePath: 'scan.pdf', paneId: 'left' }, selectionToken: 2, isCurrent: () => true, createCanvas: () => canvas } };
}
describe('bounded PDF region image rendering', () => {
  beforeEach(()=>setLocale('en-US'));
  it('keeps exact formula geometry separate from the padded source pixels at three pixels per PDF unit', async () => {
    const f = fixture();
    const image = await renderPdfRegionImage(f.input);
    expect(image.bbox).toEqual(bbox);
    expect(image.imageBbox?.x1).toBeLessThan(bbox.x1);
    expect(image.imageBbox?.y2).toBeGreaterThan(bbox.y2);
    expect(image.width).toBe(756);
    expect(image.height).toBe(276);
    expect(f.pdf.getPage).toHaveBeenCalledWith(2);
    expect(f.render).toHaveBeenCalledWith(expect.objectContaining({ transform: [1, 0, 0, 1, -342, -702], viewport: { width: 1800, height: 2400 } }));
    expect([f.canvas.width, f.canvas.height]).toEqual([0, 0]);
  });
  it('rejects multiple pages and invalid geometry rather than silently cropping one page', async () => {
    expect(pdfImageRegion(1, [bbox], [1, 2])).toBeNull();
    expect(pdfImageRegion(1, [{ ...bbox, x2: Infinity }])).toBeNull();
    expect(pdfImageRegion(1, [{ ...bbox, y2: 1.1 }])).toBeNull();
    const f = fixture();
    await expect(renderPdfRegionImage({ ...f.input, region: { pageNumber: 4, bbox } })).rejects.toThrow(/one PDF page/);
    expect(f.pdf.getPage).not.toHaveBeenCalled();
  });
  it('caps raster allocation for a large page without allocating a full page surface', async () => {
    const f = fixture(20_000, 30_000);
    const image = await renderPdfRegionImage({ ...f.input, region: { pageNumber: 1, bbox: { x1: 0, y1: 0, x2: 1, y2: 1 } } });
    expect(image.width * image.height).toBeLessThanOrEqual(4_000_000);
    expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(4096);
  });
  it('cancels the source render and releases its canvas when the request aborts', async () => {
    const f = fixture(), controller = new AbortController();
    let reject!: (reason: unknown) => void;
    const cancel = vi.fn(() => reject(new DOMException('Cancelled', 'AbortError')));
    f.render.mockReturnValue({ promise: new Promise<void>((_, fail) => { reject = fail; }), cancel });
    const pending = renderPdfRegionImage({ ...f.input, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(f.render).toHaveBeenCalledTimes(1));
    controller.abort();
    await rejected;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(f.canvas.toDataURL).not.toHaveBeenCalled();
    expect([f.canvas.width, f.canvas.height]).toEqual([0, 0]);
  });
  it('rejects a completed raster when the selection or source changed during rendering', async () => {
    const f = fixture();
    let current = true;
    f.render.mockImplementation(() => ({ cancel: vi.fn(), promise: Promise.resolve().then(() => { current = false; }) }));
    await expect(renderPdfRegionImage({ ...f.input, isCurrent: () => current })).rejects.toThrow(/changed/);
    expect(f.canvas.toDataURL).not.toHaveBeenCalled();
  });
  it('serializes render allocations and does not render a cancelled queued request', async () => {
    const first = fixture(), second = fixture(), third = fixture();
    let finish!: () => void;
    first.render.mockReturnValue({ promise: new Promise<void>(resolve => { finish = resolve; }), cancel: vi.fn() });
    const firstRequest = renderPdfRegionImage(first.input);
    await vi.waitFor(() => expect(first.render).toHaveBeenCalledTimes(1));
    const controller = new AbortController();
    const secondRequest = renderPdfRegionImage({ ...second.input, signal: controller.signal });
    const rejected = expect(secondRequest).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    const thirdRequest = renderPdfRegionImage(third.input);
    expect(second.render).not.toHaveBeenCalled();
    expect(third.render).not.toHaveBeenCalled();
    finish();
    await Promise.all([firstRequest, thirdRequest]);
    expect(second.pdf.getPage).not.toHaveBeenCalled();
    expect(third.render).toHaveBeenCalledTimes(1);
  });
});
