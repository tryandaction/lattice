import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { EditorView } from '@codemirror/view';

export type TableAlignment = 'left' | 'center' | 'right' | null;

export interface TableEditorProps {
  rows: string[][];
  hasHeader: boolean;
  alignments: TableAlignment[];
  from: number;
  to: number;
  view: EditorView;
  onUpdate: (newMarkdown: string) => void;
  renderCellHtml?: (value: string) => string;
}

interface CellPosition {
  row: number;
  col: number;
}

interface TableStructureMenuState {
  kind: 'table' | 'row' | 'column';
  row?: number;
  col?: number;
  x: number;
  y: number;
}

interface TableMutationResult {
  rows: string[][];
  alignments: TableAlignment[];
}

interface TableOverlayMetrics {
  columnCenters: number[];
  rowCenters: number[];
}

function isDirectTypingKey(event: React.KeyboardEvent): boolean {
  return !event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1;
}

function isExternalLinkTarget(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('//')) return true;
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cloneRows(rows: string[][]): string[][] {
  return rows.map((row) => [...row]);
}

function getColumnCount(rows: string[][], alignments: TableAlignment[]): number {
  return Math.max(alignments.length, ...rows.map((row) => row.length), 0);
}

function normalizeRows(rows: string[][], colCount: number): string[][] {
  return cloneRows(rows).map((row) => {
    const next = [...row];
    while (next.length < colCount) {
      next.push('');
    }
    return next;
  });
}

function normalizeEditorState(
  rows: string[][],
  alignments: TableAlignment[],
): { rows: string[][]; alignments: TableAlignment[] } {
  const colCount = getColumnCount(rows, alignments);
  return {
    rows: normalizeRows(rows, colCount),
    alignments: Array.from({ length: colCount }, (_, index) => alignments[index] ?? null),
  };
}

function isSeparatorCell(value: string): boolean {
  return /^:?-{3,}:?$/.test(value.trim());
}

function hasExplicitSeparatorRow(rows: string[][], hasHeader: boolean): boolean {
  return Boolean(
    hasHeader &&
      rows.length > 1 &&
      rows[1].length > 0 &&
      rows[1].every(isSeparatorCell)
  );
}

function ensureHeaderSeparatorRow(rows: string[][], alignments: TableAlignment[]): string[][] {
  if (!rows.length) return rows;
  const colCount = getColumnCount(rows, alignments);
  const normalized = normalizeRows(rows, colCount);
  const separator = Array.from({ length: colCount }, (_, index) => {
    const alignment = alignments[index] ?? null;
    if (alignment === 'left') return ':---';
    if (alignment === 'center') return ':---:';
    if (alignment === 'right') return '---:';
    return '---';
  });

  if (normalized.length === 1) {
    return [normalized[0], separator];
  }

  normalized[1] = separator;
  return normalized;
}

function getEditableRows(rows: string[][], hasHeader: boolean): string[][] {
  if (!hasExplicitSeparatorRow(rows, hasHeader)) {
    return cloneRows(rows);
  }
  const [header, , ...body] = rows;
  return [[...header], ...body.map((row) => [...row])];
}

function clampCellPosition(
  cell: CellPosition | null,
  rows: string[][],
  alignments: TableAlignment[],
): CellPosition | null {
  const colCount = getColumnCount(rows, alignments);
  if (rows.length === 0 || colCount === 0) {
    return null;
  }

  if (!cell) {
    return { row: 0, col: 0 };
  }

  return {
    row: Math.max(0, Math.min(cell.row, rows.length - 1)),
    col: Math.max(0, Math.min(cell.col, colCount - 1)),
  };
}

function getCellPositionFromTarget(target: EventTarget | null): CellPosition | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const cell = target.closest<HTMLElement>('[data-table-row][data-table-col]');
  if (!cell) {
    return null;
  }

  const row = Number(cell.dataset.tableRow);
  const col = Number(cell.dataset.tableCol);
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    return null;
  }

  return { row, col };
}

function toggleCellHighlightValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('==') && trimmed.endsWith('==') && trimmed.length >= 4) {
    const start = value.indexOf('==');
    const end = value.lastIndexOf('==');
    return `${value.slice(0, start)}${value.slice(start + 2, end)}${value.slice(end + 2)}`;
  }

  if (!value) {
    return '== ==';
  }

  return `==${value}==`;
}

