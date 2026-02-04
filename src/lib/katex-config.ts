/**
 * Shared KaTeX Configuration
 * Keep math rendering consistent across editors and renderers.
 */

export const KATEX_MACROS: Record<string, string> = {
  // Quantum mechanics macros
  "\\bra": "\\left\\langle#1\\right|",
  "\\ket": "\\left|#1\\right\\rangle",
  "\\braket": "\\left\\langle#1\\right\\rangle",
  "\\ketbra": "\\left|#1\\right\\rangle\\left\\langle#2\\right|",

  // Physics macros
  "\\abs": "\\left|#1\\right|",
  "\\norm": "\\left\\|#1\\right\\|",
  "\\avg": "\\left\\langle#1\\right\\rangle",
  "\\expval": "\\left\\langle#1\\right\\rangle",

  // Common math sets (aliases)
  "\\R": "\\mathbb{R}",
  "\\N": "\\mathbb{N}",
  "\\Z": "\\mathbb{Z}",
  "\\Q": "\\mathbb{Q}",
  "\\C": "\\mathbb{C}",
  "\\RR": "\\mathbb{R}",
  "\\NN": "\\mathbb{N}",
  "\\ZZ": "\\mathbb{Z}",
  "\\QQ": "\\mathbb{Q}",
  "\\CC": "\\mathbb{C}",

  // Common symbols
  "\\eps": "\\varepsilon",
  "\\epsilon": "\\varepsilon",

  // Vectors and matrices
  "\\vect": "\\boldsymbol{#1}",
  "\\mat": "\\mathbf{#1}",

  // Common operators
  "\\argmax": "\\operatorname{argmax}",
  "\\argmin": "\\operatorname{argmin}",
  "\\grad": "\\nabla",
  "\\div": "\\nabla\\cdot",
  "\\curl": "\\nabla\\times",
  "\\Pr": "\\operatorname{Pr}",
  "\\E": "\\mathbb{E}",
  "\\Var": "\\operatorname{Var}",
  "\\Cov": "\\operatorname{Cov}",
  "\\tr": "\\operatorname{tr}",
  "\\rank": "\\operatorname{rank}",
  "\\diag": "\\operatorname{diag}",
  "\\det": "\\operatorname{det}",

  // Calculus helpers
  "\\dd": "\\mathrm{d}",
  "\\dv": "\\frac{\\mathrm{d}#1}{\\mathrm{d}#2}",
  "\\pdv": "\\frac{\\partial#1}{\\partial#2}",
};

export function getKaTeXOptions(
  displayMode: boolean = false,
  overrides: Record<string, unknown> = {}
) {
  return {
    displayMode,
    throwOnError: false,
    errorColor: "#ef4444",
    trust: true,
    strict: false,
    macros: KATEX_MACROS,
    ...overrides,
  };
}
