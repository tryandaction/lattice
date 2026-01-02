/**
 * PPT Viewer Layout Calculator
 * 
 * Provides layout calculation utilities for the PowerPoint viewer:
 * - Thumbnail panel sizing
 * - Main slide area sizing
 * - Slide scaling with aspect ratio preservation
 * - Responsive layout adjustments
 */

import {
  LayoutCalculation,
  LAYOUT_CONSTANTS,
  DEFAULT_SLIDE_SIZE,
} from '../types/ppt-viewer';

/**
 * Calculate the complete layout for the PPT viewer
 * 
 * @param containerWidth - Total container width in pixels
 * @param containerHeight - Total container height in pixels
 * @param slideAspectRatio - Aspect ratio of the slides (width/height)
 * @returns Complete layout calculation
 */
export function calculateViewerLayout(
  containerWidth: number,
  containerHeight: number,
  slideAspectRatio: number = LAYOUT_CONSTANTS.DEFAULT_ASPECT_RATIO
): LayoutCalculation {
  // Validate inputs
  if (containerWidth <= 0 || containerHeight <= 0) {
    return getDefaultLayout();
  }

  // Calculate thumbnail panel width
  const thumbnailPanelWidth = calculateThumbnailPanelWidth(containerWidth);
  
  // Calculate main area dimensions
  const mainAreaWidth = containerWidth - thumbnailPanelWidth;
  const mainAreaHeight = containerHeight;
  
  // Calculate slide dimensions with aspect ratio preservation
  const { slideWidth, slideHeight, slideScale } = calculateSlideSize(
    mainAreaWidth,
    mainAreaHeight,
    slideAspectRatio
  );
  
  // Calculate thumbnail dimensions
  const { thumbnailWidth, thumbnailHeight } = calculateThumbnailSize(
    thumbnailPanelWidth,
    slideAspectRatio
  );
  
  return {
    thumbnailPanelWidth,
    mainAreaWidth,
    mainAreaHeight,
    slideScale,
    slideWidth,
    slideHeight,
    thumbnailWidth,
    thumbnailHeight,
  };
}

/**
 * Calculate thumbnail panel width based on container width
 * 
 * @param containerWidth - Total container width
 * @returns Thumbnail panel width
 */
export function calculateThumbnailPanelWidth(containerWidth: number): number {
  // Hide thumbnail panel if container is too narrow
  if (containerWidth < LAYOUT_CONSTANTS.MIN_WIDTH_FOR_THUMBNAILS) {
    return 0;
  }
  
  // Calculate proportional width
  const proportionalWidth = containerWidth * LAYOUT_CONSTANTS.THUMBNAIL_PANEL_RATIO;
  
  // Clamp to min/max bounds
  return Math.max(
    LAYOUT_CONSTANTS.THUMBNAIL_PANEL_MIN_WIDTH,
    Math.min(LAYOUT_CONSTANTS.THUMBNAIL_PANEL_MAX_WIDTH, proportionalWidth)
  );
}

/**
 * Calculate slide size with aspect ratio preservation
 * 
 * @param availableWidth - Available width for the slide
 * @param availableHeight - Available height for the slide
 * @param aspectRatio - Slide aspect ratio (width/height)
 * @returns Slide dimensions and scale
 */
export function calculateSlideSize(
  availableWidth: number,
  availableHeight: number,
  aspectRatio: number = LAYOUT_CONSTANTS.DEFAULT_ASPECT_RATIO
): { slideWidth: number; slideHeight: number; slideScale: number } {
  // Validate inputs
  if (availableWidth <= 0 || availableHeight <= 0 || aspectRatio <= 0) {
    return {
      slideWidth: DEFAULT_SLIDE_SIZE.width,
      slideHeight: DEFAULT_SLIDE_SIZE.height,
      slideScale: 1,
    };
  }
  
  // Account for padding
  const paddedWidth = Math.max(availableWidth - LAYOUT_CONSTANTS.SLIDE_PADDING * 2, 1);
  const paddedHeight = Math.max(availableHeight - LAYOUT_CONSTANTS.SLIDE_PADDING * 2, 1);
  
  // Calculate dimensions that fit within available space while preserving aspect ratio
  const widthBasedHeight = paddedWidth / aspectRatio;
  const heightBasedWidth = paddedHeight * aspectRatio;
  
  let slideWidth: number;
  let slideHeight: number;
  
  if (widthBasedHeight <= paddedHeight) {
    // Width is the limiting factor
    slideWidth = paddedWidth;
    slideHeight = widthBasedHeight;
  } else {
    // Height is the limiting factor
    slideWidth = heightBasedWidth;
    slideHeight = paddedHeight;
  }
  
  // Ensure slide fits within padded area (final safety check)
  if (slideWidth > paddedWidth) {
    slideWidth = paddedWidth;
    slideHeight = slideWidth / aspectRatio;
  }
  if (slideHeight > paddedHeight) {
    slideHeight = paddedHeight;
    slideWidth = slideHeight * aspectRatio;
  }
  
  // Calculate scale relative to default slide size
  const slideScale = slideWidth / DEFAULT_SLIDE_SIZE.width;
  
  return {
    slideWidth: Math.round(slideWidth),
    slideHeight: Math.round(slideHeight),
    slideScale,
  };
}

