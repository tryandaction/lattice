"use client";

/**
 * CodeEditor Component
 * 
 * A reusable, high-performance code editor component built on CodeMirror 6.
 * Supports multiple languages, custom theming, and both file editing and
 * Jupyter notebook cell editing modes.
 * 
 * Requirements: 1.1-1.7, 2.1-2.9, 5.2-5.5, 6.1-6.2, 7.1-7.3
 */

import { useEffect, useRef, useState, useCallback, memo } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from "@codemirror/view";
import { EditorState, Extension } from "@codemirror/state";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { academicThemeExtension } from "./academic-theme";

/**
 * Supported programming languages
 */
export type CodeEditorLanguage = 
  | "python" 
  | "markdown" 
  | "latex" 
  | "json" 
  | "javascript" 
  | "typescript";

/**
 * Ref handle for CodeEditor component
 */
export interface CodeEditorRef {
  /** Focus the editor */
  focus: () => void;
  /** Get current content */
  getContent: () => string;
  /** Get selected text (empty string if no selection) */
  getSelection: () => string;
  /** Check if there's a selection */
  hasSelection: () => boolean;
}

/**
 * Props for the CodeEditor component
 */
export interface CodeEditorProps {
  /** Initial content for the editor */
  initialValue: string;
  
  /** Programming language for syntax highlighting */
  language: CodeEditorLanguage;
  
  /** Callback fired when content changes */
  onChange: (value: string) => void;
  
  /** Whether the editor is read-only */
  isReadOnly?: boolean;
  
  /** Whether to use auto-height mode (for cells) vs fixed height (for files) */
  autoHeight?: boolean;
  
  /** Optional className for container styling */
  className?: string;
  
  /** Unique identifier for memoization */
  fileId?: string;
  
  /** Keyboard event handlers for cell navigation */
  onNavigateUp?: () => void;
  onNavigateDown?: () => void;
  onEscape?: () => void;
  
  /** Ref for accessing editor methods */
  editorRef?: React.RefObject<CodeEditorRef | null>;
}

/**
 * Load language extension dynamically
 * Falls back to empty extension on failure (plain text mode)
 * 
 * Requirements: 2.5, 2.6, 2.7, 2.8, 2.9, 7.2
 */
async function loadLanguageExtension(language: CodeEditorLanguage): Promise<Extension> {
  try {
    switch (language) {
      case "python": {
        const { python } = await import("@codemirror/lang-python");
        return python();
      }
      case "markdown": {
        const { markdown } = await import("@codemirror/lang-markdown");
        return markdown();
      }
      case "javascript": {
        const { javascript } = await import("@codemirror/lang-javascript");
        return javascript();
      }
      case "typescript": {
        const { javascript } = await import("@codemirror/lang-javascript");
        return javascript({ typescript: true });
      }
      case "json": {
        const { json } = await import("@codemirror/lang-json");
        return json();
      }
      case "latex": {
        // LaTeX uses legacy mode
        const { StreamLanguage } = await import("@codemirror/language");
        const { stex } = await import("@codemirror/legacy-modes/mode/stex");
        return StreamLanguage.define(stex);
      }
      default:
        return [];
    }
  } catch (err) {
    console.warn(`Failed to load language extension for ${language}:`, err);
    return []; // Fallback to plain text
  }
}

/**
 * CodeEditor Component
 * 
 * A unified code editor for both file editing and Jupyter notebook cells.
 * Uses CodeMirror 6 with custom Academic theme.
 */
