/**
 * Formula Converter Module
 * 
 * Provides conversion utilities for mathematical formulas:
 * - OMML (Office Math Markup Language) to LaTeX
 * - MathML to LaTeX
 * - LaTeX detection in text
 * - KaTeX rendering with fallback
 */

import katex from 'katex';

// ============================================================================
// OMML to LaTeX Conversion
// ============================================================================

/**
 * Greek letter mapping (lowercase and uppercase)
 * Includes both regular Greek letters and Unicode Mathematical Italic variants
 */
const GREEK_LETTERS: Record<string, string> = {
  // Lowercase (regular)
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta',
  'ε': '\\epsilon', 'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta',
  'ι': '\\iota', 'κ': '\\kappa', 'λ': '\\lambda', 'μ': '\\mu',
  'ν': '\\nu', 'ξ': '\\xi', 'ο': 'o', 'π': '\\pi',
  'ρ': '\\rho', 'σ': '\\sigma', 'τ': '\\tau', 'υ': '\\upsilon',
  'φ': '\\phi', 'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega',
  'ϵ': '\\varepsilon', 'ϑ': '\\vartheta', 'ϕ': '\\varphi',
  'ϱ': '\\varrho', 'ς': '\\varsigma',
  // Uppercase (regular)
  'Α': 'A', 'Β': 'B', 'Γ': '\\Gamma', 'Δ': '\\Delta',
  'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Θ': '\\Theta',
  'Ι': 'I', 'Κ': 'K', 'Λ': '\\Lambda', 'Μ': 'M',
  'Ν': 'N', 'Ξ': '\\Xi', 'Ο': 'O', 'Π': '\\Pi',
  'Ρ': 'P', 'Σ': '\\Sigma', 'Τ': 'T', 'Υ': '\\Upsilon',
  'Φ': '\\Phi', 'Χ': 'X', 'Ψ': '\\Psi', 'Ω': '\\Omega',
  // Mathematical Italic Greek (U+1D6FC - U+1D71B) - these appear in PPTX formulas
  '𝛼': '\\alpha', '𝛽': '\\beta', '𝛾': '\\gamma', '𝛿': '\\delta',
  '𝜀': '\\epsilon', '𝜁': '\\zeta', '𝜂': '\\eta', '𝜃': '\\theta',
  '𝜄': '\\iota', '𝜅': '\\kappa', '𝜆': '\\lambda', '𝜇': '\\mu',
  '𝜈': '\\nu', '𝜉': '\\xi', '𝜊': 'o', '𝜋': '\\pi',
  '𝜌': '\\rho', '𝜍': '\\varsigma', '𝜎': '\\sigma', '𝜏': '\\tau',
  '𝜐': '\\upsilon', '𝜑': '\\phi', '𝜒': '\\chi', '𝜓': '\\psi', '𝜔': '\\omega',
  '𝜕': '\\partial', '𝜖': '\\varepsilon', '𝜗': '\\vartheta', '𝜘': '\\varkappa',
  '𝜙': '\\varphi', '𝜚': '\\varrho', '𝜛': '\\varpi',
  // Mathematical Italic Uppercase Greek
  '𝛢': 'A', '𝛣': 'B', '𝛤': '\\Gamma', '𝛥': '\\Delta',
  '𝛦': 'E', '𝛧': 'Z', '𝛨': 'H', '𝛩': '\\Theta',
  '𝛪': 'I', '𝛫': 'K', '𝛬': '\\Lambda', '𝛭': 'M',
  '𝛮': 'N', '𝛯': '\\Xi', '𝛰': 'O', '𝛱': '\\Pi',
  '𝛲': 'P', '𝛳': '\\Theta', '𝛴': '\\Sigma', '𝛵': 'T',
  '𝛶': '\\Upsilon', '𝛷': '\\Phi', '𝛸': 'X', '𝛹': '\\Psi', '𝛺': '\\Omega',
  // Mathematical Bold Greek (U+1D6A8 - U+1D6E1)
  '𝚨': '\\mathbf{A}', '𝚩': '\\mathbf{B}', '𝚪': '\\boldsymbol{\\Gamma}', '𝚫': '\\boldsymbol{\\Delta}',
  '𝚬': '\\mathbf{E}', '𝚭': '\\mathbf{Z}', '𝚮': '\\mathbf{H}', '𝚯': '\\boldsymbol{\\Theta}',
  '𝚰': '\\mathbf{I}', '𝚱': '\\mathbf{K}', '𝚲': '\\boldsymbol{\\Lambda}', '𝚳': '\\mathbf{M}',
  '𝚴': '\\mathbf{N}', '𝚵': '\\boldsymbol{\\Xi}', '𝚶': '\\mathbf{O}', '𝚷': '\\boldsymbol{\\Pi}',
  '𝚸': '\\mathbf{P}', '𝚹': '\\boldsymbol{\\Theta}', '𝚺': '\\boldsymbol{\\Sigma}', '𝚻': '\\mathbf{T}',
  '𝚼': '\\boldsymbol{\\Upsilon}', '𝚽': '\\boldsymbol{\\Phi}', '𝚾': '\\mathbf{X}', '𝚿': '\\boldsymbol{\\Psi}', '𝛀': '\\boldsymbol{\\Omega}',
  // Mathematical Bold lowercase Greek
  '𝛂': '\\boldsymbol{\\alpha}', '𝛃': '\\boldsymbol{\\beta}', '𝛄': '\\boldsymbol{\\gamma}', '𝛅': '\\boldsymbol{\\delta}',
  '𝛆': '\\boldsymbol{\\epsilon}', '𝛇': '\\boldsymbol{\\zeta}', '𝛈': '\\boldsymbol{\\eta}', '𝛉': '\\boldsymbol{\\theta}',
  '𝛊': '\\boldsymbol{\\iota}', '𝛋': '\\boldsymbol{\\kappa}', '𝛌': '\\boldsymbol{\\lambda}', '𝛍': '\\boldsymbol{\\mu}',
  '𝛎': '\\boldsymbol{\\nu}', '𝛏': '\\boldsymbol{\\xi}', '𝛐': 'o', '𝛑': '\\boldsymbol{\\pi}',
  '𝛒': '\\boldsymbol{\\rho}', '𝛓': '\\boldsymbol{\\varsigma}', '𝛔': '\\boldsymbol{\\sigma}', '𝛕': '\\boldsymbol{\\tau}',
  '𝛖': '\\boldsymbol{\\upsilon}', '𝛗': '\\boldsymbol{\\phi}', '𝛘': '\\boldsymbol{\\chi}', '𝛙': '\\boldsymbol{\\psi}', '𝛚': '\\boldsymbol{\\omega}',
};

/**
 * Mathematical operators and symbols mapping
 * Includes Unicode mathematical symbols that appear in PPTX/OMML formulas
 */
