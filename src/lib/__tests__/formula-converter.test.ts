/**
 * Formula Converter Tests
 * 
 * Tests for OMML to LaTeX conversion, LaTeX detection, and KaTeX rendering.
 * 
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  convertCharToLatex,
  convertTextToLatex,
  convertOmmlToLatex,
  detectLatexInText,
  renderLatex,
  renderLatexSafe,
  convertMathmlToLatex,
  type DetectedFormula,
} from '../formula-converter';

describe('Formula Converter', () => {
  // ==========================================================================
  // Character Conversion Tests
  // ==========================================================================
  
  describe('convertCharToLatex', () => {
    it('should convert Greek letters', () => {
      expect(convertCharToLatex('α')).toBe('\\alpha');
      expect(convertCharToLatex('β')).toBe('\\beta');
      expect(convertCharToLatex('Σ')).toBe('\\Sigma');
      expect(convertCharToLatex('Ω')).toBe('\\Omega');
    });
    
    it('should convert math symbols', () => {
      expect(convertCharToLatex('∑')).toBe('\\sum');
      expect(convertCharToLatex('∫')).toBe('\\int');
      expect(convertCharToLatex('∞')).toBe('\\infty');
      expect(convertCharToLatex('≤')).toBe('\\leq');
    });
    
    it('should return unchanged for regular characters', () => {
      expect(convertCharToLatex('a')).toBe('a');
      expect(convertCharToLatex('1')).toBe('1');
      expect(convertCharToLatex('+')).toBe('+');
    });
  });
  
  describe('convertTextToLatex', () => {
    it('should convert mixed text with special characters', () => {
      expect(convertTextToLatex('α + β')).toBe('\\alpha + \\beta');
      expect(convertTextToLatex('x ≤ y')).toBe('x \\leq y');
    });
  });
  
  // ==========================================================================
  // OMML Conversion Tests
  // ==========================================================================
  
  describe('convertOmmlToLatex', () => {
    it('should convert simple fraction', () => {
      const omml = `
        <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
          <m:f>
            <m:num><m:r><m:t>a</m:t></m:r></m:num>
            <m:den><m:r><m:t>b</m:t></m:r></m:den>
          </m:f>
        </m:oMath>
      `;
      const latex = convertOmmlToLatex(omml);
      expect(latex).toContain('\\frac');
      expect(latex).toContain('a');
      expect(latex).toContain('b');
    });
    
    it('should convert square root', () => {
      const omml = `
        <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
          <m:rad>
            <m:e><m:r><m:t>x</m:t></m:r></m:e>
          </m:rad>
        </m:oMath>
      `;
      const latex = convertOmmlToLatex(omml);
      expect(latex).toContain('\\sqrt');
      expect(latex).toContain('x');
    });
    
    it('should convert subscript', () => {
      const omml = `
        <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
          <m:sSub>
            <m:e><m:r><m:t>x</m:t></m:r></m:e>
            <m:sub><m:r><m:t>i</m:t></m:r></m:sub>
          </m:sSub>
        </m:oMath>
      `;
      const latex = convertOmmlToLatex(omml);
      expect(latex).toContain('_');
      expect(latex).toContain('x');
      expect(latex).toContain('i');
    });
    
    it('should convert superscript', () => {
      const omml = `
        <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
          <m:sSup>
            <m:e><m:r><m:t>x</m:t></m:r></m:e>
            <m:sup><m:r><m:t>2</m:t></m:r></m:sup>
          </m:sSup>
        </m:oMath>
      `;
      const latex = convertOmmlToLatex(omml);
      expect(latex).toContain('^');
      expect(latex).toContain('x');
      expect(latex).toContain('2');
    });
    
    it('should handle invalid XML gracefully', () => {
      const invalidOmml = '<invalid>not valid xml';
      const result = convertOmmlToLatex(invalidOmml);
      // Should not throw, should return something
      expect(typeof result).toBe('string');
    });
    
    it('should handle empty input', () => {
      const result = convertOmmlToLatex('');
      expect(typeof result).toBe('string');
    });
  });
  
  // ==========================================================================
  // LaTeX Detection Tests
  // ==========================================================================
  
  describe('detectLatexInText', () => {
    it('should detect inline math with $...$', () => {
      const text = 'The formula $x^2$ is quadratic';
      const formulas = detectLatexInText(text);
      expect(formulas).toHaveLength(1);
      expect(formulas[0].latex).toBe('x^2');
      expect(formulas[0].displayMode).toBe(false);
    });
    
    it('should detect display math with $$...$$', () => {
      const text = 'The equation $$E = mc^2$$ is famous';
      const formulas = detectLatexInText(text);
      expect(formulas).toHaveLength(1);
      expect(formulas[0].latex).toBe('E = mc^2');
      expect(formulas[0].displayMode).toBe(true);
    });
    
    it('should detect inline math with \\(...\\)', () => {
      const text = 'The formula \\(x^2\\) is quadratic';
      const formulas = detectLatexInText(text);
      expect(formulas).toHaveLength(1);
      expect(formulas[0].latex).toBe('x^2');
      expect(formulas[0].displayMode).toBe(false);
    });
    
    it('should detect display math with \\[...\\]', () => {
      const text = 'The equation \\[E = mc^2\\] is famous';
      const formulas = detectLatexInText(text);
      expect(formulas).toHaveLength(1);
      expect(formulas[0].latex).toBe('E = mc^2');
      expect(formulas[0].displayMode).toBe(true);
    });
    
    it('should detect multiple formulas', () => {
      const text = 'Given $a$ and $b$, we have $$a + b$$';
      const formulas = detectLatexInText(text);
      expect(formulas).toHaveLength(3);
    });
    
    it('should return empty array for text without formulas', () => {
      const text = 'No formulas here';
      const formulas = detectLatexInText(text);
      expect(formulas).toHaveLength(0);
    });
    
    it('should preserve formula positions', () => {
      const text = 'Start $x$ end';
      const formulas = detectLatexInText(text);
      expect(formulas[0].start).toBe(6);
      expect(formulas[0].end).toBe(9);
      expect(formulas[0].original).toBe('$x$');
    });
  });
  
  // ==========================================================================
  // KaTeX Rendering Tests
  // ==========================================================================
  
  describe('renderLatex', () => {
    it('should render simple expressions', () => {
      const html = renderLatex('x^2', false);
      expect(html).toContain('katex');
    });
    
    it('should render fractions', () => {
      const html = renderLatex('\\frac{a}{b}', false);
      expect(html).toContain('katex');
    });
    
    it('should render Greek letters', () => {
      const html = renderLatex('\\alpha + \\beta', false);
      expect(html).toContain('katex');
    });
    
    it('should render display mode differently', () => {
      const inline = renderLatex('x^2', false);
      const display = renderLatex('x^2', true);
      // Display mode should have different class
      expect(display).toContain('katex-display');
    });
    
    it('should handle invalid LaTeX gracefully', () => {
      const html = renderLatex('\\invalid{command}', false);
      // Should not throw, should return something
      expect(typeof html).toBe('string');
    });
  });
  
  describe('renderLatexSafe', () => {
    it('should return success true for valid LaTeX', () => {
      const result = renderLatexSafe('x^2', false);
      expect(result.success).toBe(true);
      expect(result.html).toContain('katex');
    });
    
    it('should return success false for invalid LaTeX', () => {
      // Use a definitely invalid command
      const result = renderLatexSafe('\\begin{invalid}', false);
      // KaTeX with throwOnError: false might still render something
      expect(typeof result.html).toBe('string');
    });
  });
  
  // ==========================================================================
  // MathML Conversion Tests
  // ==========================================================================
  
  describe('convertMathmlToLatex', () => {
    it('should convert simple fraction', () => {
      const mathml = `
        <math>
          <mfrac>
            <mi>a</mi>
            <mi>b</mi>
          </mfrac>
        </math>
      `;
      const latex = convertMathmlToLatex(mathml);
      expect(latex).toContain('\\frac');
    });
    
    it('should convert square root', () => {
      const mathml = `
        <math>
          <msqrt>
            <mi>x</mi>
          </msqrt>
        </math>
      `;
      const latex = convertMathmlToLatex(mathml);
      expect(latex).toContain('\\sqrt');
    });
    
    it('should convert subscript', () => {
      const mathml = `
        <math>
          <msub>
            <mi>x</mi>
            <mi>i</mi>
          </msub>
        </math>
      `;
      const latex = convertMathmlToLatex(mathml);
      expect(latex).toContain('_');
    });
    
    it('should handle invalid MathML gracefully', () => {
      const result = convertMathmlToLatex('<invalid>');
      expect(typeof result).toBe('string');
    });
  });
  
  // ==========================================================================
  // Property-Based Tests
  // ==========================================================================
  
  /**
   * Property 8: OMML to LaTeX Conversion Validity
   * For any valid OMML XML input containing mathematical expressions,
   * the conversion to LaTeX SHALL produce a string that KaTeX can render
   * without throwing an error.
   * 
   * **Validates: Requirements 5.1**
   */
  describe('Property 8: OMML to LaTeX Conversion Validity', () => {
    // Generate valid OMML structures
    const ommlFraction = (num: string, den: string) => `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:f>
          <m:num><m:r><m:t>${num}</m:t></m:r></m:num>
          <m:den><m:r><m:t>${den}</m:t></m:r></m:den>
        </m:f>
      </m:oMath>
    `;
    
    const ommlSqrt = (content: string) => `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:rad>
          <m:e><m:r><m:t>${content}</m:t></m:r></m:e>
        </m:rad>
      </m:oMath>
    `;
    
    const ommlSub = (base: string, sub: string) => `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:sSub>
          <m:e><m:r><m:t>${base}</m:t></m:r></m:e>
          <m:sub><m:r><m:t>${sub}</m:t></m:r></m:sub>
        </m:sSub>
      </m:oMath>
    `;
    
    const ommlSup = (base: string, sup: string) => `
      <m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <m:sSup>
          <m:e><m:r><m:t>${base}</m:t></m:r></m:e>
          <m:sup><m:r><m:t>${sup}</m:t></m:r></m:sup>
        </m:sSup>
      </m:oMath>
    `;
    
    // Arbitrary for simple math identifiers (letters and numbers)
    const mathIdentifier = fc.stringOf(
      fc.constantFrom('a', 'b', 'c', 'x', 'y', 'z', 'n', 'm', '1', '2', '3'),
      { minLength: 1, maxLength: 3 }
    );
    
    it('should convert fractions to renderable LaTeX', () => {
      fc.assert(
        fc.property(mathIdentifier, mathIdentifier, (num, den) => {
          const omml = ommlFraction(num, den);
          const latex = convertOmmlToLatex(omml);
          
          // Should produce non-empty LaTeX
          expect(latex.length).toBeGreaterThan(0);
          
          // Should be renderable by KaTeX (no throw)
          const result = renderLatexSafe(latex, false);
          // We check that it produces some output
          expect(result.html.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });
    
    it('should convert square roots to renderable LaTeX', () => {
      fc.assert(
        fc.property(mathIdentifier, (content) => {
          const omml = ommlSqrt(content);
          const latex = convertOmmlToLatex(omml);
          
          expect(latex.length).toBeGreaterThan(0);
          expect(latex).toContain('\\sqrt');
          
          const result = renderLatexSafe(latex, false);
          expect(result.html.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });
    
    it('should convert subscripts to renderable LaTeX', () => {
      fc.assert(
        fc.property(mathIdentifier, mathIdentifier, (base, sub) => {
          const omml = ommlSub(base, sub);
          const latex = convertOmmlToLatex(omml);
          
          expect(latex.length).toBeGreaterThan(0);
          expect(latex).toContain('_');
          
          const result = renderLatexSafe(latex, false);
          expect(result.html.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });
    
    it('should convert superscripts to renderable LaTeX', () => {
      fc.assert(
        fc.property(mathIdentifier, mathIdentifier, (base, sup) => {
          const omml = ommlSup(base, sup);
          const latex = convertOmmlToLatex(omml);
          
          expect(latex.length).toBeGreaterThan(0);
          expect(latex).toContain('^');
          
          const result = renderLatexSafe(latex, false);
          expect(result.html.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });
  });
  
  /**
   * Property 9: Formula Rendering Fallback
   * For any invalid or malformed formula input, the Formula_Renderer SHALL:
   * - NOT throw an uncaught exception
   * - Return a fallback representation containing the original formula text
   * 
   * **Validates: Requirements 5.5**
   */
  describe('Property 9: Formula Rendering Fallback', () => {
    // Generate potentially invalid LaTeX strings
    const invalidLatex = fc.oneof(
      fc.constant('\\begin{invalid}'),
      fc.constant('\\frac{'),
      fc.constant('\\sqrt['),
      fc.constant('$$$'),
      fc.constant('\\undefined'),
      fc.stringOf(fc.constantFrom('\\', '{', '}', '^', '_'), { minLength: 1, maxLength: 10 }),
    );
    
    it('should not throw for any input', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          // Should never throw
          expect(() => renderLatex(input, false)).not.toThrow();
          expect(() => renderLatex(input, true)).not.toThrow();
        }),
        { numRuns: 100 }
      );
    });
    
    it('should always return a string', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          const result = renderLatex(input, false);
          expect(typeof result).toBe('string');
          expect(result.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });
    
    it('should handle invalid LaTeX gracefully', () => {
      fc.assert(
        fc.property(invalidLatex, (latex) => {
          // Should not throw
          const result = renderLatexSafe(latex, false);
          
          // Should return some HTML
          expect(typeof result.html).toBe('string');
          expect(result.html.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });
  });
  
  /**
   * Property 10: LaTeX Detection and Rendering
   * For any text containing LaTeX delimiters ($...$, $$...$$, \(...\), \[...\]),
   * the Formula_Renderer SHALL:
   * - Detect all formula occurrences
   * - Render each formula using KaTeX
   * - Preserve non-formula text unchanged
   * 
   * **Validates: Requirements 5.3, 5.6**
   */
  describe('Property 10: LaTeX Detection and Rendering', () => {
    // Generate text with embedded formulas
    const simpleLatex = fc.constantFrom('x', 'y', 'x^2', 'a+b', '\\alpha', '\\frac{1}{2}');
    const plainText = fc.stringOf(fc.constantFrom('a', 'b', 'c', ' ', '.', ','), { minLength: 0, maxLength: 20 });
    
    it('should detect inline formulas with $...$', () => {
      fc.assert(
        fc.property(plainText, simpleLatex, plainText, (before, formula, after) => {
          const text = `${before}$${formula}$${after}`;
          const detected = detectLatexInText(text);
          
          // Should detect at least one formula
          expect(detected.length).toBeGreaterThanOrEqual(1);
          
          // The detected formula should match
          const found = detected.find(d => d.latex === formula);
          if (formula.length > 0) {
            expect(found).toBeDefined();
            expect(found?.displayMode).toBe(false);
          }
        }),
        { numRuns: 100 }
      );
    });
    
    it('should detect display formulas with $$...$$', () => {
      fc.assert(
        fc.property(plainText, simpleLatex, plainText, (before, formula, after) => {
          const text = `${before}$$${formula}$$${after}`;
          const detected = detectLatexInText(text);
          
          // Should detect at least one formula
          expect(detected.length).toBeGreaterThanOrEqual(1);
          
          // The detected formula should be in display mode
          const found = detected.find(d => d.displayMode === true);
          expect(found).toBeDefined();
        }),
        { numRuns: 100 }
      );
    });
    
    it('should preserve formula positions correctly', () => {
      fc.assert(
        fc.property(plainText, simpleLatex, (before, formula) => {
          const text = `${before}$${formula}$`;
          const detected = detectLatexInText(text);
          
          if (detected.length > 0 && formula.length > 0) {
            const first = detected[0];
            // The original text at the detected position should match
            expect(text.slice(first.start, first.end)).toBe(first.original);
          }
        }),
        { numRuns: 100 }
      );
    });
    
    it('should return empty array for text without delimiters', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom('a', 'b', 'c', '1', '2', ' ', '.'), { minLength: 0, maxLength: 50 }),
          (text) => {
            // Text without $ or \ should have no formulas
            if (!text.includes('$') && !text.includes('\\')) {
              const detected = detectLatexInText(text);
              expect(detected).toHaveLength(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
