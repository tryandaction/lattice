"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Image } from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extension-placeholder";
import { useEffect, useRef, useMemo, useCallback } from "react";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Code,
  Quote,
  Undo,
  Redo,
  Table as TableIcon,
  Sigma,
  ImageIcon,
  Keyboard,
  Calculator,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SlashCommands } from "./extensions/slash-commands";
import { TableInputRule } from "./extensions/table-input-rule";
import { TableToolbar } from "./table-toolbar";
import { InlineMath, BlockMath } from "./extensions/math-extension";
import { InlineMathLive, BlockMathLive } from "./extensions/mathlive-node";
import { LatexPasteHandler } from "./extensions/latex-paste-handler";
import { MarkdownPasteHandler } from "./extensions/markdown-paste-handler";
import { ImagePasteHandler } from "./extensions/image-paste-handler";
import { CodeBlockHighlight } from "./extensions/code-block-highlight";
import { normalizeScientificText } from "@/lib/content-normalizer";
import { registerTiptapEditor } from "@/components/hud/hud-provider";
import { useHUDStore } from "@/stores/hud-store";

/**
 * Props for AdvancedMarkdownEditor
 */
export interface AdvancedMarkdownEditorProps {
  content: string;
  onChange: (content: string) => void;
  fileName?: string;
  onSave?: () => void;
  /** Callback to get the workspace directory handle for image paste */
  getWorkspaceHandle?: () => Promise<FileSystemDirectoryHandle | null>;
  /** Whether to use MathLive for math editing (default: false, uses KaTeX) */
  useMathLive?: boolean;
}

/**
 * Toolbar button component
 */
function ToolbarButton({
  onClick,
  isActive,
  disabled,
  children,
  title,
}: {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      title={title}
      type="button"
      className={cn(
        "p-1.5 rounded hover:bg-muted transition-colors",
        isActive && "bg-muted text-foreground",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {children}
    </button>
  );
}


/**
 * Editor toolbar component
 */
function EditorToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  const openHUD = useHUDStore((state) => state.openHUD);
  const isHUDOpen = useHUDStore((state) => state.isOpen);
  
  if (!editor) return null;

  const handleOpenQuantumKeyboard = () => {
    // Create a new MathLive node and open the quantum keyboard
    const schema = editor.schema;
    const hasInlineMathLive = schema.nodes.inlineMathLive !== undefined;
    
    if (hasInlineMathLive) {
      editor.chain().focus().insertContent({
        type: 'inlineMathLive',
        attrs: { latex: '' },
      }).run();
      
      // Wait for MathLive to mount, then open HUD
      setTimeout(() => {
        openHUD('toolbar-mathfield');
      }, 150);
    }
  };

  const handleToggleMathLiveKeyboard = () => {
    // Toggle MathLive's built-in virtual keyboard
    // First, find the focused math field or create one
    const mathField = document.querySelector('math-field:focus') as any;
    
    if (mathField) {
      // Toggle the virtual keyboard
      mathField.executeCommand('toggleVirtualKeyboard');
    } else {
      // Create a new MathLive node first, then show keyboard
      const schema = editor.schema;
      const hasInlineMathLive = schema.nodes.inlineMathLive !== undefined;
      
      if (hasInlineMathLive) {
        editor.chain().focus().insertContent({
          type: 'inlineMathLive',
          attrs: { latex: '' },
        }).run();
        
        // Wait for MathLive to mount, then show keyboard
        setTimeout(() => {
          const newMathField = document.querySelector('math-field') as any;
          if (newMathField) {
            newMathField.focus();
            newMathField.executeCommand('toggleVirtualKeyboard');
          }
        }, 150);
      }
    }
  };

  return (
    <div className="flex items-center gap-0.5 border-b border-border px-3 py-1.5 bg-muted/30 flex-wrap">
      {/* Undo/Redo */}
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Undo (Ctrl+Z)"
      >
        <Undo className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Redo (Ctrl+Y)"
      >
        <Redo className="h-4 w-4" />
      </ToolbarButton>

      <div className="w-px h-4 bg-border mx-1.5" />

      {/* Text formatting */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive("bold")}
        title="Bold (Ctrl+B)"
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive("italic")}
        title="Italic (Ctrl+I)"
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>

      <div className="w-px h-4 bg-border mx-1.5" />

      {/* Headings */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={editor.isActive("heading", { level: 1 })}
        title="Heading 1"
      >
        <Heading1 className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive("heading", { level: 2 })}
        title="Heading 2"
      >
        <Heading2 className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={editor.isActive("heading", { level: 3 })}
        title="Heading 3"
      >
        <Heading3 className="h-4 w-4" />
      </ToolbarButton>

      <div className="w-px h-4 bg-border mx-1.5" />

      {/* Lists */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive("bulletList")}
        title="Bullet List"
      >
        <List className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive("orderedList")}
        title="Numbered List"
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>

      <div className="w-px h-4 bg-border mx-1.5" />

      {/* Code & Quote */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        isActive={editor.isActive("codeBlock")}
        title="Code Block"
      >
        <Code className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive("blockquote")}
        title="Quote"
      >
        <Quote className="h-4 w-4" />
      </ToolbarButton>

      <div className="w-px h-4 bg-border mx-1.5" />

      {/* Table */}
      <ToolbarButton
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
        title="Insert Table"
      >
        <TableIcon className="h-4 w-4" />
      </ToolbarButton>

      {/* Math */}
      <ToolbarButton
        onClick={() => {
          // Detect which math node types are available
          const schema = editor.schema;
          const inlineType = schema.nodes.inlineMathLive ? "inlineMathLive" : "inlineMath";
          editor.chain().focus().insertContent({
            type: inlineType,
            attrs: { latex: "" },
          }).run();
        }}
        title="Insert Inline Math ($...$)"
      >
        <Sigma className="h-4 w-4" />
      </ToolbarButton>
      
      <ToolbarButton
        onClick={() => {
          // Detect which math node types are available
          const schema = editor.schema;
          const blockType = schema.nodes.blockMathLive ? "blockMathLive" : "blockMath";
          editor.chain().focus().insertContent({
            type: blockType,
            attrs: { latex: "" },
          }).run();
        }}
        title="Insert Block Math ($$...$$)"
      >
        <span className="text-xs font-bold">∑</span>
      </ToolbarButton>

      {/* Quantum Keyboard */}
      <ToolbarButton
        onClick={handleOpenQuantumKeyboard}
        isActive={isHUDOpen}
        title="量子键盘 (双击Tab)"
      >
        <Keyboard className="h-4 w-4" />
      </ToolbarButton>

      {/* MathLive Virtual Keyboard */}
      <ToolbarButton
        onClick={handleToggleMathLiveKeyboard}
        title="数学键盘 (MathLive)"
      >
        <Calculator className="h-4 w-4" />
      </ToolbarButton>

      {/* Image paste hint */}
      <div className="w-px h-4 bg-border mx-1.5" />
      <span className="text-xs text-muted-foreground px-1 flex items-center" title="Paste images with Ctrl+V">
        <ImageIcon className="h-3.5 w-3.5 opacity-50" />
      </span>
    </div>
  );
}


