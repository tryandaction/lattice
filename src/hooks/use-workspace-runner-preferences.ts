"use client";

import { useEffect, useRef } from "react";
import { createRunnerPreferenceDefaults, getWorkspaceRunnerPreferencesStorageKey, saveWorkspaceRunnerPreferences, loadWorkspaceRunnerPreferences } from "@/lib/runner/preferences";
import { useWorkspaceStore } from "@/stores/workspace-store";

export function useWorkspaceRunnerPreferencesPersistence(): void {
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const workspaceKey = useWorkspaceStore((state) => state.workspaceIdentity?.workspaceKey ?? null);
  const runnerPreferences = useWorkspaceStore((state) => state.runnerPreferences);
  const replaceRunnerPreferences = useWorkspaceStore((state) => state.replaceRunnerPreferences);

  const hydratedKeyRef = useRef<string | null>(null);
  const isHydratingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const scope = { workspaceKey, workspaceRootPath };
    const normalizedKey = getWorkspaceRunnerPreferencesStorageKey(scope);

    if (!normalizedKey) {
      hydratedKeyRef.current = null;
      replaceRunnerPreferences(createRunnerPreferenceDefaults());
      return;
    }

    isHydratingRef.current = true;
    void loadWorkspaceRunnerPreferences(scope).then((preferences) => {
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
  }, [replaceRunnerPreferences, workspaceKey, workspaceRootPath]);

  useEffect(() => {
    const scope = { workspaceKey, workspaceRootPath };
    const normalizedKey = getWorkspaceRunnerPreferencesStorageKey(scope);
    if (!normalizedKey || hydratedKeyRef.current !== normalizedKey || isHydratingRef.current) {
      return;
    }

    void saveWorkspaceRunnerPreferences(scope, runnerPreferences);
  }, [runnerPreferences, workspaceKey, workspaceRootPath]);
}
