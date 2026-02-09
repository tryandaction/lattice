/**
 * Math Templates Library
 *
 * Provides quick-insert templates for common LaTeX formulas.
 * Supports auto-complete with /prefix syntax.
 *
 * Template Syntax:
 * - #? = placeholder (user fills in)
 * - Templates use standard LaTeX syntax
 */

import type { MathfieldElement } from "mathlive";

export interface MathTemplate {
  /** LaTeX template with #? placeholders */
  latex: string;

  /** Human-readable description */
  description: string;

  /** Category for organization */
  category: 'Basic' | 'Calculus' | 'Linear Algebra' | 'Physics' | 'Statistics' | 'Logic';

  /** Keywords for search */
  keywords?: string[];
}

/**
 * Complete template library
 */
export const MATH_TEMPLATES: Record<string, MathTemplate> = {
  // ============================================================================
  // Basic Templates
  // ============================================================================

  frac: {
    latex: '\\frac{#?}{#?}',
    description: 'Fraction',
    category: 'Basic',
    keywords: ['fraction', 'divide'],
  },

  dfrac: {
    latex: '\\dfrac{#?}{#?}',
    description: 'Display fraction (larger)',
    category: 'Basic',
    keywords: ['fraction', 'display'],
  },

  sqrt: {
    latex: '\\sqrt{#?}',
    description: 'Square root',
    category: 'Basic',
    keywords: ['root', 'radical'],
  },

  nthroot: {
    latex: '\\sqrt[#?]{#?}',
    description: 'Nth root',
    category: 'Basic',
    keywords: ['root', 'radical', 'nth'],
  },

  power: {
    latex: '#?^{#?}',
    description: 'Power/Exponent',
    category: 'Basic',
    keywords: ['exponent', 'power', 'superscript'],
  },

  subscript: {
    latex: '#?_{#?}',
    description: 'Subscript',
    category: 'Basic',
    keywords: ['subscript', 'index'],
  },

  // ============================================================================
  // Calculus Templates
  // ============================================================================

  integral: {
    latex: '\\int_{#?}^{#?} #? \\, d#?',
    description: 'Definite integral',
    category: 'Calculus',
    keywords: ['integral', 'integration', 'definite'],
  },

  iintegral: {
    latex: '\\int #? \\, d#?',
    description: 'Indefinite integral',
    category: 'Calculus',
    keywords: ['integral', 'integration', 'indefinite'],
  },

  dintegral: {
    latex: '\\iint_{#?} #? \\, dA',
    description: 'Double integral',
    category: 'Calculus',
    keywords: ['integral', 'double', 'area'],
  },

  tintegral: {
    latex: '\\iiint_{#?} #? \\, dV',
    description: 'Triple integral',
    category: 'Calculus',
    keywords: ['integral', 'triple', 'volume'],
  },

  oint: {
    latex: '\\oint_{#?} #? \\, d#?',
    description: 'Contour integral',
    category: 'Calculus',
    keywords: ['integral', 'contour', 'closed'],
  },

  sum: {
    latex: '\\sum_{#?}^{#?} #?',
    description: 'Summation',
    category: 'Calculus',
    keywords: ['sum', 'summation', 'series'],
  },

  prod: {
    latex: '\\prod_{#?}^{#?} #?',
    description: 'Product',
    category: 'Calculus',
    keywords: ['product', 'multiplication'],
  },

  limit: {
    latex: '\\lim_{#? \\to #?} #?',
    description: 'Limit',
    category: 'Calculus',
    keywords: ['limit', 'approach'],
  },

  derivative: {
    latex: '\\frac{d#?}{d#?}',
    description: 'Derivative',
    category: 'Calculus',
    keywords: ['derivative', 'differentiation'],
  },

  partial: {
    latex: '\\frac{\\partial #?}{\\partial #?}',
    description: 'Partial derivative',
    category: 'Calculus',
    keywords: ['partial', 'derivative'],
  },

  nderivative: {
    latex: '\\frac{d^{#?}#?}{d#?^{#?}}',
    description: 'Nth derivative',
    category: 'Calculus',
    keywords: ['derivative', 'nth', 'higher'],
  },

  // ============================================================================
  // Linear Algebra Templates
  // ============================================================================

  matrix: {
    latex: '\\begin{pmatrix} #? & #? \\\\ #? & #? \\end{pmatrix}',
    description: '2×2 Matrix',
    category: 'Linear Algebra',
    keywords: ['matrix', '2x2'],
  },

  matrix3: {
    latex: '\\begin{pmatrix} #? & #? & #? \\\\ #? & #? & #? \\\\ #? & #? & #? \\end{pmatrix}',
    description: '3×3 Matrix',
    category: 'Linear Algebra',
    keywords: ['matrix', '3x3'],
  },

  bmatrix: {
    latex: '\\begin{bmatrix} #? & #? \\\\ #? & #? \\end{bmatrix}',
    description: '2×2 Matrix (square brackets)',
    category: 'Linear Algebra',
    keywords: ['matrix', 'brackets'],
  },

  vmatrix: {
    latex: '\\begin{vmatrix} #? & #? \\\\ #? & #? \\end{vmatrix}',
    description: 'Determinant',
    category: 'Linear Algebra',
    keywords: ['determinant', 'matrix'],
  },

  vector: {
    latex: '\\begin{pmatrix} #? \\\\ #? \\\\ #? \\end{pmatrix}',
    description: 'Column vector',
    category: 'Linear Algebra',
    keywords: ['vector', 'column'],
  },

  vector2: {
    latex: '\\begin{pmatrix} #? \\\\ #? \\end{pmatrix}',
    description: '2D vector',
    category: 'Linear Algebra',
    keywords: ['vector', '2d'],
  },

  // ============================================================================
  // Physics Templates
  // ============================================================================

  einstein: {
    latex: 'E = mc^2',
    description: "Einstein's mass-energy equivalence",
    category: 'Physics',
    keywords: ['einstein', 'energy', 'relativity'],
  },

  newton: {
    latex: 'F = ma',
    description: "Newton's second law",
    category: 'Physics',
    keywords: ['newton', 'force', 'acceleration'],
  },

  schrodinger: {
    latex: 'i\\hbar\\frac{\\partial}{\\partial t}\\Psi = \\hat{H}\\Psi',
    description: 'Schrödinger equation',
    category: 'Physics',
    keywords: ['schrodinger', 'quantum', 'wave'],
  },

  maxwell1: {
    latex: '\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\epsilon_0}',
    description: "Gauss's law (electric)",
    category: 'Physics',
    keywords: ['maxwell', 'gauss', 'electric'],
  },

  maxwell2: {
    latex: '\\nabla \\cdot \\mathbf{B} = 0',
    description: "Gauss's law (magnetic)",
    category: 'Physics',
    keywords: ['maxwell', 'gauss', 'magnetic'],
  },

  maxwell3: {
    latex: '\\nabla \\times \\mathbf{E} = -\\frac{\\partial \\mathbf{B}}{\\partial t}',
    description: "Faraday's law",
    category: 'Physics',
    keywords: ['maxwell', 'faraday', 'induction'],
  },

  maxwell4: {
    latex: '\\nabla \\times \\mathbf{B} = \\mu_0\\mathbf{J} + \\mu_0\\epsilon_0\\frac{\\partial \\mathbf{E}}{\\partial t}',
    description: 'Ampère-Maxwell law',
    category: 'Physics',
    keywords: ['maxwell', 'ampere', 'current'],
  },

  // ============================================================================
  // Statistics Templates
  // ============================================================================

  mean: {
    latex: '\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n} x_i',
    description: 'Mean (average)',
    category: 'Statistics',
    keywords: ['mean', 'average'],
  },

  variance: {
    latex: '\\sigma^2 = \\frac{1}{n}\\sum_{i=1}^{n} (x_i - \\bar{x})^2',
    description: 'Variance',
    category: 'Statistics',
    keywords: ['variance', 'spread'],
  },

  stddev: {
    latex: '\\sigma = \\sqrt{\\frac{1}{n}\\sum_{i=1}^{n} (x_i - \\bar{x})^2}',
    description: 'Standard deviation',
    category: 'Statistics',
    keywords: ['standard', 'deviation', 'sigma'],
  },

  normal: {
    latex: 'f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}',
    description: 'Normal distribution',
    category: 'Statistics',
    keywords: ['normal', 'gaussian', 'distribution'],
  },

  binomial: {
    latex: 'P(X = k) = \\binom{n}{k} p^k (1-p)^{n-k}',
    description: 'Binomial distribution',
    category: 'Statistics',
    keywords: ['binomial', 'distribution'],
  },

  poisson: {
    latex: 'P(X = k) = \\frac{\\lambda^k e^{-\\lambda}}{k!}',
    description: 'Poisson distribution',
    category: 'Statistics',
    keywords: ['poisson', 'distribution'],
  },

  // ============================================================================
  // Logic Templates
  // ============================================================================

  forall: {
    latex: '\\forall #? \\in #?, #?',
    description: 'Universal quantifier',
    category: 'Logic',
    keywords: ['forall', 'universal', 'quantifier'],
  },

  exists: {
    latex: '\\exists #? \\in #? : #?',
    description: 'Existential quantifier',
    category: 'Logic',
    keywords: ['exists', 'existential', 'quantifier'],
  },

  implies: {
    latex: '#? \\implies #?',
    description: 'Logical implication',
    category: 'Logic',
    keywords: ['implies', 'implication'],
  },

  iff: {
    latex: '#? \\iff #?',
    description: 'If and only if',
    category: 'Logic',
    keywords: ['iff', 'equivalent', 'biconditional'],
  },
};

