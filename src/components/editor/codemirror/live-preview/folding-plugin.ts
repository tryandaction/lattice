/**
 * Folding Plugin for Live Preview
 * Implements section folding for headings and code blocks
 * 
 * Requirements: 6.1-6.5
 */

import { foldGutter, foldService, foldEffect, unfoldEffect } from '@codemirror/language';
import { EditorState, StateField, StateEffect, RangeSet } from '@codemirror/state';
import { keymap, EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';

/**
 * Custom fold service for markdown
 * Folds headings to next heading of same or higher level
 */
export const markdownFoldService = foldService.of((state, lineStart, lineEnd) => {
  const line = state.doc.lineAt(lineStart);
  const text = line.text;
  
  // Check for heading
  const headingMatch = text.match(/^(#{1,6})\s/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    
    // Find next heading of same or higher level
    for (let i = line.number + 1; i <= state.doc.lines; i++) {
      const nextLine = state.doc.line(i);
      const nextHeading = nextLine.text.match(/^(#{1,6})\s/);
      
      if (nextHeading && nextHeading[1].length <= level) {
        // Fold to just before this heading
        return { from: line.to, to: nextLine.from - 1 };
      }
    }
    
    // Fold to end of document
    if (line.number < state.doc.lines) {
      return { from: line.to, to: state.doc.length };
    }
  }
  
  // Check for code block start
  if (text.match(/^```\w*$/)) {
    // Find closing fence
    for (let i = line.number + 1; i <= state.doc.lines; i++) {
      const nextLine = state.doc.line(i);
      if (nextLine.text === '```') {
        return { from: line.to, to: nextLine.to };
      }
    }
  }
  
  return null;
});

/**
 * Fold gutter configuration
 */
export const markdownFoldGutter = foldGutter({
  markerDOM: (open) => {
    const marker = document.createElement('span');
    marker.className = `cm-fold-marker ${open ? 'cm-fold-open' : 'cm-fold-closed'}`;
    marker.textContent = open ? '▼' : '▶';
    marker.title = open ? 'Fold section' : 'Unfold section';
    return marker;
  },
});

/**
 * Keyboard shortcuts for folding
 */
export const foldingKeymap = keymap.of([
  {
    key: 'Ctrl-Shift-[',
    mac: 'Cmd-Shift-[',
    run: (view) => {
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      return foldAtLine(view, line.number);
    },
  },
  {
    key: 'Ctrl-Shift-]',
    mac: 'Cmd-Shift-]',
    run: (view) => {
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      return unfoldAtLine(view, line.number);
    },
  },
]);

/**
 * State field to track folded ranges
 */
interface FoldedRange {
  from: number;
  to: number;
}

const addFoldedRange = StateEffect.define<FoldedRange>();
const removeFoldedRange = StateEffect.define<FoldedRange>();

export const foldedRangesField = StateField.define<FoldedRange[]>({
  create: () => [],
  update(ranges, tr) {
    let newRanges = ranges;
    
    for (const effect of tr.effects) {
      if (effect.is(addFoldedRange)) {
        newRanges = [...newRanges, effect.value];
      } else if (effect.is(removeFoldedRange)) {
        newRanges = newRanges.filter(
          r => r.from !== effect.value.from || r.to !== effect.value.to
        );
      }
    }
    
    // Adjust ranges for document changes
    if (tr.docChanged) {
      newRanges = newRanges.map(range => ({
        from: tr.changes.mapPos(range.from),
        to: tr.changes.mapPos(range.to),
      })).filter(r => r.from < r.to);
    }
    
    return newRanges;
  },
});

/**
 * Fold at a specific line
 */
function foldAtLine(view: EditorView, lineNumber: number): boolean {
  const line = view.state.doc.line(lineNumber);
  const text = line.text;
  
  // Check for heading
  const headingMatch = text.match(/^(#{1,6})\s/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    
    // Find fold range
    let foldTo = view.state.doc.length;
    for (let i = lineNumber + 1; i <= view.state.doc.lines; i++) {
      const nextLine = view.state.doc.line(i);
      const nextHeading = nextLine.text.match(/^(#{1,6})\s/);
      
      if (nextHeading && nextHeading[1].length <= level) {
        foldTo = nextLine.from - 1;
        break;
      }
    }
    
    if (line.to < foldTo) {
      view.dispatch({
        effects: [
          addFoldedRange.of({ from: line.to, to: foldTo }),
          foldEffect.of({ from: line.to, to: foldTo }),
        ],
      });
      return true;
    }
  }
  
  // Check for code block
  if (text.match(/^```\w*$/)) {
    for (let i = lineNumber + 1; i <= view.state.doc.lines; i++) {
      const nextLine = view.state.doc.line(i);
      if (nextLine.text === '```') {
        view.dispatch({
          effects: [
            addFoldedRange.of({ from: line.to, to: nextLine.to }),
            foldEffect.of({ from: line.to, to: nextLine.to }),
          ],
        });
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Unfold at a specific line
 */
function unfoldAtLine(view: EditorView, lineNumber: number): boolean {
  const line = view.state.doc.line(lineNumber);
  const ranges = view.state.field(foldedRangesField, false) || [];
  
  // Find fold starting at this line
  const foldRange = ranges.find(r => {
    const foldLine = view.state.doc.lineAt(r.from);
    return foldLine.number === lineNumber || foldLine.number === lineNumber - 1;
  });
  
  if (foldRange) {
    view.dispatch({
      effects: [
        removeFoldedRange.of(foldRange),
        unfoldEffect.of({ from: foldRange.from, to: foldRange.to }),
      ],
    });
    return true;
  }
  
  return false;
}

/**
 * Complete folding extension
 */
export const foldingExtension = [
  markdownFoldService,
  markdownFoldGutter,
  foldingKeymap,
  foldedRangesField,
];
