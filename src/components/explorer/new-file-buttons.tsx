"use client";

import { FilePlus, BookPlus, FolderPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/use-i18n";

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
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={onCreateNote}
        disabled={disabled}
        title={t("explorer.action.newNote")}
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
        title={t("explorer.action.newNotebook")}
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
          title={t("explorer.context.newFolder")}
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
