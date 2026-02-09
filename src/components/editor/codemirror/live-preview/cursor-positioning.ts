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

  const posAtCoords = view.posAtCoords({ x: clientX, y: clientY });
  if (posAtCoords !== null) {
    return clamp(posAtCoords, safeContentFrom, safeContentTo);
  }

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

function getTextOffsetWithinWidget(
  widget: HTMLElement,
  node: Node,
  offset: number
): number | null {
  if (!widget.contains(node)) return null;

  try {
    const range = document.createRange();
    range.setStart(widget, 0);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return null;
  }
}
