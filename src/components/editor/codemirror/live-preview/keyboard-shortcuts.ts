/**
 * Keyboard Shortcuts for Live Preview Editor
 * Comprehensive shortcuts for markdown editing
 * 
 * Requirements: 10.1-10.12, 7.4 (math shortcuts)
 */

import { keymap } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import type { Command } from '@codemirror/view';
import { isReservedShortcut, type ShortcutSpec } from '@/lib/shortcut-policy';

/**
 * Toggle wrapper around selection (bold, italic, etc.)
 */
function toggleWrapper(wrapper: string): Command {
  return (view) => {
    const { state } = view;
    const changes = state.changeByRange((range) => {
      const wrapperLen = wrapper.length;
      
      // Check if already wrapped
      const before = state.sliceDoc(
        Math.max(0, range.from - wrapperLen),
        range.from
      );
      const after = state.sliceDoc(
        range.to,
        Math.min(state.doc.length, range.to + wrapperLen)
      );
      
      if (before === wrapper && after === wrapper) {
        // Remove wrapper
        return {
          changes: [
            { from: range.from - wrapperLen, to: range.from, insert: '' },
            { from: range.to, to: range.to + wrapperLen, insert: '' },
          ],
          range: EditorSelection.range(
            range.from - wrapperLen,
            range.to - wrapperLen
          ),
        };
      } else {
        // Add wrapper
        return {
          changes: [
            { from: range.from, insert: wrapper },
            { from: range.to, insert: wrapper },
          ],
          range: EditorSelection.range(
            range.from + wrapperLen,
            range.to + wrapperLen
          ),
        };
      }
    });
    
    view.dispatch(changes);
    return true;
  };
}

/**
 * Insert link at cursor
 */
const insertLink: Command = (view) => {
  const { state } = view;
  const selection = state.selection.main;
  const selectedText = state.sliceDoc(selection.from, selection.to);
  
  const linkText = selectedText || 'link text';
  const insert = `[${linkText}](url)`;
  
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: EditorSelection.cursor(
      selection.from + linkText.length + 3 // Position cursor at "url"
    ),
  });
  
  return true;
};

/**
 * Insert inline math
 */
const insertInlineMath: Command = (view) => {
  const { state } = view;
  const selection = state.selection.main;
  const selectedText = state.sliceDoc(selection.from, selection.to);
  
  const mathText = selectedText || '';
  const insert = `$${mathText}$`;
  
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: EditorSelection.cursor(selection.from + 1 + mathText.length),
  });
  
  return true;
};

/**
 * Insert block math
 */
const insertBlockMath: Command = (view) => {
  const { state } = view;
  const selection = state.selection.main;
  const line = state.doc.lineAt(selection.head);
  
  const insert = '\n$$\n\n$$\n';
  
  view.dispatch({
    changes: { from: line.to, insert },
    selection: EditorSelection.cursor(line.to + 4), // Position inside math block
  });
  
  return true;
};

/**
 * Insert fraction (\\frac{}{})
 */
const insertFraction: Command = (view) => {
  const { state } = view;
  const selection = state.selection.main;
  const selectedText = state.sliceDoc(selection.from, selection.to);
  
  const numerator = selectedText || '';
  const insert = `\\frac{${numerator}}{}`;
  
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: EditorSelection.cursor(
      selection.from + 6 + numerator.length + 2 // Position in denominator
    ),
  });
  
  return true;
};

/**
 * Insert square root (\\sqrt{})
 */
const insertSquareRoot: Command = (view) => {
  const { state } = view;
  const selection = state.selection.main;
  const selectedText = state.sliceDoc(selection.from, selection.to);
  
  const content = selectedText || '';
  const insert = `\\sqrt{${content}}`;
  
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: EditorSelection.cursor(selection.from + 6 + content.length),
  });
  
  return true;
};

/**
 * Insert summation (\\sum_{i=1}^{n})
 */
const insertSum: Command = (view) => {
  const { state } = view;
  const selection = state.selection.main;

  const insert = '\\sum_{i=1}^{n}';

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: EditorSelection.cursor(selection.from + insert.length),
  });

  return true;
};

/**
 * Insert integral (\\int_{a}^{b})
 */
const insertIntegral: Command = (view) => {
  const { state } = view;
  const selection = state.selection.main;

  const insert = '\\int_{a}^{b}';

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: EditorSelection.cursor(selection.from + insert.length),
  });

  return true;
};

/**
 * Insert limit (\\lim_{x \\to })
 */
const insertLimit: Command = (view) => {
  const { state } = view;
  const selection = state.selection.main;

  const insert = '\\lim_{x \\to }';

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: EditorSelection.cursor(selection.from + insert.length - 1),
  });

  return true;
};

