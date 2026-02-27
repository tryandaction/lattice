"use client";

/**
 * Live Preview Editor Component
 * Obsidian-style markdown editor with cursor-based syntax reveal
 * 
 * Requirements: All from spec
 */

import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import { useEffect, useRef, useState, useCallback, memo, forwardRef, useImperativeHandle } from 'react';
import { Loader2 } from 'lucide-react';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { EditorState, Extension, Transaction, Facet } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { bracketMatching } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';

import { cursorContextExtension, setEditorFocus } from './cursor-context-plugin';
import { decorationCoordinatorExtension, parsedElementsField, clearDecorationCache } from './decoration-coordinator';
import { foldingExtension } from './folding-plugin';
import { markdownKeymap } from './keyboard-shortcuts';
import { autoFormattingExtension } from './auto-formatting';
import { livePreviewThemeExtension } from './live-preview-theme';
import { wikiLinkAutocomplete, updateAvailableFiles } from './wiki-link-autocomplete';
import { createImageDropExtension, ImageUploadHandler } from './image-drop-plugin';
import { createMathPasteExtension } from './math-paste-plugin';
import { createAccessibilityExtension, addEditorDescription, announceChange } from './accessibility';
import type { ViewMode, OutlineItem } from './types';
import { parseHeadings, buildOutlineTree } from './markdown-parser';
import { aiCompletionExtension } from './ai-completion-plugin';
import { MathEditor } from '../../math-editor';
import { registerCodeMirrorView, unregisterCodeMirrorView, setActiveInputTargetFromElement } from '@/lib/unified-input-handler';
import { normalizeFormulaInput, wrapLatexForMarkdown } from '@/lib/formula-utils';
import { useSearchParams } from 'next/navigation';
import { useSettingsStore } from '@/stores/settings-store';
import { imageResolverFacet } from './image-resolver-facet';

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
  _unifiedInputFocusHandler?: () => void;
  _unifiedInputBlurHandler?: () => void;
};

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
  /** Wiki link click callback */
  onWikiLinkClick?: (target: string) => void;
  /** Save callback */
  onSave?: () => void;
  /** Additional class name */
  className?: string;
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
}

/** Ref handle for LivePreviewEditor */
export interface EditorStateSnapshot {
  cursorPosition: number;
  scrollTop: number;
  selection?: { from: number; to: number };
}

export interface LivePreviewEditorRef {
  /** Scroll to a specific line number */
  scrollToLine: (lineNumber: number) => void;
  /** Focus the editor */
  focus: () => void;
  /** Get current editor state for restoration */
  getEditorState: () => EditorStateSnapshot | null;
  /** Restore editor state (cursor/selection/scroll) */
  restoreEditorState: (state: EditorStateSnapshot) => void;
}

/**
 * Build extensions based on mode
 */
