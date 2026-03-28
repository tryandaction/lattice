"use client";

import { FolderOpen, AlertTriangle } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";

interface EmptyStateProps {
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
  onOpenQaWorkspace,
  showQaWorkspace,
  isSupported,
  isCheckingSupport,
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
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card/70 p-6 text-center">
        <FolderOpen className="h-8 w-8 text-muted-foreground" />
        <div className="space-y-1 text-center">
          <p className="text-sm font-medium text-foreground">
            {t("shell.workspace.none")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("explorer.empty.description")}
          </p>
        </div>
      </div>

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
    </div>
  );
}