const MATH_SYMBOLS: Record<string, string> = {
  // Operators
  '∑': '\\sum', '∏': '\\prod', '∐': '\\coprod',
  '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint',
  '∯': '\\oiint', '∰': '\\oiiint',
  '∂': '\\partial', '∇': '\\nabla', '√': '\\sqrt',
  '∞': '\\infty', '±': '\\pm', '∓': '\\mp',
  '×': '\\times', '÷': '\\div', '·': '\\cdot', '∘': '\\circ',
  '⊕': '\\oplus', '⊗': '\\otimes', '⊖': '\\ominus',
  '†': '\\dagger', '‡': '\\ddagger', '★': '\\star',
  '∗': '\\ast', '⋆': '\\star',
  // Relations
  '≤': '\\leq', '≥': '\\geq', '≠': '\\neq', '≈': '\\approx',
  '≡': '\\equiv', '≅': '\\cong', '∼': '\\sim', '≃': '\\simeq',
  '∝': '\\propto', '≪': '\\ll', '≫': '\\gg',
  '≺': '\\prec', '≻': '\\succ', '⊥': '\\perp', '∥': '\\parallel',
  '≲': '\\lesssim', '≳': '\\gtrsim',
  // Set theory
  '∈': '\\in', '∉': '\\notin', '∋': '\\ni', '∌': '\\notni',
  '⊂': '\\subset', '⊃': '\\supset', '⊆': '\\subseteq', '⊇': '\\supseteq',
  '⊄': '\\not\\subset', '⊅': '\\not\\supset',
  '∪': '\\cup', '∩': '\\cap', '∅': '\\emptyset', '∖': '\\setminus',
  // Logic
  '∀': '\\forall', '∃': '\\exists', '∄': '\\nexists',
  '¬': '\\neg', '∧': '\\land', '∨': '\\lor',
  '⊢': '\\vdash', '⊨': '\\models', '⊤': '\\top', '⟂': '\\bot',
  // Arrows
  '→': '\\rightarrow', '←': '\\leftarrow', '↔': '\\leftrightarrow',
  '⇒': '\\Rightarrow', '⇐': '\\Leftarrow', '⇔': '\\Leftrightarrow',
  '↦': '\\mapsto', '↑': '\\uparrow', '↓': '\\downarrow',
  '⇑': '\\Uparrow', '⇓': '\\Downarrow', '↗': '\\nearrow', '↘': '\\searrow',
  '⟶': '\\longrightarrow', '⟵': '\\longleftarrow',
  '⟹': '\\Longrightarrow', '⟸': '\\Longleftarrow',
  // Misc
  '…': '\\ldots', '⋯': '\\cdots', '⋮': '\\vdots', '⋱': '\\ddots',
  '′': "'", '″': "''", '‴': "'''",
  '°': '^\\circ', '℃': '^\\circ\\text{C}', '℉': '^\\circ\\text{F}',
  'ℏ': '\\hbar', 'ℓ': '\\ell', '℘': '\\wp', 'ℜ': '\\Re', 'ℑ': '\\Im',
  'ℵ': '\\aleph', 'ℶ': '\\beth',
  // Additional physics/math symbols
  '⟨': '\\langle', '⟩': '\\rangle',
  '〈': '\\langle', '〉': '\\rangle',
  '⌊': '\\lfloor', '⌋': '\\rfloor',
  '⌈': '\\lceil', '⌉': '\\rceil',
  '‖': '\\|',
  '△': '\\triangle', '▽': '\\triangledown',
  '∆': '\\Delta', // INCREMENT symbol (U+2206) - commonly used in PPTX
  '□': '\\square', '◇': '\\diamond',
  '⊙': '\\odot', '⊘': '\\oslash',
  '∠': '\\angle', '∡': '\\measuredangle',
  '⊳': '\\triangleright', '⊲': '\\triangleleft',
  // Differential operators
  'ⅆ': '\\mathrm{d}', 'ⅇ': '\\mathrm{e}', 'ⅈ': '\\mathrm{i}',
  // Common text operators that might appear
  '−': '-', // Minus sign (different from hyphen)
  '–': '-', // En dash
  '—': '-', // Em dash
  // Mathematical Italic letters (U+1D400 range) - common in PPTX
  '𝑎': 'a', '𝑏': 'b', '𝑐': 'c', '𝑑': 'd', '𝑒': 'e', '𝑓': 'f', '𝑔': 'g',
  '𝑕': 'h', '𝑖': 'i', '𝑗': 'j', '𝑘': 'k', '𝑙': 'l', '𝑚': 'm', '𝑛': 'n',
  '𝑜': 'o', '𝑝': 'p', '𝑞': 'q', '𝑟': 'r', '𝑠': 's', '𝑡': 't', '𝑢': 'u',
  '𝑣': 'v', '𝑤': 'w', '𝑥': 'x', '𝑦': 'y', '𝑧': 'z',
  '𝐴': 'A', '𝐵': 'B', '𝐶': 'C', '𝐷': 'D', '𝐸': 'E', '𝐹': 'F', '𝐺': 'G',
  '𝐻': 'H', '𝐼': 'I', '𝐽': 'J', '𝐾': 'K', '𝐿': 'L', '𝑀': 'M', '𝑁': 'N',
  '𝑂': 'O', '𝑃': 'P', '𝑄': 'Q', '𝑅': 'R', '𝑆': 'S', '𝑇': 'T', '𝑈': 'U',
  '𝑉': 'V', '𝑊': 'W', '𝑋': 'X', '𝑌': 'Y', '𝑍': 'Z',
  // Mathematical double-struck (blackboard bold)
  'ℕ': '\\mathbb{N}', 'ℤ': '\\mathbb{Z}', 'ℚ': '\\mathbb{Q}',
  'ℝ': '\\mathbb{R}', 'ℂ': '\\mathbb{C}', 'ℙ': '\\mathbb{P}',
  '𝔸': '\\mathbb{A}', '𝔹': '\\mathbb{B}', '𝔻': '\\mathbb{D}',
  '𝔼': '\\mathbb{E}', '𝔽': '\\mathbb{F}', '𝔾': '\\mathbb{G}',
  'ℍ': '\\mathbb{H}', '𝕀': '\\mathbb{I}', '𝕁': '\\mathbb{J}',
  '𝕂': '\\mathbb{K}', '𝕃': '\\mathbb{L}', '𝕄': '\\mathbb{M}',
  '𝕆': '\\mathbb{O}', '𝕊': '\\mathbb{S}', '𝕋': '\\mathbb{T}',
  '𝕌': '\\mathbb{U}', '𝕍': '\\mathbb{V}', '𝕎': '\\mathbb{W}',
  '𝕏': '\\mathbb{X}', '𝕐': '\\mathbb{Y}',
};

/**
 * Bracket mappings for OMML
 */
const BRACKET_MAP: Record<string, [string, string]> = {
  '(': ['(', ')'],
  ')': ['(', ')'],
  '[': ['[', ']'],
  ']': ['[', ']'],
  '{': ['\\{', '\\}'],
  '}': ['\\{', '\\}'],
  '|': ['|', '|'],
  '‖': ['\\|', '\\|'],
  '⌈': ['\\lceil', '\\rceil'],
  '⌉': ['\\lceil', '\\rceil'],
  '⌊': ['\\lfloor', '\\rfloor'],
  '⌋': ['\\lfloor', '\\rfloor'],
  '⟨': ['\\langle', '\\rangle'],
  '⟩': ['\\langle', '\\rangle'],
  '〈': ['\\langle', '\\rangle'],
  '〉': ['\\langle', '\\rangle'],
  // Additional bracket types
  '': ['', ''], // Empty brackets (invisible)
  ' ': ['', ''], // Space (invisible)
};

/**
 * Accent mappings for OMML
 */
const ACCENT_MAP: Record<string, string> = {
  '̂': '\\hat',      // combining circumflex
  '̃': '\\tilde',    // combining tilde
  '̄': '\\bar',      // combining macron
  '̇': '\\dot',      // combining dot above
  '̈': '\\ddot',     // combining diaeresis
  '⃗': '\\vec',      // combining right arrow above
  '̆': '\\breve',    // combining breve
  '̌': '\\check',    // combining caron
  'ˆ': '\\hat',
  '˜': '\\tilde',
  '¯': '\\bar',
  '˙': '\\dot',
  '¨': '\\ddot',
  '→': '\\vec',
};

/**
 * Function name mappings
 */
