"use client";

/**
 * Live Preview Editor Component
 * Obsidian-style markdown editor with cursor-based syntax reveal
 * 
 * Requirements: All from spec
 */

import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import { useEffect, useRef, useState, useCallback, useContext, memo, forwardRef, useImperativeHandle } from 'react';
import { AssetSourceContext } from '@/lib/asset-source-context';
import { Loader2 } from 'lucide-react';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { flashReferenceTarget, flashReferenceRange } from '@/lib/reference-target-flash';
import { EditorSelection, EditorState, Extension, Transaction } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { bracketMatching } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { logger } from '@/lib/logger';

import { cursorContextExtension, setEditorFocus } from './cursor-context-plugin';
import { decorationCoordinatorExtension, parsedElementsField, clearDecorationCache } from './decoration-coordinator';
import { foldingExtension } from './folding-plugin';
import { markdownKeymap } from './keyboard-shortcuts';
import { autoFormattingExtension } from './auto-formatting';
import { livePreviewThemeExtension } from './live-preview-theme';
import { wikiLinkAutocomplete, updateAvailableFiles, updateWikiLinkCompletionContext } from './wiki-link-autocomplete';
import { markdownSmartInputExtension } from './markdown-smart-input';
import { createImageDropExtension, ImageUploadHandler } from './image-drop-plugin';
import { createMathPasteExtension } from './math-paste-plugin';
import { createPluginEditorExtensions } from '../plugin-extensions';
import { createAccessibilityExtension, addEditorDescription, announceChange } from './accessibility';
import type {
  ViewMode,
  OutlineItem,
  LivePreviewCodeBlockRevealRequest,
  LivePreviewCodeBlockRunRequest,
} from './types';
import { parseHeadings, buildOutlineTree } from './markdown-parser';
import { aiCompletionExtension } from './ai-completion-plugin';
import { MathEditor } from '../../math-editor';
import { registerCodeMirrorView, unregisterCodeMirrorView, setActiveInputTargetFromElement } from '@/lib/unified-input-handler';
import { normalizeFormulaInput, wrapLatexForMarkdown } from '@/lib/formula-utils';
import { useSearchParams } from 'next/navigation';
import { useSettingsStore } from '@/stores/settings-store';
import { imageResolverFacet } from './image-resolver-facet';
import { enterCodeBlockSourceMode, setCodeBlockSourceMode, setMathSourceMode } from './source-mode';
import { createLocalImageUrlCache, type LocalImageUrlCache } from './local-image-url-cache';
import { codeBlockRunContextFacet } from './code-block-run-context';
import {
  getCurrentMarkdownBlock,
  getMarkdownEditorContext,
  getPropertiesYaml,
  markdownBlockToHtml,
  runMarkdownEditingCommand,
  type MarkdownCommandPayload,
  type MarkdownEditingCommandId,
  type MarkdownEditorContext,
} from './markdown-editing-commands';

// Helper: resolve a relative image path against the current file's directory
function resolveImagePath(currentFilePath: string, imageUrl: string): string {
  if (imageUrl.startsWith('/')) return imageUrl.slice(1);
  const baseParts = currentFilePath.replace(/\\/g, '/').split('/');
  baseParts.pop(); // remove filename
  const targetParts = imageUrl.replace(/\\/g, '/').split('/');
  const resolved = [...baseParts];
  for (const part of targetParts) {
    if (!part || part === '.') continue;
    if (part === '..') { resolved.pop(); continue; }
    resolved.push(part);
  }
  return resolved.join('/');
}

// Helper: traverse FileSystemDirectoryHandle to get a file handle by path
async function resolveFileHandleFromRoot(
  root: FileSystemDirectoryHandle,
  filePath: string
): Promise<FileSystemFileHandle> {
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const startIndex = parts[0] === root.name ? 1 : 0;
  let current: FileSystemDirectoryHandle | FileSystemFileHandle = root;
  for (let i = startIndex; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    if (isLast) {
      current = await (current as FileSystemDirectoryHandle).getFileHandle(parts[i]);
    } else {
      current = await (current as FileSystemDirectoryHandle).getDirectoryHandle(parts[i]);
    }
  }
  return current as FileSystemFileHandle;
}

type LivePreviewViewWithHandlers = EditorView & {
  _outlineTimeout?: ReturnType<typeof setTimeout>;
  _unifiedInputFocusHandler?: (event: FocusEvent) => void;
  _unifiedInputBlurHandler?: () => void;
  _mathEditorHandler?: (e: Event) => void;
  _markdownImageEditHandler?: (e: Event) => void;
  _resolvedImageUrls?: LocalImageUrlCache;
};

function revokeResolvedImageUrls(view: LivePreviewViewWithHandlers | null): void {
  const urls = view?._resolvedImageUrls;
  if (!urls || urls.size() === 0) {
    return;
  }
  urls.revokeAll();
}

type DebuggableEditorDom = HTMLElement & { cmView?: EditorView };
type LivePreviewWindow = Window & { __latticeLivePreviewView?: EditorView };

