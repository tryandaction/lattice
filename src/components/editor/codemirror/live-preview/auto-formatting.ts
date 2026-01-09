/**
 * Auto-Formatting Plugin for Live Preview
 * Smart input rules for markdown editing
 * 
 * Requirements: 12.1-12.10, 27.7
 */

import { EditorView, ViewPlugin, ViewUpdate, keymap } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';

/**
 * Handle Enter key in lists
 */
function handleEnterInList(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const lineText = line.text;
  
  // Check for empty list item
  const emptyBullet = /^(\s*)([-*+])\s*$/.exec(lineText);
  const emptyNumbered = /^(\s*)(\d+)[.)]\s*$/.exec(lineText);
  const emptyTask = /^(\s*)([-*+])\s\[[ xX]?\]\s*$/.exec(lineText);
  
  if (emptyBullet || emptyNumbered || emptyTask) {
    // Exit list - remove the empty item
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: '' },
    });
    return true;
  }
  
  // Continue list
  const bulletMatch = /^(\s*)([-*+])\s/.exec(lineText);
  const numberedMatch = /^(\s*)(\d+)([.)])\s/.exec(lineText);
  const taskMatch = /^(\s*)([-*+])\s\[[ xX]?\]\s/.exec(lineText);
  
  if (taskMatch) {
    const indent = taskMatch[1];
    const marker = taskMatch[2];
    view.dispatch({
      changes: { from: state.selection.main.head, insert: `\n${indent}${marker} [ ] ` },
      selection: EditorSelection.cursor(
        state.selection.main.head + indent.length + marker.length + 6
      ),
    });
    return true;
  }
  
  if (bulletMatch) {
    const indent = bulletMatch[1];
    const marker = bulletMatch[2];
    view.dispatch({
      changes: { from: state.selection.main.head, insert: `\n${indent}${marker} ` },
      selection: EditorSelection.cursor(
        state.selection.main.head + indent.length + marker.length + 3
      ),
    });
    return true;
  }
  
  if (numberedMatch) {
    const indent = numberedMatch[1];
    const num = parseInt(numberedMatch[2]) + 1;
    const sep = numberedMatch[3];
    view.dispatch({
      changes: { from: state.selection.main.head, insert: `\n${indent}${num}${sep} ` },
      selection: EditorSelection.cursor(
        state.selection.main.head + indent.length + String(num).length + 3
      ),
    });
    return true;
  }
  
  // Check for blockquote
  const quoteMatch = /^(>\s*)/.exec(lineText);
  if (quoteMatch) {
    view.dispatch({
      changes: { from: state.selection.main.head, insert: `\n${quoteMatch[1]}` },
      selection: EditorSelection.cursor(
        state.selection.main.head + quoteMatch[1].length + 1
      ),
    });
    return true;
  }
  
  return false;
}

/**
 * Auto-pair brackets and quotes
 */
const autoPairs: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '"': '"',
  "'": "'",
  '`': '`',
  '*': '*',
  '_': '_',
  '~': '~',
  '=': '=',
  '$': '$',
};

function handleAutoPair(view: EditorView, char: string): boolean {
  const closingChar = autoPairs[char];
  if (!closingChar) return false;
  
  const { state } = view;
  const selection = state.selection.main;
  
  // If there's a selection, wrap it
  if (!selection.empty) {
    const selectedText = state.sliceDoc(selection.from, selection.to);
    view.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: `${char}${selectedText}${closingChar}`,
      },
      selection: EditorSelection.range(
        selection.from + 1,
        selection.to + 1
      ),
    });
    return true;
  }
  
  // Check if next char is the same (skip if closing)
  const nextChar = state.sliceDoc(selection.head, selection.head + 1);
  if (nextChar === closingChar && char === closingChar) {
    // Just move cursor past the closing char
    view.dispatch({
      selection: EditorSelection.cursor(selection.head + 1),
    });
    return true;
  }
  
  // Insert pair
  view.dispatch({
    changes: { from: selection.head, insert: `${char}${closingChar}` },
    selection: EditorSelection.cursor(selection.head + 1),
  });
  return true;
}

/**
 * Handle backspace for auto-pairs
 */
