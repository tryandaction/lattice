export type PdfExternalLinkOpenMode = "internal" | "browser";

export type PdfLinkTarget =
  | { type: "external"; url: string }
  | { type: "page"; page: number }
  | { type: "annotation"; annotationId: string }
  | { type: "namedDestination"; destination: string }
  | { type: "explicitDestination"; destination: unknown[] }
  | { type: "namedAction"; action: string };

const PDF_LINK_SELECTOR = ".annotationLayer a, .annotationLayer [role='link'], .linkAnnotation";
const PDF_TEXT_LINK_ZERO_WIDTH_CHARACTER = /[\u200B-\u200D\uFEFF]/u;
const PDF_TEXT_LINK_TRAILING_PUNCTUATION = /[.,;:!?，。；：！？]+$/u;

export type PdfTextLinkMatch = {
  target: PdfLinkTarget;
  rawText: string;
  start: number;
  end: number;
};

export function getPdfLinkElementFromTarget(target: EventTarget | null | undefined): HTMLElement | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }
  return target.closest<HTMLElement>(PDF_LINK_SELECTOR);
}

export function isPdfLinkAnnotationTarget(target: EventTarget | null | undefined): target is HTMLElement {
  return getPdfLinkElementFromTarget(target) !== null;
}

function readLinkCandidate(element: HTMLElement): string {
  const anchor = element.closest<HTMLAnchorElement>("a[href]");
  return (
    element.dataset.pdfLinkTarget ??
    anchor?.dataset.pdfLinkTarget ??
    anchor?.getAttribute("href") ??
    element.dataset.pdfDest ??
    element.dataset.dest ??
    element.dataset.pdfAction ??
    element.getAttribute("data-dest") ??
    element.getAttribute("data-pdf-dest") ??
    element.getAttribute("data-pdf-action") ??
    element.getAttribute("href") ??
    ""
  ).trim();
}

export function normalizePdfExternalUrl(rawTarget: string): string | null {
  const trimmed = rawTarget.trim();
  if (!trimmed) return null;

  if (/^doi:/i.test(trimmed)) {
    const doi = trimmed.replace(/^doi:/i, "").trim();
    return doi ? `https://doi.org/${doi}` : null;
  }

  if (/^(https?:|mailto:)/i.test(trimmed)) {
    return trimmed;
  }

  if (/^www\./i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return null;
}

function trimPdfTextLinkCandidate(rawText: string): string {
  let candidate = rawText.trim();
  while (PDF_TEXT_LINK_TRAILING_PUNCTUATION.test(candidate)) {
    candidate = candidate.replace(PDF_TEXT_LINK_TRAILING_PUNCTUATION, "");
  }

  const pairs: Array<[string, string]> = [["(", ")"], ["[", "]"], ["{", "}"]];
  for (const [open, close] of pairs) {
    while (candidate.endsWith(close)) {
      const opens = candidate.split(open).length - 1;
      const closes = candidate.split(close).length - 1;
      if (closes <= opens) break;
      candidate = candidate.slice(0, -1).trimEnd();
    }
  }

  return candidate;
}

function makePdfTextExternalMatch(rawText: string, start: number): PdfTextLinkMatch | null {
  const candidate = trimPdfTextLinkCandidate(rawText);
  if (!candidate) return null;

  if (/^(?:https?:\/\/|www\.)/i.test(candidate)) {
    const url = normalizePdfExternalUrl(candidate);
    return url ? { target: { type: "external", url }, rawText: candidate, start, end: start + candidate.length } : null;
  }

  const doiMatch = candidate.match(/^(?:doi\s*:\s*)?(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)$/i);
  if (doiMatch?.[1]) {
    return {
      target: { type: "external", url: `https://doi.org/${doiMatch[1]}` },
      rawText: candidate,
      start,
      end: start + candidate.length,
    };
  }

  const arxivMatch = candidate.match(/^(?:arxiv\s*:\s*)?((?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7})(?:v\d+)?)$/i);
  if (arxivMatch?.[1]) {
    return {
      target: { type: "external", url: `https://arxiv.org/abs/${arxivMatch[1]}` },
      rawText: candidate,
      start,
      end: start + candidate.length,
    };
  }

  return null;
}

