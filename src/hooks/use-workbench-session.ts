"use client";

import { useEffect, useRef } from "react";
import { loadWorkbenchSession, saveWorkbenchSession } from "@/lib/layout-persistence";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";

export function useWorkbenchSession() {
  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const layout = useWorkspaceStore((state) => state.layout);
  const sidebarCollapsed = useWorkspaceStore((state) => state.sidebarCollapsed);
  const restoreWorkbenchState = useWorkspaceStore((state) => state.restoreWorkbenchState);
  const resetWorkbenchState = useWorkspaceStore((state) => state.resetWorkbenchState);
  const clearContentCache = useContentCacheStore((state) => state.clearCache);

  const hydratedWorkspaceKeyRef = useRef<string | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!rootHandle || !workspaceRootPath) {
      hydratedWorkspaceKeyRef.current = null;
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      return;
    }

    if (hydratedWorkspaceKeyRef.current === workspaceRootPath) {
      return;
    }

    hydratedWorkspaceKeyRef.current = null;
    clearContentCache();

    let cancelled = false;
    void loadWorkbenchSession(workspaceRootPath, rootHandle).then((session) => {
      if (cancelled) {
        return;
      }

      if (session) {
        restoreWorkbenchState(session.layout, session.sidebarCollapsed);
      } else {
        resetWorkbenchState(sidebarCollapsed);
      }

      hydratedWorkspaceKeyRef.current = workspaceRootPath;
    });

    return () => {
      cancelled = true;
    };
  }, [
    clearContentCache,
    resetWorkbenchState,
    restoreWorkbenchState,
    rootHandle,
    sidebarCollapsed,
    workspaceRootPath,
  ]);

  useEffect(() => {
    if (!rootHandle || !workspaceRootPath || hydratedWorkspaceKeyRef.current !== workspaceRootPath) {
      return;
    }

    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }

    persistTimerRef.current = setTimeout(() => {
      void saveWorkbenchSession(workspaceRootPath, layout, sidebarCollapsed);
    }, 180);

    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [layout, rootHandle, sidebarCollapsed, workspaceRootPath]);
}