/**
 * Advanced Markdown Editor Component
 *
 * A rich text editor for Markdown files using Tiptap with:
 * - Slash commands for quick formatting
 * - Table support
 * - Math rendering (via KaTeX or MathLive)
 * - Image paste support
 */
export function AdvancedMarkdownEditor({
  content,
  onChange,
  fileName,
  onSave,
  getWorkspaceHandle,
  useMathLive = false,
}: AdvancedMarkdownEditorProps) {
  // Track the last content we set to the editor to avoid unnecessary updates
  const lastSetContentRef = useRef<string | null>(null);
  // Track if we're in the middle of an internal update (to avoid feedback loops)
  const isInternalUpdateRef = useRef(false);
  // Track the current file name to detect file switches
  const currentFileNameRef = useRef(fileName);

  // Normalize content for consistent rendering
  const normalizedContent = useMemo(() => {
    return normalizeScientificText(content);
  }, [content]);

  // Memoize the workspace handle getter
  const getWorkspaceHandleMemo = useCallback(async () => {
    return getWorkspaceHandle ? await getWorkspaceHandle() : null;
  }, [getWorkspaceHandle]);

  // Build extensions list based on configuration
  const extensions = useMemo(() => {
    const baseExtensions = [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        codeBlock: false, // Use our custom code block
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableCell,
      TableHeader,
      Image.configure({
        inline: true,
      }),
      Placeholder.configure({
        placeholder: 'Type "/" for commands, "$...$" for math, paste images...',
      }),
      SlashCommands,
      TableInputRule,
      LatexPasteHandler,
      MarkdownPasteHandler,
      CodeBlockHighlight,
      // Image paste handler with workspace handle
      ImagePasteHandler.configure({
        getWorkspaceHandle: getWorkspaceHandleMemo,
        onPasteStart: () => {
          console.log("[ImagePaste] Starting image save...");
        },
        onPasteComplete: (success, path, error) => {
          if (success) {
            console.log(`[ImagePaste] Image saved to ${path}`);
          } else {
            console.error(`[ImagePaste] Failed: ${error}`);
          }
        },
      }),
    ];

    // Add math extensions based on configuration
    if (useMathLive) {
      baseExtensions.push(InlineMathLive, BlockMathLive);
    } else {
      baseExtensions.push(InlineMath, BlockMath);
    }

    return baseExtensions;
  }, [getWorkspaceHandleMemo, useMathLive]);

  const editor = useEditor({
    extensions,
    content: normalizedContent,
    immediatelyRender: false, // Prevent SSR hydration mismatch in Next.js
    editorProps: {
      attributes: {
        class:
          "prose prose-lattice dark:prose-invert max-w-none focus:outline-none min-h-[200px] px-6 py-4",
        style: "font-size: 16px; line-height: 1.6;",
      },
    },
    onUpdate: ({ editor }) => {
      // Skip if this is an internal update (content set programmatically)
      if (isInternalUpdateRef.current) {
        return;
      }
      // Get content as HTML for saving
      const html = editor.getHTML();
      lastSetContentRef.current = html;
      onChange(html);
    },
  });

  // Update editor content when content prop changes (file switch or cache restore)
  useEffect(() => {
    if (!editor) return;
    
    // Check if file changed
    const fileChanged = fileName !== currentFileNameRef.current;
    if (fileChanged) {
      currentFileNameRef.current = fileName;
    }
    
    // Only update if content is different from what we last set
    // This prevents feedback loops and unnecessary re-renders
    if (normalizedContent !== lastSetContentRef.current || fileChanged) {
      isInternalUpdateRef.current = true;
      editor.commands.setContent(normalizedContent);
      lastSetContentRef.current = normalizedContent;
      isInternalUpdateRef.current = false;
    }
  }, [normalizedContent, editor, fileName]);

  // Register editor with HUD provider for symbol insertion
  useEffect(() => {
    if (editor) {
      registerTiptapEditor(editor);
    }
    return () => {
      registerTiptapEditor(null);
    };
  }, [editor]);

  // Handle Ctrl+S for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        onSave?.();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onSave]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  // Show loading state while editor initializes
  if (!editor) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading editor...</div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col bg-background"
      onClick={(e) => e.stopPropagation()}
    >
      <EditorToolbar editor={editor} />
      <TableToolbar editor={editor} />
      <div className="flex-1 overflow-auto">
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}
