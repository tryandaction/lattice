"use client";

import { FilePlus, BookPlus, FolderPlus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Props for NewFileButtons component
 */
interface NewFileButtonsProps {
  onCreateNote: () => void;
  onCreateNotebook: () => void;
  onCreateFolder?: () => void;
  disabled?: boolean;
}

/**
 * NewFileButtons component
 * Provides buttons for creating new notes (.md), notebooks (.ipynb), and folders
 */
export function NewFileButtons({
  onCreateNote,
  onCreateNotebook,
  onCreateFolder,
  disabled = false,
}: NewFileButtonsProps) {
  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={onCreateNote}
        disabled={disabled}
        title="New Note (Markdown)"
        className={cn(
          "p-1 rounded hover:bg-accent transition-colors",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <FilePlus className="h-4 w-4 text-muted-foreground" />
      </button>
      <button
        onClick={onCreateNotebook}
        disabled={disabled}
        title="New Notebook (Jupyter)"
        className={cn(
          "p-1 rounded hover:bg-accent transition-colors",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <BookPlus className="h-4 w-4 text-muted-foreground" />
      </button>
      {onCreateFolder && (
        <button
          onClick={onCreateFolder}
          disabled={disabled}
          title="New Folder"
          className={cn(
            "p-1 rounded hover:bg-accent transition-colors",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <FolderPlus className="h-4 w-4 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
