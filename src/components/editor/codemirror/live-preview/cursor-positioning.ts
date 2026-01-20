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
 * @param contentFrom - Start position of content
 * @param contentTo - End position of content
 * @returns Cursor position within the content range
 */
export function getCursorPositionFromClick(
  view: EditorView,
  widget: HTMLElement,
  clientX: number,
  contentFrom: number,
  contentTo: number
): number {
  const rect = widget.getBoundingClientRect();
  const relativeX = clientX - rect.left;
  const widgetWidth = rect.width;

  if (widgetWidth === 0) return contentFrom;

  // Calculate relative position (0 to 1)
  const ratio = Math.max(0, Math.min(1, relativeX / widgetWidth));

  // Map to content range
  const contentLength = contentTo - contentFrom;
  const offset = Math.round(ratio * contentLength);

  return contentFrom + offset;
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
  contentTo: number
): void {
  event.preventDefault();
  event.stopPropagation();

  const pos = getCursorPositionFromClick(
    view,
    widget,
    event.clientX,
    contentFrom,
    contentTo
  );

  setCursorPosition(view, pos);
  view.focus();
}
