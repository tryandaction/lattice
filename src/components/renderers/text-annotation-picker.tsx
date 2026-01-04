"use client";

/**
 * Text Annotation Picker Component
 * 
 * A comprehensive picker for creating text annotations with:
 * - Text input
 * - Background color selection (default: transparent)
 * - Text color selection
 * - Font size adjustment
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { X, Check, Type, Palette, Minus, Plus } from "lucide-react";
import {
  TEXT_COLORS,
  BACKGROUND_COLORS,
  FONT_SIZES,
  DEFAULT_TEXT_STYLE,
  type TextAnnotationStyle,
} from "../../types/universal-annotation";

// ============================================================================
// Types
// ============================================================================

export interface TextAnnotationData {
  text: string;
  backgroundColor: string;
  textStyle: TextAnnotationStyle;
}

interface TextAnnotationPickerProps {
  /** Position for the picker (in viewport coordinates) */
  position: { x: number; y: number };
  /** Initial text (for editing existing annotations) */
  initialText?: string;
  /** Initial background color */
  initialBackgroundColor?: string;
  /** Initial text style */
  initialTextStyle?: TextAnnotationStyle;
  /** Callback when annotation is confirmed */
  onConfirm: (data: TextAnnotationData) => void;
  /** Callback when picker is closed */
  onClose: () => void;
}

type TabType = 'text' | 'background' | 'textColor' | 'fontSize';

// ============================================================================
// Component
// ============================================================================

