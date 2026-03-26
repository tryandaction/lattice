"use client";

import { FolderOpen, AlertTriangle, X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";

interface EmptyStateProps {
  onOpenFolder: () => void;
  onOpenRecentWorkspace?: (path: string) => void;
  onDismissRecentWorkspace?: (path: string) => void;
  onOpenQaWorkspace?: () => void;
  showQaWorkspace?: boolean;
  isSupported: boolean;
  isCheckingSupport?: boolean;
  recentWorkspaces?: string[];
}

/**
 * Empty state component shown when no folder is opened
 * Features a scientific minimalist design with dashed border
 */
export function EmptyState({
  onOpenFolder,
  onOpenRecentWorkspace,
  onDismissRecentWorkspace,
  onOpenQaWorkspace,
  showQaWorkspace,
  isSupported,
  isCheckingSupport,
  recentWorkspaces = [],
}: EmptyStateProps) {
  const { t } = useI18n();
  // Don't show unsupported message while still checking
  // This prevents the flash of "Browser Not Supported" on initial load
  if (!isSupported && !isCheckingSupport) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-destructive/50 bg-destructive/5 p-8 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive/70" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-destructive">
              {t("explorer.empty.unsupported.title")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("explorer.empty.unsupported.description")}
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
            {t("explorer.openFolder")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("explorer.empty.description")}
          </p>
        </div>
      </button>

      {showQaWorkspace && onOpenQaWorkspace && (
        <button
          onClick={onOpenQaWorkspace}
          className="text-xs text-muted-foreground underline decoration-dotted hover:text-primary"
          type="button"
        >
          {t("explorer.empty.qa")}
        </button>
      )}

      <div className="text-center">
        <p className="font-scientific text-muted-foreground">
          {t("explorer.empty.supported")}
        </p>
      </div>

      {recentWorkspaces.length > 0 && onOpenRecentWorkspace ? (
        <div className="w-full max-w-xl rounded-lg border border-border bg-card/70 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {t('explorer.empty.recent')}
          </div>
          <div className="space-y-1.5">
            {recentWorkspaces.map((workspacePath) => (
              <div key={workspacePath} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenRecentWorkspace(workspacePath)}
                  className="flex-1 truncate rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
                  title={workspacePath}
                >
                  {workspacePath}
                </button>
                {onDismissRecentWorkspace ? (
                  <button
                    type="button"
                    onClick={() => onDismissRecentWorkspace(workspacePath)}
                    className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title={t('explorer.empty.removeRecent')}
                    aria-label={t('explorer.empty.removeRecent')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
