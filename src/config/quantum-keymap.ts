/**
 * Quantum Keymap Configuration
 *
 * The keymap is intentionally small and visible. Default keys prioritize the
 * fastest structures and symbols for scientific writing; Shift opens the
 * variants for the same semantic family.
 */

// ============================================================================
// Type Definitions
// ============================================================================

export type QuantumKeyCategory =
  | "structure"
  | "greek"
  | "calculus"
  | "linear-algebra"
  | "sets"
  | "logic"
  | "relations"
  | "physics";

/**
 * Represents a single key mapping with default, shift, and variant symbols.
 */
export interface KeyMapping {
  /** Default LaTeX command when key is pressed */
  default: string;
  /** LaTeX command surfaced first in the variant selector */
  shift?: string;
  /** Array of extra LaTeX commands for deep selection */
  variants?: string[];
  /** Optional display label override for the physical key */
  label?: string;
  /** Human-readable name shown in help and tooltips */
  title?: string;
  /** Optional LaTeX/string preview for compact keycaps */
  preview?: string;
  /** Category for grouping and search */
  category?: QuantumKeyCategory;
  /** Short discovery terms */
  keywords?: string[];
}

/**
 * Complete keymap mapping key codes to their symbol configurations.
 */
export type QuantumKeymap = Record<string, KeyMapping>;

/**
 * Keyboard layout row definition.
 */
export interface KeyboardRow {
  /** Array of key codes in this row */
  keys: string[];
  /** CSS offset for row staggering (in key units) */
  offset: number;
}

// ============================================================================
// QWERTY Keyboard Layout
// ============================================================================

