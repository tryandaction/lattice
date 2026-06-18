'use client';

/**
 * Keycap Component
 * Renders a single key in the Shadow Keyboard with physical label and math symbol
 */

import React, { useMemo, forwardRef } from 'react';
import { useKaTeXRenderer } from './katex-renderer';

export interface KeycapProps {
  /** Key code (e.g., 'KeyI') */
  keyCode: string;
  /** Physical key label (e.g., 'I') */
  physicalLabel: string;
  /** Default LaTeX symbol */
  defaultSymbol: string;
  /** Shift-modified LaTeX symbol */
  shiftSymbol?: string;
  /** Optional compact display symbol */
  previewSymbol?: string;
  /** Human-readable title */
  title?: string;
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

export const Keycap = forwardRef<HTMLButtonElement, KeycapProps>(function Keycap(
  {
    keyCode,
    physicalLabel,
    defaultSymbol,
    shiftSymbol: _shiftSymbol,
    previewSymbol,
    title,
    hasVariants,
    isShiftHeld: _isShiftHeld,
    isFlashing,
    isActive,
    onClick,
  },
  ref
) {
  // Always display default symbol
  const displaySymbol = previewSymbol || defaultSymbol;
  const renderLatex = useKaTeXRenderer();

  // Render the LaTeX symbol
  const renderedSymbol = useMemo(() => {
    return renderLatex(displaySymbol);
  }, [displaySymbol, renderLatex]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      data-keycode={keyCode}
      data-has-variants={hasVariants}
      className={`
        quantum-keycap
        transition-all duration-150
        group
        ${isFlashing ? 'animate-keycap-flash quantum-keycap-flashing' : ''}
        ${isActive ? 'quantum-keycap-active' : ''}
      `}
      aria-label={`Insert ${title || defaultSymbol}`}
      title={hasVariants ? `${title || defaultSymbol} · Shift+Click for variants` : `Insert ${title || defaultSymbol}`}
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
