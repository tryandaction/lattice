"use client";

/**
 * MathSymbolPalette - Mathematical Symbol Picker
 *
 * Provides quick access to 100+ mathematical symbols organized by category.
 * Integrates with MathEditor for seamless symbol insertion.
 *
 * Features:
 * - 6 categories: Greek, Operators, Relations, Arrows, Logic, Sets
 * - Click to insert symbol into MathLive
 * - Keyboard shortcut: Ctrl+Shift+M to toggle
 * - Floating panel with grid layout
 * - Search functionality
 * - Hover tooltips showing LaTeX code
 */

import { useState, useEffect, useRef } from 'react';
import { X, Search } from 'lucide-react';

export interface MathSymbolPaletteProps {
  /** Callback when user clicks a symbol */
  onInsert: (latex: string) => void;

  /** Callback to close the palette */
  onClose: () => void;

  /** Whether the palette is visible */
  isOpen: boolean;
}

/**
 * Symbol categories with Unicode symbols and LaTeX mappings
 */
const SYMBOL_CATEGORIES = {
  Greek: {
    name: 'Greek Letters',
    symbols: [
      { symbol: 'α', latex: '\\alpha', name: 'alpha' },
      { symbol: 'β', latex: '\\beta', name: 'beta' },
      { symbol: 'γ', latex: '\\gamma', name: 'gamma' },
      { symbol: 'δ', latex: '\\delta', name: 'delta' },
      { symbol: 'ε', latex: '\\epsilon', name: 'epsilon' },
      { symbol: 'ζ', latex: '\\zeta', name: 'zeta' },
      { symbol: 'η', latex: '\\eta', name: 'eta' },
      { symbol: 'θ', latex: '\\theta', name: 'theta' },
      { symbol: 'ι', latex: '\\iota', name: 'iota' },
      { symbol: 'κ', latex: '\\kappa', name: 'kappa' },
      { symbol: 'λ', latex: '\\lambda', name: 'lambda' },
      { symbol: 'μ', latex: '\\mu', name: 'mu' },
      { symbol: 'ν', latex: '\\nu', name: 'nu' },
      { symbol: 'ξ', latex: '\\xi', name: 'xi' },
      { symbol: 'π', latex: '\\pi', name: 'pi' },
      { symbol: 'ρ', latex: '\\rho', name: 'rho' },
      { symbol: 'σ', latex: '\\sigma', name: 'sigma' },
      { symbol: 'τ', latex: '\\tau', name: 'tau' },
      { symbol: 'υ', latex: '\\upsilon', name: 'upsilon' },
      { symbol: 'φ', latex: '\\phi', name: 'phi' },
      { symbol: 'χ', latex: '\\chi', name: 'chi' },
      { symbol: 'ψ', latex: '\\psi', name: 'psi' },
      { symbol: 'ω', latex: '\\omega', name: 'omega' },
      { symbol: 'Γ', latex: '\\Gamma', name: 'Gamma' },
      { symbol: 'Δ', latex: '\\Delta', name: 'Delta' },
      { symbol: 'Θ', latex: '\\Theta', name: 'Theta' },
      { symbol: 'Λ', latex: '\\Lambda', name: 'Lambda' },
      { symbol: 'Ξ', latex: '\\Xi', name: 'Xi' },
      { symbol: 'Π', latex: '\\Pi', name: 'Pi' },
      { symbol: 'Σ', latex: '\\Sigma', name: 'Sigma' },
      { symbol: 'Φ', latex: '\\Phi', name: 'Phi' },
      { symbol: 'Ψ', latex: '\\Psi', name: 'Psi' },
      { symbol: 'Ω', latex: '\\Omega', name: 'Omega' },
    ],
  },
  Operators: {
    name: 'Operators',
    symbols: [
      { symbol: '∑', latex: '\\sum', name: 'sum' },
      { symbol: '∏', latex: '\\prod', name: 'product' },
      { symbol: '∫', latex: '\\int', name: 'integral' },
      { symbol: '∮', latex: '\\oint', name: 'contour integral' },
      { symbol: '∂', latex: '\\partial', name: 'partial' },
      { symbol: '∇', latex: '\\nabla', name: 'nabla' },
      { symbol: '±', latex: '\\pm', name: 'plus-minus' },
      { symbol: '∓', latex: '\\mp', name: 'minus-plus' },
      { symbol: '×', latex: '\\times', name: 'times' },
      { symbol: '÷', latex: '\\div', name: 'divide' },
      { symbol: '·', latex: '\\cdot', name: 'dot' },
      { symbol: '∘', latex: '\\circ', name: 'circle' },
      { symbol: '√', latex: '\\sqrt{}', name: 'square root' },
      { symbol: '∛', latex: '\\sqrt[3]{}', name: 'cube root' },
      { symbol: '∜', latex: '\\sqrt[4]{}', name: 'fourth root' },
      { symbol: '∞', latex: '\\infty', name: 'infinity' },
    ],
  },
  Relations: {
    name: 'Relations',
    symbols: [
      { symbol: '≤', latex: '\\leq', name: 'less than or equal' },
      { symbol: '≥', latex: '\\geq', name: 'greater than or equal' },
      { symbol: '≠', latex: '\\neq', name: 'not equal' },
      { symbol: '≈', latex: '\\approx', name: 'approximately' },
      { symbol: '≡', latex: '\\equiv', name: 'equivalent' },
      { symbol: '∈', latex: '\\in', name: 'element of' },
      { symbol: '∉', latex: '\\notin', name: 'not element of' },
      { symbol: '⊂', latex: '\\subset', name: 'subset' },
      { symbol: '⊃', latex: '\\supset', name: 'superset' },
      { symbol: '⊆', latex: '\\subseteq', name: 'subset or equal' },
      { symbol: '⊇', latex: '\\supseteq', name: 'superset or equal' },
      { symbol: '∝', latex: '\\propto', name: 'proportional' },
      { symbol: '∼', latex: '\\sim', name: 'similar' },
      { symbol: '≅', latex: '\\cong', name: 'congruent' },
      { symbol: '⊥', latex: '\\perp', name: 'perpendicular' },
      { symbol: '∥', latex: '\\parallel', name: 'parallel' },
    ],
  },
  Arrows: {
    name: 'Arrows',
    symbols: [
      { symbol: '→', latex: '\\to', name: 'right arrow' },
      { symbol: '←', latex: '\\leftarrow', name: 'left arrow' },
      { symbol: '↔', latex: '\\leftrightarrow', name: 'left-right arrow' },
      { symbol: '⇒', latex: '\\Rightarrow', name: 'implies' },
      { symbol: '⇐', latex: '\\Leftarrow', name: 'implied by' },
      { symbol: '⇔', latex: '\\Leftrightarrow', name: 'if and only if' },
      { symbol: '↑', latex: '\\uparrow', name: 'up arrow' },
      { symbol: '↓', latex: '\\downarrow', name: 'down arrow' },
      { symbol: '↗', latex: '\\nearrow', name: 'northeast arrow' },
      { symbol: '↘', latex: '\\searrow', name: 'southeast arrow' },
      { symbol: '↖', latex: '\\nwarrow', name: 'northwest arrow' },
      { symbol: '↙', latex: '\\swarrow', name: 'southwest arrow' },
      { symbol: '↦', latex: '\\mapsto', name: 'maps to' },
      { symbol: '⟶', latex: '\\longrightarrow', name: 'long right arrow' },
      { symbol: '⟵', latex: '\\longleftarrow', name: 'long left arrow' },
      { symbol: '⟷', latex: '\\longleftrightarrow', name: 'long left-right arrow' },
    ],
  },
  Logic: {
    name: 'Logic',
    symbols: [
      { symbol: '∀', latex: '\\forall', name: 'for all' },
      { symbol: '∃', latex: '\\exists', name: 'exists' },
      { symbol: '∄', latex: '\\nexists', name: 'not exists' },
      { symbol: '∧', latex: '\\land', name: 'and' },
      { symbol: '∨', latex: '\\lor', name: 'or' },
      { symbol: '¬', latex: '\\neg', name: 'not' },
      { symbol: '⊕', latex: '\\oplus', name: 'xor' },
      { symbol: '⊗', latex: '\\otimes', name: 'tensor product' },
      { symbol: '⊤', latex: '\\top', name: 'top' },
      { symbol: '⊥', latex: '\\bot', name: 'bottom' },
      { symbol: '⊢', latex: '\\vdash', name: 'proves' },
      { symbol: '⊨', latex: '\\models', name: 'models' },
    ],
  },
  Sets: {
    name: 'Sets',
    symbols: [
      { symbol: '∅', latex: '\\emptyset', name: 'empty set' },
      { symbol: 'ℕ', latex: '\\mathbb{N}', name: 'natural numbers' },
      { symbol: 'ℤ', latex: '\\mathbb{Z}', name: 'integers' },
      { symbol: 'ℚ', latex: '\\mathbb{Q}', name: 'rational numbers' },
      { symbol: 'ℝ', latex: '\\mathbb{R}', name: 'real numbers' },
      { symbol: 'ℂ', latex: '\\mathbb{C}', name: 'complex numbers' },
      { symbol: '∪', latex: '\\cup', name: 'union' },
      { symbol: '∩', latex: '\\cap', name: 'intersection' },
      { symbol: '∖', latex: '\\setminus', name: 'set difference' },
      { symbol: '△', latex: '\\triangle', name: 'symmetric difference' },
      { symbol: '⊎', latex: '\\uplus', name: 'multiset union' },
      { symbol: '⊔', latex: '\\sqcup', name: 'square union' },
    ],
  },
} as const;

