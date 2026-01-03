"use client";

import { useMemo, useCallback } from "react";
import { MessageSquare } from "lucide-react";
import type { LatticeAnnotation } from "../../types/annotation";
import { denormalizePosition, type PixelRect } from "../../lib/annotation-coordinates";

// ============================================================================
// Types
// ============================================================================

interface AnnotationLayerProps {
  /** File identifier for filtering annotations */
  fileId: string;
  /** 1-indexed page number */
  page: number;
  /** Current zoom scale (1.0 = 100%) */
  scale: number;
  /** Page width in pixels at scale 1.0 */
  pageWidth: number;
  /** Page height in pixels at scale 1.0 */
  pageHeight: number;
  /** Annotations to render on this page */
  annotations: LatticeAnnotation[];
  /** Callback when an annotation is clicked */
  onAnnotationClick?: (annotation: LatticeAnnotation) => void;
  /** Callback when an annotation is hovered */
  onAnnotationHover?: (annotation: LatticeAnnotation | null) => void;
  /** Currently selected annotation ID */
  selectedAnnotationId?: string | null;
}

interface HighlightProps {
  annotation: LatticeAnnotation;
  scale: number;
  isSelected: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

// ============================================================================
// Color Mapping
// ============================================================================

const HIGHLIGHT_COLORS = {
  yellow: {
    fill: 'rgba(255, 235, 59, 0.35)',
    border: 'rgba(255, 193, 7, 0.8)',
    selected: 'rgba(255, 193, 7, 1)',
  },
  red: {
    fill: 'rgba(244, 67, 54, 0.35)',
    border: 'rgba(211, 47, 47, 0.8)',
    selected: 'rgba(211, 47, 47, 1)',
  },
  green: {
    fill: 'rgba(76, 175, 80, 0.35)',
    border: 'rgba(56, 142, 60, 0.8)',
    selected: 'rgba(56, 142, 60, 1)',
  },
  blue: {
    fill: 'rgba(33, 150, 243, 0.35)',
    border: 'rgba(25, 118, 210, 0.8)',
    selected: 'rgba(25, 118, 210, 1)',
  },
} as const;

// ============================================================================
// Helper Components
// ============================================================================

/**
 * Renders a single rectangle highlight
 */
function HighlightRect({
  rect,
  color,
  isSelected,
  hasComment,
  showCommentIndicator,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  rect: PixelRect;
  color: keyof typeof HIGHLIGHT_COLORS;
  isSelected: boolean;
  hasComment: boolean;
  showCommentIndicator: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const colors = HIGHLIGHT_COLORS[color];

  return (
    <div
      className="absolute cursor-pointer transition-all duration-150"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        backgroundColor: colors.fill,
        border: isSelected ? `2px solid ${colors.selected}` : 'none',
        boxShadow: isSelected ? `0 0 4px ${colors.selected}` : 'none',
      }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Comment indicator */}
      {showCommentIndicator && hasComment && (
        <div
          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm"
          title="Has comment"
        >
          <MessageSquare className="h-2.5 w-2.5" />
        </div>
      )}
    </div>
  );
}

/**
 * Renders a text highlight (potentially multi-line)
 */
function TextHighlight({
  annotation,
  scale,
  isSelected,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: HighlightProps) {
  const { rects } = useMemo(
    () => denormalizePosition(annotation.position, scale),
    [annotation.position, scale]
  );

  const hasComment = annotation.comment.length > 0;

  return (
    <>
      {rects.map((rect, index) => (
        <HighlightRect
          key={`${annotation.id}-rect-${index}`}
          rect={rect}
          color={annotation.color}
          isSelected={isSelected}
          hasComment={hasComment}
          showCommentIndicator={index === 0} // Only show indicator on first rect
          onClick={onClick}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        />
      ))}
    </>
  );
}

/**
 * Renders an area highlight (single rectangle with border)
 */
function AreaHighlight({
  annotation,
  scale,
  isSelected,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: HighlightProps) {
  const { boundingRect } = useMemo(
    () => denormalizePosition(annotation.position, scale),
    [annotation.position, scale]
  );

  const colors = HIGHLIGHT_COLORS[annotation.color];
  const hasComment = annotation.comment.length > 0;

  return (
    <div
      className="absolute cursor-pointer transition-all duration-150"
      style={{
        left: boundingRect.x,
        top: boundingRect.y,
        width: boundingRect.width,
        height: boundingRect.height,
        backgroundColor: colors.fill,
        border: `2px solid ${isSelected ? colors.selected : colors.border}`,
        boxShadow: isSelected ? `0 0 6px ${colors.selected}` : 'none',
      }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Comment indicator */}
      {hasComment && (
        <div
          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm"
          title="Has comment"
        >
          <MessageSquare className="h-2.5 w-2.5" />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Annotation Layer Component
 * 
 * Renders a transparent overlay on top of a PDF page that displays
 * all annotations (text highlights and area highlights) for that page.
 * 
 * Features:
 * - Renders text highlights as semi-transparent colored rectangles
 * - Renders area highlights as bordered rectangles
 * - Shows comment indicators on annotated highlights
 * - Supports z-index ordering by timestamp (newer on top)
 * - Handles click and hover events for annotation interaction
 */
export function AnnotationLayer({
  fileId,
  page,
  scale,
  pageWidth,
  pageHeight,
  annotations,
  onAnnotationClick,
  onAnnotationHover,
  selectedAnnotationId,
}: AnnotationLayerProps) {
  // Filter annotations for this page and sort by timestamp (older first = lower z-index)
  const pageAnnotations = useMemo(() => {
    return annotations
      .filter((a) => a.fileId === fileId && a.page === page)
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [annotations, fileId, page]);

  const handleClick = useCallback(
    (annotation: LatticeAnnotation) => {
      onAnnotationClick?.(annotation);
    },
    [onAnnotationClick]
  );

  const handleMouseEnter = useCallback(
    (annotation: LatticeAnnotation) => {
      onAnnotationHover?.(annotation);
    },
    [onAnnotationHover]
  );

  const handleMouseLeave = useCallback(() => {
    onAnnotationHover?.(null);
  }, [onAnnotationHover]);

  // Calculate scaled dimensions
  const scaledWidth = pageWidth * scale;
  const scaledHeight = pageHeight * scale;

  return (
    <div
      className="pointer-events-none absolute left-0 top-0"
      style={{
        width: scaledWidth,
        height: scaledHeight,
      }}
      data-annotation-layer
      data-page={page}
    >
      {pageAnnotations.map((annotation, index) => {
        const isSelected = annotation.id === selectedAnnotationId;
        const commonProps = {
          annotation,
          scale,
          isSelected,
          onClick: () => handleClick(annotation),
          onMouseEnter: () => handleMouseEnter(annotation),
          onMouseLeave: handleMouseLeave,
        };

        // Wrap in a container with pointer-events and z-index
        return (
          <div
            key={annotation.id}
            className="pointer-events-auto"
            style={{ zIndex: index + 1 }}
          >
            {annotation.type === 'text' ? (
              <TextHighlight {...commonProps} />
            ) : (
              <AreaHighlight {...commonProps} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Utility Exports
// ============================================================================

export { HIGHLIGHT_COLORS };