/**
 * Get template by prefix (for auto-complete)
 *
 * @param prefix - The prefix to search for (e.g., "frac", "/frac")
 * @returns The matching template or null
 */
export function getTemplateByPrefix(prefix: string): MathTemplate | null {
  const key = prefix.toLowerCase().replace(/^\//, '');
  return MATH_TEMPLATES[key] || null;
}

/**
 * Get all templates in a category
 */
export function getTemplatesByCategory(category: MathTemplate['category']): Array<{ key: string; template: MathTemplate }> {
  return Object.entries(MATH_TEMPLATES)
    .filter(([_, template]) => template.category === category)
    .map(([key, template]) => ({ key, template }));
}

/**
 * Search templates by keyword
 */
export function searchTemplates(query: string): Array<{ key: string; template: MathTemplate }> {
  const lowerQuery = query.toLowerCase();
  return Object.entries(MATH_TEMPLATES)
    .filter(([key, template]) => {
      return (
        key.includes(lowerQuery) ||
        template.description.toLowerCase().includes(lowerQuery) ||
        template.keywords?.some((kw) => kw.includes(lowerQuery))
      );
    })
    .map(([key, template]) => ({ key, template }));
}

/**
 * Insert template into MathfieldElement
 *
 * Replaces #? placeholders with MathLive placeholders
 * and moves cursor to first placeholder.
 */
export function insertTemplate(mathfield: MathfieldElement, template: string): void {
  // Convert #? to MathLive placeholder syntax
  const mathLiveTemplate = template.replace(/#\?/g, '\\placeholder{}');

  // Insert template
  mathfield.insert(mathLiveTemplate);

  // Move to first placeholder
  mathfield.executeCommand('moveToNextPlaceholder');
}

/**
 * Get all template categories
 */
export function getCategories(): MathTemplate['category'][] {
  return ['Basic', 'Calculus', 'Linear Algebra', 'Physics', 'Statistics', 'Logic'];
}
