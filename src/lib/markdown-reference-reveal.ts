import type { ReferenceTextRange } from './reference-text-range';

export interface MarkdownReferenceEditor {
  getContent: () => string | null;
  scrollToLine: (line: number) => void;
  flashLine: (line: number) => void;
  flashRange: (from: number, to: number) => (() => void) | null;
}

/** Wait for the scroll layout, then reveal only the same document and request. */
export function scheduleMarkdownReferenceReveal(input: {
  editor: MarkdownReferenceEditor;
  content: string;
  line: number;
  range?: ReferenceTextRange;
  isCurrent: () => boolean;
  onFlash: (cleanup: () => void) => void;
  onComplete: (status: 'success' | 'quote_not_found') => void;
}): () => void {
  input.editor.scrollToLine(input.line);
  const timer = window.setTimeout(() => {
    if (!input.isCurrent()) return;
    if (input.editor.getContent() !== input.content) {
      input.onComplete('quote_not_found');
      return;
    }
    if (input.range) {
      const cleanup = input.editor.flashRange(input.range.from, input.range.to);
      if (!cleanup) {
        input.onComplete('quote_not_found');
        return;
      }
      input.onFlash(cleanup);
    } else input.editor.flashLine(input.line);
    input.onComplete('success');
  }, 120);
  return () => window.clearTimeout(timer);
}