const FUNCTION_NAMES: Record<string, string> = {
  'sin': '\\sin', 'cos': '\\cos', 'tan': '\\tan',
  'sec': '\\sec', 'csc': '\\csc', 'cot': '\\cot',
  'arcsin': '\\arcsin', 'arccos': '\\arccos', 'arctan': '\\arctan',
  'sinh': '\\sinh', 'cosh': '\\cosh', 'tanh': '\\tanh',
  'log': '\\log', 'ln': '\\ln', 'lg': '\\lg',
  'exp': '\\exp', 'lim': '\\lim', 'max': '\\max', 'min': '\\min',
  'sup': '\\sup', 'inf': '\\inf', 'det': '\\det', 'dim': '\\dim',
  'ker': '\\ker', 'hom': '\\hom', 'arg': '\\arg', 'deg': '\\deg',
  'gcd': '\\gcd', 'lcm': '\\operatorname{lcm}',
  'Pr': '\\Pr', 'mod': '\\mod',
};

/**
 * Convert a single character to LaTeX if it's a special symbol
 */
export function convertCharToLatex(char: string): string {
  if (GREEK_LETTERS[char]) return GREEK_LETTERS[char];
  if (MATH_SYMBOLS[char]) return MATH_SYMBOLS[char];
  return char;
}

/**
 * Convert text with special characters to LaTeX
 */
export function convertTextToLatex(text: string): string {
  let result = '';
  for (const char of text) {
    result += convertCharToLatex(char);
  }
  return result;
}


/**
 * Parse OMML XML and convert to LaTeX
 * 
 * OMML (Office Math Markup Language) is used in Microsoft Office documents.
 * This parser handles the most common OMML elements.
 */
export function convertOmmlToLatex(ommlXml: string): string {
  try {
    // Pre-process: normalize namespace prefixes for easier parsing
    // Handle various namespace formats: m:, a14:m, mc:, etc.
    let cleanedXml = ommlXml
      // Remove all namespace declarations
      .replace(/xmlns:[a-zA-Z0-9]+="[^"]*"/g, '')
      .replace(/xmlns="[^"]*"/g, '')
      // CRITICAL: Remove namespace prefixes from ATTRIBUTES first (e.g., m:val -> val)
      // This fixes the "Namespace prefix m for val on degHide is not defined" error
      .replace(/\s([a-zA-Z0-9]+):([a-zA-Z0-9]+)=/g, ' $2=')
      // Normalize namespace prefixes to no prefix for elements
      .replace(/<m:/g, '<')
      .replace(/<\/m:/g, '</')
      .replace(/<a14:/g, '<')
      .replace(/<\/a14:/g, '</')
      .replace(/<mc:/g, '<')
      .replace(/<\/mc:/g, '</')
      .replace(/<w:/g, '<')
      .replace(/<\/w:/g, '</')
      // Remove any remaining namespace prefixes from elements
      .replace(/<([a-zA-Z0-9]+):/g, '<')
      .replace(/<\/([a-zA-Z0-9]+):/g, '</');
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanedXml, 'text/xml');
    
    // Check for parse errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      console.warn('[OMML] Parse error:', parseError.textContent);
      // Try alternative parsing
      return parseOmmlManually(ommlXml);
    }
    
    // Find the math element - try multiple selectors
    let mathElement = doc.querySelector('oMath');
    if (!mathElement) {
      mathElement = doc.querySelector('oMathPara');
    }
    if (!mathElement) {
      // Try to find any element that looks like math
      const allElements = doc.querySelectorAll('*');
      for (const el of Array.from(allElements)) {
        const name = el.localName || el.nodeName;
        if (name === 'oMath' || name === 'oMathPara' || name.endsWith(':oMath')) {
          mathElement = el;
          break;
        }
      }
    }
    
    if (!mathElement) {
      // Process the root element directly
      const result = processOmmlElement(doc.documentElement);
      if (result && result.trim()) {
        return result;
      }
      return parseOmmlManually(ommlXml);
    }
    
    const result = processOmmlElement(mathElement);
    
    // If result is empty or just whitespace, try manual parsing
    if (!result || !result.trim()) {
      return parseOmmlManually(ommlXml);
    }
    
    return result;
  } catch (error) {
    console.warn('[OMML] Conversion error:', error);
    return parseOmmlManually(ommlXml);
  }
}

/**
 * Manual OMML parsing using regex - fallback when DOM parsing fails
 * This is a more robust fallback that handles nested structures
 */
