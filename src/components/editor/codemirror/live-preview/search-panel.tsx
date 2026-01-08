"use client";

/**
 * Search Panel Component
 * Find and replace functionality for Live Preview Editor
 * 
 * Requirements: 11.1-11.7
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Search, Replace, X, ChevronUp, ChevronDown, CaseSensitive, Regex, WholeWord } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch: (query: string, options: SearchOptions) => void;
  onReplace: (replacement: string) => void;
  onReplaceAll: (replacement: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  matchCount: number;
  currentMatch: number;
}

export interface SearchOptions {
  caseSensitive: boolean;
  regex: boolean;
  wholeWord: boolean;
}

export function SearchPanel({
  isOpen,
  onClose,
  onSearch,
  onReplace,
  onReplaceAll,
  onNext,
  onPrevious,
  matchCount,
  currentMatch,
}: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [options, setOptions] = useState<SearchOptions>({
    caseSensitive: false,
    regex: false,
    wholeWord: false,
  });
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus search input when panel opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.select();
    }
  }, [isOpen]);

  // Trigger search when query or options change
  useEffect(() => {
    onSearch(query, options);
  }, [query, options, onSearch]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        onPrevious();
      } else {
        onNext();
      }
    } else if (e.key === 'h' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setShowReplace(!showReplace);
    }
  }, [onClose, onNext, onPrevious, showReplace]);

  const toggleOption = useCallback((option: keyof SearchOptions) => {
    setOptions(prev => ({ ...prev, [option]: !prev[option] }));
  }, []);

  if (!isOpen) return null;

  return (
    <div 
      className="search-panel border-b border-border bg-background/95 backdrop-blur p-2"
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center gap-2">
        {/* Toggle replace */}
        <button
          onClick={() => setShowReplace(!showReplace)}
          className={cn(
            "p-1 rounded transition-colors",
            showReplace ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
          )}
          title="Toggle replace (Ctrl+H)"
        >
          <Replace className="h-4 w-4" />
        </button>

        {/* Search input */}
        <div className="flex-1 flex items-center gap-1">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
              className="w-full pl-8 pr-2 py-1 text-sm rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Search options */}
          <button
            onClick={() => toggleOption('caseSensitive')}
            className={cn(
              "p-1 rounded transition-colors",
              options.caseSensitive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            title="Case sensitive"
          >
            <CaseSensitive className="h-4 w-4" />
          </button>
          <button
            onClick={() => toggleOption('wholeWord')}
            className={cn(
              "p-1 rounded transition-colors",
              options.wholeWord ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            title="Whole word"
          >
            <WholeWord className="h-4 w-4" />
          </button>
          <button
            onClick={() => toggleOption('regex')}
            className={cn(
              "p-1 rounded transition-colors",
              options.regex ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            title="Use regex"
          >
            <Regex className="h-4 w-4" />
          </button>
        </div>

        {/* Match count */}
        <span className="text-xs text-muted-foreground min-w-[60px] text-center">
          {matchCount > 0 ? `${currentMatch}/${matchCount}` : 'No results'}
        </span>

        {/* Navigation */}
        <button
          onClick={onPrevious}
          disabled={matchCount === 0}
          className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-50"
          title="Previous (Shift+Enter)"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          onClick={onNext}
          disabled={matchCount === 0}
          className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-50"
          title="Next (Enter)"
        >
          <ChevronDown className="h-4 w-4" />
        </button>

        {/* Close */}
        <button
          onClick={onClose}
          className="p-1 rounded text-muted-foreground hover:text-foreground"
          title="Close (Escape)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Replace row */}
      {showReplace && (
        <div className="flex items-center gap-2 mt-2">
          <div className="w-6" /> {/* Spacer for alignment */}
          <div className="flex-1">
            <input
              type="text"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="Replace with..."
              className="w-full px-2 py-1 text-sm rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <button
            onClick={() => onReplace(replacement)}
            disabled={matchCount === 0}
            className="px-2 py-1 text-xs rounded border border-border hover:bg-accent disabled:opacity-50"
          >
            Replace
          </button>
          <button
            onClick={() => onReplaceAll(replacement)}
            disabled={matchCount === 0}
            className="px-2 py-1 text-xs rounded border border-border hover:bg-accent disabled:opacity-50"
          >
            Replace All
          </button>
        </div>
      )}
    </div>
  );
}

export default SearchPanel;
