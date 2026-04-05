"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { loadPersistedFileViewState, savePersistedFileViewState } from "@/lib/file-view-state";

interface UsePersistedViewStateOptions<TViewState extends Record<string, unknown> | undefined = Record<string, unknown> | undefined> {
  storageKey: string | null | undefined;
  containerRef: RefObject<HTMLElement | null>;
  viewState?: TViewState;
  applyViewState?: (viewState: TViewState) => void;
}

interface PersistedSnapshot<TViewState extends Record<string, unknown> | undefined> {
  scrollTop: number;
  scrollLeft: number;
  viewState: TViewState;
}

export function usePersistedViewState<TViewState extends Record<string, unknown> | undefined = Record<string, unknown> | undefined>({
  storageKey,
  containerRef,
  viewState,
  applyViewState,
}: UsePersistedViewStateOptions<TViewState>) {
  const latestViewStateRef = useRef<TViewState>(viewState);
  const latestApplyViewStateRef = useRef<typeof applyViewState>(applyViewState);
  const latestSnapshotRef = useRef<PersistedSnapshot<TViewState> | null>(null);
  const debounceTimeoutRef = useRef<number | null>(null);
  const idleCallbackRef = useRef<number | null>(null);

  const clearScheduledPersist = useCallback(() => {
    if (debounceTimeoutRef.current !== null) {
      window.clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }

    if (idleCallbackRef.current !== null) {
      const idleWindow = window as Window & {
        cancelIdleCallback?: (handle: number) => void;
      };
      idleWindow.cancelIdleCallback?.(idleCallbackRef.current);
      idleCallbackRef.current = null;
    }
  }, []);

  const captureSnapshot = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return null;
    }

    const snapshot: PersistedSnapshot<TViewState> = {
      scrollTop: container.scrollTop,
      scrollLeft: container.scrollLeft,
      viewState: latestViewStateRef.current as TViewState,
    };
    latestSnapshotRef.current = snapshot;
    return snapshot;
  }, [containerRef]);

  const flushPersist = useCallback(() => {
    if (!storageKey) {
      return;
    }

    clearScheduledPersist();
    const snapshot = captureSnapshot() ?? latestSnapshotRef.current;
    if (!snapshot) {
      return;
    }

    void savePersistedFileViewState(storageKey, snapshot);
  }, [captureSnapshot, clearScheduledPersist, storageKey]);

  useEffect(() => {
    latestViewStateRef.current = viewState;
    captureSnapshot();
  }, [captureSnapshot, viewState]);

  useEffect(() => {
    latestApplyViewStateRef.current = applyViewState;
  }, [applyViewState]);

  useEffect(() => {
    if (!storageKey) {
      return;
    }

    let cancelled = false;
    void loadPersistedFileViewState(storageKey).then((persistedState) => {
      if (cancelled || !persistedState) {
        return;
      }

      requestAnimationFrame(() => {
        const container = containerRef.current;
        if (container) {
          container.scrollTop = persistedState.scrollTop ?? 0;
          container.scrollLeft = persistedState.scrollLeft ?? 0;
          latestSnapshotRef.current = {
            scrollTop: container.scrollTop,
            scrollLeft: container.scrollLeft,
            viewState: ((persistedState.viewState as TViewState | undefined) ?? latestViewStateRef.current) as TViewState,
          };
        }

        if (persistedState.viewState && latestApplyViewStateRef.current) {
          latestApplyViewStateRef.current(persistedState.viewState as TViewState);
        }
      });
    });

    return () => {
      cancelled = true;
      flushPersist();
    };
  }, [containerRef, flushPersist, storageKey]);

  useEffect(() => {
    if (!storageKey) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const schedulePersist = () => {
      captureSnapshot();
      clearScheduledPersist();

      debounceTimeoutRef.current = window.setTimeout(() => {
        debounceTimeoutRef.current = null;
        const idleWindow = window as Window & {
          requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
        };
        if (idleWindow.requestIdleCallback) {
          idleCallbackRef.current = idleWindow.requestIdleCallback(() => {
            idleCallbackRef.current = null;
            flushPersist();
          }, { timeout: 1000 });
          return;
        }

        flushPersist();
      }, 320);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPersist();
      }
    };

    container.addEventListener("scroll", schedulePersist, { passive: true });
    window.addEventListener("blur", flushPersist);
    window.addEventListener("pagehide", flushPersist);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      container.removeEventListener("scroll", schedulePersist);
      window.removeEventListener("blur", flushPersist);
      window.removeEventListener("pagehide", flushPersist);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearScheduledPersist();
    };
  }, [captureSnapshot, clearScheduledPersist, containerRef, flushPersist, storageKey]);
}
