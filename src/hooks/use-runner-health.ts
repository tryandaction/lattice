"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { appendRunnerHealthIssues, collectRunnerHealthSnapshot, createEmptyRunnerHealthSnapshot } from "@/lib/runner/health";
import type { RunnerHealthIssue } from "@/lib/runner/types";
import { useWorkspaceStore } from "@/stores/workspace-store";

interface UseRunnerHealthOptions {
  cwd?: string;
  fileKey?: string;
  commands?: string[];
  autoRefresh?: boolean;
}

export function useRunnerHealth({
  cwd,
  fileKey,
  commands = [],
  autoRefresh = false,
}: UseRunnerHealthOptions = {}) {
  const runnerPreferences = useWorkspaceStore((state) => state.runnerPreferences);
  const runnerHealthSnapshot = useWorkspaceStore((state) => state.runnerHealthSnapshot);
  const setRunnerHealthSnapshot = useWorkspaceStore((state) => state.setRunnerHealthSnapshot);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const commandsKey = commands.join("||");
  const stableCommands = useMemo(
    () => (commandsKey ? commandsKey.split("||").filter(Boolean) : []),
    [commandsKey],
  );

  const refresh = useCallback(async (runtimeIssues: RunnerHealthIssue[] = []) => {
    setIsRefreshing(true);
    try {
      const snapshot = await collectRunnerHealthSnapshot({
        cwd,
        fileKey,
        preferences: runnerPreferences,
        commands: stableCommands,
        runtimeIssues,
      });
      setRunnerHealthSnapshot(snapshot);
      return snapshot;
    } finally {
      setIsRefreshing(false);
    }
  }, [cwd, fileKey, runnerPreferences, setRunnerHealthSnapshot, stableCommands]);

  const mergeRuntimeIssues = useCallback((issues: RunnerHealthIssue[]) => {
    const baseSnapshot = runnerHealthSnapshot.checkedAt > 0
      ? runnerHealthSnapshot
      : createEmptyRunnerHealthSnapshot();
    setRunnerHealthSnapshot(appendRunnerHealthIssues(baseSnapshot, issues));
  }, [runnerHealthSnapshot, setRunnerHealthSnapshot]);

  useEffect(() => {
    if (!autoRefresh) {
      return;
    }
    void refresh();
  }, [autoRefresh, refresh]);

  return {
    runnerHealthSnapshot,
    isRefreshing,
    refresh,
    mergeRuntimeIssues,
  };
}
