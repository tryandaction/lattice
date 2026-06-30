export type MenuPlacement = "cursor" | "right-start" | "left-start" | "bottom-start" | "top-start";

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PointLike {
  x: number;
  y: number;
}

export interface SizeLike {
  width: number;
  height: number;
}

export interface ViewportLike {
  width: number;
  height: number;
}

export interface MenuPositionResult {
  left: number;
  top: number;
  maxHeight: number;
  side: "right" | "left" | "bottom" | "top" | "cursor";
}

interface AnchoredMenuInput {
  anchorRect: RectLike;
  menuSize: SizeLike;
  viewport: ViewportLike;
  placement: Exclude<MenuPlacement, "cursor">;
  gap?: number;
  padding?: number;
}

interface CursorMenuInput {
  point: PointLike;
  menuSize: SizeLike;
  viewport: ViewportLike;
  padding?: number;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(value, max));
}

function maxMenuHeight(viewport: ViewportLike, padding: number): number {
  return Math.max(120, viewport.height - padding * 2);
}

export function positionCursorMenu({
  point,
  menuSize,
  viewport,
  padding = 8,
}: CursorMenuInput): MenuPositionResult {
  const maxHeight = maxMenuHeight(viewport, padding);
  const effectiveHeight = Math.min(menuSize.height, maxHeight);
  return {
    left: clamp(point.x, padding, viewport.width - menuSize.width - padding),
    top: clamp(point.y, padding, viewport.height - effectiveHeight - padding),
    maxHeight,
    side: "cursor",
  };
}

export function positionAnchoredMenu({
  anchorRect,
  menuSize,
  viewport,
  placement,
  gap = 6,
  padding = 8,
}: AnchoredMenuInput): MenuPositionResult {
  const maxHeight = maxMenuHeight(viewport, padding);
  const effectiveHeight = Math.min(menuSize.height, maxHeight);
  const fitsRight = anchorRect.right + gap + menuSize.width + padding <= viewport.width;
  const fitsLeft = anchorRect.left - gap - menuSize.width >= padding;
  const fitsBottom = anchorRect.bottom + gap + effectiveHeight + padding <= viewport.height;
  const fitsTop = anchorRect.top - gap - effectiveHeight >= padding;

  let side: MenuPositionResult["side"];
  let left: number;
  let top: number;

  if (placement === "right-start" || placement === "left-start") {
    const preferRight = placement === "right-start";
    const useRight = preferRight ? fitsRight || !fitsLeft : !(fitsLeft || !fitsRight);
    side = useRight ? "right" : "left";
    left = useRight ? anchorRect.right + gap : anchorRect.left - menuSize.width - gap;
    top = anchorRect.top;
  } else {
    const preferBottom = placement === "bottom-start";
    const useBottom = preferBottom ? fitsBottom || !fitsTop : !(fitsTop || !fitsBottom);
    side = useBottom ? "bottom" : "top";
    left = anchorRect.left;
    top = useBottom ? anchorRect.bottom + gap : anchorRect.top - effectiveHeight - gap;
  }

  return {
    left: clamp(left, padding, viewport.width - menuSize.width - padding),
    top: clamp(top, padding, viewport.height - effectiveHeight - padding),
    maxHeight,
    side,
  };
}
