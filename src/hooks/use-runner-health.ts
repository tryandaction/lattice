"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const commandsKey = commands.join("||");
  const stableCommands = useMemo(
    () => (commandsKey ? commandsKey.split("||").filter(Boolean) : []),
    [commandsKey],
  );

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (mountedRef.current) {
      setIsRefreshing(true);
    }

    try {
      const snapshot = await collectRunnerHealthSnapshot({
        cwd,
        fileKey,
        preferences: runnerPreferences,
        commands: stableCommands,
        checkPython,
      });

      if (mountedRef.current && requestIdRef.current === requestId) {
        setRunnerHealthSnapshot(snapshot);
      }
      return snapshot;
    } finally {
      if (mountedRef.current && requestIdRef.current === requestId) {
        setIsRefreshing(false);
      }
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
