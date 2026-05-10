import { describe, expect, it } from "vitest";
import { extractPdfBibliographicSummary } from "../pdf-metadata";

describe("pdf metadata summary", () => {
  it("extracts core bibliographic fields from pdf metadata", async () => {
    const pdfDocument = {
      numPages: 12,
      getMetadata: async () => ({
        info: {
          Title: "Quantum Rydberg States",
          Author: "Alice Smith; Bob Jones",
          Subject: "Quantum optics DOI 10.1103/PhysRev.47.777",
          Keywords: "rydberg; arXiv:2401.01234; neutral atoms",
          Creator: "LaTeX",
          Producer: "pdfTeX",
          CreationDate: "D:20240101120000",
        },
        metadata: {
          get: () => null,
        },
      }),
    } as any;

    const summary = await extractPdfBibliographicSummary({
      pdfDocument,
      fileName: "rydberg-paper.pdf",
    });

    expect(summary.title).toBe("Quantum Rydberg States");
    expect(summary.authors).toEqual(["Alice Smith", "Bob Jones"]);
    expect(summary.year).toBe("2024");
    expect(summary.doi).toBe("10.1103/PhysRev.47.777");
    expect(summary.arxivId).toBe("2401.01234");
    expect(summary.pageCount).toBe(12);
  });

  it("falls back to the file name when metadata is absent", async () => {
    const pdfDocument = {
      numPages: 3,
      getMetadata: async () => ({
        info: {},
        metadata: {
          get: () => null,
        },
      }),
    } as any;

    const summary = await extractPdfBibliographicSummary({
      pdfDocument,
      fileName: "paper-title.pdf",
    });

    expect(summary.title).toBe("paper-title");
    expect(summary.pageCount).toBe(3);
  });
});
