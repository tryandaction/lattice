/**
 * Annotation Color Utilities
 * 
 * Provides color constants and conversion utilities for annotation highlighting
 * across PDF, Image, and export contexts.
 * Colors match Zotero's annotation color palette.
 */

// ============================================================================
// Types
// ============================================================================

export interface HighlightColor {
  name: string;
  nameCN: string;  // Chinese name
  value: string;
  hex: string;
}

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

// ============================================================================
// Color Constants (Zotero-style)
// ============================================================================

/**
 * Standard highlight colors available in the annotation system
 * Matches Zotero's exact color palette
 */
export const HIGHLIGHT_COLORS: readonly HighlightColor[] = [
  { name: 'Yellow', nameCN: '黄色', value: 'yellow', hex: '#FFD400' },
  { name: 'Red', nameCN: '红色', value: 'red', hex: '#FF6666' },
  { name: 'Green', nameCN: '绿色', value: 'green', hex: '#5FB236' },
  { name: 'Blue', nameCN: '蓝色', value: 'blue', hex: '#2EA8E5' },
  { name: 'Purple', nameCN: '紫色', value: 'purple', hex: '#A28AE5' },
  { name: 'Magenta', nameCN: '洋红色', value: 'magenta', hex: '#E56EEE' },
  { name: 'Orange', nameCN: '橙色', value: 'orange', hex: '#F19837' },
  { name: 'Gray', nameCN: '灰色', value: 'gray', hex: '#AAAAAA' },
] as const;

/**
 * Background colors including transparent option
 */
export const BACKGROUND_COLORS: readonly HighlightColor[] = [
  { name: 'None', nameCN: '无背景', value: 'transparent', hex: 'transparent' },
  ...HIGHLIGHT_COLORS,
] as const;

/**
 * Text colors for text annotations
 */
export const TEXT_COLORS: readonly HighlightColor[] = [
  { name: 'Black', nameCN: '黑色', value: 'black', hex: '#000000' },
  { name: 'White', nameCN: '白色', value: 'white', hex: '#FFFFFF' },
  { name: 'Red', nameCN: '红色', value: 'red', hex: '#FF0000' },
  { name: 'Blue', nameCN: '蓝色', value: 'blue', hex: '#0066CC' },
  { name: 'Green', nameCN: '绿色', value: 'green', hex: '#008800' },
  { name: 'Orange', nameCN: '橙色', value: 'orange', hex: '#FF6600' },
  { name: 'Purple', nameCN: '紫色', value: 'purple', hex: '#6600CC' },
] as const;

/**
 * Font sizes for text annotations
 */
export const TEXT_FONT_SIZES: readonly { value: number; label: string }[] = [
  { value: 10, label: '10px' },
  { value: 12, label: '12px' },
  { value: 14, label: '14px' },
  { value: 16, label: '16px' },
  { value: 18, label: '18px' },
  { value: 20, label: '20px' },
  { value: 24, label: '24px' },
] as const;

/**
 * Default text annotation style
 */
export const DEFAULT_TEXT_STYLE = {
  textColor: '#000000',
  fontSize: 14,
} as const;

/**
 * Context menu actions for annotations (Zotero-style)
 */
export interface AnnotationContextAction {
  id: string;
  label: string;
  labelCN: string;
  icon?: string;
  shortcut?: string;
  dividerAfter?: boolean;
}

/**
 * Default highlight color (yellow)
 */
export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0];

/**
 * Pin/sticky note color (amber)
 */
export const PIN_COLOR = '#FFC107';

/**
 * Default highlight opacity for PDF export
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
  // Hex values (Zotero colors)
  '#FFD400': { r: 1.0, g: 0.83, b: 0.0 },       // Yellow
  '#FF6666': { r: 1.0, g: 0.4, b: 0.4 },        // Red
  '#5FB236': { r: 0.37, g: 0.70, b: 0.21 },     // Green
  '#2EA8E5': { r: 0.18, g: 0.66, b: 0.90 },     // Blue
  '#A28AE5': { r: 0.64, g: 0.54, b: 0.90 },     // Purple
  '#E56EEE': { r: 0.90, g: 0.43, b: 0.93 },     // Magenta
  '#F19837': { r: 0.95, g: 0.60, b: 0.22 },     // Orange
  '#AAAAAA': { r: 0.67, g: 0.67, b: 0.67 },     // Gray
  '#FFC107': { r: 1.0, g: 0.76, b: 0.03 },      // Amber (pins)
  // Legacy colors
  '#FFEB3B': { r: 1.0, g: 0.92, b: 0.23 },
  '#4CAF50': { r: 0.30, g: 0.69, b: 0.31 },
  '#2196F3': { r: 0.13, g: 0.59, b: 0.95 },
  '#E91E63': { r: 0.91, g: 0.12, b: 0.39 },
  '#FF9800': { r: 1.0, g: 0.60, b: 0.0 },
  // Named values
  'yellow': { r: 1.0, g: 0.83, b: 0.0 },
  'red': { r: 1.0, g: 0.4, b: 0.4 },
  'green': { r: 0.37, g: 0.70, b: 0.21 },
  'blue': { r: 0.18, g: 0.66, b: 0.90 },
  'purple': { r: 0.64, g: 0.54, b: 0.90 },
  'magenta': { r: 0.90, g: 0.43, b: 0.93 },
  'orange': { r: 0.95, g: 0.60, b: 0.22 },
  'gray': { r: 0.67, g: 0.67, b: 0.67 },
};

/**
 * Default RGB color for unknown colors (yellow)
 */
export const DEFAULT_RGB_COLOR: RGBColor = { r: 1.0, g: 0.83, b: 0.0 };

// ============================================================================
// Color Conversion Functions
// ============================================================================

/**
 * Converts a hex color string to RGB values (0-1 range)
 */
export function hexToRGB(hex: string): RGBColor {
  const cleanHex = hex.replace(/^#/, '');
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
 */
export function getColorForPDF(color: string): RGBColor {
  const precomputed = PDF_HIGHLIGHT_COLORS[color] || PDF_HIGHLIGHT_COLORS[color.toLowerCase()];
  if (precomputed) return precomputed;
  if (color.startsWith('#')) return hexToRGB(color);
  console.warn(`Unknown annotation color: ${color}, using default yellow`);
  return DEFAULT_RGB_COLOR;
}

/**
 * Gets the hex value for a named color
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
 */
export function isValidHighlightColor(color: string): boolean {
  if (HIGHLIGHT_COLORS.some(c => c.value === color || c.hex === color)) return true;
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}
