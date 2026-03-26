"use client";

import { useEffect, type RefObject } from "react";
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

        if (persistedState.viewState && applyViewState) {
          applyViewState(persistedState.viewState as TViewState);
        }
      });
    });

    return () => {
      cancelled = true;
      void savePersistedFileViewState(storageKey, {
        scrollTop: container?.scrollTop ?? 0,
        scrollLeft: container?.scrollLeft ?? 0,
        viewState,
      });
    };
  }, [applyViewState, containerRef, storageKey, viewState]);

  useEffect(() => {
    if (!storageKey) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const persist = () => {
      void savePersistedFileViewState(storageKey, {
        scrollTop: container.scrollTop,
        scrollLeft: container.scrollLeft,
        viewState,
      });
    };

    container.addEventListener("scroll", persist, { passive: true });
    return () => {
      container.removeEventListener("scroll", persist);
    };
  }, [containerRef, storageKey, viewState]);
}