function toggleCellHighlight(
  rows: string[][],
  rowIndex: number,
  colIndex: number,
): string[][] {
  const nextRows = cloneRows(rows);
  nextRows[rowIndex][colIndex] = toggleCellHighlightValue(nextRows[rowIndex][colIndex] ?? '');
  return nextRows;
}

function toggleRowHighlight(
  rows: string[][],
  rowIndex: number,
): string[][] {
  const nextRows = cloneRows(rows);
  const shouldClear = nextRows[rowIndex].every((cell) => cell.trim().startsWith('==') && cell.trim().endsWith('=='));
  nextRows[rowIndex] = nextRows[rowIndex].map((cell) => {
    if (shouldClear) {
      return toggleCellHighlightValue(cell);
    }
    return cell.trim().startsWith('==') && cell.trim().endsWith('==') ? cell : `==${cell || ' '}==`;
  });
  return nextRows;
}

function toggleColumnHighlight(
  rows: string[][],
  colIndex: number,
): string[][] {
  const nextRows = cloneRows(rows);
  const shouldClear = nextRows.every((row) => {
    const cell = row[colIndex] ?? '';
    return cell.trim().startsWith('==') && cell.trim().endsWith('==');
  });

  nextRows.forEach((row, rowIndex) => {
    const cell = row[colIndex] ?? '';
    nextRows[rowIndex][colIndex] = shouldClear
      ? toggleCellHighlightValue(cell)
      : (cell.trim().startsWith('==') && cell.trim().endsWith('==') ? cell : `==${cell || ' '}==`);
  });

  return nextRows;
}

export function tableToMarkdown(rows: string[][], alignments: TableAlignment[], hasHeader: boolean): string {
  if (rows.length === 0) return '';

  const editableRows = getEditableRows(rows, hasHeader);
  const colCount = getColumnCount(editableRows, alignments);
  const normalizedRows = normalizeRows(editableRows, colCount);
  const normalizedAlignments = Array.from({ length: colCount }, (_, index) => alignments[index] ?? null);
  const lines: string[] = [];

  if (hasHeader) {
    const header = normalizedRows[0] ?? Array.from({ length: colCount }, () => '');
    lines.push(`| ${header.map((cell) => cell || '').join(' | ')} |`);

    const separator = normalizedAlignments.map((alignment) => {
      if (alignment === 'left') return ':---';
      if (alignment === 'center') return ':---:';
      if (alignment === 'right') return '---:';
      return '---';
    });
    lines.push(`| ${separator.join(' | ')} |`);

    for (const row of normalizedRows.slice(1)) {
      lines.push(`| ${row.map((cell) => cell || '').join(' | ')} |`);
    }
    return lines.join('\n');
  }

  for (const row of normalizedRows) {
    lines.push(`| ${row.map((cell) => cell || '').join(' | ')} |`);
  }
  return lines.join('\n');
}

export function insertTableColumn(
  rows: string[][],
  alignments: TableAlignment[],
  hasHeader: boolean,
  columnIndex: number,
  alignment: TableAlignment = null
): TableMutationResult {
  const colCount = getColumnCount(rows, alignments);
  const insertAt = Math.max(0, Math.min(columnIndex + 1, colCount));
  const nextRows = normalizeRows(rows, colCount).map((row, rowIndex) => {
    const cell = hasExplicitSeparatorRow(rows, hasHeader) && hasHeader && rowIndex === 1 ? '---' : '';
    row.splice(insertAt, 0, cell);
    return row;
  });
  const nextAlignments = [...alignments];
  nextAlignments.splice(insertAt, 0, alignment);
  return {
    rows: hasHeader ? ensureHeaderSeparatorRow(nextRows, nextAlignments) : nextRows,
    alignments: nextAlignments,
  };
}

