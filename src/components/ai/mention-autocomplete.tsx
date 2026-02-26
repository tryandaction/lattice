"use client";

/**
 * Mention Autocomplete Component
 * Shows a dropdown when user types @ in chat input
 * Lists files from workspace and special mentions like @selection
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { FileText, TextSelect } from "lucide-react";
import { getAvailableFiles } from "@/lib/ai/mention-resolver";
import { cn } from "@/lib/utils";

interface MentionItem {
  type: 'file' | 'selection';
  label: string;
  value: string;
}

interface MentionAutocompleteProps {
  query: string;          // text after @
  position: { top: number; left: number };
  onSelect: (mention: string) => void;
  onClose: () => void;
  className?: string;
}

export function MentionAutocomplete({
  query,
  position,
  onSelect,
  onClose,
  className,
}: MentionAutocompleteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => {
    const files = getAvailableFiles();
    const allItems: MentionItem[] = [
      { type: 'selection', label: 'Current Selection', value: '@selection' },
      ...files.map(f => ({
        type: 'file' as const,
        label: f.name,
        value: `@${f.name}`,
      })),
    ];

    const filtered = query
      ? allItems.filter(item =>
          item.label.toLowerCase().includes(query.toLowerCase())
        )
      : allItems;

    return filtered.slice(0, 10);
  }, [query]);

  const activeIndex = Math.min(selectedIndex, Math.max(0, items.length - 1));

  const handlerRef = useRef<(e: KeyboardEvent) => void>(() => {});

  useEffect(() => {
    handlerRef.current = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (items[activeIndex]) {
          onSelect(items[activeIndex].value);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
  }, [items, activeIndex, onSelect, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => handlerRef.current(e);
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (items.length === 0) return null;

  return (
    <div
      className={cn(
        "absolute z-50 w-64 max-h-48 overflow-auto rounded-lg border border-border bg-popover shadow-lg",
        className
      )}
      style={{ bottom: position.top, left: position.left }}
      ref={listRef}
    >
      {items.map((item, i) => (
        <button
          key={item.value}
          type="button"
          className={cn(
            "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-muted transition-colors",
            i === activeIndex && "bg-muted"
          )}
          onClick={() => onSelect(item.value)}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          {item.type === 'selection' ? (
            <TextSelect className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          ) : (
            <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          )}
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
