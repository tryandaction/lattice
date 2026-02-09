"use client";

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Highlighter, 
  Underline, 
  Square, 
  Type, 
  MessageSquare,
  X,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TOUCH_TARGET_MIN } from '@/lib/responsive';
import { MobileColorPickerPopover } from './mobile-color-picker';

/**
 * Annotation tool types
 */
export type AnnotationTool = 'highlight' | 'underline' | 'area' | 'text' | 'comment';

/**
 * Position for the toolbar
 */
export interface ToolbarPosition {
  x: number;
  y: number;
}

/**
 * Props for MobileAnnotationToolbar
 */
interface MobileAnnotationToolbarProps {
  /** Whether the toolbar is visible */
  isVisible: boolean;
  /** Position of the toolbar (follows text selection) */
  position: ToolbarPosition;
  /** Currently selected tool */
  selectedTool?: AnnotationTool;
  /** Currently selected color */
  selectedColor?: string;
  /** Callback when a tool is selected */
  onToolSelect: (tool: AnnotationTool) => void;
  /** Callback when color is selected */
  onColorSelect: (color: string) => void;
  /** Callback when toolbar is closed */
  onClose: () => void;
  /** Callback when comment is requested */
  onCommentRequest?: () => void;
  /** Available tools (default: all) */
  availableTools?: AnnotationTool[];
  /** Custom class name */
  className?: string;
}

/**
 * Tool configuration
 */
const TOOL_CONFIG: Record<AnnotationTool, { icon: typeof Highlighter; label: string }> = {
  highlight: { icon: Highlighter, label: '高亮' },
  underline: { icon: Underline, label: '下划线' },
  area: { icon: Square, label: '区域' },
  text: { icon: Type, label: '文字' },
  comment: { icon: MessageSquare, label: '评论' },
};

const DEFAULT_TOOLS: AnnotationTool[] = ['highlight', 'underline', 'area', 'text', 'comment'];

/**
 * MobileAnnotationToolbar - A floating toolbar for mobile annotation
 * 
 * Features:
 * - Follows text selection position
 * - Touch-friendly buttons (44px minimum)
 * - Expandable color picker
 * - Smooth animations
 * - Auto-positioning to stay within viewport
 * 
 * Requirements: 6.2, 6.5
 */
