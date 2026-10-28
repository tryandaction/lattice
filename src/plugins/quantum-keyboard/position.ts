export function positionQuantumPanel({
  width, height, dock, contentHeight, offset = { x: 0, y: 0 },
}: { width: number; height: number; dock: "top" | "bottom"; contentHeight?: number; offset?: { x: number; y: number } }) {
  const margin = Math.min(12, width / 4, height / 4);
  const panelWidth = Math.max(1, Math.min(1240, width - margin * 2));
  const desiredHeight = typeof contentHeight === "number" && Number.isFinite(contentHeight) && contentHeight > 0 ? contentHeight : 520;
  const panelHeight = Math.max(1, Math.min(desiredHeight, height - margin * 2));
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
  return {
    width: panelWidth, height: panelHeight,
    left: clamp((width - panelWidth) / 2 + offset.x, margin, width - panelWidth - margin),
    top: clamp((dock === "top" ? margin : height - panelHeight - margin) + offset.y, margin, height - panelHeight - margin),
  };
}