/**
 * Calculate thumbnail size based on panel width
 * 
 * @param panelWidth - Thumbnail panel width
 * @param aspectRatio - Slide aspect ratio
 * @returns Thumbnail dimensions
 */
export function calculateThumbnailSize(
  panelWidth: number,
  aspectRatio: number = LAYOUT_CONSTANTS.DEFAULT_ASPECT_RATIO
): { thumbnailWidth: number; thumbnailHeight: number } {
  if (panelWidth <= 0) {
    return { thumbnailWidth: 0, thumbnailHeight: 0 };
  }
  
  // Account for padding
  const thumbnailWidth = panelWidth - LAYOUT_CONSTANTS.THUMBNAIL_PADDING * 2;
  const thumbnailHeight = thumbnailWidth / aspectRatio;
  
  return {
    thumbnailWidth: Math.round(thumbnailWidth),
    thumbnailHeight: Math.round(thumbnailHeight),
  };
}

/**
 * Verify that aspect ratio is preserved within tolerance
 * 
 * @param width - Calculated width
 * @param height - Calculated height
 * @param expectedRatio - Expected aspect ratio
 * @param tolerance - Acceptable tolerance (default 0.01)
 * @returns Whether aspect ratio is preserved
 */
export function isAspectRatioPreserved(
  width: number,
  height: number,
  expectedRatio: number,
  tolerance: number = 0.01
): boolean {
  if (height === 0) return false;
  const actualRatio = width / height;
  return Math.abs(actualRatio - expectedRatio) <= tolerance;
}

/**
 * Check if dimensions are within valid bounds
 * 
 * @param slideWidth - Slide width
 * @param slideHeight - Slide height
 * @param containerWidth - Container width
 * @param containerHeight - Container height
 * @returns Whether dimensions are valid
 */
export function areDimensionsValid(
  slideWidth: number,
  slideHeight: number,
  containerWidth: number,
  containerHeight: number
): boolean {
  // Check minimum size
  if (slideWidth < LAYOUT_CONSTANTS.SLIDE_MIN_WIDTH || 
      slideHeight < LAYOUT_CONSTANTS.SLIDE_MIN_HEIGHT) {
    // Allow smaller if container is smaller
    if (containerWidth >= LAYOUT_CONSTANTS.SLIDE_MIN_WIDTH + LAYOUT_CONSTANTS.SLIDE_PADDING * 2 &&
        containerHeight >= LAYOUT_CONSTANTS.SLIDE_MIN_HEIGHT + LAYOUT_CONSTANTS.SLIDE_PADDING * 2) {
      return false;
    }
  }
  
  // Check that slide fits within container (with padding)
  const maxWidth = containerWidth - LAYOUT_CONSTANTS.SLIDE_PADDING * 2;
  const maxHeight = containerHeight - LAYOUT_CONSTANTS.SLIDE_PADDING * 2;
  
  return slideWidth <= maxWidth + 1 && slideHeight <= maxHeight + 1; // +1 for rounding tolerance
}

/**
 * Get default layout for invalid inputs
 */
function getDefaultLayout(): LayoutCalculation {
  return {
    thumbnailPanelWidth: LAYOUT_CONSTANTS.THUMBNAIL_PANEL_MIN_WIDTH,
    mainAreaWidth: DEFAULT_SLIDE_SIZE.width + LAYOUT_CONSTANTS.SLIDE_PADDING * 2,
    mainAreaHeight: DEFAULT_SLIDE_SIZE.height + LAYOUT_CONSTANTS.SLIDE_PADDING * 2,
    slideScale: 1,
    slideWidth: DEFAULT_SLIDE_SIZE.width,
    slideHeight: DEFAULT_SLIDE_SIZE.height,
    thumbnailWidth: LAYOUT_CONSTANTS.THUMBNAIL_PANEL_MIN_WIDTH - LAYOUT_CONSTANTS.THUMBNAIL_PADDING * 2,
    thumbnailHeight: (LAYOUT_CONSTANTS.THUMBNAIL_PANEL_MIN_WIDTH - LAYOUT_CONSTANTS.THUMBNAIL_PADDING * 2) / LAYOUT_CONSTANTS.DEFAULT_ASPECT_RATIO,
  };
}

/**
 * Detect aspect ratio from slide dimensions
 * 
 * @param width - Slide width
 * @param height - Slide height
 * @returns Detected aspect ratio or default
 */
export function detectSlideAspectRatio(width: number, height: number): number {
  if (width <= 0 || height <= 0) {
    return LAYOUT_CONSTANTS.DEFAULT_ASPECT_RATIO;
  }
  
  const ratio = width / height;
  
  // Check if close to standard ratios
  if (Math.abs(ratio - LAYOUT_CONSTANTS.DEFAULT_ASPECT_RATIO) < 0.1) {
    return LAYOUT_CONSTANTS.DEFAULT_ASPECT_RATIO; // 16:9
  }
  
  if (Math.abs(ratio - LAYOUT_CONSTANTS.STANDARD_ASPECT_RATIO) < 0.1) {
    return LAYOUT_CONSTANTS.STANDARD_ASPECT_RATIO; // 4:3
  }
  
  return ratio;
}
