/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const pdfMocks = vi.hoisted(() => ({
  loadPdfJsDocument: vi.fn(),
  getPdfPageSearchText: vi.fn(),
}));

vi.mock("@/lib/pdf-js-document-loader", () => ({
  loadPdfJsDocument: pdfMocks.loadPdfJsDocument,
}));
vi.mock("@/lib/pdf-page-text-cache", () => ({
  getPdfPageSearchText: pdfMocks.getPdfPageSearchText,
}));

import { openAgentDocumentSource } from "../document-source";

describe("agent document source", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("reads markdown sections losslessly without a character cap", async () => {
    const content = "# Intro\n\nalpha\n\n## Methods\n\n" + "x".repeat(71_000) + "\n\n## Tail\nend";
    const source = await openAgentDocumentSource(new File([content], "paper.md", { type: "text/markdown", lastModified: 7 }), "notes/paper.md");
    const units = await Promise.all(Array.from({ length: source.totalUnits }, (_, index) => source.readUnit(index + 1)));

    expect(source.totalUnits).toBeGreaterThan(2);
    expect(units.every((unit) => unit.status === "text")).toBe(true);
    expect(units.map((unit) => unit.text).join("")).toBe(content);
    expect(source.version).toContain("notes/paper.md|" + new TextEncoder().encode(content).byteLength);
    await source.close();
    expect((await source.readUnit(1)).reason).toBe("source_closed");
  });

  it("distinguishes empty, cancelled, and out-of-range units", async () => {
    const source = await openAgentDocumentSource(new File([""], "empty.md", { type: "text/markdown" }), "empty.md");
    expect((await source.readUnit(1)).status).toBe("empty");
    expect((await source.readUnit(2)).reason).toBe("unit_out_of_range");
    const controller = new AbortController();
    controller.abort();
    expect((await source.readUnit(1, controller.signal)).reason).toBe("aborted");
  });

  it("loads PDF pages lazily, supports every page, bounds its cache, and destroys once", async () => {
    const destroy = vi.fn(async () => undefined);
    pdfMocks.loadPdfJsDocument.mockResolvedValue({ numPages: 40, destroy });
    pdfMocks.getPdfPageSearchText.mockImplementation(async (_document: unknown, page: number) => `page ${page}`);
    const source = await openAgentDocumentSource(new File(["%PDF"], "paper.pdf", { type: "application/pdf" }), "papers/paper.pdf");

    expect(source.totalUnits).toBe(40);
    expect((await source.readUnit(40)).text).toBe("page 40");
    for (let page = 1; page <= 24; page += 1) {
      expect((await source.readUnit(page)).text).toBe(`page ${page}`);
    }
    expect(pdfMocks.getPdfPageSearchText).toHaveBeenCalledWith(expect.anything(), 40);
    expect(pdfMocks.getPdfPageSearchText).toHaveBeenCalledWith(expect.anything(), 1);
    expect((await source.readUnit(40)).text).toBe("page 40");
    expect((await source.readUnit(1)).text).toBe("page 1");
    expect(pdfMocks.getPdfPageSearchText).toHaveBeenCalledTimes(27);

    await Promise.all([source.close(), source.close()]);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("does not turn a filename or unsupported file into an authorized source", async () => {
    await expect(openAgentDocumentSource(new File(["x"], "image.png"), "image.png")).rejects.toThrow("Unsupported");
    await expect(openAgentDocumentSource(new File(["x"], "note.md"), "")).rejects.toThrow("workspace-relative");
  });

  it("keeps resume versions distinct when metadata is identical but content changes", async () => {
    const first = await openAgentDocumentSource(new File(["alpha"], "note.md", { lastModified: 0 }), "note.md");
    const second = await openAgentDocumentSource(new File(["bravo"], "note.md", { lastModified: 0 }), "note.md");
    expect(first.version).not.toBe(second.version);
  });
  it("keeps the same content version when a desktop File wrapper gets a new timestamp", async () => {
    const a = await openAgentDocumentSource(new File(["same document"], "note.md", { lastModified: 1 }), "note.md");
    const b = await openAgentDocumentSource(new File(["same document"], "note.md", { lastModified: 999 }), "note.md");
    expect(a.version).toBe(b.version);
  });
  it("rejects parent traversal in the evidence identity", async () => {
    await expect(openAgentDocumentSource(new File(["data"], "note.md"), "../note.md")).rejects.toThrow(/path|路径/);
  });
  it('reads text and code with line locators through the shared text extractor', async () => {
    for (const path of ['notes.txt', 'scripts/run.py']) {
      const source = await openAgentDocumentSource(new File(['first\nsecond\nlast'], path), path);
      const unit = await source.readUnit(1);
      expect(unit.text).toBe('first\nsecond\nlast');
      expect(unit.locator).toBe(`${path}#line=1`);
    }
  });
  it('reads Notebook cells after the discovery preview without exposing notebook JSON as text', async () => {
    const cells = Array.from({ length: 25 }, (_, i) => ({ id: `stable-${i}`, cell_type: 'code', source: [`value_${i} = ${i}\n`] }));
    const source = await openAgentDocumentSource(new File([JSON.stringify({ cells, nbformat: 4 })], 'analysis.ipynb'), 'analysis.ipynb');
    expect(source.totalUnits).toBe(25);
    expect(await source.readUnit(25)).toMatchObject({ text: 'value_24 = 24\n', locator: 'analysis.ipynb#cell=stable-24' });
  });
});
