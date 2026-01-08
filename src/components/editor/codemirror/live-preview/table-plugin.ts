/**
 * Table Plugin for Live Preview
 * Renders markdown tables with grid styling and Tab navigation
 * 
 * Requirements: 3.8, 16.3
 */

import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  WidgetType,
  EditorView,
  keymap,
} from '@codemirror/view';
import { RangeSetBuilder, EditorSelection } from '@codemirror/state';
import { shouldRevealLine } from './cursor-context-plugin';

/**
 * Table widget for rendered tables
 */
class TableWidget extends WidgetType {
  constructor(
    private rows: string[][],
    private hasHeader: boolean
  ) {
    super();
  }
  
  eq(other: TableWidget) {
    return JSON.stringify(other.rows) === JSON.stringify(this.rows);
  }
  
  toDOM() {
    const table = document.createElement('table');
    table.className = 'cm-table-widget';
    
    this.rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      
      row.forEach((cell) => {
        const cellEl = document.createElement(
          this.hasHeader && rowIndex === 0 ? 'th' : 'td'
        );
        cellEl.textContent = cell.trim();
        tr.appendChild(cellEl);
      });
      
      // Skip separator row
      if (rowIndex === 1 && this.hasHeader && row.every(c => /^[-:]+$/.test(c.trim()))) {
        return;
      }
      
      table.appendChild(tr);
    });
    
    return table;
  }
  
  ignoreEvent() {
    return true;
  }
}

/**
 * Parse table from text
 */
interface TableMatch {
  from: number;
  to: number;
  rows: string[][];
  hasHeader: boolean;
}

function parseTables(text: string): TableMatch[] {
  const tables: TableMatch[] = [];
  const lines = text.split('\n');
  let offset = 0;
  let tableStart = -1;
  let tableRows: string[][] = [];
  let hasHeader = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = offset;
    const lineEnd = offset + line.length;
    
    // Check if line is a table row
    const isTableRow = line.trim().startsWith('|') && line.trim().endsWith('|');
    const isSeparator = /^\|[-:| ]+\|$/.test(line.trim());
    
    if (isTableRow) {
      if (tableStart === -1) {
        tableStart = lineStart;
        tableRows = [];
      }
      
      // Parse cells
      const cells = line
        .split('|')
        .slice(1, -1) // Remove empty first and last
        .map(c => c.trim());
      
      tableRows.push(cells);
      
      // Check for header separator
      if (isSeparator && tableRows.length === 2) {
        hasHeader = true;
      }
    } else if (tableStart !== -1) {
      // End of table
      if (tableRows.length >= 2) {
        tables.push({
          from: tableStart,
          to: offset - 1, // Previous line end
          rows: tableRows,
          hasHeader,
        });
      }
      tableStart = -1;
      tableRows = [];
      hasHeader = false;
    }
    
    offset = lineEnd + 1;
  }
  
  // Handle table at end of document
  if (tableStart !== -1 && tableRows.length >= 2) {
    tables.push({
      from: tableStart,
      to: offset - 1,
      rows: tableRows,
      hasHeader,
    });
  }
  
  return tables;
}

/**
 * Build table decorations
 * Uses line-based reveal logic for Obsidian-like behavior
 */
function buildTableDecorations(view: EditorView): DecorationSet {
  const decorations: { from: number; to: number; decoration: Decoration; isLine?: boolean }[] = [];
  const doc = view.state.doc;
  const text = doc.toString();
  
  const tables = parseTables(text);
  
  for (const table of tables) {
    // Get line numbers for the table
    const startLine = doc.lineAt(table.from).number;
    const endLine = doc.lineAt(table.to).number;
    
    // Check if any line of the table should reveal syntax
    let shouldReveal = false;
    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      if (shouldRevealLine(view.state, lineNum)) {
        shouldReveal = true;
        break;
      }
    }
    
    if (!shouldReveal) {
      // Replace entire table with widget
      decorations.push({
        from: table.from,
        to: table.to,
        decoration: Decoration.replace({
          widget: new TableWidget(table.rows, table.hasHeader),
          block: true,
        }),
      });
    } else {
      // Add styling for table when editing
      for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
        const line = doc.line(lineNum);
        decorations.push({
          from: line.from,
          to: line.from,
          decoration: Decoration.line({ class: 'cm-table-line' }),
          isLine: true,
        });
      }
    }
  }
  
  // Sort decorations: line decorations first, then by position
  decorations.sort((a, b) => {
    if (a.isLine && !b.isLine) return -1;
    if (!a.isLine && b.isLine) return 1;
    return a.from - b.from || a.to - b.to;
  });
  
  // Build the decoration set
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, decoration } of decorations) {
    try {
      builder.add(from, to, decoration);
    } catch (e) {
      console.warn('Invalid table decoration range:', from, to, e);
    }
  }
  
  return builder.finish();
}

/**
 * Check if cursor is inside a table
 */
function isInTable(view: EditorView): TableMatch | null {
  const text = view.state.doc.toString();
  const tables = parseTables(text);
  const cursor = view.state.selection.main.head;
  
  for (const table of tables) {
    if (cursor >= table.from && cursor <= table.to) {
      return table;
    }
  }
  return null;
}

/**
 * Find cell boundaries at cursor position
 */
