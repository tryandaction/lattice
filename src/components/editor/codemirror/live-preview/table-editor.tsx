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

interface TableMutationResult {
  rows: string[][];
  alignments: TableAlignment[];
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
  const wrapperRef = useRef<HTMLDivElement>(null);
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

  return (
    <div
      ref={wrapperRef}
      className="table-editor-wrapper"
      tabIndex={0}
      onKeyDown={handleWrapperKeyDown}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
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
      <div className="table-editor-viewport">
        <table className="table-editor">
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
                      isSelected ? 'selected' : '',
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