function buildExtensions(
  mode: ViewMode,
  showLineNumbers: boolean,
  showFoldGutter: boolean,
  readOnly: boolean,
  aiEnabled: boolean,
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
      ...wikiLinkAutocomplete,
      createMathPasteExtension(),
      createImageDropExtension(onImageUpload, useWikiImageStyle)
    );
  } else if (mode === 'source') {
    // Source mode: just syntax highlighting, no decorations
    extensions.push(
      closeBrackets(),
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
  if (!readOnly && aiEnabled) {
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
    onWikiLinkClick,
    onSave,
    className = '',
    fileId,
    availableFiles = [],
    onImageUpload,
    useWikiImageStyle = false,
    highContrast = false,
    rootHandle,
    filePath,
  }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const pendingEditorStateRef = useRef<EditorStateSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [librariesLoaded, setLibrariesLoaded] = useState(false);
  const searchParams = useSearchParams();
  const aiEnabled = useSettingsStore((state) => state.settings.aiEnabled);
  const isQaMode = process.env.NODE_ENV === "development" && searchParams?.get("qa") === "1";
  const aiCompletionEnabled = aiEnabled && !isQaMode;

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
  const onSaveRef = useRef(onSave);
  // Store content in ref for initialization (avoids content in dependency array)
  const contentRef = useRef(content);

  useEffect(() => {
    onChangeRef.current = onChange;
    onOutlineChangeRef.current = onOutlineChange;
    onSaveRef.current = onSave;
    contentRef.current = content;
  }, [onChange, onOutlineChange, onSave, content]);

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
      console.error('Failed to load libraries:', err);
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
          const existingHandler = (existingView as LivePreviewViewWithHandlers)._unifiedInputFocusHandler;
          if (existingHandler) {
            existingView.dom.removeEventListener('focusin', existingHandler);
          }
          const existingBlurHandler = (existingView as LivePreviewViewWithHandlers)._unifiedInputBlurHandler;
          if (existingBlurHandler) {
            existingView.dom.removeEventListener('focusout', existingBlurHandler);
          }
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
          aiCompletionEnabled,
          (c) => onChangeRef.current(c),
          onOutlineChangeRef.current,
          () => onSaveRef.current?.(),
          onImageUpload,
          useWikiImageStyle,
          highContrast
        );

        // Add image resolver facet if rootHandle is available
        if (rootHandle) {
          const currentRootHandle = rootHandle;
          const currentFilePath = filePath;
          const resolver = async (url: string): Promise<string | null> => {
            // Skip external URLs and data URLs
            if (!url || /^(https?:|data:|blob:)/.test(url)) return null;
            try {
              // Resolve relative path against the current file's directory
              const resolvedPath = currentFilePath
                ? resolveImagePath(currentFilePath, url)
                : url.replace(/^\.\//, '');
              const fileHandle = await resolveFileHandleFromRoot(currentRootHandle, resolvedPath);
              const file = await fileHandle.getFile();
              return URL.createObjectURL(file);
            } catch {
              return null;
            }
          };
          extensions.push(imageResolverFacet.of(resolver));
        }

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

        // Register unified input target for CodeMirror integration
        registerCodeMirrorView(view.dom, view);
        const focusHandler = () => {
          setActiveInputTargetFromElement(view.dom);
          // Mark editor as focused so cursor context starts revealing syntax
          if (viewRef.current) {
            viewRef.current.dispatch({ effects: setEditorFocus.of(true) });
          }
        };
        const blurHandler = () => {
          if (viewRef.current) {
            viewRef.current.dispatch({ effects: setEditorFocus.of(false) });
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
      } catch (err) {
        console.error('[EditorInit] Failed to initialize Live Preview Editor:', err);
        setError(err instanceof Error ? err : new Error('Failed to initialize editor'));
        setIsLoading(false);
      }
    }
    
    initEditor();
    
    return () => {
      mounted = false;
      if (viewRef.current) {
        const existingView = viewRef.current;
        const existingHandler = (existingView as LivePreviewViewWithHandlers)._unifiedInputFocusHandler;
        if (existingHandler) {
          existingView.dom.removeEventListener('focusin', existingHandler);
        }
        const existingBlurHandler = (existingView as LivePreviewViewWithHandlers)._unifiedInputBlurHandler;
        if (existingBlurHandler) {
          existingView.dom.removeEventListener('focusout', existingBlurHandler);
        }
        unregisterCodeMirrorView(existingView.dom);
        existingView.destroy();
        viewRef.current = null;
      }
    };
  }, [librariesLoaded, mode, showLineNumbers, showFoldGutter, readOnly, aiCompletionEnabled, fileId, onImageUpload, useWikiImageStyle, highContrast, applyEditorState, rootHandle, filePath]); // fileId triggers re-init on file switch, content is handled by separate useEffect

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
  
  // Handle wiki link clicks
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onWikiLinkClick) return;
    
    const handleWikiLinkClick = (e: Event) => {
      const customEvent = e as CustomEvent<{ target: string }>;
      onWikiLinkClick(customEvent.detail.target);
    };
    
    container.addEventListener('wiki-link-click', handleWikiLinkClick);
    return () => {
      container.removeEventListener('wiki-link-click', handleWikiLinkClick);
    };
  }, [onWikiLinkClick]);

  // Handle MathEditor open event
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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

    container.addEventListener('open-math-editor', handleOpenMathEditor);
    return () => {
      container.removeEventListener('open-math-editor', handleOpenMathEditor);
    };
  }, []);

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
  
  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    scrollToLine,
    focus,
    getEditorState,
    restoreEditorState: applyEditorState,
  }), [scrollToLine, focus, getEditorState, applyEditorState]);

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
        className={`live-preview-editor h-full ${className}`}
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
  // Always re-render if fileId changes (file switch)
  if (prev.fileId !== next.fileId) return false;
  // Re-render if mode changes
  if (prev.mode !== next.mode) return false;
  // Re-render if display options change
  if (prev.showLineNumbers !== next.showLineNumbers) return false;
  if (prev.showFoldGutter !== next.showFoldGutter) return false;
  if (prev.readOnly !== next.readOnly) return false;
  if (prev.className !== next.className) return false;
  if (prev.highContrast !== next.highContrast) return false;
  // Content changes are handled by the useEffect, so we can skip re-render
  // But we need to ensure the content prop is passed through
  return true;
});

LivePreviewEditor.displayName = 'LivePreviewEditor';

export default LivePreviewEditor;
