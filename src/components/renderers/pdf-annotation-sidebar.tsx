"use client";

/**
 * PDF Annotation Sidebar (Zotero-style)
 * 
 * Displays all annotations for the current PDF with:
 * - Zotero-style card layout
 * - Color bar indicator
 * - Page number badge
 * - Highlighted text with background
 * - Comment section
 * - Context menu on right-click
 */

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { 
  Highlighter, 
  StickyNote, 
  Square, 
  MessageSquare,
  Trash2,
  Pencil,
  Underline,
  Type,
  MoreHorizontal,
  Copy,
  Tag,
  FileText,
  Check,
  ChevronDown,
  Palette,
  ALargeSmall,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { HIGHLIGHT_COLORS, BACKGROUND_COLORS, TEXT_COLORS, TEXT_FONT_SIZES, DEFAULT_TEXT_STYLE } from "@/lib/annotation-colors";
import type { AnnotationItem, PdfTarget } from "@/types/universal-annotation";

interface PdfAnnotationSidebarProps {
  annotations: AnnotationItem[];
  selectedId: string | null;
  onSelect: (annotation: AnnotationItem) => void;
  onDelete: (id: string) => void;
  onUpdateColor?: (id: string, color: string) => void;
  onUpdateComment?: (id: string, comment: string) => void;
  onConvertToUnderline?: (id: string) => void;
  onUpdateTextStyle?: (id: string, textColor: string, fontSize: number, bgColor: string) => void;
}

// Zotero-style context menu component
function AnnotationContextMenu({
  x,
  y,
  annotation,
  onClose,
  onDelete,
  onUpdateColor,
  onAddComment,
  onConvertToUnderline,
  onCopyText,
  onUpdateTextStyle,
}: {
  x: number;
  y: number;
  annotation: AnnotationItem;
  onClose: () => void;
  onDelete: () => void;
  onUpdateColor?: (color: string) => void;
  onAddComment?: () => void;
  onConvertToUnderline?: () => void;
  onCopyText?: () => void;
  onUpdateTextStyle?: (textColor: string, fontSize: number, bgColor: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showTextStyleEditor, setShowTextStyleEditor] = useState(false);
  const [textColor, setTextColor] = useState(annotation.style.textStyle?.textColor || DEFAULT_TEXT_STYLE.textColor);
  const [fontSize, setFontSize] = useState(annotation.style.textStyle?.fontSize || DEFAULT_TEXT_STYLE.fontSize);
  const [bgColor, setBgColor] = useState(annotation.style.color || 'transparent');
  const isTextAnnotation = annotation.style.type === 'text';

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Text style editor for text annotations
  if (showTextStyleEditor && isTextAnnotation && onUpdateTextStyle) {
    return (
      <div
        ref={menuRef}
        className="fixed z-50 bg-popover border border-border rounded-lg shadow-xl p-3 min-w-[240px]"
        style={{ left: x, top: y }}
      >
        <div className="text-sm font-medium mb-2">编辑文字样式</div>
        
        {/* Text color */}
        <div className="mb-2">
          <div className="text-xs text-muted-foreground mb-1">文字颜色</div>
          <div className="flex flex-wrap gap-1">
            {TEXT_COLORS.map((color) => (
              <button
                key={color.value}
                onClick={() => setTextColor(color.hex)}
                className={`w-5 h-5 rounded-full border transition-all hover:scale-110 ${
                  textColor === color.hex 
                    ? 'border-foreground ring-1 ring-foreground ring-offset-1' 
                    : 'border-transparent hover:border-foreground/30'
                }`}
                style={{ backgroundColor: color.hex }}
                title={color.nameCN}
              />
            ))}
          </div>
        </div>

        {/* Background color */}
        <div className="mb-2">
          <div className="text-xs text-muted-foreground mb-1">背景颜色</div>
          <div className="flex flex-wrap gap-1">
            {BACKGROUND_COLORS.map((color) => (
              <button
                key={color.value}
                onClick={() => setBgColor(color.hex)}
                className={`w-5 h-5 rounded-full border transition-all hover:scale-110 ${
                  bgColor === color.hex 
                    ? 'border-foreground ring-1 ring-foreground ring-offset-1' 
                    : 'border-transparent hover:border-foreground/30'
                }`}
                style={{ 
                  backgroundColor: color.hex === 'transparent' ? 'transparent' : color.hex,
                  backgroundImage: color.hex === 'transparent' ? 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)' : 'none',
                  backgroundSize: '4px 4px',
                  backgroundPosition: '0 0, 0 2px, 2px -2px, -2px 0px'
                }}
                title={color.nameCN}
              />
            ))}
          </div>
        </div>

        {/* Font size */}
        <div className="mb-3">
          <div className="text-xs text-muted-foreground mb-1">字体大小</div>
          <div className="flex flex-wrap gap-1">
            {TEXT_FONT_SIZES.map((size) => (
              <button
                key={size.value}
                onClick={() => setFontSize(size.value)}
                className={`px-2 py-0.5 text-xs rounded border transition-all ${
                  fontSize === size.value 
                    ? 'border-foreground bg-muted' 
                    : 'border-border hover:border-foreground/30'
                }`}
              >
                {size.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowTextStyleEditor(false)}>
            取消
          </Button>
          <Button 
            size="sm" 
            onClick={() => {
              onUpdateTextStyle(textColor, fontSize, bgColor);
              onClose();
            }}
          >
            保存
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[180px]"
      style={{ left: x, top: y }}
    >
      {/* Color picker row - for non-text annotations */}
      {onUpdateColor && !isTextAnnotation && (
        <>
          <div className="px-3 py-2 flex items-center gap-1.5">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.value}
                onClick={() => {
                  onUpdateColor(color.hex);
                  onClose();
                }}
                className={`w-5 h-5 rounded-full border transition-all hover:scale-110 ${
                  annotation.style.color === color.hex 
                    ? 'border-foreground ring-1 ring-foreground ring-offset-1' 
                    : 'border-transparent hover:border-foreground/30'
                }`}
                style={{ backgroundColor: color.hex }}
                title={color.nameCN}
              >
                {annotation.style.color === color.hex && (
                  <Check className="h-3 w-3 text-white mx-auto drop-shadow" />
                )}
              </button>
            ))}
          </div>
          <div className="h-px bg-border mx-2" />
        </>
      )}

      {/* Text style editor button - for text annotations */}
      {isTextAnnotation && onUpdateTextStyle && (
        <>
          <button
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
            onClick={() => setShowTextStyleEditor(true)}
          >
            <Palette className="h-4 w-4" />
            编辑文字样式
          </button>
          <div className="h-px bg-border mx-2" />
        </>
      )}

      {/* Menu items - hide comment options for text annotations */}
      {!isTextAnnotation && (
        <>
          <button
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
            onClick={() => {
              onAddComment?.();
              onClose();
            }}
          >
            <MessageSquare className="h-4 w-4" />
            添加笔记
          </button>

          <button
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
            onClick={() => {
              onAddComment?.();
              onClose();
            }}
          >
            <FileText className="h-4 w-4" />
            添加评论
          </button>

          <button
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
            onClick={onClose}
          >
            <Tag className="h-4 w-4" />
            添加标签...
          </button>

          <div className="h-px bg-border mx-2 my-1" />
        </>
      )}

      {annotation.style.type === 'highlight' && onConvertToUnderline && (
        <button
          className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
          onClick={() => {
            onConvertToUnderline();
            onClose();
          }}
        >
          <Underline className="h-4 w-4" />
          转换为下划线
        </button>
      )}

      {annotation.style.type === 'underline' && onConvertToUnderline && (
        <button
          className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
          onClick={() => {
            onConvertToUnderline();
            onClose();
          }}
        >
          <Highlighter className="h-4 w-4" />
          转换为高亮
        </button>
      )}

      {annotation.content && (
        <button
          className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
          onClick={() => {
            onCopyText?.();
            onClose();
          }}
        >
          <Copy className="h-4 w-4" />
          复制文本
        </button>
      )}

      <div className="h-px bg-border mx-2 my-1" />

      <button
        className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted text-destructive flex items-center gap-2"
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        <Trash2 className="h-4 w-4" />
        删除
      </button>
    </div>
  );
}

// Zotero-style annotation card
function AnnotationCard({
  annotation,
  isSelected,
  onSelect,
  onDelete,
  onUpdateColor,
  onUpdateComment,
  onConvertToUnderline,
  onUpdateTextStyle,
}: {
  annotation: AnnotationItem;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onUpdateColor?: (color: string) => void;
  onUpdateComment?: (comment: string) => void;
  onConvertToUnderline?: () => void;
  onUpdateTextStyle?: (textColor: string, fontSize: number, bgColor: string) => void;
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editComment, setEditComment] = useState(annotation.comment || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const target = annotation.target as PdfTarget;
  const page = target.page;
  const isTextAnnotation = annotation.style.type === 'text';
  const textStyle = annotation.style.textStyle || { textColor: '#000000', fontSize: 14 };

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleSaveComment = useCallback(() => {
    onUpdateComment?.(editComment);
    setIsEditing(false);
  }, [editComment, onUpdateComment]);

  const handleCopyText = useCallback(() => {
    if (annotation.content) {
      navigator.clipboard.writeText(annotation.content);
    }
  }, [annotation.content]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  const getTypeIcon = () => {
    switch (annotation.style.type) {
      case 'highlight':
        return <Highlighter className="h-3.5 w-3.5" />;
      case 'underline':
        return <Underline className="h-3.5 w-3.5" />;
      case 'ink':
        return <Pencil className="h-3.5 w-3.5" />;
      case 'text':
        return <Type className="h-3.5 w-3.5" />;
      case 'area':
        const rect = target.rects[0];
        if (rect && (rect.x2 - rect.x1) < 0.05) {
          return <StickyNote className="h-3.5 w-3.5" />;
        }
        return <Square className="h-3.5 w-3.5" />;
      default:
        return <Type className="h-3.5 w-3.5" />;
    }
  };

  const getPreviewText = () => {
    if (annotation.style.type === 'ink') return '手绘标注';
    if (annotation.content) return annotation.content;
    if (annotation.comment) return annotation.comment;
    return annotation.style.type === 'area' ? '区域选择' : '批注';
  };

  // Get display color for the color bar
  const getDisplayColor = () => {
    if (isTextAnnotation) {
      // For text annotations, use text color for the bar if no background
      const bgColor = annotation.style.color;
      if (!bgColor || bgColor === 'transparent') {
        return textStyle.textColor || '#000000';
      }
      return bgColor;
    }
    return annotation.style.color;
  };

  return (
    <>
      <div
        className={`group relative cursor-pointer transition-all duration-150 ${
          isSelected ? 'bg-muted/80' : 'hover:bg-muted/40'
        }`}
        onClick={onSelect}
        onContextMenu={handleContextMenu}
      >
        {/* Color bar (Zotero style) */}
        <div 
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l"
          style={{ backgroundColor: getDisplayColor() }}
        />

        <div className="pl-3 pr-2 py-2.5">
          {/* Header: Page badge + type icon */}
          <div className="flex items-center gap-2 mb-1.5">
            <span 
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
              style={{ 
                backgroundColor: `${getDisplayColor()}25`,
                color: getDisplayColor() 
              }}
            >
              {getTypeIcon()}
              <span>页 {page}</span>
            </span>
            
            {/* More button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                handleContextMenu(e);
              }}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Text annotation - show with actual styling */}
          {isTextAnnotation && annotation.content && (
            <div 
              className="text-sm leading-relaxed mb-2 px-2 py-1.5 rounded border"
              style={{ 
                backgroundColor: annotation.style.color && annotation.style.color !== 'transparent' 
                  ? `${annotation.style.color}90` 
                  : 'rgba(255, 255, 255, 0.95)',
                borderColor: annotation.style.color && annotation.style.color !== 'transparent'
                  ? `${annotation.style.color}cc`
                  : 'var(--border)',
              }}
            >
              <span 
                style={{ 
                  color: textStyle.textColor,
                  fontSize: `${Math.min(textStyle.fontSize || 14, 16)}px`,
                  fontWeight: textStyle.fontWeight || 'normal',
                  fontStyle: textStyle.fontStyle || 'normal',
                }}
                className="line-clamp-3"
              >
                {annotation.content}
              </span>
            </div>
          )}

          {/* Highlighted text with background (Zotero style) - for non-text annotations */}
          {!isTextAnnotation && annotation.content && annotation.style.type !== 'ink' && (
            <div 
              className="text-sm leading-relaxed mb-2 px-1.5 py-1 rounded"
              style={{ 
                backgroundColor: `${annotation.style.color}30`,
              }}
            >
              <span className="line-clamp-3">{getPreviewText()}</span>
            </div>
          )}

          {/* Comment section - only for non-text annotations */}
          {!isTextAnnotation && (
            <>
              {isEditing ? (
                <div className="mt-2">
                  <textarea
                    ref={textareaRef}
                    value={editComment}
                    onChange={(e) => setEditComment(e.target.value)}
                    className="w-full p-2 text-sm border border-border rounded bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                    rows={2}
                    placeholder="添加笔记..."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        handleSaveComment();
                      }
                      if (e.key === 'Escape') {
                        setIsEditing(false);
                        setEditComment(annotation.comment || '');
                      }
                    }}
                  />
                  <div className="flex justify-end gap-1 mt-1">
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="h-6 text-xs"
                      onClick={() => {
                        setIsEditing(false);
                        setEditComment(annotation.comment || '');
                      }}
                    >
                      取消
                    </Button>
                    <Button 
                      size="sm" 
                      className="h-6 text-xs"
                      onClick={handleSaveComment}
                    >
                      保存
                    </Button>
                  </div>
                </div>
              ) : annotation.comment ? (
                <div 
                  className="text-xs text-muted-foreground mt-1 flex items-start gap-1.5 cursor-text"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditing(true);
                  }}
                >
                  <MessageSquare className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span className="line-clamp-2">{annotation.comment}</span>
                </div>
              ) : (
                <button
                  className="text-xs text-muted-foreground/60 hover:text-muted-foreground mt-1 flex items-center gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditing(true);
                  }}
                >
                  <MessageSquare className="h-3 w-3" />
                  添加笔记...
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <AnnotationContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          annotation={annotation}
          onClose={() => setContextMenu(null)}
          onDelete={onDelete}
          onUpdateColor={onUpdateColor}
          onAddComment={() => setIsEditing(true)}
          onConvertToUnderline={onConvertToUnderline}
          onCopyText={handleCopyText}
          onUpdateTextStyle={onUpdateTextStyle}
        />
      )}
    </>
  );
}

