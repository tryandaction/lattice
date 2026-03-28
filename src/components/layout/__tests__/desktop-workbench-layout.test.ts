import { describe, expect, it } from "vitest";
import {
  buildDesktopWorkbenchLayout,
  DESKTOP_AI_PANEL_MIN,
  DESKTOP_PANEL_MIN,
  getDesktopSidebarMaxSize,
} from "../desktop-workbench-layout";

describe("desktop-workbench-layout", () => {
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

  it("reduces the maximum sidebar width when both right docks are visible", () => {
    const maxSidebar = getDesktopSidebarMaxSize([
      { kind: "plugin", size: 22, minSize: DESKTOP_PANEL_MIN, maxSize: 45 },
      { kind: "ai", size: 28, minSize: DESKTOP_AI_PANEL_MIN, maxSize: 42 },
    ]);

    expect(maxSidebar).toBeLessThan(42);
  });
});
