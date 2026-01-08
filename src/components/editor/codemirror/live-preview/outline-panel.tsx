"use client";

/**
 * Outline Panel Component
 * Displays document structure based on headings
 * 
 * Requirements: 6.6, 6.7, 18.4
 */

import { memo, useCallback, useEffect, useState } from 'react';
import { ChevronRight, ChevronDown, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OutlineItem } from './types';

interface OutlinePanelProps {
  items: OutlineItem[];
  onNavigate: (line: number) => void;
  activeHeading?: number;
  className?: string;
  /** Editor scroll container ref for scroll sync */
  editorRef?: React.RefObject<HTMLElement>;
}

/**
 * Flatten outline items to get all headings with their lines
 */
function flattenOutline(items: OutlineItem[]): { line: number; level: number }[] {
  const result: { line: number; level: number }[] = [];
  
  function traverse(items: OutlineItem[]) {
    for (const item of items) {
      result.push({ line: item.line, level: item.level });
      if (item.children.length > 0) {
        traverse(item.children);
      }
    }
  }
  
  traverse(items);
  return result.sort((a, b) => a.line - b.line);
}

/**
 * Outline item component
 */
function OutlineItemComponent({
  item,
  depth,
  onNavigate,
  activeHeading,
}: {
  item: OutlineItem;
  depth: number;
  onNavigate: (line: number) => void;
  activeHeading?: number;
}) {
  const isActive = activeHeading === item.line;
  const hasChildren = item.children.length > 0;
  
  return (
    <div className="outline-item-container">
      <button
        onClick={() => onNavigate(item.line)}
        className={cn(
          'w-full text-left px-2 py-1 rounded text-sm transition-colors',
          'hover:bg-accent/50 focus:outline-none focus:ring-1 focus:ring-primary/50',
          'flex items-center gap-1',
          isActive && 'bg-accent text-accent-foreground font-medium'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        title={item.text}
      >
        {hasChildren ? (
          <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        ) : (
          <span className="w-3" />
        )}
        <span className="truncate">{item.text}</span>
      </button>
      
      {hasChildren && (
        <div className="outline-children">
          {item.children.map((child, index) => (
            <OutlineItemComponent
              key={`${child.line}-${index}`}
              item={child}
              depth={depth + 1}
              onNavigate={onNavigate}
              activeHeading={activeHeading}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Outline Panel
 */
function OutlinePanelComponent({
  items,
  onNavigate,
  activeHeading,
  className,
  editorRef,
}: OutlinePanelProps) {
  const [scrollActiveHeading, setScrollActiveHeading] = useState<number | undefined>(activeHeading);
  
  // Sync outline with scroll position
  useEffect(() => {
    const editor = editorRef?.current;
    if (!editor || items.length === 0) return;
    
    const flatHeadings = flattenOutline(items);
    if (flatHeadings.length === 0) return;
    
    const handleScroll = () => {
      // Find the CodeMirror scroller element
      const scroller = editor.querySelector('.cm-scroller') as HTMLElement;
      if (!scroller) return;
      
      const scrollTop = scroller.scrollTop;
      const containerRect = scroller.getBoundingClientRect();
      
      // Find all heading elements and determine which is visible
      const lines = editor.querySelectorAll('.cm-line');
      let activeLineNum: number | undefined;
      
      // Find the heading that's closest to the top of the viewport
      for (const heading of flatHeadings) {
        const lineIndex = heading.line - 1; // Convert to 0-based
        if (lineIndex >= 0 && lineIndex < lines.length) {
          const lineEl = lines[lineIndex] as HTMLElement;
          const lineRect = lineEl.getBoundingClientRect();
          const relativeTop = lineRect.top - containerRect.top;
          
          // If this heading is at or above the viewport top (with some buffer)
          if (relativeTop <= 50) {
            activeLineNum = heading.line;
          } else {
            break;
          }
        }
      }
      
      if (activeLineNum !== undefined) {
        setScrollActiveHeading(activeLineNum);
      }
    };
    
    // Find the scroller and attach listener
    const scroller = editor.querySelector('.cm-scroller');
    if (scroller) {
      scroller.addEventListener('scroll', handleScroll, { passive: true });
      // Initial check
      handleScroll();
      
      return () => {
        scroller.removeEventListener('scroll', handleScroll);
      };
    }
  }, [editorRef, items]);
  
  // Use prop activeHeading if provided, otherwise use scroll-detected one
  const effectiveActiveHeading = activeHeading ?? scrollActiveHeading;
  
  if (items.length === 0) {
    return (
      <div className={cn('p-4 text-center text-muted-foreground text-sm', className)}>
        <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No headings found</p>
        <p className="text-xs mt-1">Add headings with # to see outline</p>
      </div>
    );
  }
  
  return (
    <div className={cn('outline-panel py-2', className)}>
      <div className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Outline
      </div>
      <nav className="mt-1">
        {items.map((item, index) => (
          <OutlineItemComponent
            key={`${item.line}-${index}`}
            item={item}
            depth={0}
            onNavigate={onNavigate}
            activeHeading={effectiveActiveHeading}
          />
        ))}
      </nav>
    </div>
  );
}

export const OutlinePanel = memo(OutlinePanelComponent);
OutlinePanel.displayName = 'OutlinePanel';

export default OutlinePanel;
