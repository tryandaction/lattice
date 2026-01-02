/**
 * Property-Based Tests for ANSI Renderer
 * 
 * Feature: scientific-rendering-engine
 * Tests universal correctness properties for ANSI color rendering.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  renderAnsiToHtml,
  containsAnsiCodes,
  parseAnsiText,
  get256Color,
} from '../ansi-renderer';

/**
 * Generate ANSI escape sequence
 */
function ansiCode(codes: number[]): string {
  return `\x1b[${codes.join(";")}m`;
}

/**
 * Property 5: ANSI Color Code Rendering
 * 
 * For any text string containing ANSI escape sequences, the renderAnsiToHtml 
 * function SHALL convert each escape sequence to an appropriate HTML span 
 * with inline color styling, preserving the text content and color information.
 * 
 * Feature: scientific-rendering-engine, Property 5: ANSI Color Code Rendering
 * Validates: Requirements 6.2, 6.4
 */
describe('Property 5: ANSI Color Code Rendering', () => {
  const standardColors = [30, 31, 32, 33, 34, 35, 36, 37];
  const brightColors = [90, 91, 92, 93, 94, 95, 96, 97];
  
  it('should preserve text content when converting ANSI to HTML', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('\x1b') && !s.includes('<') && !s.includes('>') && !s.includes('&') && !s.includes('"') && !s.includes("'")),
        fc.constantFrom(...standardColors),
        (text, colorCode) => {
          const input = `${ansiCode([colorCode])}${text}${ansiCode([0])}`;
          const result = renderAnsiToHtml(input);
          
          // Text content should be preserved (no HTML escaping needed for filtered text)
          expect(result).toContain(text);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should generate span with color style for colored text', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('\x1b') && !s.includes('<')),
        fc.constantFrom(...standardColors, ...brightColors),
        (text, colorCode) => {
          const input = `${ansiCode([colorCode])}${text}${ansiCode([0])}`;
          const result = renderAnsiToHtml(input);
          
          // Should contain a span with color style
          expect(result).toMatch(/<span style="[^"]*color:/);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle bold text', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('\x1b') && !s.includes('<')),
        (text) => {
          const input = `${ansiCode([1])}${text}${ansiCode([0])}`;
          const result = renderAnsiToHtml(input);
          
          // Should contain bold style
          expect(result).toContain('font-weight: bold');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle underline text', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('\x1b') && !s.includes('<')),
        (text) => {
          const input = `${ansiCode([4])}${text}${ansiCode([0])}`;
          const result = renderAnsiToHtml(input);
          
          // Should contain underline style
          expect(result).toContain('text-decoration: underline');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle combined styles (color + bold)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('\x1b') && !s.includes('<')),
        fc.constantFrom(...standardColors),
        (text, colorCode) => {
          const input = `${ansiCode([1, colorCode])}${text}${ansiCode([0])}`;
          const result = renderAnsiToHtml(input);
          
          // Should contain both color and bold
          expect(result).toContain('color:');
          expect(result).toContain('font-weight: bold');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reset styles on code 0', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }).filter(s => !s.includes('\x1b') && !s.includes('<')),
        fc.string({ minLength: 1, maxLength: 10 }).filter(s => !s.includes('\x1b') && !s.includes('<')),
        fc.constantFrom(...standardColors),
        (text1, text2, colorCode) => {
          const input = `${ansiCode([colorCode])}${text1}${ansiCode([0])}${text2}`;
          const result = renderAnsiToHtml(input);
          
          // First text should be colored, second should not have color span
          const segments = parseAnsiText(input);
          expect(segments.length).toBeGreaterThanOrEqual(2);
          
          // First segment should have color
          if (segments[0].text === text1) {
            expect(segments[0].style.color).toBeDefined();
          }
          
          // Last segment (after reset) should not have color
          const lastSegment = segments[segments.length - 1];
          if (lastSegment.text === text2) {
            expect(lastSegment.style.color).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle text without ANSI codes', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 100 }).filter(s => !s.includes('\x1b')),
        (text) => {
          const result = renderAnsiToHtml(text);
          
          // Should not contain span tags (unless HTML escaping needed)
          if (!text.includes('<') && !text.includes('>') && !text.includes('&') && !text.includes('"') && !text.includes("'")) {
            expect(result).toBe(text);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should escape HTML special characters', () => {
    // Test that HTML special characters are properly escaped
    expect(renderAnsiToHtml('<')).toBe('&lt;');
    expect(renderAnsiToHtml('>')).toBe('&gt;');
    expect(renderAnsiToHtml('&')).toBe('&amp;');
    expect(renderAnsiToHtml('"')).toBe('&quot;');
    expect(renderAnsiToHtml("'")).toBe('&#039;');
    
    // Test with ANSI codes
    const input = `${ansiCode([31])}<script>alert('xss')</script>${ansiCode([0])}`;
    const result = renderAnsiToHtml(input);
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });
});

describe('containsAnsiCodes', () => {
  it('should return true for text with ANSI codes', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 20 }),
        fc.constantFrom(0, 1, 4, 30, 31, 32, 33, 34, 35, 36, 37),
        (text, code) => {
          const input = `${text}${ansiCode([code])}more`;
          expect(containsAnsiCodes(input)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return false for text without ANSI codes', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 100 }).filter(s => !s.includes('\x1b')),
        (text) => {
          expect(containsAnsiCodes(text)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('get256Color', () => {
  it('should return valid hex colors for all 256 indices', () => {
    for (let i = 0; i < 256; i++) {
      const color = get256Color(i);
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('should return standard colors for indices 0-15', () => {
    const standardColors = [
      "#000000", "#cc0000", "#00cc00", "#cccc00",
      "#0000cc", "#cc00cc", "#00cccc", "#cccccc",
      "#666666", "#ff0000", "#00ff00", "#ffff00",
      "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
    ];
    
    for (let i = 0; i < 16; i++) {
      expect(get256Color(i)).toBe(standardColors[i]);
    }
  });
});

describe('Integration tests', () => {
  it('should handle typical terminal output', () => {
    // Simulate colored error message
    const errorOutput = `${ansiCode([31])}Error:${ansiCode([0])} Something went wrong`;
    const result = renderAnsiToHtml(errorOutput);
    
    expect(result).toContain('color:');
    expect(result).toContain('Error:');
    expect(result).toContain('Something went wrong');
  });

  it('should handle Python traceback style output', () => {
    const traceback = `${ansiCode([1, 31])}Traceback${ansiCode([0])} (most recent call last):
  File "${ansiCode([36])}test.py${ansiCode([0])}", line 1
${ansiCode([31])}ValueError${ansiCode([0])}: invalid value`;
    
    const result = renderAnsiToHtml(traceback);
    
    expect(result).toContain('Traceback');
    expect(result).toContain('test.py');
    expect(result).toContain('ValueError');
  });

  it('should handle empty input', () => {
    expect(renderAnsiToHtml('')).toBe('');
  });

  it('should handle only ANSI codes (no text)', () => {
    const input = `${ansiCode([31])}${ansiCode([0])}`;
    const result = renderAnsiToHtml(input);
    expect(result).toBe('');
  });
});