function exposeEditorView(view: EditorView): void {
  const dom = view.dom as DebuggableEditorDom;
  dom.cmView = view;
  if (typeof window !== 'undefined') {
    (window as LivePreviewWindow).__latticeLivePreviewView = view;
  }
}

function clearExposedEditorView(view: EditorView): void {
  const dom = view.dom as DebuggableEditorDom;
  if (dom.cmView === view) {
    delete dom.cmView;
  }
  if (typeof window !== 'undefined') {
    const win = window as LivePreviewWindow;
    if (win.__latticeLivePreviewView === view) {
      delete win.__latticeLivePreviewView;
    }
  }
}

export interface LivePreviewEditorProps {
  /** Initial content */
  content: string;
  /** Content change callback */
  onChange: (content: string) => void;
  /** Current view mode */
  mode?: ViewMode;
  /** Mode change callback */
  onModeChange?: (mode: ViewMode) => void;
  /** Show line numbers */
  showLineNumbers?: boolean;
  /** Show fold gutter */
  showFoldGutter?: boolean;
  /** Read-only mode */
  readOnly?: boolean;
  /** Outline change callback */
  onOutlineChange?: (outline: OutlineItem[]) => void;
  /** Fires after the editor document is ready for navigation. */
  onReady?: () => void;
  /** Wiki link click callback */
  onWikiLinkClick?: (target: string) => void;
  /** Unified link navigation callback */
  onLinkNavigate?: (target: string) => void;
  /** Save callback */
  onSave?: () => void;
  /** Additional class name */
  className?: string;
  /** Auto-height mode for embedded notebook cells */
  autoHeight?: boolean;
  /** Unique file ID for memoization */
  fileId?: string;
  /** Available files for wiki link autocomplete */
  availableFiles?: string[];
  /** Custom image upload handler */
  onImageUpload?: ImageUploadHandler;
  /** Use wiki-style image embeds */
  useWikiImageStyle?: boolean;
  /** Enable high contrast mode */
  highContrast?: boolean;
  /** Workspace root handle for resolving local image paths */
  rootHandle?: FileSystemDirectoryHandle | null;
  /** File path relative to workspace root (for resolving relative image paths) */
  filePath?: string;
  /** Run callback for live preview code blocks */
  onCodeBlockRun?: (request: LivePreviewCodeBlockRunRequest) => void;
  /** Open the host Markdown image editor for an inline image widget */
  onMarkdownImageEdit?: (detail: MarkdownImageEditRequest) => void;
}

export interface MarkdownImageEditRequest {
  url: string;
  alt: string;
  width?: number;
  syntax?: "markdown" | "wiki";
  elementFrom: number;
  elementTo: number;
}

/** Ref handle for LivePreviewEditor */
export interface EditorStateSnapshot {
  cursorPosition: number;
  scrollTop: number;
  selection?: { from: number; to: number };
}

export interface LivePreviewEditorRef {
  getContent: () => string | null;
  /** Scroll to a specific line number */
  scrollToLine: (lineNumber: number) => void;
  /** Flash a specific line to confirm navigation */
  flashLine: (lineNumber: number) => void;
  flashRange: (from: number, to: number) => (() => void) | null;
  /** Focus the editor */
  focus: () => void;
  /** Get current editor state for restoration */
  getEditorState: () => EditorStateSnapshot | null;
  /** Restore editor state (cursor/selection/scroll) */
  restoreEditorState: (state: EditorStateSnapshot) => void;
  /** Reveal a code block and focus a target line inside it */
  revealCodeBlockLine: (request: LivePreviewCodeBlockRevealRequest) => void;
  /** Open the built-in search panel */
  openSearch: () => void;
  /** Run a standard Markdown editing command */
  runMarkdownCommand: (commandId: MarkdownEditingCommandId, payload?: MarkdownCommandPayload) => boolean;
  /** Get the current Markdown block or inline context */
  getMarkdownContext: () => MarkdownEditorContext | null;
  /** Move the editor cursor to a screen coordinate */
  setCursorFromPoint: (x: number, y: number) => boolean;
  /** Move the editor cursor to a document offset */
  setCursorToPosition: (position: number) => boolean;
  /** Copy the current Markdown block as source */
  copyCurrentBlockAsMarkdown: () => Promise<boolean>;
  /** Copy the current Markdown block as simple HTML */
  copyCurrentBlockAsHtml: () => Promise<boolean>;
  /** Copy the current YAML properties block */
  copyPropertiesYaml: () => Promise<boolean>;
}

/**
 * Build extensions based on mode
 */