function parseOmmlManually(ommlXml: string): string {
  // First, normalize the XML by removing namespace prefixes
  let xml = ommlXml
    // Remove namespace prefixes from attributes first (e.g., m:val -> val)
    .replace(/\s([a-zA-Z0-9]+):([a-zA-Z0-9]+)=/g, ' $2=')
    // Remove namespace prefixes from elements
    .replace(/<m:/g, '<')
    .replace(/<\/m:/g, '</')
    .replace(/<a14:/g, '<')
    .replace(/<\/a14:/g, '</')
    .replace(/<([a-zA-Z0-9]+):/g, '<')
    .replace(/<\/([a-zA-Z0-9]+):/g, '</');
  
  // Process from innermost to outermost structures
  let maxIterations = 20;
  let changed = true;
  
  while (changed && maxIterations > 0) {
    changed = false;
    maxIterations--;
    const prevXml = xml;
    
    // Process fractions: <f>...<num>...</num>...<den>...</den>...</f>
    xml = xml.replace(/<f[^>]*>[\s\S]*?<num[^>]*>([\s\S]*?)<\/num>[\s\S]*?<den[^>]*>([\s\S]*?)<\/den>[\s\S]*?<\/f>/gi, 
      (match, num, den) => {
        const numText = extractInnerText(num);
        const denText = extractInnerText(den);
        return `\\frac{${numText}}{${denText}}`;
      });
    
    // Process subscripts: <sSub>...<e>...</e>...<sub>...</sub>...</sSub>
    xml = xml.replace(/<sSub[^>]*>[\s\S]*?<e[^>]*>([\s\S]*?)<\/e>[\s\S]*?<sub[^>]*>([\s\S]*?)<\/sub>[\s\S]*?<\/sSub>/gi,
      (match, base, sub) => {
        const baseText = extractInnerText(base);
        const subText = extractInnerText(sub);
        return `{${baseText}}_{${subText}}`;
      });
    
    // Process superscripts: <sSup>...<e>...</e>...<sup>...</sup>...</sSup>
    xml = xml.replace(/<sSup[^>]*>[\s\S]*?<e[^>]*>([\s\S]*?)<\/e>[\s\S]*?<sup[^>]*>([\s\S]*?)<\/sup>[\s\S]*?<\/sSup>/gi,
      (match, base, sup) => {
        const baseText = extractInnerText(base);
        const supText = extractInnerText(sup);
        return `{${baseText}}^{${supText}}`;
      });
    
    // Process sub-superscripts: <sSubSup>...<e>...</e>...<sub>...</sub>...<sup>...</sup>...</sSubSup>
    xml = xml.replace(/<sSubSup[^>]*>[\s\S]*?<e[^>]*>([\s\S]*?)<\/e>[\s\S]*?<sub[^>]*>([\s\S]*?)<\/sub>[\s\S]*?<sup[^>]*>([\s\S]*?)<\/sup>[\s\S]*?<\/sSubSup>/gi,
      (match, base, sub, sup) => {
        const baseText = extractInnerText(base);
        const subText = extractInnerText(sub);
        const supText = extractInnerText(sup);
        return `{${baseText}}_{${subText}}^{${supText}}`;
      });
    
    // Process delimiters with explicit brackets
    xml = xml.replace(/<d[^>]*>[\s\S]*?<dPr[^>]*>[\s\S]*?<begChr[^>]*val="([^"]*)"[\s\S]*?<endChr[^>]*val="([^"]*)"[\s\S]*?<\/dPr>[\s\S]*?<e[^>]*>([\s\S]*?)<\/e>[\s\S]*?<\/d>/gi,
      (match, beg, end, content) => {
        const contentText = extractInnerText(content);
        const leftBr = beg === '[' ? '[' : (beg || '(');
        const rightBr = end === ']' ? ']' : (end || ')');
        return `\\left${leftBr}${contentText}\\right${rightBr}`;
      });
    
    // Process delimiters without explicit brackets (default to parentheses)
    xml = xml.replace(/<d[^>]*>(?![\s\S]*?<dPr)[\s\S]*?<e[^>]*>([\s\S]*?)<\/e>[\s\S]*?<\/d>/gi,
      (match, content) => {
        const contentText = extractInnerText(content);
        return `\\left(${contentText}\\right)`;
      });
    
    // Process n-ary operators (integrals, sums) with limits
    xml = xml.replace(/<nary[^>]*>[\s\S]*?<naryPr[^>]*>[\s\S]*?<chr[^>]*val="([^"]*)"[\s\S]*?<\/naryPr>[\s\S]*?(?:<sub[^>]*>([\s\S]*?)<\/sub>)?[\s\S]*?(?:<sup[^>]*>([\s\S]*?)<\/sup>)?[\s\S]*?<e[^>]*>([\s\S]*?)<\/e>[\s\S]*?<\/nary>/gi,
      (match, chr, subContent, supContent, content) => {
        const contentText = extractInnerText(content || '');
        const subText = subContent ? extractInnerText(subContent) : '';
        const supText = supContent ? extractInnerText(supContent) : '';
        
        let op = '\\int';
        if (chr === '∬') op = '\\iint';
        else if (chr === '∭') op = '\\iiint';
        else if (chr === '∮') op = '\\oint';
        else if (chr === '∑') op = '\\sum';
        else if (chr === '∏') op = '\\prod';
        else if (chr === '∫') op = '\\int';
        
        let result = op;
        if (subText) result += `_{${subText}}`;
        if (supText) result += `^{${supText}}`;
        result += ` ${contentText}`;
        return result;
      });
    
    // Simpler n-ary pattern
    xml = xml.replace(/<nary[^>]*>[\s\S]*?<chr[^>]*val="([^"]*)"[^>]*\/>[\s\S]*?<e[^>]*>([\s\S]*?)<\/e>[\s\S]*?<\/nary>/gi,
      (match, chr, content) => {
        const contentText = extractInnerText(content);
        let op = '\\int';
        if (chr === '∬') op = '\\iint';
        else if (chr === '∭') op = '\\iiint';
        else if (chr === '∑') op = '\\sum';
        else if (chr === '∏') op = '\\prod';
        return `${op} ${contentText}`;
      });
    
    // Process functions: <func>...<fName>...</fName>...<e>...</e>...</func>
    xml = xml.replace(/<func[^>]*>[\s\S]*?<fName[^>]*>([\s\S]*?)<\/fName>[\s\S]*?<e[^>]*>([\s\S]*?)<\/e>[\s\S]*?<\/func>/gi,
      (match, fname, arg) => {
        const funcName = extractInnerText(fname).trim();
        const argText = extractInnerText(arg);
        const knownFuncs: Record<string, string> = {
          'sin': '\\sin', 'cos': '\\cos', 'tan': '\\tan',
          'ln': '\\ln', 'log': '\\log', 'exp': '\\exp',
          'lim': '\\lim', 'max': '\\max', 'min': '\\min',
          'arcsin': '\\arcsin', 'arccos': '\\arccos', 'arctan': '\\arctan',
        };
        const latexFunc = knownFuncs[funcName] || `\\operatorname{${funcName}}`;
        // If arg already has brackets, don't add more
        if (argText.startsWith('\\left') || argText.startsWith('(') || argText.startsWith('[')) {
          return `${latexFunc}${argText}`;
        }
        return `${latexFunc}\\left[${argText}\\right]`;
      });
    
    // Process radicals: <rad>...<deg>...</deg>...<e>...</e>...</rad>
    // CRITICAL: The radical should ONLY contain content from the <e> element
    // The <e> element is the radicand (content under the radical sign)
    xml = xml.replace(/<rad[^>]*>([\s\S]*?)<\/rad>/gi,
      (match, innerContent) => {
        // Extract degree if present (for nth roots)
        const degMatch = innerContent.match(/<deg[^>]*>([\s\S]*?)<\/deg>/i);
        const degText = degMatch ? extractInnerText(degMatch[1]).trim() : '';
        
        // CRITICAL FIX: Extract ONLY the content from the <e> element
        // The <e> element contains the radicand - what goes under the radical
        let contentText = '';
        
        // Remove the deg element first to avoid confusion
        const withoutDeg = innerContent.replace(/<deg[^>]*>[\s\S]*?<\/deg>/gi, '');
        
        // Remove radPr element
        const withoutRadPr = withoutDeg
          .replace(/<radPr[^>]*>[\s\S]*?<\/radPr>/gi, '')
          .replace(/<radPr[^>]*\/>/gi, '');
        
        // Find the <e> element content using balanced matching
        // We need to find the FIRST complete <e>...</e> pair
        const eStartMatch = withoutRadPr.match(/<e[^>]*>/i);
        if (eStartMatch) {
          const startIdx = eStartMatch.index! + eStartMatch[0].length;
          let depth = 1;
          let endIdx = startIdx;
          let remaining = withoutRadPr.substring(startIdx);
          
          // Find the matching </e> by counting nested <e> tags
          const tagPattern = /<e[^>]*>|<\/e>/gi;
          let tagMatch;
          while ((tagMatch = tagPattern.exec(remaining)) !== null) {
            if (tagMatch[0].startsWith('</')) {
              depth--;
              if (depth === 0) {
                endIdx = startIdx + tagMatch.index;
                break;
              }
            } else {
              depth++;
            }
          }
          
          // Extract the content between <e> and </e>
          const eContent = withoutRadPr.substring(startIdx, endIdx);
          contentText = extractInnerText(eContent);
        } else {
          // Fallback: extract remaining text
          contentText = extractInnerText(withoutRadPr);
        }
        
        // Clean up the content - trim whitespace
        contentText = contentText.trim();
        
        if (degText && degText !== '2' && degText !== '') {
          return `\\sqrt[${degText}]{${contentText}}`;
        }
        return `\\sqrt{${contentText}}`;
      });
    
    // Process runs: <r>...<t>...</t>...</r>
    xml = xml.replace(/<r[^>]*>[\s\S]*?<t[^>]*>([^<]*)<\/t>[\s\S]*?<\/r>/gi,
      (match, text) => convertTextToLatex(text));
    
    // Process standalone text: <t>...</t>
    xml = xml.replace(/<t[^>]*>([^<]*)<\/t>/gi,
      (match, text) => convertTextToLatex(text));
    
    if (xml !== prevXml) {
      changed = true;
    }
  }
  
  // Final cleanup: remove any remaining XML tags
  let result = xml.replace(/<[^>]+>/g, '');
  
  // Clean up extra whitespace
  result = result.replace(/\s+/g, ' ').trim();
  
  return result;
}

/**
 * Extract inner text from XML fragment, preserving LaTeX that was already converted
 */
function extractInnerText(xml: string): string {
  if (!xml) return '';
  
  // If it already looks like LaTeX (has backslashes), preserve it
  // But we need to be careful not to include extra content
  if (xml.includes('\\frac') || xml.includes('\\left') || xml.includes('\\right') || 
      xml.includes('_{') || xml.includes('^{') || xml.includes('\\sqrt')) {
    // Just remove remaining XML tags but preserve the LaTeX
    const result = xml.replace(/<[^>]+>/g, '').trim();
    return result;
  }
  
  // Extract text from <t> tags
  const textPattern = /<t[^>]*>([^<]*)<\/t>/gi;
  let text = '';
  let match;
  const tempXml = xml;
  while ((match = textPattern.exec(tempXml)) !== null) {
    text += match[1];
  }
  
  // If we found text in <t> tags, convert and return
  if (text) {
    return convertTextToLatex(text);
  }
  
  // Otherwise, strip all tags and convert
  const stripped = xml.replace(/<[^>]+>/g, '').trim();
  return convertTextToLatex(stripped);
}