export const QWERTY_LAYOUT: KeyboardRow[] = [
  { keys: ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0"], offset: 0 },
  { keys: ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP"], offset: 0.5 },
  { keys: ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL"], offset: 0.75 },
  { keys: ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM"], offset: 1.25 },
];

/**
 * Map key codes to their physical labels.
 */
export const KEY_LABELS: Record<string, string> = {
  Digit1: "1", Digit2: "2", Digit3: "3", Digit4: "4", Digit5: "5",
  Digit6: "6", Digit7: "7", Digit8: "8", Digit9: "9", Digit0: "0",
  KeyQ: "Q", KeyW: "W", KeyE: "E", KeyR: "R", KeyT: "T",
  KeyY: "Y", KeyU: "U", KeyI: "I", KeyO: "O", KeyP: "P",
  KeyA: "A", KeyS: "S", KeyD: "D", KeyF: "F", KeyG: "G",
  KeyH: "H", KeyJ: "J", KeyK: "K", KeyL: "L",
  KeyZ: "Z", KeyX: "X", KeyC: "C", KeyV: "V", KeyB: "B",
  KeyN: "N", KeyM: "M",
};

// ============================================================================
// Quantum Keymap - Structure-first Formula Mappings
// ============================================================================

export const quantumKeymap: QuantumKeymap = {
  // Number row - structures and boundaries
  Digit1: {
    default: "^{ }",
    shift: "_{ }",
    variants: ["^{2}", "^{3}", "^{-1}", "^{\\prime}", "^{\\dagger}"],
    title: "Superscript",
    preview: "x^{ }",
    category: "structure",
    keywords: ["power", "exponent", "上标"],
  },
  Digit2: {
    default: "_{ }",
    shift: "^{ }",
    variants: ["_{i}", "_{j}", "_{n}", "_{0}", "_{\\mathrm{max}}"],
    title: "Subscript",
    preview: "x_{ }",
    category: "structure",
    keywords: ["index", "下标"],
  },
  Digit3: {
    default: "\\sqrt{}",
    shift: "\\sqrt[3]{}",
    variants: ["\\sqrt[4]{}", "\\sqrt[n]{}", "\\left|\\right|", "\\Vert\\Vert"],
    title: "Root",
    preview: "\\sqrt{x}",
    category: "structure",
    keywords: ["sqrt", "root", "radical", "根号"],
  },
  Digit4: {
    default: "\\frac{}{}",
    shift: "\\dfrac{}{}",
    variants: ["\\tfrac{}{}", "\\binom{}{}", "\\frac{d}{d}", "\\frac{\\partial}{\\partial}"],
    title: "Fraction",
    preview: "\\frac{x}{y}",
    category: "structure",
    keywords: ["fraction", "divide", "分数"],
  },
  Digit5: {
    default: "\\sum",
    shift: "\\prod",
    variants: ["\\sum_{}^{}", "\\prod_{}^{}", "\\coprod", "\\bigoplus", "\\bigotimes"],
    title: "Series",
    category: "calculus",
    keywords: ["sum", "product", "series", "求和"],
  },
  Digit6: {
    default: "\\int",
    shift: "\\iint",
    variants: ["\\iiint", "\\oint", "\\int_{}^{}", "\\int\\!\\!\\int"],
    title: "Integral",
    category: "calculus",
    keywords: ["integral", "积分"],
  },
  Digit7: {
    default: "\\lim",
    shift: "\\limsup",
    variants: ["\\liminf", "\\max", "\\min", "\\sup", "\\inf"],
    title: "Limit",
    category: "calculus",
    keywords: ["limit", "极限"],
  },
  Digit8: {
    default: "\\infty",
    shift: "\\propto",
    variants: ["\\aleph", "\\beth", "\\emptyset", "\\varnothing"],
    title: "Infinity",
    category: "relations",
    keywords: ["infinity", "infinite", "无穷"],
  },
  Digit9: {
    default: "\\left(",
    shift: "\\langle",
    variants: ["\\left[", "\\left\\{", "\\lfloor", "\\lceil", "\\left|"],
    title: "Left Fence",
    category: "structure",
    keywords: ["left", "bracket", "括号"],
  },
  Digit0: {
    default: "\\right)",
    shift: "\\rangle",
    variants: ["\\right]", "\\right\\}", "\\rfloor", "\\rceil", "\\right|"],
    title: "Right Fence",
    category: "structure",
    keywords: ["right", "bracket", "括号"],
  },

  // Top row
  KeyQ: {
    default: "\\theta",
    shift: "\\Theta",
    variants: ["\\vartheta", "\\forall", "\\angle", "\\measuredangle"],
    title: "Theta",
    category: "greek",
    keywords: ["theta", "angle", "角度"],
  },
  KeyW: {
    default: "\\omega",
    shift: "\\Omega",
    variants: ["\\varpi", "\\wedge", "\\widehat{}", "\\widetilde{}"],
    title: "Omega",
    category: "greek",
    keywords: ["omega", "wedge"],
  },
  KeyE: {
    default: "\\epsilon",
    shift: "\\exists",
    variants: ["\\varepsilon", "\\eta", "\\in", "\\notin", "\\equiv"],
    title: "Epsilon",
    category: "greek",
    keywords: ["epsilon", "exists", "element"],
  },
  KeyR: {
    default: "\\rho",
    shift: "\\mathbb{R}",
    variants: ["\\varrho", "\\Re", "\\rightarrow", "\\Rightarrow", "\\rangle"],
    title: "Rho / Reals",
    category: "greek",
    keywords: ["rho", "real", "arrow"],
  },
  KeyT: {
    default: "\\tau",
    shift: "\\times",
    variants: ["\\top", "\\otimes", "\\otimes", "\\therefore", "\\to"],
    title: "Tau / Times",
    category: "greek",
    keywords: ["tau", "times", "tensor"],
  },
  KeyY: {
    default: "\\psi",
    shift: "\\Psi",
    variants: ["\\upsilon", "\\Upsilon", "\\ket{}", "\\bra{}", "\\braket{}{}"],
    title: "Psi",
    category: "physics",
    keywords: ["psi", "wavefunction", "quantum"],
  },
  KeyU: {
    default: "\\cup",
    shift: "\\bigcup",
    variants: ["\\uplus", "\\sqcup", "\\bigcup", "\\vee", "\\uparrow"],
    title: "Union",
    category: "sets",
    keywords: ["union", "cup", "并集"],
  },
  KeyI: {
    default: "\\int",
    shift: "\\iint",
    variants: ["\\iiint", "\\oint", "\\infty", "\\in", "\\imath"],
    title: "Integral",
    category: "calculus",
    keywords: ["integral", "infinity", "积分"],
  },
  KeyO: {
    default: "\\circ",
    shift: "\\oplus",
    variants: ["\\odot", "\\ominus", "\\otimes", "\\oslash", "\\oint"],
    title: "Circle Operators",
    category: "logic",
    keywords: ["circle", "oplus", "operator"],
  },
  KeyP: {
    default: "\\pi",
    shift: "\\prod",
    variants: ["\\Pi", "\\phi", "\\Phi", "\\partial", "\\parallel"],
    title: "Pi / Product",
    category: "greek",
    keywords: ["pi", "product", "partial"],
  },

  // Home row
  KeyA: {
    default: "\\alpha",
    shift: "\\forall",
    variants: ["\\aleph", "\\angle", "\\approx", "\\arctan", "\\mathbb{A}"],
    title: "Alpha",
    category: "greek",
    keywords: ["alpha", "all", "angle"],
  },
  KeyS: {
    default: "\\sum",
    shift: "\\sigma",
    variants: ["\\Sigma", "\\sqrt{}", "\\subset", "\\subseteq", "\\sin"],
    title: "Sum / Sigma",
    category: "calculus",
    keywords: ["sum", "sigma", "subset"],
  },
  KeyD: {
    default: "\\delta",
    shift: "\\Delta",
    variants: ["\\partial", "\\nabla", "\\div", "\\dfrac{}{}", "\\dot{}"],
    title: "Delta",
    category: "greek",
    keywords: ["delta", "partial", "nabla"],
  },
  KeyF: {
    default: "\\frac{}{}",
    shift: "\\phi",
    variants: ["\\Phi", "\\varphi", "\\frac{d}{d}", "\\frac{\\partial}{\\partial}", "\\lfloor\\rfloor"],
    title: "Fraction",
    category: "structure",
    keywords: ["fraction", "phi", "分数"],
  },
  KeyG: {
    default: "\\gamma",
    shift: "\\Gamma",
    variants: ["\\nabla", "\\grad", "\\geq", "\\gg", "\\gtrsim"],
    title: "Gamma",
    category: "greek",
    keywords: ["gamma", "gradient", "greater"],
  },
  KeyH: {
    default: "\\hbar",
    shift: "\\hat{}",
    variants: ["\\hslash", "\\mathcal{H}", "\\hat{H}", "\\dagger", "\\hookrightarrow"],
    title: "H-bar / Hat",
    category: "physics",
    keywords: ["hbar", "hat", "hamiltonian"],
  },
  KeyJ: {
    default: "\\jmath",
    shift: "\\mathbb{J}",
    variants: ["\\joinrel", "\\jmath", "\\mathbf{J}"],
    title: "J",
    category: "linear-algebra",
    keywords: ["j", "current"],
  },
  KeyK: {
    default: "\\kappa",
    shift: "\\ket{}",
    variants: ["\\varkappa", "\\bra{}", "\\braket{}{}", "\\mathbb{K}"],
    title: "Kappa / Ket",
    category: "physics",
    keywords: ["kappa", "ket", "quantum"],
  },
  KeyL: {
    default: "\\lambda",
    shift: "\\Lambda",
    variants: ["\\lim", "\\log", "\\ln", "\\ell", "\\leftarrow"],
    title: "Lambda / Limit",
    category: "greek",
    keywords: ["lambda", "limit", "log"],
  },

  // Bottom row
  KeyZ: {
    default: "\\zeta",
    shift: "\\mathbb{Z}",
    variants: ["\\mathcal{Z}", "\\zeta", "\\varnothing"],
    title: "Zeta / Integers",
    category: "greek",
    keywords: ["zeta", "integers"],
  },
  KeyX: {
    default: "\\xi",
    shift: "\\Xi",
    variants: ["\\times", "\\chi", "\\otimes", "\\begin{pmatrix} & \\\\ & \\end{pmatrix}"],
    title: "Xi / Matrix",
    category: "linear-algebra",
    keywords: ["xi", "matrix", "times"],
  },
  KeyC: {
    default: "\\cap",
    shift: "\\bigcap",
    variants: ["\\cos", "\\cot", "\\csc", "\\mathbb{C}", "\\chi"],
    title: "Intersection",
    category: "sets",
    keywords: ["cap", "intersection", "complex"],
  },
  KeyV: {
    default: "\\vec{}",
    shift: "\\mathbf{}",
    variants: ["\\bar{}", "\\overline{}", "\\begin{pmatrix} \\\\ \\end{pmatrix}", "\\vee", "\\downarrow"],
    title: "Vector",
    category: "linear-algebra",
    keywords: ["vector", "vec", "向量"],
  },
  KeyB: {
    default: "\\beta",
    shift: "\\bar{}",
    variants: ["\\mathbb{B}", "\\bot", "\\because", "\\begin{cases}  &  \\\\  &  \\end{cases}"],
    title: "Beta / Bar",
    category: "greek",
    keywords: ["beta", "bar", "cases"],
  },
  KeyN: {
    default: "\\nu",
    shift: "\\mathbb{N}",
    variants: ["\\nabla", "\\neg", "\\not", "\\neq", "\\norm{}"],
    title: "Nu / Naturals",
    category: "greek",
    keywords: ["nu", "natural", "not"],
  },
  KeyM: {
    default: "\\mu",
    shift: "\\begin{pmatrix} & \\\\ & \\end{pmatrix}",
    variants: ["\\begin{bmatrix} & \\\\ & \\end{bmatrix}", "\\begin{matrix} & \\\\ & \\end{matrix}", "\\pm", "\\mp", "\\mod"],
    title: "Mu / Matrix",
    category: "linear-algebra",
    keywords: ["mu", "matrix", "矩阵"],
  },
};

// ============================================================================
// Keymap Validation
// ============================================================================

export interface ValidationError {
  keyCode: string;
  field: string;
  message: string;
}

/**
 * Validates that a LaTeX command is usable as a direct insertion token.
 */
export function isValidLatexCommand(command: string): boolean {
  if (!command || typeof command !== "string") return false;
  const trimmed = command.trim();
  return trimmed.startsWith("\\") || trimmed.startsWith("^") || trimmed.startsWith("_");
}

/**
 * Validates the entire keymap configuration.
 */
export function validateKeymap(keymap: QuantumKeymap): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [keyCode, mapping] of Object.entries(keymap)) {
    if (!mapping.default) {
      errors.push({
        keyCode,
        field: "default",
        message: "Default symbol is required",
      });
    } else if (!isValidLatexCommand(mapping.default)) {
      errors.push({
        keyCode,
        field: "default",
        message: `Invalid LaTeX command: ${mapping.default}`,
      });
    }

    if (mapping.shift !== undefined && !isValidLatexCommand(mapping.shift)) {
      errors.push({
        keyCode,
        field: "shift",
        message: `Invalid LaTeX command: ${mapping.shift}`,
      });
    }

    if (mapping.variants !== undefined) {
      if (!Array.isArray(mapping.variants)) {
        errors.push({
          keyCode,
          field: "variants",
          message: "Variants must be an array",
        });
      } else {
        mapping.variants.forEach((variant, index) => {
          if (!isValidLatexCommand(variant)) {
            errors.push({
              keyCode,
              field: `variants[${index}]`,
              message: `Invalid LaTeX command: ${variant}`,
            });
          }
        });
      }
    }
  }

  return errors;
}

/**
 * Get the symbol to display for a key based on current state.
 */
export function getDisplaySymbol(keyCode: string, isShiftHeld: boolean): string | null {
  const mapping = quantumKeymap[keyCode];
  if (!mapping) return null;

  if (isShiftHeld && mapping.shift) {
    return mapping.shift;
  }
  return mapping.default;
}

/**
 * Check if a key has variants available.
 */
export function hasVariants(keyCode: string): boolean {
  const mapping = quantumKeymap[keyCode];
  return mapping?.variants !== undefined && mapping.variants.length > 0;
}

/**
 * Get variants for a key.
 */
export function getVariants(keyCode: string): string[] {
  const mapping = quantumKeymap[keyCode];
  return mapping?.variants ?? [];
}
