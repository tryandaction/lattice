"use client";

import { useMemo, useCallback, useState } from "react";
import { ChevronDown, ChevronRight, MessageSquare, FileText, Square } from "lucide-react";
import type { LatticeAnnotation } from "../../types/annotation";

// ============================================================================
// Types
// ============================================================================

interface AnnotationSidebarProps {
  /** File identifier */
  fileId: string;
  /** All annotations for the file */
  annotations: LatticeAnnotation[];
  /** Callback when an annotation is clicked */
  onAnnotationClick: (annotation: LatticeAnnotation) => void;
  /** Currently selected annotation ID */
  selectedAnnotationId?: string | null;
}

interface AnnotationGroup {
  page: number;
  annotations: LatticeAnnotation[];
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Truncates text to a maximum length with ellipsis
 * 
 * @param text - Text to truncate
 * @param maxLength - Maximum length (default: 50)
 * @returns Truncated text with ellipsis if needed
 */
export function truncateText(text: string, maxLength: number = 50): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Groups annotations by page number
 * 
 * @param annotations - Array of annotations
 * @returns Array of annotation groups sorted by page number
 */
export function groupAnnotationsByPage(annotations: LatticeAnnotation[]): AnnotationGroup[] {
  const groups = new Map<number, LatticeAnnotation[]>();

  for (const annotation of annotations) {
    const existing = groups.get(annotation.page) ?? [];
    groups.set(annotation.page, [...existing, annotation]);
  }

  // Sort groups by page number and annotations within each group by timestamp
  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([page, pageAnnotations]) => ({
      page,
      annotations: pageAnnotations.sort((a, b) => a.timestamp - b.timestamp),
    }));
}

// ============================================================================
// Color Configuration
// ============================================================================

const COLOR_STYLES = {
  yellow: 'bg-yellow-400',
  red: 'bg-red-500',
  green: 'bg-green-500',
  blue: 'bg-blue-500',
} as const;

// ============================================================================
// Sub-Components
// ============================================================================

interface AnnotationItemProps {
  annotation: LatticeAnnotation;
  isSelected: boolean;
  onClick: () => void;
}

/**
 * Single annotation item in the sidebar
 */
function AnnotationItem({ annotation, isSelected, onClick }: AnnotationItemProps) {
  const previewText = annotation.type === 'text' 
    ? annotation.content.text 
    : 'Area highlight';

  return (
    <button
      onClick={onClick}
      className={`w-full rounded-md px-2 py-2 text-left transition-colors ${
        isSelected 
          ? 'bg-primary/10 ring-1 ring-primary' 
          : 'hover:bg-muted'
      }`}
    >
      <div className="flex items-start gap-2">
        {/* Color indicator */}
        <div className={`mt-1 h-3 w-3 flex-shrink-0 rounded-full ${COLOR_STYLES[annotation.color]}`} />
        
        <div className="min-w-0 flex-1">
          {/* Type icon and preview */}
          <div className="flex items-center gap-1">
            {annotation.type === 'text' ? (
              <FileText className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
            ) : (
              <Square className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
            )}
            <span className="truncate text-sm">
              {previewText ? truncateText(previewText, 40) : 'No text'}
            </span>
          </div>

          {/* Comment preview */}
          {annotation.comment && (
            <div className="mt-1 flex items-start gap-1">
              <MessageSquare className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />
              <span className="line-clamp-2 text-xs text-muted-foreground">
                {truncateText(annotation.comment, 60)}
              </span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

interface PageGroupProps {
  group: AnnotationGroup;
  selectedAnnotationId: string | null | undefined;
  onAnnotationClick: (annotation: LatticeAnnotation) => void;
  defaultExpanded?: boolean;
}

/**
 * Collapsible group of annotations for a single page
 */
function PageGroup({ 
  group, 
  selectedAnnotationId, 
  onAnnotationClick,
  defaultExpanded = true,
}: PageGroupProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Page header */}
      <button
        onClick={toggleExpanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">Page {group.page}</span>
        <span className="text-xs text-muted-foreground">
          ({group.annotations.length})
        </span>
      </button>

      {/* Annotations list */}
      {isExpanded && (
        <div className="space-y-1 px-2 pb-2">
          {group.annotations.map((annotation) => (
            <AnnotationItem
              key={annotation.id}
              annotation={annotation}
              isSelected={annotation.id === selectedAnnotationId}
              onClick={() => onAnnotationClick(annotation)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Annotation Sidebar Component
 * 
 * Displays a scrollable list of annotations grouped by page number.
 * Features:
 * - Collapsible page groups
 * - Color indicator for each annotation
 * - Text preview and comment preview
 * - Click to navigate to annotation
 */
export function AnnotationSidebar({
  fileId,
  annotations,
  onAnnotationClick,
  selectedAnnotationId,
}: AnnotationSidebarProps) {
  // Filter annotations for this file and group by page
  const groups = useMemo(() => {
    const fileAnnotations = annotations.filter((a) => a.fileId === fileId);
    return groupAnnotationsByPage(fileAnnotations);
  }, [annotations, fileId]);

  const totalCount = useMemo(() => {
    return groups.reduce((sum, g) => sum + g.annotations.length, 0);
  }, [groups]);

  if (totalCount === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border px-3 py-2">
          <h3 className="text-sm font-medium">Annotations</h3>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-center text-sm text-muted-foreground">
            No annotations yet.
            <br />
            Select text or Alt+drag to create highlights.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-3 py-2">
        <h3 className="text-sm font-medium">
          Annotations ({totalCount})
        </h3>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto">
        {groups.map((group) => (
          <PageGroup
            key={group.page}
            group={group}
            selectedAnnotationId={selectedAnnotationId}
            onAnnotationClick={onAnnotationClick}
          />
        ))}
      </div>
    </div>
  );
}
