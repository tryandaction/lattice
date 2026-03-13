/**
 * Cursor Positioning Utility
 *
 * Provides precise cursor positioning for widgets in Live Preview mode.
 * Ensures cursor can be placed at exact positions within rendered elements.
 */

import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';

const CURSOR_DEBUG_STORAGE_KEY = 'lattice.cursorDebug';
const CURSOR_DEBUG_GLOBAL_KEY = '__LATTICE_CURSOR_DEBUG__';

type CursorDebugInfo = Record<string, unknown>;

function shouldLogCursorDebug(): boolean {
  if (typeof window === 'undefined') return false;

  const win = window as Window & { [CURSOR_DEBUG_GLOBAL_KEY]?: boolean };
  if (win[CURSOR_DEBUG_GLOBAL_KEY]) return true;

  try {
    return window.localStorage.getItem(CURSOR_DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function logCursorDebug(message: string, info: CursorDebugInfo): void {
  if (!shouldLogCursorDebug()) return;
  // Keep logs structured for easy filtering in devtools.
  console.debug(`[live-preview/cursor] ${message}`, info);
}

/**
 * Calculate cursor position within a widget based on click coordinates
 *
 * @param view - Editor view
 * @param widget - Widget DOM element
 * @param clientX - Click X coordinate
 * @param clientY - Click Y coordinate
 * @param contentFrom - Start position of content
 * @param contentTo - End position of content
 * @returns Cursor position within the content range
 */
export function getCursorPositionFromClick(
  view: EditorView,
  widget: HTMLElement,
  clientX: number,
  clientY: number,
  contentFrom: number,
  contentTo: number,
  mapVisibleOffset?: (visibleOffset: number, widget: HTMLElement) => number
): number {
  const safeContentFrom = Math.min(contentFrom, contentTo);
  const safeContentTo = Math.max(contentFrom, contentTo);
  const contentLength = safeContentTo - safeContentFrom;
  const normalizedPoint = normalizePointToWidget(widget, clientX, clientY);
  const sampleX = normalizedPoint.x;
  const sampleY = normalizedPoint.y;

  // 1. Try browser-native caret-from-point (fast path)
  const caret = getCaretPositionFromPoint(sampleX, sampleY);
  if (caret) {
    const textOffset = getTextOffsetWithinWidget(widget, caret.node, caret.offset);
    if (textOffset !== null) {
      const mappedOffset = mapVisibleOffset
        ? mapVisibleOffset(textOffset, widget)
        : textOffset;
      return clamp(safeContentFrom + mappedOffset, safeContentFrom, safeContentTo);
    }
  }

  // 2. Robust fallback: walk every character position and find the closest one
  //    to the click point using Range.getBoundingClientRect(). This handles cases
  //    where caretRangeFromPoint returns a node outside the widget (e.g. due to
  //    CSS transforms or overlapping elements).
  const closestOffset = findClosestCharOffset(widget, sampleX, sampleY);
  if (closestOffset !== null) {
    const mappedOffset = mapVisibleOffset
      ? mapVisibleOffset(closestOffset, widget)
      : closestOffset;
    return clamp(safeContentFrom + mappedOffset, safeContentFrom, safeContentTo);
  }

  // 3. posAtCoords fallback (first precise, then estimated)
  const precisePos = view.posAtCoords({ x: sampleX, y: sampleY });
  const estimatedPos = view.posAtCoords({ x: sampleX, y: sampleY }, false);
  const candidatePos = pickBestPosCandidate(
    safeContentFrom,
    safeContentTo,
    precisePos,
    estimatedPos
  );
  if (candidatePos !== null) {
    return clamp(candidatePos, safeContentFrom, safeContentTo);
  }

  // 4. Last resort: proportional position based on click X within widget bounds
  const rect = widget.getBoundingClientRect();
  const relativeX = sampleX - rect.left;
  const widgetWidth = rect.width;

  if (widgetWidth === 0 || contentLength === 0) return safeContentFrom;

  const ratio = Math.max(0, Math.min(1, relativeX / widgetWidth));
  const offset = Math.round(ratio * contentLength);

  return safeContentFrom + offset;
}

/**
 * Set cursor position in the editor
 *
 * @param view - Editor view
 * @param pos - Position to set cursor
 */
export function setCursorPosition(view: EditorView, pos: number): void {
  view.dispatch({
    selection: EditorSelection.cursor(pos),
    scrollIntoView: true,
  });
}

/**
 * Handle click on a widget to position cursor
 *
 * @param view - Editor view
 * @param widget - Widget DOM element
 * @param event - Mouse event
 * @param contentFrom - Start position of content
 * @param contentTo - End position of content
 */
export function handleWidgetClick(
  view: EditorView,
  widget: HTMLElement,
  event: MouseEvent,
  contentFrom: number,
  contentTo: number,
  mapVisibleOffset?: (visibleOffset: number, widget: HTMLElement) => number
): void {
  event.preventDefault();
  event.stopPropagation();
  const rect = widget.getBoundingClientRect();
  const normalizedPoint = normalizePointToWidget(widget, event.clientX, event.clientY);

  const posAtRaw = view.posAtCoords({ x: event.clientX, y: event.clientY });
  const posAtNormalizedPrecise = view.posAtCoords(
    { x: normalizedPoint.x, y: normalizedPoint.y }
  );
  const posAtNormalizedEstimated = view.posAtCoords(
    { x: normalizedPoint.x, y: normalizedPoint.y },
    false
  );

  const pos = getCursorPositionFromClick(
    view,
    widget,
    normalizedPoint.x,
    normalizedPoint.y,
    contentFrom,
    contentTo,
    mapVisibleOffset
  );

  logCursorDebug('handleWidgetClick', {
    click: { x: event.clientX, y: event.clientY },
    normalizedClick: normalizedPoint,
    widgetRect: {
      left: Number(rect.left.toFixed(2)),
      top: Number(rect.top.toFixed(2)),
      width: Number(rect.width.toFixed(2)),
      height: Number(rect.height.toFixed(2)),
    },
    contentRange: {
      from: Math.min(contentFrom, contentTo),
      to: Math.max(contentFrom, contentTo),
    },
    posAtCoords: {
      rawPrecise: posAtRaw,
      normalizedPrecise: posAtNormalizedPrecise,
      normalizedEstimated: posAtNormalizedEstimated,
    },
    resolvedPos: pos,
  });

  setCursorPosition(view, pos);
  view.focus();
}

type CaretPosition = {
  node: Node;
  offset: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getCaretPositionFromPoint(clientX: number, clientY: number): CaretPosition | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(clientX, clientY);
    if (pos?.offsetNode) {
      return { node: pos.offsetNode, offset: pos.offset };
    }
  }

  if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(clientX, clientY);
    if (range) {
      return { node: range.startContainer, offset: range.startOffset };
    }
  }

  return null;
}

/**
 * Walk every character boundary in the widget and return the text offset
 * of the position visually closest to (clientX, clientY).
 *
 * This is the reliable fallback when caretRangeFromPoint returns a node
 * outside the widget (e.g. due to CSS transforms or overlapping elements).
 * Y distance is weighted 3× so we strongly prefer same-line characters.
 */
function findClosestCharOffset(
  widget: HTMLElement,
  clientX: number,
  clientY: number
): number | null {
  const walker = document.createTreeWalker(widget, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode() as Text | null;
  let totalOffset = 0;
  let bestOffset = 0;
  let bestDist = Infinity;
  let hasAny = false;

  while (current) {
    const length = current.nodeValue?.length ?? 0;
    for (let i = 0; i <= length; i++) {
      try {
        const range = document.createRange();
        range.setStart(current, i);
        range.setEnd(current, i);
        const rect = range.getBoundingClientRect();
        // Skip degenerate rects (hidden nodes, etc.)
        if (rect.width === 0 && rect.height === 0) continue;
        // Distance to rectangle (0 when click is inside char box).
        const dx = distanceToInterval(clientX, rect.left, rect.right);
        const dy = distanceToInterval(clientY, rect.top, rect.bottom);
        // Weight Y distance heavily so we prefer characters on the same line.
        const dist = dx + dy * 3;
        if (dist < bestDist) {
          bestDist = dist;
          bestOffset = totalOffset + i;
          hasAny = true;
        }
      } catch {
        // skip invalid range positions
      }
    }
    totalOffset += length;
    current = walker.nextNode() as Text | null;
  }

  return hasAny ? bestOffset : null;
}

function getTextOffsetWithinWidget(
  widget: HTMLElement,
  node: Node,
  offset: number
): number | null {
  if (!widget.contains(node)) return null;

  try {
    // Walk all text nodes inside the widget in order, summing their lengths
    // until we reach the target node. This is more reliable than Range.toString()
    // when the widget contains nested elements (e.g. <em>, <strong>).
    const walker = document.createTreeWalker(widget, NodeFilter.SHOW_TEXT);
    let total = 0;
    let current = walker.nextNode() as Text | null;
    while (current) {
      if (current === node) {
        return total + offset;
      }
      total += current.nodeValue?.length ?? 0;
      current = walker.nextNode() as Text | null;
    }
    // Fallback: use Range if the node wasn't found via walker
    const range = document.createRange();
    range.setStart(widget, 0);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return null;
  }
}

function normalizePointToWidget(
  widget: HTMLElement,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const rect = widget.getBoundingClientRect();

  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) {
    return { x: clientX, y: clientY };
  }

  const minX = rect.left + 1;
  const maxX = Math.max(minX, rect.right - 1);
  const minY = rect.top + 1;
  const maxY = Math.max(minY, rect.bottom - 1);

  return {
    x: clamp(clientX, minX, maxX),
    y: clamp(clientY, minY, maxY),
  };
}

function distanceToInterval(value: number, min: number, max: number): number {
  if (value < min) return min - value;
  if (value > max) return value - max;
  return 0;
}

function pickBestPosCandidate(
  from: number,
  to: number,
  precise: number | null,
  estimated: number
): number | null {
  const precisePenalty = precise === null ? Number.POSITIVE_INFINITY : distanceToRange(precise, from, to);
  const estimatedPenalty = distanceToRange(estimated, from, to);

  if (precisePenalty === Number.POSITIVE_INFINITY && estimatedPenalty === Number.POSITIVE_INFINITY) {
    return null;
  }

  if (precisePenalty <= estimatedPenalty) {
    return precise;
  }

  return estimated;
}

function distanceToRange(value: number, min: number, max: number): number {
  if (value < min) return min - value;
  if (value > max) return value - max;
  return 0;
}
