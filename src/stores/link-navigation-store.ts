import { create } from "zustand";
import type { PaneId } from "@/types/layout";
import type { WorkspaceNavigationTarget } from "@/lib/link-router/types";
import type { NavigationStatus } from "@/lib/link-router/types";
import { normalizeWorkspacePath } from "@/lib/link-router/path-utils";

export interface PendingPaneNavigation {
  requestId: string;
  filePath: string;
  target: WorkspaceNavigationTarget;
  requestedAt: number;
}

export interface NavigationOutcome {
  requestId: string;
  status: NavigationStatus;
  completedAt: number;
}

interface LinkNavigationState {
  pendingByPane: Record<PaneId, PendingPaneNavigation | undefined>;
  outcomesByRequestId: Record<string, NavigationOutcome | undefined>;
  setPendingNavigation: (
    paneId: PaneId,
    navigation: Omit<PendingPaneNavigation, "requestedAt" | "requestId"> & { requestId?: string },
  ) => string;
  clearPendingNavigation: (paneId: PaneId) => void;
  consumePendingNavigation: (paneId: PaneId, filePath: string) => PendingPaneNavigation | null;
  claimPendingNavigation: (paneId: PaneId, filePath: string) => PendingPaneNavigation | null;
  completePendingNavigation: (paneId: PaneId, requestId: string, outcome: Pick<NavigationOutcome, "status">) => void;
}

let requestSequence = 0;

function equivalentPath(left: string, right: string): boolean {
  const normalizedLeft = normalizeWorkspacePath(left);
  const normalizedRight = normalizeWorkspacePath(right);
  return normalizedLeft === normalizedRight
    || normalizedLeft.endsWith(`/${normalizedRight}`)
    || normalizedRight.endsWith(`/${normalizedLeft}`);
}

function equivalentTarget(left: PendingPaneNavigation["target"], right: PendingPaneNavigation["target"]): boolean {
  if (left.type !== right.type || !("path" in left) || !("path" in right)) return false;
  if (!equivalentPath(left.path, right.path)) return false;
  switch (left.type) {
    case "pdf_page":
      return right.type === "pdf_page" && left.page === right.page && (left.snippet ?? "") === (right.snippet ?? "");
    case "pdf_annotation":
      return right.type === "pdf_annotation" && left.annotationId === right.annotationId && left.page === right.page;
    case "code_line":
      return right.type === "code_line" && left.line === right.line;
    case "notebook_cell":
      return right.type === "notebook_cell" && left.cellId === right.cellId;
    case "workspace_heading":
      return right.type === "workspace_heading" && left.heading === right.heading;
    case "workspace_text":
      return right.type === "workspace_text" && left.snippet === right.snippet;
  }
}

export const useLinkNavigationStore = create<LinkNavigationState>((set, get) => ({
  pendingByPane: {},
  outcomesByRequestId: {},

  setPendingNavigation: (paneId, navigation) => {
    const existing = get().pendingByPane[paneId];
    if (existing && equivalentPath(existing.filePath, navigation.filePath) && equivalentTarget(existing.target, navigation.target)) {
      return existing.requestId;
    }
    const requestId = navigation.requestId ?? `nav-${Date.now().toString(36)}-${(requestSequence += 1).toString(36)}`;
    set((state) => ({
      pendingByPane: {
        ...state.pendingByPane,
        [paneId]: { ...navigation, requestId, requestedAt: Date.now() },
      },
    }));
    return requestId;
  },

  clearPendingNavigation: (paneId) =>
    set((state) => ({
      pendingByPane: {
        ...state.pendingByPane,
        [paneId]: undefined,
      },
    })),

  consumePendingNavigation: (paneId, filePath) => {
    const pending = get().pendingByPane[paneId];
    if (!pending || !equivalentPath(pending.filePath, filePath)) {
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

  claimPendingNavigation: (paneId, filePath) => {
    const pending = get().pendingByPane[paneId];
    if (!pending || !equivalentPath(pending.filePath, filePath)) {
      return null;
    }
    return pending;
  },

  completePendingNavigation: (paneId, requestId, outcome) =>
    set((state) => ({
      pendingByPane: {
        ...state.pendingByPane,
        ...(state.pendingByPane[paneId]?.requestId === requestId ? { [paneId]: undefined } : {}),
      },
      outcomesByRequestId: {
        ...state.outcomesByRequestId,
        [requestId]: {
          requestId,
          status: outcome.status,
          completedAt: Date.now(),
        },
      },
    })),
}));
