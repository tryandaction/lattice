/**
 * Content Normalizer Utility
 *
 * Normalizes scientific text content for consistent rendering.
 * Includes auto-conversion from HTML to Markdown.
 */

import { autoConvertToMarkdown } from './html-to-markdown';

/**
 * LaTeX patterns that indicate mathematical content.
 */
const LATEX_PATTERNS = [
  /\\frac\{/,
  /\\sum/,
  /\\int/,
  /\\prod/,
  /\\lim/,
  /\\sqrt/,
  /\\partial/,
  /\\infty/,
  /\\alpha/,
  /\\beta/,
  /\\gamma/,
  /\\delta/,
  /\\epsilon/,
  /\\theta/,
  /\\lambda/,
  /\\mu/,
  /\\pi/,
  /\\sigma/,
  /\\omega/,
  /\\nabla/,
  /\\mathbb\{/,
  /\\mathcal\{/,
  /\\mathrm\{/,
  /\\text\{/,
  /\\left/,
  /\\right/,
  /\\cdot/,
  /\\times/,
  /\\leq/,
  /\\geq/,
  /\\neq/,
  /\\approx/,
  /\\equiv/,
  /\\rightarrow/,
  /\\leftarrow/,
  /\\Rightarrow/,
  /\\Leftarrow/,
];

/**
 * Detects if a string contains LaTeX math patterns.
 */
export function detectLatexPatterns(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  return LATEX_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Converts various LaTeX math delimiters to standard format.
 */
function normalizeMathDelimiters(content: string): string {
  if (!content || typeof content !== 'string') return content || '';
  
  let result = content;
  
  // Convert \(...\) to $...$ (inline math)
  result = result.replace(/\\\((.+?)\\\)/gs, (_, math) => `$${math}$`);
  
  // Convert \[...\] to $$...$$ (block math)
  result = result.replace(/\\\[(.+?)\\\]/gs, (_, math) => `$$${math}$$`);
  
  // Convert \begin{equation}...\end{equation} to $$...$$
  result = result.replace(
    /\\begin\{equation\*?\}(.+?)\\end\{equation\*?\}/gs,
    (_, math) => `$$${math.trim()}$$`
  );
  
  // Convert \begin{align}...\end{align} to $$...$$
  result = result.replace(
    /\\begin\{align\*?\}(.+?)\\end\{align\*?\}/gs,
    (_, math) => `$$${math.trim()}$$`
  );
  
  return result;
}

/**
 * Ensures tables have proper newlines for remark-gfm detection.
 */
function normalizeTableWhitespace(content: string): string {
  if (!content || typeof content !== 'string') return content || '';
  
  const lines = content.split('\n');
  const result: string[] = [];
  let inTable = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    const isTableRow = trimmedLine.startsWith('|') && trimmedLine.includes('|');
    const isSeparatorRow = /^\|[\s\-:|]+\|/.test(trimmedLine);
    const isTableLine = isTableRow || isSeparatorRow;
    
    if (isTableLine && !inTable) {
      inTable = true;
      if (result.length > 0 && result[result.length - 1].trim() !== '') {
        result.push('');
      }
      result.push(line);
    } else if (isTableLine && inTable) {
      result.push(line);
    } else if (!isTableLine && inTable) {
      inTable = false;
      if (trimmedLine !== '') {
        result.push('');
      }
      result.push(line);
    } else {
      result.push(line);
    }
  }
  
  return result.join('\n');
}

/**
 * Tolerant formula detection - finds formulas even with missing delimiters.
 */
export function detectFormulasTolerantly(text: string): Array<{
  start: number;
  end: number;
  latex: string;
  isBlock: boolean;
}> {
  if (!text || typeof text !== 'string') return [];
  
  const formulas: Array<{
    start: number;
    end: number;
    latex: string;
    isBlock: boolean;
  }> = [];
  
  // Pattern 1: Standard $$...$$ block math
  const blockMathRegex = /\$\$([^$]+)\$\$/g;
  let match;
  while ((match = blockMathRegex.exec(text)) !== null) {
    formulas.push({
      start: match.index,
      end: match.index + match[0].length,
      latex: match[1].trim(),
      isBlock: true,
    });
  }
  
  // Pattern 2: Standard $...$ inline math
  const inlineMathRegex = /(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g;
  while ((match = inlineMathRegex.exec(text)) !== null) {
    formulas.push({
      start: match.index,
      end: match.index + match[0].length,
      latex: match[1].trim(),
      isBlock: false,
    });
  }
  
  return formulas;
}

/**
 * Simple pass-through for incomplete delimiters - don't try to fix them
 * as it can break content.
 */
export function fixIncompleteDelimiters(content: string): string {
  // Just return the content as-is to avoid breaking it
  if (!content || typeof content !== 'string') return content || '';
  return content;
}

/**
 * Main normalization function.
 * Auto-converts HTML to Markdown if detected.
 */
export function normalizeScientificText(rawContent: string): string {
  if (!rawContent || typeof rawContent !== 'string') return rawContent || '';

  let result = rawContent;

  // Step 0: Auto-convert HTML to Markdown (for legacy files)
  result = autoConvertToMarkdown(result);

  // Step 1: Normalize math delimiters (convert \(...\) to $...$, etc.)
  result = normalizeMathDelimiters(result);

  // Step 2: Normalize table whitespace
  result = normalizeTableWhitespace(result);

  return result;
}

// Export individual functions for testing
export {
  normalizeMathDelimiters,
  normalizeTableWhitespace,
};

// Keep fixMathEscapes for backward compatibility
export function fixMathEscapes(content: string): string {
  return content || '';
}
