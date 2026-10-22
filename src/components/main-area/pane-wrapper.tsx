"use client";

import { startTransition, useCallback, useEffect, useState, useRef, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useDndMonitor } from "@dnd-kit/core";
import { Check, Copy, FileCode, FileText, Filter, MoreHorizontal, PanelTopClose, Save, SplitSquareHorizontal, SplitSquareVertical, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TabBar } from "./tab-bar";
import { DropZones } from "./drop-zone";
import { UniversalFileViewer } from "./universal-file-viewer";
import { SaveReminderDialog } from "@/components/ui/save-reminder-dialog";
import { WorkbenchContextMenu, type WorkbenchMenuAction } from "@/components/ui/workbench-context-menu";
import { useWorkspaceStore, type PaneId } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { useFileSystem } from "@/hooks/use-file-system";
import { findPane } from "@/lib/layout-utils";
import { getFileExtension, getRendererForExtension, isBinaryFile, isEditableFile } from "@/lib/file-utils";
import { acknowledgeWorkspaceTabSave, saveWorkspaceTabContent } from "@/lib/workspace-save";
import type { TabState } from "@/types/layout";
import { isFileTabState, isDocumentTabState } from "@/types/layout";
import { getCloudWorkspaceSnapshot, subscribeCloudWorkspaceHost } from "@/lib/cloud-workspace-host";
import { readCloudFileTab } from "@/lib/shared-library/workbench-source";
import { can } from "@/lib/shared-library/permissions";
import { useCloudWorkbenchStore } from "@/stores/cloud-workbench-store";
import { useI18n } from "@/hooks/use-i18n";
import { getDesktopPreviewPath, resolveDesktopPreviewUrl } from "@/lib/desktop-preview";
import { readDesktopTextFile, readDesktopTextFileChunk } from "@/lib/desktop-file-system";
import { isTauriHost } from "@/lib/storage-adapter";
import type { ViewerContent } from "@/types/viewer-content";
import { measureLatticePerformanceAsync } from "@/lib/performance/performance-metrics";
import { readFileOnce } from "@/lib/inflight-file-read";
import { getWorkspaceFileRevision, subscribeWorkspaceFileRevisions } from "@/lib/workspace-file-revisions";

const EMPTY_TABS: TabState[] = [];
const SYSTEM_INDEX_TEXT_PREVIEW_BYTES = 128 * 1024;
type PaneTabFilter = "all" | "pdf" | "markdown" | "code";

function getPaneTabFilter(tab: TabState): Exclude<PaneTabFilter, "all"> | null {
  if (tab.kind === "web") {
    return null;
  }

  if (!isDocumentTabState(tab)) {
    return null;
  }

  const rendererType = getRendererForExtension(getFileExtension(tab.fileName));
  if (rendererType === "pdf") {
    return "pdf";
  }
  if (rendererType === "markdown") {
    return "markdown";
  }
  if (rendererType === "html") {
    return "code";
  }
  if (rendererType === "code" || rendererType === "jupyter") {
    return "code";
  }

  return null;
}

export interface PaneWrapperProps {
  paneId: PaneId;
  isActive: boolean;
  onActivate: () => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
  onClose: () => void;
}

/**
 * Pane Wrapper Component
 * 
 * Wraps a pane with tab bar, content viewer, and pane controls.
 * Handles file content loading and tab management.
 * 
 * Content Loading Priority:
 * 1. Check cache first - if cached content exists, use it (preserves unsaved changes)
 * 2. Only load from file if no cache exists
 */