/**
 * Insert matrix (2x2)
 */
const insertMatrix: Command = (view) => {
  const { state } = view;
  const selection = state.selection.main;

  const insert = '\\begin{pmatrix} a & b \\\\\\\\ c & d \\end{pmatrix}';

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    // Position cursor at 'a'
    selection: EditorSelection.cursor(selection.from + 18),
  });

  return true;
};

/**
 * Insert vector notation
 */
const insertVector: Command = (view) => {
  const { state } = view;
  const selection = state.selection.main;
  const selectedText = state.sliceDoc(selection.from, selection.to);

  const content = selectedText || 'v';
  const insert = `\\vec{${content}}`;

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: EditorSelection.cursor(selection.from + 5 + content.length),
  });

  return true;
};

/**
 * Insert partial derivative
 */
const insertPartial: Command = (view) => {
  const { state } = view;
  const selection = state.selection.main;

  const insert = '\\frac{\\partial }{\\partial x}';

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    // Position cursor after \partial (before closing brace of numerator)
    selection: EditorSelection.cursor(selection.from + 15),
  });

  return true;
};

/**
 * Insert superscript (^{})
 */
const insertSuperscript: Command = (view) => {
  const { state } = view;
  const selection = state.selection.main;
  const selectedText = state.sliceDoc(selection.from, selection.to);

  const content = selectedText || '';
  const insert = `^{${content}}`;

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: EditorSelection.cursor(selection.from + 2 + content.length),
  });

  return true;
};

/**
 * Insert subscript (_{})
 */
const insertSubscript: Command = (view) => {
  const { state } = view;
  const selection = state.selection.main;
  const selectedText = state.sliceDoc(selection.from, selection.to);

  const content = selectedText || '';
  const insert = `_{${content}}`;

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: EditorSelection.cursor(selection.from + 2 + content.length),
  });

  return true;
};

/**
 * Wrap selection in inline math, or insert empty $|$
 * Smart: if selection exists, wraps it; otherwise inserts $$ with cursor inside
 */
const wrapInlineMath: Command = (view) => {
  const { state } = view;
  const selection = state.selection.main;
  const selectedText = state.sliceDoc(selection.from, selection.to);

  if (selectedText) {
    // Wrap selection
    const insert = `$${selectedText}$`;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert },
      selection: EditorSelection.range(selection.from + 1, selection.from + 1 + selectedText.length),
    });
  } else {
    // Insert empty inline math with cursor inside
    view.dispatch({
      changes: { from: selection.from, insert: '$$' },
      selection: EditorSelection.cursor(selection.from + 1),
    });
  }

  return true;
};

/**
 * Insert code block
 */
const insertCodeBlock: Command = (view) => {
  const { state } = view;
  const selection = state.selection.main;
  const line = state.doc.lineAt(selection.head);
  
  const insert = '\n```\n\n```\n';
  
  view.dispatch({
    changes: { from: line.to, insert },
    selection: EditorSelection.cursor(line.to + 5), // Position inside code block
  });
  
  return true;
};


/**
 * Move line up
 */
const moveLineUp: Command = (view) => {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  
  if (line.number === 1) return false;
  
  const prevLine = state.doc.line(line.number - 1);
  const lineText = state.sliceDoc(line.from, line.to);
  const prevLineText = state.sliceDoc(prevLine.from, prevLine.to);
  
  view.dispatch({
    changes: [
      { from: prevLine.from, to: line.to, insert: `${lineText}\n${prevLineText}` },
    ],
    selection: EditorSelection.cursor(
      prevLine.from + (state.selection.main.head - line.from)
    ),
  });
  
  return true;
};

/**
 * Move line down
 */
const moveLineDown: Command = (view) => {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  
  if (line.number === state.doc.lines) return false;
  
  const nextLine = state.doc.line(line.number + 1);
  const lineText = state.sliceDoc(line.from, line.to);
  const nextLineText = state.sliceDoc(nextLine.from, nextLine.to);
  
  view.dispatch({
    changes: [
      { from: line.from, to: nextLine.to, insert: `${nextLineText}\n${lineText}` },
    ],
    selection: EditorSelection.cursor(
      line.from + nextLineText.length + 1 + (state.selection.main.head - line.from)
    ),
  });
  
  return true;
};

/**
 * Duplicate line
 */
const duplicateLine: Command = (view) => {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const lineText = state.sliceDoc(line.from, line.to);
  
  view.dispatch({
    changes: { from: line.to, insert: `\n${lineText}` },
    selection: EditorSelection.cursor(
      line.to + 1 + (state.selection.main.head - line.from)
    ),
  });
  
  return true;
};

