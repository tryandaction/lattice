/**
 * Tests for Content Normalizer
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeScientificText,
  normalizeMathDelimiters,
  normalizeTableWhitespace,
  detectLatexPatterns,
  detectFormulasTolerantly,
  fixIncompleteDelimiters,
} from '../content-normalizer';

describe('Content Normalizer', () => {
  describe('normalizeMathDelimiters', () => {
    it('should convert \\(...\\) to $...$', () => {
      const input = '\\(x^2\\)';
      const result = normalizeMathDelimiters(input);
      expect(result).toBe('$x^2$');
    });

    it('should convert \\[...\\] to $$...$$', () => {
      const input = '\\[E = mc^2\\]';
      const result = normalizeMathDelimiters(input);
      expect(result).toBe('$$E = mc^2$$');
    });

    it('should convert \\begin{equation}...\\end{equation} to $$...$$', () => {
      const input = '\\begin{equation}x = y\\end{equation}';
      const result = normalizeMathDelimiters(input);
      expect(result).toBe('$$x = y$$');
    });

    it('should handle multiple math expressions', () => {
      const input = 'Text \\(a\\) and \\(b\\)';
      const result = normalizeMathDelimiters(input);
      expect(result).toBe('Text $a$ and $b$');
    });

    it('should not modify content without math delimiters', () => {
      const input = 'Plain text without math';
      const result = normalizeMathDelimiters(input);
      expect(result).toBe(input);
    });

    it('should handle empty input', () => {
      expect(normalizeMathDelimiters('')).toBe('');
    });

    it('should handle null input', () => {
      expect(normalizeMathDelimiters(null as any)).toBe('');
    });
  });

  describe('normalizeTableWhitespace', () => {
    it('should add blank line before table when preceded by text', () => {
      const input = 'Text\n| A | B |\n|---|---|\n| 1 | 2 |';
      const result = normalizeTableWhitespace(input);
      expect(result).toContain('\n\n|');
    });

    it('should not add extra blank lines if already present', () => {
      const input = 'Text\n\n| A | B |\n|---|---|\n| 1 | 2 |';
      const result = normalizeTableWhitespace(input);
      expect(result).not.toMatch(/\n\n\n/);
    });

    it('should handle empty input', () => {
      expect(normalizeTableWhitespace('')).toBe('');
    });
  });

  describe('detectLatexPatterns', () => {
    it('should return true for \\frac', () => {
      expect(detectLatexPatterns('\\frac{1}{2}')).toBe(true);
    });

    it('should return true for \\sum', () => {
      expect(detectLatexPatterns('\\sum_{i=0}^n')).toBe(true);
    });

    it('should return true for Greek letters', () => {
      expect(detectLatexPatterns('\\alpha')).toBe(true);
      expect(detectLatexPatterns('\\beta')).toBe(true);
      expect(detectLatexPatterns('\\gamma')).toBe(true);
    });

    it('should return false for plain text', () => {
      expect(detectLatexPatterns('Hello world')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(detectLatexPatterns('')).toBe(false);
    });

    it('should return false for null', () => {
      expect(detectLatexPatterns(null as any)).toBe(false);
    });
  });

  describe('detectFormulasTolerantly', () => {
    it('should detect inline math $...$', () => {
      const input = 'Text $x^2$ more';
      const formulas = detectFormulasTolerantly(input);
      expect(formulas.length).toBe(1);
      expect(formulas[0].isBlock).toBe(false);
    });

    it('should detect block math $$...$$', () => {
      const input = 'Text $$E = mc^2$$ more';
      const formulas = detectFormulasTolerantly(input);
      expect(formulas.length).toBe(1);
      expect(formulas[0].isBlock).toBe(true);
    });

    it('should return empty array for empty input', () => {
      expect(detectFormulasTolerantly('')).toEqual([]);
    });

    it('should return empty array for null input', () => {
      expect(detectFormulasTolerantly(null as any)).toEqual([]);
    });
  });

  describe('fixIncompleteDelimiters', () => {
    it('should return content as-is (simplified version)', () => {
      const input = 'Text $\\frac{1}{2}';
      const result = fixIncompleteDelimiters(input);
      expect(result).toBe(input);
    });

    it('should handle empty input', () => {
      expect(fixIncompleteDelimiters('')).toBe('');
    });

    it('should handle null input', () => {
      expect(fixIncompleteDelimiters(null as any)).toBe('');
    });
  });

  describe('normalizeScientificText', () => {
    it('should handle mixed content', () => {
      const input = 'Text \\(x^2\\) and \\[y^2\\]';
      const result = normalizeScientificText(input);
      expect(result).toContain('$x^2$');
      expect(result).toContain('$$y^2$$');
    });

    it('should handle empty input', () => {
      expect(normalizeScientificText('')).toBe('');
    });

    it('should handle null input', () => {
      expect(normalizeScientificText(null as any)).toBe('');
    });

    it('should handle undefined input', () => {
      expect(normalizeScientificText(undefined as any)).toBe('');
    });

    it('should preserve content that is already normalized', () => {
      const input = 'Text $x^2$ and $$y^2$$';
      const result = normalizeScientificText(input);
      expect(result).toBe(input);
    });
  });
});
