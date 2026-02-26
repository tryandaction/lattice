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
 * - Multi-select and batch operations
 */

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { AnnotationMarkdownRenderer } from "./annotation-markdown-renderer";
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
  Palette,
  CheckSquare,
  Square as SquareIcon,
  X,
  Download,
  Search,
  Filter,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { HIGHLIGHT_COLORS, BACKGROUND_COLORS, TEXT_COLORS, TEXT_FONT_SIZES, DEFAULT_TEXT_STYLE } from "@/lib/annotation-colors";
import type { AnnotationItem, PdfTarget } from "@/types/universal-annotation";
import { cn } from "@/lib/utils";

// Helper function to export annotations to Markdown format
function exportAnnotationsToMarkdown(annotations: AnnotationItem[]): string {
  const lines: string[] = [
    '# 批注导出',
    '',
    `*导出时间: ${new Date().toLocaleString('zh-CN')}*`,
    '',
    `共 ${annotations.length} 条批注`,
    '',
    '---',
    '',
  ];

  // Group by page
  const byPage = new Map<number, AnnotationItem[]>();
  for (const ann of annotations) {
    const page = (ann.target as PdfTarget).page;
    if (!byPage.has(page)) {
      byPage.set(page, []);
    }
    byPage.get(page)!.push(ann);
  }

  // Sort pages
  const sortedPages = Array.from(byPage.keys()).sort((a, b) => a - b);

  for (const page of sortedPages) {
    const pageAnnotations = byPage.get(page)!;
    lines.push(`## 第 ${page} 页`);
    lines.push('');

    for (const ann of pageAnnotations) {
      const typeLabel = {
        highlight: '🟡 高亮',
        underline: '📝 下划线',
        area: '📦 区域',
        ink: '✏️ 手绘',
        text: '💬 文字',
      }[ann.style.type] || '📌 批注';

      lines.push(`### ${typeLabel}`);
      
      if (ann.content) {
        lines.push('');
        lines.push(`> ${ann.content}`);
      }
      
      if (ann.comment) {
        lines.push('');
        lines.push(`**笔记:** ${ann.comment}`);
      }
      
      lines.push('');
    }
  }

  return lines.join('\n');
}

interface PdfAnnotationSidebarProps {
  annotations: AnnotationItem[];
  selectedId: string | null;
  onSelect: (annotation: AnnotationItem) => void;
  onDelete: (id: string) => void;
  onUpdateColor?: (id: string, color: string) => void;
  onUpdateComment?: (id: string, comment: string) => void;
  onConvertToUnderline?: (id: string) => void;
  onUpdateTextStyle?: (id: string, textColor: string, fontSize: number, bgColor: string) => void;
  onBatchDelete?: (ids: string[]) => void;
  onBatchUpdateColor?: (ids: string[], color: string) => void;
  onBatchExport?: (annotations: AnnotationItem[]) => void;
}

