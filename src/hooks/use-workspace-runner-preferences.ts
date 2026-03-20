"use client";

import { useEffect, useRef } from "react";
import { createRunnerPreferenceDefaults, loadWorkspaceRunnerPreferences, normalizeWorkspacePath, saveWorkspaceRunnerPreferences } from "@/lib/runner/preferences";
import { useWorkspaceStore } from "@/stores/workspace-store";

export function useWorkspaceRunnerPreferencesPersistence(): void {
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const runnerPreferences = useWorkspaceStore((state) => state.runnerPreferences);
  const replaceRunnerPreferences = useWorkspaceStore((state) => state.replaceRunnerPreferences);

  const hydratedKeyRef = useRef<string | null>(null);
  const isHydratingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const normalizedKey = normalizeWorkspacePath(workspaceRootPath);

    if (!normalizedKey) {
      hydratedKeyRef.current = null;
      replaceRunnerPreferences(createRunnerPreferenceDefaults());
      return;
    }

    isHydratingRef.current = true;
    void loadWorkspaceRunnerPreferences(workspaceRootPath).then((preferences) => {
      if (cancelled) {
        return;
      }
      replaceRunnerPreferences(preferences);
      hydratedKeyRef.current = normalizedKey;
      isHydratingRef.current = false;
    }).catch(() => {
      if (cancelled) {
        return;
      }
      hydratedKeyRef.current = normalizedKey;
      isHydratingRef.current = false;
    });

    return () => {
      cancelled = true;
    };
  }, [replaceRunnerPreferences, workspaceRootPath]);

  useEffect(() => {
    const normalizedKey = normalizeWorkspacePath(workspaceRootPath);
    if (!normalizedKey || hydratedKeyRef.current !== normalizedKey || isHydratingRef.current) {
      return;
    }

    void saveWorkspaceRunnerPreferences(workspaceRootPath, runnerPreferences);
  }, [runnerPreferences, workspaceRootPath]);
}