/**
 * Extract plain text from OMML as fallback - with basic structure preservation
 */
function extractTextFromOmml(ommlXml: string): string {
  // Try manual parsing first
  const manualResult = parseOmmlManually(ommlXml);
  if (manualResult && manualResult.trim()) {
    return manualResult;
  }
  
  // Last resort: just extract text
  return ommlXml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Process an OMML element and its children
 */
function processOmmlElement(element: Element): string {
  const localName = element.localName || element.nodeName.replace(/^m:/, '');
  
  switch (localName) {
    case 'oMath':
    case 'oMathPara':
      return processChildren(element);
    
    case 'r': // Run - contains text
      return processRun(element);
    
    case 'f': // Fraction
      return processFraction(element);
    
    case 'rad': // Radical (square root, nth root)
      return processRadical(element);
    
    case 'sSub': // Subscript
      return processSubscript(element);
    
    case 'sSup': // Superscript
      return processSuperscript(element);
    
    case 'sSubSup': // Subscript and superscript
      return processSubSup(element);
    
    case 'nary': // N-ary operator (sum, product, integral)
      return processNary(element);
    
    case 'limLow': // Lower limit
      return processLimLow(element);
    
    case 'limUpp': // Upper limit
      return processLimUpp(element);
    
    case 'd': // Delimiter (parentheses, brackets)
      return processDelimiter(element);
    
    case 'm': // Matrix
      return processMatrix(element);
    
    case 'eqArr': // Equation array
      return processEqArray(element);
    
    case 'func': // Function
      return processFunction(element);
    
    case 'acc': // Accent
      return processAccent(element);
    
    case 'bar': // Bar (overline/underline)
      return processBar(element);
    
    case 'box': // Box
      return processBox(element);
    
    case 'groupChr': // Group character
      return processGroupChar(element);
    
    case 'borderBox': // Border box
      return processBorderBox(element);
    
    case 'sPre': // Pre-subscript/superscript
      return processPreScript(element);
    
    case 't': // Text
      return processText(element);
    
    default:
      return processChildren(element);
  }
}

/**
 * Process all children of an element
 */
function processChildren(element: Element): string {
  let result = '';
  for (const child of Array.from(element.children)) {
    result += processOmmlElement(child);
  }
  return result;
}

/**
 * Find direct child element by local name
 * This is more reliable than querySelector for namespaced XML
 */
function findChild(element: Element, localName: string): Element | null {
  for (const child of Array.from(element.children)) {
    const childLocalName = child.localName || child.nodeName.replace(/^m:/, '');
    if (childLocalName === localName) {
      return child;
    }
  }
  return null;
}

/**
 * Find all direct children by local name
 */
function findChildren(element: Element, localName: string): Element[] {
  const result: Element[] = [];
  for (const child of Array.from(element.children)) {
    const childLocalName = child.localName || child.nodeName.replace(/^m:/, '');
    if (childLocalName === localName) {
      result.push(child);
    }
  }
  return result;
}

/**
 * Process a run element (contains text)
 */
function processRun(element: Element): string {
  // Try to find text element using multiple methods
  let textElement = element.querySelector('t');
  if (!textElement) {
    textElement = findChild(element, 't');
  }
  if (textElement) {
    return processText(textElement);
  }
  
  // If no 't' element, check for direct text content
  const directText = element.textContent?.trim();
  if (directText && element.children.length === 0) {
    return convertTextToLatex(directText);
  }
  
  return processChildren(element);
}

/**
 * Process text element
 */
function processText(element: Element): string {
  const text = element.textContent || '';
  return convertTextToLatex(text);
}

/**
 * Process fraction element
 */
function processFraction(element: Element): string {
  const num = findChild(element, 'num') || element.querySelector('num');
  const den = findChild(element, 'den') || element.querySelector('den');
  
  const numLatex = num ? processChildren(num) : '';
  const denLatex = den ? processChildren(den) : '';
  
  // Check fraction type
  const fPr = findChild(element, 'fPr') || element.querySelector('fPr');
  const type = fPr ? (findChild(fPr, 'type') || fPr.querySelector('type')) : null;
  const typeVal = type?.getAttribute('val');
  
  if (typeVal === 'skw') {
    // Skewed fraction (like a/b)
    return `{}^{${numLatex}}\\!/\\!{}_{${denLatex}}`;
  } else if (typeVal === 'lin') {
    // Linear fraction
    return `${numLatex}/${denLatex}`;
  }
  
  return `\\frac{${numLatex}}{${denLatex}}`;
}

/**
 * Process radical (square root, nth root)
 */
function processRadical(element: Element): string {
  // CRITICAL: Use findChild to get DIRECT children only, not nested elements
  const deg = findChild(element, 'deg');
  const e = findChild(element, 'e');
  
  // Process ONLY the content inside the direct <e> child element
  // The <e> element is the radicand - what goes under the radical sign
  let eLatex = '';
  if (e) {
    eLatex = processChildren(e);
  } else {
    // If no 'e' element, try to process all children except 'deg' and 'radPr'
    for (const child of Array.from(element.children)) {
      const childName = child.localName || child.nodeName.replace(/^m:/, '');
      if (childName !== 'deg' && childName !== 'radPr') {
        eLatex += processOmmlElement(child);
      }
    }
  }
  
  // Clean up the content - remove any leading/trailing whitespace
  eLatex = eLatex.trim();
  
  if (deg) {
    const degLatex = processChildren(deg).trim();
    if (degLatex && degLatex !== '2' && degLatex !== '') {
      return `\\sqrt[${degLatex}]{${eLatex}}`;
    }
  }
  
  return `\\sqrt{${eLatex}}`;
}

/**
 * Process subscript
 */
function processSubscript(element: Element): string {
  const e = findChild(element, 'e') || element.querySelector('e');
  const sub = findChild(element, 'sub') || element.querySelector('sub');
  
  const eLatex = e ? processChildren(e) : '';
  const subLatex = sub ? processChildren(sub) : '';
  
  return `{${eLatex}}_{${subLatex}}`;
}

/**
 * Process superscript
 */
function processSuperscript(element: Element): string {
  const e = findChild(element, 'e') || element.querySelector('e');
  const sup = findChild(element, 'sup') || element.querySelector('sup');
  
  const eLatex = e ? processChildren(e) : '';
  const supLatex = sup ? processChildren(sup) : '';
  
  return `{${eLatex}}^{${supLatex}}`;
}

/**
 * Process subscript and superscript together
 */
function processSubSup(element: Element): string {
  const e = findChild(element, 'e') || element.querySelector('e');
  const sub = findChild(element, 'sub') || element.querySelector('sub');
  const sup = findChild(element, 'sup') || element.querySelector('sup');
  
  const eLatex = e ? processChildren(e) : '';
  const subLatex = sub ? processChildren(sub) : '';
  const supLatex = sup ? processChildren(sup) : '';
  
  return `{${eLatex}}_{${subLatex}}^{${supLatex}}`;
}

/**
 * Process n-ary operator (sum, product, integral)
 */
function processNary(element: Element): string {
  const naryPr = findChild(element, 'naryPr') || element.querySelector('naryPr');
  const sub = findChild(element, 'sub') || element.querySelector('sub');
  const sup = findChild(element, 'sup') || element.querySelector('sup');
  const e = findChild(element, 'e') || element.querySelector('e');
  
  // Get the operator character
  let operator = '\\int';
  const chr = naryPr ? (findChild(naryPr, 'chr') || naryPr.querySelector('chr')) : null;
  const chrVal = chr?.getAttribute('val');
  
  if (chrVal) {
    const converted = convertCharToLatex(chrVal);
    if (converted.startsWith('\\')) {
      operator = converted;
    } else {
      // Handle special cases for integral symbols
      switch (chrVal) {
        case '∫': operator = '\\int'; break;
        case '∬': operator = '\\iint'; break;
        case '∭': operator = '\\iiint'; break;
        case '∮': operator = '\\oint'; break;
        case '∯': operator = '\\oiint'; break;
        case '∰': operator = '\\oiiint'; break;
        case '∑': operator = '\\sum'; break;
        case '∏': operator = '\\prod'; break;
        default:
          // If not recognized, try to use the character directly
          if (chrVal.length === 1) {
            operator = convertCharToLatex(chrVal);
            if (!operator.startsWith('\\')) {
              operator = chrVal;
            }
          }
      }
    }
  }
  
  // Check for limLoc attribute to determine limit placement
  const limLoc = naryPr ? (findChild(naryPr, 'limLoc') || naryPr.querySelector('limLoc')) : null;
  const limLocVal = limLoc?.getAttribute('val');
  const useUnderOver = limLocVal === 'undOvr';
  
  const subLatex = sub ? processChildren(sub) : '';
  const supLatex = sup ? processChildren(sup) : '';
  const eLatex = e ? processChildren(e) : '';
  
  let result = operator;
  
  if (useUnderOver && (subLatex || supLatex)) {
    // Use limits style (under/over)
    result = `${operator}\\limits`;
  }
  
  if (subLatex) result += `_{${subLatex}}`;
  if (supLatex) result += `^{${supLatex}}`;
  
  // Add space before the expression
  if (eLatex) {
    result += ` ${eLatex}`;
  }
  
  return result;
}

/**
 * Process lower limit
 */
function processLimLow(element: Element): string {
  const e = findChild(element, 'e') || element.querySelector('e');
  const lim = findChild(element, 'lim') || element.querySelector('lim');
  
  const eLatex = e ? processChildren(e) : '';
  const limLatex = lim ? processChildren(lim) : '';
  
  return `{${eLatex}}_{${limLatex}}`;
}

/**
 * Process upper limit
 */
function processLimUpp(element: Element): string {
  const e = findChild(element, 'e') || element.querySelector('e');
  const lim = findChild(element, 'lim') || element.querySelector('lim');
  
  const eLatex = e ? processChildren(e) : '';
  const limLatex = lim ? processChildren(lim) : '';
  
  return `{${eLatex}}^{${limLatex}}`;
}

/**
 * Process delimiter (parentheses, brackets, etc.)
 */
function processDelimiter(element: Element): string {
  const dPr = findChild(element, 'dPr') || element.querySelector('dPr');
  
  // Find all 'e' elements (there can be multiple for things like (a,b,c))
  const eElements = findChildren(element, 'e');
  
  let leftBracket = '(';
  let rightBracket = ')';
  
  if (dPr) {
    const begChr = findChild(dPr, 'begChr') || dPr.querySelector('begChr');
    const endChr = findChild(dPr, 'endChr') || dPr.querySelector('endChr');
    
    const begVal = begChr?.getAttribute('val');
    const endVal = endChr?.getAttribute('val');
    
    // Handle left bracket
    if (begVal !== undefined && begVal !== null) {
      if (BRACKET_MAP[begVal]) {
        leftBracket = BRACKET_MAP[begVal][0];
      } else if (begVal === '') {
        leftBracket = ''; // Invisible bracket
      } else {
        leftBracket = begVal;
      }
    }
    
    // Handle right bracket
    if (endVal !== undefined && endVal !== null) {
      if (BRACKET_MAP[endVal]) {
        rightBracket = BRACKET_MAP[endVal][1];
      } else if (endVal === '') {
        rightBracket = ''; // Invisible bracket
      } else {
        rightBracket = endVal;
      }
    }
  }
  
  // Process all 'e' elements and join with commas
  const contents = eElements.map(e => processChildren(e));
  const eLatex = contents.join(', ');
  
  // Use \left and \right for proper sizing, but handle empty brackets
  if (leftBracket === '' && rightBracket === '') {
    return eLatex;
  } else if (leftBracket === '') {
    return `\\left.${eLatex}\\right${rightBracket}`;
  } else if (rightBracket === '') {
    return `\\left${leftBracket}${eLatex}\\right.`;
  }
  
  return `\\left${leftBracket}${eLatex}\\right${rightBracket}`;
}

/**
 * Process matrix
 */
function processMatrix(element: Element): string {
  const rows: string[] = [];
  
  const mrElements = findChildren(element, 'mr');
  for (const mr of mrElements) {
    const cells: string[] = [];
    const eElements = findChildren(mr, 'e');
    for (const e of eElements) {
      cells.push(processChildren(e));
    }
    rows.push(cells.join(' & '));
  }
  
  return `\\begin{matrix}${rows.join(' \\\\ ')}\\end{matrix}`;
}

/**
 * Process equation array
 */
function processEqArray(element: Element): string {
  const equations: string[] = [];
  
  const eElements = findChildren(element, 'e');
  for (const e of eElements) {
    equations.push(processChildren(e));
  }
  
  return `\\begin{aligned}${equations.join(' \\\\ ')}\\end{aligned}`;
}

/**
 * Process function
 */
function processFunction(element: Element): string {
  const fName = findChild(element, 'fName') || element.querySelector('fName');
  const e = findChild(element, 'e') || element.querySelector('e');
  
  let funcName = fName ? processChildren(fName).trim() : '';
  const eLatex = e ? processChildren(e) : '';
  
  // Check if it's a known function
  if (FUNCTION_NAMES[funcName]) {
    funcName = FUNCTION_NAMES[funcName];
  } else if (funcName && !funcName.startsWith('\\')) {
    funcName = `\\operatorname{${funcName}}`;
  }
  
  // For functions like ln, log, sin, etc., the argument should follow directly
  // If the argument already has brackets, don't add extra braces
  if (eLatex.startsWith('\\left') || eLatex.startsWith('(') || eLatex.startsWith('[')) {
    return `${funcName}${eLatex}`;
  }
  
  // For simple arguments, wrap in brackets for clarity
  return `${funcName}\\left[${eLatex}\\right]`;
}

/**
 * Process accent
 */
function processAccent(element: Element): string {
  const accPr = findChild(element, 'accPr') || element.querySelector('accPr');
  const e = findChild(element, 'e') || element.querySelector('e');
  
  let accent = '\\hat';
  
  if (accPr) {
    const chr = findChild(accPr, 'chr') || accPr.querySelector('chr');
    const chrVal = chr?.getAttribute('val');
    
    if (chrVal && ACCENT_MAP[chrVal]) {
      accent = ACCENT_MAP[chrVal];
    }
  }
  
  const eLatex = e ? processChildren(e) : '';
  
  return `${accent}{${eLatex}}`;
}

/**
 * Process bar (overline/underline)
 */
function processBar(element: Element): string {
  const barPr = findChild(element, 'barPr') || element.querySelector('barPr');
  const e = findChild(element, 'e') || element.querySelector('e');
  
  let barType = '\\overline';
  
  if (barPr) {
    const pos = findChild(barPr, 'pos') || barPr.querySelector('pos');
    const posVal = pos?.getAttribute('val');
    
    if (posVal === 'bot') {
      barType = '\\underline';
    }
  }
  
  const eLatex = e ? processChildren(e) : '';
  
  return `${barType}{${eLatex}}`;
}

/**
 * Process box
 */
function processBox(element: Element): string {
  const e = findChild(element, 'e') || element.querySelector('e');
  return e ? processChildren(e) : '';
}

/**
 * Process group character
 */
function processGroupChar(element: Element): string {
  const groupChrPr = findChild(element, 'groupChrPr') || element.querySelector('groupChrPr');
  const e = findChild(element, 'e') || element.querySelector('e');
  
  let groupChar = '\\underbrace';
  
  if (groupChrPr) {
    const chr = findChild(groupChrPr, 'chr') || groupChrPr.querySelector('chr');
    const pos = findChild(groupChrPr, 'pos') || groupChrPr.querySelector('pos');
    const chrVal = chr?.getAttribute('val');
    const posVal = pos?.getAttribute('val');
    
    if (posVal === 'top') {
      if (chrVal === '⏞' || chrVal === '︷') {
        groupChar = '\\overbrace';
      } else {
        groupChar = '\\overline';
      }
    } else {
      if (chrVal === '⏟' || chrVal === '︸') {
        groupChar = '\\underbrace';
      } else {
        groupChar = '\\underline';
      }
    }
  }
  
  const eLatex = e ? processChildren(e) : '';
  
  return `${groupChar}{${eLatex}}`;
}

/**
 * Process border box
 */
function processBorderBox(element: Element): string {
  const e = findChild(element, 'e') || element.querySelector('e');
  const eLatex = e ? processChildren(e) : '';
  return `\\boxed{${eLatex}}`;
}

/**
 * Process pre-subscript/superscript
 */
function processPreScript(element: Element): string {
  const sub = findChild(element, 'sub') || element.querySelector('sub');
  const sup = findChild(element, 'sup') || element.querySelector('sup');
  const e = findChild(element, 'e') || element.querySelector('e');
  
  const subLatex = sub ? processChildren(sub) : '';
  const supLatex = sup ? processChildren(sup) : '';
  const eLatex = e ? processChildren(e) : '';
  
  return `{}_{${subLatex}}^{${supLatex}}{${eLatex}}`;
}


// ============================================================================
// LaTeX Detection in Text
// ============================================================================

/**
 * LaTeX delimiter patterns
 */
const LATEX_PATTERNS = {
  // Display math: $$...$$ or \[...\]
  displayDollar: /\$\$([^$]+)\$\$/g,
  displayBracket: /\\\[([^\]]+)\\\]/g,
  // Inline math: $...$ or \(...\)
  inlineDollar: /(?<!\$)\$(?!\$)([^$\n]+)\$(?!\$)/g,
  inlineParen: /\\\(([^)]+)\\\)/g,
};

