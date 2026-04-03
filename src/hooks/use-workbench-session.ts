"use client";

import { useEffect, useRef } from "react";
import { loadWorkbenchSession, saveWorkbenchSession } from "@/lib/layout-persistence";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";

export function useWorkbenchSession() {
  const rootHandle = useWorkspaceStore((state) => state.rootHandle);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const workspaceKey = useWorkspaceStore((state) => state.workspaceIdentity?.workspaceKey ?? null);
  const layout = useWorkspaceStore((state) => state.layout);
  const sidebarCollapsed = useWorkspaceStore((state) => state.sidebarCollapsed);
  const restoreWorkbenchState = useWorkspaceStore((state) => state.restoreWorkbenchState);
  const resetWorkbenchState = useWorkspaceStore((state) => state.resetWorkbenchState);
  const clearContentCache = useContentCacheStore((state) => state.clearCache);

  const hydratedWorkspaceKeyRef = useRef<string | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!rootHandle || !workspaceKey) {
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

    hydratedWorkspaceKeyRef.current = null;
    clearContentCache();

    let cancelled = false;
    void loadWorkbenchSession(workspaceKey, workspaceRootPath, rootHandle).then((session) => {
      if (cancelled) {
        return;
      }

      if (session) {
        restoreWorkbenchState(session.layout, session.sidebarCollapsed);
      } else {
        resetWorkbenchState(sidebarCollapsed);
      }

      hydratedWorkspaceKeyRef.current = workspaceKey;
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
    workspaceKey,
    workspaceRootPath,
  ]);

  useEffect(() => {
    if (!rootHandle || !workspaceKey || hydratedWorkspaceKeyRef.current !== workspaceKey) {
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
