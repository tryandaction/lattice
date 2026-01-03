"use client";

/**
 * Annotation Integration Components
 * 
 * Provides integration utilities for connecting the universal annotation
 * system to existing viewers (PDF, Image, Code).
 */

import { useCallback, useEffect, useState, createContext, useContext, type ReactNode } from 'react';
import type { AnnotationItem, AnnotationTarget, AnnotationFileType } from '../../types/universal-annotation';
import { useAnnotationNavigation, triggerAnnotationNavigation } from '../../hooks/use-annotation-navigation';
import { UniversalAnnotationSidebar } from './universal-annotation-sidebar';

// ============================================================================
// Context for Annotation Integration
// ============================================================================

interface AnnotationIntegrationContextValue {
  annotations: AnnotationItem[];
  selectedAnnotationId: string | null;
  setSelectedAnnotationId: (id: string | null) => void;
  scrollToAnnotation: (id: string) => void;
  fileType: AnnotationFileType;
}

const AnnotationIntegrationContext = createContext<AnnotationIntegrationContextValue | null>(null);

/**
 * Hook to access annotation integration context
 */
export function useAnnotationIntegration() {
  const context = useContext(AnnotationIntegrationContext);
  if (!context) {
    throw new Error('useAnnotationIntegration must be used within AnnotationIntegrationProvider');
  }
  return context;
}

// ============================================================================
// Provider Component
// ============================================================================

interface AnnotationIntegrationProviderProps {
  children: ReactNode;
  annotations: AnnotationItem[];
  fileType: AnnotationFileType;
  onAnnotationSelect?: (annotation: AnnotationItem | null) => void;
}

/**
 * Provider component for annotation integration
 * 
 * Wraps a viewer component to provide annotation context and navigation.
 */
export function AnnotationIntegrationProvider({
  children,
  annotations,
  fileType,
  onAnnotationSelect,
}: AnnotationIntegrationProviderProps) {
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  const handleSetSelectedAnnotationId = useCallback((id: string | null) => {
    setSelectedAnnotationId(id);
    if (onAnnotationSelect) {
      const annotation = id ? annotations.find(a => a.id === id) ?? null : null;
      onAnnotationSelect(annotation);
    }
  }, [annotations, onAnnotationSelect]);

  const scrollToAnnotation = useCallback((id: string) => {
    const annotation = annotations.find(a => a.id === id);
    if (annotation) {
      triggerAnnotationNavigation(id, annotation.target);
      handleSetSelectedAnnotationId(id);
    }
  }, [annotations, handleSetSelectedAnnotationId]);

  const value: AnnotationIntegrationContextValue = {
    annotations,
    selectedAnnotationId,
    setSelectedAnnotationId: handleSetSelectedAnnotationId,
    scrollToAnnotation,
    fileType,
  };

  return (
    <AnnotationIntegrationContext.Provider value={value}>
      {children}
    </AnnotationIntegrationContext.Provider>
  );
}

// ============================================================================
// Sidebar Integration Component
// ============================================================================

interface AnnotationSidebarIntegrationProps {
  annotations: AnnotationItem[];
  selectedAnnotationId?: string | null;
  onAnnotationClick: (annotation: AnnotationItem) => void;
  isLoading?: boolean;
  className?: string;
}

/**
 * Integrated annotation sidebar that works with the universal annotation system
 */
export function AnnotationSidebarIntegration({
  annotations,
  selectedAnnotationId,
  onAnnotationClick,
  isLoading = false,
  className = '',
}: AnnotationSidebarIntegrationProps) {
  return (
    <div className={`h-full ${className}`}>
      <UniversalAnnotationSidebar
        annotations={annotations}
        selectedAnnotationId={selectedAnnotationId}
        onAnnotationClick={onAnnotationClick}
        isLoading={isLoading}
      />
    </div>
  );
}

// ============================================================================
// Navigation Handler Hooks for Specific Viewers
// ============================================================================

interface UsePdfAnnotationNavigationOptions {
  /** Callback to scroll to a specific page */
  onScrollToPage: (page: number) => void;
  /** Callback when an annotation is navigated to */
  onAnnotationNavigated?: (annotationId: string, page: number) => void;
}

/**
 * Hook for PDF viewer annotation navigation
 */
export function usePdfAnnotationNavigation({
  onScrollToPage,
  onAnnotationNavigated,
}: UsePdfAnnotationNavigationOptions) {
  useAnnotationNavigation({
    handlers: {
      onPdfNavigate: (page, annotationId) => {
        onScrollToPage(page);
        onAnnotationNavigated?.(annotationId, page);
      },
    },
  });
}

interface UseImageAnnotationNavigationOptions {
  /** Callback to highlight a region */
  onHighlightRegion: (x: number, y: number, width: number, height: number) => void;
  /** Callback when an annotation is navigated to */
  onAnnotationNavigated?: (annotationId: string) => void;
}

/**
 * Hook for image viewer annotation navigation
 */
export function useImageAnnotationNavigation({
  onHighlightRegion,
  onAnnotationNavigated,
}: UseImageAnnotationNavigationOptions) {
  useAnnotationNavigation({
    handlers: {
      onImageNavigate: (x, y, width, height, annotationId) => {
        onHighlightRegion(x, y, width, height);
        onAnnotationNavigated?.(annotationId);
      },
    },
  });
}