/**
 * Detected formula with its position and type
 */
export interface DetectedFormula {
  latex: string;
  displayMode: boolean;
  start: number;
  end: number;
  original: string;
}

/**
 * Detect all LaTeX formulas in text
 */
export function detectLatexInText(text: string): DetectedFormula[] {
  const formulas: DetectedFormula[] = [];
  
  // Detect display math ($$...$$)
  let match: RegExpExecArray | null;
  const displayDollarRegex = /\$\$([^$]+)\$\$/g;
  while ((match = displayDollarRegex.exec(text)) !== null) {
    formulas.push({
      latex: match[1].trim(),
      displayMode: true,
      start: match.index,
      end: match.index + match[0].length,
      original: match[0],
    });
  }
  
  // Detect display math (\[...\])
  const displayBracketRegex = /\\\[([^\]]+)\\\]/g;
  while ((match = displayBracketRegex.exec(text)) !== null) {
    formulas.push({
      latex: match[1].trim(),
      displayMode: true,
      start: match.index,
      end: match.index + match[0].length,
      original: match[0],
    });
  }
  
  // Detect inline math ($...$) - but not $$
  const inlineDollarRegex = /(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g;
  while ((match = inlineDollarRegex.exec(text)) !== null) {
    // Check if this overlaps with any display formula
    const overlaps = formulas.some(
      f => (match!.index >= f.start && match!.index < f.end) ||
           (match!.index + match![0].length > f.start && match!.index + match![0].length <= f.end)
    );
    if (!overlaps) {
      formulas.push({
        latex: match[1].trim(),
        displayMode: false,
        start: match.index,
        end: match.index + match[0].length,
        original: match[0],
      });
    }
  }
  
  // Detect inline math (\(...\))
  const inlineParenRegex = /\\\(([^)]+)\\\)/g;
  while ((match = inlineParenRegex.exec(text)) !== null) {
    formulas.push({
      latex: match[1].trim(),
      displayMode: false,
      start: match.index,
      end: match.index + match[0].length,
      original: match[0],
    });
  }
  
  // Sort by position
  formulas.sort((a, b) => a.start - b.start);
  
  return formulas;
}

