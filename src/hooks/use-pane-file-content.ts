"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [content, setContent] = useState<string | ArrayBuffer | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedTabId, setLoadedTabId] = useState<string | null>(null);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    let canceled = false;

    if (!tab) {
      setContent(null);
      setIsLoading(false);
      setError(null);
      setLoadedTabId(null);
      return;
    }

    // Skip if already loaded this tab
    if (loadedTabId === tab.id && (content !== null || isLoading)) {
      return;
    }

    const loadFile = async () => {
      setIsLoading(true);
      setError(null);
      setLoadedTabId(tab.id);

      try {
        const file = await tab.fileHandle.getFile();
        const extension = getFileExtension(file.name);
        
        const content = isBinaryFile(extension)
          ? await file.arrayBuffer()
          : await file.text();

        if (canceled) return;
        setContent(content);
        setIsLoading(false);
      } catch (err) {
        if (canceled) return;
        setError(err instanceof Error ? err.message : "Failed to read file");
        setIsLoading(false);
      }
    };

    loadFile();
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      canceled = true;
    };
  }, [tab, content, isLoading, loadedTabId]);

  return {
    content,
    isLoading,
    error,
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
