"use client";

import { useCallback, useEffect, useRef } from "react";
import type { AnnotationColor } from "../../types/annotation";
import { ANNOTATION_COLORS } from "../../types/annotation";

// ============================================================================
// Types
// ============================================================================

interface ColorPickerProps {
  /** Position for the popover (in viewport coordinates) */
  position: { x: number; y: number };
  /** Callback when a color is selected */
  onColorSelect: (color: AnnotationColor) => void;
  /** Callback when the picker is closed without selection */
  onClose: () => void;
}

// ============================================================================
// Color Configuration
// ============================================================================

const COLOR_CONFIG: Record<AnnotationColor, { bg: string; hover: string; label: string }> = {
  yellow: {
    bg: 'bg-yellow-400',
    hover: 'hover:bg-yellow-500',
    label: 'Yellow',
  },
  red: {
    bg: 'bg-red-500',
    hover: 'hover:bg-red-600',
    label: 'Red',
  },
  green: {
    bg: 'bg-green-500',
    hover: 'hover:bg-green-600',
    label: 'Green',
  },
  blue: {
    bg: 'bg-blue-500',
    hover: 'hover:bg-blue-600',
    label: 'Blue',
  },
};

// ============================================================================
// Component
// ============================================================================

/**
 * Color Picker Popover for Annotation Highlights
 * 
 * Displays a small popover near the text selection with color options.
 * Clicking a color creates a highlight with that color.
 * Clicking outside or pressing Escape closes the picker.
 */
export function AnnotationColorPicker({
  position,
  onColorSelect,
  onClose,
}: ColorPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    // Add listeners with a small delay to prevent immediate close
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }, 10);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleColorClick = useCallback(
    (color: AnnotationColor) => {
      onColorSelect(color);
    },
    [onColorSelect]
  );

  // Calculate position to keep popover in viewport
  const adjustedPosition = {
    x: Math.max(10, Math.min(position.x, window.innerWidth - 150)),
    y: Math.max(10, Math.min(position.y, window.innerHeight - 50)),
  };

  return (
    <div
      ref={containerRef}
      className="fixed z-50 flex gap-1 rounded-lg border border-border bg-popover p-1.5 shadow-lg"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        transform: 'translate(-50%, -100%) translateY(-8px)',
      }}
      role="toolbar"
      aria-label="Highlight color picker"
    >
      {ANNOTATION_COLORS.map((color) => {
        const config = COLOR_CONFIG[color];
        return (
          <button
            key={color}
            onClick={() => handleColorClick(color)}
            className={`h-6 w-6 rounded-full ${config.bg} ${config.hover} transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1`}
            title={`${config.label} highlight`}
            aria-label={`${config.label} highlight`}
          />
        );
      })}
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

export { COLOR_CONFIG };