/**
 * MathSymbolPalette Component
 */
export function MathSymbolPalette({ onInsert, onClose, isOpen }: MathSymbolPaletteProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<keyof typeof SYMBOL_CATEGORIES>('Greek');
  const paletteRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (paletteRef.current && !paletteRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Add listener after a brief delay to avoid immediate trigger
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Filter symbols based on search query
  const getFilteredSymbols = () => {
    if (!searchQuery) {
      return SYMBOL_CATEGORIES[activeCategory].symbols;
    }

    const query = searchQuery.toLowerCase();
    return SYMBOL_CATEGORIES[activeCategory].symbols.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.latex.toLowerCase().includes(query) ||
        s.symbol.includes(query)
    );
  };

  const filteredSymbols = getFilteredSymbols();

  return (
    <div
      ref={paletteRef}
      className="math-symbol-palette"
      style={{
        position: 'fixed',
        right: '20px',
        top: '100px',
        width: '320px',
        maxHeight: '600px',
        zIndex: 999,
      }}
    >
      <div className="palette-container">
        {/* Header */}
        <div className="palette-header">
          <h3 className="palette-title">Math Symbols</h3>
          <button
            onClick={onClose}
            className="palette-close"
            aria-label="Close symbol palette"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="palette-search">
          <Search className="h-4 w-4 search-icon" />
          <input
            type="text"
            placeholder="Search symbols..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>

        {/* Category Tabs */}
        <div className="category-tabs">
          {(Object.keys(SYMBOL_CATEGORIES) as Array<keyof typeof SYMBOL_CATEGORIES>).map(
            (category) => (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                className={`category-tab ${activeCategory === category ? 'active' : ''}`}
              >
                {category}
              </button>
            )
          )}
        </div>

        {/* Symbol Grid */}
        <div className="symbol-grid-container">
          <h4 className="category-name">{SYMBOL_CATEGORIES[activeCategory].name}</h4>
          <div className="symbol-grid">
            {filteredSymbols.map((item) => (
              <button
                key={item.latex}
                onClick={() => onInsert(item.latex)}
                className="symbol-button"
                title={`${item.name}\n${item.latex}`}
              >
                {item.symbol}
              </button>
            ))}
          </div>
          {filteredSymbols.length === 0 && (
            <div className="no-results">No symbols found</div>
          )}
        </div>

        {/* Footer hint */}
        <div className="palette-footer">
          <span className="footer-hint">Click symbol to insert • Esc to close</span>
        </div>
      </div>

      <style jsx>{`
        .palette-container {
          background: white;
          border: 1px solid hsl(var(--border));
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .palette-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid hsl(var(--border));
          background: hsl(var(--muted) / 0.3);
        }

        .palette-title {
          font-size: 16px;
          font-weight: 600;
          color: hsl(var(--foreground));
          margin: 0;
        }

        .palette-close {
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          color: hsl(var(--muted-foreground));
          transition: all 0.2s;
        }

        .palette-close:hover {
          background: hsl(var(--accent));
          color: hsl(var(--foreground));
        }

        .palette-search {
          position: relative;
          padding: 12px 16px;
          border-bottom: 1px solid hsl(var(--border));
        }

        .search-icon {
          position: absolute;
          left: 24px;
          top: 50%;
          transform: translateY(-50%);
          color: hsl(var(--muted-foreground));
        }

        .search-input {
          width: 100%;
          padding: 8px 12px 8px 32px;
          border: 1px solid hsl(var(--border));
          border-radius: 4px;
          font-size: 14px;
          background: hsl(var(--background));
          color: hsl(var(--foreground));
        }

        .search-input:focus {
          outline: 2px solid hsl(var(--ring));
          outline-offset: 2px;
        }

        .category-tabs {
          display: flex;
          gap: 4px;
          padding: 8px 12px;
          border-bottom: 1px solid hsl(var(--border));
          overflow-x: auto;
          background: hsl(var(--muted) / 0.2);
        }

        .category-tab {
          padding: 6px 12px;
          border: none;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          white-space: nowrap;
          background: transparent;
          color: hsl(var(--muted-foreground));
          transition: all 0.2s;
        }

        .category-tab:hover {
          background: hsl(var(--accent));
          color: hsl(var(--foreground));
        }

        .category-tab.active {
          background: hsl(var(--primary));
          color: hsl(var(--primary-foreground));
        }

        .symbol-grid-container {
          padding: 16px;
          overflow-y: auto;
          max-height: 400px;
        }

        .category-name {
          font-size: 14px;
          font-weight: 600;
          color: hsl(var(--foreground));
          margin: 0 0 12px 0;
        }

        .symbol-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 6px;
        }

        .symbol-button {
          aspect-ratio: 1;
          border: 1px solid hsl(var(--border));
          border-radius: 4px;
          background: hsl(var(--background));
          cursor: pointer;
          font-size: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          color: hsl(var(--foreground));
        }

        .symbol-button:hover {
          background: hsl(var(--accent));
          transform: scale(1.1);
          border-color: hsl(var(--primary));
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .symbol-button:active {
          transform: scale(0.95);
        }

        .no-results {
          text-align: center;
          padding: 32px;
          color: hsl(var(--muted-foreground));
          font-size: 14px;
        }

        .palette-footer {
          padding: 8px 16px;
          border-top: 1px solid hsl(var(--border));
          background: hsl(var(--muted) / 0.2);
        }

        .footer-hint {
          font-size: 12px;
          color: hsl(var(--muted-foreground));
        }

        /* Dark mode support */
        @media (prefers-color-scheme: dark) {
          .palette-container {
            background: hsl(var(--background));
          }
        }

        /* Scrollbar styling */
        .symbol-grid-container::-webkit-scrollbar {
          width: 8px;
        }

        .symbol-grid-container::-webkit-scrollbar-track {
          background: hsl(var(--muted) / 0.2);
        }

        .symbol-grid-container::-webkit-scrollbar-thumb {
          background: hsl(var(--muted-foreground) / 0.3);
          border-radius: 4px;
        }

        .symbol-grid-container::-webkit-scrollbar-thumb:hover {
          background: hsl(var(--muted-foreground) / 0.5);
        }
      `}</style>
    </div>
  );
}
