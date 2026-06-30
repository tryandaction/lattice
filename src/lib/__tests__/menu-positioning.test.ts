import { describe, expect, it } from "vitest";
import { positionAnchoredMenu, positionCursorMenu } from "../menu-positioning";

const viewport = { width: 1024, height: 768 };

describe("menu-positioning", () => {
  it("flips anchored submenus to the left when right space is insufficient", () => {
    const result = positionAnchoredMenu({
      anchorRect: { left: 900, top: 700, right: 920, bottom: 720, width: 20, height: 20 },
      menuSize: { width: 260, height: 180 },
      viewport,
      placement: "right-start",
    });

    expect(result.side).toBe("left");
    expect(result.left).toBeLessThan(900);
    expect(result.top).toBeLessThanOrEqual(768 - 180 - 8);
  });

  it("flips bottom anchored menus above the trigger when bottom space is insufficient", () => {
    const result = positionAnchoredMenu({
      anchorRect: { left: 100, top: 720, right: 140, bottom: 744, width: 40, height: 24 },
      menuSize: { width: 220, height: 160 },
      viewport,
      placement: "bottom-start",
    });

    expect(result.side).toBe("top");
    expect(result.top).toBeLessThan(720);
    expect(result.left).toBe(100);
  });

  it("keeps cursor menus inside the viewport and exposes max height", () => {
    const result = positionCursorMenu({
      point: { x: 1000, y: 740 },
      menuSize: { width: 240, height: 640 },
      viewport,
    });

    expect(result.side).toBe("cursor");
    expect(result.left).toBe(1024 - 240 - 8);
    expect(result.top).toBeGreaterThanOrEqual(8);
    expect(result.maxHeight).toBeLessThanOrEqual(752);
  });
});
