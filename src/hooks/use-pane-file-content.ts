"use client";

import { useEffect, useRef, useMemo } from "react";
import { useWorkspaceStore, type PaneId } from "@/stores/workspace-store";
import { findPane } from "@/lib/layout-utils";
import { getFileExtension, isBinaryFile } from "@/lib/file-utils";
import type { TabState } from "@/types/layout";

/**
 * Hook to get the active tab's file content for a specific pane
 * 
 * This hook watches the pane's active tab and provides the file handle
 * and content loading state. Content loading is handled separately
 * to allow for tab-specific content management.
 */
export function usePaneFileContent(paneId: PaneId) {
  const layout = useWorkspaceStore((state) => state.layout);
  
  const pane = useMemo(() => {
    return findPane(layout.root, paneId);
  }, [layout.root, paneId]);

  const activeTab = useMemo(() => {
    if (!pane || pane.activeTabIndex < 0 || pane.activeTabIndex >= pane.tabs.length) {
      return null;
    }
    return pane.tabs[pane.activeTabIndex];
  }, [pane]);

  return {
    pane,
    activeTab,
    tabs: pane?.tabs ?? [],
    activeTabIndex: pane?.activeTabIndex ?? -1,
  };
}

/**
 * Hook to load and manage file content for a specific tab
 * 
 * This hook handles loading file content when a tab becomes active
 * and manages the content state.
 */
export function useTabContent(tab: TabState | null) {
  const contentRef = useRef<string | ArrayBuffer | null>(null);
  const loadingRef = useRef(false);
  const errorRef = useRef<string | null>(null);
  const loadedTabIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!tab) {
      contentRef.current = null;
      loadingRef.current = false;
      errorRef.current = null;
      loadedTabIdRef.current = null;
      return;
    }

    // Skip if already loaded this tab
    if (loadedTabIdRef.current === tab.id && contentRef.current !== null) {
      return;
    }

    const loadFile = async () => {
      loadingRef.current = true;
      errorRef.current = null;
      loadedTabIdRef.current = tab.id;

      try {
        const file = await tab.fileHandle.getFile();
        const extension = getFileExtension(file.name);
        
        const content = isBinaryFile(extension)
          ? await file.arrayBuffer()
          : await file.text();

        contentRef.current = content;
        loadingRef.current = false;
      } catch (err) {
        errorRef.current = err instanceof Error ? err.message : "Failed to read file";
        loadingRef.current = false;
      }
    };

    loadFile();
  }, [tab]);

  return {
    content: contentRef.current,
    isLoading: loadingRef.current,
    error: errorRef.current,
  };
}

/**
 * Combined hook for pane content management
 * Returns both pane state and active tab content
 */
export function usePaneContent(paneId: PaneId) {
  const { pane, activeTab, tabs, activeTabIndex } = usePaneFileContent(paneId);
  
  // We'll manage content loading in the component for now
  // since we need to trigger re-renders on content load
  
  return {
    pane,
    activeTab,
    tabs,
    activeTabIndex,
    hasContent: activeTab !== null,
  };
}