export function deleteTableColumn(
  rows: string[][],
  alignments: TableAlignment[],
  hasHeader: boolean,
  columnIndex: number
): TableMutationResult {
  const colCount = getColumnCount(rows, alignments);
  if (colCount <= 1) {
    return {
      rows: hasHeader ? ensureHeaderSeparatorRow(rows, alignments) : cloneRows(rows),
      alignments: [...alignments],
    };
  }

  const removeAt = Math.max(0, Math.min(columnIndex, colCount - 1));
  const nextRows = normalizeRows(rows, colCount).map((row) => {
    row.splice(removeAt, 1);
    return row;
  });
  const nextAlignments = [...alignments];
  nextAlignments.splice(removeAt, 1);
  return {
    rows: hasHeader ? ensureHeaderSeparatorRow(nextRows, nextAlignments) : nextRows,
    alignments: nextAlignments,
  };
}

export function insertTableDataRow(
  rows: string[][],
  alignments: TableAlignment[],
  hasHeader: boolean,
  rowIndex: number,
  position: 'above' | 'below'
): TableMutationResult {
  const colCount = getColumnCount(rows, alignments);
  const nextRows = cloneRows(rows);
  const minimumDataIndex = hasHeader ? (hasExplicitSeparatorRow(rows, hasHeader) ? 2 : 1) : 0;
  const baseIndex = Math.max(minimumDataIndex, rowIndex);
  const insertAt = position === 'above' ? baseIndex : baseIndex + 1;
  nextRows.splice(insertAt, 0, Array.from({ length: colCount }, () => ''));
  return {
    rows: hasHeader ? ensureHeaderSeparatorRow(nextRows, alignments) : nextRows,
    alignments: [...alignments],
  };
}

export function deleteTableDataRow(
  rows: string[][],
  alignments: TableAlignment[],
  hasHeader: boolean,
  rowIndex: number
): TableMutationResult {
  const nextRows = cloneRows(rows);
  const minimumDataIndex = hasHeader ? (hasExplicitSeparatorRow(rows, hasHeader) ? 2 : 1) : 0;
  const dataRowCount = nextRows.length - minimumDataIndex;
  if (dataRowCount <= 1 || rowIndex < minimumDataIndex || rowIndex >= nextRows.length) {
    return {
      rows: hasHeader ? ensureHeaderSeparatorRow(nextRows, alignments) : nextRows,
      alignments: [...alignments],
    };
  }

  nextRows.splice(rowIndex, 1);
  return {
    rows: hasHeader ? ensureHeaderSeparatorRow(nextRows, alignments) : nextRows,
    alignments: [...alignments],
  };
}

export function setTableColumnAlignment(
  rows: string[][],
  alignments: TableAlignment[],
  hasHeader: boolean,
  columnIndex: number,
  alignment: TableAlignment
): TableMutationResult {
  const colCount = getColumnCount(rows, alignments);
  const nextAlignments = Array.from({ length: colCount }, (_, index) => alignments[index] ?? null);
  const targetIndex = Math.max(0, Math.min(columnIndex, colCount - 1));
  nextAlignments[targetIndex] = alignment;
  const nextRows = hasHeader ? ensureHeaderSeparatorRow(rows, nextAlignments) : cloneRows(rows);
  return {
    rows: nextRows,
    alignments: nextAlignments,
  };
}

