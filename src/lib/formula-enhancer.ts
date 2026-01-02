/**
 * Formula Enhancer Module
 * 
 * Provides formula detection and rendering for PowerPoint slides:
 * - LaTeX formula rendering using KaTeX
 * - MathML to LaTeX conversion
 * - Office Math (OMML) detection and conversion
 * - Error handling with fallback to original text
 */

import katex from 'katex';
import { FormulaResult, FormulaEnhancerConfig } from '../types/ppt-viewer';

/**
 * Default configuration for formula enhancer
 */
export const DEFAULT_FORMULA_CONFIG: FormulaEnhancerConfig = {
  enableLatex: true,
  enableMathML: true,
  enableOMML: true,
  fallbackOnError: true,
};

/**
 * Regex patterns for formula detection
 */
const FORMULA_PATTERNS = {
  // LaTeX inline: $...$
  LATEX_INLINE: /\$([^$]+)\$/g,
  // LaTeX display: $$...$$
  LATEX_DISPLAY: /\$\$([^$]+)\$\$/g,
  // LaTeX \(...\) inline
  LATEX_PAREN_INLINE: /\\\((.+?)\\\)/g,
  // LaTeX \[...\] display
  LATEX_BRACKET_DISPLAY: /\\\[(.+?)\\\]/g,
  // MathML detection
  MATHML: /<math[^>]*>[\s\S]*?<\/math>/gi,
  // Office Math (OMML) detection
  OMML: /<m:oMath[^>]*>[\s\S]*?<\/m:oMath>/gi,
};

/**
 * Render a LaTeX formula to HTML using KaTeX
 * 
 * @param latex - LaTeX formula string
 * @param displayMode - Whether to render in display mode (block) or inline
 * @returns FormulaResult with rendered HTML or error
 */
