"use client";

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, type RefObject } from "react";
import { ArrowLeft, FolderCheck, FolderOpen } from "lucide-react";
import { deriveFileId } from "@/lib/annotation-storage";
import { isAgentDocumentPath, isWorkspaceInstructionPath } from "@/lib/ai/document-source";
import {
  getAvailableFiles,
  getMentionFragmentSuggestions,
  resolveWorkspaceFilePath,
  type MentionSuggestion,
} from "@/lib/ai/mention-resolver";
import { buildSourceSelectionMention, isSensitiveCredentialPath } from "@/lib/ai/source-index";
import { inferMentionFolderPath, listMentionWorkspaceEntries, normalizeMentionFolderPath } from "@/lib/ai/mention-workspace-browser";
import {
  createMentionBacktrackResult,
  createMentionSelectionResult,
  getMentionSelectionStage,
  type MentionSelectionResult,
} from "@/lib/ai/mention-browser";
import { cn } from "@/lib/utils";
import { UI_LAYER_CLASS } from "@/lib/ui-layers";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useAnnotationStore } from "@/stores/annotation-store";
import { buildReferenceBrowserNodesFromMentionSuggestions } from "@/lib/ai/reference-browser";
import { Portal } from "@/components/ui/portal";
import { ReferenceBrowser } from "./reference-browser";
import { useI18n } from "@/hooks/use-i18n";
import type { TranslationKey } from "@/lib/i18n";

interface MentionAutocompleteProps {
  query: string;
  anchorRef: RefObject<HTMLTextAreaElement | null>;
  onSelect: (selection: MentionSelectionResult) => void;
  onClose: () => void;
  className?: string;
}

interface PopupLayout { top: number; left: number; width: number; maxHeight: number }

function encodeQueryPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function selectionItem(): MentionSuggestion {
  return { type: 'selection', label: 'chat.mention.selection', value: '@selection' };
}

function fileItem(path: string, name = path.split('/').at(-1) ?? path): MentionSuggestion {
  return { type: 'file', label: name, value: `@${encodeQueryPath(path)}`, description: path };
}

function folderItem(path: string, name = path.split('/').at(-1) ?? path): MentionSuggestion {
  return { type: 'folder', label: name, value: buildSourceSelectionMention({ kind: 'folder', path: path || '.' }), description: path || '.' };
}

export function calculateMentionPopupLayout(anchor: DOMRect, popup: { width: number; height: number }, viewport: { width: number; height: number }): PopupLayout {
  const margin = 8;
  const width = Math.min(popup.width, Math.max(0, viewport.width - margin * 2));
  const maxHeight = Math.min(360, Math.max(0, viewport.height - margin * 2));
  const height = Math.min(popup.height, maxHeight);
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - width - margin));
  let top = anchor.top - height - margin;
  if (top < margin) top = Math.min(anchor.bottom + margin, viewport.height - height - margin);
  return { top: Math.max(margin, top), left, width, maxHeight };
}

