"use client";

import { useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TOUCH_TARGET_MIN } from '@/lib/responsive';

// Default highlight colors
const DEFAULT_COLORS = [
  { name: 'Yellow', value: '#FFEB3B', textColor: '#000' },
  { name: 'Green', value: '#4CAF50', textColor: '#fff' },
  { name: 'Blue', value: '#2196F3', textColor: '#fff' },
  { name: 'Pink', value: '#E91E63', textColor: '#fff' },
  { name: 'Orange', value: '#FF9800', textColor: '#000' },
  { name: 'Purple', value: '#9C27B0', textColor: '#fff' },
  { name: 'Cyan', value: '#00BCD4', textColor: '#000' },
  { name: 'Red', value: '#F44336', textColor: '#fff' },
  { name: 'Lime', value: '#CDDC39', textColor: '#000' },
  { name: 'Teal', value: '#009688', textColor: '#fff' },
];

interface ColorOption {
  name: string;
  value: string;
  textColor?: string;
}

interface MobileColorPickerProps {
  /** Currently selected color */
  selectedColor?: string;
  /** Callback when color is selected */
  onColorSelect: (color: string) => void;
  /** Available colors */
  colors?: ColorOption[];
  /** Number of columns in the grid */
  columns?: number;
  /** Custom class name */
  className?: string;
  /** Whether to show color names */
  showLabels?: boolean;
}

/**
 * MobileColorPicker - A touch-friendly color picker for mobile devices
 * 
 * Features:
 * - Large touch targets (44px minimum)
 * - Grid layout for easy selection
 * - Visual feedback on selection
 * - Accessible with labels
 * 
 * Requirements: 6.1
 */
export function MobileColorPicker({
  selectedColor,
  onColorSelect,
  colors = DEFAULT_COLORS,
  columns = 5,
  className,
  showLabels = false,
}: MobileColorPickerProps) {
  const handleColorClick = useCallback(
    (color: string) => {
      onColorSelect(color);
    },
    [onColorSelect]
  );

  return (
    <div
      className={cn('p-2', className)}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: '0.5rem',
      }}
      role="listbox"
      aria-label="Color picker"
    >
      {colors.map((color) => {
        const isSelected = selectedColor === color.value;
        return (
          <button
            key={color.value}
            onClick={() => handleColorClick(color.value)}
            className={cn(
              'flex flex-col items-center justify-center',
              'rounded-lg',
              'border-2 transition-all',
              isSelected
                ? 'border-primary ring-2 ring-primary/30'
                : 'border-transparent hover:border-muted-foreground/30'
            )}
            style={{
              minWidth: TOUCH_TARGET_MIN,
              minHeight: TOUCH_TARGET_MIN,
              backgroundColor: color.value,
            }}
            role="option"
            aria-selected={isSelected}
            aria-label={color.name}
            title={color.name}
          >
            {isSelected && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="flex items-center justify-center"
              >
                <Check
                  className="h-5 w-5"
                  style={{ color: color.textColor || '#fff' }}
                />
              </motion.div>
            )}
            {showLabels && (
              <span
                className="text-xs mt-1 font-medium"
                style={{ color: color.textColor || '#fff' }}
              >
                {color.name}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * MobileColorPickerPopover - Color picker in a popover/modal
 */
interface MobileColorPickerPopoverProps extends MobileColorPickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Position of the popover */
  position?: { x: number; y: number };
}

export function MobileColorPickerPopover({
  isOpen,
  onClose,
  position,
  ...pickerProps
}: MobileColorPickerPopoverProps) {
  const handleColorSelect = useCallback(
    (color: string) => {
      pickerProps.onColorSelect(color);
      onClose();
    },
    [pickerProps, onClose]
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Popover */}
          <motion.div
            className={cn(
              'fixed z-50',
              'bg-card rounded-xl shadow-xl border border-border',
              'p-2'
            )}
            style={{
              left: position?.x ?? '50%',
              top: position?.y ?? '50%',
              transform: position ? 'translate(-50%, 0)' : 'translate(-50%, -50%)',
            }}
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            transition={{ duration: 0.15 }}
          >
            <MobileColorPicker {...pickerProps} onColorSelect={handleColorSelect} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * Stroke width picker for ink annotations
 */
interface StrokeWidthPickerProps {
  selectedWidth: number;
  onWidthSelect: (width: number) => void;
  widths?: number[];
  className?: string;
}

const DEFAULT_WIDTHS = [2, 4, 6, 8, 12];

export function StrokeWidthPicker({
  selectedWidth,
  onWidthSelect,
  widths = DEFAULT_WIDTHS,
  className,
}: StrokeWidthPickerProps) {
  return (
    <div
      className={cn('flex items-center gap-2 p-2', className)}
      role="listbox"
      aria-label="Stroke width"
    >
      {widths.map((width) => {
        const isSelected = selectedWidth === width;
        return (
          <button
            key={width}
            onClick={() => onWidthSelect(width)}
            className={cn(
              'flex items-center justify-center',
              'rounded-full',
              'border-2 transition-all',
              'bg-muted',
              isSelected
                ? 'border-primary ring-2 ring-primary/30'
                : 'border-transparent hover:border-muted-foreground/30'
            )}
            style={{
              minWidth: TOUCH_TARGET_MIN,
              minHeight: TOUCH_TARGET_MIN,
            }}
            role="option"
            aria-selected={isSelected}
            aria-label={`${width}px stroke`}
          >
            <div
              className="rounded-full bg-foreground"
              style={{
                width: Math.min(width * 2, 24),
                height: Math.min(width * 2, 24),
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
