"use client";

/**
 * Universal Annotation Sidebar
 * 
 * Displays a scrollable list of annotations for any file type,
 * with support for navigation and real-time updates.
 */

import { memo, useMemo, useCallback, useState, useEffect, useRef, useDeferredValue } from "react";
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
import { handleAnnotationSidebarKeyDown, scrollToSidebarAnnotation, useAnnotationSidebarCallback } from "./annotation-sidebar-interactions";
import { DeferredAnnotationMarkdown, useAnnotationCommentObserver, type AnnotationCommentObserver } from "./deferred-annotation-markdown";
import { useI18n } from "@/hooks/use-i18n";

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
    const existing = groups.get(key);
    if (existing) existing.push(annotation);
    else groups.set(key, [annotation]);
  }

  // Sort groups and annotations within each group
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
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
  onClick: (annotation: AnnotationItem) => void;
  commentObserver: AnnotationCommentObserver;
  eagerComment: boolean;
}

/**
 * Single annotation item in the sidebar
 */
const AnnotationItemComponent = memo(function AnnotationItemComponent({ annotation, isSelected, onClick, commentObserver, eagerComment }: AnnotationItemComponentProps) {
  const [commentFocused, setCommentFocused] = useState(false);
  const previewText = annotation.content || getTargetLabel(annotation.target);
  const colorStyle = getColorStyle(annotation.style.color);
  const isHexColor = !colorStyle && annotation.style.color.startsWith('#');

  return (
    <button
      type="button"
      onClick={() => onClick(annotation)}
      onFocus={() => setCommentFocused(true)}
      aria-pressed={isSelected}
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 96px" }}
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
              <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0 max-h-16 overflow-hidden">
                <DeferredAnnotationMarkdown content={annotation.comment} observe={commentObserver} eager={eagerComment || isSelected || commentFocused} />
              </div>
            </div>
          )}
        </div>
      </div>
    </button>
  );
});

interface AnnotationGroupComponentProps {
  group: AnnotationGroup;
  selectedAnnotationId: string | null | undefined;
  onAnnotationClick: (annotation: AnnotationItem) => void;
  defaultExpanded?: boolean;
  searchQuery?: string;
  commentObserver: AnnotationCommentObserver;
  eagerCommentIds: Set<string>;
}

/**
 * Collapsible group of annotations
 */
const AnnotationGroupComponent = memo(function AnnotationGroupComponent({
  group, 
  selectedAnnotationId, 
  onAnnotationClick,
  defaultExpanded = true,
  searchQuery,
  commentObserver,
  eagerCommentIds,
}: AnnotationGroupComponentProps) {
  const selectedInGroup = group.annotations.some((annotation) => annotation.id === selectedAnnotationId);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded || selectedInGroup);
  const groupRef = useRef<HTMLDivElement>(null);
  const [revealState, setRevealState] = useState({ selectedAnnotationId, searchQuery });
  if (revealState.selectedAnnotationId !== selectedAnnotationId || revealState.searchQuery !== searchQuery) {
    setRevealState({ selectedAnnotationId, searchQuery });
    if (selectedInGroup) setIsExpanded(true);
    if (searchQuery) setIsExpanded(true);
  }

  useEffect(() => {
    if (isExpanded && selectedInGroup) scrollToSidebarAnnotation(groupRef.current, selectedAnnotationId);
  }, [isExpanded, selectedAnnotationId, selectedInGroup]);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <div ref={groupRef} className="border-b border-border last:border-b-0">
      {/* Group header */}
      <button
        type="button"
        aria-expanded={isExpanded}
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
              onClick={onAnnotationClick}
              commentObserver={commentObserver}
              eagerComment={eagerCommentIds.has(annotation.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
});

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
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const commentObserver = useAnnotationCommentObserver(scrollRef);
  const handleAnnotationClick = useAnnotationSidebarCallback(onAnnotationClick);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLowerCase());
  const searchIndex = useMemo(() => annotations.map((annotation) => ({
    annotation,
    text: [annotation.content, annotation.comment, getTargetLabel(annotation.target)].filter(Boolean).join('\n').toLowerCase(),
  })), [annotations]);
  const filteredAnnotations = useMemo(() => deferredSearchQuery
    ? searchIndex.filter((entry) => entry.text.includes(deferredSearchQuery)).map((entry) => entry.annotation)
    : annotations, [annotations, searchIndex, deferredSearchQuery]);
  const [previousSelectedId, setPreviousSelectedId] = useState(selectedAnnotationId);
  if (previousSelectedId !== selectedAnnotationId) {
    setPreviousSelectedId(selectedAnnotationId);
    if (selectedAnnotationId && annotations.some((annotation) => annotation.id === selectedAnnotationId)) setSearchQuery('');
  }
  // Group annotations
  const groups = useMemo(() => {
    return groupAnnotations(filteredAnnotations);
  }, [filteredAnnotations]);
  const eagerCommentIds = useMemo(() => new Set(groups.flatMap((group) => group.annotations).slice(0, 12).map((annotation) => annotation.id)), [groups]);

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
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="border-b border-border px-3 py-2">
        <h3 className="text-sm font-medium">
          Annotations ({totalCount})
        </h3>
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          aria-label={t('pdf.sidebar.search.placeholder')}
          placeholder={t('pdf.sidebar.search.placeholder')}
          className="mt-2 h-7 w-full rounded-md border border-border bg-muted/50 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Scrollable list */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" onKeyDown={handleAnnotationSidebarKeyDown}>
        {groups.length === 0 && <p className="p-4 text-center text-xs text-muted-foreground">{t('pdf.sidebar.emptyFiltered')}</p>}
        {groups.map((group) => (
          <AnnotationGroupComponent
            key={group.key}
            group={group}
            selectedAnnotationId={group.annotations.some((annotation) => annotation.id === selectedAnnotationId) ? selectedAnnotationId : null}
            onAnnotationClick={handleAnnotationClick}
            searchQuery={deferredSearchQuery}
            commentObserver={commentObserver}
            eagerCommentIds={eagerCommentIds}
          />
        ))}
      </div>
    </div>
  );
}
