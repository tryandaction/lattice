import type { ActivityView } from "@/types/settings";

const DESKTOP_COLLAPSED_SIDEBAR_PX = 56;
const DESKTOP_COLLAPSED_SIDEBAR_MIN_PERCENT = 2.5;
const DESKTOP_COLLAPSED_SIDEBAR_MAX_PERCENT = 4.5;

export function getCollapsedSidebarPercent(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return DESKTOP_COLLAPSED_SIDEBAR_MAX_PERCENT;
  }

  const computed = (DESKTOP_COLLAPSED_SIDEBAR_PX / viewportWidth) * 100;
  return Math.min(
    DESKTOP_COLLAPSED_SIDEBAR_MAX_PERCENT,
    Math.max(DESKTOP_COLLAPSED_SIDEBAR_MIN_PERCENT, computed),
  );
}

export function getCollapsedSidebarPixelWidth(): number {
  return DESKTOP_COLLAPSED_SIDEBAR_PX;
}

export function resolveActivityViewSelection(input: {
  currentView: ActivityView;
  targetView: ActivityView;
  collapsed: boolean;
}): { activityView: ActivityView; collapsed: boolean } {
  return {
    activityView: input.targetView,
    collapsed: input.currentView === input.targetView
      ? !input.collapsed
      : false,
  };
}
