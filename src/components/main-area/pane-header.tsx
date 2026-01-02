"use client";

import { X, FileText } from "lucide-react";

/**
 * Props for PaneHeader
 */
export interface PaneHeaderProps {
  fileName: string | null;
  isDirty: boolean;
  onClose: () => void;
}

/**
 * Pane Header Component
 * 
 * Displays the filename, dirty indicator, and close button for a pane.
 * Uses a compact design to minimize vertical space.
 */
export function PaneHeader({
  fileName,
  isDirty,
  onClose,
}: PaneHeaderProps) {
  return (
    <div className="flex h-8 items-center justify-between border-b border-border bg-muted/30 px-2">
      <div className="flex items-center gap-2 min-w-0">
        <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-medium text-foreground">
          {fileName || "Empty"}
        </span>
        {isDirty && (
          <span 
            className="h-2 w-2 flex-shrink-0 rounded-full bg-amber-500" 
            title="Unsaved changes"
          />
        )}
      </div>
      
      {fileName && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="flex h-5 w-5 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Close file"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
