"use client";

/**
 * MathSymbolPalette - searchable, structure-first formula palette.
 *
 * It is the discoverable companion to the Quantum Keyboard: users can search
 * by name or LaTeX, then insert the same reliable commands into MathLive.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { UI_LAYER_CLASS } from "@/lib/ui-layers";

export interface MathSymbolPaletteProps {
  /** Callback when user clicks a symbol */
  onInsert: (latex: string) => void;

  /** Callback to close the palette */
  onClose: () => void;

  /** Whether the palette is visible */
  isOpen: boolean;
}

type SymbolCategory =
  | "Common"
  | "Structures"
  | "Greek"
  | "Calculus"
  | "Linear"
  | "Relations"
  | "Sets"
  | "Logic"
  | "Arrows"
  | "Physics";

interface MathSymbolItem {
  symbol: string;
  latex: string;
  name: string;
  keywords?: string[];
}

const SYMBOL_CATEGORIES: Record<SymbolCategory, { name: string; symbols: MathSymbolItem[] }> = {
  Common: {
    name: "常用",
    symbols: [
      { symbol: "x/y", latex: "\\frac{}{}", name: "fraction", keywords: ["分数", "divide"] },
      { symbol: "√", latex: "\\sqrt{}", name: "square root", keywords: ["根号", "root"] },
      { symbol: "x²", latex: "^{ }", name: "superscript", keywords: ["上标", "power"] },
      { symbol: "xᵢ", latex: "_{ }", name: "subscript", keywords: ["下标", "index"] },
      { symbol: "Σ", latex: "\\sum_{}^{}", name: "summation", keywords: ["求和", "series"] },
      { symbol: "∫", latex: "\\int_{}^{}", name: "integral", keywords: ["积分"] },
      { symbol: "lim", latex: "\\lim_{}", name: "limit", keywords: ["极限"] },
      { symbol: "∞", latex: "\\infty", name: "infinity", keywords: ["无穷"] },
      { symbol: "→", latex: "\\to", name: "to", keywords: ["arrow"] },
      { symbol: "≈", latex: "\\approx", name: "approximately", keywords: ["约等于"] },
    ],
  },
  Structures: {
    name: "结构",
    symbols: [
      { symbol: "a/b", latex: "\\frac{}{}", name: "fraction", keywords: ["分数"] },
      { symbol: "d/dx", latex: "\\frac{d}{d}", name: "derivative", keywords: ["导数"] },
      { symbol: "∂/∂x", latex: "\\frac{\\partial}{\\partial}", name: "partial derivative", keywords: ["偏导"] },
      { symbol: "√x", latex: "\\sqrt{}", name: "square root", keywords: ["根号"] },
      { symbol: "ⁿ√x", latex: "\\sqrt[]{}", name: "nth root", keywords: ["n次根"] },
      { symbol: "( )", latex: "\\left(\\right)", name: "parentheses", keywords: ["括号"] },
      { symbol: "[ ]", latex: "\\left[\\right]", name: "brackets", keywords: ["方括号"] },
      { symbol: "{ }", latex: "\\left\\{\\right\\}", name: "braces", keywords: ["花括号"] },
      { symbol: "|x|", latex: "\\left|\\right|", name: "absolute value", keywords: ["绝对值"] },
      { symbol: "||x||", latex: "\\left\\|\\right\\|", name: "norm", keywords: ["范数"] },
      { symbol: "2x2", latex: "\\begin{pmatrix} & \\\\ & \\end{pmatrix}", name: "2 by 2 matrix", keywords: ["矩阵"] },
      { symbol: "{", latex: "\\begin{cases}  &  \\\\  &  \\end{cases}", name: "cases", keywords: ["分段"] },
    ],
  },
  Greek: {
    name: "希腊",
    symbols: [
      { symbol: "α", latex: "\\alpha", name: "alpha" },
      { symbol: "β", latex: "\\beta", name: "beta" },
      { symbol: "γ", latex: "\\gamma", name: "gamma" },
      { symbol: "Γ", latex: "\\Gamma", name: "Gamma" },
      { symbol: "δ", latex: "\\delta", name: "delta" },
      { symbol: "Δ", latex: "\\Delta", name: "Delta" },
      { symbol: "ε", latex: "\\epsilon", name: "epsilon" },
      { symbol: "η", latex: "\\eta", name: "eta" },
      { symbol: "θ", latex: "\\theta", name: "theta" },
      { symbol: "Θ", latex: "\\Theta", name: "Theta" },
      { symbol: "κ", latex: "\\kappa", name: "kappa" },
      { symbol: "λ", latex: "\\lambda", name: "lambda" },
      { symbol: "Λ", latex: "\\Lambda", name: "Lambda" },
      { symbol: "μ", latex: "\\mu", name: "mu" },
      { symbol: "ν", latex: "\\nu", name: "nu" },
      { symbol: "ξ", latex: "\\xi", name: "xi" },
      { symbol: "Ξ", latex: "\\Xi", name: "Xi" },
      { symbol: "π", latex: "\\pi", name: "pi" },
      { symbol: "Π", latex: "\\Pi", name: "Pi" },
      { symbol: "ρ", latex: "\\rho", name: "rho" },
      { symbol: "σ", latex: "\\sigma", name: "sigma" },
      { symbol: "Σ", latex: "\\Sigma", name: "Sigma" },
      { symbol: "τ", latex: "\\tau", name: "tau" },
      { symbol: "φ", latex: "\\phi", name: "phi" },
      { symbol: "Φ", latex: "\\Phi", name: "Phi" },
      { symbol: "ψ", latex: "\\psi", name: "psi" },
      { symbol: "Ψ", latex: "\\Psi", name: "Psi" },
      { symbol: "ω", latex: "\\omega", name: "omega" },
      { symbol: "Ω", latex: "\\Omega", name: "Omega" },
    ],
  },
  Calculus: {
    name: "微积分",
    symbols: [
      { symbol: "∫", latex: "\\int", name: "integral", keywords: ["积分"] },
      { symbol: "∬", latex: "\\iint", name: "double integral" },
      { symbol: "∭", latex: "\\iiint", name: "triple integral" },
      { symbol: "∮", latex: "\\oint", name: "contour integral" },
      { symbol: "Σ", latex: "\\sum_{}^{}", name: "sum", keywords: ["求和"] },
      { symbol: "Π", latex: "\\prod_{}^{}", name: "product" },
      { symbol: "lim", latex: "\\lim_{}", name: "limit", keywords: ["极限"] },
      { symbol: "∂", latex: "\\partial", name: "partial" },
      { symbol: "∇", latex: "\\nabla", name: "nabla" },
      { symbol: "∞", latex: "\\infty", name: "infinity" },
      { symbol: "dx", latex: "\\,dx", name: "d x" },
      { symbol: "dy", latex: "\\,dy", name: "d y" },
    ],
  },
  Linear: {
    name: "线代",
    symbols: [
      { symbol: "v⃗", latex: "\\vec{}", name: "vector", keywords: ["向量"] },
      { symbol: "x̄", latex: "\\bar{}", name: "bar" },
      { symbol: "x̂", latex: "\\hat{}", name: "hat" },
      { symbol: "Aᵀ", latex: "^{T}", name: "transpose" },
      { symbol: "A†", latex: "^{\\dagger}", name: "dagger" },
      { symbol: "det", latex: "\\det", name: "determinant" },
      { symbol: "tr", latex: "\\tr", name: "trace" },
      { symbol: "rank", latex: "\\rank", name: "rank" },
      { symbol: "diag", latex: "\\diag", name: "diagonal" },
      { symbol: "pmat", latex: "\\begin{pmatrix} & \\\\ & \\end{pmatrix}", name: "parentheses matrix" },
      { symbol: "bmat", latex: "\\begin{bmatrix} & \\\\ & \\end{bmatrix}", name: "bracket matrix" },
      { symbol: "‖x‖", latex: "\\norm{}", name: "norm" },
    ],
  },
  Relations: {
    name: "关系",
    symbols: [
      { symbol: "≤", latex: "\\leq", name: "less or equal" },
      { symbol: "≥", latex: "\\geq", name: "greater or equal" },
      { symbol: "≠", latex: "\\neq", name: "not equal" },
      { symbol: "≈", latex: "\\approx", name: "approximately" },
      { symbol: "≡", latex: "\\equiv", name: "equivalent" },
      { symbol: "∝", latex: "\\propto", name: "proportional" },
      { symbol: "∼", latex: "\\sim", name: "similar" },
      { symbol: "≅", latex: "\\cong", name: "congruent" },
      { symbol: "⊥", latex: "\\perp", name: "perpendicular" },
      { symbol: "∥", latex: "\\parallel", name: "parallel" },
      { symbol: "≪", latex: "\\ll", name: "much less" },
      { symbol: "≫", latex: "\\gg", name: "much greater" },
    ],
  },
  Sets: {
    name: "集合",
    symbols: [
      { symbol: "∅", latex: "\\emptyset", name: "empty set" },
      { symbol: "∈", latex: "\\in", name: "in" },
      { symbol: "∉", latex: "\\notin", name: "not in" },
      { symbol: "⊂", latex: "\\subset", name: "subset" },
      { symbol: "⊆", latex: "\\subseteq", name: "subset equal" },
      { symbol: "⊃", latex: "\\supset", name: "superset" },
      { symbol: "⊇", latex: "\\supseteq", name: "superset equal" },
      { symbol: "∪", latex: "\\cup", name: "union" },
      { symbol: "∩", latex: "\\cap", name: "intersection" },
      { symbol: "ℕ", latex: "\\mathbb{N}", name: "natural numbers" },
      { symbol: "ℤ", latex: "\\mathbb{Z}", name: "integers" },
      { symbol: "ℚ", latex: "\\mathbb{Q}", name: "rationals" },
      { symbol: "ℝ", latex: "\\mathbb{R}", name: "reals" },
      { symbol: "ℂ", latex: "\\mathbb{C}", name: "complex" },
    ],
  },
  Logic: {
    name: "逻辑",
    symbols: [
      { symbol: "∀", latex: "\\forall", name: "for all" },
      { symbol: "∃", latex: "\\exists", name: "exists" },
      { symbol: "¬", latex: "\\neg", name: "not" },
      { symbol: "∧", latex: "\\land", name: "and" },
      { symbol: "∨", latex: "\\lor", name: "or" },
      { symbol: "⇒", latex: "\\Rightarrow", name: "implies" },
      { symbol: "⇔", latex: "\\Leftrightarrow", name: "if and only if" },
      { symbol: "⊢", latex: "\\vdash", name: "proves" },
      { symbol: "⊨", latex: "\\models", name: "models" },
      { symbol: "⊕", latex: "\\oplus", name: "oplus" },
      { symbol: "⊗", latex: "\\otimes", name: "tensor" },
      { symbol: "⊥", latex: "\\bot", name: "bottom" },
    ],
  },
  Arrows: {
    name: "箭头",
    symbols: [
      { symbol: "→", latex: "\\to", name: "to" },
      { symbol: "←", latex: "\\leftarrow", name: "left arrow" },
      { symbol: "↔", latex: "\\leftrightarrow", name: "left right arrow" },
      { symbol: "⇒", latex: "\\Rightarrow", name: "Rightarrow" },
      { symbol: "⇐", latex: "\\Leftarrow", name: "Leftarrow" },
      { symbol: "⇔", latex: "\\Leftrightarrow", name: "Leftrightarrow" },
      { symbol: "↦", latex: "\\mapsto", name: "maps to" },
      { symbol: "⟶", latex: "\\longrightarrow", name: "long right arrow" },
      { symbol: "↑", latex: "\\uparrow", name: "up arrow" },
      { symbol: "↓", latex: "\\downarrow", name: "down arrow" },
      { symbol: "↗", latex: "\\nearrow", name: "northeast arrow" },
      { symbol: "↘", latex: "\\searrow", name: "southeast arrow" },
    ],
  },
  Physics: {
    name: "物理",
    symbols: [
      { symbol: "ℏ", latex: "\\hbar", name: "h bar", keywords: ["hbar"] },
      { symbol: "|ψ⟩", latex: "\\ket{\\psi}", name: "ket psi", keywords: ["quantum"] },
      { symbol: "⟨ψ|", latex: "\\bra{\\psi}", name: "bra psi", keywords: ["quantum"] },
      { symbol: "⟨a|b⟩", latex: "\\braket{a}{b}", name: "braket", keywords: ["quantum"] },
      { symbol: "Ĥ", latex: "\\hat{H}", name: "Hamiltonian" },
      { symbol: "E", latex: "\\mathbf{E}", name: "electric field" },
      { symbol: "B", latex: "\\mathbf{B}", name: "magnetic field" },
      { symbol: "∇·", latex: "\\nabla \\cdot", name: "divergence" },
      { symbol: "∇×", latex: "\\nabla \\times", name: "curl" },
      { symbol: "μ₀", latex: "\\mu_0", name: "mu naught" },
      { symbol: "ε₀", latex: "\\epsilon_0", name: "epsilon naught" },
      { symbol: "†", latex: "^{\\dagger}", name: "dagger" },
    ],
  },
};

