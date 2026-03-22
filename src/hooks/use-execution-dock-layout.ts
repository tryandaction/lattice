"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import type { ExecutionDockLayout } from "@/types/settings";

export type ExecutionDockTab = "run" | "problems";

const MIN_DOCK_SIZE = 18;
const MAX_DOCK_SIZE = 70;

function clampDockSize(size: number): number {
  return Math.max(MIN_DOCK_SIZE, Math.min(MAX_DOCK_SIZE, size));
}

interface UseExecutionDockLayoutOptions {
  paneId: string;
  surfaceId: string;
  defaultSize?: number;
  defaultOpen?: boolean;
  defaultTab?: ExecutionDockTab;
}

export function useExecutionDockLayout({
  paneId,
  surfaceId,
  defaultSize = 38,
  defaultOpen = false,
  defaultTab = "run",
}: UseExecutionDockLayoutOptions) {
  const isInitialized = useSettingsStore((state) => state.isInitialized);
  const dockLayouts = useSettingsStore((state) => state.settings.executionDockLayouts);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const storageKey = useMemo(() => `${surfaceId}:${paneId}`, [paneId, surfaceId]);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localLayoutState, setLocalLayoutState] = useState<{
    key: string;
    layout: ExecutionDockLayout | null;
  }>({
    key: storageKey,
    layout: null,
  });

  const storedLayout = useMemo(() => {
    if (!isInitialized) {
      return null;
    }
    return dockLayouts?.[storageKey] ?? null;
  }, [dockLayouts, isInitialized, storageKey]);

  const localLayout = localLayoutState.key === storageKey ? localLayoutState.layout : null;
  const effectiveLayout = localLayout ?? storedLayout ?? {
    size: clampDockSize(defaultSize),
    open: defaultOpen,
    activeTab: defaultTab,
  };

  const persist = useCallback((nextLayout: ExecutionDockLayout) => {
    if (!isInitialized) {
      return;
    }

    const payload: ExecutionDockLayout = {
      size: clampDockSize(nextLayout.size),
      open: nextLayout.open,
      activeTab: nextLayout.activeTab ?? defaultTab,
    };

    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }

    persistTimerRef.current = setTimeout(() => {
      void updateSetting("executionDockLayouts", {
        ...(dockLayouts ?? {}),
        [storageKey]: payload,
      });
    }, 120);
  }, [defaultTab, dockLayouts, isInitialized, storageKey, updateSetting]);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
    };
  }, []);

  const setSize = useCallback((size: number) => {
    const next = clampDockSize(size);
    setLocalLayoutState({
      key: storageKey,
      layout: {
        size: next,
        open: effectiveLayout.open,
        activeTab: effectiveLayout.activeTab,
      },
    });
    persist({
      size: next,
      open: effectiveLayout.open,
      activeTab: effectiveLayout.activeTab,
    });
  }, [effectiveLayout.activeTab, effectiveLayout.open, persist, storageKey]);

  const setIsDockOpen = useCallback((open: boolean | ((current: boolean) => boolean)) => {
    const next = typeof open === "function" ? open(effectiveLayout.open) : open;
    setLocalLayoutState({
      key: storageKey,
      layout: {
        size: effectiveLayout.size,
        open: next,
        activeTab: effectiveLayout.activeTab,
      },
    });
    persist({
      size: effectiveLayout.size,
      open: next,
      activeTab: effectiveLayout.activeTab,
    });
  }, [effectiveLayout.activeTab, effectiveLayout.open, effectiveLayout.size, persist, storageKey]);

  const setActiveDockTab = useCallback((tab: ExecutionDockTab) => {
    setLocalLayoutState({
      key: storageKey,
      layout: {
        size: effectiveLayout.size,
        open: effectiveLayout.open,
        activeTab: tab,
      },
    });
    persist({
      size: effectiveLayout.size,
      open: effectiveLayout.open,
      activeTab: tab,
    });
  }, [effectiveLayout.open, effectiveLayout.size, persist, storageKey]);

  return {
    dockSize: effectiveLayout.size,
    isDockOpen: effectiveLayout.open,
    activeDockTab: effectiveLayout.activeTab ?? defaultTab,
    setDockSize: setSize,
    setIsDockOpen,
    setActiveDockTab,
  };
}