/**
 * Toggle HTML comment
 */
const toggleComment: Command = (view) => {
  const { state } = view;
  const selection = state.selection.main;
  const selectedText = state.sliceDoc(selection.from, selection.to);
  
  // Check if already commented
  if (selectedText.startsWith('<!--') && selectedText.endsWith('-->')) {
    // Remove comment
    const uncommented = selectedText.slice(4, -3);
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: uncommented },
    });
  } else {
    // Add comment
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: `<!--${selectedText}-->` },
    });
  }
  
  return true;
};

/**
 * Insert new line below current block
 */
const insertLineBelow: Command = (view) => {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  
  view.dispatch({
    changes: { from: line.to, insert: '\n' },
    selection: EditorSelection.cursor(line.to + 1),
  });
  
  return true;
};

/**
 * Indent line or selection
 */
const indentMore: Command = (view) => {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.head);
    return {
      changes: { from: line.from, insert: '  ' },
      range: EditorSelection.range(range.from + 2, range.to + 2),
    };
  });
  
  view.dispatch(changes);
  return true;
};

/**
 * Outdent line or selection
 */
const indentLess: Command = (view) => {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.head);
    const lineText = line.text;
    
    if (lineText.startsWith('  ')) {
      return {
        changes: { from: line.from, to: line.from + 2, insert: '' },
        range: EditorSelection.range(
          Math.max(line.from, range.from - 2),
          Math.max(line.from, range.to - 2)
        ),
      };
    } else if (lineText.startsWith('\t')) {
      return {
        changes: { from: line.from, to: line.from + 1, insert: '' },
        range: EditorSelection.range(
          Math.max(line.from, range.from - 1),
          Math.max(line.from, range.to - 1)
        ),
      };
    }
    
    return { range };
  });
  
  view.dispatch(changes);
  return true;
};

export const markdownShortcutSpecs: ShortcutSpec[] = [
  // Text formatting
  { id: 'format.bold', scope: 'markdown-editor', key: 'Ctrl-b', mac: 'Cmd-b', enabledByDefault: true },
  { id: 'format.italic', scope: 'markdown-editor', key: 'Ctrl-i', mac: 'Cmd-i', enabledByDefault: true },
  { id: 'format.inlineCode', scope: 'markdown-editor', key: 'Ctrl-`', mac: 'Cmd-`', enabledByDefault: true },
  { id: 'format.highlight', scope: 'markdown-editor', key: 'Ctrl-Shift-h', mac: 'Cmd-Shift-h', enabledByDefault: true },
  
  // Links and media
  { id: 'insert.link', scope: 'markdown-editor', key: 'Ctrl-k', mac: 'Cmd-k', enabledByDefault: true },
  { id: 'insert.codeBlock', scope: 'markdown-editor', key: 'Ctrl-Shift-`', mac: 'Cmd-Shift-`', enabledByDefault: true },

  // Low-conflict math entry points. Rich structures are handled by the Quantum Keyboard.
  { id: 'math.inline', scope: 'markdown-editor', key: 'Ctrl-Shift-m', mac: 'Cmd-Shift-m', enabledByDefault: true },
  { id: 'math.block', scope: 'markdown-editor', key: 'Ctrl-Alt-m', mac: 'Cmd-Alt-m', enabledByDefault: true },
  
  // Line operations
  { id: 'line.moveUp', scope: 'markdown-editor', key: 'Alt-ArrowUp', enabledByDefault: true },
  { id: 'line.moveDown', scope: 'markdown-editor', key: 'Alt-ArrowDown', enabledByDefault: true },
  { id: 'line.duplicate', scope: 'markdown-editor', key: 'Ctrl-d', mac: 'Cmd-d', enabledByDefault: true },
  { id: 'line.toggleComment', scope: 'markdown-editor', key: 'Ctrl-/', mac: 'Cmd-/', enabledByDefault: true },
  { id: 'line.insertBelow', scope: 'markdown-editor', key: 'Ctrl-Enter', mac: 'Cmd-Enter', enabledByDefault: true },
  
  // Indentation
  { id: 'indent.more', scope: 'markdown-editor', key: 'Ctrl-]', enabledByDefault: true },
  { id: 'indent.less', scope: 'markdown-editor', key: 'Ctrl-[', enabledByDefault: true },

  // Disabled by default because these collide with common browser/devtool/system habits.
  { id: 'format.strike', scope: 'markdown-editor', key: 'Ctrl-Shift-s', mac: 'Cmd-Shift-s', enabledByDefault: false, reason: 'Reserved by save-as and browser/system commands.' },
  { id: 'math.fraction', scope: 'markdown-editor', key: 'Ctrl-Shift-f', mac: 'Cmd-Shift-f', enabledByDefault: false, reason: 'Reserved by search-in-files habits; use Quantum Keyboard F/4.' },
  { id: 'math.sqrt', scope: 'markdown-editor', key: 'Ctrl-Shift-r', mac: 'Cmd-Shift-r', enabledByDefault: false, reason: 'Reserved by hard reload habits; use Quantum Keyboard 3.' },
  { id: 'math.integral', scope: 'markdown-editor', key: 'Ctrl-Shift-i', mac: 'Cmd-Shift-i', enabledByDefault: false, reason: 'Reserved by devtools/system habits; use Quantum Keyboard I/6.' },
  { id: 'math.sum', scope: 'markdown-editor', key: 'Ctrl-Shift-u', mac: 'Cmd-Shift-u', enabledByDefault: false, reason: 'Reserved by Unicode/input habits; use Quantum Keyboard S/5.' },
  { id: 'math.limit', scope: 'markdown-editor', key: 'Ctrl-Shift-l', mac: 'Cmd-Shift-l', enabledByDefault: false, reason: 'Use Quantum Keyboard 7/L.' },
  { id: 'math.matrix', scope: 'markdown-editor', key: 'Ctrl-Shift-x', mac: 'Cmd-Shift-x', enabledByDefault: false, reason: 'Use Quantum Keyboard M/X.' },
  { id: 'math.vector', scope: 'markdown-editor', key: 'Ctrl-Shift-v', mac: 'Cmd-Shift-v', enabledByDefault: false, reason: 'Reserved by paste-as-plain-text habits; use Quantum Keyboard V.' },
  { id: 'math.partial', scope: 'markdown-editor', key: 'Ctrl-Alt-p', mac: 'Cmd-Alt-p', enabledByDefault: false, reason: 'Use Quantum Keyboard D/P variants.' },
  { id: 'math.superscript', scope: 'markdown-editor', key: 'Ctrl-ArrowUp', mac: 'Cmd-ArrowUp', enabledByDefault: false, reason: 'Reserved by navigation/window habits; use Quantum Keyboard 1.' },
  { id: 'math.subscript', scope: 'markdown-editor', key: 'Ctrl-ArrowDown', mac: 'Cmd-ArrowDown', enabledByDefault: false, reason: 'Reserved by navigation/window habits; use Quantum Keyboard 2.' },
];

