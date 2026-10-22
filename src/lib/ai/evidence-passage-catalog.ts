import { findReferenceTextRange } from '@/lib/reference-text-range';

/** Offsets always address the unmodified, authorized unit text. Missing IDs mean context only. */
export interface EvidencePassage { from: number; to: number; text: string; passageId?: string }

function fingerprint(value: string): string {
  // Identity only: acceptance requires an exact lookup in the current authorized catalogue.
  let left = 2166136261, right = 5381;
  for (let index = 0; index < value.length; index++) {
    left = Math.imul(left ^ value.charCodeAt(index), 16777619);
    right = Math.imul(right, 33) ^ value.charCodeAt(index);
  }
  return (left >>> 0).toString(36) + '-' + (right >>> 0).toString(36);
}

/** Build once per unit, before fitting prompts. Validation text is never sent to the model. */
export function buildEvidencePassageCatalog(input: {
  path: string; version: string; unit: number; fullText: string; validationText?: string; pdf: boolean;
}): EvidencePassage[] {
  const { fullText } = input;
  const identity = fingerprint(JSON.stringify([input.path, input.version, input.unit, fullText]));
  const validationText = input.validationText ?? fullText;
  const passages: EvidencePassage[] = [];
  let from = 0;
  while (from < fullText.length) {
    let to = Math.min(fullText.length, from + 360);
    if (fullText.length - from <= 600) to = fullText.length;
    else {
      const window = fullText.slice(from, to);
      const boundaries = [...window.matchAll(/[.!?。！？](?:\s+|$)|\n+/g)];
      const boundary = boundaries.at(-1);
      if (boundary && boundary.index + boundary[0].length >= 120) to = from + boundary.index + boundary[0].length;
      else {
        const space = fullText.lastIndexOf(' ', to);
        if (space > from + 120) to = space + 1;
      }
      if (/[\uD800-\uDBFF]/.test(fullText[to - 1] ?? '')) to--;
    }
    const text = fullText.slice(from, to);
    const quote = text.trim();
    const range = quote.length >= 8 && quote.length <= 600 ? findReferenceTextRange(validationText, quote, { pdfTypography: input.pdf }) : null;
    const uniqueInUnit = range && findReferenceTextRange(fullText, quote, { pdfTypography: input.pdf });
    passages.push({ from, to, text, ...(uniqueInUnit ? { passageId: 'passage-' + identity + '-' + from.toString(36) + '-' + to.toString(36) } : {}) });
    from = to;
  }
  return passages;
}

/** Clipped context is readable but never gains an ID for unseen text. */
export function sliceEvidencePassages(catalog: EvidencePassage[], from: number, to: number): EvidencePassage[] {
  return catalog.filter(passage => passage.to > from && passage.from < to).map(passage => {
    const start = Math.max(from, passage.from), end = Math.min(to, passage.to);
    return { from: start, to: end, text: passage.text.slice(start - passage.from, end - passage.from),
      ...(start === passage.from && end === passage.to && passage.passageId ? { passageId: passage.passageId } : {}) };
  });
}