// Batch selection toolbar component
function BatchSelectionToolbar({
  selectedCount,
  totalCount,
  onSelectAll,
  onClearSelection,
  onDelete,
  onChangeColor,
  onExport,
}: {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDelete: () => void;
  onChangeColor: (color: string) => void;
  onExport?: () => void;
}) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (selectedCount === 0) return null;

  return (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-2 py-1.5 flex items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        已选 {selectedCount}/{totalCount}
      </span>

      <div className="flex items-center gap-0.5 ml-auto">
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-6 text-xs px-2"
          onClick={selectedCount === totalCount ? onClearSelection : onSelectAll}
        >
          {selectedCount === totalCount ? '取消全选' : '全选'}
        </Button>

        <div className="w-px h-4 bg-border mx-1" />

        {/* Color change dropdown */}
        <div className="relative" ref={colorPickerRef}>
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-6 text-xs px-2"
            onClick={() => setShowColorPicker(!showColorPicker)}
          >
            <Palette className="h-3 w-3 mr-1" />
            颜色
          </Button>
          {showColorPicker && (
            <div className="absolute top-full right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg p-2 z-20">
              <div className="flex gap-1">
                {HIGHLIGHT_COLORS.map((color) => (
                  <button
                    key={color.value}
                    onClick={() => {
                      onChangeColor(color.hex);
                      setShowColorPicker(false);
                    }}
                    className="w-6 h-6 rounded-full border border-transparent hover:border-foreground/30 transition-all hover:scale-110"
                    style={{ backgroundColor: color.hex }}
                    title={color.nameCN}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Export button */}
        {onExport && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-6 text-xs px-2"
            onClick={onExport}
          >
            <Download className="h-3 w-3 mr-1" />
            导出
          </Button>
        )}

        <Button 
          variant="ghost" 
          size="sm" 
          className="h-6 text-xs px-2 text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-3 w-3 mr-1" />
          删除
        </Button>

        <Button 
          variant="ghost" 
          size="icon" 
          className="h-6 w-6"
          onClick={onClearSelection}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// Search and filter toolbar component
type AnnotationTypeFilter = 'all' | 'highlight' | 'underline' | 'area' | 'ink' | 'text';
type ColorFilter = 'all' | string;

function SearchFilterToolbar({
  searchQuery,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  colorFilter,
  onColorFilterChange,
  resultCount,
  totalCount,
}: {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  typeFilter: AnnotationTypeFilter;
  onTypeFilterChange: (type: AnnotationTypeFilter) => void;
  colorFilter: ColorFilter;
  onColorFilterChange: (color: ColorFilter) => void;
  resultCount: number;
  totalCount: number;
}) {
  const [showFilters, setShowFilters] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilters(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const hasActiveFilters = typeFilter !== 'all' || colorFilter !== 'all' || searchQuery.length > 0;

  const typeOptions: { value: AnnotationTypeFilter; label: string; icon: React.ReactNode }[] = [
    { value: 'all', label: '全部类型', icon: null },
    { value: 'highlight', label: '高亮', icon: <Highlighter className="h-3 w-3" /> },
    { value: 'underline', label: '下划线', icon: <Underline className="h-3 w-3" /> },
    { value: 'area', label: '区域', icon: <Square className="h-3 w-3" /> },
    { value: 'ink', label: '手绘', icon: <Pencil className="h-3 w-3" /> },
    { value: 'text', label: '文字', icon: <Type className="h-3 w-3" /> },
  ];

  return (
    <div className="px-2 py-2 border-b border-border space-y-2">
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索批注内容..."
          className="w-full h-7 pl-7 pr-7 text-xs bg-muted/50 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Filter button and dropdown */}
      <div className="flex items-center gap-2">
        <div className="relative" ref={filterRef}>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-6 text-xs px-2",
              hasActiveFilters && "text-primary"
            )}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-3 w-3 mr-1" />
            筛选
            {hasActiveFilters && (
              <span className="ml-1 bg-primary text-primary-foreground rounded-full w-4 h-4 text-[10px] flex items-center justify-center">
                {(typeFilter !== 'all' ? 1 : 0) + (colorFilter !== 'all' ? 1 : 0)}
              </span>
            )}
            <ChevronDown className="h-3 w-3 ml-1" />
          </Button>

          {showFilters && (
            <div className="absolute top-full left-0 mt-1 bg-popover border border-border rounded-lg shadow-lg p-3 z-20 min-w-[200px]">
              {/* Type filter */}
              <div className="mb-3">
                <div className="text-xs font-medium mb-1.5">类型</div>
                <div className="flex flex-wrap gap-1">
                  {typeOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => onTypeFilterChange(opt.value)}
                      className={cn(
                        "px-2 py-1 text-xs rounded-md border transition-colors flex items-center gap-1",
                        typeFilter === opt.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      {opt.icon}
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color filter */}
              <div>
                <div className="text-xs font-medium mb-1.5">颜色</div>
                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() => onColorFilterChange('all')}
                    className={cn(
                      "px-2 py-1 text-xs rounded-md border transition-colors",
                      colorFilter === 'all'
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    全部
                  </button>
                  {HIGHLIGHT_COLORS.map((color) => (
                    <button
                      key={color.value}
                      onClick={() => onColorFilterChange(color.hex)}
                      className={cn(
                        "w-6 h-6 rounded-full border-2 transition-all hover:scale-110",
                        colorFilter === color.hex
                          ? "border-foreground ring-1 ring-foreground ring-offset-1"
                          : "border-transparent hover:border-foreground/30"
                      )}
                      style={{ backgroundColor: color.hex }}
                      title={color.nameCN}
                    />
                  ))}
                </div>
              </div>

              {/* Clear filters */}
              {hasActiveFilters && (
                <button
                  onClick={() => {
                    onTypeFilterChange('all');
                    onColorFilterChange('all');
                    onSearchChange('');
                  }}
                  className="mt-3 text-xs text-muted-foreground hover:text-foreground"
                >
                  清除所有筛选
                </button>
              )}
            </div>
          )}
        </div>

        {/* Result count */}
        {hasActiveFilters && (
          <span className="text-xs text-muted-foreground">
            {resultCount}/{totalCount} 条结果
          </span>
        )}
      </div>
    </div>
  );
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
  
  // Use coordinate adapter to adjust menu position
  const [adjustedPosition, setAdjustedPosition] = useState({ x, y });
  
  useEffect(() => {
    // Measure menu size and adjust position
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const menuSize = { width: rect.width || 240, height: rect.height || 300 };
      const padding = 8;
      const bounds = { width: window.innerWidth, height: window.innerHeight };
      
      let newX = x;
      let newY = y;
      
      // Adjust horizontal position
      if (newX + menuSize.width + padding > bounds.width) {
        newX = bounds.width - menuSize.width - padding;
      }
      if (newX < padding) newX = padding;
      
      // Adjust vertical position
      if (newY + menuSize.height + padding > bounds.height) {
        newY = bounds.height - menuSize.height - padding;
      }
      if (newY < padding) newY = padding;
      
      if (newX !== adjustedPosition.x || newY !== adjustedPosition.y) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAdjustedPosition({ x: newX, y: newY });
      }
    }
  }, [x, y, showTextStyleEditor, adjustedPosition.x, adjustedPosition.y]);

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
        style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
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
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
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
  isMultiSelected,
  isMultiSelectMode,
  onSelect,
  onToggleMultiSelect,
  onDelete,
  onUpdateColor,
  onUpdateComment,
  onConvertToUnderline,
  onUpdateTextStyle,
}: {
  annotation: AnnotationItem;
  isSelected: boolean;
  isMultiSelected: boolean;
  isMultiSelectMode: boolean;
  onSelect: () => void;
  onToggleMultiSelect: () => void;
  onDelete: () => void;
  onUpdateColor?: (color: string) => void;
  onUpdateComment?: (comment: string) => void;
  onConvertToUnderline?: () => void;
  onUpdateTextStyle?: (textColor: string, fontSize: number, bgColor: string) => void;
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
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

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Ctrl/Cmd + Click toggles multi-select
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onToggleMultiSelect();
    } else if (isMultiSelectMode) {
      onToggleMultiSelect();
    } else {
      onSelect();
    }
  }, [isMultiSelectMode, onSelect, onToggleMultiSelect]);

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
          isSelected ? 'bg-muted/80' : isMultiSelected ? 'bg-accent/30' : 'hover:bg-muted/40'
        }`}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {/* Color bar (Zotero style) */}
        <div 
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l"
          style={{ backgroundColor: getDisplayColor() }}
        />

        <div className="pl-3 pr-2 py-2.5">
          {/* Header: Checkbox (in multi-select) + Page badge + type icon */}
          <div className="flex items-center gap-2 mb-1.5">
            {/* Multi-select checkbox */}
            {isMultiSelectMode && (
              <button
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  onToggleMultiSelect();
                }}
                className={cn(
                  "h-4 w-4 rounded border flex items-center justify-center transition-colors",
                  isMultiSelected 
                    ? "bg-primary border-primary text-primary-foreground" 
                    : "border-muted-foreground/50 hover:border-primary"
                )}
              >
                {isMultiSelected && <Check className="h-3 w-3" />}
              </button>
            )}
            
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
                <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                  {/* Edit / Preview tabs */}
                  <div className="flex gap-1 mb-1">
                    <button
                      onClick={() => setShowPreview(false)}
                      className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                        !showPreview ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => setShowPreview(true)}
                      className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                        showPreview ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      预览
                    </button>
                  </div>

                  {showPreview ? (
                    <div className="min-h-[48px] max-h-40 overflow-y-auto rounded border border-border bg-background px-2 py-1.5">
                      {editComment.trim() ? (
                        <AnnotationMarkdownRenderer content={editComment} />
                      ) : (
                        <span className="text-xs text-muted-foreground italic">（空）</span>
                      )}
                    </div>
                  ) : (
                    <textarea
                      ref={textareaRef}
                      value={editComment}
                      onChange={(e) => setEditComment(e.target.value)}
                      className="w-full p-2 text-xs border border-border rounded bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                      rows={3}
                      placeholder="支持 Markdown 和 $公式$..."
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          handleSaveComment();
                        }
                        if (e.key === 'Escape') {
                          setIsEditing(false);
                          setShowPreview(false);
                          setEditComment(annotation.comment || '');
                        }
                      }}
                    />
                  )}

                  <div className="flex justify-end gap-1 mt-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs"
                      onClick={() => {
                        setIsEditing(false);
                        setShowPreview(false);
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
                  className="mt-1 flex items-start gap-1.5 cursor-text group/comment"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowPreview(false);
                    setIsEditing(true);
                  }}
                >
                  <MessageSquare className="h-3 w-3 mt-0.5 flex-shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0 max-h-24 overflow-y-auto">
                    <AnnotationMarkdownRenderer content={annotation.comment} />
                  </div>
                </div>
              ) : (
                <button
                  className="text-xs text-muted-foreground/60 hover:text-muted-foreground mt-1 flex items-center gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowPreview(false);
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
  onBatchDelete,
  onBatchUpdateColor,
  onBatchExport,
}: PdfAnnotationSidebarProps) {
  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const isMultiSelectMode = selectedIds.size > 0;

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<AnnotationTypeFilter>('all');
  const [colorFilter, setColorFilter] = useState<ColorFilter>('all');

  // Filter and sort annotations
  const filteredAnnotations = useMemo(() => {
    return annotations
      .filter(a => a.target.type === 'pdf')
      .filter(a => {
        // Type filter
        if (typeFilter !== 'all' && a.style.type !== typeFilter) {
          return false;
        }
        // Color filter
        if (colorFilter !== 'all' && a.style.color !== colorFilter) {
          return false;
        }
        // Search filter
        if (searchQuery.trim()) {
          const query = searchQuery.toLowerCase();
          const content = (a.content || '').toLowerCase();
          const comment = (a.comment || '').toLowerCase();
          if (!content.includes(query) && !comment.includes(query)) {
            return false;
          }
        }
        return true;
      });
  }, [annotations, typeFilter, colorFilter, searchQuery]);

  // Sort annotations by page, then by position (top to bottom)
  const sortedAnnotations = useMemo(() => {
    return [...filteredAnnotations]
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
  }, [filteredAnnotations]);

  // Multi-select handlers
  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(sortedAnnotations.map(a => a.id)));
  }, [sortedAnnotations]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBatchDelete = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (onBatchDelete) {
      onBatchDelete(ids);
    } else {
      // Fallback to individual deletes
      ids.forEach(id => onDelete(id));
    }
    clearSelection();
  }, [selectedIds, onBatchDelete, onDelete, clearSelection]);

  const handleBatchColorChange = useCallback((color: string) => {
    const ids = Array.from(selectedIds);
    if (onBatchUpdateColor) {
      onBatchUpdateColor(ids, color);
    } else if (onUpdateColor) {
      // Fallback to individual updates
      ids.forEach(id => onUpdateColor(id, color));
    }
  }, [selectedIds, onBatchUpdateColor, onUpdateColor]);

  const handleBatchExport = useCallback(() => {
    const selectedAnnotations = sortedAnnotations.filter(a => selectedIds.has(a.id));
    if (onBatchExport) {
      onBatchExport(selectedAnnotations);
    } else {
      // Default export: download as Markdown
      const markdown = exportAnnotationsToMarkdown(selectedAnnotations);
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `annotations-${new Date().toISOString().slice(0, 10)}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [selectedIds, sortedAnnotations, onBatchExport]);

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
        <div className="flex items-center gap-2">
          {/* Multi-select toggle button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => isMultiSelectMode ? clearSelection() : selectAll()}
            title={isMultiSelectMode ? "退出多选" : "多选模式"}
          >
            {isMultiSelectMode ? (
              <CheckSquare className="h-3.5 w-3.5 text-primary" />
            ) : (
              <SquareIcon className="h-3.5 w-3.5" />
            )}
          </Button>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {annotations.length}
          </span>
        </div>
      </div>

      {/* Search and filter toolbar */}
      <SearchFilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        colorFilter={colorFilter}
        onColorFilterChange={setColorFilter}
        resultCount={sortedAnnotations.length}
        totalCount={annotations.filter(a => a.target.type === 'pdf').length}
      />

      {/* Batch selection toolbar */}
      <BatchSelectionToolbar
        selectedCount={selectedIds.size}
        totalCount={sortedAnnotations.length}
        onSelectAll={selectAll}
        onClearSelection={clearSelection}
        onDelete={handleBatchDelete}
        onChangeColor={handleBatchColorChange}
        onExport={handleBatchExport}
      />
      
      {/* Annotation list */}
      <div className="flex-1 overflow-auto">
        {sortedAnnotations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 p-4 text-center">
            <Search className="h-6 w-6 text-muted-foreground mb-2" />
            <p className="text-xs text-muted-foreground">
              {searchQuery || typeFilter !== 'all' || colorFilter !== 'all'
                ? '没有匹配的批注'
                : '暂无批注'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sortedAnnotations.map(ann => (
              <AnnotationCard
                key={ann.id}
                annotation={ann}
                isSelected={selectedId === ann.id}
                isMultiSelected={selectedIds.has(ann.id)}
                isMultiSelectMode={isMultiSelectMode}
                onSelect={() => onSelect(ann)}
                onToggleMultiSelect={() => toggleSelection(ann.id)}
                onDelete={() => onDelete(ann.id)}
                onUpdateColor={onUpdateColor ? (color) => onUpdateColor(ann.id, color) : undefined}
                onUpdateComment={onUpdateComment ? (comment) => onUpdateComment(ann.id, comment) : undefined}
                onConvertToUnderline={onConvertToUnderline ? () => onConvertToUnderline(ann.id) : undefined}
                onUpdateTextStyle={onUpdateTextStyle ? (textColor, fontSize, bgColor) => onUpdateTextStyle(ann.id, textColor, fontSize, bgColor) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
