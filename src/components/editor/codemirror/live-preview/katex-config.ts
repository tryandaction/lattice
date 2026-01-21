/**
 * Shared KaTeX Configuration
 * Provides consistent rendering options across all math rendering locations
 */

/**
 * Common KaTeX macros for quantum mechanics, physics, and mathematics
 */
export const KATEX_MACROS = {
  // Quantum mechanics macros
  "\\bra": "\\langle #1|",
  "\\ket": "|#1\\rangle",
  "\\braket": "\\langle #1 \\rangle",
  "\\ketbra": "|#1\\rangle\\langle #2|",

  // Physics macros
  "\\abs": "\\left|#1\\right|",
  "\\norm": "\\left\\|#1\\right\\|",
  "\\avg": "\\langle #1 \\rangle",
  "\\expval": "\\langle #1 \\rangle",

  // Common math sets
  "\\RR": "\\mathbb{R}",
  "\\NN": "\\mathbb{N}",
  "\\ZZ": "\\mathbb{Z}",
  "\\QQ": "\\mathbb{Q}",
  "\\CC": "\\mathbb{C}",

  // Vectors and matrices
  "\\vect": "\\boldsymbol{#1}",
  "\\mat": "\\mathbf{#1}",
};

/**
 * Get KaTeX rendering options
 */
export function getKaTeXOptions(displayMode: boolean = false) {
  return {
    displayMode,
    throwOnError: false,
    errorColor: '#ef4444',
    trust: true,
    strict: false, // Allow more LaTeX features
    macros: KATEX_MACROS,
  };
}