export function findPdfTextLinkMatches(text: string): PdfTextLinkMatch[] {
  const matches: PdfTextLinkMatch[] = [];
  const seen = new Set<string>();
  let comparableText = "";
  const comparableToRawOffsets: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (PDF_TEXT_LINK_ZERO_WIDTH_CHARACTER.test(character)) {
      continue;
    }
    comparableText += character;
    comparableToRawOffsets.push(index);
  }
  const patterns = [
    /(?:https?:\/\/|www\.)[^\s<>"'“”]+/giu,
    /(?:doi\s*:\s*)?10\.\d{4,9}\/[-._;()/:A-Z0-9]+/giu,
    /(?:arxiv\s*:\s*)?(?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7})(?:v\d+)?/giu,
  ];

  for (const pattern of patterns) {
    for (const match of comparableText.matchAll(pattern)) {
      const rawText = match[0] ?? "";
      const start = match.index ?? -1;
      if (!rawText || start < 0) continue;
      const normalized = makePdfTextExternalMatch(rawText, start);
      if (!normalized) continue;
      const rawStart = comparableToRawOffsets[normalized.start] ?? -1;
      const rawEnd = (comparableToRawOffsets[normalized.end - 1] ?? -1) + 1;
      if (rawStart < 0 || rawEnd <= rawStart) continue;
      const originalText = text.slice(rawStart, rawEnd);
      const key = `${rawStart}:${rawEnd}:${originalText}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        ...normalized,
        rawText: originalText,
        start: rawStart,
        end: rawEnd,
      });
    }
  }

  return matches.sort((a, b) => a.start - b.start || b.end - a.end);
}

export function parsePdfTextLinkTarget(text: string): PdfLinkTarget | null {
  return findPdfTextLinkMatches(text)[0]?.target ?? null;
}

function parseFragment(rawTarget: string): URLSearchParams | null {
  const hashIndex = rawTarget.indexOf("#");
  const fragment = hashIndex >= 0
    ? rawTarget.slice(hashIndex + 1)
    : rawTarget.includes("=")
      ? rawTarget
      : "";
  if (!fragment) return null;
  return new URLSearchParams(fragment);
}

function parseJsonArray(rawValue: string | null | undefined): unknown[] | null {
  if (!rawValue?.trim()) return null;
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parsePdfPageFromTarget(rawTarget: string): number | null {
  const params = parseFragment(rawTarget);
  const page = params?.get("page");
  if (!page) return null;
  const parsed = Number.parseInt(page, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parsePdfAnnotationIdFromTarget(rawTarget: string): string | null {
  const params = parseFragment(rawTarget);
  const annotationId = params?.get("annotation");
  return annotationId?.trim() || null;
}

export function parsePdfNamedDestinationFromTarget(rawTarget: string): string | null {
  const trimmed = rawTarget.trim();
  if (!trimmed) return null;

  const params = parseFragment(trimmed);
  const namedDestination = params?.get("nameddest") ?? params?.get("dest");
  if (namedDestination?.trim()) {
    return namedDestination.trim();
  }

  if (trimmed.startsWith("#")) {
    const fragment = trimmed.slice(1).trim();
    if (fragment && !fragment.includes("=")) {
      return decodeURIComponent(fragment);
    }
  }

  return null;
}

export function parsePdfExplicitDestinationFromTarget(rawTarget: string): unknown[] | null {
  const trimmed = rawTarget.trim();
  if (!trimmed) return null;

  const params = parseFragment(trimmed);
  return parseJsonArray(params?.get("explicitDest") ?? params?.get("explicitdest"));
}

export function parsePdfNamedActionFromTarget(rawTarget: string): string | null {
  const trimmed = rawTarget.trim();
  if (!trimmed) return null;

  const params = parseFragment(trimmed);
  const action = params?.get("action") ?? params?.get("namedaction");
  if (action?.trim()) return action.trim();

  if (trimmed.startsWith("#action=")) {
    return decodeURIComponent(trimmed.slice("#action=".length)).trim() || null;
  }

  return null;
}

export function parsePdfLinkTarget(rawTarget: string): PdfLinkTarget | null {
  const externalUrl = normalizePdfExternalUrl(rawTarget);
  if (externalUrl) {
    return { type: "external", url: externalUrl };
  }

  const annotationId = parsePdfAnnotationIdFromTarget(rawTarget);
  if (annotationId) {
    return { type: "annotation", annotationId };
  }

  const page = parsePdfPageFromTarget(rawTarget);
  if (page) {
    return { type: "page", page };
  }

  const explicitDestination = parsePdfExplicitDestinationFromTarget(rawTarget);
  if (explicitDestination) {
    return { type: "explicitDestination", destination: explicitDestination };
  }

  const namedAction = parsePdfNamedActionFromTarget(rawTarget);
  if (namedAction) {
    return { type: "namedAction", action: namedAction };
  }

  const destination = parsePdfNamedDestinationFromTarget(rawTarget);
  if (destination) {
    return { type: "namedDestination", destination };
  }

  return null;
}

export function parsePdfLinkTargetFromElement(element: HTMLElement): PdfLinkTarget | null {
  return parsePdfLinkTarget(readLinkCandidate(element));
}

export function shouldOpenPdfExternalLinkInBrowser(
  event: Pick<MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">,
  mode: PdfExternalLinkOpenMode,
): boolean {
  return mode === "browser" || event.ctrlKey || event.metaKey || event.shiftKey;
}
