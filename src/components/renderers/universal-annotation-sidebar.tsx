"use client";

/**
 * Universal Annotation Sidebar
 * 
 * Displays a scrollable list of annotations for any file type,
 * with support for navigation and real-time updates.
 */

import { useMemo, useCallback, useState } from "react";
import { 
  ChevronDown, 
  ChevronRight, 
  MessageSquare, 
  FileText, 
  Square,
  Image as ImageIcon,
  Code,
  Link,
  File
} from "lucide-react";
import type { AnnotationItem, AnnotationTarget } from "../../types/universal-annotation";

// ============================================================================
// Types
// ============================================================================

interface UniversalAnnotationSidebarProps {
  /** All annotations for the file */
  annotations: AnnotationItem[];
  /** Callback when an annotation is clicked */
  onAnnotationClick: (annotation: AnnotationItem) => void;
  /** Currently selected annotation ID */
  selectedAnnotationId?: string | null;
  /** Whether the sidebar is loading */
  isLoading?: boolean;
}

interface AnnotationGroup {
  key: string;
  label: string;
  annotations: AnnotationItem[];
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Truncates text to a maximum length with ellipsis
 */
export function truncateText(text: string, maxLength: number = 50): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Gets a display label for an annotation target
 */
function getTargetLabel(target: AnnotationTarget): string {
  switch (target.type) {
    case 'pdf':
      return `Page ${target.page}`;
    case 'code_line':
      return `Line ${target.line}`;
    case 'image':
      return 'Image Region';
    case 'text_anchor':
      return `Element: ${target.elementId}`;
    default:
      return 'Unknown';
  }
}

/**
 * Gets a grouping key for an annotation
 */
function getGroupKey(target: AnnotationTarget): string {
  switch (target.type) {
    case 'pdf':
      return `pdf-page-${target.page}`;
    case 'code_line':
      // Group code lines in ranges of 50
      const rangeStart = Math.floor((target.line - 1) / 50) * 50 + 1;
      const rangeEnd = rangeStart + 49;
      return `code-lines-${rangeStart}-${rangeEnd}`;
    case 'image':
      return 'image-regions';
    case 'text_anchor':
      return `text-anchor-${target.elementId}`;
    default:
      return 'other';
  }
}

/**
 * Gets a group label from a group key
 */
function getGroupLabel(key: string): string {
  if (key.startsWith('pdf-page-')) {
    return `Page ${key.replace('pdf-page-', '')}`;
  }
  if (key.startsWith('code-lines-')) {
    const range = key.replace('code-lines-', '');
    return `Lines ${range.replace('-', ' - ')}`;
  }
  if (key === 'image-regions') {
    return 'Image Regions';
  }
  if (key.startsWith('text-anchor-')) {
    return `Element: ${key.replace('text-anchor-', '')}`;
  }
  return 'Other';
}

/**
 * Groups annotations by their target location
 */
export function groupAnnotations(annotations: AnnotationItem[]): AnnotationGroup[] {
  const groups = new Map<string, AnnotationItem[]>();

  for (const annotation of annotations) {
    const key = getGroupKey(annotation.target);
    const existing = groups.get(key) ?? [];
    groups.set(key, [...existing, annotation]);
  }

  // Sort groups and annotations within each group
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, groupAnnotations]) => ({
      key,
      label: getGroupLabel(key),
      annotations: groupAnnotations.sort((a, b) => a.createdAt - b.createdAt),
    }));
}

// ============================================================================
// Color Configuration
// ============================================================================

const COLOR_STYLES: Record<string, string> = {
  yellow: 'bg-yellow-400',
  red: 'bg-red-500',
  green: 'bg-green-500',
  blue: 'bg-blue-500',
  orange: 'bg-orange-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
  cyan: 'bg-cyan-500',
};

function getColorStyle(color: string): string {
  // Check if it's a named color
  if (COLOR_STYLES[color]) {
    return COLOR_STYLES[color];
  }
  // For hex colors, use inline style (handled in component)
  return '';
}

// ============================================================================
// Sub-Components
// ============================================================================

interface TargetIconProps {
  target: AnnotationTarget;
  className?: string;
}

/**
 * Icon for annotation target type
 */
function TargetIcon({ target, className = "h-3 w-3" }: TargetIconProps) {
  switch (target.type) {
    case 'pdf':
      return <FileText className={`${className} text-muted-foreground`} />;
    case 'code_line':
      return <Code className={`${className} text-muted-foreground`} />;
    case 'image':
      return <ImageIcon className={`${className} text-muted-foreground`} />;
    case 'text_anchor':
      return <Link className={`${className} text-muted-foreground`} />;
    default:
      return <File className={`${className} text-muted-foreground`} />;
  }
}