export const TableEditor: React.FC<TableEditorProps> = ({
  rows: initialRows,
  hasHeader,
  alignments: initialAlignments,
  from,
  to,
  view,
  onUpdate,
  renderCellHtml,
}) => {
  const initialState = useMemo(
    () => normalizeEditorState(initialRows, initialAlignments),
    [initialRows, initialAlignments]
  );
  const [rows, setRows] = useState(initialState.rows);
  const [alignments, setAlignments] = useState(initialState.alignments);
  const [selectedCell, setSelectedCell] = useState<CellPosition | null>(null);
  const [editingCell, setEditingCell] = useState<CellPosition | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [isHovered, setIsHovered] = useState(false);
  const [overlayMetrics, setOverlayMetrics] = useState<TableOverlayMetrics>({ columnCenters: [], rowCenters: [] });
  const [structureMenu, setStructureMenu] = useState<TableStructureMenuState | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isMountedRef = useRef(true);
  const pendingCommitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pendingCommitTimerRef.current !== null) {
        window.clearTimeout(pendingCommitTimerRef.current);
        pendingCommitTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
    if (editingCell && inputRef.current) {
      inputRef.current.style.height = '0px';
      inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
    }
  }, [draftValue, editingCell]);

  useEffect(() => {
    const table = tableRef.current;
    if (!table) {
      return;
    }

    const updateMetrics = () => {
      const firstRow = table.rows.item(0);
      const columnCenters = firstRow
        ? Array.from(firstRow.cells).map((cell) => cell.offsetLeft + (cell.offsetWidth / 2))
        : [];
      const rowCenters = Array.from(table.rows).map((row) => row.offsetTop + (row.offsetHeight / 2));
      setOverlayMetrics((previous) => {
        const sameColumns = previous.columnCenters.length === columnCenters.length &&
          previous.columnCenters.every((value, index) => Math.abs(value - columnCenters[index]) < 0.5);
        const sameRows = previous.rowCenters.length === rowCenters.length &&
          previous.rowCenters.every((value, index) => Math.abs(value - rowCenters[index]) < 0.5);
        if (sameColumns && sameRows) {
          return previous;
        }
        return { columnCenters, rowCenters };
      });
    };

    updateMetrics();
    const observer = new ResizeObserver(updateMetrics);
    observer.observe(table);
    Array.from(table.rows).forEach((row) => observer.observe(row));

    return () => observer.disconnect();
  }, [rows, alignments, editingCell]);

  const columnCount = useMemo(() => getColumnCount(rows, alignments), [rows, alignments]);
  const dataRowStart = hasHeader ? 1 : 0;
  const defaultCell = useMemo(
    () => clampCellPosition({ row: Math.min(dataRowStart, Math.max(rows.length - 1, 0)), col: 0 }, rows, alignments),
    [alignments, dataRowStart, rows]
  );
  const activeCell = selectedCell ?? defaultCell;

  const focusWrapper = useCallback(() => {
    wrapperRef.current?.focus();
  }, []);

  const updateEditor = useCallback((nextRows: string[][], nextAlignments: TableAlignment[]) => {
    if (!isMountedRef.current) {
      return;
    }

    const markdown = tableToMarkdown(nextRows, nextAlignments, hasHeader);
    onUpdate(markdown);

    if (pendingCommitTimerRef.current !== null) {
      window.clearTimeout(pendingCommitTimerRef.current);
    }

    pendingCommitTimerRef.current = window.setTimeout(() => {
      pendingCommitTimerRef.current = null;

      if (!isMountedRef.current) {
        return;
      }

      const docLength = view.state.doc.length;
      if (from < 0 || from > docLength) {
        return;
      }

      const safeTo = Math.min(Math.max(to, from), docLength);
      view.dispatch({
        changes: { from, to: safeTo, insert: markdown },
      });
    }, 0);
  }, [from, hasHeader, onUpdate, to, view]);

  const selectCell = useCallback((cell: CellPosition | null) => {
    setSelectedCell(clampCellPosition(cell, rows, alignments));
    focusWrapper();
  }, [alignments, focusWrapper, rows]);

  const startEditingCell = useCallback((cell: CellPosition) => {
    const normalized = clampCellPosition(cell, rows, alignments);
    if (!normalized) return;
    setSelectedCell(normalized);
    setEditingCell(normalized);
    setDraftValue(rows[normalized.row]?.[normalized.col] ?? '');
  }, [alignments, rows]);

  const beginTypingInCell = useCallback((cell: CellPosition, nextValue: string) => {
    const normalized = clampCellPosition(cell, rows, alignments);
    if (!normalized) return;
    setSelectedCell(normalized);
    setEditingCell(normalized);
    setDraftValue(nextValue);
  }, [alignments, rows]);

  const moveCell = useCallback((cell: CellPosition, rowDelta: number, colDelta: number): CellPosition => {
    const nextRow = Math.max(0, Math.min(cell.row + rowDelta, rows.length - 1));
    const nextCol = Math.max(0, Math.min(cell.col + colDelta, columnCount - 1));
    return { row: nextRow, col: nextCol };
  }, [columnCount, rows.length]);

  const applyTableState = useCallback((
    nextRowsInput: string[][],
    nextAlignmentsInput: TableAlignment[],
    nextSelection?: CellPosition | null
  ) => {
    const nextState = normalizeEditorState(nextRowsInput, nextAlignmentsInput);
    setRows(nextState.rows);
    setAlignments(nextState.alignments);
    setEditingCell(null);
    setDraftValue('');
    setSelectedCell(clampCellPosition(nextSelection ?? selectedCell, nextState.rows, nextState.alignments));
    updateEditor(nextState.rows, nextState.alignments);
    window.setTimeout(() => {
      if (isMountedRef.current) {
        focusWrapper();
      }
    }, 0);
  }, [focusWrapper, selectedCell, updateEditor]);

  const commitEditing = useCallback((nextSelection?: CellPosition | null) => {
    if (!editingCell) {
      if (nextSelection !== undefined) {
        setSelectedCell(clampCellPosition(nextSelection, rows, alignments));
      }
      return;
    }

    const nextRows = cloneRows(rows);
    nextRows[editingCell.row][editingCell.col] = draftValue;
    applyTableState(nextRows, alignments, nextSelection ?? editingCell);
  }, [alignments, applyTableState, draftValue, editingCell, rows]);

  const cancelEditing = useCallback(() => {
    setEditingCell(null);
    setDraftValue('');
    focusWrapper();
  }, [focusWrapper]);

  const handleCellClick = useCallback((row: number, col: number) => {
    const cell = { row, col };
    if (editingCell && (editingCell.row !== row || editingCell.col !== col)) {
      commitEditing(cell);
      return;
    }
    selectCell(cell);
  }, [commitEditing, editingCell, selectCell]);

  const handleCellDoubleClick = useCallback((row: number, col: number) => {
    startEditingCell({ row, col });
  }, [startEditingCell]);

  const handleCellBlur = useCallback(() => {
    if (!isMountedRef.current || !editingCell) {
      return;
    }
    commitEditing();
  }, [commitEditing, editingCell]);

  const closeStructureMenu = useCallback(() => {
    setStructureMenu(null);
  }, []);

  const openStructureMenu = useCallback((menu: TableStructureMenuState) => {
    setStructureMenu(menu);
    focusWrapper();
  }, [focusWrapper]);

  const handleDisplayCellClick = useCallback((
    event: React.MouseEvent<HTMLSpanElement>,
    cell: CellPosition
  ) => {
    const target = event.target as HTMLElement | null;
    const link = target?.closest('a');
    if (!link) return;

    const isWikiLink = link.classList.contains('cm-wiki-link-table');
    const linkTarget = link.getAttribute('data-target') ?? link.getAttribute('href') ?? '';
    const shouldOpenLink = event.metaKey || event.ctrlKey;
    if (!shouldOpenLink) {
      event.preventDefault();
      event.stopPropagation();
      selectCell(cell);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (isWikiLink || !isExternalLinkTarget(linkTarget)) {
    if (linkTarget) {
      link.dispatchEvent(
        new CustomEvent(isWikiLink ? 'wiki-link-click' : 'workspace-link-click', {
          detail: { target: linkTarget },
          bubbles: true,
        })
      );
    }
    return;
  }

    if (linkTarget) {
      link.dispatchEvent(
        new CustomEvent('external-link-click', {
          detail: { url: linkTarget },
          bubbles: true,
        })
      );
    }
  }, [selectCell]);

  const handleWrapperKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editingCell || columnCount === 0 || rows.length === 0 || !activeCell) {
      return;
    }

    switch (event.key) {
      case 'Enter':
      case 'F2':
        event.preventDefault();
        startEditingCell(activeCell);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        setSelectedCell(moveCell(activeCell, 0, -1));
        return;
      case 'ArrowRight':
        event.preventDefault();
        setSelectedCell(moveCell(activeCell, 0, 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setSelectedCell(moveCell(activeCell, -1, 0));
        return;
      case 'ArrowDown':
        event.preventDefault();
        setSelectedCell(moveCell(activeCell, 1, 0));
        return;
      case 'Tab': {
        event.preventDefault();
        if (event.shiftKey) {
          if (activeCell.col > 0) {
            setSelectedCell({ row: activeCell.row, col: activeCell.col - 1 });
          } else if (activeCell.row > 0) {
            setSelectedCell({ row: activeCell.row - 1, col: columnCount - 1 });
          }
        } else if (activeCell.col < columnCount - 1) {
          setSelectedCell({ row: activeCell.row, col: activeCell.col + 1 });
        } else if (activeCell.row < rows.length - 1) {
          setSelectedCell({ row: activeCell.row + 1, col: 0 });
        }
        return;
      }
      default:
        if (isDirectTypingKey(event)) {
          event.preventDefault();
          beginTypingInCell(activeCell, event.key);
          return;
        }

        if (event.key === 'Backspace' || event.key === 'Delete') {
          event.preventDefault();
          beginTypingInCell(activeCell, '');
          return;
        }

        return;
    }
  }, [activeCell, beginTypingInCell, columnCount, editingCell, moveCell, rows.length, startEditingCell]);

  const handleInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!editingCell) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing();
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      if (event.shiftKey) {
        if (editingCell.col > 0) {
          commitEditing({ row: editingCell.row, col: editingCell.col - 1 });
        } else if (editingCell.row > 0) {
          commitEditing({ row: editingCell.row - 1, col: columnCount - 1 });
        } else {
          commitEditing(editingCell);
        }
      } else if (editingCell.col < columnCount - 1) {
        commitEditing({ row: editingCell.row, col: editingCell.col + 1 });
      } else if (editingCell.row < rows.length - 1) {
        commitEditing({ row: editingCell.row + 1, col: 0 });
      } else {
        commitEditing(editingCell);
      }
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (editingCell.row < rows.length - 1) {
        commitEditing({ row: editingCell.row + 1, col: editingCell.col });
      } else {
        commitEditing(editingCell);
      }
    }
  }, [cancelEditing, columnCount, commitEditing, editingCell, rows.length]);

  const handleInsertColumn = useCallback((colIndex: number, position: 'left' | 'right') => {
    const result = insertTableColumn(rows, alignments, hasHeader, position === 'left' ? colIndex - 1 : colIndex);
    applyTableState(result.rows, result.alignments, { row: selectedCell?.row ?? 0, col: position === 'left' ? colIndex : colIndex + 1 });
    closeStructureMenu();
  }, [alignments, applyTableState, closeStructureMenu, hasHeader, rows, selectedCell]);

  const handleDeleteColumn = useCallback((colIndex: number) => {
    const result = deleteTableColumn(rows, alignments, hasHeader, colIndex);
    applyTableState(result.rows, result.alignments, { row: selectedCell?.row ?? 0, col: Math.max(0, Math.min(colIndex, result.alignments.length - 1)) });
    closeStructureMenu();
  }, [alignments, applyTableState, closeStructureMenu, hasHeader, rows, selectedCell]);

  const handleInsertRow = useCallback((rowIndex: number, position: 'above' | 'below') => {
    const result = insertTableDataRow(rows, alignments, hasHeader, rowIndex, position);
    const nextRow = position === 'above' ? rowIndex : rowIndex + 1;
    applyTableState(result.rows, result.alignments, { row: nextRow, col: selectedCell?.col ?? 0 });
    closeStructureMenu();
  }, [alignments, applyTableState, closeStructureMenu, hasHeader, rows, selectedCell]);

  const handleDeleteRow = useCallback((rowIndex: number) => {
    const result = deleteTableDataRow(rows, alignments, hasHeader, rowIndex);
    applyTableState(result.rows, result.alignments, { row: Math.max(dataRowStart, Math.min(rowIndex, result.rows.length - 1)), col: selectedCell?.col ?? 0 });
    closeStructureMenu();
  }, [alignments, applyTableState, closeStructureMenu, dataRowStart, hasHeader, rows, selectedCell]);

  const handleSetAlignment = useCallback((colIndex: number, alignment: TableAlignment) => {
    const result = setTableColumnAlignment(rows, alignments, hasHeader, colIndex, alignment);
    applyTableState(result.rows, result.alignments, selectedCell);
    closeStructureMenu();
  }, [alignments, applyTableState, closeStructureMenu, hasHeader, rows, selectedCell]);

  const handleHighlightCell = useCallback((cell: CellPosition) => {
    applyTableState(toggleCellHighlight(rows, cell.row, cell.col), alignments, cell);
  }, [alignments, applyTableState, rows]);

  const handleHighlightRow = useCallback((rowIndex: number) => {
    applyTableState(toggleRowHighlight(rows, rowIndex), alignments, { row: rowIndex, col: selectedCell?.col ?? 0 });
    closeStructureMenu();
  }, [alignments, applyTableState, closeStructureMenu, rows, selectedCell]);

  const handleHighlightColumn = useCallback((colIndex: number) => {
    applyTableState(toggleColumnHighlight(rows, colIndex), alignments, { row: selectedCell?.row ?? dataRowStart, col: colIndex });
    closeStructureMenu();
  }, [alignments, applyTableState, closeStructureMenu, dataRowStart, rows, selectedCell]);

  return (
    <div
      ref={wrapperRef}
      className="table-editor-wrapper"
      tabIndex={0}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onKeyDown={handleWrapperKeyDown}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
        closeStructureMenu();
      }}
      onContextMenu={(event) => {
        const contextCell = getCellPositionFromTarget(event.target);
        if (contextCell) {
          event.preventDefault();
          setSelectedCell(contextCell);
          focusWrapper();
        }
      }}
      role="group"
      aria-label="Markdown table editor"
    >
      {(isHovered || structureMenu || selectedCell) && overlayMetrics.columnCenters.map((center, colIndex) => (
        <button
          key={`column-handle-${colIndex}`}
          type="button"
          className="table-editor-perimeter-handle table-editor-perimeter-handle--column"
          style={{ left: `${center}px`, top: "-10px", transform: "translate(-50%, -100%)" }}
          aria-label={`Column ${colIndex + 1} actions`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => openStructureMenu({ kind: 'column', col: colIndex, x: center, y: 0 })}
        >
          ⋮
        </button>
      ))}

      {(isHovered || structureMenu || selectedCell) && overlayMetrics.rowCenters.slice(dataRowStart).map((center, index) => {
        const rowIndex = index + dataRowStart;
        return (
          <button
            key={`row-handle-${rowIndex}`}
            type="button"
            className="table-editor-perimeter-handle table-editor-perimeter-handle--row"
            style={{ left: "-10px", top: `${center}px`, transform: "translate(-100%, -50%)" }}
            aria-label={`Row ${rowIndex + 1} actions`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => openStructureMenu({ kind: 'row', row: rowIndex, x: 0, y: center })}
          >
            ⋯
          </button>
        );
      })}

      {(isHovered || structureMenu) ? (
        <button
          type="button"
          className="table-editor-perimeter-handle table-editor-perimeter-handle--table"
          style={{ left: "-10px", top: "-10px", transform: "translate(-100%, -100%)" }}
          aria-label="Table actions"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => openStructureMenu({ kind: 'table', x: 0, y: 0 })}
        >
          ⊕
        </button>
      ) : null}

      {structureMenu ? (
        <div
          className="table-editor-perimeter-panel"
          style={{
            left: structureMenu.kind === 'row' ? structureMenu.x : structureMenu.x,
            top: structureMenu.kind === 'row' ? structureMenu.y : structureMenu.y,
            transform: structureMenu.kind === 'row'
              ? 'translate(calc(-100% - 12px), -50%)'
              : structureMenu.kind === 'column'
                ? 'translate(-50%, calc(-100% - 12px))'
                : 'translate(calc(-100% - 12px), calc(-100% - 12px))',
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <div className="table-editor-panel-meta">
            {structureMenu.kind === 'row'
              ? `Row ${structureMenu.row! + 1}`
              : structureMenu.kind === 'column'
                ? `Column ${structureMenu.col! + 1}`
                : 'Table'}
          </div>

          {structureMenu.kind === 'table' ? (
            <>
              <div className="table-editor-panel-group">
                <div className="table-editor-panel-label">Structure</div>
                <div className="table-editor-panel-actions">
                  <button className="btn-icon btn-icon--menu" type="button" onClick={() => handleInsertColumn(columnCount - 1, 'right')}>Add Column</button>
                  <button className="btn-icon btn-icon--menu" type="button" onClick={() => handleInsertRow(rows.length - 1, 'below')}>Add Row</button>
                </div>
              </div>
              {selectedCell ? (
                <div className="table-editor-panel-group">
                  <div className="table-editor-panel-label">Cell</div>
                  <div className="table-editor-panel-actions">
                    <button className="btn-icon btn-icon--menu" type="button" onClick={() => handleHighlightCell(selectedCell)}>Highlight</button>
                    <button className="btn-icon btn-icon--menu" type="button" onClick={() => startEditingCell(selectedCell)}>Edit</button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {structureMenu.kind === 'row' ? (
            <>
              <div className="table-editor-panel-group">
                <div className="table-editor-panel-label">Row</div>
                <div className="table-editor-panel-actions">
                  <button className="btn-icon btn-icon--menu" type="button" onClick={() => handleInsertRow(structureMenu.row!, 'above')}>Insert Above</button>
                  <button className="btn-icon btn-icon--menu" type="button" onClick={() => handleInsertRow(structureMenu.row!, 'below')}>Insert Below</button>
                  <button className="btn-icon btn-icon--menu" type="button" onClick={() => handleDeleteRow(structureMenu.row!)}>Delete Row</button>
                  <button className="btn-icon btn-icon--menu" type="button" onClick={() => handleHighlightRow(structureMenu.row!)}>Highlight Row</button>
                </div>
              </div>
            </>
          ) : null}

          {structureMenu.kind === 'column' ? (
            <>
              <div className="table-editor-panel-group">
                <div className="table-editor-panel-label">Column</div>
                <div className="table-editor-panel-actions">
                  <button className="btn-icon btn-icon--menu" type="button" onClick={() => handleInsertColumn(structureMenu.col!, 'left')}>Insert Left</button>
                  <button className="btn-icon btn-icon--menu" type="button" onClick={() => handleInsertColumn(structureMenu.col!, 'right')}>Insert Right</button>
                  <button className="btn-icon btn-icon--menu" type="button" onClick={() => handleDeleteColumn(structureMenu.col!)}>Delete Column</button>
                  <button className="btn-icon btn-icon--menu" type="button" onClick={() => handleHighlightColumn(structureMenu.col!)}>Highlight Column</button>
                </div>
              </div>
              <div className="table-editor-panel-group">
                <div className="table-editor-panel-label">Alignment</div>
                <div className="table-editor-panel-actions">
                  <button className="btn-icon btn-icon--menu" type="button" onClick={() => handleSetAlignment(structureMenu.col!, 'left')}>Left</button>
                  <button className="btn-icon btn-icon--menu" type="button" onClick={() => handleSetAlignment(structureMenu.col!, 'center')}>Center</button>
                  <button className="btn-icon btn-icon--menu" type="button" onClick={() => handleSetAlignment(structureMenu.col!, 'right')}>Right</button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="table-editor-viewport">
        <table ref={tableRef} className="table-editor">
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
              {row.map((cell, colIndex) => {
                const isEditing = editingCell?.row === rowIndex && editingCell?.col === colIndex;
                const isSelected = selectedCell?.row === rowIndex && selectedCell?.col === colIndex;
                const isHeader = hasHeader && rowIndex === 0;
                const CellTag = isHeader ? 'th' : 'td';
                const renderedHtml = renderCellHtml ? renderCellHtml(cell) : escapeHtml(cell);
                const cellPosition = { row: rowIndex, col: colIndex };

                return (
                  <CellTag
                    key={colIndex}
                    data-table-row={rowIndex}
                    data-table-col={colIndex}
                    className={[
                      isEditing ? 'editing' : '',
                      !isEditing && isSelected ? 'selected' : '',
                    ].filter(Boolean).join(' ')}
                    style={{ textAlign: alignments[colIndex] || 'left' }}
                    onClick={() => !isEditing && handleCellClick(rowIndex, colIndex)}
                    onDoubleClick={() => handleCellDoubleClick(rowIndex, colIndex)}
                  >
                    {isEditing ? (
                      <textarea
                        ref={inputRef}
                        value={draftValue}
                        onChange={(event) => setDraftValue(event.target.value)}
                        onBlur={handleCellBlur}
                        onKeyDown={handleInputKeyDown}
                        style={{ textAlign: alignments[colIndex] || 'left' }}
                        rows={1}
                      />
                    ) : (
                      <span
                        className="cell-content"
                        onClick={(event) => handleDisplayCellClick(event, cellPosition)}
                        dangerouslySetInnerHTML={{ __html: cell ? renderedHtml : '&nbsp;' }}
                      />
                    )}
                  </CellTag>
                );
              })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
