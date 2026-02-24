/**
 * Keyboard Shortcuts for Live Preview Editor
 * Comprehensive shortcuts for markdown editing
 * 
 * Requirements: 10.1-10.12, 7.4 (math shortcuts)
 */

import { keymap } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import type { Command } from '@codemirror/view';

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

/**
 * Complete keyboard shortcuts keymap
 */
export const markdownKeymap = keymap.of([
  // Text formatting
  { key: 'Ctrl-b', mac: 'Cmd-b', run: toggleWrapper('**') },
  { key: 'Ctrl-i', mac: 'Cmd-i', run: toggleWrapper('*') },
  { key: 'Ctrl-`', run: toggleWrapper('`') },
  { key: 'Ctrl-Shift-s', run: toggleWrapper('~~') },
  { key: 'Ctrl-Shift-h', run: toggleWrapper('==') },
  
  // Links and media
  { key: 'Ctrl-k', mac: 'Cmd-k', run: insertLink },
  { key: 'Ctrl-Shift-`', run: insertCodeBlock },
  
  // Math shortcuts
  { key: 'Ctrl-Shift-m', mac: 'Cmd-Shift-m', run: wrapInlineMath },
  { key: 'Ctrl-Alt-m', mac: 'Cmd-Alt-m', run: insertBlockMath },
  { key: 'Ctrl-Shift-f', mac: 'Cmd-Shift-f', run: insertFraction },
  { key: 'Ctrl-Shift-r', mac: 'Cmd-Shift-r', run: insertSquareRoot },
  { key: 'Ctrl-Shift-i', mac: 'Cmd-Shift-i', run: insertIntegral },
  { key: 'Ctrl-Shift-u', mac: 'Cmd-Shift-u', run: insertSum },
  { key: 'Ctrl-Shift-l', mac: 'Cmd-Shift-l', run: insertLimit },
  { key: 'Ctrl-Shift-x', mac: 'Cmd-Shift-x', run: insertMatrix },
  { key: 'Ctrl-Shift-v', mac: 'Cmd-Shift-v', run: insertVector },
  { key: 'Ctrl-Shift-p', mac: 'Cmd-Shift-p', run: insertPartial },
  { key: 'Ctrl-ArrowUp', mac: 'Cmd-ArrowUp', run: insertSuperscript },
  { key: 'Ctrl-ArrowDown', mac: 'Cmd-ArrowDown', run: insertSubscript },
  
  // Line operations
  { key: 'Alt-ArrowUp', run: moveLineUp },
  { key: 'Alt-ArrowDown', run: moveLineDown },
  { key: 'Ctrl-d', mac: 'Cmd-d', run: duplicateLine },
  { key: 'Ctrl-/', mac: 'Cmd-/', run: toggleComment },
  { key: 'Ctrl-Enter', mac: 'Cmd-Enter', run: insertLineBelow },
  
  // Indentation
  { key: 'Ctrl-]', mac: 'Cmd-]', run: indentMore },
  { key: 'Ctrl-[', mac: 'Cmd-[', run: indentLess },
]);

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