export function renderLatex(
  latex: string,
  displayMode: boolean = false
): FormulaResult {
  try {
    const html = katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      errorColor: '#cc0000',
      strict: false,
      trust: true,
      macros: {
        // Common macros
        '\\R': '\\mathbb{R}',
        '\\N': '\\mathbb{N}',
        '\\Z': '\\mathbb{Z}',
        '\\Q': '\\mathbb{Q}',
        '\\C': '\\mathbb{C}',
      },
    });
    
    return {
      success: true,
      html,
      originalText: latex,
    };
  } catch (error) {
    return {
      success: false,
      html: `<span class="formula-error" title="Formula error">${escapeHtml(latex)}</span>`,
      originalText: latex,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Convert MathML to LaTeX
 * 
 * This is a simplified converter that handles common MathML elements.
 * For complex formulas, consider using a dedicated library.
 * 
 * @param mathml - MathML string
 * @returns LaTeX string
 */
export function mathmlToLatex(mathml: string): string {
  try {
    // Parse MathML
    const parser = new DOMParser();
    const doc = parser.parseFromString(mathml, 'application/xml');
    const mathElement = doc.querySelector('math');
    
    if (!mathElement) {
      return mathml; // Return original if not valid MathML
    }
    
    return convertMathMLNode(mathElement);
  } catch {
    return mathml; // Return original on error
  }
}

/**
 * Recursively convert MathML node to LaTeX
 */
function convertMathMLNode(node: Element): string {
  const tagName = node.tagName.toLowerCase().replace('m:', '');
  const children = Array.from(node.children);
  
  switch (tagName) {
    case 'math':
      return children.map(convertMathMLNode).join('');
    
    case 'mrow':
      return children.map(convertMathMLNode).join('');
    
    case 'mi': // Identifier
      return node.textContent || '';
    
    case 'mn': // Number
      return node.textContent || '';
    
    case 'mo': // Operator
      return convertOperator(node.textContent || '');
    
    case 'mtext': // Text
      return `\\text{${node.textContent || ''}}`;
    
    case 'mfrac': // Fraction
      if (children.length >= 2) {
        return `\\frac{${convertMathMLNode(children[0])}}{${convertMathMLNode(children[1])}}`;
      }
      return '';
    
    case 'msqrt': // Square root
      return `\\sqrt{${children.map(convertMathMLNode).join('')}}`;
    
    case 'mroot': // nth root
      if (children.length >= 2) {
        return `\\sqrt[${convertMathMLNode(children[1])}]{${convertMathMLNode(children[0])}}`;
      }
      return '';
    
    case 'msup': // Superscript
      if (children.length >= 2) {
        return `{${convertMathMLNode(children[0])}}^{${convertMathMLNode(children[1])}}`;
      }
      return '';
    
    case 'msub': // Subscript
      if (children.length >= 2) {
        return `{${convertMathMLNode(children[0])}}_{${convertMathMLNode(children[1])}}`;
      }
      return '';
    
    case 'msubsup': // Subscript and superscript
      if (children.length >= 3) {
        return `{${convertMathMLNode(children[0])}}_{${convertMathMLNode(children[1])}}^{${convertMathMLNode(children[2])}}`;
      }
      return '';
    
    case 'mover': // Over
      if (children.length >= 2) {
        const base = convertMathMLNode(children[0]);
        const over = convertMathMLNode(children[1]);
        if (over === '¯' || over === '‾') return `\\overline{${base}}`;
        if (over === '→') return `\\vec{${base}}`;
        if (over === '^' || over === '̂') return `\\hat{${base}}`;
        return `\\overset{${over}}{${base}}`;
      }
      return '';
    
    case 'munder': // Under
      if (children.length >= 2) {
        return `\\underset{${convertMathMLNode(children[1])}}{${convertMathMLNode(children[0])}}`;
      }
      return '';
    
    case 'munderover': // Under and over
      if (children.length >= 3) {
        return `\\underset{${convertMathMLNode(children[1])}}{\\overset{${convertMathMLNode(children[2])}}{${convertMathMLNode(children[0])}}}`;
      }
      return '';
    
    case 'mtable': // Table/Matrix
      const rows = children.filter(c => c.tagName.toLowerCase() === 'mtr' || c.tagName.toLowerCase() === 'm:mtr');
      const matrixContent = rows.map(row => {
        const cells = Array.from(row.children).filter(c => 
          c.tagName.toLowerCase() === 'mtd' || c.tagName.toLowerCase() === 'm:mtd'
        );
        return cells.map(cell => convertMathMLNode(cell)).join(' & ');
      }).join(' \\\\ ');
      return `\\begin{matrix} ${matrixContent} \\end{matrix}`;
    
    case 'mtr': // Table row
      return children.map(convertMathMLNode).join(' & ');
    
    case 'mtd': // Table cell
      return children.map(convertMathMLNode).join('');
    
    case 'mspace': // Space
      return '\\;';
    
    case 'mfenced': // Fenced (parentheses, brackets, etc.)
      const open = node.getAttribute('open') || '(';
      const close = node.getAttribute('close') || ')';
      const content = children.map(convertMathMLNode).join(',');
      return `\\left${convertBracket(open)}${content}\\right${convertBracket(close)}`;
    
    case 'menclose': // Enclosure
      const notation = node.getAttribute('notation') || '';
      const enclosed = children.map(convertMathMLNode).join('');
      if (notation.includes('box')) return `\\boxed{${enclosed}}`;
      if (notation.includes('circle')) return `\\circled{${enclosed}}`;
      return enclosed;
    
    case 'semantics':
      // Return first child (presentation MathML)
      if (children.length > 0) {
        return convertMathMLNode(children[0]);
      }
      return '';
    
    case 'annotation':
    case 'annotation-xml':
      // Skip annotations
      return '';
    
    default:
      // For unknown elements, try to convert children
      return children.map(convertMathMLNode).join('');
  }
}

/**
 * Convert MathML operator to LaTeX
 */
function convertOperator(op: string): string {
  const operatorMap: Record<string, string> = {
    '+': '+',
    '-': '-',
    '−': '-',
    '×': '\\times',
    '÷': '\\div',
    '·': '\\cdot',
    '∗': '*',
    '=': '=',
    '≠': '\\neq',
    '<': '<',
    '>': '>',
    '≤': '\\leq',
    '≥': '\\geq',
    '≪': '\\ll',
    '≫': '\\gg',
    '≈': '\\approx',
    '≡': '\\equiv',
    '∈': '\\in',
    '∉': '\\notin',
    '⊂': '\\subset',
    '⊃': '\\supset',
    '⊆': '\\subseteq',
    '⊇': '\\supseteq',
    '∪': '\\cup',
    '∩': '\\cap',
    '∧': '\\land',
    '∨': '\\lor',
    '¬': '\\neg',
    '→': '\\rightarrow',
    '←': '\\leftarrow',
    '↔': '\\leftrightarrow',
    '⇒': '\\Rightarrow',
    '⇐': '\\Leftarrow',
    '⇔': '\\Leftrightarrow',
    '∀': '\\forall',
    '∃': '\\exists',
    '∄': '\\nexists',
    '∞': '\\infty',
    '∂': '\\partial',
    '∇': '\\nabla',
    '∫': '\\int',
    '∬': '\\iint',
    '∭': '\\iiint',
    '∮': '\\oint',
    '∑': '\\sum',
    '∏': '\\prod',
    '√': '\\sqrt',
    '±': '\\pm',
    '∓': '\\mp',
    '°': '^\\circ',
    '′': "'",
    '″': "''",
    '‴': "'''",
    '(': '(',
    ')': ')',
    '[': '[',
    ']': ']',
    '{': '\\{',
    '}': '\\}',
    '|': '|',
    '‖': '\\|',
    ',': ',',
    ';': ';',
    ':': ':',
    '!': '!',
    // Greek letters
    'α': '\\alpha',
    'β': '\\beta',
    'γ': '\\gamma',
    'δ': '\\delta',
    'ε': '\\epsilon',
    'ζ': '\\zeta',
    'η': '\\eta',
    'θ': '\\theta',
    'ι': '\\iota',
    'κ': '\\kappa',
    'λ': '\\lambda',
    'μ': '\\mu',
    'ν': '\\nu',
    'ξ': '\\xi',
    'π': '\\pi',
    'ρ': '\\rho',
    'σ': '\\sigma',
    'τ': '\\tau',
    'υ': '\\upsilon',
    'φ': '\\phi',
    'χ': '\\chi',
    'ψ': '\\psi',
    'ω': '\\omega',
    'Γ': '\\Gamma',
    'Δ': '\\Delta',
    'Θ': '\\Theta',
    'Λ': '\\Lambda',
    'Ξ': '\\Xi',
    'Π': '\\Pi',
    'Σ': '\\Sigma',
    'Φ': '\\Phi',
    'Ψ': '\\Psi',
    'Ω': '\\Omega',
  };
  
  return operatorMap[op] || op;
}

/**
 * Convert bracket character to LaTeX
 */
function convertBracket(bracket: string): string {
  const bracketMap: Record<string, string> = {
    '(': '(',
    ')': ')',
    '[': '[',
    ']': ']',
    '{': '\\{',
    '}': '\\}',
    '|': '|',
    '‖': '\\|',
    '⟨': '\\langle',
    '⟩': '\\rangle',
    '⌈': '\\lceil',
    '⌉': '\\rceil',
    '⌊': '\\lfloor',
    '⌋': '\\rfloor',
  };
  
  return bracketMap[bracket] || bracket;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  
  return text.replace(/[&<>"']/g, char => htmlEntities[char] || char);
}

/**
 * Render MathML to HTML
 * 
 * @param mathml - MathML string
 * @returns FormulaResult with rendered HTML
 */
export function renderMathML(mathml: string): FormulaResult {
  try {
    const latex = mathmlToLatex(mathml);
    return renderLatex(latex, true);
  } catch (error) {
    return {
      success: false,
      html: `<span class="formula-error">${escapeHtml(mathml)}</span>`,
      originalText: mathml,
      errorMessage: error instanceof Error ? error.message : 'MathML conversion error',
    };
  }
}

/**
 * Detect and render all formulas in HTML content
 * 
 * @param html - HTML content that may contain formulas
 * @param config - Formula enhancer configuration
 * @returns Enhanced HTML with rendered formulas
 */
export function enhanceFormulas(
  html: string,
  config: FormulaEnhancerConfig = DEFAULT_FORMULA_CONFIG
): string {
  let result = html;
  
  // Process MathML first (before other replacements might break it)
  if (config.enableMathML) {
    result = result.replace(FORMULA_PATTERNS.MATHML, (match) => {
      const rendered = renderMathML(match);
      return rendered.html;
    });
  }
  
  // Process OMML (Office Math)
  if (config.enableOMML) {
    result = result.replace(FORMULA_PATTERNS.OMML, (match) => {
      // OMML is similar to MathML, try to convert
      const rendered = renderMathML(match);
      return rendered.html;
    });
  }
  
  if (config.enableLatex) {
    // Process display LaTeX ($$...$$) first
    result = result.replace(FORMULA_PATTERNS.LATEX_DISPLAY, (_, latex) => {
      const rendered = renderLatex(latex.trim(), true);
      return rendered.html;
    });
    
    // Process \[...\] display
    result = result.replace(FORMULA_PATTERNS.LATEX_BRACKET_DISPLAY, (_, latex) => {
      const rendered = renderLatex(latex.trim(), true);
      return rendered.html;
    });
    
    // Process inline LaTeX ($...$)
    result = result.replace(FORMULA_PATTERNS.LATEX_INLINE, (_, latex) => {
      const rendered = renderLatex(latex.trim(), false);
      return rendered.html;
    });
    
    // Process \(...\) inline
    result = result.replace(FORMULA_PATTERNS.LATEX_PAREN_INLINE, (_, latex) => {
      const rendered = renderLatex(latex.trim(), false);
      return rendered.html;
    });
  }
  
  return result;
}

/**
 * Check if a string contains any formula patterns
 * 
 * @param text - Text to check
 * @returns Whether the text contains formulas
 */
export function containsFormulas(text: string): boolean {
  return (
    FORMULA_PATTERNS.LATEX_INLINE.test(text) ||
    FORMULA_PATTERNS.LATEX_DISPLAY.test(text) ||
    FORMULA_PATTERNS.LATEX_PAREN_INLINE.test(text) ||
    FORMULA_PATTERNS.LATEX_BRACKET_DISPLAY.test(text) ||
    FORMULA_PATTERNS.MATHML.test(text) ||
    FORMULA_PATTERNS.OMML.test(text)
  );
}

/**
 * Validate if a LaTeX string is valid
 * 
 * @param latex - LaTeX string to validate
 * @returns Whether the LaTeX is valid
 */
export function isValidLatex(latex: string): boolean {
  try {
    katex.renderToString(latex, { throwOnError: true });
    return true;
  } catch {
    return false;
  }
}
