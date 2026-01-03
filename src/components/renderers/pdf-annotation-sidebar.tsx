"use client";

/**
 * PDF Annotation Sidebar (Zotero-style)
 * 
 * Displays all annotations for the current PDF with:
 * - Grouped by page
 * - Color indicators
 * - Text preview
 * - Comment preview
 * - Click to navigate
 */

import { useMemo } from "react";
import { 
  Highlighter, 
  StickyNote, 
  Square, 
  MessageSquare,
  Trash2,
  Pencil,
  Underline,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnnotationItem, PdfTarget } from "@/types/universal-annotation";

interface PdfAnnotationSidebarProps {
  annotations: AnnotationItem[];
  selectedId: string | null;
  onSelect: (annotation: AnnotationItem) => void;
  onDelete: (id: string) => void;
}

interface AnnotationGroup {
  page: number;
  items: AnnotationItem[];
}

export function PdfAnnotationSidebar({
  annotations,
  selectedId,
  onSelect,
  onDelete,
}: PdfAnnotationSidebarProps) {
  // Group annotations by page
  const groups = useMemo(() => {
    const grouped = new Map<number, AnnotationItem[]>();
    
    annotations.forEach(ann => {
      if (ann.target.type !== 'pdf') return;
      const page = (ann.target as PdfTarget).page;
      if (!grouped.has(page)) {
        grouped.set(page, []);
      }
      grouped.get(page)!.push(ann);
    });

    // Sort by page number
    const sortedGroups: AnnotationGroup[] = [];
    const sortedPages = Array.from(grouped.keys()).sort((a, b) => a - b);
    
    sortedPages.forEach(page => {
      const items = grouped.get(page)!;
      // Sort items by creation time
      items.sort((a, b) => a.createdAt - b.createdAt);
      sortedGroups.push({ page, items });
    });
    
    return sortedGroups;
  }, [annotations]);

  const getAnnotationIcon = (ann: AnnotationItem) => {
    const style = ann.style.type;
    switch (style) {
      case 'highlight':
        return <Highlighter className="h-3 w-3" style={{ color: ann.style.color }} />;
      case 'underline':
        return <Underline className="h-3 w-3" style={{ color: ann.style.color }} />;
      case 'ink':
        return <Pencil className="h-3 w-3" style={{ color: ann.style.color }} />;
      case 'area':
        // Check if it's a small pin/note
        if (ann.target.type === 'pdf') {
          const target = ann.target as PdfTarget;
          if (target.rects.length === 1) {
            const rect = target.rects[0];
            const width = rect.x2 - rect.x1;
            const height = rect.y2 - rect.y1;
            if (width < 0.05 && height < 0.05) {
              return <StickyNote className="h-3 w-3 text-amber-500" />;
            }
          }
        }
        return <Square className="h-3 w-3" style={{ color: ann.style.color }} />;
      default:
        return <Type className="h-3 w-3" style={{ color: ann.style.color }} />;
    }
  };

  const getPreviewText = (ann: AnnotationItem) => {
    if (ann.style.type === 'ink') {
      return 'Drawing';
    }
    if (ann.content) {
      return ann.content.slice(0, 50) + (ann.content.length > 50 ? '...' : '');
    }
    if (ann.comment) {
      return ann.comment.slice(0, 50) + (ann.comment.length > 50 ? '...' : '');
    }
    return ann.style.type === 'area' ? 'Area selection' : 'Annotation';
  };

  if (annotations.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        No annotations yet.
        <br />
        <span className="text-xs">Select text or use tools to add annotations.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-sm font-medium">Annotations ({annotations.length})</h3>
      </div>
      
      <div className="flex-1 overflow-auto">
        {groups.map(group => (
          <div key={group.page} className="border-b border-border last:border-b-0">
            <div className="px-3 py-1.5 bg-muted/50 text-xs font-medium text-muted-foreground">
              Page {group.page}
            </div>
            
            {group.items.map(ann => (
              <div
                key={ann.id}
                className={`group px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors border-l-2 ${
                  selectedId === ann.id 
                    ? 'bg-muted border-l-primary' 
                    : 'border-l-transparent'
                }`}
                onClick={() => onSelect(ann)}
              >
                <div className="flex items-start gap-2">
                  <div className="mt-0.5">
                    {getAnnotationIcon(ann)}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ 
                      backgroundColor: ann.style.type === 'highlight' ? `${ann.style.color}40` : undefined 
                    }}>
                      {getPreviewText(ann)}
                    </p>
                    
                    {ann.comment && ann.content && (
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        {ann.comment.slice(0, 30)}{ann.comment.length > 30 ? '...' : ''}
                      </p>
                    )}
                  </div>
                  
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(ann.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
