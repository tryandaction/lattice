"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Type } from "lucide-react";
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
  /** Callback when text note mode is requested */
  onTextNoteRequest?: () => void;
  /** Callback when the picker is closed without selection */
  onClose: () => void;
}

// ============================================================================
// Color Configuration
// ============================================================================

const COLOR_OPTIONS = [
  { value: 'transparent', label: '无背景', isTransparent: true },
  { value: 'yellow', label: '黄色', bg: 'bg-yellow-400', hover: 'hover:bg-yellow-500' },
  { value: 'red', label: '红色', bg: 'bg-red-500', hover: 'hover:bg-red-600' },
  { value: 'green', label: '绿色', bg: 'bg-green-500', hover: 'hover:bg-green-600' },
  { value: 'blue', label: '蓝色', bg: 'bg-blue-500', hover: 'hover:bg-blue-600' },
  { value: '#9C27B0', label: '紫色', hex: '#9C27B0' },
  { value: '#FF4081', label: '洋红色', hex: '#FF4081' },
  { value: '#FF9800', label: '橙色', hex: '#FF9800' },
  { value: '#9E9E9E', label: '灰色', hex: '#9E9E9E' },
] as const;

const isAnnotationColor = (value: string): value is AnnotationColor =>
  (ANNOTATION_COLORS as readonly string[]).includes(value);

const COLOR_CONFIG: Record<AnnotationColor, { bg: string; hover: string; label: string }> = {
  yellow: {
    bg: 'bg-yellow-400',
    hover: 'hover:bg-yellow-500',
    label: '黄色',
  },
  red: {
    bg: 'bg-red-500',
    hover: 'hover:bg-red-600',
    label: '红色',
  },
  green: {
    bg: 'bg-green-500',
    hover: 'hover:bg-green-600',
    label: '绿色',
  },
  blue: {
    bg: 'bg-blue-500',
    hover: 'hover:bg-blue-600',
    label: '蓝色',
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
  onTextNoteRequest,
  onClose,
}: ColorPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showExtended, setShowExtended] = useState(false);

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
    x: Math.max(10, Math.min(position.x, window.innerWidth - 200)),
    y: Math.max(10, Math.min(position.y, window.innerHeight - 120)),
  };

  return (
    <div
      ref={containerRef}
      className="fixed z-50 rounded-lg border border-border bg-popover shadow-lg"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        transform: 'translate(-50%, -100%) translateY(-8px)',
      }}
      role="toolbar"
      aria-label="选择颜色"
    >
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-border">
        <span className="text-xs text-muted-foreground">选择颜色</span>
      </div>
      
      {/* Color options */}
      <div className="p-2">
        {/* Main colors */}
        <div className="flex gap-1.5 mb-2">
          {ANNOTATION_COLORS.map((color) => {
            const config = COLOR_CONFIG[color];
            return (
              <button
                key={color}
                onClick={() => handleColorClick(color)}
                className={`h-7 w-7 rounded-full ${config.bg} ${config.hover} transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1`}
                title={config.label}
                aria-label={config.label}
              />
            );
          })}
        </div>
        
        {/* Extended colors toggle */}
        {!showExtended && (
          <button
            onClick={() => setShowExtended(true)}
            className="w-full text-xs text-muted-foreground hover:text-foreground py-1"
          >
            更多颜色...
          </button>
        )}
        
        {/* Extended colors */}
        {showExtended && (
          <div className="border-t border-border pt-2 mt-1">
            <div className="grid grid-cols-4 gap-1.5">
              {COLOR_OPTIONS.filter((c) => !isAnnotationColor(c.value)).map((color) => (
                <button
                  key={color.value}
                  onClick={() => handleColorClick(color.value as AnnotationColor)}
                  className={`h-6 w-6 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 ${
                    'isTransparent' in color && color.isTransparent 
                      ? 'bg-[repeating-conic-gradient(#ccc_0_25%,#fff_0_50%)] bg-[length:6px_6px] border border-border' 
                      : ''
                  }`}
                  style={!('isTransparent' in color) && 'hex' in color ? { backgroundColor: color.hex } : undefined}
                  title={color.label}
                  aria-label={color.label}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      
      {/* Text note option */}
      {onTextNoteRequest && (
        <div className="border-t border-border px-2 py-1.5">
          <button
            onClick={onTextNoteRequest}
            className="flex items-center gap-2 w-full px-2 py-1 rounded text-xs hover:bg-muted"
          >
            <Type className="h-3.5 w-3.5" />
            <span>添加文字批注</span>
          </button>
        </div>
      )}
      
      {/* Close button */}
      <div className="border-t border-border px-2 py-1.5">
        <button
          onClick={onClose}
          className="w-full text-xs text-muted-foreground hover:text-foreground py-0.5"
        >
          返回
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

export { COLOR_CONFIG };