const markdownCommands: Record<string, Command> = {
  'format.bold': toggleWrapper('**'),
  'format.italic': toggleWrapper('*'),
  'format.inlineCode': toggleWrapper('`'),
  'format.highlight': toggleWrapper('=='),
  'insert.link': insertLink,
  'insert.codeBlock': insertCodeBlock,
  'math.inline': wrapInlineMath,
  'math.block': insertBlockMath,
  'line.moveUp': moveLineUp,
  'line.moveDown': moveLineDown,
  'line.duplicate': duplicateLine,
  'line.toggleComment': toggleComment,
  'line.insertBelow': insertLineBelow,
  'indent.more': indentMore,
  'indent.less': indentLess,
  'format.strike': toggleWrapper('~~'),
  'math.fraction': insertFraction,
  'math.sqrt': insertSquareRoot,
  'math.integral': insertIntegral,
  'math.sum': insertSum,
  'math.limit': insertLimit,
  'math.matrix': insertMatrix,
  'math.vector': insertVector,
  'math.partial': insertPartial,
  'math.superscript': insertSuperscript,
  'math.subscript': insertSubscript,
};

export function getDefaultMarkdownShortcutSpecs(): ShortcutSpec[] {
  return markdownShortcutSpecs.filter((shortcut) => shortcut.enabledByDefault);
}

/**
 * Complete keyboard shortcuts keymap. Reserved combinations are filtered even
 * if a future shortcut is accidentally marked enabled.
 */
export const markdownKeymap = keymap.of(
  markdownShortcutSpecs
    .filter((shortcut) => shortcut.enabledByDefault)
    .filter((shortcut) => !isReservedShortcut(shortcut.key) && (!shortcut.mac || !isReservedShortcut(shortcut.mac)))
    .map((shortcut) => ({
      key: shortcut.key,
      mac: shortcut.mac,
      run: markdownCommands[shortcut.id],
    }))
    .filter((binding) => Boolean(binding.run))
);

// Export individual commands for use elsewhere
export {
  wrapInlineMath,
  insertInlineMath,
  insertBlockMath,
  insertFraction,
  insertSquareRoot,
  insertSum,
  insertIntegral,
  insertLimit,
  insertMatrix,
  insertVector,
  insertPartial,
  insertSuperscript,
  insertSubscript,
};
