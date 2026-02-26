"use client";

import { useState } from "react";
import { Plus, Trash2, Code, FileText, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { CodeCell } from "./code-cell";
import { MarkdownCell } from "./markdown-cell";
import type { NotebookCell as NotebookCellType } from "@/lib/notebook-utils";

interface NotebookCellProps {
  cell: NotebookCellType;
  isActive: boolean;
  canDelete: boolean;
  onActivate: () => void;
  onAddAbove: (type: "markdown" | "code") => void;
  onAddBelow: (type: "markdown" | "code") => void;
  onDelete: () => void;
  onSourceChange: (source: string) => void;
  onTypeChange: (type: "markdown" | "code") => void;
  onNavigateUp?: () => void;
  onNavigateDown?: () => void;
}

/**
 * Cell type selector dropdown
 */
function CellTypeSelector({
  currentType,
  onChange,
}: {
  currentType: "markdown" | "code";
  onChange: (type: "markdown" | "code") => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 rounded px-1.5 py-1 text-xs hover:bg-accent transition-colors"
        title={currentType === "code" ? "Code cell" : "Markdown cell"}
      >
        {currentType === "code" ? (
          <Code className="h-3 w-3" />
        ) : (
          <FileText className="h-3 w-3" />
        )}
        <ChevronDown className="h-3 w-3 opacity-50" />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute left-0 top-full z-20 mt-1 rounded-md border border-border bg-popover p-1 shadow-md">
            <button
              onClick={() => {
                onChange("code");
                setIsOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs hover:bg-accent",
                currentType === "code" && "bg-accent"
              )}
            >
              <Code className="h-3 w-3" />
              <span>Code</span>
            </button>
            <button
              onClick={() => {
                onChange("markdown");
                setIsOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs hover:bg-accent",
                currentType === "markdown" && "bg-accent"
              )}
            >
              <FileText className="h-3 w-3" />
              <span>Markdown</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Add cell button with type selection
 */
function AddCellButton({
  position,
  onAdd,
}: {
  position: "above" | "below";
  onAdd: (type: "markdown" | "code") => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 rounded p-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        title={`Add cell ${position}`}
      >
        <Plus className="h-3 w-3" />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute left-0 top-full z-20 mt-1 rounded-md border border-border bg-popover p-1 shadow-md min-w-[100px]">
            <button
              onClick={() => {
                onAdd("code");
                setIsOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs hover:bg-accent"
            >
              <Code className="h-3 w-3" />
              <span>Code</span>
            </button>
            <button
              onClick={() => {
                onAdd("markdown");
                setIsOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs hover:bg-accent"
            >
              <FileText className="h-3 w-3" />
              <span>Markdown</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Notebook Cell Component
 *
 * Wrapper component for notebook cells with controls.
 * Provides clear visual indication of active state and keyboard navigation support.
 */
export function NotebookCellComponent({
  cell,
  isActive,
  canDelete,
  onActivate,
  onAddAbove,
  onAddBelow,
  onDelete,
  onSourceChange,
  onTypeChange,
  onNavigateUp,
  onNavigateDown,
}: NotebookCellProps) {
  const [showControls, setShowControls] = useState(false);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Only handle when cell is active but not editing
    if (!isActive) return;

    // Escape - deselect cell
    if (e.key === 'Escape') {
      e.preventDefault();
      // Let the cell blur
    }

    // A - Add cell above
    if (e.key === 'a' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      // Only trigger if target is not an input/textarea
      if ((e.target as HTMLElement).tagName !== 'INPUT' &&
          (e.target as HTMLElement).tagName !== 'TEXTAREA' &&
          !(e.target as HTMLElement).closest('.cm-editor')) {
        e.preventDefault();
        onAddAbove('code');
      }
    }

    // B - Add cell below
    if (e.key === 'b' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if ((e.target as HTMLElement).tagName !== 'INPUT' &&
          (e.target as HTMLElement).tagName !== 'TEXTAREA' &&
          !(e.target as HTMLElement).closest('.cm-editor')) {
        e.preventDefault();
        onAddBelow('code');
      }
    }

    // M - Change to markdown
    if (e.key === 'm' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if ((e.target as HTMLElement).tagName !== 'INPUT' &&
          (e.target as HTMLElement).tagName !== 'TEXTAREA' &&
          !(e.target as HTMLElement).closest('.cm-editor')) {
        e.preventDefault();
        onTypeChange('markdown');
      }
    }

    // Y - Change to code
    if (e.key === 'y' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if ((e.target as HTMLElement).tagName !== 'INPUT' &&
          (e.target as HTMLElement).tagName !== 'TEXTAREA' &&
          !(e.target as HTMLElement).closest('.cm-editor')) {
        e.preventDefault();
        onTypeChange('code');
      }
    }
  };

  return (
    <div
      className={cn(
        "group relative",
        "border-l-2 transition-all duration-150 pl-4",
        isActive
          ? "border-primary bg-primary/5"
          : "border-transparent hover:border-muted"
      )}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
      onKeyDown={handleKeyDown}
      tabIndex={isActive ? 0 : -1}
    >
      {/* Cell toolbar */}
      <div
        className={cn(
          "flex items-center gap-2 mb-2 transition-opacity",
          showControls || isActive ? "opacity-100" : "opacity-0"
        )}
      >
        <CellTypeSelector currentType={cell.cell_type} onChange={onTypeChange} />
        
        <div className="flex-1" />
        
        <AddCellButton position="above" onAdd={onAddAbove} />
        <AddCellButton position="below" onAdd={onAddBelow} />
        
        {canDelete && (
          <button
            onClick={onDelete}
            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            title="Delete cell"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Cell content */}
      {cell.cell_type === "code" ? (
        <CodeCell
          source={cell.source}
          outputs={cell.outputs}
          executionCount={cell.execution_count}
          isActive={isActive}
          onChange={onSourceChange}
          onFocus={onActivate}
          onNavigateUp={onNavigateUp}
          onNavigateDown={onNavigateDown}
        />
      ) : (
        <MarkdownCell
          source={cell.source}
          isActive={isActive}
          onChange={onSourceChange}
          onFocus={onActivate}
        />
      )}
    </div>
  );
}
