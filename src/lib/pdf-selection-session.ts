import type { Content, ScaledPosition } from 'react-pdf-highlighter';
import type { ImageAnnotationPreview } from '@/types/universal-annotation';

export interface PdfSelectionSessionState {
  signature: string;
  timestamp: number;
}

const DEFAULT_DUPLICATE_WINDOW_MS = 1500;

function round(value: number, precision = 4): string {
  return value.toFixed(precision);
}

function normalizeText(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function buildPdfSelectionSignature(input: {
  tool: 'highlight' | 'underline' | 'area' | 'select';
  position: ScaledPosition;
  content: Content;
}): string {
  const rectSignature = input.position.rects
    .map((rect) => [
      round(rect.x1),
      round(rect.y1),
      round(rect.x2),
      round(rect.y2),
    ].join(':'))
    .join('|');

  return [
    input.tool,
    input.position.pageNumber,
    rectSignature,
    normalizeText(input.content.text),
    input.content.image ? 'image:1' : 'image:0',
  ].join('::');
}

export function isDuplicatePdfSelection(
  previous: PdfSelectionSessionState | null,
  nextSignature: string,
  now = Date.now(),
  duplicateWindowMs = DEFAULT_DUPLICATE_WINDOW_MS,
): boolean {
  return !!previous &&
    previous.signature === nextSignature &&
    now - previous.timestamp <= duplicateWindowMs;
}

export function buildPdfAreaPreview(input: {
  dataUrl: string | undefined;
  width: number;
  height: number;
}): ImageAnnotationPreview | undefined {
  if (!input.dataUrl) {
    return undefined;
  }

  const dataUrl = input.dataUrl.trim();
  if (!dataUrl.startsWith('data:image/')) {
    return undefined;
  }

  if (input.width <= 0 || input.height <= 0) {
    return undefined;
  }

  return {
    type: 'image',
    dataUrl,
    width: input.width,
    height: input.height,
  };
}
