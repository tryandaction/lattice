/**
 * Table Toolbar Component
 * 
 * Contextual toolbar for table editing in Tiptap.
 * Appears when cursor is inside a table.
 */

"use client";

import { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import {
  Plus,
  Minus,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TableToolbarProps {
  editor: Editor | null;
}

/**
 * Toolbar button component
 */
function ToolbarButton({
  onClick,
  disabled,
  children,
  title,
  variant = "default",
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  title: string;
  variant?: "default" | "destructive";
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
        "p-1.5 rounded hover:bg-muted transition-colors flex items-center gap-1 text-xs",
        disabled && "opacity-50 cursor-not-allowed",
        variant === "destructive" && "hover:bg-destructive/10 hover:text-destructive"
      )}
    >
      {children}
    </button>
  );
}

/**
 * Table Toolbar Component
 * 
 * Displays contextual actions when cursor is inside a table.
 */
export function TableToolbar({ editor }: TableToolbarProps) {
  const [isInTable, setIsInTable] = useState(false);

  useEffect(() => {
    if (!editor) return;

    const updateTableState = () => {
      // Check if cursor is inside a table
      const { selection } = editor.state;
      const { $from } = selection;
      
      let inTable = false;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === "table") {
          inTable = true;
          break;
        }
      }
      
      setIsInTable(inTable);
    };

    // Update on selection change
    editor.on("selectionUpdate", updateTableState);
    editor.on("transaction", updateTableState);

    // Initial check
    updateTableState();

    return () => {
      editor.off("selectionUpdate", updateTableState);
      editor.off("transaction", updateTableState);
    };
  }, [editor]);

  if (!editor || !isInTable) {
    return null;
  }

  return (
    <div className="flex items-center gap-1 border-b border-border px-3 py-1 bg-muted/50">
      <span className="text-xs text-muted-foreground mr-2">Table:</span>
      
      {/* Add Row */}
      <ToolbarButton
        onClick={() => editor.chain().focus().addRowBefore().run()}
        title="Add Row Above"
      >
        <ArrowUp className="h-3 w-3" />
        <Plus className="h-3 w-3" />
      </ToolbarButton>
      
      <ToolbarButton
        onClick={() => editor.chain().focus().addRowAfter().run()}
        title="Add Row Below"
      >
        <ArrowDown className="h-3 w-3" />
        <Plus className="h-3 w-3" />
      </ToolbarButton>

      <div className="w-px h-4 bg-border mx-1" />

      {/* Add Column */}
      <ToolbarButton
        onClick={() => editor.chain().focus().addColumnBefore().run()}
        title="Add Column Left"
      >
        <ArrowLeft className="h-3 w-3" />
        <Plus className="h-3 w-3" />
      </ToolbarButton>
      
      <ToolbarButton
        onClick={() => editor.chain().focus().addColumnAfter().run()}
        title="Add Column Right"
      >
        <ArrowRight className="h-3 w-3" />
        <Plus className="h-3 w-3" />
      </ToolbarButton>

      <div className="w-px h-4 bg-border mx-1" />

      {/* Delete Row/Column */}
      <ToolbarButton
        onClick={() => editor.chain().focus().deleteRow().run()}
        title="Delete Row"
        variant="destructive"
      >
        <Minus className="h-3 w-3" />
        <span>Row</span>
      </ToolbarButton>
      
      <ToolbarButton
        onClick={() => editor.chain().focus().deleteColumn().run()}
        title="Delete Column"
        variant="destructive"
      >
        <Minus className="h-3 w-3" />
        <span>Col</span>
      </ToolbarButton>

      <div className="w-px h-4 bg-border mx-1" />

      {/* Delete Table */}
      <ToolbarButton
        onClick={() => editor.chain().focus().deleteTable().run()}
        title="Delete Table"
        variant="destructive"
      >
        <Trash2 className="h-3 w-3" />
        <span>Table</span>
      </ToolbarButton>
    </div>
  );
}