export function PaneWrapper({
  paneId,
  isActive,
  onActivate,
  onSplitRight,
  onSplitDown,
  onClose,
}: PaneWrapperProps) {
  const { t } = useI18n();
  const pane = useWorkspaceStore((state) => findPane(state.layout.root, paneId));
  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const closeAllTabs = useWorkspaceStore((state) => state.closeAllTabs);
  const closeSavedTabs = useWorkspaceStore((state) => state.closeSavedTabs);
  const closeOtherTabs = useWorkspaceStore((state) => state.closeOtherTabs);
  const closeTabsToRight = useWorkspaceStore((state) => state.closeTabsToRight);
  const setTabDirty = useWorkspaceStore((state) => state.setTabDirty);
  const { refreshDirectory } = useFileSystem();

  // Get pane data from layout
  const tabs = useMemo(() => pane?.tabs ?? EMPTY_TABS, [pane?.tabs]);
  const activeTabIndex = pane?.activeTabIndex ?? -1;
  const activeTabCandidate = activeTabIndex >= 0 && activeTabIndex < tabs.length
    ? tabs[activeTabIndex] 
    : null;
  const activeTab = activeTabCandidate?.kind === "vscode-workbench"
    ? null
    : activeTabCandidate;
  const activeRendererType = activeTab
    ? (activeTab.kind === "web" ? "web" : getRendererForExtension(getFileExtension(activeTab.fileName)))
    : null;
  const isActiveSystemIndexFile = activeTab
    ? activeTab.fileName === "_annotations.md" || activeTab.fileName === "_overview.md"
    : false;

  // Content loading state
  const [content, setContent] = useState<ViewerContent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Track which tab's content is currently loaded
  const [loadedTabId, setLoadedTabId] = useState<string | null>(null);
  const [loadedExternalRevision, setLoadedExternalRevision] = useState(0);
  // Track the original content for dirty state comparison
  const originalContentRef = useRef<string | null>(null);

  // Content cache store - use getState() for non-reactive access in effects
  // NOTE: getContent/setContent/markAsSaved are accessed via getState() inside effects
  // to avoid stale function references in dependency arrays causing infinite re-renders.
  const removeFromCache = useContentCacheStore((state) => state.removeFromCache);
  const hasUnsavedChanges = useContentCacheStore((state) => state.hasUnsavedChanges);

  // Save reminder dialog state
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [pendingCloseTabIndex, setPendingCloseTabIndex] = useState<number | null>(null);
  const [pendingCloseTabName, setPendingCloseTabName] = useState<string | null>(null);
  const pendingCloseTabRef = useRef<TabState | null>(null);
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number } | null>(null);
  const [filterMenu, setFilterMenu] = useState<{ x: number; y: number } | null>(null);
  const [tabFilter, setTabFilter] = useState<PaneTabFilter>("all");
  const effectiveTabFilter = tabFilter;
  const visibleTabEntries = useMemo(() => {
    return tabs
      .map((tab, index) => ({ tab, index }))
      .filter(({ tab }) => tab.kind === "web" || effectiveTabFilter === "all" || getPaneTabFilter(tab) === effectiveTabFilter);
  }, [tabs, effectiveTabFilter]);
  const visibleTabs = useMemo(
    () => visibleTabEntries.map(({ tab }) => tab),
    [visibleTabEntries],
  );
  const visibleTabIndexMap = useMemo(
    () => visibleTabEntries.map(({ index }) => index),
    [visibleTabEntries],
  );

  useEffect(() => {
    if (effectiveTabFilter === "all" || visibleTabEntries.length === 0) {
      return;
    }
    const activeTabIsVisible = visibleTabEntries.some(({ index }) => index === activeTabIndex);
    if (!activeTabIsVisible) {
      setActiveTab(paneId, visibleTabEntries[0].index);
    }
  }, [activeTabIndex, effectiveTabFilter, paneId, setActiveTab, visibleTabEntries]);

  const applyTabFilter = useCallback((nextFilter: PaneTabFilter) => {
    setFilterMenu(null);
    setTabFilter(nextFilter);
    if (nextFilter !== "all") {
      const firstDocument = tabs.findIndex(tab => getPaneTabFilter(tab) === nextFilter);
      if (firstDocument >= 0) setActiveTab(paneId, firstDocument);
    }
  }, [paneId, setActiveTab, tabs]);

  const filterMenuActions = useMemo<WorkbenchMenuAction[]>(() => {
    const options: Array<{
      id: PaneTabFilter;
      label: string;
      icon: ReactNode;
    }> = [
      { id: "all", label: "View all", icon: <Check className="h-4 w-4" /> },
      { id: "pdf", label: "PDF only", icon: <FileText className="h-4 w-4" /> },
      { id: "markdown", label: "MD file only", icon: <FileCode className="h-4 w-4" /> },
      { id: "code", label: "Code only", icon: <FileCode className="h-4 w-4" /> },
    ];

    return options.map((option) => ({
      id: `tab-filter-${option.id}`,
      label: option.label,
      icon: effectiveTabFilter === option.id ? <Check className="h-4 w-4" /> : option.icon,
      onSelect: () => applyTabFilter(option.id),
    }));
  }, [applyTabFilter, effectiveTabFilter]);

  const handleFilterButtonClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (effectiveTabFilter !== "all") {
      applyTabFilter("all");
      return;
    }
    setFilterMenu({ x: event.clientX, y: event.clientY });
  }, [applyTabFilter, effectiveTabFilter]);

  const filterBadgeLabel = useMemo(() => {
    switch (effectiveTabFilter) {
      case "pdf":
        return "PDF";
      case "markdown":
        return "MD";
      case "code":
        return "CODE";
      default:
        return "ALL";
    }
  }, [effectiveTabFilter]);

  // Only source identity restarts I/O. Dirty flags, scroll, resize and tab index
  // changes must not restart a preview or an already pending file read.
  const loadTabId = activeTab?.id;
  const loadFilePath = activeTab?.filePath ?? "";
  const loadFileName = activeTab?.fileName ?? "";
  const loadFileHandle = activeTab && isFileTabState(activeTab) ? activeTab.fileHandle : null;
  const externalFileRevision = useSyncExternalStore(subscribeWorkspaceFileRevisions,
    () => getWorkspaceFileRevision(loadTabId), () => 0);
  const loadWebUrl = activeTab?.kind === "web" ? activeTab.url : null;
  const loadWebTitle = activeTab?.kind === "web" ? activeTab.pageTitle : null;
  const cloudProvider = useSyncExternalStore(subscribeCloudWorkspaceHost, getCloudWorkspaceSnapshot, getCloudWorkspaceSnapshot).provider;
  const loadCloudResourceId = activeTab?.kind === "cloud-file" ? activeTab.cloud.resourceId : null;
  const cloudAccess = useCloudWorkbenchStore(state => {
    if (activeTab?.kind !== "cloud-file") return "local";
    if (state.scope !== activeTab.cloud.scope || !state.controller) return "disconnected";
    const snapshot = state.controller.getSnapshot();
    if (snapshot.revoked.includes(activeTab.cloud.libraryId)) return "revoked";
    const item = snapshot.items.find(item => item.id === activeTab.cloud.itemId && item.libraryId === activeTab.cloud.libraryId);
    return item?.status === "trashed" ? "revoked" : snapshot.roles[activeTab.cloud.libraryId]?.role ?? "viewer";
  });

  useEffect(() => {
    let cancelled = false;
    const isCurrent = () => {
      if (cancelled) return false;
      const currentPane = findPane(useWorkspaceStore.getState().layout.root, paneId);
      const current = currentPane?.tabs[currentPane.activeTabIndex];
      if (!current || current.id !== loadTabId) return false;
      return loadFileHandle
        ? isFileTabState(current) && current.fileHandle === loadFileHandle
        : current.kind === "web" || (current.kind === "cloud-file" && current.cloud.resourceId === loadCloudResourceId);
    };
    const syncDirty = (dirty: boolean) => {
      const currentPane = findPane(useWorkspaceStore.getState().layout.root, paneId);
      const index = currentPane?.tabs.findIndex((tab) => tab.id === loadTabId) ?? -1;
      if (index >= 0) setTabDirty(paneId, index, dirty);
    };
    const showContent = (next: ViewerContent, original: string | null, dirty = false) => {
      if (!isCurrent()) return;
      setLoadedTabId(loadTabId ?? null);
      setLoadedExternalRevision(externalFileRevision);
      setContent(next);
      originalContentRef.current = original;
      syncDirty(dirty);
      setIsLoading(false);
      setError(null);
    };

    setError(null);
    if (!loadTabId) {
      setContent(null);
      setIsLoading(false);
      setLoadedTabId(null);
      originalContentRef.current = null;
      return;
    }
    if (loadWebUrl) {
      showContent({ kind: "web-url", url: loadWebUrl, title: loadWebTitle ?? loadFileName }, null);
      return;
    }
    if (loadCloudResourceId) {
      const sourcePane = findPane(useWorkspaceStore.getState().layout.root, paneId);
      const sourceTab = sourcePane?.tabs.find(tab => tab.id === loadTabId);
      if (!sourceTab || sourceTab.kind !== "cloud-file") return;
      if (cloudAccess === "revoked" || cloudAccess === "disconnected") {
        setLoadedTabId(loadTabId); setContent(null); setIsLoading(false);
        setError(cloudAccess === "revoked" ? "此文件的访问权限已失效，或已被移入回收站。" : "请连接此文件所属云库。");
        return;
      }
      const abort = new AbortController();
      setContent(null); setIsLoading(true);
      void readCloudFileTab(sourceTab, abort.signal).then(resource => {
        if (!isCurrent() || !resource.content) return;
        const cached = useContentCacheStore.getState().getContent(sourceTab.id);
        // Verify access before showing even a locally cached draft. Keep the draft's
        // base version so a remote edit is detected rather than silently overwritten.
        useWorkspaceStore.getState().updateCloudTab(sourceTab.id, {
          fileName: resource.name,
          cloud: { ...sourceTab.cloud, role: resource.role, mimeType: resource.content.mimeType,
            versionId: cached?.isDirty ? sourceTab.cloud.versionId : resource.versionId },
        });
        if (cached?.isDirty && typeof cached.content === "string") {
          showContent({ kind: "text", text: cached.content }, typeof cached.originalContent === "string" ? cached.originalContent : null, true);
        } else if (resource.content.kind === "text") {
          useContentCacheStore.getState().setContent(sourceTab.id, resource.content.text, resource.content.text);
          showContent({ kind: "text", text: resource.content.text }, resource.content.text);
        } else {
          // PDF workers can detach their input: each pane gets its own buffer.
          showContent({ kind: "buffer", data: resource.content.data.slice(0) }, null);
        }
      }).catch(err => {
        if (!isCurrent() || abort.signal.aborted) return;
        setLoadedTabId(loadTabId); setContent(null); setError(err instanceof Error ? err.message : String(err)); setIsLoading(false);
      });
      return () => { cancelled = true; abort.abort(); };
    }
    if (!loadFileHandle) return;

    // Read editable cached data before the progressive system-index branch too.
    const cached = useContentCacheStore.getState().getContent(loadTabId);
    if (cached && !(activeRendererType === 'pdf' && cached.content instanceof ArrayBuffer)) {
      showContent(
        cached.content instanceof ArrayBuffer ? { kind: "buffer", data: cached.content } : { kind: "text", text: cached.content },
        typeof cached.originalContent === "string" ? cached.originalContent : null,
        cached.isDirty,
      );
      return;
    }
    const desktopPreviewPath = getDesktopPreviewPath(loadFileHandle);
    if (isTauriHost() && desktopPreviewPath && (activeRendererType === "pdf" || activeRendererType === "image")) {
      const previewUrl = resolveDesktopPreviewUrl(desktopPreviewPath);
      showContent({ kind: "desktop-url", url: externalFileRevision ? previewUrl + "?revision=" + externalFileRevision : previewUrl }, null);
      return;
    }

    setContent(null);
    setIsLoading(true);
    const load = async () => {
      try {
        if (isTauriHost() && desktopPreviewPath && activeRendererType === "markdown" && isActiveSystemIndexFile) {
          const preview = await readFileOnce(loadFileHandle, "preview", () =>
            readDesktopTextFileChunk(desktopPreviewPath, SYSTEM_INDEX_TEXT_PREVIEW_BYTES));
          if (!isCurrent()) return;
          const previewText = preview.hasMore ? preview.text.slice(0, Math.max(preview.text.lastIndexOf("\n"), 0)) : preview.text;
          showContent({ kind: "text", text: previewText || preview.text }, preview.hasMore ? null : preview.text);
          if (!preview.hasMore) {
            useContentCacheStore.getState().setContent(loadTabId, preview.text, preview.text);
            return;
          }
          const fullText = await readFileOnce(loadFileHandle, "text", () =>
            measureLatticePerformanceAsync('file-open', () => readDesktopTextFile(desktopPreviewPath), { file: loadFilePath, progressive: true }));
          if (!isCurrent()) return;
          // Never replace a user's edit made while the full preview was pending.
          const edited = useContentCacheStore.getState().getContent(loadTabId);
          if (edited?.isDirty) return;
          useContentCacheStore.getState().setContent(loadTabId, fullText, fullText);
          showContent({ kind: "text", text: fullText }, fullText);
          return;
        }
        const binary = isBinaryFile(getFileExtension(loadFileName || loadFilePath || loadFileHandle.name));
        let sourceRevision: string | undefined;
        const readContent = async () => {
          const file = await readFileOnce(loadFileHandle, "snapshot", () =>
            measureLatticePerformanceAsync('file-open', () => loadFileHandle.getFile(), { file: loadFilePath }));
          // Binary viewers may transfer/detach their ArrayBuffer in a worker.
          // Share the immutable File snapshot, but give each viewer its own bytes.
          if (binary && !isCurrent()) return null;
          if (binary) sourceRevision = `${file.size}:${file.lastModified}`;
          return binary
            ? measureLatticePerformanceAsync('file-open', () => file.arrayBuffer(), { file: loadFilePath, bytes: file.size })
            : measureLatticePerformanceAsync('file-open', () => file.text(), { file: loadFilePath, bytes: file.size });
        };
        const fileContent = binary ? await readContent() : await readFileOnce(loadFileHandle, "text", readContent);
        if (fileContent === null || !isCurrent()) return;
        const edited = useContentCacheStore.getState().getContent(loadTabId);
        if (edited?.isDirty) {
          showContent(typeof edited.content === "string" ? { kind: "text", text: edited.content } : { kind: "buffer", data: edited.content },
            typeof edited.originalContent === "string" ? edited.originalContent : null, true);
          return;
        }
        if (typeof fileContent === "string") {
          useContentCacheStore.getState().setContent(loadTabId, fileContent, fileContent);
          showContent({ kind: "text", text: fileContent }, fileContent);
        } else {
          showContent({ kind: "buffer", data: fileContent, ...(activeRendererType === 'pdf' ? { sourceRevision } : {}) }, null);
        }
      } catch (err) {
        if (!isCurrent()) return;
        // Keep the failed tab's identity so its error is displayed, not a spinner.
        setLoadedTabId(loadTabId);
        setError(err instanceof Error ? err.message : "Failed to read file");
        setIsLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [loadTabId, loadFilePath, loadFileName, loadFileHandle, externalFileRevision, loadWebUrl, loadWebTitle,
    activeRendererType, isActiveSystemIndexFile, paneId, setTabDirty, loadCloudResourceId, cloudProvider, cloudAccess]);

  // Handle tab click
  const handleTabClick = useCallback((index: number) => {
    setActiveTab(paneId, index);
  }, [paneId, setActiveTab]);

  // Handle tab close with save reminder
  const handleTabClose = useCallback((index: number) => {
    const tab = tabs[index];
    if (!tab) return;

    // Check if tab has unsaved changes
    if (hasUnsavedChanges(tab.id)) {
      // Show save reminder dialog
      pendingCloseTabRef.current = tab;
      setPendingCloseTabIndex(index);
      setPendingCloseTabName(tab.fileName);
      setSaveDialogOpen(true);
    } else {
      // No unsaved changes, close directly
      removeFromCache(tab.id);
      closeTab(paneId, index);
    }
  }, [paneId, closeTab, tabs, hasUnsavedChanges, removeFromCache]);

  useEffect(() => {
    const closeRequested = (event: Event) => {
      const detail = (event as CustomEvent<{ paneId: string; tabId: string }>).detail;
      if (detail?.paneId !== paneId) return;
      const index = tabs.findIndex(tab => tab.id === detail.tabId);
      if (index >= 0) handleTabClose(index);
    };
    window.addEventListener("lattice:close-workbench-tab", closeRequested);
    return () => window.removeEventListener("lattice:close-workbench-tab", closeRequested);
  }, [paneId, tabs, handleTabClose]);

  const closeTabsWithUnsavedGuard = useCallback((operation: () => TabState[]) => {
    const unsavedTabs = operation();
    if (unsavedTabs.length > 0) {
      toast.warning(t("tab.context.unsavedTitle"), {
        description: t("tab.context.unsavedCount", { count: unsavedTabs.length }),
      });
    }
    unsavedTabs.forEach((tab) => useContentCacheStore.getState().removeFromCache(tab.id));
  }, [t]);

  const handleCloseAllTabs = useCallback(() => {
    closeTabsWithUnsavedGuard(() => closeAllTabs(paneId));
  }, [closeAllTabs, closeTabsWithUnsavedGuard, paneId]);

  const handleCloseSavedTabs = useCallback(() => {
    const savedTabs = tabs.filter((tab) => !tab.isDirty);
    savedTabs.forEach((tab) => removeFromCache(tab.id));
    closeSavedTabs(paneId);
  }, [closeSavedTabs, paneId, removeFromCache, tabs]);

  const handleCloseOtherTabs = useCallback((keepIndex: number) => {
    const closedTabs = tabs.filter((_, index) => index !== keepIndex);
    closedTabs.forEach((tab) => {
      if (!tab.isDirty) {
        removeFromCache(tab.id);
      }
    });
    closeTabsWithUnsavedGuard(() => closeOtherTabs(paneId, keepIndex));
  }, [closeOtherTabs, closeTabsWithUnsavedGuard, paneId, removeFromCache, tabs]);

  const handleCloseTabsToRight = useCallback((tabIndex: number) => {
    const closedTabs = tabs.slice(tabIndex + 1);
    closedTabs.forEach((tab) => {
      if (!tab.isDirty) {
        removeFromCache(tab.id);
      }
    });
    closeTabsWithUnsavedGuard(() => closeTabsToRight(paneId, tabIndex));
  }, [closeTabsToRight, closeTabsWithUnsavedGuard, paneId, removeFromCache, tabs]);

  const handleCopyTabPath = useCallback((tab: TabState) => {
    void navigator.clipboard?.writeText(tab.filePath)
      .then(() => toast.success(t("tab.context.pathCopied")))
      .catch(() => toast.error(t("tab.context.pathCopyFailed")));
  }, [t]);

  // Handle save from dialog
  const handleDialogSave = useCallback(async () => {
    const tab = pendingCloseTabRef.current;
    const tabIndex = pendingCloseTabIndex;
    
    if (!tab || tabIndex === null) return;

    // Get cached content for this tab
    const cached = useContentCacheStore.getState().getContent(tab.id);
    if (!cached || typeof cached.content !== 'string') {
      // No content to save, just close
      setSaveDialogOpen(false);
      removeFromCache(tab.id);
      closeTab(paneId, tabIndex);
      return;
    }

    try {
      if (!isDocumentTabState(tab)) {
        throw new Error("Only workspace files can be saved.");
      }
      await saveWorkspaceTabContent({
        tab,
        content: cached.content,
        rootHandle,
        refreshDirectory,
      });

      acknowledgeWorkspaceTabSave(tab.id, cached.content);
      if (useContentCacheStore.getState().hasUnsavedChanges(tab.id)) {
        throw new Error("保存期间产生了新修改，请再次保存后关闭。");
      }

      // Close dialog and tab
      setSaveDialogOpen(false);
      removeFromCache(tab.id);
      const currentPane = findPane(useWorkspaceStore.getState().layout.root, paneId);
      const currentIndex = currentPane?.tabs.findIndex(current => current.id === tab.id) ?? -1;
      if (currentIndex >= 0) closeTab(paneId, currentIndex);
      
      // Reset pending state
      pendingCloseTabRef.current = null;
      setPendingCloseTabIndex(null);
      setPendingCloseTabName(null);
    } catch (err) {
      console.error('Failed to save file:', err);
      throw err;
    }
  }, [closeTab, paneId, pendingCloseTabIndex, refreshDirectory, removeFromCache, rootHandle]);

  // Handle don't save from dialog
  const handleDialogDontSave = useCallback(() => {
    const tabIndex = pendingCloseTabIndex;
    const tab = pendingCloseTabRef.current;
    
    if (tabIndex === null || !tab) return;

    // Close dialog and tab without saving
    setSaveDialogOpen(false);
    removeFromCache(tab.id);
    closeTab(paneId, tabIndex);
    
    // Reset pending state
    pendingCloseTabRef.current = null;
    setPendingCloseTabIndex(null);
    setPendingCloseTabName(null);
  }, [paneId, closeTab, pendingCloseTabIndex, removeFromCache]);

  // Handle cancel from dialog
  const handleDialogCancel = useCallback(() => {
    setSaveDialogOpen(false);
    pendingCloseTabRef.current = null;
    setPendingCloseTabIndex(null);
    setPendingCloseTabName(null);
  }, []);

  // Ref to track current content for comparison (avoids stale closure issues)
  const contentRef = useRef<ViewerContent | null>(content);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // Handle content change (for editable files)
  const handleContentChange = useCallback((tabId: string) => {
    return (newContent: string) => {
      // An editor can flush during unmount before this component's effects run.
      // Read the current store identity, not a ref from the previous render.
      const currentPane = findPane(useWorkspaceStore.getState().layout.root, paneId);
      if (currentPane?.tabs[currentPane.activeTabIndex]?.id !== tabId) {
        return;
      }

      // Don't update if content is the same (use ref to avoid stale closure)
      if (contentRef.current?.kind === "text" && newContent === contentRef.current.text) return;

      setContent({ kind: "text", text: newContent });

      const savedOriginal = useContentCacheStore.getState().getContent(tabId)?.originalContent;
      const originalContent = typeof savedOriginal === "string" ? savedOriginal : originalContentRef.current ?? newContent;
      startTransition(() => {
        useContentCacheStore.getState().setContent(tabId, newContent, originalContent);

        // Mark dirty when differs, clear when equals
        const isDirty = newContent !== originalContent;
        const { layout } = useWorkspaceStore.getState();
        const pane = findPane(layout.root, paneId);
        const currentIndex = pane?.tabs.findIndex((tab) => tab.id === tabId) ?? -1;
        if (currentIndex >= 0) {
          setTabDirty(paneId, currentIndex, isDirty);
        }
      });
    };
  }, [paneId, setTabDirty]);

  // Handle file save - optimized with fast save
  const handleSave = useCallback(async () => {
    if (!activeTab || !isDocumentTabState(activeTab)) return;

    const cached = useContentCacheStore.getState().getContent(activeTab.id);
    const contentToSave = typeof cached?.content === "string"
      ? cached.content
      : content?.kind === "text"
        ? content.text
        : null;
    if (contentToSave === null) return;
    
    try {
      const persistedTab = await saveWorkspaceTabContent({
        tab: activeTab,
        content: contentToSave,
        rootHandle,
        refreshDirectory,
      });
      
      // Update cache - mark as saved with new original content
      acknowledgeWorkspaceTabSave(persistedTab.id, contentToSave);
      const currentPane = findPane(useWorkspaceStore.getState().layout.root, paneId);
      if (currentPane?.tabs[currentPane.activeTabIndex]?.id === persistedTab.id) originalContentRef.current = contentToSave;
    } catch (err) {
      throw err;
    }
  }, [activeTab, content, paneId, refreshDirectory, rootHandle]);

  // Handle pane click to activate
  const handlePaneClick = useCallback(() => {
    if (!isActive) {
      onActivate();
    }
  }, [isActive, onActivate]);

  const paneMenuActions = useMemo<WorkbenchMenuAction[]>(() => [
    {
      id: "split-right",
      label: t("pane.splitRight"),
      icon: <SplitSquareHorizontal className="h-4 w-4" />,
      onSelect: onSplitRight,
    },
    {
      id: "split-down",
      label: t("pane.splitDown"),
      icon: <SplitSquareVertical className="h-4 w-4" />,
      onSelect: onSplitDown,
    },
    {
      id: "close-saved",
      label: t("tab.context.closeSaved"),
      icon: <Save className="h-4 w-4" />,
      separatorBefore: true,
      disabled: tabs.every((tab) => tab.isDirty),
      onSelect: handleCloseSavedTabs,
    },
    {
      id: "close-all",
      label: t("tab.context.closeAll"),
      icon: <X className="h-4 w-4" />,
      disabled: tabs.length === 0,
      onSelect: handleCloseAllTabs,
    },
    {
      id: "copy-active-path",
      label: t("tab.context.copyPath"),
      icon: <Copy className="h-4 w-4" />,
      disabled: !activeTab,
      onSelect: () => {
        if (activeTab) {
          handleCopyTabPath(activeTab);
        }
      },
    },
    {
      id: "close-pane",
      label: t("pane.close"),
      icon: <PanelTopClose className="h-4 w-4" />,
      separatorBefore: true,
      tone: "destructive",
      onSelect: onClose,
    },
  ], [activeTab, handleCloseAllTabs, handleCloseSavedTabs, handleCopyTabPath, onClose, onSplitDown, onSplitRight, t, tabs]);

  // Determine if current file is editable
  const isEditable = activeTab 
    ? isDocumentTabState(activeTab) && (activeTab.kind !== "cloud-file" || (["owner", "admin", "editor"].includes(cloudAccess) && can(activeTab.cloud.role, "item.update"))) && isEditableFile(getFileExtension(activeTab.fileName))
    : false;

  // Ensure we never render stale content for a different tab
  const isContentForActiveTab = activeTab ? loadedTabId === activeTab.id : false;
  const cloudAccessBlocked = activeTab?.kind === "cloud-file" && (cloudAccess === "revoked" || cloudAccess === "disconnected");
  const displayContent = isContentForActiveTab && !cloudAccessBlocked ? content : null;
  const displayError = cloudAccessBlocked ? "此云库文件暂不可访问，请检查连接或访问权限。" : isContentForActiveTab ? error : null;
  const displayLoading = !displayError && (isLoading || (!!activeTab && !isContentForActiveTab));

  // Track if dragging is happening (for showing drop zones)
  const [isDragging, setIsDragging] = useState(false);

  useDndMonitor({
    onDragStart: () => setIsDragging(true),
    onDragEnd: () => setIsDragging(false),
    onDragCancel: () => setIsDragging(false),
  });

  return (
    <div
      className={cn(
        "group/pane flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--workbench-panel)] transition-shadow duration-150",
        "bg-[var(--workbench-panel)]",
        isActive && "shadow-[inset_0_2px_0_0_var(--workbench-focus)]"
      )}
      data-testid={`pane-wrapper-${paneId}`}
      onMouseDownCapture={handlePaneClick}
      onClick={handlePaneClick}
    >
      {/* Save Reminder Dialog */}
      <SaveReminderDialog
        isOpen={saveDialogOpen}
        fileName={pendingCloseTabName ?? ""}
        onSave={handleDialogSave}
        onDontSave={handleDialogDontSave}
        onCancel={handleDialogCancel}
      />

      {/* Pane Header with Tabs and Actions */}
      <div className="flex min-w-0 items-center border-b border-border bg-[var(--workbench-panel-subtle)]">
        {/* Tab Bar */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <TabBar
            paneId={paneId}
            tabs={visibleTabs}
            activeTabIndex={activeTabIndex}
            isPaneActive={isActive}
            tabIndexMap={visibleTabIndexMap}
            totalTabCount={tabs.length}
            onTabClick={handleTabClick}
            onTabClose={handleTabClose}
            onCloseOtherTabs={handleCloseOtherTabs}
            onCloseTabsToRight={handleCloseTabsToRight}
            onCloseSavedTabs={handleCloseSavedTabs}
            onCloseAllTabs={handleCloseAllTabs}
            onCopyTabPath={handleCopyTabPath}
          />
        </div>
        
        {/* Pane Actions */}
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 border-l border-border px-1 transition-opacity",
            isActive ? "opacity-100" : "opacity-0 group-hover/pane:opacity-100"
          )}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setPaneMenu({ x: e.clientX, y: e.clientY }); }}
            className="p-1 rounded hover:bg-accent transition-colors"
            title={t("workbench.commandBar.more")}
          >
            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button
            onClick={handleFilterButtonClick}
            className={cn(
              "relative p-1 rounded transition-colors",
              effectiveTabFilter === "all"
                ? "hover:bg-accent"
                : "bg-accent text-accent-foreground hover:bg-accent/80"
            )}
            title={effectiveTabFilter === "all" ? "Filter open files: View all" : `Clear file filter: ${filterBadgeLabel}`}
            aria-pressed={effectiveTabFilter !== "all"}
          >
            <Filter className={cn(
              "h-3.5 w-3.5",
              effectiveTabFilter === "all" ? "text-muted-foreground" : "text-foreground"
            )} />
            <span
              className={cn(
                "pointer-events-none absolute -right-1.5 -top-1 min-w-4 rounded-sm border border-border bg-background px-0.5 text-[8px] font-semibold leading-3 shadow-sm",
                effectiveTabFilter === "all" ? "text-muted-foreground" : "text-foreground"
              )}
            >
              {filterBadgeLabel}
            </span>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onSplitRight(); }}
            className="p-1 rounded hover:bg-accent transition-colors"
            title={t("pane.splitRight")}
          >
            <SplitSquareHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onSplitDown(); }}
            className="p-1 rounded hover:bg-accent transition-colors"
            title={t("pane.splitDown")}
          >
            <SplitSquareVertical className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="p-1 rounded hover:bg-accent transition-colors"
            title={t("pane.close")}
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {paneMenu && (
        <WorkbenchContextMenu
          x={paneMenu.x}
          y={paneMenu.y}
          actions={paneMenuActions}
          onClose={() => setPaneMenu(null)}
        />
      )}

      {filterMenu && (
        <WorkbenchContextMenu
          x={filterMenu.x}
          y={filterMenu.y}
          actions={filterMenuActions}
          onClose={() => setFilterMenu(null)}
          minWidthClassName="min-w-[160px]"
        />
      )}

      {/* Content Area */}
      <div className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
        {/* Drop Zones - shown when dragging */}
        <DropZones paneId={paneId} isVisible={isDragging} />
        
        {activeTab ? (
          <UniversalFileViewer
            key={`${activeTab.id}:${loadedExternalRevision}`}
            paneId={paneId}
            tab={activeTab}
            isActive={isActive}
            rootHandle={rootHandle}
            content={displayContent}
            isLoading={displayLoading}
            error={displayError}
            onContentChange={isEditable ? handleContentChange(activeTab.id) : undefined}
            onSave={isEditable ? handleSave : undefined}
            fileId={activeTab.id} // CRITICAL: Pass tab ID as fileId for proper re-mounting
            filePath={activeTab.filePath}
          />
        ) : (
          <EmptyPaneState />
        )}
      </div>
    </div>
  );
}

/**
 * Empty Pane State
 * Shown when no files are open in the pane
 */
function EmptyPaneState() {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
      <FileText className="h-12 w-12 mb-2 opacity-20" />
      <p className="text-sm">{t("pane.empty.title")}</p>
      <p className="text-xs mt-1">{t("pane.empty.description")}</p>
    </div>
  );
}
