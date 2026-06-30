import { describe, expect, it } from "vitest";
import { UI_LAYER, UI_LAYER_CLASS, UI_MODAL_OVERLAY_CLASS, UI_MODAL_OVERLAY_STYLE } from "@/lib/ui-layers";

describe("UI_LAYER_CLASS", () => {
  it("exposes semantic z-index classes instead of raw numeric layers", () => {
    expect(UI_LAYER_CLASS.dialog).toBe("z-[180]");
    expect(UI_LAYER_CLASS.dialogElevated).toBe("z-[190]");
    expect(UI_LAYER_CLASS.dialogElevated).not.toBe(UI_LAYER_CLASS.desktopResizeHandle);
  });

  it("keeps PDF internal layers below global floating panels", () => {
    expect(UI_LAYER.pdfSearchMatchOverlay).toBeLessThan(UI_LAYER.pdfStoredAnnotationOverlay);
    expect(UI_LAYER.pdfStoredAnnotationOverlay).toBeLessThan(UI_LAYER.pdfSelectionToolbar);
  });

  it("uses elevated dialog layering for modal overlays", () => {
    expect(UI_MODAL_OVERLAY_CLASS).toContain(UI_LAYER_CLASS.dialogElevated);
    expect(UI_MODAL_OVERLAY_CLASS).toContain("bg-background/95");
    expect(UI_MODAL_OVERLAY_CLASS).toContain("isolate");
    expect(UI_MODAL_OVERLAY_STYLE.zIndex).toBe("var(--z-dialog-elevated)");
  });
});
