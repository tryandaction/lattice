/**
 * Cursor Context Plugin for Live Preview
 * Tracks cursor position and determines which syntax regions to reveal
 * 
 * Requirements: 1.2, 1.5, 1.6
 */

import { ViewPlugin, ViewUpdate, EditorView } from '@codemirror/view';
import { StateField, StateEffect, EditorState } from '@codemirror/state';

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
  };
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
  
  // Always reveal the current line
  revealLines.add(cursorLine);
  
  if (hasSelection) {
    // Reveal all lines in selection
    const fromLine = state.doc.lineAt(selection.from).number;
    const toLine = state.doc.lineAt(selection.to).number;
    for (let i = fromLine; i <= toLine; i++) {
      revealLines.add(i);
    }
  }
  
  // Handle multi-cursor
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.head).number;
    revealLines.add(line);
    
    if (!range.empty) {
      const fromLine = state.doc.lineAt(range.from).number;
      const toLine = state.doc.lineAt(range.to).number;
      for (let i = fromLine; i <= toLine; i++) {
        revealLines.add(i);
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
  };
}

/**
 * State field for cursor context
 */
export const cursorContextField = StateField.define<CursorContext>({
  create: createInitialContext,
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
 */
export function shouldRevealAt(state: EditorState, from: number, to: number): boolean {
  // Check if cursorContextField is available
  try {
    const context = state.field(cursorContextField, false);
    if (!context) return false; // No cursor context = reading mode, don't reveal
    
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
 */
export function shouldRevealLine(state: EditorState, lineNumber: number): boolean {
  try {
    const context = state.field(cursorContextField, false);
    if (!context) return false; // No cursor context = reading mode, don't reveal
    return context.revealLines.has(lineNumber);
  } catch {
    return false; // No cursor context field = reading mode
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
 */
export const cursorContextPlugin = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {}
    
    update(update: ViewUpdate) {
      // The state field handles updates automatically
      // This plugin can be used for additional side effects if needed
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
