/**
 * Quantum Keymap Configuration
 * Maps physical keyboard keys to mathematical LaTeX symbols
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Represents a single key mapping with default, shift, and variant symbols
 */
export interface KeyMapping {
  /** Default LaTeX command when key is pressed */
  default: string;
  /** LaTeX command when Shift is held (optional) */
  shift?: string;
  /** Array of variant LaTeX commands for deep selection (optional) */
  variants?: string[];
  /** Optional display label override for the physical key */
  label?: string;
}

/**
 * Complete keymap mapping key codes to their symbol configurations
 */
export type QuantumKeymap = Record<string, KeyMapping>;

/**
 * Keyboard layout row definition
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
  { keys: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'], offset: 0 },
  { keys: ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'], offset: 0.5 },
  { keys: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL'], offset: 0.75 },
  { keys: ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM'], offset: 1.25 },
];

/**
 * Map key codes to their physical labels
 */
export const KEY_LABELS: Record<string, string> = {
  Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5',
  Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9', Digit0: '0',
  KeyQ: 'Q', KeyW: 'W', KeyE: 'E', KeyR: 'R', KeyT: 'T',
  KeyY: 'Y', KeyU: 'U', KeyI: 'I', KeyO: 'O', KeyP: 'P',
  KeyA: 'A', KeyS: 'S', KeyD: 'D', KeyF: 'F', KeyG: 'G',
  KeyH: 'H', KeyJ: 'J', KeyK: 'K', KeyL: 'L',
  KeyZ: 'Z', KeyX: 'X', KeyC: 'C', KeyV: 'V', KeyB: 'B',
  KeyN: 'N', KeyM: 'M',
};

// ============================================================================
// Quantum Keymap - Mathematical Symbol Mappings
// ============================================================================

