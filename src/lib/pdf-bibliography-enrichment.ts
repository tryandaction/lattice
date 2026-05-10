import type { PdfBibliographicSummary } from "@/lib/pdf-metadata";

export interface PdfBibliographicEnrichment {
  title?: string | null;
  authors?: string[];
  year?: string | null;
  doi?: string | null;
  arxivId?: string | null;
  subject?: string | null;
  keywords?: string[];
  venue?: string | null;
  publisher?: string | null;
  abstract?: string | null;
  source: "crossref" | "arxiv";
}

function parseCrossrefAuthors(authorList: Array<Record<string, unknown>> | undefined): string[] {
  if (!Array.isArray(authorList)) {
    return [];
  }

  return authorList
    .map((author) => {
      const given = typeof author.given === "string" ? author.given.trim() : "";
      const family = typeof author.family === "string" ? author.family.trim() : "";
      return `${given} ${family}`.trim();
    })
    .filter(Boolean);
}

function stripJatsMarkup(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
}

export async function enrichPdfBibliographyFromDoi(doi: string): Promise<PdfBibliographicEnrichment | null> {
  const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    return null;
  }

  const payload = await response.json() as { message?: Record<string, unknown> };
  const message = payload.message ?? {};
  const titleList = Array.isArray(message.title) ? message.title as string[] : [];
  const published = (message["published-print"] ?? message["published-online"] ?? message.created) as Record<string, unknown> | undefined;
  const dateParts = Array.isArray(published?.["date-parts"]) ? published?.["date-parts"] as Array<Array<number>> : [];
  const year = dateParts[0]?.[0] ? String(dateParts[0][0]) : null;
  const containerTitle = Array.isArray(message["container-title"]) ? (message["container-title"] as string[])[0] : null;
  const subjectList = Array.isArray(message.subject) ? message.subject as string[] : [];

  return {
    title: titleList[0] ?? null,
    authors: parseCrossrefAuthors(message.author as Array<Record<string, unknown>> | undefined),
    year,
    doi,
    subject: subjectList[0] ?? null,
    keywords: subjectList,
    venue: typeof containerTitle === "string" ? containerTitle : null,
    publisher: typeof message.publisher === "string" ? message.publisher : null,
    abstract: stripJatsMarkup(typeof message.abstract === "string" ? message.abstract : null),
    source: "crossref",
  };
}

export async function enrichPdfBibliographyFromArxiv(arxivId: string): Promise<PdfBibliographicEnrichment | null> {
  const response = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`);
  if (!response.ok) {
    return null;
  }

  const xml = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const entry = doc.querySelector("entry");
  if (!entry) {
    return null;
  }

  const title = entry.querySelector("title")?.textContent?.replace(/\s+/g, " ").trim() ?? null;
  const authors = Array.from(entry.querySelectorAll("author > name"))
    .map((node) => node.textContent?.trim() ?? "")
    .filter(Boolean);
  const published = entry.querySelector("published")?.textContent?.trim() ?? null;
  const summary = entry.querySelector("summary")?.textContent?.replace(/\s+/g, " ").trim() ?? null;
  const categories = Array.from(entry.querySelectorAll("category"))
    .map((node) => node.getAttribute("term") ?? "")
    .filter(Boolean);

  return {
    title,
    authors,
    year: published ? published.slice(0, 4) : null,
    arxivId,
    subject: categories[0] ?? null,
    keywords: categories,
    abstract: summary,
    source: "arxiv",
  };
}

export async function enrichPdfBibliography(summary: PdfBibliographicSummary): Promise<PdfBibliographicEnrichment | null> {
  if (summary.doi) {
    return enrichPdfBibliographyFromDoi(summary.doi);
  }
  if (summary.arxivId) {
    return enrichPdfBibliographyFromArxiv(summary.arxivId);
  }
  return null;
}

export function buildSimpleCitation(input: {
  summary: PdfBibliographicSummary;
  enrichment?: PdfBibliographicEnrichment | null;
}): string {
  const title = input.enrichment?.title ?? input.summary.title ?? "Untitled";
  const authors = input.enrichment?.authors ?? input.summary.authors;
  const year = input.enrichment?.year ?? input.summary.year ?? "n.d.";
  const venue = input.enrichment?.venue ?? input.enrichment?.publisher ?? "";
  const authorText = authors.length > 0 ? authors.join(", ") : "Unknown author";
  return [authorText, `(${year})`, title, venue].filter(Boolean).join(". ");
}

export function buildSimpleBibtex(input: {
  fileName: string;
  summary: PdfBibliographicSummary;
  enrichment?: PdfBibliographicEnrichment | null;
}): string {
  const title = input.enrichment?.title ?? input.summary.title ?? input.fileName.replace(/\.pdf$/i, "");
  const authors = input.enrichment?.authors ?? input.summary.authors;
  const year = input.enrichment?.year ?? input.summary.year ?? "";
  const doi = input.enrichment?.doi ?? input.summary.doi ?? "";
  const arxivId = input.enrichment?.arxivId ?? input.summary.arxivId ?? "";
  const venue = input.enrichment?.venue ?? "";
  const publisher = input.enrichment?.publisher ?? "";
  const keyBase = (authors[0] ?? "unknown").split(/\s+/).pop()?.toLowerCase() ?? "unknown";
  const key = `${keyBase}${year || "nd"}`;

  const lines = [
    `@article{${key},`,
    `  title = {${title}},`,
    authors.length > 0 ? `  author = {${authors.join(" and ")}},` : null,
    year ? `  year = {${year}},` : null,
    venue ? `  journal = {${venue}},` : null,
    publisher ? `  publisher = {${publisher}},` : null,
    doi ? `  doi = {${doi}},` : null,
    arxivId ? `  eprint = {${arxivId}},` : null,
    `}`,
  ].filter(Boolean);

  return lines.join("\n");
}
