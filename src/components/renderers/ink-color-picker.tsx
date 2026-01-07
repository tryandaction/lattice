"use client";

import { useState, useCallback } from "react";
import { Check, Palette } from "lucide-react";
import { cn } from "@/lib/utils";

// Preset colors for ink annotations
export const INK_PRESET_COLORS = [
  { name: "Black", value: "#000000" },
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Yellow", value: "#eab308" },
  { name: "Green", value: "#22c55e" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Purple", value: "#a855f7" },
  { name: "Pink", value: "#ec4899" },
] as const;

interface InkColorPickerProps {
  /** Currently selected color */
  currentColor: string;
  /** Callback when color changes */
  onColorChange: (color: string) => void;
  /** Whether to show as a compact button or expanded picker */
  variant?: "button" | "expanded";
  /** Custom class name */
  className?: string;
}

/**
 * InkColorPicker - Color selection for ink annotations
 * 
 * Features:
 * - 8 preset colors
 * - Custom color input
 * - Remembers last used color
 * - Compact button or expanded view
 */
export function InkColorPicker({
  currentColor,
  onColorChange,
  variant = "button",
  className,
}: InkColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customColor, setCustomColor] = useState(currentColor);

  const handleColorSelect = useCallback((color: string) => {
    onColorChange(color);
    setIsOpen(false);
  }, [onColorChange]);

  const handleCustomColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const color = e.target.value;
    setCustomColor(color);
    onColorChange(color);
  }, [onColorChange]);

  // Expanded variant - always visible color grid
  if (variant === "expanded") {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <div className="flex items-center gap-1 flex-wrap">
          {INK_PRESET_COLORS.map((preset) => (
            <button
              key={preset.value}
              onClick={() => handleColorSelect(preset.value)}
              className={cn(
                "w-6 h-6 rounded-full border-2 transition-all",
                "hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary/50",
                currentColor === preset.value
                  ? "border-primary ring-2 ring-primary/30"
                  : "border-transparent"
              )}
              style={{ backgroundColor: preset.value }}
              title={preset.name}
            >
              {currentColor === preset.value && (
                <Check className="w-4 h-4 text-white drop-shadow-md mx-auto" />
              )}
            </button>
          ))}
          
          {/* Custom color picker */}
          <div className="relative">
            <input
              type="color"
              value={customColor}
              onChange={handleCustomColorChange}
              className="absolute inset-0 w-6 h-6 opacity-0 cursor-pointer"
              title="Custom color"
            />
            <div
              className={cn(
                "w-6 h-6 rounded-full border-2 flex items-center justify-center",
                "bg-gradient-to-br from-red-500 via-green-500 to-blue-500",
                !INK_PRESET_COLORS.some(p => p.value === currentColor)
                  ? "border-primary ring-2 ring-primary/30"
                  : "border-border"
              )}
            >
              <Palette className="w-3 h-3 text-white drop-shadow-md" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Button variant - dropdown on click
  return (
    <div className={cn("relative", className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-md",
          "hover:bg-accent transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-primary/50"
        )}
        title="Select ink color"
      >
        <div
          className="w-4 h-4 rounded-full border border-border"
          style={{ backgroundColor: currentColor }}
        />
        <span className="text-xs">Color</span>
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown */}
          <div className="absolute top-full left-0 mt-1 z-50 p-2 rounded-lg border border-border bg-popover shadow-lg">
            <div className="grid grid-cols-4 gap-1.5">
              {INK_PRESET_COLORS.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => handleColorSelect(preset.value)}
                  className={cn(
                    "w-7 h-7 rounded-full border-2 transition-all",
                    "hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary/50",
                    currentColor === preset.value
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-transparent"
                  )}
                  style={{ backgroundColor: preset.value }}
                  title={preset.name}
                >
                  {currentColor === preset.value && (
                    <Check className="w-4 h-4 text-white drop-shadow-md mx-auto" />
                  )}
                </button>
              ))}
            </div>
            
            {/* Custom color */}
            <div className="mt-2 pt-2 border-t border-border">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Custom:</span>
                <input
                  type="color"
                  value={customColor}
                  onChange={handleCustomColorChange}
                  className="w-6 h-6 rounded cursor-pointer"
                />
                <span className="font-mono">{customColor}</span>
              </label>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface InkWidthPickerProps {
  /** Currently selected width */
  currentWidth: number;
  /** Callback when width changes */
  onWidthChange: (width: number) => void;
  /** Custom class name */
  className?: string;
}

// Preset widths
const INK_PRESET_WIDTHS = [1, 2, 3, 5, 8] as const;

/**
 * InkWidthPicker - Stroke width selection for ink annotations
 */
export function InkWidthPicker({
  currentWidth,
  onWidthChange,
  className,
}: InkWidthPickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={cn("relative", className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-md",
          "hover:bg-accent transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-primary/50"
        )}
        title="Select stroke width"
      >
        <div className="w-4 h-4 flex items-center justify-center">
          <div
            className="rounded-full bg-foreground"
            style={{ width: Math.min(currentWidth * 2, 14), height: Math.min(currentWidth * 2, 14) }}
          />
        </div>
        <span className="text-xs">Width</span>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          
          <div className="absolute top-full left-0 mt-1 z-50 p-2 rounded-lg border border-border bg-popover shadow-lg">
            <div className="flex items-center gap-2">
              {INK_PRESET_WIDTHS.map((width) => (
                <button
                  key={width}
                  onClick={() => {
                    onWidthChange(width);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "w-8 h-8 rounded-md flex items-center justify-center",
                    "hover:bg-accent transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-primary/50",
                    currentWidth === width && "bg-accent ring-2 ring-primary/30"
                  )}
                  title={`${width}px`}
                >
                  <div
                    className="rounded-full bg-foreground"
                    style={{ width: width * 2, height: width * 2 }}
                  />
                </button>
              ))}
            </div>
            
            {/* Custom width slider */}
            <div className="mt-2 pt-2 border-t border-border">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Custom:</span>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={currentWidth}
                  onChange={(e) => onWidthChange(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="font-mono w-6 text-right">{currentWidth}</span>
              </label>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