interface StyleIconProps {
  styleType: string;
  className?: string;
}

/**
 * Icon for annotation style type
 */
function StyleIcon({ styleType, className = "h-3 w-3" }: StyleIconProps) {
  switch (styleType) {
    case 'highlight':
      return <FileText className={`${className} text-muted-foreground`} />;
    case 'area':
      return <Square className={`${className} text-muted-foreground`} />;
    case 'underline':
      return <FileText className={`${className} text-muted-foreground underline`} />;
    case 'ink':
      return <FileText className={`${className} text-muted-foreground`} />;
    default:
      return <FileText className={`${className} text-muted-foreground`} />;
  }
}

interface AnnotationItemComponentProps {
  annotation: AnnotationItem;
  isSelected: boolean;
  onClick: () => void;
}

/**
 * Single annotation item in the sidebar
 */
function AnnotationItemComponent({ annotation, isSelected, onClick }: AnnotationItemComponentProps) {
  const previewText = annotation.content || getTargetLabel(annotation.target);
  const colorStyle = getColorStyle(annotation.style.color);
  const isHexColor = !colorStyle && annotation.style.color.startsWith('#');

  return (
    <button
      onClick={onClick}
      className={`w-full rounded-md px-2 py-2 text-left transition-colors ${
        isSelected 
          ? 'bg-primary/10 ring-1 ring-primary' 
          : 'hover:bg-muted'
      }`}
      data-annotation-id={annotation.id}
      data-annotation-color={annotation.style.color}
      data-annotation-type={annotation.style.type}
    >
      <div className="flex items-start gap-2">
        {/* Color indicator */}
        <div 
          className={`mt-1 h-3 w-3 flex-shrink-0 rounded-full ${colorStyle}`}
          style={isHexColor ? { backgroundColor: annotation.style.color } : undefined}
        />
        
        <div className="min-w-0 flex-1">
          {/* Type icon and preview */}
          <div className="flex items-center gap-1">
            <StyleIcon styleType={annotation.style.type} />
            <span className="truncate text-sm">
              {previewText ? truncateText(previewText, 40) : 'No content'}
            </span>
          </div>

          {/* Target location */}
          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <TargetIcon target={annotation.target} className="h-2.5 w-2.5" />
            <span>{getTargetLabel(annotation.target)}</span>
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

interface AnnotationGroupComponentProps {
  group: AnnotationGroup;
  selectedAnnotationId: string | null | undefined;
  onAnnotationClick: (annotation: AnnotationItem) => void;
  defaultExpanded?: boolean;
}

/**
 * Collapsible group of annotations
 */
function AnnotationGroupComponent({ 
  group, 
  selectedAnnotationId, 
  onAnnotationClick,
  defaultExpanded = true,
}: AnnotationGroupComponentProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Group header */}
      <button
        onClick={toggleExpanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">{group.label}</span>
        <span className="text-xs text-muted-foreground">
          ({group.annotations.length})
        </span>
      </button>

      {/* Annotations list */}
      {isExpanded && (
        <div className="space-y-1 px-2 pb-2">
          {group.annotations.map((annotation) => (
            <AnnotationItemComponent
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
 * Universal Annotation Sidebar Component
 * 
 * Displays a scrollable list of annotations grouped by location.
 * Features:
 * - Collapsible location groups
 * - Color indicator for each annotation
 * - Content preview and comment preview
 * - Click to navigate to annotation
 * - Support for all annotation target types
 */
export function UniversalAnnotationSidebar({
  annotations,
  onAnnotationClick,
  selectedAnnotationId,
  isLoading = false,
}: UniversalAnnotationSidebarProps) {
  // Group annotations
  const groups = useMemo(() => {
    return groupAnnotations(annotations);
  }, [annotations]);

  const totalCount = annotations.length;

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border px-3 py-2">
          <h3 className="text-sm font-medium">Annotations</h3>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-center text-sm text-muted-foreground">
            Loading annotations...
          </p>
        </div>
      </div>
    );
  }

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
            Select content to create highlights.
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
          <AnnotationGroupComponent
            key={group.key}
            group={group}
            selectedAnnotationId={selectedAnnotationId}
            onAnnotationClick={onAnnotationClick}
          />
        ))}
      </div>
    </div>
  );
}
