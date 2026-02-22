'use client';

/**
 * Variant Menu Component
 * Spotlight-style popup showing symbol variants for a key
 */

import { useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useKaTeXRenderer } from './katex-renderer';

export interface VariantMenuProps {
  /** Key code this menu is for */
  keyCode: string;
  /** Array of variant LaTeX commands */
  variants: string[];
  /** Currently highlighted index */
  highlightedIndex: number;
  /** Position to anchor the menu */
  anchorPosition: { x: number; y: number };
  /** Callback when a variant is selected */
  onSelect: (variant: string) => void;
  /** Callback when menu should close */
  onClose: () => void;
  /** Whether the menu is visible */
  isVisible: boolean;
}

export function VariantMenu({
  keyCode,
  variants,
  highlightedIndex,
  anchorPosition,
  onSelect,
  isVisible,
}: VariantMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const renderLatex = useKaTeXRenderer();

  // Scroll highlighted item into view
  useEffect(() => {
    if (!menuRef.current) return;
    const highlightedItem = menuRef.current.querySelector('.highlighted');
    if (highlightedItem) {
      highlightedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [highlightedIndex]);

  // Render variants with KaTeX
  const renderedVariants = useMemo(() => {
    return variants.map((variant) => ({
      latex: variant,
      html: renderLatex(variant),
    }));
  }, [variants, renderLatex]);

  // Calculate menu position (relative to parent container)
  // Position above the keycap using bottom positioning
  const menuStyle = useMemo(() => {
    return {
      left: anchorPosition.x,
      top: anchorPosition.y,
      transform: 'translate(-50%, -100%)', // Center horizontally, position above
    };
  }, [anchorPosition]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          ref={menuRef}
          className="variant-menu"
          style={menuStyle}
          initial={{ opacity: 0, y: -10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          role="listbox"
          aria-label={`Variants for ${keyCode}`}
          aria-activedescendant={`variant-${highlightedIndex}`}
        >
          {/* Header */}
          <div className="px-3 py-2 border-b border-white/10 text-white/50 text-xs uppercase tracking-wide">
            Variants
          </div>

          {/* Variant list */}
          <div className="max-h-48 overflow-y-auto py-1">
            {renderedVariants.map((variant, index) => (
              <div
                key={variant.latex}
                id={`variant-${index}`}
                role="option"
                aria-selected={index === highlightedIndex}
                className={`variant-menu-item ${index === highlightedIndex ? 'highlighted' : ''}`}
                onClick={() => onSelect(variant.latex)}
                onMouseEnter={() => {
                  // Optional: highlight on hover
                }}
              >
                <span
                  className="text-lg"
                  dangerouslySetInnerHTML={{ __html: variant.html }}
                />
              </div>
            ))}
          </div>

          {/* Footer hint */}
          <div className="px-3 py-1.5 border-t border-white/10 text-white/40 text-[10px] flex justify-between">
            <span>↑↓/空格</span>
            <span>Enter 选择</span>
            <span>Esc 关闭</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ============================================================================
// Pure Logic for Testing
// ============================================================================

/**
 * Calculate the next highlighted index after navigation
 */
export function navigateVariantIndex(
  currentIndex: number,
  direction: 'up' | 'down',
  totalVariants: number
): number {
  if (totalVariants === 0) return 0;

  if (direction === 'down') {
    return (currentIndex + 1) % totalVariants;
  } else {
    return (currentIndex - 1 + totalVariants) % totalVariants;
  }
}

/**
 * Check if an index is within valid bounds
 */
export function isValidVariantIndex(index: number, totalVariants: number): boolean {
  if (totalVariants === 0) return index === 0;
  return index >= 0 && index < totalVariants;
}

export default VariantMenu;
