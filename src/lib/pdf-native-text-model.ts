import type { BoundingBox } from "@/types/universal-annotation";
import type {
  PdfNativePageTextLayout,
  PdfNativeTextChar,
} from "@/lib/pdf-native-text-engine";
import { normalizePdfText } from "@/lib/pdf-page-text-cache";

const PDF_LIGATURE_MAP: Record<string, string> = {
  "\u00a0": " ",
  "\ufb00": "ff",
  "\ufb01": "fi",
  "\ufb02": "fl",
  "\ufb03": "ffi",
  "\ufb04": "ffl",
  "\ufb05": "ft",
  "\ufb06": "st",
};

export interface PdfCompactOffsetModel {
  compactText: string;
  normalizedToCompact: number[];
  compactStartToNormalized: number[];
  compactEndToNormalized: number[];
}

export interface PdfNativeNormalizedChar {
  sourceChar: PdfNativeTextChar;
  normalizedStart: number;
  normalizedEnd: number;
  text: string;
}

export interface PdfNativeNormalizedModel {
  normalizedText: string;
  compact: PdfCompactOffsetModel;
  chars: PdfNativeNormalizedChar[];
}

export function expandPdfLigatures(text: string): string {
  return Array.from(text ?? "", (character) => PDF_LIGATURE_MAP[character] ?? character).join("");
}

export function normalizeComparablePdfNativeText(text: string): string {
  return normalizePdfText(expandPdfLigatures(text));
}

export function buildPdfCompactOffsetModel(normalizedText: string): PdfCompactOffsetModel {
  const normalizedToCompact = new Array(normalizedText.length + 1).fill(0);
  const compactStartToNormalized: number[] = [];
  const compactEndToNormalized: number[] = [0];
  let compactText = "";
  let compactOffset = 0;

  for (let index = 0; index < normalizedText.length; index += 1) {
    normalizedToCompact[index] = compactOffset;
    const character = normalizedText[index];
    if (/\s/.test(character)) {
      continue;
    }

    compactStartToNormalized[compactOffset] = index;
    compactText += character;
    compactOffset += 1;
    compactEndToNormalized[compactOffset] = index + 1;
  }

  normalizedToCompact[normalizedText.length] = compactOffset;
  compactStartToNormalized[compactOffset] = normalizedText.length;

  return {
    compactText,
    normalizedToCompact,
    compactStartToNormalized,
    compactEndToNormalized,
  };
}

function buildNormalizedOffsetMap(text: string): {
  normalizedText: string;
  rawToNormalizedOffsets: number[];
} {
  const rawToNormalizedOffsets = new Array(text.length + 1).fill(0);
  let normalizedText = "";
  let sawNonWhitespace = false;
  let pendingWhitespaceStart: number | null = null;

  for (let index = 0; index < text.length; index += 1) {
    rawToNormalizedOffsets[index] = normalizedText.length;
    const expanded = expandPdfLigatures(text[index] ?? "");
    let wroteNonWhitespace = false;

    for (const character of expanded) {
      if (/\s/.test(character)) {
        if (sawNonWhitespace && pendingWhitespaceStart === null) {
          pendingWhitespaceStart = index;
        }
        rawToNormalizedOffsets[index + 1] = normalizedText.length;
        continue;
      }

      if (pendingWhitespaceStart !== null && normalizedText.length > 0 && !normalizedText.endsWith(" ")) {
        normalizedText += " ";
        for (let boundary = pendingWhitespaceStart + 1; boundary <= index; boundary += 1) {
          rawToNormalizedOffsets[boundary] = normalizedText.length;
        }
        pendingWhitespaceStart = null;
      }

      if (!wroteNonWhitespace) {
        rawToNormalizedOffsets[index] = normalizedText.length;
        wroteNonWhitespace = true;
      }
      normalizedText += character;
      sawNonWhitespace = true;
      rawToNormalizedOffsets[index + 1] = normalizedText.length;
    }
  }

  rawToNormalizedOffsets[text.length] = normalizedText.length;
  if (pendingWhitespaceStart !== null) {
    for (let boundary = pendingWhitespaceStart + 1; boundary <= text.length; boundary += 1) {
      rawToNormalizedOffsets[boundary] = normalizedText.length;
    }
  }

  return {
    normalizedText,
    rawToNormalizedOffsets,
  };
}

export function buildPdfNativeNormalizedModel(
  layout: PdfNativePageTextLayout,
): PdfNativeNormalizedModel {
  const { normalizedText, rawToNormalizedOffsets } = buildNormalizedOffsetMap(layout.text);
  const chars = [...layout.chars]
    .sort((left, right) => left.charIndex - right.charIndex)
    .map((sourceChar) => {
      const rawStart = Math.max(0, Math.min(layout.text.length, sourceChar.charIndex));
      const rawEndIndex = typeof sourceChar.charEndIndex === "number"
        ? sourceChar.charEndIndex
        : sourceChar.charIndex + sourceChar.text.length;
      const rawEnd = Math.max(rawStart, Math.min(layout.text.length, rawEndIndex));
      const normalizedStart = rawToNormalizedOffsets[rawStart] ?? 0;
      const normalizedEnd = rawToNormalizedOffsets[rawEnd] ?? normalizedStart;

      return {
        sourceChar,
        normalizedStart,
        normalizedEnd,
        text: normalizeComparablePdfNativeText(sourceChar.text),
      } satisfies PdfNativeNormalizedChar;
    })
    .filter((character) => character.normalizedEnd > character.normalizedStart);

  return {
    normalizedText,
    compact: buildPdfCompactOffsetModel(normalizedText),
    chars,
  };
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function buildPdfNativeNormalizedRect(input: {
  layout: Pick<PdfNativePageTextLayout, "width" | "height">;
  char: Pick<PdfNativeTextChar, "x1" | "y1" | "x2" | "y2">;
}): BoundingBox | null {
  if (
    !Number.isFinite(input.layout.width) ||
    !Number.isFinite(input.layout.height) ||
    input.layout.width <= 0 ||
    input.layout.height <= 0
  ) {
    return null;
  }

  const values = [input.char.x1, input.char.y1, input.char.x2, input.char.y2];
  if (!values.every(Number.isFinite)) {
    return null;
  }

  const x1 = clampUnit(Math.min(input.char.x1, input.char.x2) / input.layout.width);
  const y1 = clampUnit(Math.min(input.char.y1, input.char.y2) / input.layout.height);
  const x2 = clampUnit(Math.max(input.char.x1, input.char.x2) / input.layout.width);
  const y2 = clampUnit(Math.max(input.char.y1, input.char.y2) / input.layout.height);
  if (x2 <= x1 || y2 <= y1) {
    return null;
  }

  return { x1, y1, x2, y2 };
}