export function PdfAnnotationSidebar({
  annotations,
  selectedId,
  onSelect,
  onDelete,
  onUpdateColor,
  onUpdateComment,
  onConvertToUnderline,
  onUpdateTextStyle,
}: PdfAnnotationSidebarProps) {
  // Sort annotations by page, then by position (top to bottom)
  const sortedAnnotations = useMemo(() => {
    return [...annotations]
      .filter(a => a.target.type === 'pdf')
      .sort((a, b) => {
        const pageA = (a.target as PdfTarget).page;
        const pageB = (b.target as PdfTarget).page;
        if (pageA !== pageB) return pageA - pageB;
        
        // Sort by Y position within same page
        const rectA = (a.target as PdfTarget).rects[0];
        const rectB = (b.target as PdfTarget).rects[0];
        if (rectA && rectB) {
          return rectA.y1 - rectB.y1;
        }
        return a.createdAt - b.createdAt;
      });
  }, [annotations]);

  if (annotations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
          <Highlighter className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground mb-1">暂无批注</p>
        <p className="text-xs text-muted-foreground">
          选择文本或使用工具添加批注
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-medium">批注</h3>
        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
          {annotations.length}
        </span>
      </div>
      
      {/* Annotation list */}
      <div className="flex-1 overflow-auto">
        <div className="divide-y divide-border">
          {sortedAnnotations.map(ann => (
            <AnnotationCard
              key={ann.id}
              annotation={ann}
              isSelected={selectedId === ann.id}
              onSelect={() => onSelect(ann)}
              onDelete={() => onDelete(ann.id)}
              onUpdateColor={onUpdateColor ? (color) => onUpdateColor(ann.id, color) : undefined}
              onUpdateComment={onUpdateComment ? (comment) => onUpdateComment(ann.id, comment) : undefined}
              onConvertToUnderline={onConvertToUnderline ? () => onConvertToUnderline(ann.id) : undefined}
              onUpdateTextStyle={onUpdateTextStyle ? (textColor, fontSize, bgColor) => onUpdateTextStyle(ann.id, textColor, fontSize, bgColor) : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
