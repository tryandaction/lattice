/**
 * Cursor Context Plugin for Live Preview
 * Tracks cursor position and determines which syntax regions to reveal
 * 
 * Requirements: 1.2, 1.5, 1.6
 */

import { ViewPlugin, ViewUpdate, EditorView } from '@codemirror/view';
import { StateField, StateEffect, EditorState } from '@codemirror/state';
import type { ParsedElement, ElementType } from './decoration-coordinator';
import { parsedElementsField } from './decoration-coordinator';

/**
 * State effect to update cursor context
 */
export const updateCursorContext = StateEffect.define<CursorContext>();

/**
 * Cursor context information
 */
export interface CursorContext {
  /** Current cursor position */
  cursorPos: number;
  /** Current line number */
  cursorLine: number;
  /** Selection start */
  selectionFrom: number;
  /** Selection end */
  selectionTo: number;
  /** Whether there's an active selection */
  hasSelection: boolean;
  /** Set of ranges that should reveal syntax (format: "from-to") */
  revealRanges: Set<string>;
  /** Lines that should reveal syntax */
  revealLines: Set<number>;

  // NEW: Element-level tracking for Obsidian-style granular reveal
  /** Set of elements that should reveal syntax (format: "type:from:to") */
  revealElements: Set<string>;
  /** Current element under cursor (null if not in any element) */
  cursorElement: ParsedElement | null;
}

/**
 * Create initial cursor context
 */
function createInitialContext(): CursorContext {
  return {
    cursorPos: 0,
    cursorLine: 1,
    selectionFrom: 0,
    selectionTo: 0,
    hasSelection: false,
    revealRanges: new Set(),
    revealLines: new Set(),
    revealElements: new Set(),
    cursorElement: null,
  };
}

/**
 * Find the element at a given position
 * Uses binary search for efficiency with large element arrays
 *
 * @param pos - Cursor position to check
 * @param elements - Array of parsed elements (must be sorted by position)
 * @returns The element containing the position, or null if not found
 */
function findElementAtPosition(
  pos: number,
  elements: ParsedElement[]
): ParsedElement | null {
  // Linear search for now (can optimize to binary search if needed)
  // Elements are typically not sorted, so binary search wouldn't help
  for (const element of elements) {
    if (pos >= element.from && pos <= element.to) {
      return element;
    }
  }
  return null;
}

/**
 * Compute cursor context from editor state
 */
function computeCursorContext(state: EditorState): CursorContext {
  const selection = state.selection.main;
  const cursorPos = selection.head;
  const cursorLine = state.doc.lineAt(cursorPos).number;
  const hasSelection = !selection.empty;

  const revealRanges = new Set<string>();
  const revealLines = new Set<number>();
  const revealElements = new Set<string>();

  // Get parsed elements from decoration coordinator
  let parsedElements: ParsedElement[] = [];
  try {
    parsedElements = state.field(parsedElementsField, false) || [];
  } catch {
    // Field not available yet
  }

  // Find element at cursor position
  const cursorElement = findElementAtPosition(cursorPos, parsedElements);

  // Add cursor element to reveal set
  if (cursorElement) {
    const elementKey = `${cursorElement.type}:${cursorElement.from}:${cursorElement.to}`;
    revealElements.add(elementKey);
  }

  // Always reveal the current line (backward compatibility)
  revealLines.add(cursorLine);

  if (hasSelection) {
    // Reveal all lines in selection
    const fromLine = state.doc.lineAt(selection.from).number;
    const toLine = state.doc.lineAt(selection.to).number;
    for (let i = fromLine; i <= toLine; i++) {
      revealLines.add(i);
    }

    // Reveal all elements in selection
    for (const element of parsedElements) {
      // Check if element overlaps with selection
      if (element.from <= selection.to && element.to >= selection.from) {
        const elementKey = `${element.type}:${element.from}:${element.to}`;
        revealElements.add(elementKey);
      }
    }
  }

  // Handle multi-cursor
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.head).number;
    revealLines.add(line);

    // Find element at each cursor
    const rangeElement = findElementAtPosition(range.head, parsedElements);
    if (rangeElement) {
      const elementKey = `${rangeElement.type}:${rangeElement.from}:${rangeElement.to}`;
      revealElements.add(elementKey);
    }

    if (!range.empty) {
      const fromLine = state.doc.lineAt(range.from).number;
      const toLine = state.doc.lineAt(range.to).number;
      for (let i = fromLine; i <= toLine; i++) {
        revealLines.add(i);
      }

      // Reveal all elements in range
      for (const element of parsedElements) {
        if (element.from <= range.to && element.to >= range.from) {
          const elementKey = `${element.type}:${element.from}:${element.to}`;
          revealElements.add(elementKey);
        }
      }
    }
  }

  return {
    cursorPos,
    cursorLine,
    selectionFrom: selection.from,
    selectionTo: selection.to,
    hasSelection,
    revealRanges,
    revealLines,
    revealElements,
    cursorElement,
  };
}