const CATEGORY_ORDER = Object.keys(SYMBOL_CATEGORIES) as SymbolCategory[];

export function MathSymbolPalette({ onInsert, onClose, isOpen }: MathSymbolPaletteProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<SymbolCategory>("Common");
  const paletteRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (paletteRef.current && !paletteRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      searchRef.current?.focus();
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const filteredSymbols = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const pool = query
      ? CATEGORY_ORDER.flatMap((category) => SYMBOL_CATEGORIES[category].symbols)
      : SYMBOL_CATEGORIES[activeCategory].symbols;

    if (!query) return pool;

    return pool.filter((item) => {
      const haystack = [
        item.symbol,
        item.latex,
        item.name,
        ...(item.keywords ?? []),
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [activeCategory, searchQuery]);

  if (!isOpen) return null;

  return (
    <div
      ref={paletteRef}
      className={`math-symbol-palette ${UI_LAYER_CLASS.dialogElevated}`}
      style={{
        position: "fixed",
        right: "20px",
        top: "96px",
        width: "360px",
        maxHeight: "min(680px, calc(100vh - 128px))",
      }}
    >
      <div className="palette-container">
        <div className="palette-header">
          <div>
            <h3 className="palette-title">公式符号</h3>
            <p className="palette-subtitle">搜索结构、符号或 LaTeX</p>
          </div>
          <button
            onClick={onClose}
            className="palette-close"
            aria-label="Close symbol palette"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="palette-search">
          <Search className="h-4 w-4 search-icon" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search: frac, alpha, 矩阵..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="category-tabs" aria-label="Formula symbol categories">
          {CATEGORY_ORDER.map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={`category-tab ${activeCategory === category && !searchQuery ? "active" : ""}`}
            >
              {SYMBOL_CATEGORIES[category].name}
            </button>
          ))}
        </div>

        <div className="symbol-grid-container">
          <div className="category-name">
            {searchQuery ? "搜索结果" : SYMBOL_CATEGORIES[activeCategory].name}
            <span>{filteredSymbols.length}</span>
          </div>
          <div className="symbol-grid">
            {filteredSymbols.map((item) => (
              <button
                key={`${item.latex}-${item.name}`}
                onClick={() => onInsert(item.latex)}
                className="symbol-button"
                title={`${item.name}\n${item.latex}`}
              >
                <span className="symbol-glyph">{item.symbol}</span>
                <span className="symbol-latex">{item.latex}</span>
              </button>
            ))}
          </div>
          {filteredSymbols.length === 0 && (
            <div className="no-results">没有找到匹配的符号</div>
          )}
        </div>

        <div className="palette-footer">
          <span className="footer-hint">点击插入 · Esc 关闭</span>
        </div>
      </div>

      <style jsx>{`
        .palette-container {
          display: flex;
          max-height: inherit;
          flex-direction: column;
          overflow: hidden;
          border: 1px solid hsl(var(--border));
          border-radius: 8px;
          background: hsl(var(--background));
          color: hsl(var(--foreground));
          box-shadow: 0 18px 60px rgba(15, 23, 42, 0.18);
        }

        .palette-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          border-bottom: 1px solid hsl(var(--border));
          padding: 12px 14px;
          background: hsl(var(--muted) / 0.24);
        }

        .palette-title {
          margin: 0;
          font-size: 15px;
          font-weight: 650;
        }

        .palette-subtitle {
          margin: 2px 0 0;
          color: hsl(var(--muted-foreground));
          font-size: 12px;
        }

        .palette-close {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: none;
          border-radius: 6px;
          background: transparent;
          color: hsl(var(--muted-foreground));
          cursor: pointer;
          padding: 5px;
        }

        .palette-close:hover {
          background: hsl(var(--accent));
          color: hsl(var(--foreground));
        }

        .palette-search {
          position: relative;
          border-bottom: 1px solid hsl(var(--border));
          padding: 10px 14px;
        }

        .search-icon {
          position: absolute;
          left: 23px;
          top: 50%;
          transform: translateY(-50%);
          color: hsl(var(--muted-foreground));
        }

        .search-input {
          width: 100%;
          border: 1px solid hsl(var(--border));
          border-radius: 6px;
          background: hsl(var(--background));
          color: hsl(var(--foreground));
          font-size: 13px;
          padding: 8px 10px 8px 32px;
        }

        .search-input:focus {
          outline: 2px solid hsl(var(--ring));
          outline-offset: 1px;
        }

        .category-tabs {
          display: flex;
          gap: 4px;
          overflow-x: auto;
          border-bottom: 1px solid hsl(var(--border));
          background: hsl(var(--muted) / 0.18);
          padding: 7px 10px;
        }

        .category-tab {
          flex: 0 0 auto;
          border: none;
          border-radius: 5px;
          background: transparent;
          color: hsl(var(--muted-foreground));
          cursor: pointer;
          font-size: 12px;
          padding: 5px 8px;
        }

        .category-tab:hover,
        .category-tab.active {
          background: hsl(var(--background));
          color: hsl(var(--foreground));
          box-shadow: 0 0 0 1px hsl(var(--border)) inset;
        }

        .symbol-grid-container {
          min-height: 0;
          overflow-y: auto;
          padding: 12px;
        }

        .category-name {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
          color: hsl(var(--muted-foreground));
          font-size: 12px;
          font-weight: 600;
        }

        .symbol-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 7px;
        }

        .symbol-button {
          display: grid;
          grid-template-rows: 28px auto;
          min-width: 0;
          min-height: 60px;
          align-items: center;
          justify-items: center;
          border: 1px solid hsl(var(--border));
          border-radius: 6px;
          background: hsl(var(--background));
          color: hsl(var(--foreground));
          cursor: pointer;
          padding: 6px 5px;
          transition: background 120ms ease, border-color 120ms ease;
        }

        .symbol-button:hover {
          border-color: hsl(var(--primary) / 0.5);
          background: hsl(var(--primary) / 0.07);
        }

        .symbol-glyph {
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 18px;
          line-height: 1;
        }

        .symbol-latex {
          width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: hsl(var(--muted-foreground));
          font-family: var(--font-geist-mono), ui-monospace, monospace;
          font-size: 10px;
          text-align: center;
        }

        .no-results {
          border: 1px dashed hsl(var(--border));
          border-radius: 6px;
          color: hsl(var(--muted-foreground));
          font-size: 13px;
          padding: 24px;
          text-align: center;
        }

        .palette-footer {
          border-top: 1px solid hsl(var(--border));
          background: hsl(var(--muted) / 0.18);
          padding: 8px 14px;
        }

        .footer-hint {
          color: hsl(var(--muted-foreground));
          font-size: 12px;
        }

        @media (max-width: 520px) {
          .symbol-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
      `}</style>
    </div>
  );
}
