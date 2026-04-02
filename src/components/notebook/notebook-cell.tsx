"use client";

import { useState, memo } from "react";
import { Plus, Trash2, Code, FileText, ChevronDown, FileCode2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/use-i18n";
import { CodeCell } from "./code-cell";
import { MarkdownCell } from "./markdown-cell";
import { RawCell } from "./raw-cell";
import type { NotebookCell as NotebookCellType } from "@/lib/notebook-utils";

interface NotebookCellProps {
  cell: NotebookCellType;
  cellId: string;
  isActive: boolean;
  isHighlighted?: boolean;
  canDelete: boolean;
  onActivate: (cellId: string) => void;
  onAddAbove: (cellId: string, type: "markdown" | "code" | "raw") => void;
  onAddBelow: (cellId: string, type: "markdown" | "code" | "raw") => void;
  onDelete: (cellId: string) => void;
  onSourceChange: (cellId: string, source: string) => void;
  onTypeChange: (cellId: string, type: "markdown" | "code" | "raw") => void;
  onNavigateUp?: () => void;
  onNavigateDown?: () => void;
  onLinkNavigate?: (target: string) => void;
  rootHandle?: FileSystemDirectoryHandle | null;
  notebookFilePath?: string;
  onRunCell?: (cellId: string, source: string) => Promise<unknown>;
  isExecuting?: boolean;
  canRunCell?: boolean;
}

/**
 * Cell type selector dropdown
 */
function CellTypeSelector({
  currentType,
  onChange,
}: {
  currentType: "markdown" | "code" | "raw";
  onChange: (type: "markdown" | "code" | "raw") => void;
}) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 rounded px-1.5 py-1 text-xs hover:bg-accent transition-colors"
        title={currentType === "code" ? t("notebook.cell.code") : currentType === "markdown" ? t("notebook.cell.markdown") : t("notebook.cell.raw")}
      >
        {currentType === "code" ? (
          <Code className="h-3 w-3" />
        ) : currentType === "markdown" ? (
          <FileText className="h-3 w-3" />
        ) : (
          <FileCode2 className="h-3 w-3" />
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
              <span>{t("notebook.cell.code")}</span>
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
              <span>{t("notebook.cell.markdown")}</span>
            </button>
            <button
              onClick={() => {
                onChange("raw");
                setIsOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs hover:bg-accent",
                currentType === "raw" && "bg-accent"
              )}
            >
              <FileCode2 className="h-3 w-3" />
              <span>{t("notebook.cell.raw")}</span>
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
  onAdd: (type: "markdown" | "code" | "raw") => void;
}) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 rounded p-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        title={position === "above" ? t("notebook.cell.addAbove") : t("notebook.cell.addBelow")}
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
              <span>{t("notebook.cell.code")}</span>
            </button>
            <button
              onClick={() => {
                onAdd("markdown");
                setIsOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs hover:bg-accent"
            >
              <FileText className="h-3 w-3" />
              <span>{t("notebook.cell.markdown")}</span>
            </button>
            <button
              onClick={() => {
                onAdd("raw");
                setIsOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs hover:bg-accent"
            >
              <FileCode2 className="h-3 w-3" />
              <span>{t("notebook.cell.raw")}</span>
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
export const NotebookCellComponent = memo(function NotebookCellComponent({
  cell,
  cellId,
  isActive,
  isHighlighted = false,
  canDelete,
  onActivate,
  onAddAbove,
  onAddBelow,
  onDelete,
  onSourceChange,
  onTypeChange,
  onNavigateUp,
  onNavigateDown,
  onLinkNavigate,
  rootHandle,
  notebookFilePath,
  onRunCell,
  isExecuting = false,
  canRunCell = true,
}: NotebookCellProps) {
  const { t } = useI18n();
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
        onAddAbove(cellId, 'code');
      }
    }

    // B - Add cell below
    if (e.key === 'b' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if ((e.target as HTMLElement).tagName !== 'INPUT' &&
          (e.target as HTMLElement).tagName !== 'TEXTAREA' &&
          !(e.target as HTMLElement).closest('.cm-editor')) {
        e.preventDefault();
        onAddBelow(cellId, 'code');
      }
    }

    // M - Change to markdown
    if (e.key === 'm' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if ((e.target as HTMLElement).tagName !== 'INPUT' &&
          (e.target as HTMLElement).tagName !== 'TEXTAREA' &&
          !(e.target as HTMLElement).closest('.cm-editor')) {
        e.preventDefault();
        onTypeChange(cellId, 'markdown');
      }
    }

    // Y - Change to code
    if (e.key === 'y' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if ((e.target as HTMLElement).tagName !== 'INPUT' &&
          (e.target as HTMLElement).tagName !== 'TEXTAREA' &&
          !(e.target as HTMLElement).closest('.cm-editor')) {
        e.preventDefault();
        onTypeChange(cellId, 'code');
      }
    }

    // R - Change to raw
    if (e.key === 'r' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if ((e.target as HTMLElement).tagName !== 'INPUT' &&
          (e.target as HTMLElement).tagName !== 'TEXTAREA' &&
          !(e.target as HTMLElement).closest('.cm-editor')) {
        e.preventDefault();
        onTypeChange(cellId, 'raw');
      }
    }
  };

  return (
    <div
      className={cn(
        "group relative",
        "border-l-2 transition-all duration-300 pl-4 rounded-r-md",
        isActive
          ? "border-primary bg-primary/5"
          : "border-transparent hover:border-muted",
        isHighlighted && "border-amber-400 bg-amber-400/10 shadow-[0_0_0_1px_rgba(251,191,36,0.22)]"
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
        <CellTypeSelector currentType={cell.cell_type} onChange={(type) => onTypeChange(cellId, type)} />

        <div className="flex-1" />

        <AddCellButton position="above" onAdd={(type) => onAddAbove(cellId, type)} />
        <AddCellButton position="below" onAdd={(type) => onAddBelow(cellId, type)} />

        {canDelete && (
          <button
            onClick={() => onDelete(cellId)}
            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            title={t("notebook.cell.delete")}
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
          executionMeta={cell.execution_meta}
          isActive={isActive}
          onChange={(source) => onSourceChange(cellId, source)}
          onFocus={() => onActivate(cellId)}
          onNavigateUp={onNavigateUp}
          onNavigateDown={onNavigateDown}
          cellId={cell.id}
          notebookFilePath={notebookFilePath}
          onRunCell={onRunCell}
          isExecuting={isExecuting}
          canRun={canRunCell}
        />
      ) : cell.cell_type === "markdown" ? (
        <MarkdownCell
          source={cell.source}
          isActive={isActive}
          onChange={(source) => onSourceChange(cellId, source)}
          onFocus={() => onActivate(cellId)}
          onLinkNavigate={onLinkNavigate}
          rootHandle={rootHandle}
          filePath={notebookFilePath}
          cellId={cell.id}
        />
      ) : (
        <RawCell
          source={cell.source}
          isActive={isActive}
          onChange={(source) => onSourceChange(cellId, source)}
          onFocus={() => onActivate(cellId)}
          onNavigateUp={onNavigateUp}
          onNavigateDown={onNavigateDown}
          cellId={cell.id}
          notebookFilePath={notebookFilePath}
        />
      )}
    </div>
  );
});