export const quantumKeymap: QuantumKeymap = {
  // Number row - Superscripts, subscripts, and special numbers
  Digit1: {
    default: '^{1}',
    shift: '_{1}',
    variants: ['\\mathbb{1}', '\\hat{1}'],
  },
  Digit2: {
    default: '^{2}',
    shift: '_{2}',
    variants: ['\\sqrt{}', '\\mathbb{2}'],
  },
  Digit3: {
    default: '^{3}',
    shift: '_{3}',
    variants: ['\\sqrt[3]{}', '\\mathbb{3}'],
  },
  Digit4: {
    default: '^{4}',
    shift: '_{4}',
    variants: ['\\sqrt[4]{}'],
  },
  Digit5: {
    default: '^{5}',
    shift: '_{5}',
  },
  Digit6: {
    default: '^{6}',
    shift: '_{6}',
  },
  Digit7: {
    default: '^{7}',
    shift: '_{7}',
  },
  Digit8: {
    default: '\\infty',
    shift: '\\propto',
    variants: ['\\aleph', '\\beth'],
  },
  Digit9: {
    default: '\\left(',
    shift: '\\langle',
    variants: ['\\lfloor', '\\lceil', '\\{'],
  },
  Digit0: {
    default: '\\right)',
    shift: '\\rangle',
    variants: ['\\rfloor', '\\rceil', '\\}'],
  },

  // Top row - Q W E R T Y U I O P
  KeyQ: {
    default: '\\theta',
    shift: '\\Theta',
    variants: ['\\vartheta'],
  },
  KeyW: {
    default: '\\omega',
    shift: '\\Omega',
    variants: ['\\varpi'],
  },
  KeyE: {
    default: '\\epsilon',
    shift: '\\exists',
    variants: ['\\varepsilon', '\\in', '\\notin', '\\eta'],
  },
  KeyR: {
    default: '\\rho',
    shift: '\\mathbb{R}',
    variants: ['\\varrho', '\\Re'],
  },
  KeyT: {
    default: '\\tau',
    shift: '\\top',
    variants: ['\\times', '\\otimes'],
  },
  KeyY: {
    default: '\\psi',
    shift: '\\Psi',
    variants: ['\\upsilon', '\\Upsilon'],
  },
  KeyU: {
    default: '\\cup',
    shift: '\\bigcup',
    variants: ['\\uplus', '\\sqcup'],
  },
  KeyI: {
    default: '\\int',
    shift: '\\infty',
    variants: ['\\iint', '\\iiint', '\\oint', '\\imath'],
  },
  KeyO: {
    default: '\\circ',
    shift: '\\odot',
    variants: ['\\oplus', '\\ominus', '\\otimes', '\\oslash'],
  },
  KeyP: {
    default: '\\pi',
    shift: '\\prod',
    variants: ['\\Pi', '\\phi', '\\Phi', '\\partial'],
  },

  // Home row - A S D F G H J K L
  KeyA: {
    default: '\\alpha',
    shift: '\\forall',
    variants: ['\\angle', '\\measuredangle'],
  },
  KeyS: {
    default: '\\sum',
    shift: '\\sigma',
    variants: ['\\Sigma', '\\sqrt{}', '\\sin', '\\subset', '\\supset'],
  },
  KeyD: {
    default: '\\delta',
    shift: '\\Delta',
    variants: ['\\partial', '\\nabla', '\\div'],
  },
  KeyF: {
    default: '\\frac{}{}',
    shift: '\\phi',
    variants: ['\\Phi', '\\varphi'],
  },
  KeyG: {
    default: '\\gamma',
    shift: '\\Gamma',
    variants: ['\\grad', '\\nabla'],
  },
  KeyH: {
    default: '\\hbar',
    shift: '\\mathbb{H}',
    variants: ['\\hat{}', '\\hslash'],
  },
  KeyJ: {
    default: '\\jmath',
    shift: '\\mathbb{J}',
  },
  KeyK: {
    default: '\\kappa',
    shift: '\\mathbb{K}',
    variants: ['\\varkappa'],
  },
  KeyL: {
    default: '\\lambda',
    shift: '\\Lambda',
    variants: ['\\lim', '\\log', '\\ln', '\\ell'],
  },

  // Bottom row - Z X C V B N M
  KeyZ: {
    default: '\\zeta',
    shift: '\\mathbb{Z}',
  },
  KeyX: {
    default: '\\xi',
    shift: '\\Xi',
    variants: ['\\times', '\\chi'],
  },
  KeyC: {
    default: '\\cap',
    shift: '\\bigcap',
    variants: ['\\cos', '\\cot', '\\csc', '\\mathbb{C}'],
  },
  KeyV: {
    default: '\\vec{}',
    shift: '\\vee',
    variants: ['\\sqrt{}', '\\downarrow', '\\Downarrow'],
  },
  KeyB: {
    default: '\\beta',
    shift: '\\bot',
    variants: ['\\bar{}', '\\mathbb{B}'],
  },
  KeyN: {
    default: '\\nu',
    shift: '\\mathbb{N}',
    variants: ['\\neg', '\\not', '\\nabla'],
  },
  KeyM: {
    default: '\\mu',
    shift: '\\mp',
    variants: ['\\matrix{}', '\\mod'],
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
 * Validates that a LaTeX command is properly formatted
 * @param command The LaTeX command to validate
 * @returns true if valid, false otherwise
 */
export function isValidLatexCommand(command: string): boolean {
  if (!command || typeof command !== 'string') return false;
  // Must start with backslash OR be a simple expression like ^{} or _{}
  return command.startsWith('\\') || command.startsWith('^') || command.startsWith('_');
}

/**
 * Validates the entire keymap configuration
 * @param keymap The keymap to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateKeymap(keymap: QuantumKeymap): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [keyCode, mapping] of Object.entries(keymap)) {
    // Validate default (required)
    if (!mapping.default) {
      errors.push({
        keyCode,
        field: 'default',
        message: 'Default symbol is required',
      });
    } else if (!isValidLatexCommand(mapping.default)) {
      errors.push({
        keyCode,
        field: 'default',
        message: `Invalid LaTeX command: ${mapping.default}`,
      });
    }

    // Validate shift (optional)
    if (mapping.shift !== undefined && !isValidLatexCommand(mapping.shift)) {
      errors.push({
        keyCode,
        field: 'shift',
        message: `Invalid LaTeX command: ${mapping.shift}`,
      });
    }

    // Validate variants (optional array)
    if (mapping.variants !== undefined) {
      if (!Array.isArray(mapping.variants)) {
        errors.push({
          keyCode,
          field: 'variants',
          message: 'Variants must be an array',
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
 * Get the symbol to display for a key based on current state
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
 * Check if a key has variants available
 */
export function hasVariants(keyCode: string): boolean {
  const mapping = quantumKeymap[keyCode];
  return mapping?.variants !== undefined && mapping.variants.length > 0;
}

/**
 * Get variants for a key
 */
export function getVariants(keyCode: string): string[] {
  const mapping = quantumKeymap[keyCode];
  return mapping?.variants ?? [];
}