export function TextAnnotationPicker({
  position,
  initialText = "",
  initialBackgroundColor = "transparent",
  initialTextStyle = DEFAULT_TEXT_STYLE,
  onConfirm,
  onClose,
}: TextAnnotationPickerProps) {
  const [text, setText] = useState(initialText);
  const [backgroundColor, setBackgroundColor] = useState(initialBackgroundColor);
  const [textStyle, setTextStyle] = useState<TextAnnotationStyle>(initialTextStyle);
  const [activeTab, setActiveTab] = useState<TabType>('text');
  
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus textarea on mount
  useEffect(() => {
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
  }, []);

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }, 10);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleConfirm = useCallback(() => {
    if (text.trim()) {
      onConfirm({
        text: text.trim(),
        backgroundColor,
        textStyle,
      });
    }
  }, [text, backgroundColor, textStyle, onConfirm]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    }
  }, [handleConfirm]);

  const adjustFontSize = useCallback((delta: number) => {
    setTextStyle(prev => {
      const currentIndex = FONT_SIZES.indexOf(prev.fontSize as typeof FONT_SIZES[number]);
      const newIndex = Math.max(0, Math.min(FONT_SIZES.length - 1, currentIndex + delta));
      return { ...prev, fontSize: FONT_SIZES[newIndex] };
    });
  }, []);

  // Calculate position to keep picker in viewport
  const adjustedPosition = {
    x: Math.max(10, Math.min(position.x, window.innerWidth - 340)),
    y: Math.max(10, Math.min(position.y, window.innerHeight - 450)),
  };

  return (
    <div
      ref={containerRef}
      className="fixed z-50 w-80 rounded-lg border border-border bg-popover shadow-xl"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
      }}
      role="dialog"
      aria-label="添加文字批注"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium">添加文字批注</span>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Preview */}
      <div className="border-b border-border p-3">
        <div className="text-xs text-muted-foreground mb-1">预览</div>
        <div
          className="min-h-[40px] rounded border border-dashed border-border p-2 break-words"
          style={{
            backgroundColor: backgroundColor === 'transparent' ? 'transparent' : backgroundColor,
            color: textStyle.textColor,
            fontSize: `${textStyle.fontSize}px`,
            fontWeight: textStyle.fontWeight,
            fontStyle: textStyle.fontStyle,
          }}
        >
          {text || <span className="text-muted-foreground italic">输入文字...</span>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        <TabButton
          active={activeTab === 'text'}
          onClick={() => setActiveTab('text')}
          icon={<Type className="h-3.5 w-3.5" />}
          label="文字"
        />
        <TabButton
          active={activeTab === 'background'}
          onClick={() => setActiveTab('background')}
          icon={<div className="h-3.5 w-3.5 rounded border border-current" style={{ backgroundColor: backgroundColor === 'transparent' ? 'transparent' : backgroundColor }} />}
          label="背景"
        />
        <TabButton
          active={activeTab === 'textColor'}
          onClick={() => setActiveTab('textColor')}
          icon={<Palette className="h-3.5 w-3.5" style={{ color: textStyle.textColor }} />}
          label="字色"
        />
        <TabButton
          active={activeTab === 'fontSize'}
          onClick={() => setActiveTab('fontSize')}
          icon={<span className="text-xs font-bold">{textStyle.fontSize}</span>}
          label="字号"
        />
      </div>

      {/* Tab Content */}
      <div className="p-3">
        {activeTab === 'text' && (
          <div>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入批注文字..."
              className="h-24 w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              style={{
                color: textStyle.textColor,
                fontSize: `${Math.min(textStyle.fontSize, 16)}px`,
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              按 Ctrl+Enter 确认
            </p>
          </div>
        )}

        {activeTab === 'background' && (
          <div>
            <div className="text-xs text-muted-foreground mb-2">选择背景颜色</div>
            <div className="grid grid-cols-3 gap-2">
              {BACKGROUND_COLORS.map((color) => (
                <ColorButton
                  key={color.value}
                  color={color.value}
                  label={color.label}
                  isTransparent={'isTransparent' in color ? color.isTransparent : false}
                  isSelected={backgroundColor === color.value}
                  onClick={() => setBackgroundColor(color.value)}
                />
              ))}
            </div>
          </div>
        )}

        {activeTab === 'textColor' && (
          <div>
            <div className="text-xs text-muted-foreground mb-2">选择文字颜色</div>
            <div className="grid grid-cols-4 gap-2">
              {TEXT_COLORS.map((color) => (
                <ColorButton
                  key={color.value}
                  color={color.value}
                  label={color.label}
                  isSelected={textStyle.textColor === color.value}
                  onClick={() => setTextStyle(prev => ({ ...prev, textColor: color.value }))}
                />
              ))}
            </div>
          </div>
        )}

        {activeTab === 'fontSize' && (
          <div>
            <div className="text-xs text-muted-foreground mb-2">调整字号</div>
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => adjustFontSize(-1)}
                disabled={textStyle.fontSize <= FONT_SIZES[0]}
                className="rounded-full p-2 hover:bg-muted disabled:opacity-30"
                title="减小字号"
              >
                <Minus className="h-5 w-5" />
              </button>
              <span className="text-2xl font-bold min-w-[60px] text-center">
                {textStyle.fontSize}
              </span>
              <button
                onClick={() => adjustFontSize(1)}
                disabled={textStyle.fontSize >= FONT_SIZES[FONT_SIZES.length - 1]}
                className="rounded-full p-2 hover:bg-muted disabled:opacity-30"
                title="增大字号"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1 justify-center">
              {FONT_SIZES.map((size) => (
                <button
                  key={size}
                  onClick={() => setTextStyle(prev => ({ ...prev, fontSize: size }))}
                  className={`px-2 py-1 text-xs rounded ${
                    textStyle.fontSize === size
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
        <button
          onClick={onClose}
          className="rounded px-3 py-1.5 text-sm hover:bg-muted"
        >
          取消
        </button>
        <button
          onClick={handleConfirm}
          disabled={!text.trim()}
          className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
          确认
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-Components
// ============================================================================

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

function TabButton({ active, onClick, icon, label }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs transition-colors ${
        active
          ? 'bg-muted text-foreground border-b-2 border-primary'
          : 'text-muted-foreground hover:bg-muted/50'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

interface ColorButtonProps {
  color: string;
  label: string;
  isTransparent?: boolean;
  isSelected: boolean;
  onClick: () => void;
}

function ColorButton({ color, label, isTransparent, isSelected, onClick }: ColorButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors ${
        isSelected
          ? 'ring-2 ring-primary ring-offset-1'
          : 'hover:bg-muted'
      }`}
      title={label}
    >
      <div
        className={`h-5 w-5 rounded-full border ${
          isTransparent
            ? 'bg-[repeating-conic-gradient(#ccc_0_25%,#fff_0_50%)] bg-[length:8px_8px]'
            : ''
        }`}
        style={!isTransparent ? { backgroundColor: color } : undefined}
      />
      <span className="truncate">{label}</span>
      {isSelected && <Check className="h-3 w-3 text-primary ml-auto" />}
    </button>
  );
}

export default TextAnnotationPicker;
