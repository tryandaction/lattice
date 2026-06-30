export type PdfExternalLinkOpenMode = "internal" | "browser";

export type PdfLinkTarget =
  | { type: "external"; url: string }
  | { type: "page"; page: number }
  | { type: "annotation"; annotationId: string }
  | { type: "namedDestination"; destination: string };

const PDF_LINK_SELECTOR = ".annotationLayer a, .annotationLayer [role='link'], .linkAnnotation";

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
    anchor?.getAttribute("href") ??
    element.dataset.pdfDest ??
    element.dataset.dest ??
    element.getAttribute("data-dest") ??
    element.getAttribute("data-pdf-dest") ??
    element.getAttribute("href") ??
    ""
  ).trim();
}

function normalizeExternalUrl(rawTarget: string): string | null {
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

export function parsePdfLinkTarget(rawTarget: string): PdfLinkTarget | null {
  const externalUrl = normalizeExternalUrl(rawTarget);
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