/**
 * Replace LaTeX formulas in text with rendered HTML
 */
export function replaceLatexWithRendered(
  text: string,
  renderFn: (latex: string, displayMode: boolean) => string
): string {
  const formulas = detectLatexInText(text);
  
  if (formulas.length === 0) {
    return text;
  }
  
  let result = '';
  let lastEnd = 0;
  
  for (const formula of formulas) {
    // Add text before this formula
    result += text.slice(lastEnd, formula.start);
    // Add rendered formula
    result += renderFn(formula.latex, formula.displayMode);
    lastEnd = formula.end;
  }
  
  // Add remaining text
  result += text.slice(lastEnd);
  
  return result;
}

// ============================================================================
// KaTeX Rendering with Fallback
// ============================================================================

/**
 * KaTeX rendering options
 */
const KATEX_OPTIONS = {
  throwOnError: false,
  strict: false,
  trust: true,
  output: 'html' as const,
  macros: {
    // Common macros
    "\\R": "\\mathbb{R}",
    "\\N": "\\mathbb{N}",
    "\\Z": "\\mathbb{Z}",
    "\\Q": "\\mathbb{Q}",
    "\\C": "\\mathbb{C}",
    "\\eps": "\\varepsilon",
    // Physics
    "\\ket": "\\left|#1\\right\\rangle",
    "\\bra": "\\left\\langle#1\\right|",
    "\\braket": "\\left\\langle#1\\middle|#2\\right\\rangle",
    // Common operators
    "\\argmax": "\\operatorname{argmax}",
    "\\argmin": "\\operatorname{argmin}",
    "\\grad": "\\nabla",
    "\\curl": "\\nabla\\times",
    // Probability
    "\\Pr": "\\operatorname{Pr}",
    "\\E": "\\mathbb{E}",
    "\\Var": "\\operatorname{Var}",
    "\\Cov": "\\operatorname{Cov}",
    // Linear algebra
    "\\tr": "\\operatorname{tr}",
    "\\rank": "\\operatorname{rank}",
    "\\diag": "\\operatorname{diag}",
    // Calculus
    "\\dd": "\\mathrm{d}",
    "\\dv": "\\frac{\\mathrm{d}#1}{\\mathrm{d}#2}",
    "\\pdv": "\\frac{\\partial#1}{\\partial#2}",
  },
};

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Render LaTeX to HTML using KaTeX with fallback
 */
