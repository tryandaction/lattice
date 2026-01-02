/**
 * PPT Layout Adapter Module
 * 
 * Provides layout calculation utilities for PowerPoint viewer:
 * - Optimal zoom calculation to fit slides within container
 * - Aspect ratio preservation
 * - Centering calculations
 * - Fit to width/height functions
 */

/**
 * Standard PPT aspect ratios
 */
export const ASPECT_RATIOS = {
  WIDESCREEN: 16 / 9,  // 1.778
  STANDARD: 4 / 3,     // 1.333
} as const;

/**
 * Default slide dimensions (in pixels at 100% zoom)
 */
export const DEFAULT_SLIDE_SIZE = {
  width: 960,
  height: 540,
} as const;

/**
 * Zoom constraints
 */
export const ZOOM_LIMITS = {
  MIN: 10,   // 10%
  MAX: 400,  // 400%
  STEP: 10,  // 10% increments
} as const;

/**
 * Calculate the optimal zoom level to fit a slide within a container
 * while maintaining aspect ratio.
 * 
 * @param containerWidth - Width of the container in pixels
 * @param containerHeight - Height of the container in pixels
 * @param slideWidth - Width of the slide in pixels
 * @param slideHeight - Height of the slide in pixels
 * @param padding - Optional padding around the slide (default: 20px)
 * @returns Optimal zoom level as a decimal (e.g., 0.75 for 75%)
 */
export function calculateOptimalZoom(
  containerWidth: number,
  containerHeight: number,
  slideWidth: number,
  slideHeight: number,
  padding: number = 20
): number {
  // Validate inputs
  if (containerWidth <= 0 || containerHeight <= 0 || slideWidth <= 0 || slideHeight <= 0) {
    return 1;
  }
  
  // Available space after padding
  const availableWidth = Math.max(containerWidth - padding * 2, 1);
  const availableHeight = Math.max(containerHeight - padding * 2, 1);
  
  // Calculate zoom to fit width and height
  const zoomToFitWidth = availableWidth / slideWidth;
  const zoomToFitHeight = availableHeight / slideHeight;
  
  // Use the smaller zoom to ensure the slide fits in both dimensions
  const optimalZoom = Math.min(zoomToFitWidth, zoomToFitHeight);
  
  // Clamp to zoom limits
  return Math.max(ZOOM_LIMITS.MIN / 100, Math.min(ZOOM_LIMITS.MAX / 100, optimalZoom));
}

/**
 * Calculate zoom level to fit the slide width within the container
 * 
 * @param containerWidth - Width of the container in pixels
 * @param slideWidth - Width of the slide in pixels
 * @param padding - Optional padding (default: 20px)
 * @returns Zoom level as a decimal
 */
export function fitToWidth(
  containerWidth: number,
  slideWidth: number,
  padding: number = 20
): number {
  if (containerWidth <= 0 || slideWidth <= 0) {
    return 1;
  }
  
  const availableWidth = Math.max(containerWidth - padding * 2, 1);
  const zoom = availableWidth / slideWidth;
  
  return Math.max(ZOOM_LIMITS.MIN / 100, Math.min(ZOOM_LIMITS.MAX / 100, zoom));
}

/**
 * Calculate zoom level to fit the slide height within the container
 * 
 * @param containerHeight - Height of the container in pixels
 * @param slideHeight - Height of the slide in pixels
 * @param padding - Optional padding (default: 20px)
 * @returns Zoom level as a decimal
 */
export function fitToHeight(
  containerHeight: number,
  slideHeight: number,
  padding: number = 20
): number {
  if (containerHeight <= 0 || slideHeight <= 0) {
    return 1;
  }
  
  const availableHeight = Math.max(containerHeight - padding * 2, 1);
  const zoom = availableHeight / slideHeight;
  
  return Math.max(ZOOM_LIMITS.MIN / 100, Math.min(ZOOM_LIMITS.MAX / 100, zoom));
}

/**
 * Calculate the center position for a slide within a container
 * 
 * @param containerWidth - Width of the container in pixels
 * @param containerHeight - Height of the container in pixels
 * @param slideWidth - Width of the slide in pixels
 * @param slideHeight - Height of the slide in pixels
 * @param zoom - Current zoom level as a decimal
 * @returns Object with x and y offsets for centering
 */
export function calculateCenterPosition(
  containerWidth: number,
  containerHeight: number,
  slideWidth: number,
  slideHeight: number,
  zoom: number
): { x: number; y: number } {
  const scaledWidth = slideWidth * zoom;
  const scaledHeight = slideHeight * zoom;
  
  return {
    x: Math.max(0, (containerWidth - scaledWidth) / 2),
    y: Math.max(0, (containerHeight - scaledHeight) / 2),
  };
}

/**
 * Adjust zoom by a step amount
 * 
 * @param currentZoom - Current zoom level as percentage (e.g., 100 for 100%)
 * @param direction - 'in' to zoom in, 'out' to zoom out
 * @param step - Step amount in percentage (default: 10)
 * @returns New zoom level as percentage
 */
export function adjustZoom(
  currentZoom: number,
  direction: 'in' | 'out',
  step: number = ZOOM_LIMITS.STEP
): number {
  const newZoom = direction === 'in' ? currentZoom + step : currentZoom - step;
  return Math.max(ZOOM_LIMITS.MIN, Math.min(ZOOM_LIMITS.MAX, newZoom));
}

/**
 * Convert zoom percentage to decimal
 * 
 * @param percentage - Zoom as percentage (e.g., 100)
 * @returns Zoom as decimal (e.g., 1.0)
 */
export function zoomToDecimal(percentage: number): number {
  return percentage / 100;
}

/**
 * Convert zoom decimal to percentage
 * 
 * @param decimal - Zoom as decimal (e.g., 1.0)
 * @returns Zoom as percentage (e.g., 100)
 */
export function zoomToPercentage(decimal: number): number {
  return Math.round(decimal * 100);
}

/**
 * Detect the aspect ratio of a slide
 * 
 * @param width - Slide width
 * @param height - Slide height
 * @returns 'widescreen' (16:9), 'standard' (4:3), or 'custom'
 */
export function detectAspectRatio(
  width: number,
  height: number
): 'widescreen' | 'standard' | 'custom' {
  if (width <= 0 || height <= 0) {
    return 'custom';
  }
  
  const ratio = width / height;
  const tolerance = 0.05;
  
  if (Math.abs(ratio - ASPECT_RATIOS.WIDESCREEN) < tolerance) {
    return 'widescreen';
  }
  
  if (Math.abs(ratio - ASPECT_RATIOS.STANDARD) < tolerance) {
    return 'standard';
  }
  
  return 'custom';
}

/**
 * Calculate slide dimensions that maintain aspect ratio
 * 
 * @param targetWidth - Target width
 * @param targetHeight - Target height
 * @param aspectRatio - Aspect ratio to maintain (width/height)
 * @returns Dimensions that fit within target while maintaining aspect ratio
 */
export function calculateAspectRatioDimensions(
  targetWidth: number,
  targetHeight: number,
  aspectRatio: number
): { width: number; height: number } {
  if (targetWidth <= 0 || targetHeight <= 0 || aspectRatio <= 0) {
    return { width: targetWidth, height: targetHeight };
  }
  
  const targetRatio = targetWidth / targetHeight;
  
  if (targetRatio > aspectRatio) {
    // Container is wider than slide - fit to height
    return {
      width: targetHeight * aspectRatio,
      height: targetHeight,
    };
  } else {
    // Container is taller than slide - fit to width
    return {
      width: targetWidth,
      height: targetWidth / aspectRatio,
    };
  }
}
