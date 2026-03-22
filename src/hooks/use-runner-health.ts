"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collectRunnerHealthSnapshot, createEmptyRunnerHealthSnapshot } from "@/lib/runner/health";
import { useWorkspaceStore } from "@/stores/workspace-store";

interface UseRunnerHealthOptions {
  cwd?: string;
  fileKey?: string;
  commands?: string[];
  checkPython?: boolean;
  autoRefresh?: boolean;
}

export function useRunnerHealth({
  cwd,
  fileKey,
  commands = [],
  checkPython = false,
  autoRefresh = false,
}: UseRunnerHealthOptions = {}) {
  const runnerPreferences = useWorkspaceStore((state) => state.runnerPreferences);
  const [runnerHealthSnapshot, setRunnerHealthSnapshot] = useState(createEmptyRunnerHealthSnapshot);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const commandsKey = commands.join("||");
  const stableCommands = useMemo(
    () => (commandsKey ? commandsKey.split("||").filter(Boolean) : []),
    [commandsKey],
  );

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const snapshot = await collectRunnerHealthSnapshot({
        cwd,
        fileKey,
        preferences: runnerPreferences,
        commands: stableCommands,
        checkPython,
      });
      setRunnerHealthSnapshot(snapshot);
      return snapshot;
    } finally {
      setIsRefreshing(false);
    }
  }, [checkPython, cwd, fileKey, runnerPreferences, stableCommands]);

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
  };
}
