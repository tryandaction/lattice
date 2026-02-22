"use client";

import { FolderOpen, AlertTriangle } from "lucide-react";

interface EmptyStateProps {
  onOpenFolder: () => void;
  onOpenQaWorkspace?: () => void;
  showQaWorkspace?: boolean;
  isSupported: boolean;
  isCheckingSupport?: boolean;
}

/**
 * Empty state component shown when no folder is opened
 * Features a scientific minimalist design with dashed border
 */
export function EmptyState({
  onOpenFolder,
  onOpenQaWorkspace,
  showQaWorkspace,
  isSupported,
  isCheckingSupport,
}: EmptyStateProps) {
  // Don't show unsupported message while still checking
  // This prevents the flash of "Browser Not Supported" on initial load
  if (!isSupported && !isCheckingSupport) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-destructive/50 bg-destructive/5 p-8 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive/70" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-destructive">
              Browser Not Supported
            </p>
            <p className="text-xs text-muted-foreground">
              File System Access API requires Chrome or Edge browser.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <button
        onClick={onOpenFolder}
        disabled={isCheckingSupport}
        className="group flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border bg-card p-8 transition-colors hover:border-primary/50 hover:bg-accent/50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <FolderOpen className="h-10 w-10 text-muted-foreground transition-colors group-hover:text-primary" />
        <div className="space-y-1 text-center">
          <p className="text-sm font-medium text-foreground">
            Open Local Folder
          </p>
          <p className="text-xs text-muted-foreground">
            Select a research folder to begin
          </p>
        </div>
      </button>

      {showQaWorkspace && onOpenQaWorkspace && (
        <button
          onClick={onOpenQaWorkspace}
          className="text-xs text-muted-foreground underline decoration-dotted hover:text-primary"
          type="button"
        >
          Open QA Workspace
        </button>
      )}

      <div className="text-center">
        <p className="font-scientific text-muted-foreground">
          Supported: PDF, MD, TXT, PY, IPYNB, PPT, PNG, JPG
        </p>
      </div>
    </div>
  );
}
