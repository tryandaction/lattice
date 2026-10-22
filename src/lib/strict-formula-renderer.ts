import katex from 'katex';
import { KATEX_MACROS } from '@/lib/katex-config';

// With trust disabled, some extensions display a red command instead of
// throwing. Reject them so a partial rendering cannot pass syntax validation.
const UNSAFE_COMMAND = /\\(?:href|url|includegraphics|htmlClass|htmlId|htmlStyle|htmlData|html@mathml)\b/;
const MAX_SOURCE_LENGTH = 20000;

/**
 * Render a bounded, self-contained formula or return null for unsafe/invalid TeX.
 * A rendered result proves syntax support only, never OCR or mathematical accuracy.
 */
export function renderStrictFormula(latex: string | undefined, displayMode: boolean = true): string | null {
  if (!latex?.trim() || latex.length > MAX_SOURCE_LENGTH || UNSAFE_COMMAND.test(latex)) return null;

  try {
    return katex.renderToString(latex, {
      displayMode,
      output: 'htmlAndMathml',
      throwOnError: true,
      strict: 'error',
      trust: false,
      maxSize: 20,
      maxExpand: 1000,
      // KaTeX definitions may mutate the supplied map; each formula is isolated.
      macros: { ...KATEX_MACROS },
    });
  } catch {
    return null;
  }
}