function buildExtensions(
  mode: ViewMode,
  showLineNumbers: boolean,
  showFoldGutter: boolean,
  readOnly: boolean,
  autoHeight: boolean,
  aiInlineCompletionEnabled: boolean,
  onChange: (content: string) => void,
  onOutlineChange?: (outline: OutlineItem[]) => void,
  onSave?: () => void,
  onImageUpload?: ImageUploadHandler,
  useWikiImageStyle?: boolean,
  highContrast?: boolean
): Extension[] {
  const extensions: Extension[] = [
    // Base
    history(),
    drawSelection(),
    bracketMatching(),
    highlightSelectionMatches(),
    search({ top: true }),
    
    // Keymaps
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
      // Save shortcut
      {
        key: 'Ctrl-s',
        mac: 'Cmd-s',
        run: () => {
          onSave?.();
          return true;
        },
      },
    ]),
    
    // Theme
    livePreviewThemeExtension,
    
    // Markdown language
    markdown(),
    
    // Update listener with debounced outline updates
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const content = update.state.doc.toString();
        const isExternalUpdate = update.transactions.some(
          (tr) => tr.annotation(Transaction.userEvent) === 'external'
        );

        if (!isExternalUpdate) {
          onChange(content);
        }

        // Debounced outline update (300ms delay)
        if (onOutlineChange) {
          // Clear existing timeout
          const viewWithHandlers = update.view as LivePreviewViewWithHandlers;
          if (viewWithHandlers._outlineTimeout) {
            clearTimeout(viewWithHandlers._outlineTimeout);
          }
          // Set new timeout
          viewWithHandlers._outlineTimeout = setTimeout(() => {
            const headings = parseHeadings(content);
            const outline = buildOutlineTree(headings);
            onOutlineChange(outline);
          }, 300);
        }
      }
    }),
    
    // Line wrapping
    EditorView.lineWrapping,
  ];

  if (autoHeight) {
    extensions.push(EditorView.theme({
      "&": {
        maxHeight: "none",
      },
      ".cm-scroller": {
        overflow: "visible",
      },
    }));
  } else {
    extensions.push(EditorView.theme({
      "&": {
        height: "100%",
      },
      ".cm-scroller": {
        overflow: "auto",
      },
    }));
  }
  
  // Fold gutter FIRST (leftmost position)
  if (showFoldGutter && mode === 'live') {
    extensions.push(...foldingExtension);
  }
  
  // Line numbers AFTER fold gutter
  if (showLineNumbers) {
    extensions.push(lineNumbers());
    extensions.push(highlightActiveLineGutter());
  }
  
  // Mode-specific extensions
  if (mode === 'live') {
    extensions.push(
      parsedElementsField,      // StateField for sharing parsed elements
      cursorContextExtension,
      // Unified decoration coordinator handles all rendering
      decorationCoordinatorExtension,
      markdownKeymap,
      autoFormattingExtension,
      closeBrackets(),
      ...markdownSmartInputExtension,
      ...wikiLinkAutocomplete,
      createMathPasteExtension(),
      createPluginEditorExtensions(),
      createImageDropExtension(onImageUpload, useWikiImageStyle)
    );
  } else if (mode === 'source') {
    // Source mode: just syntax highlighting, no decorations
    extensions.push(
      closeBrackets(),
      ...markdownSmartInputExtension,
      createMathPasteExtension(),
      createImageDropExtension(onImageUpload, useWikiImageStyle)
    );
  } else if (mode === 'reading') {
    // Reading mode: full rendering, read-only
    extensions.push(
      EditorState.readOnly.of(true),
      parsedElementsField,
      // Unified decoration coordinator handles all rendering
      decorationCoordinatorExtension
    );
  }
  
  // Read-only
  if (readOnly) {
    extensions.push(EditorState.readOnly.of(true));
  }
  
  // Accessibility
  extensions.push(...createAccessibilityExtension({ highContrast }));

  // AI inline completion (ghost text) — only in edit mode, not read-only
  // AI inline completion is opt-in because it calls the configured AI provider.
  if (!readOnly && aiInlineCompletionEnabled) {
    extensions.push(aiCompletionExtension(true));
  }

  return extensions;
}

/**
 * Live Preview Editor Component
 */
