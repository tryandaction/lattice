"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useCallback } from "react";
import { Bold, Italic, List, ListOrdered, Heading1, Heading2, Heading3, Code, Quote, Undo, Redo } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Props for TiptapEditor
 */
export interface TiptapEditorProps {
  content: string;
  onChange: (content: string) => void;
  fileName?: string;
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
  if (!editor) return null;

  return (
    <div className="flex items-center gap-0.5 border-b border-border px-2 py-1 bg-muted/30 flex-wrap">
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

      <div className="w-px h-4 bg-border mx-1" />

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

      <div className="w-px h-4 bg-border mx-1" />

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

      <div className="w-px h-4 bg-border mx-1" />

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

      <div className="w-px h-4 bg-border mx-1" />

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
    </div>
  );
}


/**
 * Tiptap Editor Component
 * 
 * A rich text editor for Markdown files using Tiptap.
 * Supports basic formatting: bold, italic, headings, lists, code blocks.
 * 
 * Note: This editor works with the raw text content. For proper Markdown
 * editing, we preserve the original content and only track changes.
 */
export function TiptapEditor({ content, onChange, fileName }: TiptapEditorProps) {
  // Track if this is the initial content load
  const isInitialLoadRef = useRef(true);
  const lastFileNameRef = useRef(fileName);
  
  // Reset initial load flag when file changes
  if (fileName !== lastFileNameRef.current) {
    isInitialLoadRef.current = true;
    lastFileNameRef.current = fileName;
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
    ],
    content: content,
    immediatelyRender: false, // Prevent SSR hydration mismatch in Next.js
    editorProps: {
      attributes: {
        class: "prose prose-slate dark:prose-invert max-w-none focus:outline-none min-h-[200px] px-4 py-3",
      },
    },
    onUpdate: ({ editor }) => {
      // Skip the initial content set
      if (isInitialLoadRef.current) {
        isInitialLoadRef.current = false;
        return;
      }
      // Get content as text for saving
      // Note: This preserves the edited content structure
      const text = editor.getText();
      // For now, we'll use HTML as the intermediate format
      // A proper implementation would convert back to Markdown
      const html = editor.getHTML();
      onChange(html);
    },
  });

  // Update editor content when file changes (new file loaded)
  useEffect(() => {
    if (editor && isInitialLoadRef.current) {
      editor.commands.setContent(content);
      isInitialLoadRef.current = false;
    }
  }, [content, editor, fileName]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  // Show loading state while editor initializes (due to immediatelyRender: false)
  if (!editor) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading editor...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background" onClick={(e) => e.stopPropagation()}>
      <EditorToolbar editor={editor} />
      <div className="flex-1 overflow-auto">
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}
