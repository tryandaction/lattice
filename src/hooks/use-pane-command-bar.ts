"use client";

import { useEffect } from "react";
import type { CommandBarState, PaneId } from "@/types/layout";
import { useWorkspaceStore } from "@/stores/workspace-store";

interface UsePaneCommandBarInput {
  paneId: PaneId | null | undefined;
  scopeId?: string | null;
  state: CommandBarState | null;
}

export function usePaneCommandBar({ paneId, scopeId, state }: UsePaneCommandBarInput): void {
  const setCommandBarState = useWorkspaceStore((store) => store.setCommandBarState);
  const clearCommandBarState = useWorkspaceStore((store) => store.clearCommandBarState);

  useEffect(() => {
    if (!paneId || !state) {
      return;
    }
    setCommandBarState(paneId, {
      ...state,
      scopeId: scopeId ?? state.scopeId ?? null,
    });
  }, [paneId, scopeId, setCommandBarState, state]);

  useEffect(() => {
    if (!paneId) {
      return;
    }

    return () => {
      clearCommandBarState(paneId, scopeId);
    };
  }, [clearCommandBarState, paneId, scopeId]);
}

export default usePaneCommandBar;