function CodeEditorComponent({
  initialValue,
  language,
  onChange,
  isReadOnly = false,
  autoHeight = false,
  className = "",
  onNavigateUp,
  onNavigateDown,
  onEscape,
  editorRef,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // Store callbacks in refs to avoid recreating editor
  const onChangeRef = useRef(onChange);
  const onNavigateUpRef = useRef(onNavigateUp);
  const onNavigateDownRef = useRef(onNavigateDown);
  const onEscapeRef = useRef(onEscape);
  
  // Update refs when callbacks change
  useEffect(() => {
    onChangeRef.current = onChange;
    onNavigateUpRef.current = onNavigateUp;
    onNavigateDownRef.current = onNavigateDown;
    onEscapeRef.current = onEscape;
  }, [onChange, onNavigateUp, onNavigateDown, onEscape]);

  // Initialize CodeMirror
  useEffect(() => {
    if (!containerRef.current) return;
    
    let mounted = true;
    
    async function initEditor() {
      if (!containerRef.current || !mounted) return;
      
      try {
        setIsLoading(true);
        setError(null);
        
        // Load language extension
        const langExtension = await loadLanguageExtension(language);
        
        if (!mounted || !containerRef.current) return;
        
        // Destroy existing view if any
        if (viewRef.current) {
          viewRef.current.destroy();
          viewRef.current = null;
        }
        
        // Clear container
        containerRef.current.innerHTML = "";
        
        // Create update listener for onChange
        const updateListener = EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        });
        
        // Create keyboard navigation handlers
        const navigationKeymap = keymap.of([
          {
            key: "Escape",
            run: () => {
              if (onEscapeRef.current) {
                onEscapeRef.current();
                return true;
              }
              return false;
            },
          },
          {
            key: "ArrowUp",
            run: (view) => {
              if (onNavigateUpRef.current) {
                const pos = view.state.selection.main.head;
                const line = view.state.doc.lineAt(pos);
                if (line.number === 1) {
                  onNavigateUpRef.current();
                  return true;
                }
              }
              return false;
            },
          },
          {
            key: "ArrowDown",
            run: (view) => {
              if (onNavigateDownRef.current) {
                const pos = view.state.selection.main.head;
                const line = view.state.doc.lineAt(pos);
                if (line.number === view.state.doc.lines) {
                  onNavigateDownRef.current();
                  return true;
                }
              }
              return false;
            },
          },
        ]);
        
        // Build extensions array
        const extensions: Extension[] = [
          // Core extensions
          lineNumbers(),
          highlightActiveLineGutter(),
          bracketMatching(),
          closeBrackets(),
          
          // Keymaps
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            indentWithTab,
          ]),
          navigationKeymap,
          
          // Theme
          academicThemeExtension,
          
          // Language
          langExtension,
          
          // Update listener
          updateListener,
        ];
        
        // Add auto-height or scrollable mode
        if (autoHeight) {
          extensions.push(EditorView.lineWrapping);
          // Auto-height: no fixed height, grows with content
          extensions.push(EditorView.theme({
            "&": {
              maxHeight: "none",
            },
            ".cm-scroller": {
              overflow: "visible",
            },
          }));
        } else {
          // Scrollable mode for file editing
          extensions.push(EditorView.lineWrapping);
          extensions.push(EditorView.theme({
            "&": {
              height: "100%",
            },
            ".cm-scroller": {
              overflow: "auto",
            },
          }));
        }
        
        // Add read-only mode
        if (isReadOnly) {
          extensions.push(EditorState.readOnly.of(true));
        }
        
        // Create editor state
        const state = EditorState.create({
          doc: initialValue,
          extensions,
        });
        
        // Create editor view
        const view = new EditorView({
          state,
          parent: containerRef.current,
        });
        
        viewRef.current = view;
        setIsLoading(false);
        
      } catch (err) {
        console.error("Failed to initialize CodeMirror:", err);
        setError(err instanceof Error ? err : new Error("Failed to initialize editor"));
        setIsLoading(false);
      }
    }
    
    initEditor();
    
    // Cleanup on unmount
    return () => {
      mounted = false;
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [language, isReadOnly, autoHeight, initialValue]);

  // Focus the editor
  const focus = useCallback(() => {
    viewRef.current?.focus();
  }, []);

  // Get current content
  const getContent = useCallback(() => {
    return viewRef.current?.state.doc.toString() ?? initialValue;
  }, [initialValue]);

  // Get selected text
  const getSelection = useCallback(() => {
    if (!viewRef.current) return "";
    const state = viewRef.current.state;
    const selection = state.selection.main;
    if (selection.empty) return "";
    return state.sliceDoc(selection.from, selection.to);
  }, []);

  // Check if there's a selection
  const hasSelection = useCallback(() => {
    if (!viewRef.current) return false;
    return !viewRef.current.state.selection.main.empty;
  }, []);

  // Expose methods via ref
  useEffect(() => {
    if (editorRef && 'current' in editorRef) {
      editorRef.current = {
        focus,
        getContent,
        getSelection,
        hasSelection,
      };
    }
    return () => {
      if (editorRef && 'current' in editorRef) {
        editorRef.current = null;
      }
    };
  }, [editorRef, focus, getContent, getSelection, hasSelection]);

  // Error state
  if (error) {
    return (
      <div className={`p-4 text-destructive bg-destructive/10 rounded ${className}`}>
        <p className="font-medium">Failed to load code editor</p>
        <pre className="text-xs mt-2 overflow-auto">{error.message}</pre>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className={`code-editor ${autoHeight ? "code-editor-auto-height" : "code-editor-scrollable"} ${className}`}
      style={autoHeight ? {} : { height: "100%" }}
      data-loading={isLoading}
    />
  );
}

/**
 * Memoized CodeEditor component
 * Only re-renders when key props change
 * 
 * Requirements: 1.7, 6.1, 6.2
 */
export const CodeEditor = memo(CodeEditorComponent, (prevProps, nextProps) => {
  // Re-render if fileId changes (different file)
  if (prevProps.fileId !== nextProps.fileId) return false;
  
  // Re-render if language changes
  if (prevProps.language !== nextProps.language) return false;
  
  // Re-render if read-only mode changes
  if (prevProps.isReadOnly !== nextProps.isReadOnly) return false;
  
  // Re-render if auto-height mode changes
  if (prevProps.autoHeight !== nextProps.autoHeight) return false;
  
  // Re-render if className changes
  if (prevProps.className !== nextProps.className) return false;
  
  // Don't re-render for onChange, navigation callbacks, or initialValue changes
  // (these are handled via refs or internal state)
  return true;
});

CodeEditor.displayName = "CodeEditor";

export default CodeEditor;
