/**
 * Click Position Fix Plugin
 *
 * Fixes cursor positioning when clicking text after inline widgets (especially math formulas)
 * that render wider than their source code.
 *
 * Problem: When an inline formula like $\mu$ (4 chars) renders as a wider symbol,
 * clicking text AFTER the formula causes misalignment because CodeMirror's default
 * posAtCoords() calculates positions based on source character count, not rendered width.
 *
 * Solution: Create a ViewPlugin that intercepts mousedown events and adjusts positions
 * by accounting for the cumulative width difference of all inline widgets before the click.
 */

import { EditorView, ViewPlugin } from '@codemirror/view';
import { Extension } from '@codemirror/state';

/**
 * Calculate position adjustment needed due to inline widgets
 */
function calculatePositionAdjustment(view: EditorView, clientX: number, clientY: number): number | null {
  // Get the raw position CodeMirror calculates
  const rawPos = view.posAtCoords({ x: clientX, y: clientY });
  if (rawPos === null) return null;

  const line = view.state.doc.lineAt(rawPos);
  const lineStart = line.from;
  const lineEnd = line.to;

  // Find all inline math widgets on this line
  const inlineMathWidgets: Array<{ from: number; to: number; width: number }> = [];

  // Query all inline math widgets in the viewport
  const widgets = view.dom.querySelectorAll('.cm-math-inline');

  for (const widget of widgets) {
    if (!(widget instanceof HTMLElement)) continue;

    const from = parseInt(widget.dataset.from || '0');
    const to = parseInt(widget.dataset.to || '0');

    // Only consider widgets on the same line
    if (from >= lineStart && to <= lineEnd) {
      const rect = widget.getBoundingClientRect();
      inlineMathWidgets.push({ from, to, width: rect.width });
    }
  }

  // If no inline math widgets on this line, no adjustment needed
  if (inlineMathWidgets.length === 0) return null;

  // Sort widgets by position
  inlineMathWidgets.sort((a, b) => a.from - b.from);

  // Calculate cumulative width offset up to the click position
  let cumulativeOffset = 0;
  const avgCharWidth = 8; // Approximate average character width in pixels

  for (const widget of inlineMathWidgets) {
    // Only consider widgets before the raw click position
    if (widget.to <= rawPos) {
      const sourceChars = widget.to - widget.from;
      const renderedChars = widget.width / avgCharWidth;
      const diff = renderedChars - sourceChars;
      cumulativeOffset += diff;
    }
  }

  // Round to nearest character
  return Math.round(cumulativeOffset);
}

/**
 * Click position fix plugin
 */
const clickPositionFixPlugin = ViewPlugin.fromClass(
  class {
    constructor(private view: EditorView) {
      // Add mousedown listener to the editor
      this.view.dom.addEventListener('mousedown', this.handleMouseDown);
    }

    destroy() {
      this.view.dom.removeEventListener('mousedown', this.handleMouseDown);
    }

    handleMouseDown = (event: MouseEvent) => {
      // Only handle left clicks
      if (event.button !== 0) return;

      // Don't interfere with clicks on widgets themselves
      const target = event.target as HTMLElement;
      if (target.closest('.cm-math-inline, .cm-math-block')) {
        return;
      }

      // Calculate adjustment
      const adjustment = calculatePositionAdjustment(this.view, event.clientX, event.clientY);

      if (adjustment !== null && adjustment !== 0) {
        // Get raw position
        const rawPos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (rawPos === null) return;

        // Apply adjustment
        const adjustedPos = Math.max(0, Math.min(this.view.state.doc.length, rawPos + adjustment));

        // Prevent default and set cursor to adjusted position
        event.preventDefault();
        event.stopPropagation();

        this.view.dispatch({
          selection: { anchor: adjustedPos },
          scrollIntoView: true,
        });
        this.view.focus();
      }
    };
  }
);

export function clickPositionFix(): Extension {
  return clickPositionFixPlugin;
}
