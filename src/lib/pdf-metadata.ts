import type { PDFDocumentProxy } from "pdfjs-dist";

export interface PdfBibliographicSummary {
  title: string | null;
  authors: string[];
  year: string | null;
  doi: string | null;
  arxivId: string | null;
  subject: string | null;
  keywords: string[];
  creator: string | null;
  producer: string | null;
  pageCount: number | null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function splitPeople(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/;|,|\band\b/gi)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitKeywords(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[;,|]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractYear(...values: Array<string | null>): string | null {
  for (const value of values) {
    if (!value) {
      continue;
    }
    const match = value.match(/(?:\b|D:)((?:19|20)\d{2})/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function extractDoi(...values: Array<string | null>): string | null {
  for (const value of values) {
    if (!value) {
      continue;
    }
    const match = value.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
    if (match) {
      return match[0];
    }
  }
  return null;
}

function extractArxivId(...values: Array<string | null>): string | null {
  for (const value of values) {
    if (!value) {
      continue;
    }
    const match = value.match(/\b(?:arXiv:\s*)?(\d{4}\.\d{4,5})(?:v\d+)?\b/i);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function fallbackTitleFromFileName(fileName: string): string | null {
  const base = fileName.replace(/\.pdf$/i, "").trim();
  return base.length > 0 ? base : null;
}

export async function extractPdfBibliographicSummary(input: {
  pdfDocument: PDFDocumentProxy;
  fileName: string;
}): Promise<PdfBibliographicSummary> {
  const metadata = await input.pdfDocument.getMetadata().catch(() => null);
  const info = (metadata?.info ?? {}) as Record<string, unknown>;
  const metadataText = asTrimmedString(metadata?.metadata?.get?.("dc:title")) ?? null;

  const title =
    asTrimmedString(info.Title) ??
    metadataText ??
    fallbackTitleFromFileName(input.fileName);
  const authorRaw =
    asTrimmedString(info.Author) ??
    asTrimmedString(metadata?.metadata?.get?.("dc:creator")) ??
    null;
  const subject = asTrimmedString(info.Subject);
  const keywordsRaw = asTrimmedString(info.Keywords);
  const creator = asTrimmedString(info.Creator);
  const producer = asTrimmedString(info.Producer);
  const creationDate = asTrimmedString(info.CreationDate);
  const modDate = asTrimmedString(info.ModDate);

  return {
    title,
    authors: splitPeople(authorRaw),
    year: extractYear(creationDate, modDate, title, subject, keywordsRaw),
    doi: extractDoi(title, subject, keywordsRaw, creator, producer),
    arxivId: extractArxivId(title, subject, keywordsRaw),
    subject,
    keywords: splitKeywords(keywordsRaw),
    creator,
    producer,
    pageCount: input.pdfDocument.numPages ?? null,
  };
}
