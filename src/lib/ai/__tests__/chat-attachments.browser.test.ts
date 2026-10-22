// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright';

// This exercises native browser File, Blob, FileReader and IndexedDB, not a memory mock.
const require = createRequire(import.meta.url);
let browser: Browser;
let server: Server;
let url: string;
let page: Page;

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';

function pdfFixture(): string {
  const stream = 'BT /F1 12 Tf 72 720 Td (Read actual PDF) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => { const offset = pdf.length; pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; return offset; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: `import * as attachments from './src/lib/ai/chat-attachments';
      import { useAiAttachmentStore } from './src/stores/ai-attachment-store';
      import { ChatAttachments, useChatAttachmentInput } from './src/components/ai/chat-attachments';
      import { createRoot } from 'react-dom/client';
      import React from 'react';
      window.attachments = attachments; window.attachmentStore = useAiAttachmentStore;
      function Fixture() { const handlers = useChatAttachmentInput('ui-conversation');
        return React.createElement('main', { ...handlers, id: 'composer' }, React.createElement('textarea', { placeholder: 'Message' }), React.createElement(ChatAttachments, { conversationId: 'ui-conversation' })); }
      window.mount = () => createRoot(document.getElementById('root')).render(React.createElement(Fixture));
      window.ready = true;`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': JSON.stringify('test') }, logLevel: 'silent',
  });
  server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return; }
    if (request.url === '/pdfjs-dist/build/pdf.worker.min.mjs') {
      response.setHeader('Content-Type', 'text/javascript');
      void readFile(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')).then(bytes => response.end(bytes));
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Attachment validation</title><div id="root"></div><script type="module" src="/bundle.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Attachment test server failed.');
  url = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.goto(url);
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>(resolve => server?.close(() => resolve()));
});

type BrowserApi = { attachments: typeof import('../chat-attachments'); attachmentStore: typeof import('@/stores/ai-attachment-store').useAiAttachmentStore; mount(): void };

describe('durable conversation chat attachments', () => {
  it('restores exact binary file contents after reload and rejects another conversation', async () => {
    const id = await page.evaluate(async () => {
      const api = window as unknown as BrowserApi;
      const [ref] = await api.attachments.addChatAttachments('durable', [new File(['alpha\nbeta'], 'notes.txt', { lastModified: 8 })]);
      await api.attachments.markChatAttachmentsSent('durable', [ref.id]);
      return ref.id;
    });
    await page.reload();
    await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);
    const result = await page.evaluate(async (id) => {
      const api = window as unknown as BrowserApi;
      const [record] = await api.attachments.getChatAttachmentFiles('durable', [id]);
      let denied = false;
      try { await api.attachments.getChatAttachmentFiles('another-conversation', [id]); } catch { denied = true; }
      let retained = false;
      try { await api.attachments.removeChatAttachment('durable', id); } catch { retained = true; }
      return { content: await record.file.text(), ref: record.attachment, denied, retained, listed: await api.attachments.listChatAttachments('durable') };
    }, id);
    expect(result.content).toBe('alpha\nbeta');
    expect(result.ref).toMatchObject({ id, status: 'sent', kind: 'document', lastModified: 8 });
    expect(result.denied).toBe(true);
    expect(result.retained).toBe(true);
    expect(result.listed).toHaveLength(1);
  });

  it('extracts real notebook/code/HTML units and preserves image bytes without pretending to OCR', async () => {
    const result = await page.evaluate(async (png) => {
      const api = window as unknown as BrowserApi;
      const refs = await api.attachments.addChatAttachments('capture', [
        new File(['print("attachment")\n'], 'demo.py'),
        new File([JSON.stringify({ nbformat: 4, cells: [{ id: 'cell-a', cell_type: 'code', source: ['x = 3\n'] }] })], 'experiment.ipynb'),
        new File(['<script>window.pwned = true</script><h1>Safe heading</h1>'], 'page.html', { type: 'text/html' }),
        new File([Uint8Array.from(atob(png), char => char.charCodeAt(0))], 'pixel.png', { type: 'image/png' }),
      ]);
      const capture = await api.attachments.captureChatAttachments({ conversationId: 'capture', attachmentIds: refs.map(ref => ref.id) });
      const units = await Promise.all(capture.sources.map(source => source.readUnit(1)));
      const images = capture.imageParts;
      const paths = capture.sources.map(source => source.path);
      await capture.close();
      return { units, paths, images, pwned: 'pwned' in window };
    }, PNG);
    expect(result.units[0]).toMatchObject({ status: 'text', text: 'print("attachment")\n' });
    expect(result.units[1]).toMatchObject({ status: 'text', text: 'x = 3\n', locator: expect.stringContaining('#cell=cell-a') });
    expect(result.units[2].text).toContain('Safe heading');
    expect(result.units[2].text).not.toContain('window.pwned');
    expect(result.images).toEqual([{ type: 'image', mimeType: 'image/png', data: PNG }]);
    expect(result.paths.every(path => path.startsWith('attachments/'))).toBe(true);
    expect(result.pwned).toBe(false);
  });

  it('marks forged images, unknown binary, invalid notebook and damaged PDF unreadable', async () => {
    const result = await page.evaluate(async () => {
      const api = window as unknown as BrowserApi;
      const refs = await api.attachments.addChatAttachments('invalid', [
        new File(['<svg onload="alert(1)"/>'], 'fake.png', { type: 'image/png' }),
        new File([Uint8Array.from([0, 255, 1, 6])], 'unknown.bin'),
        new File(['broken notebook'], 'invalid.ipynb'),
        new File(['%PDF-1.7\ncorrupted content that must never become a text source'], 'broken.pdf', { type: 'application/pdf' }),
        new File(['binary disguised as a text file\0'], 'spoof.py'),
      ]);
      const capture = await api.attachments.captureChatAttachments({ conversationId: 'invalid', attachmentIds: refs.map(ref => ref.id) });
      const units = await Promise.all(capture.sources.map(source => source.readUnit(1)));
      const unreadable = capture.unreadable;
      await capture.close();
      return { units, unreadable, images: capture.imageParts };
    });
    expect(result.unreadable).toHaveLength(5);
    expect(result.units.every(unit => unit.status === 'unreadable' && unit.text === '')).toBe(true);
    expect(result.images).toEqual([]);
  });

  it('reads real DOCX and PDF files through the existing document source runtime', async () => {
    const JSZip = require('jszip');
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Read actual DOCX</w:t></w:r></w:p></w:body></w:document>');
    const docx = await zip.generateAsync({ type: 'base64' });
    const result = await page.evaluate(async ({ docx, pdf }) => {
      const api = window as unknown as BrowserApi;
      const refs = await api.attachments.addChatAttachments('actual-documents', [
        new File([Uint8Array.from(atob(docx), char => char.charCodeAt(0))], 'actual.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
        new File([pdf], 'actual.pdf', { type: 'application/pdf' }),
        new File(['custom extension text'], 'note.custom', { type: 'text/plain' }),
      ]);
      const capture = await api.attachments.captureChatAttachments({ conversationId: 'actual-documents', attachmentIds: refs.map(ref => ref.id) });
      const units = await Promise.all(capture.sources.map(source => source.readUnit(1)));
      const accessed = await api.attachments.getChatAttachmentFileForPath('actual-documents', capture.sources[0].path);
      await capture.close();
      return { units, unreadable: capture.unreadable, name: accessed.name };
    }, { docx, pdf: pdfFixture() });
    expect(result.unreadable).toEqual([]);
    expect(result.units[0]).toMatchObject({ status: 'text', text: expect.stringContaining('Read actual DOCX') });
    expect(result.units[1]).toMatchObject({ status: 'text', text: expect.stringContaining('Read actual PDF'), locator: expect.stringContaining('#page=1') });
    expect(result.units[2]).toMatchObject({ status: 'text', text: 'custom extension text' });
    expect(result.units[2].locator).toMatch(/note.custom#line=1$/);
    expect(result.name).toBe('actual.docx');
  });

  it('rejects subsequent reads when a captured attachment conversation scope changes', async () => {
    const result = await page.evaluate(async () => {
      const api = window as unknown as BrowserApi;
      const refs = await api.attachments.addChatAttachments('read-scope', [new File(['source text'], 'source.txt')]);
      let current = true;
      const capture = await api.attachments.captureChatAttachments({ conversationId: 'read-scope', attachmentIds: refs.map(ref => ref.id), isCurrent: () => current });
      current = false;
      let denied = false;
      try { await capture.sources[0].readUnit(1); } catch { denied = true; }
      await capture.close();
      return denied;
    });
    expect(result).toBe(true);
  });

  it('uses native FileReader when modern Blob methods are unavailable and aborts scoped reads', async () => {
    const result = await page.evaluate(async () => {
      const api = window as unknown as BrowserApi;
      const blob = new Blob(['legacy-file-reader']);
      Object.defineProperty(blob, 'arrayBuffer', { value: undefined });
      const bytes = await api.attachments.browserFileReader(blob);
      const controller = new AbortController();
      controller.abort();
      let aborted = false;
      try { await api.attachments.browserFileReader(blob, controller.signal); } catch (error) { aborted = (error as DOMException).name === 'AbortError'; }
      let current = true;
      const file = new File(['scope text'], 'scope.txt');
      const read = file.arrayBuffer.bind(file);
      Object.defineProperty(file, 'arrayBuffer', { value: async () => { const result = await read(); current = false; return result; } });
      let changed = false;
      try { await api.attachments.addChatAttachments('cancelled', [file], { isCurrent: () => current }); } catch { changed = true; }
      return { text: new TextDecoder().decode(bytes), aborted, changed, saved: await api.attachments.listChatAttachments('cancelled') };
    });
    expect(result).toEqual({ text: 'legacy-file-reader', aborted: true, changed: true, saved: [] });
  });

  it('enforces count, file/image size and aggregate budgets atomically', async () => {
    const result = await page.evaluate(async () => {
      const api = window as unknown as BrowserApi;
      const messages: string[] = [];
      const attempt = async (id: string, files: File[]) => { try { await api.attachments.addChatAttachments(id, files); } catch (error) { messages.push((error as Error).message); } };
      await attempt('too-many', Array.from({ length: 11 }, (_, index) => new File(['x'], `${index}.txt`)));
      await attempt('too-big', [new File([new Uint8Array(32 * 1024 * 1024 + 1)], 'large.bin')]);
      await attempt('image-big', [new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })]);
      await attempt('total-big', Array.from({ length: 3 }, (_, index) => new File([new Uint8Array(24 * 1024 * 1024)], `${index}.bin`)));
      await api.attachments.addChatAttachments('count-budget', Array.from({ length: 9 }, (_, index) => new File(['x'], `${index}.txt`)));
      await attempt('count-budget', [new File(['x'], 'one.txt'), new File(['x'], 'two.txt')]);
      return { messages, pending: await api.attachments.listChatAttachments('count-budget'), total: await api.attachments.listChatAttachments('total-big') };
    });
    expect(result.messages).toHaveLength(5);
    expect(result.messages.join(' ')).toMatch(/10.*32.*10.*64.*10/);
    expect(result.pending).toHaveLength(9);
    expect(result.total).toEqual([]);
  });

  it('publishes both concurrent uploads after a slow File read without an obsolete hydration snapshot', async () => {
    const refs = await page.evaluate(async () => {
      const api = window as unknown as BrowserApi;
      const file = new File(['slow'], 'slow.txt');
      const read = file.arrayBuffer.bind(file);
      Object.defineProperty(file, 'arrayBuffer', { value: async () => { await new Promise(resolve => setTimeout(resolve, 30)); return read(); } });
      await Promise.all([api.attachmentStore.getState().addFiles('concurrent', [file]), api.attachmentStore.getState().addFiles('concurrent', [new File(['fast'], 'fast.txt')])]);
      return api.attachmentStore.getState().attachmentsByConversation.concurrent;
    });
    expect(refs.map(ref => ref.name).sort()).toEqual(['fast.txt', 'slow.txt']);
    expect(refs.every(ref => !('blob' in ref) && !('data' in ref))).toBe(true);
  });

  it('uploads and removes chips, accepts drop/paste files, and preserves plain-text paste', async () => {
    await page.evaluate(() => (window as unknown as BrowserApi).mount());
    await page.locator('input[type=file]').setInputFiles({ name: 'uploaded.txt', mimeType: 'text/plain', buffer: Buffer.from('upload body') });
    await page.getByRole('button', { name: '移除附件 uploaded.txt', exact: true }).waitFor();
    await page.getByRole('button', { name: '移除附件 uploaded.txt', exact: true }).click();
    await page.getByRole('button', { name: '移除附件 uploaded.txt', exact: true }).waitFor({ state: 'detached' });
    const prevented = await page.evaluate(() => {
      const composer = document.getElementById('composer')!;
      const drop = new DataTransfer();
      drop.items.add(new File(['drop body'], 'dropped.py'));
      composer.dispatchEvent(new DragEvent('drop', { dataTransfer: drop, bubbles: true, cancelable: true }));
      const pasted = new DataTransfer();
      pasted.items.add(new File(['paste body'], 'pasted.txt'));
      composer.dispatchEvent(new ClipboardEvent('paste', { clipboardData: pasted, bubbles: true, cancelable: true }));
      const plain = new DataTransfer(); plain.setData('text/plain', 'normal message');
      const textEvent = new ClipboardEvent('paste', { clipboardData: plain, bubbles: true, cancelable: true });
      composer.dispatchEvent(textEvent);
      return textEvent.defaultPrevented;
    });
    await page.getByRole('button', { name: '移除附件 dropped.py', exact: true }).waitFor();
    await page.getByRole('button', { name: '移除附件 pasted.txt', exact: true }).waitFor();
    expect(prevented).toBe(false);
    expect(await page.getByRole('button', { name: '上传文件或图片', exact: true }).count()).toBe(1);
  });
});
