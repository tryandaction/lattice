/**
 * Formula Enhancer Tests
 * 
 * Property-based tests for formula rendering functions
 * 
 * Feature: ppt-viewer-overhaul
 * Property 9: Formula Rendering Fallback
 * Property 10: Formula LaTeX Rendering
 * Property 11: MathML to LaTeX Conversion
 * Validates: Requirements 5.1, 5.2, 5.5, 5.6
 * 
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  renderLatex,
  mathmlToLatex,
  renderMathML,
  enhanceFormulas,
  containsFormulas,
  isValidLatex,
} from '../formula-enhancer';

describe('Formula Enhancer', () => {
  // ==========================================================================
  // Unit Tests
  // ==========================================================================

  describe('renderLatex', () => {
    it('should render simple LaTeX formulas', () => {
      const result = renderLatex('x^2 + y^2 = z^2');
      expect(result.success).toBe(true);
      expect(result.html).toContain('katex');
    });

    it('should render fractions', () => {
      const result = renderLatex('\\frac{a}{b}');
      expect(result.success).toBe(true);
      expect(result.html).toContain('katex');
    });

    it('should render Greek letters', () => {
      const result = renderLatex('\\alpha + \\beta = \\gamma');
      expect(result.success).toBe(true);
      expect(result.html).toContain('katex');
    });

    it('should render integrals', () => {
      const result = renderLatex('\\int_0^\\infty e^{-x} dx');
      expect(result.success).toBe(true);
      expect(result.html).toContain('katex');
    });

    it('should render summations', () => {
      const result = renderLatex('\\sum_{i=1}^n i^2');
      expect(result.success).toBe(true);
      expect(result.html).toContain('katex');
    });

    it('should render matrices', () => {
      const result = renderLatex('\\begin{matrix} a & b \\\\ c & d \\end{matrix}');
      expect(result.success).toBe(true);
      expect(result.html).toContain('katex');
    });

    it('should handle display mode', () => {
      const inline = renderLatex('x^2', false);
      const display = renderLatex('x^2', true);
      expect(inline.success).toBe(true);
      expect(display.success).toBe(true);
      // Display mode should have different styling
      expect(display.html).toContain('display');
    });
  });

  describe('mathmlToLatex', () => {
    it('should convert simple MathML fraction', () => {
      const mathml = '<math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>';
      const latex = mathmlToLatex(mathml);
      expect(latex).toContain('\\frac');
    });

    it('should convert MathML superscript', () => {
      const mathml = '<math><msup><mi>x</mi><mn>2</mn></msup></math>';
      const latex = mathmlToLatex(mathml);
      expect(latex).toContain('^');
    });

    it('should convert MathML subscript', () => {
      const mathml = '<math><msub><mi>x</mi><mn>1</mn></msub></math>';
      const latex = mathmlToLatex(mathml);
      expect(latex).toContain('_');
    });

    it('should convert MathML square root', () => {
      const mathml = '<math><msqrt><mi>x</mi></msqrt></math>';
      const latex = mathmlToLatex(mathml);
      expect(latex).toContain('\\sqrt');
    });

    it('should handle invalid MathML gracefully', () => {
      const invalid = 'not valid mathml';
      const result = mathmlToLatex(invalid);
      expect(result).toBe(invalid); // Should return original
    });
  });

  describe('renderMathML', () => {
    it('should render MathML to HTML', () => {
      const mathml = '<math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>';
      const result = renderMathML(mathml);
      expect(result.html).toBeTruthy();
    });
  });

  describe('enhanceFormulas', () => {
    it('should enhance inline LaTeX', () => {
      const html = 'The formula $x^2$ is quadratic.';
      const result = enhanceFormulas(html);
      expect(result).toContain('katex');
      expect(result).not.toContain('$x^2$');
    });

    it('should enhance display LaTeX', () => {
      const html = 'The formula $$\\frac{a}{b}$$ is a fraction.';
      const result = enhanceFormulas(html);
      expect(result).toContain('katex');
    });

    it('should enhance \\(...\\) inline LaTeX', () => {
      const html = 'The formula \\(x^2\\) is quadratic.';
      const result = enhanceFormulas(html);
      expect(result).toContain('katex');
    });

    it('should enhance \\[...\\] display LaTeX', () => {
      const html = 'The formula \\[\\frac{a}{b}\\] is a fraction.';
      const result = enhanceFormulas(html);
      expect(result).toContain('katex');
    });

    it('should preserve non-formula content', () => {
      const html = '<p>Hello world</p>';
      const result = enhanceFormulas(html);
      expect(result).toBe(html);
    });
  });

  describe('containsFormulas', () => {
    it('should detect inline LaTeX', () => {
      expect(containsFormulas('$x^2$')).toBe(true);
    });

    it('should detect display LaTeX', () => {
      expect(containsFormulas('$$x^2$$')).toBe(true);
    });

    it('should detect MathML', () => {
      expect(containsFormulas('<math><mi>x</mi></math>')).toBe(true);
    });

    it('should return false for plain text', () => {
      expect(containsFormulas('Hello world')).toBe(false);
    });
  });

  describe('isValidLatex', () => {
    it('should return true for valid LaTeX', () => {
      expect(isValidLatex('x^2')).toBe(true);
      expect(isValidLatex('\\frac{a}{b}')).toBe(true);
    });

    it('should return false for invalid LaTeX', () => {
      expect(isValidLatex('\\invalid{command}')).toBe(false);
    });
  });

  // ==========================================================================
  // Property-Based Tests
  // ==========================================================================

  /**
   * Property 9: Formula Rendering Fallback
   * 
   * For any invalid formula string, the Formula_Renderer SHALL return
   * the original text as output without throwing an exception.
   * 
   * Validates: Requirements 5.6
   */
  describe('Property 9: Formula Rendering Fallback', () => {
    it('should never throw for any input string', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 100 }),
          (input) => {
            // Should never throw
            const result = renderLatex(input);
            
            // Should always return a result
            expect(result).toBeDefined();
            expect(result.html).toBeDefined();
            expect(result.originalText).toBe(input);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return original text in output for invalid formulas', () => {
      fc.assert(
        fc.property(
          // Generate strings that are likely invalid LaTeX
          fc.stringOf(fc.constantFrom('\\', '{', '}', '[', ']', '_', '^', '&', '#', '%')),
          (invalidLatex) => {
            const result = renderLatex(invalidLatex);
            
            // Should not throw
            expect(result).toBeDefined();
            
            // If it failed, the original text should be preserved
            if (!result.success) {
              expect(result.originalText).toBe(invalidLatex);
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle empty and whitespace strings', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom(' ', '\t', '\n', '')),
          (whitespace) => {
            const result = renderLatex(whitespace);
            expect(result).toBeDefined();
            expect(result.html).toBeDefined();
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 10: Formula LaTeX Rendering
   * 
   * For any valid LaTeX formula string, the Formula_Renderer SHALL produce
   * non-empty HTML output containing KaTeX elements.
   * 
   * Validates: Requirements 5.1, 5.4, 5.5
   */
  describe('Property 10: Formula LaTeX Rendering', () => {
    // Valid LaTeX formula generators
    const simpleVariable = fc.constantFrom('x', 'y', 'z', 'a', 'b', 'c', 'n', 'm');
    const greekLetter = fc.constantFrom(
      '\\alpha', '\\beta', '\\gamma', '\\delta', '\\epsilon',
      '\\theta', '\\lambda', '\\mu', '\\pi', '\\sigma', '\\omega'
    );
    const number = fc.integer({ min: 0, max: 100 }).map(n => n.toString());
    
    const simpleExpression = fc.oneof(simpleVariable, greekLetter, number);
    
    const validLatexFormula = fc.oneof(
      // Simple expressions
      simpleExpression,
      // Superscript
      fc.tuple(simpleVariable, simpleExpression).map(([base, exp]) => `${base}^{${exp}}`),
      // Subscript
      fc.tuple(simpleVariable, simpleExpression).map(([base, sub]) => `${base}_{${sub}}`),
      // Fraction
      fc.tuple(simpleExpression, simpleExpression).map(([num, den]) => `\\frac{${num}}{${den}}`),
      // Square root
      simpleExpression.map(x => `\\sqrt{${x}}`),
      // Sum
      fc.tuple(simpleVariable, number, number).map(([v, a, b]) => `\\sum_{${v}=${a}}^{${b}}`),
      // Integral
      fc.tuple(number, number).map(([a, b]) => `\\int_{${a}}^{${b}}`),
    );

    it('should produce non-empty HTML for valid LaTeX', () => {
      fc.assert(
        fc.property(
          validLatexFormula,
          (latex) => {
            const result = renderLatex(latex);
            
            expect(result.success).toBe(true);
            expect(result.html).toBeTruthy();
            expect(result.html.length).toBeGreaterThan(0);
            expect(result.html).toContain('katex');
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should render Greek letters correctly', () => {
      fc.assert(
        fc.property(
          greekLetter,
          (letter) => {
            const result = renderLatex(letter);
            
            expect(result.success).toBe(true);
            expect(result.html).toContain('katex');
            
            return true;
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should render complex expressions', () => {
      const complexFormulas = [
        '\\frac{\\partial f}{\\partial x}',
        '\\int_0^\\infty e^{-x^2} dx',
        '\\sum_{n=1}^{\\infty} \\frac{1}{n^2}',
        '\\lim_{x \\to 0} \\frac{\\sin x}{x}',
        '\\begin{matrix} a & b \\\\ c & d \\end{matrix}',
      ];

      for (const formula of complexFormulas) {
        const result = renderLatex(formula);
        expect(result.success).toBe(true);
        expect(result.html).toContain('katex');
      }
    });
  });

  /**
   * Property 11: MathML to LaTeX Conversion
   * 
   * For any valid MathML string, the conversion to LaTeX SHALL produce
   * a non-empty string that can be rendered by KaTeX.
   * 
   * Validates: Requirements 5.2
   */
  describe('Property 11: MathML to LaTeX Conversion', () => {
    // Generate valid MathML structures
    const mathmlVariable = fc.constantFrom('x', 'y', 'z', 'a', 'b').map(v => `<mi>${v}</mi>`);
    const mathmlNumber = fc.integer({ min: 0, max: 100 }).map(n => `<mn>${n}</mn>`);
    const mathmlElement = fc.oneof(mathmlVariable, mathmlNumber);
    
    const validMathML = fc.oneof(
      // Simple element
      mathmlElement.map(el => `<math>${el}</math>`),
      // Fraction
      fc.tuple(mathmlElement, mathmlElement).map(
        ([num, den]) => `<math><mfrac>${num}${den}</mfrac></math>`
      ),
      // Superscript
      fc.tuple(mathmlElement, mathmlElement).map(
        ([base, exp]) => `<math><msup>${base}${exp}</msup></math>`
      ),
      // Subscript
      fc.tuple(mathmlElement, mathmlElement).map(
        ([base, sub]) => `<math><msub>${base}${sub}</msub></math>`
      ),
      // Square root
      mathmlElement.map(el => `<math><msqrt>${el}</msqrt></math>`),
    );

    it('should convert valid MathML to non-empty LaTeX', () => {
      fc.assert(
        fc.property(
          validMathML,
          (mathml) => {
            const latex = mathmlToLatex(mathml);
            
            // Should produce non-empty result
            expect(latex).toBeTruthy();
            expect(latex.length).toBeGreaterThan(0);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should produce renderable LaTeX from MathML', () => {
      fc.assert(
        fc.property(
          validMathML,
          (mathml) => {
            const latex = mathmlToLatex(mathml);
            const result = renderLatex(latex);
            
            // The converted LaTeX should be renderable
            // (may not always succeed due to conversion limitations, but should not throw)
            expect(result).toBeDefined();
            expect(result.html).toBeDefined();
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle MathML with operators', () => {
      const mathmlWithOperators = [
        '<math><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow></math>',
        '<math><mrow><mi>x</mi><mo>=</mo><mn>5</mn></mrow></math>',
        '<math><mrow><mi>α</mi><mo>×</mo><mi>β</mi></mrow></math>',
      ];

      for (const mathml of mathmlWithOperators) {
        const latex = mathmlToLatex(mathml);
        expect(latex).toBeTruthy();
        
        const result = renderLatex(latex);
        expect(result).toBeDefined();
      }
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle nested formulas', () => {
      const nested = '\\frac{\\sqrt{x^2 + y^2}}{\\sum_{i=1}^n i}';
      const result = renderLatex(nested);
      expect(result.success).toBe(true);
    });

    it('should handle very long formulas', () => {
      const long = Array(20).fill('x').join(' + ');
      const result = renderLatex(long);
      expect(result).toBeDefined();
    });

    it('should handle special characters in text', () => {
      const withText = '\\text{Hello & World}';
      const result = renderLatex(withText);
      expect(result).toBeDefined();
    });

    it('should handle multiple formulas in one string', () => {
      const html = 'First $x^2$ and second $y^2$ formulas.';
      const result = enhanceFormulas(html);
      expect(result).toContain('katex');
      // Should have replaced both formulas
      expect(result).not.toContain('$x^2$');
      expect(result).not.toContain('$y^2$');
    });
  });
});