interface UseCodeAnnotationNavigationOptions {
  /** Callback to scroll to a specific line */
  onScrollToLine: (line: number) => void;
  /** Callback when an annotation is navigated to */
  onAnnotationNavigated?: (annotationId: string, line: number) => void;
}

/**
 * Hook for code editor annotation navigation
 */
export function useCodeAnnotationNavigation({
  onScrollToLine,
  onAnnotationNavigated,
}: UseCodeAnnotationNavigationOptions) {
  useAnnotationNavigation({
    handlers: {
      onCodeLineNavigate: (line, annotationId) => {
        onScrollToLine(line);
        onAnnotationNavigated?.(annotationId, line);
      },
    },
  });
}

// ============================================================================
// Highlight Overlay Component for Image Annotations
// ============================================================================

interface ImageAnnotationOverlayProps {
  /** Annotations to display */
  annotations: AnnotationItem[];
  /** Currently selected annotation ID */
  selectedAnnotationId?: string | null;
  /** Callback when an annotation is clicked */
  onAnnotationClick?: (annotation: AnnotationItem) => void;
  /** Current zoom level */
  zoom?: number;
  /** Container width */
  containerWidth: number;
  /** Container height */
  containerHeight: number;
}

/**
 * Overlay component for displaying image annotations
 */
export function ImageAnnotationOverlay({
  annotations,
  selectedAnnotationId,
  onAnnotationClick,
  zoom = 1,
  containerWidth,
  containerHeight,
}: ImageAnnotationOverlayProps) {
  // Filter to only image annotations
  const imageAnnotations = annotations.filter(a => a.target.type === 'image');

  if (imageAnnotations.length === 0) return null;

  return (
    <div 
      className="pointer-events-none absolute inset-0"
      style={{ width: containerWidth, height: containerHeight }}
    >
      {imageAnnotations.map(annotation => {
        if (annotation.target.type !== 'image') return null;
        
        const { x, y, width, height } = annotation.target;
        const isSelected = annotation.id === selectedAnnotationId;
        
        // Convert percentage coordinates to pixels
        const left = (x / 100) * containerWidth * zoom;
        const top = (y / 100) * containerHeight * zoom;
        const rectWidth = (width / 100) * containerWidth * zoom;
        const rectHeight = (height / 100) * containerHeight * zoom;
        
        return (
          <div
            key={annotation.id}
            className={`pointer-events-auto absolute cursor-pointer transition-all ${
              isSelected 
                ? 'ring-2 ring-primary ring-offset-2' 
                : 'hover:ring-2 hover:ring-primary/50'
            }`}
            style={{
              left,
              top,
              width: rectWidth,
              height: rectHeight,
              backgroundColor: `${annotation.style.color}33`, // 20% opacity
              border: `2px solid ${annotation.style.color}`,
            }}
            onClick={() => onAnnotationClick?.(annotation)}
            title={annotation.comment || annotation.content || 'Annotation'}
          />
        );
      })}
    </div>
  );
}

// ============================================================================
// Code Line Highlight Component
// ============================================================================

interface CodeLineHighlightProps {
  /** Line number to highlight (1-indexed) */
  line: number;
  /** Highlight color */
  color: string;
  /** Whether this highlight is selected */
  isSelected?: boolean;
  /** Line height in pixels */
  lineHeight?: number;
}

/**
 * Component for highlighting a code line
 */
export function CodeLineHighlight({
  line,
  color,
  isSelected = false,
  lineHeight = 20,
}: CodeLineHighlightProps) {
  const top = (line - 1) * lineHeight;
  
  return (
    <div
      className={`absolute left-0 right-0 pointer-events-none ${
        isSelected ? 'ring-1 ring-primary' : ''
      }`}
      style={{
        top,
        height: lineHeight,
        backgroundColor: `${color}33`, // 20% opacity
        borderLeft: `3px solid ${color}`,
      }}
    />
  );
}

// ============================================================================
// Utility: Convert Legacy Annotation to Universal Format
// ============================================================================

import type { LatticeAnnotation } from '../../types/annotation';

/**
 * Converts a legacy LatticeAnnotation to the universal AnnotationItem format
 * for display purposes (not for storage migration)
 */
export function legacyToUniversalAnnotation(legacy: LatticeAnnotation): AnnotationItem {
  return {
    id: legacy.id,
    target: {
      type: 'pdf',
      page: legacy.page,
      rects: legacy.position.rects.map(r => ({
        x1: r.x1,
        y1: r.y1,
        x2: r.x2,
        y2: r.y2,
      })),
    },
    style: {
      color: legacy.color,
      type: legacy.type === 'text' ? 'highlight' : 'area',
    },
    content: legacy.content.text,
    comment: legacy.comment || undefined,
    author: 'user',
    createdAt: legacy.timestamp,
  };
}

/**
 * Converts an array of legacy annotations to universal format
 */
export function legacyToUniversalAnnotations(legacy: LatticeAnnotation[]): AnnotationItem[] {
  return legacy.map(legacyToUniversalAnnotation);
}