export function MentionAutocomplete({ query, anchorRef, onSelect, onClose, className }: MentionAutocompleteProps) {
  const [selectionState, setSelectionState] = useState({ query: "", index: 0 });
  const [items, setItems] = useState<MentionSuggestion[]>([]);
  const [browsePath, setBrowsePath] = useState<string | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [layout, setLayout] = useState<PopupLayout | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const getAnnotationsForFile = useAnnotationStore((state) => state.getAnnotationsForFile);
  const { t } = useI18n();
  const stage = getMentionSelectionStage(query);
  const explicitFolderQuery = query.startsWith('folder:');
  let selectedFilePath: string | null = null;
  if (stage === 'fragments') {
    try { selectedFilePath = decodeURIComponent(query.split('#', 1)[0]); } catch { /* An incomplete escape is still being typed. */ }
  }

  const baseItems = useMemo(() => {
    return !explicitFolderQuery && stage === 'files' && 'selection'.startsWith(query.toLowerCase())
      ? [selectionItem()] : [];
  }, [explicitFolderQuery, query, stage]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setBrowseError(null);
      setBrowsePath(null);
      setItems([]);
      setLoading(true);
      if (stage === 'fragments') {
        const hashIndex = query.indexOf('#');
        if (hashIndex === -1) { setItems(baseItems); return; }
        const rawPath = query.slice(0, hashIndex);
        const fragmentQuery = query.slice(hashIndex + 1);
        let decodedPath = rawPath;
        try { decodedPath = decodeURIComponent(rawPath); } catch { setItems([]); return; }
        const matchingFiles = getAvailableFiles().filter(file => file.path.toLocaleLowerCase() === decodedPath.toLocaleLowerCase()
          || file.path.toLocaleLowerCase().endsWith(decodedPath.toLocaleLowerCase()));
        if (matchingFiles.length !== 1) {
          setItems(matchingFiles.slice(0, 10).map(file => ({ ...fileItem(file.path, file.name), value: `@${encodeQueryPath(file.path)}#`, description: `${file.path} · ${t('chat.mention.chooseFragment')}` })));
          return;
        }
        const resolvedPath = resolveWorkspaceFilePath(matchingFiles[0].path);
        const annotations = getAnnotationsForFile(deriveFileId(resolvedPath));
        const pageCandidates = [...new Set(annotations.map(annotation => annotation.page).filter((page): page is number => typeof page === 'number' && Number.isFinite(page)))];
        const annotationCandidates = annotations.map(annotation => annotation.id);
        const fragmentItems = await getMentionFragmentSuggestions(resolvedPath, {
          fragmentQuery,
          readFile: async path => {
            if (!rootHandle) return '';
            const parts = path.split('/').filter(Boolean);
            let directory = rootHandle;
            for (let index = 0; index < parts.length - 1; index += 1) directory = await directory.getDirectoryHandle(parts[index]);
            return (await (await directory.getFileHandle(parts.at(-1)!)).getFile()).text();
          },
          pdfPageCandidates: pageCandidates,
          pdfAnnotationCandidates: annotationCandidates,
        });
        if (!cancelled) setItems(fragmentItems.slice(0, 24));
        return;
      }

      if (query === '' && !rootHandle) { setItems([selectionItem()]); return; }
      if (!rootHandle) { setItems(baseItems); return; }

      let folderPath: string | null = null;
      let folderFilter = '';
      let includeWorkspaceMatches = false;
      if (explicitFolderQuery) {
        try {
          const rawPath = query.slice('folder:'.length);
          const endsAtFolderBoundary = rawPath.endsWith('/');
          const separator = rawPath.lastIndexOf('/');
          if (!endsAtFolderBoundary && separator >= 0) {
            folderPath = normalizeMentionFolderPath(rawPath.slice(0, separator), true);
            folderFilter = decodeURIComponent(rawPath.slice(separator + 1));
          } else if (!endsAtFolderBoundary && separator < 0) {
            folderPath = '';
            folderFilter = decodeURIComponent(rawPath);
          } else folderPath = normalizeMentionFolderPath(rawPath.replace(/\/+$/u, ''), true);
        }
        catch (error) { setBrowseError(error instanceof Error ? error.message : String(error)); setItems([]); return; }
      } else if (query === '') folderPath = '';
      else if (query.includes('/')) {
        try {
          const inferred = inferMentionFolderPath(query);
          const candidate = inferred ?? normalizeMentionFolderPath(query, true);
          if (inferred) {
            folderPath = candidate;
          } else {
            await listMentionWorkspaceEntries(rootHandle, candidate);
            folderPath = candidate;
          }
          includeWorkspaceMatches = true;
        } catch (error) {
          if (error instanceof DOMException && ['NotFoundError', 'TypeMismatchError'].includes(error.name)) {
            const separator = query.lastIndexOf('/');
            try {
              folderPath = normalizeMentionFolderPath(query.slice(0, separator), true);
              folderFilter = decodeURIComponent(query.slice(separator + 1));
            } catch { setItems([]); return; }
          }
          else {
            if (!cancelled) setBrowseError(t('chat.mention.folderReadFailed'));
            return;
          }
        }
      } else { folderPath = ''; folderFilter = query; includeWorkspaceMatches = true; }

      if (folderPath !== null) {
        try {
          const entries = await listMentionWorkspaceEntries(rootHandle, folderPath, folderFilter);
          if (!cancelled) {
            setBrowsePath(folderPath);
            const localEntries = entries.map(entry => entry.kind === 'folder'
              ? folderItem(entry.path, entry.name) : fileItem(entry.path, entry.name));
            const indexedMatches = includeWorkspaceMatches && folderFilter && !folderFilter.includes('/') ? getAvailableFiles()
              .filter(file => isAgentDocumentPath(file.path) && !isWorkspaceInstructionPath(file.path) && !isSensitiveCredentialPath(file.path)
                && file.path.toLocaleLowerCase().includes(folderFilter.toLocaleLowerCase()))
              .slice(0, 40).map(file => fileItem(file.path, file.name)) : [];
            setItems([...new Map([...baseItems, ...localEntries, ...indexedMatches].map(item => [item.value, item])).values()].slice(0, 120));
          }
        } catch {
          if (!cancelled) { setBrowseError(t('chat.mention.folderReadFailed')); setItems([]); }
        }
        return;
      }
      setItems(baseItems);
    };
    void load().catch(() => {
      if (!cancelled) { setBrowseError(t('chat.mention.folderReadFailed')); setItems([]); }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [baseItems, explicitFolderQuery, getAnnotationsForFile, query, rootHandle, stage, t]);

  const selectedIndex = selectionState.query === query ? selectionState.index : 0;
  const activeIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, items.length - 1)));
  const navigateToFolder = useCallback((path: string) => {
    const value = `${buildSourceSelectionMention({ kind: 'folder', path: path || '.' })}/`;
    onSelect({ value, continueSelection: true, nextQuery: value.slice(1) });
  }, [onSelect]);
  const activateItem = useCallback((item: MentionSuggestion) => {
    if (item.type === 'folder') {
      navigateToFolder(decodeURIComponent(item.value.replace(/^@folder:/u, '')));
      return;
    }
    onSelect(createMentionSelectionResult(item, query));
  }, [navigateToFolder, onSelect, query]);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const update = () => {
      const popup = popupRef.current;
      if (!popup || !anchor.isConnected) { setLayout(current => current === null ? current : null); return; }
      const next = calculateMentionPopupLayout(anchor.getBoundingClientRect(),
        { width: popup.offsetWidth || 320, height: popup.offsetHeight || 320 },
        { width: window.innerWidth, height: window.innerHeight });
      setLayout(current => current && current.top === next.top && current.left === next.left
        && current.width === next.width && current.maxHeight === next.maxHeight ? current : next);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(anchor);
    if (popupRef.current) observer?.observe(popupRef.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [anchorRef, browsePath, items.length, query]);

  const handlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    handlerRef.current = event => {
      if (document.activeElement !== anchorRef.current) return;
      if (event.isComposing || event.keyCode === 229 || event.key === 'Enter' && event.shiftKey
        || !['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) return;
      if (!items.length && !loading && (event.key === 'Enter' || event.key === 'Tab')) {
        onClose();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!items.length) return;
        setSelectionState(state => ({ query, index: Math.max(0, Math.min(items.length - 1,
          (state.query === query ? state.index : 0) + (event.key === 'ArrowDown' ? 1 : -1))) }));
        return;
      }
      const item = items[activeIndex];
      if (!item) return;
      activateItem(item);
    };
  }, [activeIndex, activateItem, anchorRef, items, loading, onClose, query]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => handlerRef.current(event);
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-reference-browser-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const displayItems = useMemo(() => items.map(item => item.type === 'selection'
    ? { ...item, label: t(item.label as TranslationKey) } : item), [items, t]);
  const nodes = useMemo(() => buildReferenceBrowserNodesFromMentionSuggestions(displayItems), [displayItems]);
  const folderMention = (path: string) => buildSourceSelectionMention({ kind: 'folder', path: path || '.' });

  return (
    <Portal>
      <div
        ref={popupRef}
        className={cn('fixed w-80 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-popover shadow-lg', UI_LAYER_CLASS.dialogElevated, className)}
        style={layout ? { top: layout.top, left: layout.left, width: layout.width, maxHeight: layout.maxHeight } : { visibility: 'hidden', top: 0, left: 0, width: 320 }}
        data-testid="mention-autocomplete"
      >
        <div ref={listRef} className="max-h-72 overflow-auto p-2">
          {stage === 'fragments' ? (
            <button type="button" onClick={() => onSelect(createMentionBacktrackResult(query))} className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" />{t('chat.mention.backToFile')}
            </button>
          ) : null}
          {browsePath !== null ? (
            <div className="mb-2 flex items-center justify-between gap-2 border-b border-border/60 px-1 pb-2">
              <div className="min-w-0 flex items-center gap-1">
                {browsePath ? <button type="button" aria-label={t('chat.mention.parentFolder')} onClick={() => {
                  const parent = browsePath.split('/').slice(0, -1).join('/');
                  navigateToFolder(parent);
                }} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-muted"><ArrowLeft className="h-3.5 w-3.5" /></button> : null}
                <span className="truncate text-xs text-muted-foreground">{browsePath || t('chat.mention.browseWorkspace')}</span>
              </div>
              <button type="button" onClick={() => onSelect({ value: folderMention(browsePath), continueSelection: false, nextQuery: null })}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted">
                <FolderCheck className="h-3.5 w-3.5" />{t('chat.mention.chooseFolder')}
              </button>
            </div>
          ) : null}
          {loading ? <p className="px-2 py-3 text-xs text-muted-foreground">{t('chat.mention.loading')}</p> : null}
          {browseError ? <p role="alert" className="px-2 py-3 text-xs text-destructive">{browseError}</p> : null}
          {!loading && !browseError ? <ReferenceBrowser
            nodes={nodes}
            activeNodeId={nodes[activeIndex]?.id ?? null}
            headerTitle={stage === 'files' ? t('chat.mention.chooseWorkspace') : t('chat.mention.chooseFragment')}
            headerSubtitle={stage === 'fragments' ? selectedFilePath ?? undefined : browsePath === null ? t('chat.mention.browseHint') : undefined}
            emptyLabel={t('chat.mention.noMatches')}
            onActivateNode={node => {
              const item = items.find(candidate => candidate.value === node.value);
              if (item) activateItem(item);
            }}
          /> : null}
        </div>
        {browsePath === null && rootHandle && stage === 'files' && !query ? <button type="button" onClick={() => {
          const value = `${folderMention('')}/`;
          onSelect({ value, continueSelection: true, nextQuery: 'folder:./' });
        }} className="flex w-full items-center gap-2 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground hover:bg-muted">
          <FolderOpen className="h-3.5 w-3.5" />{t('chat.mention.browseWorkspace')}
        </button> : null}
      </div>
    </Portal>
  );
}
