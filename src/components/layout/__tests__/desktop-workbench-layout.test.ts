import { describe, expect, it } from "vitest";
import {
  buildDesktopWorkbenchLayout,
  DESKTOP_AI_PANEL_DEFAULT,
  DESKTOP_AI_PANEL_MIN,
  DESKTOP_AI_PANEL_MAX,
  DESKTOP_MAIN_PANEL_MIN,
  DESKTOP_PANEL_MIN,
  getDesktopAiPanelIndex,
  getDesktopAiResizeHandleIndex,
  getDesktopSidebarMaxSize,
  normalizePersistedDesktopAiPanelSize,
  resolveDesktopWorkbenchResize,
} from "../desktop-workbench-layout";

describe("desktop-workbench-layout", () => {
  it.each([0, 1, 5, 13])('preserves an explicitly narrow %s percent file sidebar', width => {
    const layout = buildDesktopWorkbenchLayout({ sidebarCollapsed: false, requestedSidebarSize: width, showPluginPanels: false, requestedPluginPanelSize: 22, showAiPanel: true, requestedAiPanelSize: 28 });
    expect(layout.sidebarSize).toBe(width);
    expect(layout.sizes.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100);
    expect(resolveDesktopWorkbenchResize({ sidebarCollapsed: false, sizes: layout.sizes, rightPanels: layout.rightPanels }).sidebarSize).toBe(width);
  });

  it("places AI as the rightmost dock panel after plugin panels", () => {
    const layout = buildDesktopWorkbenchLayout({
      sidebarCollapsed: false,
      requestedSidebarSize: 20,
      showPluginPanels: true,
      requestedPluginPanelSize: 22,
      showAiPanel: true,
      requestedAiPanelSize: 28,
    });

    expect(layout.rightPanels.map((panel) => panel.kind)).toEqual(["plugin", "ai"]);
    expect(layout.sizes).toHaveLength(4);
    expect(layout.sizes[3]).toBeGreaterThan(layout.sizes[2]);
  });

  it("keeps the sidebar usable when both right docks are visible", () => {
    const maxSidebar = getDesktopSidebarMaxSize([
      { kind: "plugin", size: 22, minSize: DESKTOP_PANEL_MIN, maxSize: 45 },
      { kind: "ai", size: 28, minSize: DESKTOP_AI_PANEL_MIN, maxSize: 42 },
    ]);

    expect(maxSidebar).toBe(Math.min(
      42,
      100 - DESKTOP_MAIN_PANEL_MIN - DESKTOP_PANEL_MIN - DESKTOP_AI_PANEL_MIN,
    ));
  });

  it("maps a visible AI dock resize back to the AI panel setting", () => {
    const layout = buildDesktopWorkbenchLayout({
      sidebarCollapsed: false,
      requestedSidebarSize: 20,
      showPluginPanels: false,
      requestedPluginPanelSize: 22,
      showAiPanel: true,
      requestedAiPanelSize: 28,
    });

    expect(resolveDesktopWorkbenchResize({
      sidebarCollapsed: false,
      sizes: [20, 44, 36],
      rightPanels: layout.rightPanels,
    })).toEqual({
      sidebarSize: 20,
      aiPanelSize: 36,
    });
  });

  it("preserves a resized AI dock width when the controlled layout rebuilds", () => {
    const initialLayout = buildDesktopWorkbenchLayout({
      sidebarCollapsed: false,
      requestedSidebarSize: 20,
      showPluginPanels: false,
      requestedPluginPanelSize: 22,
      showAiPanel: true,
      requestedAiPanelSize: DESKTOP_AI_PANEL_MAX,
    });
    const resized = resolveDesktopWorkbenchResize({
      sidebarCollapsed: false,
      sizes: [20, 48, 32],
      rightPanels: initialLayout.rightPanels,
    });

    const rebuiltLayout = buildDesktopWorkbenchLayout({
      sidebarCollapsed: false,
      requestedSidebarSize: resized.sidebarSize ?? 20,
      showPluginPanels: false,
      requestedPluginPanelSize: 22,
      showAiPanel: true,
      requestedAiPanelSize: resized.aiPanelSize ?? DESKTOP_AI_PANEL_DEFAULT,
    });

    expect(resized.aiPanelSize).toBe(32);
    expect(rebuiltLayout.sizes).toEqual([20, 48, 32]);
  });

  it("resolves stable AI dock panel and handle indexes for every desktop shell shape", () => {
    expect(getDesktopAiPanelIndex(false, false)).toBe(2);
    expect(getDesktopAiResizeHandleIndex(false, false)).toBe(1);

    expect(getDesktopAiPanelIndex(false, true)).toBe(3);
    expect(getDesktopAiResizeHandleIndex(false, true)).toBe(2);

    expect(getDesktopAiPanelIndex(true, false)).toBe(1);
    expect(getDesktopAiResizeHandleIndex(true, false)).toBe(0);

    expect(getDesktopAiPanelIndex(true, true)).toBe(2);
    expect(getDesktopAiResizeHandleIndex(true, true)).toBe(1);
  });

  it("maps AI dock resize when the left activity panel is collapsed", () => {
    const layout = buildDesktopWorkbenchLayout({
      sidebarCollapsed: true,
      requestedSidebarSize: 20,
      showPluginPanels: false,
      requestedPluginPanelSize: 22,
      showAiPanel: true,
      requestedAiPanelSize: 28,
    });

    expect(resolveDesktopWorkbenchResize({
      sidebarCollapsed: true,
      sizes: [66, 34],
      rightPanels: layout.rightPanels,
    })).toEqual({
      aiPanelSize: 34,
    });
  });

  it("clamps AI panel resize results to the desktop bounds", () => {
    const layout = buildDesktopWorkbenchLayout({
      sidebarCollapsed: true,
      requestedSidebarSize: 20,
      showPluginPanels: false,
      requestedPluginPanelSize: 22,
      showAiPanel: true,
      requestedAiPanelSize: 28,
    });

    expect(resolveDesktopWorkbenchResize({
      sidebarCollapsed: true,
      sizes: [10, 90],
      rightPanels: layout.rightPanels,
    })).toEqual({
      aiPanelSize: DESKTOP_AI_PANEL_MAX,
    });

    expect(resolveDesktopWorkbenchResize({
      sidebarCollapsed: true,
      sizes: [96, 4],
      rightPanels: layout.rightPanels,
    })).toEqual({
      aiPanelSize: DESKTOP_AI_PANEL_MIN,
    });
  });

  it("keeps the AI dock in a side-panel width range", () => {
    const layout = buildDesktopWorkbenchLayout({
      sidebarCollapsed: true,
      requestedSidebarSize: 20,
      showPluginPanels: false,
      requestedPluginPanelSize: 22,
      showAiPanel: true,
      requestedAiPanelSize: DESKTOP_AI_PANEL_MAX,
    });

    expect(layout.sizes).toEqual([100 - DESKTOP_AI_PANEL_MAX, DESKTOP_AI_PANEL_MAX]);
    expect(DESKTOP_AI_PANEL_MAX).toBeGreaterThan(DESKTOP_AI_PANEL_DEFAULT);
    expect(DESKTOP_AI_PANEL_MAX).toBe(52);
    expect(DESKTOP_AI_PANEL_DEFAULT).toBe(38);
    expect(DESKTOP_AI_PANEL_MIN).toBeLessThanOrEqual(8);
  });

  it("preserves a deliberately compact AI dock instead of forcing it back to a third of the window", () => {
    const layout = buildDesktopWorkbenchLayout({
      sidebarCollapsed: true,
      requestedSidebarSize: 20,
      showPluginPanels: false,
      requestedPluginPanelSize: 22,
      showAiPanel: true,
      requestedAiPanelSize: 8,
    });

    expect(layout.sizes).toEqual([92, 8]);
    expect(resolveDesktopWorkbenchResize({
      sidebarCollapsed: true,
      sizes: [92, 8],
      rightPanels: layout.rightPanels,
    })).toEqual({ aiPanelSize: 8 });
  });

  it("resets oversized persisted AI dock widths from older builds", () => {
    expect(normalizePersistedDesktopAiPanelSize(70)).toBe(DESKTOP_AI_PANEL_DEFAULT);
    expect(normalizePersistedDesktopAiPanelSize(28)).toBe(DESKTOP_AI_PANEL_DEFAULT);
    expect(normalizePersistedDesktopAiPanelSize(36)).toBe(36);
    expect(normalizePersistedDesktopAiPanelSize(8)).toBe(DESKTOP_AI_PANEL_MIN);
    expect(normalizePersistedDesktopAiPanelSize(undefined)).toBe(DESKTOP_AI_PANEL_DEFAULT);
  });
});
