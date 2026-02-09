'use client';

/**
 * Keycap Component
 * Renders a single key in the Shadow Keyboard with physical label and math symbol
 */

import React, { useMemo, forwardRef } from 'react';
import katex from 'katex';

export interface KeycapProps {
  /** Key code (e.g., 'KeyI') */
  keyCode: string;
  /** Physical key label (e.g., 'I') */
  physicalLabel: string;
  /** Default LaTeX symbol */
  defaultSymbol: string;
  /** Shift-modified LaTeX symbol */
  shiftSymbol?: string;
  /** Whether this key has variants/alternatives available */
  hasVariants: boolean;
  /** Whether Shift is currently held (deprecated) */
  isShiftHeld: boolean;
  /** Whether this key is currently flashing */
  isFlashing: boolean;
  /** Whether this key is currently active (symbol selector open) */
  isActive?: boolean;
  /** Click handler */
  onClick: (event: React.MouseEvent) => void;
}

/**
 * Render LaTeX to HTML using KaTeX
 */
function renderLatex(latex: string): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode: false,
      output: 'html',
    });
  } catch {
    return `<span class="text-xs text-gray-400">${latex}</span>`;
  }
}

export const Keycap = forwardRef<HTMLButtonElement, KeycapProps>(function Keycap(
  {
    keyCode,
    physicalLabel,
    defaultSymbol,
    shiftSymbol: _shiftSymbol,
    hasVariants,
    isShiftHeld: _isShiftHeld,
    isFlashing,
    isActive,
    onClick,
  },
  ref
) {
  // Always display default symbol
  const displaySymbol = defaultSymbol;

  // Render the LaTeX symbol
  const renderedSymbol = useMemo(() => {
    return renderLatex(displaySymbol);
  }, [displaySymbol]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      data-keycode={keyCode}
      data-has-variants={hasVariants}
      className={`
        relative w-12 h-12 rounded-xl
        bg-white/5 backdrop-blur-sm
        border border-white/10
        hover:bg-white/15 hover:border-white/25
        hover:shadow-lg hover:shadow-indigo-500/10
        active:bg-white/20 active:scale-95
        transition-all duration-150
        flex flex-col items-center justify-center
        cursor-pointer select-none
        group
        ${isFlashing ? 'animate-keycap-flash bg-indigo-400/50 border-indigo-300/60 shadow-xl shadow-indigo-500/40 scale-105' : ''}
        ${isActive ? 'bg-indigo-500/30 border-indigo-400/40 ring-2 ring-indigo-400/50' : ''}
      `}
      aria-label={`Insert ${displaySymbol}`}
      title={hasVariants ? 'Click for symbol, Shift+Click for variants' : `Insert ${displaySymbol}`}
    >
      {/* Physical key label - top left */}
      <span 
        className="absolute top-0.5 left-1.5 text-[9px] font-medium text-white/40 group-hover:text-white/60"
        data-testid="physical-label"
      >
        {physicalLabel}
      </span>

      {/* Variant indicator dot - top right (shows if has alternatives) */}
      {hasVariants && (
        <span 
          className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-gradient-to-br from-indigo-400 to-purple-400"
          data-testid="variant-indicator"
          aria-label="Has alternatives (Shift+click)"
        />
      )}

      {/* Math symbol - center */}
      <span
        className="text-white/90 text-base leading-none mt-0.5"
        data-testid="math-symbol"
        dangerouslySetInnerHTML={{ __html: renderedSymbol }}
      />
    </button>
  );
});

// ============================================================================
// Pure Logic for Testing
// ============================================================================

export interface KeycapDisplayData {
  physicalLabel: string;
  displaySymbol: string;
  hasVariantIndicator: boolean;
}

/**
 * Pure function to compute keycap display data
 * Useful for testing without React
 */
export function computeKeycapDisplay(
  physicalLabel: string,
  defaultSymbol: string,
  shiftSymbol: string | undefined,
  hasVariants: boolean,
  _isShiftHeld: boolean
): KeycapDisplayData {
  // Always show default symbol now
  const displaySymbol = defaultSymbol;
  
  return {
    physicalLabel,
    displaySymbol,
    hasVariantIndicator: hasVariants || !!shiftSymbol,
  };
}

export default Keycap;
