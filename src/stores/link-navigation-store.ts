import { create } from "zustand";
import type { PaneId } from "@/types/layout";
import type { WorkspaceNavigationTarget } from "@/lib/link-router/types";
import { isSameWorkspacePath } from "@/lib/link-router/path-utils";

export interface PendingPaneNavigation {
  filePath: string;
  target: WorkspaceNavigationTarget;
  requestedAt: number;
}

interface LinkNavigationState {
  pendingByPane: Record<PaneId, PendingPaneNavigation | undefined>;
  setPendingNavigation: (paneId: PaneId, navigation: Omit<PendingPaneNavigation, "requestedAt">) => void;
  clearPendingNavigation: (paneId: PaneId) => void;
  consumePendingNavigation: (paneId: PaneId, filePath: string) => PendingPaneNavigation | null;
}

export const useLinkNavigationStore = create<LinkNavigationState>((set, get) => ({
  pendingByPane: {},

  setPendingNavigation: (paneId, navigation) =>
    set((state) => ({
      pendingByPane: {
        ...state.pendingByPane,
        [paneId]: {
          ...navigation,
          requestedAt: Date.now(),
        },
      },
    })),

  clearPendingNavigation: (paneId) =>
    set((state) => ({
      pendingByPane: {
        ...state.pendingByPane,
        [paneId]: undefined,
      },
    })),

  consumePendingNavigation: (paneId, filePath) => {
    const pending = get().pendingByPane[paneId];
    if (!pending || !isSameWorkspacePath(pending.filePath, filePath)) {
      return null;
    }

    set((state) => ({
      pendingByPane: {
        ...state.pendingByPane,
        [paneId]: undefined,
      },
    }));

    return pending;
  },
}));