const LivePreviewEditorComponent = forwardRef<LivePreviewEditorRef, LivePreviewEditorProps>(
  function LivePreviewEditorInner({
    content,
    onChange,
    mode = 'live',
    onModeChange,
    showLineNumbers = mode !== 'live', // Hide in Live Preview, show in Source/Reading
    showFoldGutter = true,
    readOnly = false,
    onOutlineChange,
    onReady,
    onWikiLinkClick,
    onLinkNavigate,
    onSave,
    className = '',
    autoHeight = false,
    fileId,
    availableFiles = [],
    onImageUpload,
    useWikiImageStyle = false,
    highContrast = false,
    rootHandle,
    filePath,
    onCodeBlockRun,
    onMarkdownImageEdit,
  }, ref) {
  const assetSource = useContext(AssetSourceContext);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const pendingEditorStateRef = useRef<EditorStateSnapshot | null>(null);
  const recentWikiLinkFilesRef = useRef<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [librariesLoaded, setLibrariesLoaded] = useState(false);
  const searchParams = useSearchParams();
  const aiEnabled = useSettingsStore((state) => state.settings.aiEnabled);
  const aiInlineCompletionEnabledSetting = useSettingsStore((state) => state.settings.aiInlineCompletionEnabled);
  const isQaMode = process.env.NODE_ENV === "development" && searchParams?.get("qa") === "1";
  const aiCompletionEnabled = aiEnabled && aiInlineCompletionEnabledSetting && !isQaMode;

  // MathEditor state
  const [mathEditor, setMathEditor] = useState<{
    latex: string;
    isBlock: boolean;
    from: number;
    to: number;
    position: { top: number; left: number };
  } | null>(null);
  
  // Store callbacks in refs
  const onChangeRef = useRef(onChange);
  const onOutlineChangeRef = useRef(onOutlineChange);
  const onReadyRef = useRef(onReady);
  const onSaveRef = useRef(onSave);
  const onMarkdownImageEditRef = useRef(onMarkdownImageEdit);
  // Store content in ref for initialization (avoids content in dependency array)
  const contentRef = useRef(content);

  useEffect(() => {
    onChangeRef.current = onChange;
    onOutlineChangeRef.current = onOutlineChange;
    onReadyRef.current = onReady;
    onSaveRef.current = onSave;
    onMarkdownImageEditRef.current = onMarkdownImageEdit;
    contentRef.current = content;
  }, [onChange, onOutlineChange, onReady, onSave, onMarkdownImageEdit, content]);

  const applyEditorState = useCallback((state: EditorStateSnapshot) => {
    const view = viewRef.current;
    if (!view) {
      pendingEditorStateRef.current = state;
      return;
    }

    const selection = state.selection ?? {
      from: state.cursorPosition,
      to: state.cursorPosition,
    };

    view.dispatch({
      selection: { anchor: selection.from, head: selection.to },
      scrollIntoView: false,
    });

    view.scrollDOM.scrollTop = state.scrollTop ?? 0;
  }, []);

  const getEditorState = useCallback((): EditorStateSnapshot | null => {
    const view = viewRef.current;
    if (!view) return null;
    const selection = view.state.selection.main;
    return {
      cursorPosition: selection.head,
      scrollTop: view.scrollDOM.scrollTop,
      selection: { from: selection.from, to: selection.to },
    };
  }, []);

  // Pre-load libraries before editor initialization
  useEffect(() => {
    Promise.all([
      import('katex'),
      import('highlight.js')
    ]).then(() => {
      setLibrariesLoaded(true);
    }).catch((err) => {
      logger.error('Failed to load libraries', { error: err instanceof Error ? err.message : String(err) });
      setLibrariesLoaded(true); // Continue anyway
    });
  }, []);
  
  // Initialize editor
  // CRITICAL: fileId is included in dependencies to force re-initialization on file switch
  useEffect(() => {
    if (!containerRef.current || !librariesLoaded) return;

    // Use contentRef to get current content without adding to dependencies
    const initialContent = contentRef.current;

    let mounted = true;
    
    async function initEditor() {
      if (!containerRef.current || !mounted) return;
      
      try {
        setIsLoading(true);
        setError(null);
        
        // Destroy existing view
        if (viewRef.current) {
          const existingView = viewRef.current;
          revokeResolvedImageUrls(existingView as LivePreviewViewWithHandlers);
          const existingHandler = (existingView as LivePreviewViewWithHandlers)._unifiedInputFocusHandler;
          if (existingHandler) {
            existingView.dom.removeEventListener('focusin', existingHandler);
          }
          const existingBlurHandler = (existingView as LivePreviewViewWithHandlers)._unifiedInputBlurHandler;
          if (existingBlurHandler) {
            existingView.dom.removeEventListener('focusout', existingBlurHandler);
          }
          const existingMathHandler = (existingView as LivePreviewViewWithHandlers)._mathEditorHandler;
          if (existingMathHandler) {
            existingView.dom.removeEventListener('open-math-editor', existingMathHandler);
          }
          const existingImageEditHandler = (existingView as LivePreviewViewWithHandlers)._markdownImageEditHandler;
          if (existingImageEditHandler) {
            existingView.dom.removeEventListener('lattice-markdown-image-edit', existingImageEditHandler);
          }
          clearExposedEditorView(existingView);
          unregisterCodeMirrorView(existingView.dom);
          existingView.destroy();
          viewRef.current = null;
        }
        
        // CRITICAL: Clear decoration cache on file switch to prevent stale data
        clearDecorationCache();

        // Clear container
        containerRef.current.innerHTML = '';
        
        // Build extensions
        const extensions = buildExtensions(
          mode,
          showLineNumbers,
          showFoldGutter,
          readOnly,
          autoHeight,
          aiCompletionEnabled,
          (c) => onChangeRef.current(c),
          onOutlineChangeRef.current,
          () => onSaveRef.current?.(),
          onImageUpload,
          useWikiImageStyle,
          highContrast
        );

        let resolvedImageUrls: LocalImageUrlCache | undefined;

        // Add image resolver facet if rootHandle is available
        if (rootHandle || assetSource) {
          const currentRootHandle = rootHandle;
          const currentFilePath = filePath;
          const urlCache = createLocalImageUrlCache();
          resolvedImageUrls = urlCache;
          const resolver = async (url: string): Promise<string | null> => {
            // Skip external URLs and data URLs
            if (!url || /^(https?:|data:|blob:)/.test(url)) return null;
            try {
              if (assetSource) {
                const cached = urlCache.get(url);
                if (cached) return cached;
                const blob = await assetSource.resolveAsset(url);
                if (!mounted || !blob) return 'about:blank';
                const objectUrl = URL.createObjectURL(blob);
                urlCache.set(url, objectUrl);
                return objectUrl;
              }
              // Resolve relative path against the current file's directory
              const resolvedPath = currentFilePath
                ? resolveImagePath(currentFilePath, url)
                : url.replace(/^\.\//, '');
              const cachedUrl = urlCache.get(resolvedPath);
              if (cachedUrl) {
                return cachedUrl;
              }
              const fileHandle = await resolveFileHandleFromRoot(currentRootHandle!, resolvedPath);
              const file = await fileHandle.getFile();
              const objectUrl = URL.createObjectURL(file);
              urlCache.set(resolvedPath, objectUrl);
              return objectUrl;
            } catch {
              return assetSource ? 'about:blank' : null;
            }
          };
          extensions.push(imageResolverFacet.of(resolver));
        }

        extensions.push(codeBlockRunContextFacet.of({ filePath }));

        // Create state with the current content
        const state = EditorState.create({
          doc: initialContent,
          extensions,
          // No explicit selection — avoids triggering revealLines on line 1 before user interaction
        });

        // Create view
        const view = new EditorView({
          state,
          parent: containerRef.current,
        });

        viewRef.current = view;
        if (resolvedImageUrls) {
          (view as LivePreviewViewWithHandlers)._resolvedImageUrls = resolvedImageUrls;
        }

        // Expose view for debugging (document.querySelector('.cm-editor')?.cmView)
        exposeEditorView(view);

        // Attach MathEditor event listener immediately after view creation
        const handleOpenMathEditor = (e: Event) => {
          const customEvent = e as CustomEvent<{
            latex: string;
            isBlock: boolean;
            from: number;
            to: number;
            position: { top: number; left: number };
          }>;
          const detail = customEvent.detail;
          // Clamp position so the overlay stays within the viewport
          const editorWidth = detail.isBlock ? 524 : 324; // approx overlay widths
          const clampedLeft = Math.min(detail.position.left, window.innerWidth - editorWidth - 16);
          const clampedTop = detail.position.top + 300 > window.innerHeight
            ? detail.position.top - 320  // flip above the formula
            : detail.position.top;
          setMathEditor({
            ...detail,
            position: {
              top: Math.max(8, clampedTop),
              left: Math.max(8, clampedLeft),
            },
          });
        };
        view.dom.addEventListener('open-math-editor', handleOpenMathEditor);

        // Store handler for cleanup
        (view as LivePreviewViewWithHandlers)._mathEditorHandler = handleOpenMathEditor;

        const handleMarkdownImageEdit = (e: Event) => {
          const customEvent = e as CustomEvent<MarkdownImageEditRequest>;
          const detail = customEvent.detail;
          if (!detail?.url || !Number.isFinite(detail.elementFrom) || !Number.isFinite(detail.elementTo)) {
            return;
          }
          onMarkdownImageEditRef.current?.(detail);
        };
        view.dom.addEventListener('lattice-markdown-image-edit', handleMarkdownImageEdit);
        (view as LivePreviewViewWithHandlers)._markdownImageEditHandler = handleMarkdownImageEdit;

        // Register unified input target for CodeMirror integration
        registerCodeMirrorView(view.dom, view);
        const focusHandler = (event: FocusEvent) => {
          const focused = event.target instanceof HTMLElement ? event.target.closest('math-field') : null;
          setActiveInputTargetFromElement(focused instanceof HTMLElement ? focused : view.dom);
          // Mark editor as focused so cursor context starts revealing syntax
          if (viewRef.current) {
            viewRef.current.dispatch({ effects: setEditorFocus.of(true) });
          }
        };
        const blurHandler = () => {
          if (viewRef.current) {
            requestAnimationFrame(() => {
              if (viewRef.current) {
                const activeElement = document.activeElement;
                if (activeElement && viewRef.current.dom.contains(activeElement)) {
                  return;
                }
                viewRef.current.dispatch({
                  effects: [
                    setEditorFocus.of(false),
                    setMathSourceMode.of(null),
                    setCodeBlockSourceMode.of(null),
                  ],
                });
              }
            });
          }
        };
        view.dom.addEventListener('focusin', focusHandler);
        view.dom.addEventListener('focusout', blurHandler);
        (view as LivePreviewViewWithHandlers)._unifiedInputFocusHandler = focusHandler;
        (view as LivePreviewViewWithHandlers)._unifiedInputBlurHandler = blurHandler;

        // Ensure editor does not steal focus on mount
        requestAnimationFrame(() => {
          if (viewRef.current) {
            viewRef.current.contentDOM.blur();
          }
        });

        // Restore pending editor state if available
        if (pendingEditorStateRef.current) {
          const pending = pendingEditorStateRef.current;
          pendingEditorStateRef.current = null;
          requestAnimationFrame(() => applyEditorState(pending));
        }

        // Add accessibility description
        if (containerRef.current) {
          addEditorDescription(containerRef.current);
        }

        // Initial outline
        if (onOutlineChangeRef.current) {
          const headings = parseHeadings(initialContent);
          const outline = buildOutlineTree(headings);
          onOutlineChangeRef.current(outline);
        }
        
        setIsLoading(false);
        onReadyRef.current?.();
      } catch (err) {
        logger.error('Failed to initialize Live Preview Editor', {
          error: err instanceof Error ? err.message : String(err),
          context: 'EditorInit'
        });
        setError(err instanceof Error ? err : new Error('Failed to initialize editor'));
        setIsLoading(false);
      }
    }
    
    initEditor();
    
    return () => {
      mounted = false;
      if (viewRef.current) {
        const existingView = viewRef.current;
        revokeResolvedImageUrls(existingView as LivePreviewViewWithHandlers);
        const existingHandler = (existingView as LivePreviewViewWithHandlers)._unifiedInputFocusHandler;
        if (existingHandler) {
          existingView.dom.removeEventListener('focusin', existingHandler);
        }
        const existingBlurHandler = (existingView as LivePreviewViewWithHandlers)._unifiedInputBlurHandler;
        if (existingBlurHandler) {
          existingView.dom.removeEventListener('focusout', existingBlurHandler);
        }
        const existingMathHandler = (existingView as LivePreviewViewWithHandlers)._mathEditorHandler;
        if (existingMathHandler) {
          existingView.dom.removeEventListener('open-math-editor', existingMathHandler);
        }
        const existingImageEditHandler = (existingView as LivePreviewViewWithHandlers)._markdownImageEditHandler;
        if (existingImageEditHandler) {
          existingView.dom.removeEventListener('lattice-markdown-image-edit', existingImageEditHandler);
        }
        clearExposedEditorView(existingView);
        unregisterCodeMirrorView(existingView.dom);
        existingView.destroy();
        viewRef.current = null;
      }
    };
  }, [librariesLoaded, mode, showLineNumbers, showFoldGutter, readOnly, autoHeight, aiCompletionEnabled, fileId, onImageUpload, useWikiImageStyle, highContrast, applyEditorState, rootHandle, filePath, assetSource]); // fileId triggers re-init on file switch, content is handled by separate useEffect

  // Update content when it changes externally (but fileId change triggers re-init above)
  useEffect(() => {
    if (!viewRef.current || isLoading) return;

    const currentContent = viewRef.current.state.doc.toString();

    // Only update if content differs and fileId hasn't changed (fileId change triggers re-init)
    if (content !== currentContent) {
      viewRef.current.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: content,
        },
        annotations: Transaction.userEvent.of('external'),
        scrollIntoView: false,
      });
    }
  }, [content, isLoading]); // Removed fileId - re-init handles that

  // Update available files for wiki link autocomplete
  useEffect(() => {
    if (!viewRef.current || availableFiles.length === 0) return;
    updateAvailableFiles(viewRef.current, availableFiles);
  }, [availableFiles]);

  useEffect(() => {
    if (!viewRef.current) return;
    if (filePath) {
      recentWikiLinkFilesRef.current = [
        filePath,
        ...recentWikiLinkFilesRef.current.filter((item) => item !== filePath),
      ].slice(0, 12);
    }
    updateWikiLinkCompletionContext(viewRef.current, {
      currentFilePath: filePath,
      recentFiles: recentWikiLinkFilesRef.current,
    });
  }, [fileId, filePath]);
  
  // Handle link clicks emitted by live preview widgets and table editor
  useEffect(() => {
    const container = containerRef.current;
    if (!container || (!onWikiLinkClick && !onLinkNavigate && !onCodeBlockRun)) return;

    const emitNavigate = (target: string) => {
      onLinkNavigate?.(target);
      if (!onLinkNavigate) {
        onWikiLinkClick?.(target);
      }
    };

    const handleWikiLinkClick = (e: Event) => {
      const customEvent = e as CustomEvent<{ target: string }>;
      emitNavigate(customEvent.detail.target);
    };

    const handleWorkspaceLinkClick = (e: Event) => {
      const customEvent = e as CustomEvent<{ target: string }>;
      emitNavigate(customEvent.detail.target);
    };

    const handleAnnotationLinkClick = (e: Event) => {
      const customEvent = e as CustomEvent<{ filePath: string; annotationId: string }>;
      emitNavigate(`${customEvent.detail.filePath}#annotation=${customEvent.detail.annotationId}`);
    };

    const handleExternalLinkClick = (e: Event) => {
      const customEvent = e as CustomEvent<{ url: string }>;
      emitNavigate(customEvent.detail.url);
    };

    const handleCodeBlockRun = (e: Event) => {
      const customEvent = e as CustomEvent<LivePreviewCodeBlockRunRequest>;
      onCodeBlockRun?.(customEvent.detail);
    };

    container.addEventListener('wiki-link-click', handleWikiLinkClick);
    container.addEventListener('workspace-link-click', handleWorkspaceLinkClick);
    container.addEventListener('annotation-link-click', handleAnnotationLinkClick);
    container.addEventListener('external-link-click', handleExternalLinkClick);
    container.addEventListener('run-code-block', handleCodeBlockRun);
    return () => {
      container.removeEventListener('wiki-link-click', handleWikiLinkClick);
      container.removeEventListener('workspace-link-click', handleWorkspaceLinkClick);
      container.removeEventListener('annotation-link-click', handleAnnotationLinkClick);
      container.removeEventListener('external-link-click', handleExternalLinkClick);
      container.removeEventListener('run-code-block', handleCodeBlockRun);
    };
  // Loading/error screens do not mount the editor container. Bind again when
  // that container first appears or is recreated after retrying a failed load.
  }, [librariesLoaded, error, onCodeBlockRun, onLinkNavigate, onWikiLinkClick]);

  // Handle MathEditor open event - REMOVED (now handled in editor init)

  // Handle MathEditor save
  const handleMathSave = useCallback((latex: string) => {
    if (!mathEditor || !viewRef.current) return;

    const normalized = normalizeFormulaInput(latex, { preferDisplay: mathEditor.isBlock });
    const displayMode = mathEditor.isBlock || normalized.displayMode;
    const newContent = wrapLatexForMarkdown(normalized.latex, displayMode);
    if (!newContent) {
      setMathEditor(null);
      return;
    }

    viewRef.current.dispatch({
      changes: {
        from: mathEditor.from,
        to: mathEditor.to,
        insert: newContent,
      },
      selection: { anchor: mathEditor.from + newContent.length },
    });

    // Close editor
    setMathEditor(null);

    // Focus back to editor
    viewRef.current.focus();
  }, [mathEditor]);

  // Handle MathEditor cancel
  const handleMathCancel = useCallback(() => {
    setMathEditor(null);
    // Focus back to editor
    if (viewRef.current) {
      viewRef.current.focus();
    }
  }, []);
  
  // Handle Ctrl+E for mode cycling
  useEffect(() => {
    if (!onModeChange) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        const modes: ViewMode[] = ['live', 'source', 'reading'];
        const currentIndex = modes.indexOf(mode);
        const nextMode = modes[(currentIndex + 1) % modes.length];
        onModeChange(nextMode);
        announceChange(`mode-${nextMode}`);
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mode, onModeChange]);
  
  // Focus method
  const focus = useCallback(() => {
    viewRef.current?.focus();
  }, []);
  
  // Scroll to line
  const scrollToLine = useCallback((lineNumber: number) => {
    if (!viewRef.current) return;
    
    try {
      const line = viewRef.current.state.doc.line(lineNumber);
      viewRef.current.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'start' }),
      });
      viewRef.current.focus();
    } catch (e) {
      console.warn('Failed to scroll to line:', lineNumber, e);
    }
  }, []);

  const flashLine = useCallback((lineNumber: number) => {
    const view = viewRef.current;
    if (!view) return;

    try {
      const safeLine = Math.max(1, Math.min(lineNumber, view.state.doc.lines));
      const line = view.state.doc.line(safeLine);
      const domAtPos = view.domAtPos(line.from);
      const lineElement =
        (domAtPos.node instanceof HTMLElement ? domAtPos.node : domAtPos.node.parentElement)?.closest('.cm-line');

      if (!(lineElement instanceof HTMLElement)) {
        return;
      }

      flashReferenceTarget(lineElement);
    } catch (e) {
      console.warn('Failed to flash line:', lineNumber, e);
    }
  }, []);

  const flashRange = useCallback((from: number, to: number) => {
    const view = viewRef.current;
    if (!view || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > view.state.doc.length || from >= to) return null;
    if (from < view.viewport.from || to > view.viewport.to) return null;
    const start = view.domAtPos(from, 1);
    const end = view.domAtPos(to, -1);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return flashReferenceRange(range);
  }, []);

  const revealCodeBlockLine = useCallback((request: LivePreviewCodeBlockRevealRequest) => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    enterCodeBlockSourceMode(view, request.range.from, request.range.to);
    const lineNumber = request.line ?? request.range.startLine;
    requestAnimationFrame(() => {
      try {
        const safeLine = Math.max(request.range.startLine, Math.min(lineNumber, request.range.endLine));
        const line = view.state.doc.line(safeLine);
        view.dispatch({
          selection: { anchor: line.from },
          effects: EditorView.scrollIntoView(line.from, { y: 'start' }),
        });
        view.focus();
      } catch {
        view.focus();
      }
    });
  }, []);

  const openSearch = useCallback(() => {
    if (!viewRef.current) return;
    openSearchPanel(viewRef.current);
    viewRef.current.focus();
  }, []);

  const runMarkdownCommand = useCallback((
    commandId: MarkdownEditingCommandId,
    payload?: MarkdownCommandPayload,
  ) => {
    const view = viewRef.current;
    if (!view) return false;
    const handled = runMarkdownEditingCommand(view, commandId, payload);
    if (handled) {
      view.focus();
    }
    return handled;
  }, []);

  const getMarkdownContext = useCallback((): MarkdownEditorContext | null => {
    const view = viewRef.current;
    return view ? getMarkdownEditorContext(view) : null;
  }, []);

  const setCursorFromPoint = useCallback((x: number, y: number) => {
    const view = viewRef.current;
    if (!view) return false;
    const position = view.posAtCoords({ x, y });
    if (position === null) return false;
    view.dispatch({
      selection: EditorSelection.cursor(position),
      scrollIntoView: false,
    });
    view.focus();
    return true;
  }, []);

  const setCursorToPosition = useCallback((position: number) => {
    const view = viewRef.current;
    if (!view || !Number.isFinite(position)) return false;
    const safePosition = Math.max(0, Math.min(view.state.doc.length, Math.trunc(position)));
    view.dispatch({
      selection: EditorSelection.cursor(safePosition),
      scrollIntoView: false,
    });
    view.focus();
    return true;
  }, []);

  const copyCurrentBlockAsMarkdown = useCallback(async () => {
    const view = viewRef.current;
    if (!view || typeof navigator === 'undefined' || !navigator.clipboard) {
      return false;
    }
    await navigator.clipboard.writeText(getCurrentMarkdownBlock(view));
    return true;
  }, []);

  const copyCurrentBlockAsHtml = useCallback(async () => {
    const view = viewRef.current;
    if (!view || typeof navigator === 'undefined' || !navigator.clipboard) {
      return false;
    }
    await navigator.clipboard.writeText(markdownBlockToHtml(getCurrentMarkdownBlock(view)));
    return true;
  }, []);

  const copyPropertiesYaml = useCallback(async () => {
    const view = viewRef.current;
    if (!view || typeof navigator === 'undefined' || !navigator.clipboard) {
      return false;
    }
    const yaml = getPropertiesYaml(view);
    if (!yaml) return false;
    await navigator.clipboard.writeText(yaml);
    return true;
  }, []);
  
  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    getContent: () => viewRef.current?.state.doc.toString() ?? null,
    scrollToLine,
    flashLine,
    flashRange,
    focus,
    getEditorState,
    restoreEditorState: applyEditorState,
    revealCodeBlockLine,
    openSearch,
    runMarkdownCommand,
    getMarkdownContext,
    setCursorFromPoint,
    setCursorToPosition,
    copyCurrentBlockAsMarkdown,
    copyCurrentBlockAsHtml,
    copyPropertiesYaml,
  }), [
    scrollToLine,
    flashLine,
    flashRange,
    focus,
    getEditorState,
    applyEditorState,
    revealCodeBlockLine,
    openSearch,
    runMarkdownCommand,
    getMarkdownContext,
    setCursorFromPoint,
    setCursorToPosition,
    copyCurrentBlockAsMarkdown,
    copyCurrentBlockAsHtml,
    copyPropertiesYaml,
  ]);

  if (!librariesLoaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading editor...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`p-4 text-destructive bg-destructive/10 rounded ${className}`}>
        <p className="font-medium">Failed to load editor</p>
        <pre className="text-xs mt-2 overflow-auto">{error.message}</pre>
        <button
          onClick={() => { setError(null); setIsLoading(true); }}
          className="mt-3 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }
  
  return (
    <>
      <div
        ref={containerRef}
        className={`live-preview-editor ${autoHeight ? "" : "h-full"} ${className}`}
        data-mode={mode}
        data-loading={isLoading}
      />

      {/* MathEditor overlay */}
      {mathEditor && (
        <MathEditor
          initialLatex={mathEditor.latex}
          isBlock={mathEditor.isBlock}
          onSave={handleMathSave}
          onCancel={handleMathCancel}
          position={mathEditor.position}
        />
      )}
    </>
  );
});

/**
 * Memoized Live Preview Editor
 * Only re-render when critical props change
 */
export const LivePreviewEditor = memo(LivePreviewEditorComponent, (prev, next) => {
  // The content Effect cannot receive a new document when memo skips this
  // render. Keep contentRef current before Activity recreates the editor.
  if (prev.content !== next.content) return false;
  // Always re-render if fileId changes (file switch)
  if (prev.fileId !== next.fileId) return false;
  // Re-render if mode changes
  if (prev.mode !== next.mode) return false;
  // Re-render if display options change
  if (prev.showLineNumbers !== next.showLineNumbers) return false;
  if (prev.showFoldGutter !== next.showFoldGutter) return false;
  if (prev.readOnly !== next.readOnly) return false;
  if (prev.autoHeight !== next.autoHeight) return false;
  if (prev.className !== next.className) return false;
  if (prev.highContrast !== next.highContrast) return false;
  if (prev.onCodeBlockRun !== next.onCodeBlockRun) return false;
  return true;
});

LivePreviewEditor.displayName = 'LivePreviewEditor';

export default LivePreviewEditor;