export function MobileAnnotationToolbar({
  isVisible,
  position,
  selectedTool,
  selectedColor = '#FFEB3B',
  onToolSelect,
  onColorSelect,
  onClose,
  onCommentRequest,
  availableTools = DEFAULT_TOOLS,
  className,
}: MobileAnnotationToolbarProps) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);

  // Adjust position to stay within viewport
  useEffect(() => {
    if (!isVisible || !toolbarRef.current) return;

    const toolbar = toolbarRef.current;
    const rect = toolbar.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const padding = 8;

    let newX = position.x;
    let newY = position.y;

    // Adjust horizontal position
    if (newX - rect.width / 2 < padding) {
      newX = rect.width / 2 + padding;
    } else if (newX + rect.width / 2 > viewportWidth - padding) {
      newX = viewportWidth - rect.width / 2 - padding;
    }

    // Adjust vertical position (prefer above selection)
    const toolbarHeight = rect.height + 60; // Extra space for color picker
    if (newY - toolbarHeight < padding) {
      // Show below selection instead
      newY = position.y + 50;
    }

    setAdjustedPosition({ x: newX, y: newY });
  }, [isVisible, position]);

  const handleToolClick = useCallback((tool: AnnotationTool) => {
    if (tool === 'comment' && onCommentRequest) {
      onCommentRequest();
    } else {
      onToolSelect(tool);
    }
  }, [onToolSelect, onCommentRequest]);

  const handleColorButtonClick = useCallback(() => {
    setShowColorPicker(prev => !prev);
  }, []);

  const handleColorSelect = useCallback((color: string) => {
    onColorSelect(color);
    setShowColorPicker(false);
  }, [onColorSelect]);

  const toggleExpand = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

  // Close color picker when toolbar closes
  useEffect(() => {
    if (!isVisible) {
      setShowColorPicker(false);
      setIsExpanded(false);
    }
  }, [isVisible]);

  // Primary tools (always visible)
  const primaryTools = availableTools.slice(0, 3);
  // Secondary tools (shown when expanded)
  const secondaryTools = availableTools.slice(3);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          ref={toolbarRef}
          className={cn(
            'fixed z-50',
            'flex flex-col items-center gap-2',
            className
          )}
          style={{
            left: adjustedPosition.x,
            top: adjustedPosition.y,
            transform: 'translate(-50%, -100%)',
          }}
          initial={{ opacity: 0, y: 10, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.9 }}
          transition={{ duration: 0.15 }}
        >
          {/* Main toolbar */}
          <div className="flex items-center gap-1 bg-card rounded-xl shadow-xl border border-border p-1">
            {/* Primary tools */}
            {primaryTools.map((tool) => {
              const config = TOOL_CONFIG[tool];
              const Icon = config.icon;
              const isSelected = selectedTool === tool;

              return (
                <button
                  key={tool}
                  onClick={() => handleToolClick(tool)}
                  className={cn(
                    'flex items-center justify-center',
                    'rounded-lg transition-colors',
                    isSelected
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                  style={{
                    minWidth: TOUCH_TARGET_MIN,
                    minHeight: TOUCH_TARGET_MIN,
                  }}
                  aria-label={config.label}
                  title={config.label}
                >
                  <Icon className="h-5 w-5" />
                </button>
              );
            })}

            {/* Color button */}
            <button
              onClick={handleColorButtonClick}
              className={cn(
                'flex items-center justify-center',
                'rounded-lg transition-colors',
                'hover:bg-muted'
              )}
              style={{
                minWidth: TOUCH_TARGET_MIN,
                minHeight: TOUCH_TARGET_MIN,
              }}
              aria-label="选择颜色"
              title="选择颜色"
            >
              <div
                className="w-6 h-6 rounded-full border-2 border-white shadow-sm"
                style={{ backgroundColor: selectedColor }}
              />
            </button>

            {/* Expand/collapse button (if there are secondary tools) */}
            {secondaryTools.length > 0 && (
              <button
                onClick={toggleExpand}
                className={cn(
                  'flex items-center justify-center',
                  'rounded-lg transition-colors',
                  'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
                style={{
                  minWidth: TOUCH_TARGET_MIN,
                  minHeight: TOUCH_TARGET_MIN,
                }}
                aria-label={isExpanded ? '收起' : '展开'}
                title={isExpanded ? '收起' : '展开'}
              >
                {isExpanded ? (
                  <ChevronUp className="h-5 w-5" />
                ) : (
                  <ChevronDown className="h-5 w-5" />
                )}
              </button>
            )}

            {/* Close button */}
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
              title="关闭"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Secondary tools (expanded) */}
          <AnimatePresence>
            {isExpanded && secondaryTools.length > 0 && (
              <motion.div
                className="flex items-center gap-1 bg-card rounded-xl shadow-xl border border-border p-1"
                initial={{ opacity: 0, y: -10, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.9 }}
                transition={{ duration: 0.15 }}
              >
                {secondaryTools.map((tool) => {
                  const config = TOOL_CONFIG[tool];
                  const Icon = config.icon;
                  const isSelected = selectedTool === tool;

                  return (
                    <button
                      key={tool}
                      onClick={() => handleToolClick(tool)}
                      className={cn(
                        'flex items-center justify-center',
                        'rounded-lg transition-colors',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                      style={{
                        minWidth: TOUCH_TARGET_MIN,
                        minHeight: TOUCH_TARGET_MIN,
                      }}
                      aria-label={config.label}
                      title={config.label}
                    >
                      <Icon className="h-5 w-5" />
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Color picker popover */}
          <MobileColorPickerPopover
            isOpen={showColorPicker}
            onClose={() => setShowColorPicker(false)}
            selectedColor={selectedColor}
            onColorSelect={handleColorSelect}
            columns={5}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
