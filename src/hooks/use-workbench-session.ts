"use client";

import { useCallback, useEffect, useRef } from "react";
import { loadWorkbenchSessionStaged, saveWorkbenchSession } from "@/lib/layout-persistence";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { isPaneNode, isWebTabState, type LayoutNode, type LayoutState } from "@/types/layout";
import { markWorkspaceStartup } from "@/lib/workspace-startup-performance";
import { registerDesktopWindowCloseHandler } from "@/lib/desktop-window";
import { useCloudWorkbenchStore } from "@/stores/cloud-workbench-store";

function layoutFingerprint(layout: LayoutState): string {
  const serializeNode = (node: LayoutNode): unknown => {
    if (isPaneNode(node)) {
      return {
        type: "pane",
        id: node.id,
        activeTabIndex: node.activeTabIndex,
        tabs: node.tabs.map((tab) => ({
          id: tab.id,
          kind: tab.kind ?? "file",
          filePath: tab.filePath,
          isDirty: tab.isDirty || useContentCacheStore.getState().hasUnsavedChanges(tab.id),
          ...(isWebTabState(tab) ? { url: tab.url } : {}),
        })),
      };
    }
    return {
      type: "split",
      id: node.id,
      direction: node.direction,
      sizes: node.sizes,
      children: node.children.map(serializeNode),
    };
  };

  return JSON.stringify({ activePaneId: layout.activePaneId, root: serializeNode(layout.root) });
}

function layoutHasFileTab(node: LayoutNode): boolean {
  if (isPaneNode(node)) {
    return node.tabs.length > 0;
  }
  return node.children.some(layoutHasFileTab);
}

export function useWorkbenchSession() {
  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const localWorkspaceKey = useWorkspaceStore((state) => state.workspaceIdentity?.workspaceKey ?? null);
  const cloudScope = useCloudWorkbenchStore(state => state.scope);
  const workspaceKey = rootHandle ? localWorkspaceKey : cloudScope ? `cloud-workbench:${cloudScope}` : null;
  const layout = useWorkspaceStore((state) => state.layout);
  const sidebarCollapsed = useWorkspaceStore((state) => state.sidebarCollapsed);
  const restoreWorkbenchState = useWorkspaceStore((state) => state.restoreWorkbenchState);
  const resetWorkbenchState = useWorkspaceStore((state) => state.resetWorkbenchState);
  const clearContentCache = useContentCacheStore((state) => state.clearCache);

  const hydratedWorkspaceKeyRef = useRef<string | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrationAbortRef = useRef<AbortController | null>(null);
  const stagedLayoutFingerprintRef = useRef<string | null>(null);
  const sessionStateRef = useRef({
    rootHandle,
    workspaceRootPath,
    workspaceKey,
    layout,
    sidebarCollapsed,
  });
  useEffect(() => {
    sessionStateRef.current = {
      rootHandle,
      workspaceRootPath,
      workspaceKey,
      layout,
      sidebarCollapsed,
    };
  }, [layout, rootHandle, sidebarCollapsed, workspaceKey, workspaceRootPath]);

  const flushWorkbenchSession = useCallback(async () => {
    const current = sessionStateRef.current;
    if (
      !current.workspaceKey ||
      hydratedWorkspaceKeyRef.current !== current.workspaceKey
    ) {
      return;
    }

    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }

    await saveWorkbenchSession(
      current.workspaceKey,
      current.workspaceRootPath,
      current.layout,
      current.sidebarCollapsed,
    );
  }, []);

  useEffect(() => registerDesktopWindowCloseHandler(flushWorkbenchSession), [flushWorkbenchSession]);

  useEffect(() => {
    if (!workspaceKey) {
      hydrationAbortRef.current?.abort();
      hydrationAbortRef.current = null;
      stagedLayoutFingerprintRef.current = null;
      hydratedWorkspaceKeyRef.current = null;
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      return;
    }

    if (hydratedWorkspaceKeyRef.current === workspaceKey) {
      return;
    }

    hydrationAbortRef.current?.abort();
    const hydrationController = new AbortController();
    hydrationAbortRef.current = hydrationController;
    hydratedWorkspaceKeyRef.current = null;
    clearContentCache();

    let cancelled = false;
    void loadWorkbenchSessionStaged(workspaceKey, workspaceRootPath, rootHandle, {
      signal: hydrationController.signal,
    }).then((staged) => {
      if (cancelled || hydrationController.signal.aborted) {
        return;
      }

      if (staged.initial) {
        restoreWorkbenchState(staged.initial.layout, staged.initial.sidebarCollapsed);
        stagedLayoutFingerprintRef.current = layoutFingerprint(staged.initial.layout);
        if (layoutHasFileTab(staged.initial.layout.root)) {
          markWorkspaceStartup("first-file-ready");
        }
      } else {
        resetWorkbenchState(sidebarCollapsed);
        stagedLayoutFingerprintRef.current = null;
      }

      hydratedWorkspaceKeyRef.current = workspaceKey;

      void staged.complete.then((session) => {
        if (cancelled || hydrationController.signal.aborted || !session) {
          return;
        }
        const currentLayout = useWorkspaceStore.getState().layout;
        if (stagedLayoutFingerprintRef.current !== layoutFingerprint(currentLayout)) {
          return;
        }
        restoreWorkbenchState(session.layout, session.sidebarCollapsed);
        stagedLayoutFingerprintRef.current = layoutFingerprint(session.layout);
      }).catch(() => {
        // A missing or invalid individual tab should not block the workspace.
      });
    }).catch(() => {
      if (!cancelled && !hydrationController.signal.aborted) {
        resetWorkbenchState(sidebarCollapsed);
        hydratedWorkspaceKeyRef.current = workspaceKey;
      }
    });

    return () => {
      cancelled = true;
      hydrationController.abort();
      if (hydrationAbortRef.current === hydrationController) {
        hydrationAbortRef.current = null;
      }
    };
  }, [
    clearContentCache,
    resetWorkbenchState,
    restoreWorkbenchState,
    rootHandle,
    sidebarCollapsed,
    workspaceKey,
    workspaceRootPath,
  ]);

  useEffect(() => {
    if (!workspaceKey || hydratedWorkspaceKeyRef.current !== workspaceKey) {
      return;
    }

    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }

    persistTimerRef.current = setTimeout(() => {
      void saveWorkbenchSession(workspaceKey, workspaceRootPath, layout, sidebarCollapsed);
    }, 180);

    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [layout, rootHandle, sidebarCollapsed, workspaceKey, workspaceRootPath]);
}
