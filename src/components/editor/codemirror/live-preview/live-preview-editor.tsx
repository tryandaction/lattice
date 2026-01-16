"use client";

/**
 * Live Preview Editor Component
 * Obsidian-style markdown editor with cursor-based syntax reveal
 * 
 * Requirements: All from spec
 */

import { useEffect, useRef, useState, useCallback, memo } from 'react';
import { Loader2 } from 'lucide-react';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { EditorState, Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { bracketMatching } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';

import { cursorContextExtension } from './cursor-context-plugin';
import { inlineDecorationPlugin } from './inline-decoration-plugin';
import { blockDecorationPlugin } from './block-decoration-plugin';
import { advancedBlockPlugin } from './advanced-block-plugin';
import { mathPlugin } from './math-plugin';
import { codeBlockPlugin } from './code-block-plugin';
import { tablePlugin } from './table-plugin';
import { foldingExtension } from './folding-plugin';
import { markdownKeymap } from './keyboard-shortcuts';
import { autoFormattingExtension } from './auto-formatting';
import { livePreviewThemeExtension } from './live-preview-theme';
import { wikiLinkAutocomplete, updateAvailableFiles } from './wiki-link-autocomplete';
import { createImageDropExtension, ImageUploadHandler } from './image-drop-plugin';
import { createAccessibilityExtension, addEditorDescription, announceChange } from './accessibility';
import type { ViewMode, OutlineItem } from './types';
import { parseHeadings, buildOutlineTree } from './markdown-parser';

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
}

/**
 * Build extensions based on mode
 */
function buildExtensions(
  mode: ViewMode,
  showLineNumbers: boolean,
  showFoldGutter: boolean,
  readOnly: boolean,
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
    
    // Update listener
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const content = update.state.doc.toString();
        onChange(content);
        
        // Update outline
        if (onOutlineChange) {
          const headings = parseHeadings(content);
          const outline = buildOutlineTree(headings);
          onOutlineChange(outline);
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
      cursorContextExtension,
      inlineDecorationPlugin,
      blockDecorationPlugin,
      advancedBlockPlugin,
      mathPlugin,
      codeBlockPlugin,
      tablePlugin,
      markdownKeymap,
      autoFormattingExtension,
      closeBrackets(),
      ...wikiLinkAutocomplete,
      createImageDropExtension(onImageUpload, useWikiImageStyle)
    );
  } else if (mode === 'source') {
    // Source mode: just syntax highlighting, no decorations
    extensions.push(
      closeBrackets(),
      createImageDropExtension(onImageUpload, useWikiImageStyle)
    );
  } else if (mode === 'reading') {
    // Reading mode: full rendering, read-only
    // Don't include cursorContextExtension - we want everything rendered
    extensions.push(
      EditorState.readOnly.of(true),
      inlineDecorationPlugin,
      blockDecorationPlugin,
      advancedBlockPlugin,
      mathPlugin,
      codeBlockPlugin,
      tablePlugin
    );
  }
  
  // Read-only
  if (readOnly) {
    extensions.push(EditorState.readOnly.of(true));
  }
  
  // Accessibility
  extensions.push(...createAccessibilityExtension({ highContrast }));
  
  return extensions;
}

/**
 * Live Preview Editor Component
 */
function LivePreviewEditorComponent({
  content,
  onChange,
  mode = 'live',
  onModeChange,
  showLineNumbers = true,
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
}: LivePreviewEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [librariesLoaded, setLibrariesLoaded] = useState(false);
  
  // Store callbacks in refs
  const onChangeRef = useRef(onChange);
  const onOutlineChangeRef = useRef(onOutlineChange);
  const onSaveRef = useRef(onSave);
  
  useEffect(() => {
    onChangeRef.current = onChange;
    onOutlineChangeRef.current = onOutlineChange;
    onSaveRef.current = onSave;
  }, [onChange, onOutlineChange, onSave]);

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
  useEffect(() => {
    if (!containerRef.current || !librariesLoaded) return;
    
    let mounted = true;
    
    async function initEditor() {
      if (!containerRef.current || !mounted) return;
      
      try {
        setIsLoading(true);
        setError(null);
        
        // Destroy existing view
        if (viewRef.current) {
          viewRef.current.destroy();
          viewRef.current = null;
        }
        
        // Clear container
        containerRef.current.innerHTML = '';
        
        // Build extensions
        const extensions = buildExtensions(
          mode,
          showLineNumbers,
          showFoldGutter,
          readOnly,
          (c) => onChangeRef.current(c),
          onOutlineChangeRef.current,
          () => onSaveRef.current?.(),
          onImageUpload,
          useWikiImageStyle,
          highContrast
        );
        
        // Create state
        const state = EditorState.create({
          doc: content,
          extensions,
        });
        
        // Create view
        const view = new EditorView({
          state,
          parent: containerRef.current,
        });
        
        viewRef.current = view;
        
        // Add accessibility description
        if (containerRef.current) {
          addEditorDescription(containerRef.current);
        }
        
        // Initial outline
        if (onOutlineChangeRef.current) {
          const headings = parseHeadings(content);
          const outline = buildOutlineTree(headings);
          onOutlineChangeRef.current(outline);
        }
        
        setIsLoading(false);
      } catch (err) {
        console.error('Failed to initialize Live Preview Editor:', err);
        setError(err instanceof Error ? err : new Error('Failed to initialize editor'));
        setIsLoading(false);
      }
    }
    
    initEditor();
    
    return () => {
      mounted = false;
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [librariesLoaded, mode, showLineNumbers, showFoldGutter, readOnly, fileId]);
  
  // Update content when it changes externally
  useEffect(() => {
    if (!viewRef.current) return;
    
    const currentContent = viewRef.current.state.doc.toString();
    if (content !== currentContent) {
      viewRef.current.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: content,
        },
      });
    }
  }, [content]);
  
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
    
    const line = viewRef.current.state.doc.line(lineNumber);
    viewRef.current.dispatch({
      effects: EditorView.scrollIntoView(line.from, { y: 'start' }),
    });
  }, []);

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
      </div>
    );
  }
  
  return (
    <div
      ref={containerRef}
      className={`live-preview-editor h-full ${className}`}
      data-mode={mode}
      data-loading={isLoading}
    />
  );
}

/**
 * Memoized Live Preview Editor
 */
export const LivePreviewEditor = memo(LivePreviewEditorComponent, (prev, next) => {
  if (prev.fileId !== next.fileId) return false;
  if (prev.mode !== next.mode) return false;
  if (prev.showLineNumbers !== next.showLineNumbers) return false;
  if (prev.showFoldGutter !== next.showFoldGutter) return false;
  if (prev.readOnly !== next.readOnly) return false;
  if (prev.className !== next.className) return false;
  return true;
});

LivePreviewEditor.displayName = 'LivePreviewEditor';

export default LivePreviewEditor;
