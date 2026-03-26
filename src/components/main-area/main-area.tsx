"use client";

import { useEffect } from "react";
import { FolderOpen, History, Search } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { LayoutRenderer } from "./layout-renderer";
import { findPane } from "@/lib/layout-utils";
import { getFileExtension, isEditableFile } from "@/lib/file-utils";
import { useFileSystem } from "@/hooks/use-file-system";
import { saveWorkspaceTabContent } from "@/lib/workspace-save";
import { useWorkspaceRunnerPreferencesPersistence } from "@/hooks/use-workspace-runner-preferences";
import { useI18n } from "@/hooks/use-i18n";

/**
 * Welcome placeholder component - shown when no workspace is open
 */
function WelcomePlaceholder() {
  const { t } = useI18n();
  return (
    <div className="flex h-full items-center justify-center bg-background p-8">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card/70 p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("main.welcome.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("main.welcome.description")}
        </p>

        <div className="mt-6 grid grid-cols-3 gap-3 text-left">
          <div className="rounded-lg border border-border bg-background px-3 py-3">
            <FolderOpen className="mb-2 h-4 w-4 text-muted-foreground" />
            <div className="text-sm font-medium text-foreground">{t("main.welcome.open")}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t("main.welcome.openHint")}</div>
          </div>
          <div className="rounded-lg border border-border bg-background px-3 py-3">
            <History className="mb-2 h-4 w-4 text-muted-foreground" />
            <div className="text-sm font-medium text-foreground">{t("main.welcome.recent")}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t("main.welcome.recentHint")}</div>
          </div>
          <div className="rounded-lg border border-border bg-background px-3 py-3">
            <Search className="mb-2 h-4 w-4 text-muted-foreground" />
            <div className="text-sm font-medium text-foreground">{t("main.welcome.navigate")}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t("main.welcome.navigateHint")}</div>
          </div>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">{t("main.welcome.supported")}</p>
      </div>
    </div>
  );
}

/**
 * Main Area component with advanced layout system
 */
export function MainArea() {
  useWorkspaceRunnerPreferencesPersistence();

  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const layout = useWorkspaceStore((state) => state.layout);
  const setTabDirty = useWorkspaceStore((state) => state.setTabDirty);
  const { refreshDirectory } = useFileSystem();
  const { t } = useI18n();

  // Keyboard shortcut handler for Ctrl+S
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Check for Ctrl+S or Cmd+S
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && !e.shiftKey) {
        e.preventDefault();

        const { layout } = useWorkspaceStore.getState();
        const activePane = findPane(layout.root, layout.activePaneId);

        if (!activePane || activePane.activeTabIndex < 0) {
          return;
        }

        const activeTab = activePane.tabs[activePane.activeTabIndex];
        if (!activeTab) {
          return;
        }

        const extension = getFileExtension(activeTab.fileName);

        // Check if file is editable
          if (!isEditableFile(extension)) {
          toast.info(t('main.toast.readOnly.title'), {
            description: t('main.toast.readOnly.description'),
          });
          return;
        }

        // Get content from cache - this is the edited content
        const cached = useContentCacheStore.getState().getContent(activeTab.id);

        if (!cached || typeof cached.content !== 'string') {
          toast.info(t('main.toast.noChanges.title'), {
            description: t('main.toast.noChanges.description'),
          });
          return;
        }

        // Check if there are actual changes
        if (!cached.isDirty) {
          toast.info(t('main.toast.noChanges.title'), {
            description: t('main.toast.noChanges.description'),
          });
          return;
        }

        try {
          const persistedTab = await saveWorkspaceTabContent({
            tab: activeTab,
            content: cached.content,
            rootHandle,
            refreshDirectory,
          });

          // Mark as saved in cache
          useContentCacheStore.getState().markAsSaved(persistedTab.id, cached.content);

          // Clear dirty state in layout
          setTabDirty(layout.activePaneId, activePane.activeTabIndex, false);

          toast.success(t('main.toast.saved.title'), {
            description: t('main.toast.saved.description', { fileName: persistedTab.fileName }),
          });
        } catch (err) {
          toast.error(t('main.toast.saveFailed.title'), {
            description: err instanceof Error ? err.message : 'Failed to save file.',
          });
        }
      }

      // Ctrl+W to close active tab
      if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        e.preventDefault();

        const { layout, closeTab } = useWorkspaceStore.getState();
        const activePane = findPane(layout.root, layout.activePaneId);

        if (activePane && activePane.activeTabIndex >= 0) {
          closeTab(layout.activePaneId, activePane.activeTabIndex);
        }
      }

      // Ctrl+Tab to switch to next tab
      if ((e.ctrlKey || e.metaKey) && e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();

        const { layout, setActiveTab } = useWorkspaceStore.getState();
        const activePane = findPane(layout.root, layout.activePaneId);

        if (activePane && activePane.tabs.length > 1) {
          const nextIndex = (activePane.activeTabIndex + 1) % activePane.tabs.length;
          setActiveTab(layout.activePaneId, nextIndex);
        }
      }

      // Ctrl+Shift+Tab to switch to previous tab
      if ((e.ctrlKey || e.metaKey) && e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();

        const { layout, setActiveTab } = useWorkspaceStore.getState();
        const activePane = findPane(layout.root, layout.activePaneId);

        if (activePane && activePane.tabs.length > 1) {
          const prevIndex = activePane.activeTabIndex === 0
            ? activePane.tabs.length - 1
            : activePane.activeTabIndex - 1;
          setActiveTab(layout.activePaneId, prevIndex);
        }
      }

      // Ctrl+1-9 to switch to specific tab
      if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '9') {
        e.preventDefault();

        const { layout, setActiveTab } = useWorkspaceStore.getState();
        const activePane = findPane(layout.root, layout.activePaneId);
        const tabIndex = parseInt(e.key) - 1;

        if (activePane && tabIndex < activePane.tabs.length) {
          setActiveTab(layout.activePaneId, tabIndex);
        }
      }

      // Ctrl+\ to split right
      if ((e.ctrlKey || e.metaKey) && e.key === '\\' && !e.shiftKey) {
        e.preventDefault();
        const { layout, splitPane } = useWorkspaceStore.getState();
        splitPane(layout.activePaneId, 'horizontal');
      }

      // Ctrl+Shift+\ to split down
      if ((e.ctrlKey || e.metaKey) && e.key === '\\' && e.shiftKey) {
        e.preventDefault();
        const { layout, splitPane } = useWorkspaceStore.getState();
        splitPane(layout.activePaneId, 'vertical');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [refreshDirectory, rootHandle, setTabDirty, t]);

  // Show welcome placeholder if no workspace is open
  if (!rootHandle) {
    return <WelcomePlaceholder />;
  }

  // Render the layout tree
  return (
    <div className="h-full w-full overflow-hidden">
      <LayoutRenderer
        node={layout.root}
        activePaneId={layout.activePaneId}
      />
    </div>
  );
}
