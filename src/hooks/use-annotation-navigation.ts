/**
 * Annotation Navigation Hook
 * 
 * Provides event-based navigation for scroll-to-annotation functionality.
 * Viewers can subscribe to navigation events and handle them appropriately
 * based on their target type.
 */

import { useEffect, useCallback } from 'react';
import type { AnnotationTarget } from '../types/universal-annotation';
import { ANNOTATION_NAVIGATION_EVENT, type AnnotationNavigationEvent } from './use-annotation-system';

// ============================================================================
// Types
// ============================================================================

export interface NavigationHandler {
  /** Handle PDF target navigation (scroll to page) */
  onPdfNavigate?: (page: number, annotationId: string) => void;
  /** Handle image target navigation (highlight region) */
  onImageNavigate?: (x: number, y: number, width: number, height: number, annotationId: string) => void;
  /** Handle code line target navigation (scroll to line) */
  onCodeLineNavigate?: (line: number, annotationId: string) => void;
  /** Handle text anchor target navigation (scroll to element) */
  onTextAnchorNavigate?: (elementId: string, offset: number, annotationId: string) => void;
}

export interface UseAnnotationNavigationOptions {
  /** Whether navigation is enabled */
  enabled?: boolean;
  /** Navigation handlers for different target types */
  handlers: NavigationHandler;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for handling annotation navigation events
 * 
 * Subscribes to the global annotation navigation event and dispatches
 * to the appropriate handler based on target type.
 * 
 * @example
 * ```tsx
 * useAnnotationNavigation({
 *   handlers: {
 *     onPdfNavigate: (page, id) => scrollToPage(page),
 *     onCodeLineNavigate: (line, id) => scrollToLine(line),
 *   }
 * });
 * ```
 */
export function useAnnotationNavigation({
  enabled = true,
  handlers,
}: UseAnnotationNavigationOptions): void {
  const handleNavigationEvent = useCallback((event: Event) => {
    const customEvent = event as CustomEvent<AnnotationNavigationEvent>;
    const { annotationId, target } = customEvent.detail;
    
    switch (target.type) {
      case 'pdf':
        handlers.onPdfNavigate?.(target.page, annotationId);
        break;
      case 'image':
        handlers.onImageNavigate?.(
          target.x,
          target.y,
          target.width,
          target.height,
          annotationId
        );
        break;
      case 'code_line':
        handlers.onCodeLineNavigate?.(target.line, annotationId);
        break;
      case 'text_anchor':
        handlers.onTextAnchorNavigate?.(
          target.elementId,
          target.offset,
          annotationId
        );
        break;
    }
  }, [handlers]);

  useEffect(() => {
    if (!enabled) return;
    
    window.addEventListener(ANNOTATION_NAVIGATION_EVENT, handleNavigationEvent);
    
    return () => {
      window.removeEventListener(ANNOTATION_NAVIGATION_EVENT, handleNavigationEvent);
    };
  }, [enabled, handleNavigationEvent]);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Programmatically trigger annotation navigation
 * 
 * @param annotationId - ID of the annotation to navigate to
 * @param target - Target location information
 */
export function triggerAnnotationNavigation(
  annotationId: string,
  target: AnnotationTarget
): void {
  const event = new CustomEvent<AnnotationNavigationEvent>(ANNOTATION_NAVIGATION_EVENT, {
    detail: { annotationId, target },
  });
  window.dispatchEvent(event);
}

/**
 * Creates a PDF navigation trigger
 */
export function createPdfNavigationTrigger(annotationId: string, page: number): () => void {
  return () => triggerAnnotationNavigation(annotationId, {
    type: 'pdf',
    page,
    rects: [],
  });
}

/**
 * Creates a code line navigation trigger
 */
export function createCodeLineNavigationTrigger(annotationId: string, line: number): () => void {
  return () => triggerAnnotationNavigation(annotationId, {
    type: 'code_line',
    line,
  });
}

/**
 * Creates an image region navigation trigger
 */
export function createImageNavigationTrigger(
  annotationId: string,
  x: number,
  y: number,
  width: number,
  height: number
): () => void {
  return () => triggerAnnotationNavigation(annotationId, {
    type: 'image',
    x,
    y,
    width,
    height,
  });
}
