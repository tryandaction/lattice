"use client";

/**
 * Mention Autocomplete Component
 * Shows a dropdown when user types @ in chat input
 * Lists files from workspace and special mentions like @selection
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { ArrowLeft, ChevronRight, FileText, Hash, TextSelect } from "lucide-react";
import { deriveFileId } from "@/lib/annotation-storage";
import {
  getAvailableFiles,
  getMentionFragmentSuggestions,
  resolveWorkspaceFilePath,
  type MentionSuggestion,
} from "@/lib/ai/mention-resolver";
import {
  createMentionBacktrackResult,
  createMentionSelectionResult,
  getMentionSelectionStage,
} from "@/lib/ai/mention-browser";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useAnnotationStore } from "@/stores/annotation-store";

interface MentionItem {
  type: MentionSuggestion["type"];
  label: string;
  value: string;
  description?: string;
}

interface MentionAutocompleteProps {
  query: string;          // text after @
  position: { top: number; left: number };
  onSelect: (selection: { value: string; continueSelection: boolean; nextQuery: string | null }) => void;
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
  const [selectionState, setSelectionState] = useState({ query: "", index: 0 });
  const listRef = useRef<HTMLDivElement>(null);
  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const getAnnotationsForFile = useAnnotationStore((state) => state.getAnnotationsForFile);
  const stage = getMentionSelectionStage(query);
  const selectedFilePath = stage === "fragments" ? decodeURI(query.split("#", 1)[0] ?? "") : null;
  const fileSearchQuery = stage === "fragments" ? query.split("#", 1)[0] ?? "" : query;

  const baseItems = useMemo(() => {
    const files = getAvailableFiles();
    const allItems: MentionItem[] = [
      { type: 'selection', label: 'Current Selection', value: '@selection' },
      ...files.map(f => ({
        type: 'file' as const,
        label: f.name,
        value: `@${encodeURI(f.path)}`,
        description: f.path,
      })),
    ];

    const filtered = fileSearchQuery
      ? allItems.filter(item =>
          item.label.toLowerCase().includes(fileSearchQuery.toLowerCase()) ||
          item.description?.toLowerCase().includes(fileSearchQuery.toLowerCase())
        )
      : allItems;

    return filtered.slice(0, 10);
  }, [fileSearchQuery]);
  const [items, setItems] = useState<MentionItem[]>(baseItems);

  useEffect(() => {
    let cancelled = false;

    async function loadFragmentItems() {
      const hashIndex = query.indexOf("#");
      if (hashIndex === -1) {
        setItems(baseItems);
        return;
      }

      const rawPath = query.slice(0, hashIndex);
      const fragmentQuery = query.slice(hashIndex + 1);
      const matchingFiles = getAvailableFiles().filter((file) =>
        file.path.toLowerCase() === rawPath.toLowerCase() ||
        file.path.toLowerCase().endsWith(rawPath.toLowerCase())
      );

      if (matchingFiles.length !== 1) {
        const fileItems = matchingFiles.slice(0, 10).map((file) => ({
          type: 'file' as const,
          label: file.name,
          value: `@${encodeURI(file.path)}#`,
          description: `${file.path} · 继续选择片段`,
        }));
        setItems(fileItems);
        return;
      }

      const resolvedPath = resolveWorkspaceFilePath(matchingFiles[0].path);
      const fileId = deriveFileId(resolvedPath);
      const annotations = getAnnotationsForFile(fileId);
      const pageCandidates = [...new Set(
        annotations
          .map((annotation) => annotation.page)
          .filter((page): page is number => typeof page === "number" && Number.isFinite(page))
      )];
      const annotationCandidates = annotations.map((annotation) => annotation.id);

      const fragmentItems = await getMentionFragmentSuggestions(resolvedPath, {
        fragmentQuery,
        readFile: async (path) => {
          if (!rootHandle) {
            return "";
          }
          const parts = path.split("/").filter(Boolean);
          let directory = rootHandle;
          for (let index = 0; index < parts.length - 1; index += 1) {
            directory = await directory.getDirectoryHandle(parts[index]);
          }
          const fileHandle = await directory.getFileHandle(parts[parts.length - 1]);
          const file = await fileHandle.getFile();
          return file.text();
        },
        pdfPageCandidates: pageCandidates,
        pdfAnnotationCandidates: annotationCandidates,
      });

      if (!cancelled) {
        setItems(fragmentItems.slice(0, 12));
      }
    }

    void loadFragmentItems();

    return () => {
      cancelled = true;
    };
  }, [baseItems, getAnnotationsForFile, query, rootHandle]);

  const selectedIndex = selectionState.query === query ? selectionState.index : 0;
  const activeIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, items.length - 1)));

  const handlerRef = useRef<(e: KeyboardEvent) => void>(() => {});

  useEffect(() => {
    handlerRef.current = (e: KeyboardEvent) => {
      if (items.length === 0) {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectionState((state) => ({
          query,
          index: Math.min((state.query === query ? state.index : 0) + 1, items.length - 1),
        }));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectionState((state) => ({
          query,
          index: Math.max((state.query === query ? state.index : 0) - 1, 0),
        }));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (items[activeIndex]) {
          onSelect(createMentionSelectionResult(items[activeIndex], query));
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
  }, [items, activeIndex, onSelect, onClose, query]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => handlerRef.current(e);
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-mention-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <div
      className={cn(
        "absolute z-50 w-72 rounded-lg border border-border bg-popover shadow-lg",
        className
      )}
      style={{ bottom: position.top, left: position.left }}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {stage === 'files' ? '选择文件' : '选择片段'}
          </div>
          <div className="truncate text-xs text-foreground">
            {stage === 'files' ? '输入 @ 后浏览工作区文件' : selectedFilePath}
          </div>
        </div>
        {stage === 'fragments' && (
          <button
            type="button"
            onClick={() => onSelect(createMentionBacktrackResult(query))}
            className="inline-flex items-center gap-1 rounded border border-border/70 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
          >
            <ArrowLeft className="h-3 w-3" />
            返回文件
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="px-3 py-4 text-xs text-muted-foreground">
          当前没有匹配项。
        </div>
      ) : (
        <div ref={listRef} className="max-h-56 overflow-auto py-1">
          {items.map((item, i) => (
            <button
              key={item.value}
              type="button"
              data-mention-index={i}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-muted transition-colors",
                i === activeIndex && "bg-muted"
              )}
              onClick={() => onSelect(createMentionSelectionResult(item, query))}
              onMouseEnter={() => setSelectionState({ query, index: i })}
            >
              {item.type === 'selection' ? (
                <TextSelect className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              ) : item.type === 'heading' || item.type === 'code_line' || item.type === 'notebook_cell' || item.type === 'pdf_page' || item.type === 'pdf_annotation' ? (
                <Hash className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              ) : (
                <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              )}
              <div className="min-w-0">
                <div className="truncate">{item.label}</div>
                {item.description && (
                  <div className="truncate text-[11px] text-muted-foreground">{item.description}</div>
                )}
              </div>
              {item.type === 'file' && (
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
