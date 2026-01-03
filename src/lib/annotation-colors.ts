/**
 * Annotation Color Utilities
 * 
 * Provides color constants and conversion utilities for annotation highlighting
 * across PDF, Image, and export contexts.
 */

// ============================================================================
// Types
// ============================================================================

export interface HighlightColor {
  name: string;
  value: string;
  hex: string;
}

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

// ============================================================================
// Color Constants
// ============================================================================

/**
 * Standard highlight colors available in the annotation system
 */
export const HIGHLIGHT_COLORS: readonly HighlightColor[] = [
  { name: 'Yellow', value: 'yellow', hex: '#FFEB3B' },
  { name: 'Green', value: 'green', hex: '#4CAF50' },
  { name: 'Blue', value: 'blue', hex: '#2196F3' },
  { name: 'Pink', value: 'pink', hex: '#E91E63' },
  { name: 'Orange', value: 'orange', hex: '#FF9800' },
] as const;

/**
 * Default highlight color (yellow)
 */
export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0];

/**
 * Pin/sticky note color (amber)
 */
export const PIN_COLOR = '#FFC107';

/**
 * Default highlight opacity for PDF export (0.3-0.4 range)
 */
export const HIGHLIGHT_OPACITY = 0.35;

// ============================================================================
// Color Mapping for PDF Export
// ============================================================================

/**
 * Pre-computed RGB values for PDF drawing operations
 * Values are normalized to 0-1 range for pdf-lib
 */
export const PDF_HIGHLIGHT_COLORS: Record<string, RGBColor> = {
  // Hex values
  '#FFEB3B': { r: 1.0, g: 0.92, b: 0.23 },      // Yellow
  '#4CAF50': { r: 0.30, g: 0.69, b: 0.31 },     // Green
  '#2196F3': { r: 0.13, g: 0.59, b: 0.95 },     // Blue
  '#E91E63': { r: 0.91, g: 0.12, b: 0.39 },     // Pink
  '#FF9800': { r: 1.0, g: 0.60, b: 0.0 },       // Orange
  '#FFC107': { r: 1.0, g: 0.76, b: 0.03 },      // Amber (pins)
  // Named values (lowercase)
  'yellow': { r: 1.0, g: 0.92, b: 0.23 },
  'green': { r: 0.30, g: 0.69, b: 0.31 },
  'blue': { r: 0.13, g: 0.59, b: 0.95 },
  'pink': { r: 0.91, g: 0.12, b: 0.39 },
  'orange': { r: 1.0, g: 0.60, b: 0.0 },
};

/**
 * Default RGB color for unknown colors (yellow)
 */
export const DEFAULT_RGB_COLOR: RGBColor = { r: 1.0, g: 0.92, b: 0.23 };

// ============================================================================
// Color Conversion Functions
// ============================================================================

/**
 * Converts a hex color string to RGB values (0-1 range)
 * 
 * @param hex - Hex color string (e.g., '#FFEB3B' or 'FFEB3B')
 * @returns RGB color object with values in 0-1 range
 */
export function hexToRGB(hex: string): RGBColor {
  // Remove # if present
  const cleanHex = hex.replace(/^#/, '');
  
  // Validate hex format
  if (!/^[0-9A-Fa-f]{6}$/.test(cleanHex)) {
    console.warn(`Invalid hex color: ${hex}, using default`);
    return DEFAULT_RGB_COLOR;
  }
  
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;
  
  return { r, g, b };
}

/**
 * Converts RGB values (0-1 range) to hex color string
 * 
 * @param rgb - RGB color object with values in 0-1 range
 * @returns Hex color string (e.g., '#FFEB3B')
 */
export function rgbToHex(rgb: RGBColor): string {
  const toHex = (value: number): string => {
    const clamped = Math.max(0, Math.min(1, value));
    const int = Math.round(clamped * 255);
    return int.toString(16).padStart(2, '0').toUpperCase();
  };
  
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/**
 * Gets RGB color for PDF drawing from annotation color
 * Handles both hex and named colors
 * 
 * @param color - Color string (hex or named)
 * @returns RGB color object for pdf-lib
 */
export function getColorForPDF(color: string): RGBColor {
  // Check pre-computed colors first
  const precomputed = PDF_HIGHLIGHT_COLORS[color] || PDF_HIGHLIGHT_COLORS[color.toLowerCase()];
  if (precomputed) {
    return precomputed;
  }
  
  // Try to parse as hex
  if (color.startsWith('#')) {
    return hexToRGB(color);
  }
  
  // Unknown color, return default
  console.warn(`Unknown annotation color: ${color}, using default yellow`);
  return DEFAULT_RGB_COLOR;
}

/**
 * Gets the hex value for a named color
 * 
 * @param colorName - Named color (e.g., 'yellow', 'green')
 * @returns Hex color string
 */
export function getHexForNamedColor(colorName: string): string {
  const found = HIGHLIGHT_COLORS.find(
    c => c.value.toLowerCase() === colorName.toLowerCase() ||
         c.name.toLowerCase() === colorName.toLowerCase()
  );
  return found?.hex ?? DEFAULT_HIGHLIGHT_COLOR.hex;
}

/**
 * Validates if a color string is a valid highlight color
 * 
 * @param color - Color string to validate
 * @returns True if valid highlight color
 */
export function isValidHighlightColor(color: string): boolean {
  // Check named colors
  if (HIGHLIGHT_COLORS.some(c => c.value === color || c.hex === color)) {
    return true;
  }
  
  // Check hex format
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}
