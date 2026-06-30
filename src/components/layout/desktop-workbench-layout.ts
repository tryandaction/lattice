export const DESKTOP_PANEL_MIN = 16;
export const DESKTOP_PANEL_MAX = 45;
export const DESKTOP_AI_PANEL_DEFAULT = 28;
export const DESKTOP_AI_PANEL_MIN = 18;
export const DESKTOP_AI_PANEL_MAX = 42;
export const DESKTOP_AI_PANEL_RESET_THRESHOLD = 52;
export const DESKTOP_MAIN_PANEL_MIN = 24;

export const clampDesktopPluginPanelSize = (value: number) =>
  Math.min(DESKTOP_PANEL_MAX, Math.max(DESKTOP_PANEL_MIN, value));

export const clampDesktopAiPanelSize = (value: number) =>
  Math.min(DESKTOP_AI_PANEL_MAX, Math.max(DESKTOP_AI_PANEL_MIN, value));

export const normalizePersistedDesktopAiPanelSize = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DESKTOP_AI_PANEL_DEFAULT;
  }

  if (value > DESKTOP_AI_PANEL_RESET_THRESHOLD) {
    return DESKTOP_AI_PANEL_DEFAULT;
  }

  return clampDesktopAiPanelSize(value);
};

export type DesktopRightPanelKind = "plugin" | "ai";

export interface DesktopWorkbenchPanel {
  kind: DesktopRightPanelKind;
  size: number;
  minSize: number;
  maxSize: number;
}

export interface DesktopWorkbenchLayout {
  sidebarSize: number;
  rightPanels: DesktopWorkbenchPanel[];
  sizes: number[];
}

export interface DesktopWorkbenchResizeState {
  sidebarSize?: number;
  pluginPanelSize?: number;
  aiPanelSize?: number;
}

export function getDesktopSidebarMaxSize(rightPanels: DesktopWorkbenchPanel[]): number {
  const reservedRightMin = rightPanels.reduce((sum, panel) => sum + panel.minSize, 0);
  return Math.min(42, Math.max(14, 100 - DESKTOP_MAIN_PANEL_MIN - reservedRightMin));
}

export function getDesktopPluginPanelIndex(sidebarCollapsed: boolean): number {
  return sidebarCollapsed ? 1 : 2;
}

export function getDesktopPluginResizeHandleIndex(sidebarCollapsed: boolean): number {
  return getDesktopPluginPanelIndex(sidebarCollapsed) - 1;
}

export function getDesktopAiPanelIndex(sidebarCollapsed: boolean, showPluginPanels: boolean): number {
  const mainPanelIndex = sidebarCollapsed ? 0 : 1;
  return mainPanelIndex + (showPluginPanels ? 2 : 1);
}

export function getDesktopAiResizeHandleIndex(sidebarCollapsed: boolean, showPluginPanels: boolean): number {
  return getDesktopAiPanelIndex(sidebarCollapsed, showPluginPanels) - 1;
}

function fitRightPanelsToAvailableSpace(
  panels: DesktopWorkbenchPanel[],
  maxTotal: number,
): DesktopWorkbenchPanel[] {
  if (panels.length === 0) {
    return [];
  }

  const minTotal = panels.reduce((sum, panel) => sum + panel.minSize, 0);
  if (maxTotal <= minTotal) {
    return panels.map((panel) => ({ ...panel, size: panel.minSize }));
  }

  const extraCapacity = maxTotal - minTotal;
  const requestedExtraTotal = panels.reduce(
    (sum, panel) => sum + Math.max(0, Math.min(panel.maxSize, panel.size) - panel.minSize),
    0,
  );

  return panels.map((panel) => {
    const requested = Math.max(panel.minSize, Math.min(panel.maxSize, panel.size));
    if (requestedExtraTotal <= 0) {
      return { ...panel, size: panel.minSize };
    }

    const requestedExtra = Math.max(0, requested - panel.minSize);
    return {
      ...panel,
      size: Math.min(
        panel.maxSize,
        panel.minSize + (requestedExtra / requestedExtraTotal) * extraCapacity,
      ),
    };
  });
}

export function buildDesktopWorkbenchLayout(options: {
  sidebarCollapsed: boolean;
  requestedSidebarSize: number;
  showPluginPanels: boolean;
  requestedPluginPanelSize: number;
  showAiPanel: boolean;
  requestedAiPanelSize: number;
}): DesktopWorkbenchLayout {
  const rightPanels: DesktopWorkbenchPanel[] = [];
  if (options.showPluginPanels) {
    rightPanels.push({
      kind: "plugin",
      size: clampDesktopPluginPanelSize(options.requestedPluginPanelSize),
      minSize: DESKTOP_PANEL_MIN,
      maxSize: DESKTOP_PANEL_MAX,
    });
  }
  if (options.showAiPanel) {
    rightPanels.push({
      kind: "ai",
      size: clampDesktopAiPanelSize(options.requestedAiPanelSize),
      minSize: DESKTOP_AI_PANEL_MIN,
      maxSize: DESKTOP_AI_PANEL_MAX,
    });
  }

  if (options.sidebarCollapsed) {
    const fittedRightPanels = fitRightPanelsToAvailableSpace(
      rightPanels,
      100 - DESKTOP_MAIN_PANEL_MIN,
    );
    const rightTotal = fittedRightPanels.reduce((sum, panel) => sum + panel.size, 0);
    return {
      sidebarSize: 0,
      rightPanels: fittedRightPanels,
      sizes: [100 - rightTotal, ...fittedRightPanels.map((panel) => panel.size)],
    };
  }

  const sidebarSize = Math.min(
    Math.max(14, options.requestedSidebarSize),
    getDesktopSidebarMaxSize(rightPanels),
  );
  const fittedRightPanels = fitRightPanelsToAvailableSpace(
    rightPanels,
    100 - sidebarSize - DESKTOP_MAIN_PANEL_MIN,
  );
  const rightTotal = fittedRightPanels.reduce((sum, panel) => sum + panel.size, 0);

  return {
    sidebarSize,
    rightPanels: fittedRightPanels,
    sizes: [sidebarSize, 100 - sidebarSize - rightTotal, ...fittedRightPanels.map((panel) => panel.size)],
  };
}

export function resolveDesktopWorkbenchResize(options: {
  sidebarCollapsed: boolean;
  sizes: number[];
  rightPanels: DesktopWorkbenchPanel[];
}): DesktopWorkbenchResizeState {
  const next: DesktopWorkbenchResizeState = {};

  if (!options.sidebarCollapsed && typeof options.sizes[0] === "number") {
    next.sidebarSize = Math.min(
      getDesktopSidebarMaxSize(options.rightPanels),
      Math.max(14, options.sizes[0]),
    );
  }

  const rightPanelStartIndex = options.sidebarCollapsed ? 1 : 2;
  options.rightPanels.forEach((panel, index) => {
    const size = options.sizes[rightPanelStartIndex + index];
    if (typeof size !== "number") {
      return;
    }

    if (panel.kind === "plugin") {
      next.pluginPanelSize = clampDesktopPluginPanelSize(size);
      return;
    }

    next.aiPanelSize = clampDesktopAiPanelSize(size);
  });

  return next;
}
