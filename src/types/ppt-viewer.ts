/**
 * PPT Viewer Type Definitions
 * 
 * Core types and interfaces for the PowerPoint viewer component
 */

/**
 * Props for the main PowerPointViewer component
 */
export interface PowerPointViewerProps {
  content: ArrayBuffer;
  fileName: string;
}

/**
 * Individual slide data
 */
export interface SlideData {
  index: number;
  element: HTMLElement | null;
  thumbnailElement: HTMLElement | null;
  hasError: boolean;
  errorMessage?: string;
}

/**
 * Loading state for the viewer
 */
export interface LoadingState {
  isLoading: boolean;
  progress: number; // 0-100
  status: string;
  error: string | null;
}

/**
 * Viewer dimensions
 */
export interface ViewerDimensions {
  containerWidth: number;
  containerHeight: number;
  thumbnailPanelWidth: number;
  mainAreaWidth: number;
  mainAreaHeight: number;
}

/**
 * Layout calculation result
 */
export interface LayoutCalculation {
  thumbnailPanelWidth: number;
  mainAreaWidth: number;
  mainAreaHeight: number;
  slideScale: number;
  slideWidth: number;
  slideHeight: number;
  thumbnailWidth: number;
  thumbnailHeight: number;
}

/**
 * Layout constants for the PPT viewer
 */
export const LAYOUT_CONSTANTS = {
  /** Minimum width for thumbnail panel in pixels */
  THUMBNAIL_PANEL_MIN_WIDTH: 120,
  /** Maximum width for thumbnail panel in pixels */
  THUMBNAIL_PANEL_MAX_WIDTH: 200,
  /** Thumbnail panel width as ratio of container width */
  THUMBNAIL_PANEL_RATIO: 0.15,
  /** Minimum width for slide display in pixels */
  SLIDE_MIN_WIDTH: 400,
  /** Minimum height for slide display in pixels */
  SLIDE_MIN_HEIGHT: 225,
  /** Padding around the slide in pixels */
  SLIDE_PADDING: 24,
  /** Default slide aspect ratio (16:9) */
  DEFAULT_ASPECT_RATIO: 16 / 9,
  /** Standard 4:3 aspect ratio */
  STANDARD_ASPECT_RATIO: 4 / 3,
  /** Gap between thumbnails in pixels */
  THUMBNAIL_GAP: 8,
  /** Thumbnail padding in pixels */
  THUMBNAIL_PADDING: 4,
  /** Minimum container width to show thumbnail panel */
  MIN_WIDTH_FOR_THUMBNAILS: 600,
} as const;

/**
 * Default slide dimensions (in pixels at 100% zoom)
 */
export const DEFAULT_SLIDE_SIZE = {
  width: 960,
  height: 540,
} as const;

/**
 * Props for ThumbnailPanel component
 */
export interface ThumbnailPanelProps {
  slides: SlideData[];
  currentSlideIndex: number;
  onSlideSelect: (index: number) => void;
  panelWidth: number;
  containerHeight: number;
  slidesWithFormulas?: number[]; // Indices of slides that have formulas
}

/**
 * Props for ThumbnailItem component
 */
export interface ThumbnailItemProps {
  slide: SlideData;
  index: number;
  isSelected: boolean;
  onClick: () => void;
  width: number;
  height: number;
}

/**
 * Slide text paragraph with structure
 */
export interface SlideTextParagraph {
  text: string;
  isTitle?: boolean;
  isBullet?: boolean;
  isMath?: boolean;
  level?: number;
}

/**
 * Props for MainSlideArea component
 */
export interface MainSlideAreaProps {
  currentSlide: SlideData | null;
  slideScale: number;
  slideWidth: number;
  slideHeight: number;
  onNavigate: (direction: 'prev' | 'next') => void;
  extractedFormulas?: Array<{
    slideIndex: number;
    latex: string;
    html: string;
    originalOmml: string;
  }>;
  extractedTexts?: SlideTextParagraph[];
}

/**
 * Props for LoadingIndicator component
 */
export interface LoadingIndicatorProps {
  progress: number;
  status: string;
  isVisible: boolean;
}

/**
 * Navigation configuration
 */
export interface NavigationConfig {
  enableKeyboard: boolean;
  enableWheel: boolean;
  wheelDebounceMs: number;
}

/**
 * Formula enhancer configuration
 */
export interface FormulaEnhancerConfig {
  enableLatex: boolean;
  enableMathML: boolean;
  enableOMML: boolean;
  fallbackOnError: boolean;
}

/**
 * Formula rendering result
 */
export interface FormulaResult {
  success: boolean;
  html: string;
  originalText: string;
  errorMessage?: string;
}

/**
 * Loading error types
 */
export enum LoadingErrorType {
  INVALID_FILE = 'INVALID_FILE',
  PARSE_ERROR = 'PARSE_ERROR',
  RENDER_ERROR = 'RENDER_ERROR',
  MEMORY_ERROR = 'MEMORY_ERROR',
}

/**
 * Loading error structure
 */
export interface LoadingError {
  type: LoadingErrorType;
  message: string;
  slideIndex?: number;
}
