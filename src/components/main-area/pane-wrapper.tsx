"use client";

import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { useDndMonitor } from "@dnd-kit/core";
import { SplitSquareHorizontal, SplitSquareVertical, X, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { TabBar } from "./tab-bar";
import { DropZones } from "./drop-zone";
import { UniversalFileViewer } from "./universal-file-viewer";
import { SaveReminderDialog } from "@/components/ui/save-reminder-dialog";
import { useWorkspaceStore, type PaneId } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { findPane } from "@/lib/layout-utils";
import { getFileExtension, isBinaryFile, isEditableFile } from "@/lib/file-utils";
import { fastSaveFile, debounce } from "@/lib/fast-save";
import type { TabState } from "@/types/layout";

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
  const layout = useWorkspaceStore((state) => state.layout);
  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const setTabDirty = useWorkspaceStore((state) => state.setTabDirty);

  // Get pane data from layout
  const pane = findPane(layout.root, paneId);
  const tabs = pane?.tabs ?? [];
  const activeTabIndex = pane?.activeTabIndex ?? -1;
  const activeTab = activeTabIndex >= 0 && activeTabIndex < tabs.length 
    ? tabs[activeTabIndex] 
    : null;

  // Content loading state
  const [content, setContent] = useState<string | ArrayBuffer | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Track which tab's content is currently loaded
  const loadedTabIdRef = useRef<string | null>(null);
  // Track which tab is currently being loaded (for race condition prevention)
  const loadingTabIdRef = useRef<string | null>(null);
  // Track the original content for dirty state comparison
  const originalContentRef = useRef<string | null>(null);

  // Content cache store - use getState() for non-reactive access in effects
  const setContentToCache = useContentCacheStore((state) => state.setContent);
  const getContentFromCache = useContentCacheStore((state) => state.getContent);
  const markAsSaved = useContentCacheStore((state) => state.markAsSaved);
  const removeFromCache = useContentCacheStore((state) => state.removeFromCache);
  const hasUnsavedChanges = useContentCacheStore((state) => state.hasUnsavedChanges);

  // Save reminder dialog state
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [pendingCloseTabIndex, setPendingCloseTabIndex] = useState<number | null>(null);
  const pendingCloseTabRef = useRef<TabState | null>(null);

  // Load file content when active tab changes
  useEffect(() => {
    // No active tab - clear everything
    if (!activeTab) {
      console.log('[PaneWrapper] No active tab, clearing content');
      setContent(null);
      setIsLoading(false);
      setError(null);
      loadedTabIdRef.current = null;
      loadingTabIdRef.current = null;
      originalContentRef.current = null;
      return;
    }

    const currentTabId = activeTab.id;
    const isLoadingOtherTab =
      loadingTabIdRef.current !== null &&
      loadingTabIdRef.current !== currentTabId;
    
    console.log('[PaneWrapper] ===== TAB CHANGE DETECTED =====');
    console.log('[PaneWrapper] PaneId:', paneId);
    console.log('[PaneWrapper] Current tab ID:', currentTabId);
    console.log('[PaneWrapper] Loaded tab ID:', loadedTabIdRef.current);
    console.log('[PaneWrapper] File name:', activeTab.fileName);
    
    // If another tab is still loading, cancel its updates to prevent stale content
    if (isLoadingOtherTab) {
      console.log('[PaneWrapper] Cancelling in-flight load for tab:', loadingTabIdRef.current);
      loadingTabIdRef.current = null;
      setIsLoading(false);
    }

    const hasLoadedCurrent = loadedTabIdRef.current === currentTabId;
    const hasContent = content !== null;
    const isLoadingCurrent = loadingTabIdRef.current === currentTabId;

    // Same tab already loaded with content and no active load - no need to reload
    if (hasLoadedCurrent && hasContent && !isLoadingCurrent) {
      if (error) {
        setError(null);
      }
      console.log('[PaneWrapper] Same tab already loaded with content, skipping');
      return;
    }

    console.log('[PaneWrapper] Loading new tab content...');

    // PRIORITY 1: Check cache first - this preserves unsaved changes
    const cached = getContentFromCache(currentTabId);
    if (cached) {
      console.log('[PaneWrapper] Found cached content, length:', 
        typeof cached.content === 'string' ? cached.content.length : 'binary');
      // Immediately update state for cached content
      loadedTabIdRef.current = currentTabId;
      loadingTabIdRef.current = null;
      setContent(cached.content);
      originalContentRef.current = cached.originalContent;
      // Keep tab dirty state in sync with cache
      setTabDirty(paneId, activeTabIndex, cached.isDirty);
      setIsLoading(false);
      setError(null);
      return;
    }

    console.log('[PaneWrapper] No cache found, loading from file...');

    // If we're already loading this tab, avoid duplicate loads
    if (isLoadingCurrent) {
      console.log('[PaneWrapper] Already loading this tab, skipping duplicate load');
      return;
    }

    // PRIORITY 2: No cache - load from file
    // Mark this tab as loading to prevent race conditions
    loadingTabIdRef.current = currentTabId;
    
    // Clear previous content immediately to prevent showing stale data
    setContent(null);
    setIsLoading(true);
    setError(null);

    const loadFile = async () => {
      // Capture the tab ID at the start of this async operation
      const loadingForTabId = currentTabId;

      try {
        const file = await activeTab.fileHandle.getFile();
        const extension = getFileExtension(file.name);

        // File size validation (warn for very large files)
        const MAX_TEXT_FILE_SIZE = 50 * 1024 * 1024; // 50MB
        if (!isBinaryFile(extension) && file.size > MAX_TEXT_FILE_SIZE) {
          console.warn(`Large text file detected: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
        }

        const fileContent = isBinaryFile(extension)
          ? await file.arrayBuffer()
          : await file.text();

        console.log('[PaneWrapper] File loaded, content length:', 
          typeof fileContent === 'string' ? fileContent.length : 'binary');

        // CRITICAL: Only update if this is still the tab we're loading for
        // Check both the loading ref AND the current activeTab
        if (loadingTabIdRef.current === loadingForTabId) {
          console.log('[PaneWrapper] Setting content for tab:', loadingForTabId);
          loadedTabIdRef.current = loadingForTabId;
          loadingTabIdRef.current = null;
          setContent(fileContent);
          if (typeof fileContent === 'string') {
            originalContentRef.current = fileContent;
            // Initialize cache with original content
            setContentToCache(loadingForTabId, fileContent, fileContent);
            // Loaded from disk, so not dirty
            setTabDirty(paneId, activeTabIndex, false);
          }
          setIsLoading(false);
        } else {
          console.log('[PaneWrapper] Tab changed during load, discarding result');
        }
        // If tab changed during load, discard this result silently
      } catch (err) {
        console.error('[PaneWrapper] Failed to load file:', err);
        // Only update error if this is still the tab we're loading for
        if (loadingTabIdRef.current === loadingForTabId) {
          loadedTabIdRef.current = null;
          loadingTabIdRef.current = null;
          setError(err instanceof Error ? err.message : "Failed to read file");
          setIsLoading(false);
        }
      }
    };

    loadFile();
  }, [
    activeTab?.id,
    activeTab?.fileHandle,
    paneId, // CRITICAL: Add paneId to detect pane changes
    content,
    error,
    getContentFromCache,
    setContentToCache,
  ]);

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
      setSaveDialogOpen(true);
    } else {
      // No unsaved changes, close directly
      removeFromCache(tab.id);
      closeTab(paneId, index);
    }
  }, [paneId, closeTab, tabs, hasUnsavedChanges, removeFromCache]);

  // Handle save from dialog
  const handleDialogSave = useCallback(async () => {
    const tab = pendingCloseTabRef.current;
    const tabIndex = pendingCloseTabIndex;
    
    if (!tab || tabIndex === null) return;

    // Get cached content for this tab
    const cached = getContentFromCache(tab.id);
    if (!cached || typeof cached.content !== 'string') {
      // No content to save, just close
      setSaveDialogOpen(false);
      removeFromCache(tab.id);
      closeTab(paneId, tabIndex);
      return;
    }

    try {
      // Save the file
      const writable = await tab.fileHandle.createWritable();
      await writable.write(cached.content);
      await writable.close();

      // Close dialog and tab
      setSaveDialogOpen(false);
      removeFromCache(tab.id);
      closeTab(paneId, tabIndex);
      
      // Reset pending state
      pendingCloseTabRef.current = null;
      setPendingCloseTabIndex(null);
    } catch (err) {
      console.error('Failed to save file:', err);
      throw err;
    }
  }, [paneId, closeTab, pendingCloseTabIndex, getContentFromCache, removeFromCache]);

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
  }, [paneId, closeTab, pendingCloseTabIndex, removeFromCache]);

  // Handle cancel from dialog
  const handleDialogCancel = useCallback(() => {
    setSaveDialogOpen(false);
    pendingCloseTabRef.current = null;
    setPendingCloseTabIndex(null);
  }, []);

  // Ref to track current content for comparison (avoids stale closure issues)
  const contentRef = useRef<string | ArrayBuffer | null>(content);
  contentRef.current = content;
  const activeTabIdRef = useRef<string | null>(activeTab?.id ?? null);
  activeTabIdRef.current = activeTab?.id ?? null;

  // Handle content change (for editable files)
  const handleContentChange = useCallback((tabId: string) => {
    return (newContent: string) => {
      // Ignore late updates from inactive tabs
      if (activeTabIdRef.current !== tabId) {
        return;
      }

      // Don't update if content is the same (use ref to avoid stale closure)
      if (newContent === contentRef.current) return;

      setContent(newContent);

      const originalContent = originalContentRef.current ?? newContent;
      setContentToCache(tabId, newContent, originalContent);

      // Mark dirty when differs, clear when equals
      const isDirty = newContent !== originalContent;
      const { layout } = useWorkspaceStore.getState();
      const pane = findPane(layout.root, paneId);
      const currentIndex = pane?.tabs.findIndex((tab) => tab.id === tabId) ?? -1;
      if (currentIndex >= 0) {
        setTabDirty(paneId, currentIndex, isDirty);
      }
    };
  }, [paneId, setTabDirty, setContentToCache]);

  // Handle file save - optimized with fast save
  const handleSave = useCallback(async () => {
    if (!activeTab || typeof content !== 'string') return;
    
    try {
      // Use optimized save function
      await fastSaveFile(activeTab.fileHandle, content);
      
      // Update cache - mark as saved with new original content
      markAsSaved(activeTab.id, content);
      originalContentRef.current = content;
      
      // Clear dirty state
      setTabDirty(paneId, activeTabIndex, false);
    } catch (err) {
      console.error('Failed to save file:', err);
      throw err;
    }
  }, [activeTab, content, paneId, activeTabIndex, setTabDirty, markAsSaved]);

  // Handle pane click to activate
  const handlePaneClick = useCallback(() => {
    if (!isActive) {
      onActivate();
    }
  }, [isActive, onActivate]);

  // Determine if current file is editable
  const isEditable = activeTab 
    ? isEditableFile(getFileExtension(activeTab.fileName)) 
    : false;

  // Ensure we never render stale content for a different tab
  const isContentForActiveTab = activeTab ? loadedTabIdRef.current === activeTab.id : false;
  const displayContent = isContentForActiveTab ? content : null;
  const displayError = isContentForActiveTab ? error : null;
  const displayLoading = isLoading || (!!activeTab && !isContentForActiveTab && !displayError);

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
        "flex h-full flex-col overflow-hidden rounded-sm border transition-all duration-150",
        isActive
          ? "border-blue-500/50 ring-2 ring-blue-500/30"
          : "border-border"
      )}
      onMouseDownCapture={handlePaneClick}
      onClick={handlePaneClick}
    >
      {/* Save Reminder Dialog */}
      <SaveReminderDialog
        isOpen={saveDialogOpen}
        fileName={pendingCloseTabRef.current?.fileName ?? ""}
        onSave={handleDialogSave}
        onDontSave={handleDialogDontSave}
        onCancel={handleDialogCancel}
      />

      {/* Pane Header with Tabs and Actions */}
      <div className="flex items-center border-b border-border bg-muted/30">
        {/* Tab Bar */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <TabBar
            paneId={paneId}
            tabs={tabs}
            activeTabIndex={activeTabIndex}
            isPaneActive={isActive}
            onTabClick={handleTabClick}
            onTabClose={handleTabClose}
          />
        </div>
        
        {/* Pane Actions */}
        <div className="flex items-center gap-0.5 px-1 border-l border-border">
          <button
            onClick={(e) => { e.stopPropagation(); onSplitRight(); }}
            className="p-1 rounded hover:bg-accent transition-colors"
            title="Split Right"
          >
            <SplitSquareHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onSplitDown(); }}
            className="p-1 rounded hover:bg-accent transition-colors"
            title="Split Down"
          >
            <SplitSquareVertical className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="p-1 rounded hover:bg-accent transition-colors"
            title="Close Pane"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="relative flex-1 overflow-hidden">
        {/* Drop Zones - shown when dragging */}
        <DropZones paneId={paneId} isVisible={isDragging} />
        
        {activeTab ? (
          <UniversalFileViewer
            key={activeTab.id}
            paneId={paneId}
            handle={activeTab.fileHandle}
            rootHandle={rootHandle}
            content={displayContent}
            isLoading={displayLoading}
            error={displayError}
            onContentChange={isEditable ? handleContentChange(activeTab.id) : undefined}
            onSave={isEditable ? handleSave : undefined}
            fileId={activeTab.id} // CRITICAL: Pass tab ID as fileId for proper re-mounting
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
  return (
    <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
      <FileText className="h-12 w-12 mb-2 opacity-20" />
      <p className="text-sm">No file open</p>
      <p className="text-xs mt-1">Click a file in the explorer to open it</p>
    </div>
  );
}