function findCellAt(view: EditorView, table: TableMatch): { cellStart: number; cellEnd: number; rowStart: number; rowEnd: number } | null {
  const cursor = view.state.selection.main.head;
  const line = view.state.doc.lineAt(cursor);
  const lineText = line.text;
  
  // Find pipe positions in the line
  const pipes: number[] = [];
  for (let i = 0; i < lineText.length; i++) {
    if (lineText[i] === '|') {
      pipes.push(line.from + i);
    }
  }
  
  if (pipes.length < 2) return null;
  
  // Find which cell the cursor is in
  for (let i = 0; i < pipes.length - 1; i++) {
    const cellStart = pipes[i] + 1;
    const cellEnd = pipes[i + 1];
    if (cursor >= cellStart && cursor <= cellEnd) {
      return { cellStart, cellEnd, rowStart: line.from, rowEnd: line.to };
    }
  }
  
  return null;
}

/**
 * Navigate to next cell in table (Tab)
 */
function navigateToNextCell(view: EditorView): boolean {
  const table = isInTable(view);
  if (!table) return false;
  
  const cell = findCellAt(view, table);
  if (!cell) return false;
  
  const doc = view.state.doc;
  const currentLine = doc.lineAt(cell.rowStart);
  const lineText = currentLine.text;
  
  // Find next pipe after current cell
  const cursorInLine = view.state.selection.main.head - currentLine.from;
  let nextPipeInLine = -1;
  let pipeCount = 0;
  
  for (let i = 0; i < lineText.length; i++) {
    if (lineText[i] === '|') {
      pipeCount++;
      if (i > cursorInLine && pipeCount > 1) {
        nextPipeInLine = i;
        break;
      }
    }
  }
  
  // If found next cell in same row
  if (nextPipeInLine !== -1 && nextPipeInLine < lineText.length - 1) {
    // Check if there's another pipe after (meaning there's a cell)
    const remainingText = lineText.slice(nextPipeInLine + 1);
    const nextPipe = remainingText.indexOf('|');
    if (nextPipe !== -1) {
      const newPos = currentLine.from + nextPipeInLine + 1;
      view.dispatch({
        selection: EditorSelection.cursor(newPos),
      });
      return true;
    }
  }
  
  // Move to next row
  if (currentLine.number < doc.lines) {
    let nextLineNum = currentLine.number + 1;
    let nextLine = doc.line(nextLineNum);
    
    // Skip separator row
    if (/^\|[-:| ]+\|$/.test(nextLine.text.trim()) && nextLineNum < doc.lines) {
      nextLineNum++;
      nextLine = doc.line(nextLineNum);
    }
    
    // Check if next line is still in table
    if (nextLine.from <= table.to && nextLine.text.trim().startsWith('|')) {
      // Find first cell in next row
      const firstPipe = nextLine.text.indexOf('|');
      if (firstPipe !== -1) {
        const newPos = nextLine.from + firstPipe + 1;
        view.dispatch({
          selection: EditorSelection.cursor(newPos),
        });
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Navigate to previous cell in table (Shift+Tab)
 */
function navigateToPrevCell(view: EditorView): boolean {
  const table = isInTable(view);
  if (!table) return false;
  
  const cell = findCellAt(view, table);
  if (!cell) return false;
  
  const doc = view.state.doc;
  const currentLine = doc.lineAt(cell.rowStart);
  const lineText = currentLine.text;
  
  // Find previous pipe before current cell
  const cursorInLine = view.state.selection.main.head - currentLine.from;
  let prevPipeInLine = -1;
  let pipePositions: number[] = [];
  
  for (let i = 0; i < lineText.length; i++) {
    if (lineText[i] === '|') {
      pipePositions.push(i);
    }
  }
  
  // Find which cell we're in and go to previous
  for (let i = pipePositions.length - 1; i >= 1; i--) {
    if (pipePositions[i] < cursorInLine) {
      // Go to start of this cell
      const newPos = currentLine.from + pipePositions[i - 1] + 1;
      view.dispatch({
        selection: EditorSelection.cursor(newPos),
      });
      return true;
    }
  }
  
  // If at first cell, go to previous row
  if (currentLine.number > 1) {
    let prevLineNum = currentLine.number - 1;
    let prevLine = doc.line(prevLineNum);
    
    // Skip separator row
    if (/^\|[-:| ]+\|$/.test(prevLine.text.trim()) && prevLineNum > 1) {
      prevLineNum--;
      prevLine = doc.line(prevLineNum);
    }
    
    // Check if prev line is still in table
    if (prevLine.from >= table.from && prevLine.text.trim().startsWith('|')) {
      // Find last cell in prev row
      const pipes: number[] = [];
      for (let i = 0; i < prevLine.text.length; i++) {
        if (prevLine.text[i] === '|') {
          pipes.push(i);
        }
      }
      if (pipes.length >= 2) {
        const newPos = prevLine.from + pipes[pipes.length - 2] + 1;
        view.dispatch({
          selection: EditorSelection.cursor(newPos),
        });
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Table navigation keymap
 */
const tableKeymap = keymap.of([
  {
    key: 'Tab',
    run: (view) => navigateToNextCell(view),
  },
  {
    key: 'Shift-Tab',
    run: (view) => navigateToPrevCell(view),
  },
]);

/**
 * Table view plugin
 */
const tableViewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    
    constructor(view: EditorView) {
      this.decorations = buildTableDecorations(view);
    }
    
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildTableDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

/**
 * Complete table plugin with navigation
 */
export const tablePlugin = [tableViewPlugin, tableKeymap];
