"use client";

import { useEffect } from "react";
import { FolderOpen, History, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { useSettingsStore } from "@/stores/settings-store";
import { LayoutRenderer } from "./layout-renderer";
import { findPane } from "@/lib/layout-utils";
import { getFileExtension, isEditableFile } from "@/lib/file-utils";
import { useFileSystem } from "@/hooks/use-file-system";
import { acknowledgeWorkspaceTabSave, saveWorkspaceTabContent } from "@/lib/workspace-save";
import { useWorkspaceRunnerPreferencesPersistence } from "@/hooks/use-workspace-runner-preferences";
import { useI18n } from "@/hooks/use-i18n";
import { isDocumentTabState, type LayoutNode } from "@/types/layout";

function hasOpenTabs(node: LayoutNode): boolean {
  return node.type === "pane" ? node.tabs.length > 0 : node.children.some(hasOpenTabs);
}

/**
 * Welcome placeholder component - shown when no workspace is open
 */
function WelcomePlaceholder() {
  const { t } = useI18n();
  const { openDirectory, openWorkspacePath, isLoading } = useFileSystem();
  const recentWorkspaces = useSettingsStore((state) => state.settings.recentWorkspacePaths ?? []).slice(0, 5);

  return (
    <div className="flex h-full min-w-0 overflow-y-auto bg-background p-4" data-testid="main-welcome">
      <div className="m-auto w-full min-w-0 max-w-3xl rounded-2xl border border-border bg-card/70 p-5 shadow-sm">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("main.welcome.title")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("main.welcome.description")}
          </p>
        </div>

        <div className="mt-6 grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))" }}>
          <div className="min-w-0 rounded-2xl border border-border bg-background p-5" data-testid="main-welcome-open-card">
            <div className="flex items-start gap-4">
              <div className="shrink-0 rounded-2xl bg-primary/10 p-3 text-primary">
                <FolderOpen className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold text-foreground">{t("main.welcome.open")}</div>
                <p className="mt-1 text-sm text-muted-foreground">{t("main.welcome.openHint")}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void openDirectory()}
              disabled={isLoading}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="main-welcome-open-workspace"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
              {t("main.welcome.open")}
            </button>
          </div>

          <div className="min-w-0 space-y-4">
            <div className="rounded-2xl border border-border bg-background p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <History className="h-4 w-4 text-muted-foreground" />
                {t("main.welcome.recent")}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t("main.welcome.recentHint")}</p>
              <div className="mt-4 space-y-2">
                {recentWorkspaces.length > 0 ? recentWorkspaces.map((workspacePath) => (
                  <button
                    key={workspacePath}
                    type="button"
                    onClick={() => void openWorkspacePath(workspacePath)}
                    className="w-full truncate rounded-lg border border-border bg-muted/30 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
                    title={workspacePath}
                  >
                    {workspacePath}
                  </button>
                )) : (
                  <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                    {t("settings.recentWorkspaces.empty")}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-background p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Search className="h-4 w-4 text-muted-foreground" />
                {t("main.welcome.navigate")}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t("main.welcome.navigateHint")}</p>
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">{t("main.welcome.supported")}</p>
      </div>
    </div>
  );
}

/**
 * Main Area component with advanced layout system
 */
export function MainArea({ active = true, hasCloudWorkspace = false }: { active?: boolean; hasCloudWorkspace?: boolean } = {}) {
  useWorkspaceRunnerPreferencesPersistence();

  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const layout = useWorkspaceStore((state) => state.layout);
  const setTabDirty = useWorkspaceStore((state) => state.setTabDirty);
  const { refreshDirectory } = useFileSystem();
  const { t } = useI18n();

  // Keyboard shortcut handler for Ctrl+S
  useEffect(() => {
    if (!active) return;
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
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
        if (!isDocumentTabState(activeTab)) {
          toast.info(t('main.toast.readOnly.title'), {
            description: '当前网页标签不支持保存到工作区文件。',
          });
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
          acknowledgeWorkspaceTabSave(persistedTab.id, cached.content);

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
          const tab = activePane.tabs[activePane.activeTabIndex];
          if (tab && useContentCacheStore.getState().hasUnsavedChanges(tab.id)) {
            window.dispatchEvent(new CustomEvent("lattice:close-workbench-tab", { detail: { paneId: layout.activePaneId, tabId: tab.id } }));
          } else closeTab(layout.activePaneId, activePane.activeTabIndex);
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
  }, [active, refreshDirectory, rootHandle, setTabDirty, t]);

  // Show welcome placeholder if no workspace is open
  if (!rootHandle && !hasCloudWorkspace && !hasOpenTabs(layout.root)) {
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
