/**
 * Cursor Positioning Utility
 *
 * Provides precise cursor positioning for widgets in Live Preview mode.
 * Ensures cursor can be placed at exact positions within rendered elements.
 */

import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';

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

  // 1. Try browser-native caret-from-point (fast path)
  const caret = getCaretPositionFromPoint(clientX, clientY);
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
  const closestOffset = findClosestCharOffset(widget, clientX, clientY);
  if (closestOffset !== null) {
    const mappedOffset = mapVisibleOffset
      ? mapVisibleOffset(closestOffset, widget)
      : closestOffset;
    return clamp(safeContentFrom + mappedOffset, safeContentFrom, safeContentTo);
  }

  // 3. posAtCoords fallback (unreliable inside Decoration.replace widgets, but
  //    better than nothing for edge cases)
  const posAtCoords = view.posAtCoords({ x: clientX, y: clientY });
  if (posAtCoords !== null) {
    return clamp(posAtCoords, safeContentFrom, safeContentTo);
  }

  // 4. Last resort: proportional position based on click X within widget bounds
  const rect = widget.getBoundingClientRect();
  const relativeX = clientX - rect.left;
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

  const pos = getCursorPositionFromClick(
    view,
    widget,
    event.clientX,
    event.clientY,
    contentFrom,
    contentTo,
    mapVisibleOffset
  );

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
        const midY = (rect.top + rect.bottom) / 2;
        // Weight Y distance heavily so we prefer characters on the same line
        const dist = Math.abs(rect.left - clientX) + Math.abs(midY - clientY) * 3;
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
