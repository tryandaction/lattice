"use client";

import { useEffect, useRef, type RefObject } from "react";
import { loadPersistedFileViewState, savePersistedFileViewState } from "@/lib/file-view-state";

interface UsePersistedViewStateOptions<TViewState extends Record<string, unknown> | undefined = Record<string, unknown> | undefined> {
  storageKey: string | null | undefined;
  containerRef: RefObject<HTMLElement | null>;
  viewState?: TViewState;
  applyViewState?: (viewState: TViewState) => void;
}

export function usePersistedViewState<TViewState extends Record<string, unknown> | undefined = Record<string, unknown> | undefined>({
  storageKey,
  containerRef,
  viewState,
  applyViewState,
}: UsePersistedViewStateOptions<TViewState>) {
  const latestViewStateRef = useRef<TViewState>(viewState);
  const latestApplyViewStateRef = useRef<typeof applyViewState>(applyViewState);

  useEffect(() => {
    latestViewStateRef.current = viewState;
  }, [viewState]);

  useEffect(() => {
    latestApplyViewStateRef.current = applyViewState;
  }, [applyViewState]);

  useEffect(() => {
    if (!storageKey) {
      return;
    }

    const container = containerRef.current;
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
        }

        if (persistedState.viewState && latestApplyViewStateRef.current) {
          latestApplyViewStateRef.current(persistedState.viewState as TViewState);
        }
      });
    });

    return () => {
      cancelled = true;
      void savePersistedFileViewState(storageKey, {
        scrollTop: container?.scrollTop ?? 0,
        scrollLeft: container?.scrollLeft ?? 0,
        viewState: latestViewStateRef.current,
      });
    };
  }, [containerRef, storageKey]);

  useEffect(() => {
    if (!storageKey) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    let frameId = 0;
    let timeoutId: number | null = null;

    const persist = () => {
      void savePersistedFileViewState(storageKey, {
        scrollTop: container.scrollTop,
        scrollLeft: container.scrollLeft,
        viewState: latestViewStateRef.current,
      });
    };

    const schedulePersist = () => {
      if (frameId) {
        return;
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
        timeoutId = window.setTimeout(() => {
          timeoutId = null;
          persist();
        }, 160);
      });
    };

    container.addEventListener("scroll", schedulePersist, { passive: true });
    return () => {
      container.removeEventListener("scroll", schedulePersist);
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [containerRef, storageKey]);
}