function handleBackspace(view: EditorView): boolean {
  const { state } = view;
  const selection = state.selection.main;
  
  if (!selection.empty || selection.head === 0) return false;
  
  const before = state.sliceDoc(selection.head - 1, selection.head);
  const after = state.sliceDoc(selection.head, selection.head + 1);
  
  // Check if we're between a pair
  if (autoPairs[before] === after) {
    view.dispatch({
      changes: { from: selection.head - 1, to: selection.head + 1, insert: '' },
    });
    return true;
  }
  
  return false;
}

/**
 * Auto-formatting view plugin
 */
export const autoFormattingPlugin = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {}
    
    update(update: ViewUpdate) {
      // Plugin doesn't need to track state
    }
  }
);


/**
 * Event handlers for auto-formatting
 */
export const autoFormattingHandlers = EditorView.domEventHandlers({
  keydown: (event, view) => {
    // Handle Enter for list continuation
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      if (handleEnterInList(view)) {
        event.preventDefault();
        return true;
      }
    }
    
    // Handle Backspace for auto-pairs
    if (event.key === 'Backspace') {
      if (handleBackspace(view)) {
        event.preventDefault();
        return true;
      }
    }
    
    // Handle auto-pairing characters
    if (event.key in autoPairs && !event.ctrlKey && !event.metaKey) {
      if (handleAutoPair(view, event.key)) {
        event.preventDefault();
        return true;
      }
    }
    
    return false;
  },
});

/**
 * Check if cursor is on a list line
 */
function isOnListLine(view: EditorView): { indent: string; marker: string; rest: string } | null {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const lineText = line.text;
  
  // Bullet list
  const bulletMatch = /^(\s*)([-*+])\s(.*)$/.exec(lineText);
  if (bulletMatch) {
    return { indent: bulletMatch[1], marker: bulletMatch[2] + ' ', rest: bulletMatch[3] };
  }
  
  // Numbered list
  const numberedMatch = /^(\s*)(\d+[.)]\s)(.*)$/.exec(lineText);
  if (numberedMatch) {
    return { indent: numberedMatch[1], marker: numberedMatch[2], rest: numberedMatch[3] };
  }
  
  // Task list
  const taskMatch = /^(\s*)([-*+]\s\[[ xX]?\]\s)(.*)$/.exec(lineText);
  if (taskMatch) {
    return { indent: taskMatch[1], marker: taskMatch[2], rest: taskMatch[3] };
  }
  
  return null;
}

/**
 * Indent list item (Tab)
 */
function indentListItem(view: EditorView): boolean {
  const listInfo = isOnListLine(view);
  if (!listInfo) return false;
  
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  
  // Add two spaces of indentation
  view.dispatch({
    changes: { from: line.from, insert: '  ' },
    selection: EditorSelection.cursor(state.selection.main.head + 2),
  });
  
  return true;
}

/**
 * Outdent list item (Shift+Tab)
 */
function outdentListItem(view: EditorView): boolean {
  const listInfo = isOnListLine(view);
  if (!listInfo) return false;
  
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const lineText = line.text;
  
  // Remove up to two spaces of indentation
  if (lineText.startsWith('  ')) {
    view.dispatch({
      changes: { from: line.from, to: line.from + 2, insert: '' },
      selection: EditorSelection.cursor(Math.max(line.from, state.selection.main.head - 2)),
    });
    return true;
  } else if (lineText.startsWith('\t')) {
    view.dispatch({
      changes: { from: line.from, to: line.from + 1, insert: '' },
      selection: EditorSelection.cursor(Math.max(line.from, state.selection.main.head - 1)),
    });
    return true;
  } else if (lineText.startsWith(' ')) {
    view.dispatch({
      changes: { from: line.from, to: line.from + 1, insert: '' },
      selection: EditorSelection.cursor(Math.max(line.from, state.selection.main.head - 1)),
    });
    return true;
  }
  
  return false;
}

/**
 * List indentation keymap
 */
const listIndentKeymap = keymap.of([
  {
    key: 'Tab',
    run: indentListItem,
  },
  {
    key: 'Shift-Tab',
    run: outdentListItem,
  },
]);

/**
 * Complete auto-formatting extension
 */
export const autoFormattingExtension = [
  autoFormattingPlugin,
  autoFormattingHandlers,
  listIndentKeymap,
];
