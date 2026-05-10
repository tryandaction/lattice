import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSimpleBibtex,
  buildSimpleCitation,
  enrichPdfBibliography,
  enrichPdfBibliographyFromArxiv,
  enrichPdfBibliographyFromDoi,
} from "../pdf-bibliography-enrichment";

describe("pdf bibliography enrichment", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("enriches metadata from Crossref", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        message: {
          title: ["Quantum Optics"],
          author: [{ given: "Alice", family: "Smith" }],
          subject: ["Physics"],
          publisher: "APS",
          abstract: "<jats:p>Abstract text</jats:p>",
          "container-title": ["Physical Review"],
          created: { "date-parts": [[2024, 1, 2]] },
        },
      }),
    })) as any);

    const result = await enrichPdfBibliographyFromDoi("10.1103/PhysRev.47.777");
    expect(result?.title).toBe("Quantum Optics");
    expect(result?.authors).toEqual(["Alice Smith"]);
    expect(result?.year).toBe("2024");
    expect(result?.venue).toBe("Physical Review");
    expect(result?.abstract).toBe("Abstract text");
  });

  it("enriches metadata from arXiv", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      text: async () => `<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <title>Rydberg Atoms</title>
            <published>2024-01-02T00:00:00Z</published>
            <summary>  Abstract content here. </summary>
            <author><name>Alice Smith</name></author>
            <category term="quant-ph" />
          </entry>
        </feed>`,
    })) as any);

    const result = await enrichPdfBibliographyFromArxiv("2401.01234");
    expect(result?.title).toBe("Rydberg Atoms");
    expect(result?.authors).toEqual(["Alice Smith"]);
    expect(result?.year).toBe("2024");
    expect(result?.subject).toBe("quant-ph");
  });

  it("prefers DOI enrichment when available", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes("crossref")) {
        return {
          ok: true,
          json: async () => ({
            message: {
              title: ["DOI title"],
            },
          }),
        };
      }

      return {
        ok: true,
        text: async () => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>arXiv title</title></entry></feed>`,
      };
    });
    vi.stubGlobal("fetch", fetchMock as any);

    const result = await enrichPdfBibliography({
      title: null,
      authors: [],
      year: null,
      doi: "10.1/test",
      arxivId: "2401.01234",
      subject: null,
      keywords: [],
      creator: null,
      producer: null,
      pageCount: null,
    });

    expect(result?.title).toBe("DOI title");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("crossref");
  });

  it("builds a simple citation and BibTeX payload", () => {
    const summary = {
      title: "Quantum Optics",
      authors: ["Alice Smith", "Bob Jones"],
      year: "2024",
      doi: "10.1/test",
      arxivId: null,
      subject: "Physics",
      keywords: [],
      creator: null,
      producer: null,
      pageCount: 12,
    };

    const enrichment = {
      source: "crossref" as const,
      venue: "Physical Review",
      title: "Quantum Optics",
      authors: ["Alice Smith", "Bob Jones"],
      year: "2024",
    };

    expect(buildSimpleCitation({ summary, enrichment })).toContain("Physical Review");
    expect(buildSimpleBibtex({ fileName: "paper.pdf", summary, enrichment })).toContain("@article");
    expect(buildSimpleBibtex({ fileName: "paper.pdf", summary, enrichment })).toContain("doi = {10.1/test}");
  });
});