/**
 * State field for cursor context
 */
export const cursorContextField = StateField.define<CursorContext>({
  create(state) {
    // Initialize with computed context based on initial cursor position
    return computeCursorContext(state);
  },
  update(value, tr) {
    // Check for explicit update effect
    for (const effect of tr.effects) {
      if (effect.is(updateCursorContext)) {
        return effect.value;
      }
    }
    
    // Update on selection or document change
    if (tr.selection || tr.docChanged) {
      return computeCursorContext(tr.state);
    }
    
    return value;
  },
});

/**
 * Check if a position should reveal syntax
 * Now supports element-level granularity for Obsidian-style behavior
 *
 * @param state - Editor state
 * @param from - Start position of the element
 * @param to - End position of the element
 * @param elementType - Optional element type for precise matching
 * @returns true if syntax should be revealed, false otherwise
 */
export function shouldRevealAt(
  state: EditorState,
  from: number,
  to: number,
  elementType?: ElementType
): boolean {
  // Check if cursorContextField is available
  try {
    const context = state.field(cursorContextField, false);
    if (!context) return false; // No cursor context = reading mode, don't reveal

    // If element type is provided, check element-level reveal
    if (elementType !== undefined) {
      const elementKey = `${elementType}:${from}:${to}`;
      if (context.revealElements.has(elementKey)) {
        return true;
      }
    }

    const selection = state.selection.main;

    // Check if cursor is inside the range
    if (selection.head >= from && selection.head <= to) {
      return true;
    }

    // Check if selection overlaps with the range
    if (!selection.empty) {
      if (selection.from <= to && selection.to >= from) {
        return true;
      }
    }

    // Check multi-cursor
    for (const range of state.selection.ranges) {
      if (range.head >= from && range.head <= to) {
        return true;
      }
      if (!range.empty && range.from <= to && range.to >= from) {
        return true;
      }
    }

    return false;
  } catch {
    return false; // No cursor context field = reading mode
  }
}

/**
 * Check if a line should reveal syntax
 * Returns false for both reading mode AND lines without cursor
 */
export function shouldRevealLine(state: EditorState, lineNumber: number): boolean {
  try {
    const context = state.field(cursorContextField, false);
    if (!context) {
      // Reading mode or field not initialized - don't reveal
      return false;
    }
    // Check if cursor is on this line
    return context.revealLines.has(lineNumber);
  } catch {
    // Field doesn't exist - safe default is don't reveal (show formatted)
    return false;
  }
}

/**
 * Get the current cursor line number
 */
export function getCursorLine(state: EditorState): number {
  return state.field(cursorContextField).cursorLine;
}

/**
 * Cursor context view plugin
 * Triggers decoration updates when cursor moves
 *
 * CRITICAL: This plugin must request measure when cursor context changes
 * so that other ViewPlugins know to rebuild their decorations
 */
export const cursorContextPlugin = ViewPlugin.fromClass(
  class {
    private lastContext: CursorContext | null = null;

    constructor(readonly view: EditorView) {
      this.lastContext = view.state.field(cursorContextField, false) ?? null;
    }

    update(update: ViewUpdate) {
      // Check if cursor context changed
      const newContext = update.state.field(cursorContextField, false) ?? null;

      // If context changed (cursor moved to different line or reveal set changed)
      if (this.hasContextChanged(this.lastContext, newContext)) {
        // Request a measure to trigger decoration updates in other plugins
        // This is CRITICAL - without this, decoration plugins won't know to re-run
        update.view.requestMeasure();
        this.lastContext = newContext;
      }
    }

    /**
     * Check if cursor context has meaningfully changed
     * Now includes element-level tracking for Obsidian-style granular reveal
     */
    private hasContextChanged(old: CursorContext | null, current: CursorContext | null): boolean {
      if (!old && !current) return false;
      if (!old || !current) return true;

      // Check if cursor line changed
      if (old.cursorLine !== current.cursorLine) return true;

      // Check if cursor element changed (element-level tracking)
      if (old.cursorElement?.type !== current.cursorElement?.type ||
          old.cursorElement?.from !== current.cursorElement?.from ||
          old.cursorElement?.to !== current.cursorElement?.to) {
        return true;
      }

      // Check if reveal elements set changed (element-level tracking)
      if (old.revealElements.size !== current.revealElements.size) return true;

      // Check if reveal elements content changed
      for (const element of current.revealElements) {
        if (!old.revealElements.has(element)) return true;
      }

      // Check if reveal lines set changed (backward compatibility)
      if (old.revealLines.size !== current.revealLines.size) return true;

      // Check if reveal lines content changed
      for (const line of current.revealLines) {
        if (!old.revealLines.has(line)) return true;
      }

      return false;
    }
  }
);

/**
 * Extension bundle for cursor context
 */
export const cursorContextExtension = [
  cursorContextField,
  cursorContextPlugin,
];
