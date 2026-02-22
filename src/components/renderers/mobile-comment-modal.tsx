"use client";

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TOUCH_TARGET_MIN } from '@/lib/responsive';

/**
 * Props for MobileCommentModal
 */
interface MobileCommentModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Initial comment text */
  initialComment?: string;
  /** Content preview (highlighted text) */
  contentPreview?: string;
  /** Callback when comment is saved */
  onSave: (comment: string) => void;
  /** Callback when comment is deleted */
  onDelete?: () => void;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Whether this is editing an existing comment */
  isEditing?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Custom class name */
  className?: string;
}

/**
 * MobileCommentModal - Full-screen comment input for mobile devices
 * 
 * Features:
 * - Full-screen modal for comfortable typing
 * - Auto-focus on textarea
 * - Handles virtual keyboard properly
 * - Shows content preview
 * - Save and delete actions
 * 
 * Requirements: 6.4
 */
export function MobileCommentModal({
  isOpen,
  initialComment = '',
  contentPreview,
  onSave,
  onDelete,
  onClose,
  isEditing = false,
  placeholder = '添加评论...',
  className,
}: MobileCommentModalProps) {
  const [comment, setComment] = useState(initialComment);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Reset comment when modal opens
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setComment(initialComment);
    }
  }, [isOpen, initialComment]);

  // Focus textarea when modal opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      // Small delay to ensure modal animation completes
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Handle virtual keyboard on mobile
  useEffect(() => {
    if (!isOpen) return;

    const handleResize = () => {
      // Detect keyboard by comparing visual viewport to window height
      if (window.visualViewport) {
        const heightDiff = window.innerHeight - window.visualViewport.height;
        setKeyboardHeight(Math.max(0, heightDiff));
      }
    };

    // Listen to visual viewport changes
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
      window.visualViewport.addEventListener('scroll', handleResize);
    }

    // Also listen to window resize as fallback
    window.addEventListener('resize', handleResize);

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
        window.visualViewport.removeEventListener('scroll', handleResize);
      }
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleSave = useCallback(() => {
    const trimmedComment = comment.trim();
    onSave(trimmedComment);
    onClose();
  }, [comment, onSave, onClose]);

  const handleDelete = useCallback(() => {
    if (onDelete) {
      onDelete();
    }
    onClose();
  }, [onDelete, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Cmd/Ctrl + Enter to save
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
    // Escape to close
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [handleSave, onClose]);

  const canSave = comment.trim().length > 0 || isEditing;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className={cn(
            'fixed inset-0 z-50',
            'bg-background',
            'flex flex-col',
            className
          )}
          style={{
            paddingBottom: keyboardHeight,
          }}
          initial={{ opacity: 0, y: '100%' }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <button
              onClick={onClose}
              className={cn(
                'flex items-center justify-center',
                'rounded-lg transition-colors',
                'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
              style={{
                minWidth: TOUCH_TARGET_MIN,
                minHeight: TOUCH_TARGET_MIN,
              }}
              aria-label="关闭"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="text-lg font-medium">
              {isEditing ? '编辑评论' : '添加评论'}
            </h2>

            <button
              onClick={handleSave}
              disabled={!canSave}
              className={cn(
                'flex items-center justify-center',
                'rounded-lg transition-colors',
                canSave
                  ? 'text-primary hover:bg-primary/10'
                  : 'text-muted-foreground opacity-50'
              )}
              style={{
                minWidth: TOUCH_TARGET_MIN,
                minHeight: TOUCH_TARGET_MIN,
              }}
              aria-label="保存"
            >
              <Send className="h-5 w-5" />
            </button>
          </div>

          {/* Content preview */}
          {contentPreview && (
            <div className="px-4 py-3 bg-muted/50 border-b border-border">
              <p className="text-sm text-muted-foreground mb-1">选中内容:</p>
              <p className="text-sm line-clamp-3 italic">&quot;{contentPreview}&quot;</p>
            </div>
          )}

          {/* Textarea */}
          <div className="flex-1 p-4">
            <textarea
              ref={textareaRef}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className={cn(
                'w-full h-full',
                'bg-transparent',
                'text-base leading-relaxed',
                'resize-none',
                'focus:outline-none',
                'placeholder:text-muted-foreground'
              )}
              aria-label="评论内容"
            />
          </div>

          {/* Footer with delete button (only for editing) */}
          {isEditing && onDelete && (
            <div className="px-4 py-3 border-t border-border">
              <button
                onClick={handleDelete}
                className={cn(
                  'flex items-center justify-center gap-2',
                  'w-full py-3',
                  'rounded-lg',
                  'text-destructive',
                  'bg-destructive/10 hover:bg-destructive/20',
                  'transition-colors'
                )}
                style={{
                  minHeight: TOUCH_TARGET_MIN,
                }}
              >
                <Trash2 className="h-5 w-5" />
                <span>删除评论</span>
              </button>
            </div>
          )}

          {/* Keyboard hint */}
          <div className="px-4 py-2 text-center text-xs text-muted-foreground border-t border-border">
            按 ⌘+Enter 保存
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Compact comment input for inline use
 */
interface CompactCommentInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  className?: string;
}

export function CompactCommentInput({
  value,
  onChange,
  onSubmit,
  placeholder = '添加评论...',
  className,
}: CompactCommentInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  }, [onSubmit]);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn(
          'flex-1',
          'px-3 py-2',
          'rounded-lg',
          'bg-muted',
          'text-sm',
          'focus:outline-none focus:ring-2 focus:ring-primary'
        )}
        style={{
          minHeight: TOUCH_TARGET_MIN,
        }}
      />
      <button
        onClick={onSubmit}
        disabled={!value.trim()}
        className={cn(
          'flex items-center justify-center',
          'rounded-lg',
          'bg-primary text-primary-foreground',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'transition-colors'
        )}
        style={{
          minWidth: TOUCH_TARGET_MIN,
          minHeight: TOUCH_TARGET_MIN,
        }}
        aria-label="发送"
      >
        <Send className="h-4 w-4" />
      </button>
    </div>
  );
}
