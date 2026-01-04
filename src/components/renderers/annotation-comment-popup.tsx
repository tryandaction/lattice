"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { X, Trash2, Save } from "lucide-react";
import type { LatticeAnnotation } from "../../types/annotation";
import { adjustPopupPosition, type PopupSize } from "@/lib/coordinate-adapter";

// ============================================================================
// Types
// ============================================================================

interface CommentPopupProps {
  /** The annotation being edited */
  annotation: LatticeAnnotation;
  /** Position for the popup (in viewport coordinates) */
  position: { x: number; y: number };
  /** Callback when comment is saved */
  onSave: (comment: string) => void;
  /** Callback when annotation is deleted */
  onDelete: () => void;
  /** Callback when popup is closed */
  onClose: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Comment Popup for Annotation Editing
 * 
 * Displays a popup for viewing/editing annotation comments.
 * Features:
 * - Text area for comment input
 * - Save and delete buttons
 * - Close on Escape or click outside
 * - Auto-focus on text area
 */
export function AnnotationCommentPopup({
  annotation,
  position,
  onSave,
  onDelete,
  onClose,
}: CommentPopupProps) {
  const [comment, setComment] = useState(annotation.comment);
  const [isDirty, setIsDirty] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        if (isDirty) {
          // Auto-save on click outside if there are changes
          onSave(comment);
        }
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    // Add listeners with a small delay to prevent immediate close
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }, 10);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, onSave, comment, isDirty]);

  const handleCommentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setComment(e.target.value);
    setIsDirty(e.target.value !== annotation.comment);
  }, [annotation.comment]);

  const handleSave = useCallback(() => {
    onSave(comment);
    onClose();
  }, [comment, onSave, onClose]);

  const handleDelete = useCallback(() => {
    if (window.confirm('Are you sure you want to delete this highlight?')) {
      onDelete();
      onClose();
    }
  }, [onDelete, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd + Enter to save
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  }, [handleSave]);

  // Calculate position to keep popup in viewport using coordinate adapter
  const popupSize: PopupSize = { width: 288, height: 280 }; // w-72 = 288px
  const adjustedPosition = adjustPopupPosition(position, popupSize, 10);

  // Get color indicator style - support both named colors and hex colors
  const colorStyles: Record<string, string> = {
    yellow: 'bg-yellow-400',
    red: 'bg-red-500',
    green: 'bg-green-500',
    blue: 'bg-blue-500',
  };

  // Get the appropriate color style
  const getColorStyle = () => {
    if (annotation.type === 'textNote') {
      const bgColor = annotation.content.backgroundColor;
      if (bgColor === 'transparent' || !bgColor) {
        return { className: 'bg-gray-200 border border-dashed border-gray-400' };
      }
      return { style: { backgroundColor: bgColor } };
    }
    const namedColor = colorStyles[annotation.color as keyof typeof colorStyles];
    if (namedColor) {
      return { className: namedColor };
    }
    return { style: { backgroundColor: annotation.color } };
  };

  const colorStyle = getColorStyle();

  // Get annotation type label
  const getTypeLabel = () => {
    switch (annotation.type) {
      case 'textNote':
        return '文字批注';
      case 'text':
        return 'Text Highlight';
      case 'area':
        return 'Area Highlight';
      default:
        return 'Annotation';
    }
  };

  return (
    <div
      ref={containerRef}
      className="fixed z-50 w-72 rounded-lg border border-border bg-popover shadow-xl"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
      }}
      role="dialog"
      aria-label="Edit annotation comment"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <div 
            className={`h-3 w-3 rounded-full ${colorStyle.className || ''}`}
            style={colorStyle.style}
          />
          <span className="text-sm font-medium">
            {getTypeLabel()}
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content preview */}
      {annotation.type === 'text' && annotation.content.text && (
        <div className="border-b border-border px-3 py-2">
          <p className="line-clamp-2 text-xs text-muted-foreground italic">
            "{annotation.content.text}"
          </p>
        </div>
      )}
      
      {/* Text note preview */}
      {annotation.type === 'textNote' && annotation.content.displayText && (
        <div className="border-b border-border px-3 py-2">
          <div 
            className="rounded p-2 text-sm"
            style={{
              backgroundColor: annotation.content.backgroundColor === 'transparent' 
                ? 'transparent' 
                : annotation.content.backgroundColor,
              color: annotation.content.textStyle?.textColor || '#000000',
              fontSize: `${Math.min(annotation.content.textStyle?.fontSize || 14, 14)}px`,
            }}
          >
            {annotation.content.displayText}
          </div>
        </div>
      )}

      {/* Comment textarea */}
      <div className="p-3">
        <textarea
          ref={textareaRef}
          value={comment}
          onChange={handleCommentChange}
          onKeyDown={handleKeyDown}
          placeholder="Add a note..."
          className="h-24 w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Press Ctrl+Enter to save
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between border-t border-border px-3 py-2">
        <button
          onClick={handleDelete}
          className="flex items-center gap-1 rounded px-2 py-1 text-sm text-destructive hover:bg-destructive/10"
          title="Delete highlight"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
        <button
          onClick={handleSave}
          disabled={!isDirty}
          className="flex items-center gap-1 rounded bg-primary px-3 py-1 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          title="Save comment"
        >
          <Save className="h-3.5 w-3.5" />
          Save
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Tooltip Component
// ============================================================================

interface CommentTooltipProps {
  /** Comment text to display */
  comment: string;
  /** Position for the tooltip (in viewport coordinates) */
  position: { x: number; y: number };
}

/**
 * Comment Tooltip for Annotation Hover Preview
 * 
 * Shows a small tooltip with the comment text when hovering over an annotation.
 */
export function AnnotationCommentTooltip({ comment, position }: CommentTooltipProps) {
  if (!comment) return null;

  // Calculate position to keep tooltip in viewport using coordinate adapter
  const tooltipSize: PopupSize = { width: 200, height: 60 };
  const adjustedPosition = adjustPopupPosition(position, tooltipSize, 10);

  return (
    <div
      className="pointer-events-none fixed z-40 max-w-xs rounded border border-border bg-popover px-2 py-1 shadow-md"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        transform: 'translate(-50%, -100%) translateY(-8px)',
      }}
    >
      <p className="line-clamp-3 text-xs">{comment}</p>
    </div>
  );
}
