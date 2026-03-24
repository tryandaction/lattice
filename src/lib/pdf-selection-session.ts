import type { Content, ScaledPosition } from 'react-pdf-highlighter';
import type { ImageAnnotationPreview } from '@/types/universal-annotation';

export type PdfSelectionPhase =
  | 'native_dragging'
  | 'native_settled'
  | 'transient_overlay'
  | 'committed'
  | 'cancelled';

export interface PdfSelectionSessionState {
  token: number;
  phase: PdfSelectionPhase;
  signature: string | null;
  timestamp: number;
}

const DEFAULT_REPLAY_WINDOW_MS = 450;

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

export function beginPdfSelectionSession(
  previous: PdfSelectionSessionState | null,
  now = Date.now(),
): PdfSelectionSessionState {
  return {
    token: (previous?.token ?? 0) + 1,
    phase: 'native_dragging',
    signature: null,
    timestamp: now,
  };
}

export function updatePdfSelectionSession(
  previous: PdfSelectionSessionState | null,
  input: {
    phase: PdfSelectionPhase;
    signature?: string | null;
    token?: number;
    now?: number;
  },
): PdfSelectionSessionState {
  return {
    token: input.token ?? previous?.token ?? 0,
    phase: input.phase,
    signature: input.signature ?? previous?.signature ?? null,
    timestamp: input.now ?? Date.now(),
  };
}

export function isDuplicatePdfSelection(
  previous: PdfSelectionSessionState | null,
  nextSelection: {
    signature: string;
    token: number;
    now?: number;
    replayWindowMs?: number;
  },
): boolean {
  const now = nextSelection.now ?? Date.now();
  const replayWindowMs = nextSelection.replayWindowMs ?? DEFAULT_REPLAY_WINDOW_MS;

  return !!previous &&
    previous.token === nextSelection.token &&
    previous.signature === nextSelection.signature &&
    previous.phase !== 'native_dragging' &&
    previous.phase !== 'cancelled' &&
    now - previous.timestamp <= replayWindowMs;
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
