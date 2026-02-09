import {
  normalizeScientificText,
  normalizeMathDelimiters,
  normalizeTableWhitespace,
  detectLatexPatterns,
  detectFormulasTolerantly,
} from './markdown-converter';

export {
  normalizeScientificText,
  normalizeMathDelimiters,
  normalizeTableWhitespace,
  detectLatexPatterns,
  detectFormulasTolerantly,
};

export function fixIncompleteDelimiters(content: string): string {
  if (!content || typeof content !== 'string') return '';
  return content;
}