export function renderLatex(latex: string, displayMode: boolean): string {
  try {
    // Pre-process latex to handle common issues
    let processedLatex = latex;
    
    // Escape unescaped % (comment character in LaTeX)
    processedLatex = processedLatex.replace(/(?<!\\)%/g, '\\%');
    
    // Handle unescaped # (but not in macros)
    processedLatex = processedLatex.replace(/(?<!\\)#(?!\d)/g, '\\#');
    
    return katex.renderToString(processedLatex, {
      ...KATEX_OPTIONS,
      displayMode,
    });
  } catch (error) {
    console.warn('KaTeX render failed:', latex, error);
    const errorMsg = error instanceof Error ? error.message : 'Render error';
    const escapedLatex = escapeHtml(latex);
    const delimiter = displayMode ? '$$' : '$';
    return `<span class="formula-error" title="${escapeHtml(errorMsg)}">${delimiter}${escapedLatex}${delimiter}</span>`;
  }
}

/**
 * Render LaTeX and return result with success status
 */
export function renderLatexSafe(latex: string, displayMode: boolean): { html: string; success: boolean } {
  try {
    let processedLatex = latex;
    processedLatex = processedLatex.replace(/(?<!\\)%/g, '\\%');
    processedLatex = processedLatex.replace(/(?<!\\)#(?!\d)/g, '\\#');
    
    const html = katex.renderToString(processedLatex, {
      ...KATEX_OPTIONS,
      displayMode,
    });
    return { html, success: true };
  } catch (error) {
    const escapedLatex = escapeHtml(latex);
    const delimiter = displayMode ? '$$' : '$';
    return {
      html: `<span class="formula-error">${delimiter}${escapedLatex}${delimiter}</span>`,
      success: false,
    };
  }
}

// ============================================================================
// Slide Formula Processing
// ============================================================================

/**
 * Process all formulas in a slide element
 * 
 * This function:
 * 1. Finds and converts OMML elements
 * 2. Detects and renders LaTeX in text nodes
 */
export function processSlideFormulas(slideElement: HTMLElement): void {
  // Process OMML elements
  processOmmlElements(slideElement);
  
  // Process LaTeX in text
  processLatexInTextNodes(slideElement);
}

/**
 * Find and convert OMML elements in the slide
 */
function processOmmlElements(container: HTMLElement): void {
  // Look for OMML math elements
  const ommlSelectors = [
    'm\\:oMath',
    'oMath',
    '[data-omml]',
    '.omml-formula',
  ];
  
  for (const selector of ommlSelectors) {
    try {
      const elements = container.querySelectorAll(selector);
      for (const element of Array.from(elements)) {
        const ommlXml = element.outerHTML || element.innerHTML;
        const latex = convertOmmlToLatex(ommlXml);
        
        if (latex) {
          const rendered = renderLatex(latex, true);
          const wrapper = document.createElement('span');
          wrapper.className = 'katex-rendered';
          wrapper.innerHTML = rendered;
          element.replaceWith(wrapper);
        }
      }
    } catch (e) {
      // Selector might not be valid, continue
    }
  }
}

/**
 * Process LaTeX formulas in text nodes
 */
function processLatexInTextNodes(container: HTMLElement): void {
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        // Skip if parent is already a formula element
        const parent = node.parentElement;
        if (parent?.classList.contains('katex') ||
            parent?.classList.contains('katex-rendered') ||
            parent?.classList.contains('formula-error') ||
            parent?.tagName === 'SCRIPT' ||
            parent?.tagName === 'STYLE') {
          return NodeFilter.FILTER_REJECT;
        }
        
        // Check if text contains LaTeX delimiters
        const text = node.textContent || '';
        if (text.includes('$') || text.includes('\\(') || text.includes('\\[')) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_REJECT;
      },
    }
  );
  
  const nodesToProcess: Text[] = [];
  let currentNode: Node | null;
  while ((currentNode = walker.nextNode())) {
    nodesToProcess.push(currentNode as Text);
  }
  
  for (const textNode of nodesToProcess) {
    const text = textNode.textContent || '';
    const formulas = detectLatexInText(text);
    
    if (formulas.length === 0) continue;
    
    const fragment = document.createDocumentFragment();
    let lastEnd = 0;
    
    for (const formula of formulas) {
      // Add text before formula
      if (formula.start > lastEnd) {
        fragment.appendChild(document.createTextNode(text.slice(lastEnd, formula.start)));
      }
      
      // Add rendered formula
      const span = document.createElement('span');
      span.className = formula.displayMode ? 'katex-display-wrapper' : 'katex-inline-wrapper';
      span.innerHTML = renderLatex(formula.latex, formula.displayMode);
      fragment.appendChild(span);
      
      lastEnd = formula.end;
    }
    
    // Add remaining text
    if (lastEnd < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastEnd)));
    }
    
    textNode.replaceWith(fragment);
  }
}

// ============================================================================
// MathML to LaTeX Conversion
// ============================================================================

/**
 * Convert MathML to LaTeX
 * 
 * This is a simplified converter for common MathML elements.
 */
export function convertMathmlToLatex(mathmlXml: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(mathmlXml, 'text/xml');
    
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      console.warn('MathML parse error:', parseError.textContent);
      return mathmlXml.replace(/<[^>]+>/g, ' ').trim();
    }
    
    const mathElement = doc.querySelector('math');
    if (!mathElement) {
      return processMathmlElement(doc.documentElement);
    }
    
    return processMathmlElement(mathElement);
  } catch (error) {
    console.warn('MathML conversion error:', error);
    return mathmlXml.replace(/<[^>]+>/g, ' ').trim();
  }
}

/**
 * Process a MathML element
 */
function processMathmlElement(element: Element): string {
  const tagName = element.tagName.toLowerCase().replace('m:', '');
  
  switch (tagName) {
    case 'math':
    case 'mrow':
    case 'mstyle':
      return processMathmlChildren(element);
    
    case 'mi': // Identifier
    case 'mn': // Number
    case 'mtext': // Text
      return convertTextToLatex(element.textContent || '');
    
    case 'mo': // Operator
      return convertCharToLatex(element.textContent || '');
    
    case 'mfrac': // Fraction
      const [num, den] = Array.from(element.children);
      return `\\frac{${processMathmlElement(num)}}{${processMathmlElement(den)}}`;
    
    case 'msqrt': // Square root
      return `\\sqrt{${processMathmlChildren(element)}}`;
    
    case 'mroot': // Nth root
      const [base, index] = Array.from(element.children);
      return `\\sqrt[${processMathmlElement(index)}]{${processMathmlElement(base)}}`;
    
    case 'msub': // Subscript
      const [subBase, sub] = Array.from(element.children);
      return `{${processMathmlElement(subBase)}}_{${processMathmlElement(sub)}}`;
    
    case 'msup': // Superscript
      const [supBase, sup] = Array.from(element.children);
      return `{${processMathmlElement(supBase)}}^{${processMathmlElement(sup)}}`;
    
    case 'msubsup': // Subscript and superscript
      const [ssBase, ssSub, ssSup] = Array.from(element.children);
      return `{${processMathmlElement(ssBase)}}_{${processMathmlElement(ssSub)}}^{${processMathmlElement(ssSup)}}`;
    
    case 'mover': // Overscript
      const [overBase, over] = Array.from(element.children);
      const overChar = over.textContent?.trim();
      if (overChar && ACCENT_MAP[overChar]) {
        return `${ACCENT_MAP[overChar]}{${processMathmlElement(overBase)}}`;
      }
      return `\\overset{${processMathmlElement(over)}}{${processMathmlElement(overBase)}}`;
    
    case 'munder': // Underscript
      const [underBase, under] = Array.from(element.children);
      return `\\underset{${processMathmlElement(under)}}{${processMathmlElement(underBase)}}`;
    
    case 'munderover': // Under and over
      const [uoBase, uoUnder, uoOver] = Array.from(element.children);
      return `\\underset{${processMathmlElement(uoUnder)}}{\\overset{${processMathmlElement(uoOver)}}{${processMathmlElement(uoBase)}}}`;
    
    case 'mtable': // Table/Matrix
      const rows = Array.from(element.querySelectorAll('mtr'));
      const rowsLatex = rows.map(row => {
        const cells = Array.from(row.querySelectorAll('mtd'));
        return cells.map(cell => processMathmlElement(cell)).join(' & ');
      });
      return `\\begin{matrix}${rowsLatex.join(' \\\\ ')}\\end{matrix}`;
    
    case 'mfenced': // Fenced (parentheses, brackets)
      const open = element.getAttribute('open') || '(';
      const close = element.getAttribute('close') || ')';
      const leftBr = BRACKET_MAP[open]?.[0] || open;
      const rightBr = BRACKET_MAP[close]?.[1] || close;
      return `\\left${leftBr}${processMathmlChildren(element)}\\right${rightBr}`;
    
    default:
      return processMathmlChildren(element);
  }
}

/**
 * Process all children of a MathML element
 */
function processMathmlChildren(element: Element): string {
  return Array.from(element.children)
    .map(child => processMathmlElement(child))
    .join('');
}
