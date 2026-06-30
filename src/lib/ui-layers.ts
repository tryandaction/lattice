import type { CSSProperties } from "react";

export const UI_LAYER_CLASS = {
  desktopResizeHandle: "z-[90]",
  chrome: "z-[70]",
  chromeMenu: "z-[140]",
  floatingPanel: "z-[170]",
  pdfFloating: "z-[130]",
  dialog: "z-[180]",
  dialogElevated: "z-[190]",
  hud: "z-[210]",
} as const;

export type UiLayer = keyof typeof UI_LAYER_CLASS;

export const UI_MODAL_OVERLAY_CLASS = [
  "fixed inset-0",
  "bg-background/95 backdrop-blur-md isolate",
  UI_LAYER_CLASS.dialogElevated,
].join(" ");

export const UI_MODAL_PANEL_CLASS = "relative z-10 border border-border bg-background shadow-2xl";

export const UI_MODAL_OVERLAY_STYLE = {
  zIndex: "var(--z-dialog-elevated)",
} satisfies CSSProperties;

export const UI_LAYER = {
  pdfSearchMatchOverlay: 11,
  pdfTransientSelectionOverlay: 12,
  pdfTextAnnotation: 15,
  pdfPinAnnotation: 18,
  pdfStoredAnnotationOverlay: 24,
  pdfSelectionToolbar: 80,
  pdfStoredAnnotationPopup: 90,
  pdfAnnotationDefaultsMenu: 150,
} as const;

export type UiLayerValue = keyof typeof UI_LAYER;
