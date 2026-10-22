// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright';
import { PDFDocument, degrees } from 'pdf-lib';
import sharp from 'sharp';

// Offline pixel regression: real PDF.js rasterization and browser canvas, no OCR/model I/O.
const require = createRequire(import.meta.url);
let browser: Browser, server: Server, url: string;
const source = `
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/build/pdf.mjs';
import { renderPdfRegionImage } from './src/lib/pdf-region-image';
GlobalWorkerOptions.workerSrc = '/worker.mjs';
window.capture = async bytes => {
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
  try {
    const page = await pdf.getPage(1), base = page.getViewport({ scale: 1 });
    const p = base.convertToViewportRectangle([120,300,360,380]);
    const bbox = { x1: Math.min(p[0],p[2])/base.width, x2: Math.max(p[0],p[2])/base.width, y1: Math.min(p[1],p[3])/base.height, y2: Math.max(p[1],p[3])/base.height };
    const display = document.createElement('canvas'); document.body.appendChild(display);
    const rasters = [];
    for (const zoom of [.5, 1.2, 2]) {
      const viewport = page.getViewport({ scale: zoom }); display.width = viewport.width; display.height = viewport.height;
      await page.render({ canvas: display, canvasContext: display.getContext('2d'), viewport }).promise;
      const unchanged = display.toDataURL();
      const result = await renderPdfRegionImage({ pdfDocument: pdf, region: { pageNumber: 1, bbox }, identity: { filePath:'scan.pdf', paneId:'left' }, selectionToken:1, isCurrent:()=>true });
      rasters.push({ ...result, displayUnchanged: unchanged === display.toDataURL() });
    }
    const image = rasters[0], crop = image.imageBbox;
    const viewport = page.getViewport({ scale: 3 });
    const reference = document.createElement('canvas'); reference.width=viewport.width; reference.height=viewport.height;
    await page.render({canvas:reference,canvasContext:reference.getContext('2d'),viewport}).promise;
    const expected = reference.getContext('2d').getImageData(Math.round(crop.x1*viewport.width),Math.round(crop.y1*viewport.height),image.width,image.height).data;
    const bitmap = new Image(); bitmap.src=image.dataUrl; await bitmap.decode();
    const actualCanvas=document.createElement('canvas');actualCanvas.width=image.width;actualCanvas.height=image.height;
    actualCanvas.getContext('2d').drawImage(bitmap,0,0);
    const actual=actualCanvas.getContext('2d').getImageData(0,0,image.width,image.height).data;
    let difference=0, ink=0;
    for(let i=0;i<actual.length;i+=4){if(Math.abs(actual[i]-expected[i])>3)difference++;if(actual[i]<100)ink++;}
    return {bbox, textItems:(await page.getTextContent()).items.length, identical:rasters.every(r=>r.dataUrl===image.dataUrl),
      unchanged:rasters.every(r=>r.displayUnchanged), width:image.width,height:image.height,imageBbox:crop,differenceRatio:difference/(image.width*image.height),ink};
  } finally { await pdf.destroy(); }
};
`;
beforeAll(async () => {
  const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent' });
  server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return; }
    if (request.url === '/worker.mjs') { response.setHeader('Content-Type', 'text/javascript'); void readFile(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')).then(data => response.end(data)); return; }
    response.end('<!doctype html><script type="module" src="/bundle.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  url = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); });
describe('real scanned PDF source pixels', () => {
  it.each([0, 90])('preserves fraction bars and superscripts at every viewer zoom with page rotation %s', async rotation => {
    const png = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400"><rect width="1200" height="400" fill="white"/><path d="M40 200h300M400 250l30 40 60-210h500" stroke="black" stroke-width="4" fill="none"/><text x="160" y="150" font-size="80">a</text><text x="160" y="310" font-size="80">b</text><text x="550" y="230" font-size="80">x</text><text x="615" y="165" font-size="42">2</text><path d="M1100 80v230" stroke="black" stroke-width="3"/></svg>')).png().toBuffer();
    const pdf = await PDFDocument.create(); const image = await pdf.embedPng(png);
    const sheet = pdf.addPage([600,800]); sheet.drawImage(image,{x:120,y:300,width:240,height:80});sheet.setRotation(degrees(rotation));
    const context = await browser.newContext({ deviceScaleFactor: rotation ? 2 : 1 });
    const requests: string[] = [];
    await context.route('**/*', route => { const target=route.request().url(); if(target.startsWith(url)||target.startsWith('data:')||target.startsWith('blob:'))return route.continue();requests.push(target);return route.abort(); });
    const page = await context.newPage();
    try {
      await page.goto(url);await page.waitForFunction(()=>typeof (window as unknown as {capture?:unknown}).capture==='function');
      const result = await page.evaluate(bytes => (window as unknown as {capture:(bytes:number[])=>Promise<{textItems:number;identical:boolean;unchanged:boolean;width:number;height:number;differenceRatio:number;ink:number}>}).capture(bytes),Array.from(await pdf.save()));
      expect(result.textItems).toBe(0);
      expect(result.identical).toBe(true);
      expect(result.unchanged).toBe(true);
      expect(Math.max(result.width,result.height)).toBeGreaterThanOrEqual(750);
      expect(result.differenceRatio).toBeLessThan(.001);
      expect(result.ink).toBeGreaterThan(1000);
      expect(requests).toEqual([]);
    } finally { await context.close(); }
  });
});
