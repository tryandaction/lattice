"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { CommandBarAction, CommandBarState, PaneId } from "@/types/layout";
import { useWorkspaceStore } from "@/stores/workspace-store";

interface UsePaneCommandBarInput {
  paneId: PaneId | null | undefined;
  scopeId?: string | null;
  state: CommandBarState | null;
}

function getActionSignature(action: CommandBarAction) {
  return {
    id: action.id,
    label: action.label,
    icon: action.icon ?? null,
    tooltip: action.tooltip ?? null,
    active: Boolean(action.active),
    disabled: Boolean(action.disabled),
    priority: action.priority ?? null,
    group: action.group ?? null,
    hasTrigger: Boolean(action.onTrigger),
    hasContextMenu: Boolean(action.onContextMenu),
  };
}

function getCommandBarSignature(state: CommandBarState, scopeId: string | null): string {
  return JSON.stringify({
    scopeId,
    breadcrumbs: state.breadcrumbs.map((item) => ({ label: item.label })),
    actions: state.actions.map(getActionSignature),
  });
}

function resolveLatestAction(
  latestState: CommandBarState | null,
  actionId: string,
  actionIndex: number
): CommandBarAction | null {
  if (!latestState) return null;
  const indexed = latestState.actions[actionIndex];
  if (indexed?.id === actionId) {
    return indexed;
  }
  return latestState.actions.find((action) => action.id === actionId) ?? null;
}

function buildStableCommandBarState(
  state: CommandBarState,
  scopeId: string | null,
  latestStateRef: RefObject<CommandBarState | null>
): CommandBarState {
  return {
    scopeId,
    breadcrumbs: state.breadcrumbs.map((item) => ({ label: item.label })),
    actions: state.actions.map((action, index) => {
      const stableAction: CommandBarAction = {
        id: action.id,
        label: action.label,
        icon: action.icon,
        tooltip: action.tooltip,
        active: action.active,
        disabled: action.disabled,
        priority: action.priority,
        group: action.group,
      };

      if (action.onTrigger) {
        stableAction.onTrigger = () => {
          resolveLatestAction(latestStateRef.current, action.id, index)?.onTrigger?.();
        };
      }

      if (action.onContextMenu) {
        stableAction.onContextMenu = (position) => {
          resolveLatestAction(latestStateRef.current, action.id, index)?.onContextMenu?.(position);
        };
      }

      return stableAction;
    }),
  };
}

export function usePaneCommandBar({ paneId, scopeId, state }: UsePaneCommandBarInput): void {
  const setCommandBarState = useWorkspaceStore((store) => store.setCommandBarState);
  const clearCommandBarState = useWorkspaceStore((store) => store.clearCommandBarState);
  const latestStateRef = useRef<CommandBarState | null>(state);
  const effectiveScopeId = scopeId ?? state?.scopeId ?? null;
  const stateSignature = useMemo(
    () => state ? getCommandBarSignature(state, effectiveScopeId) : null,
    [effectiveScopeId, state]
  );

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => {
    const latestState = latestStateRef.current;
    if (!paneId || !latestState || !stateSignature) {
      return;
    }
    setCommandBarState(paneId, {
      ...buildStableCommandBarState(latestState, effectiveScopeId, latestStateRef),
    });
  }, [effectiveScopeId, paneId, setCommandBarState, stateSignature]);

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
