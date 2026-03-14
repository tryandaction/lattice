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

const ALIGNMENT_SEQUENCE: TableAlignment[] = [null, 'left', 'center', 'right'];

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
  const [selectedCell, setSelectedCell] = useState<CellPosition | null>(
    clampCellPosition({ row: 0, col: 0 }, initialState.rows, initialState.alignments)
  );
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
  }, [editingCell]);

  const columnCount = useMemo(() => getColumnCount(rows, alignments), [rows, alignments]);
  const dataRowStart = hasHeader ? 1 : 0;

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

  const getWorkingRows = useCallback(() => {
    const nextRows = cloneRows(rows);
    if (editingCell) {
      nextRows[editingCell.row][editingCell.col] = draftValue;
    }
    return nextRows;
  }, [draftValue, editingCell, rows]);

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
    const shouldOpenLink = event.metaKey || event.ctrlKey;
    if (!shouldOpenLink) {
      event.preventDefault();
      event.stopPropagation();
      selectCell(cell);
      return;
    }

    if (isWikiLink) {
      event.preventDefault();
      event.stopPropagation();
      const wikiTarget = link.getAttribute('data-target');
      if (wikiTarget) {
        link.dispatchEvent(
          new CustomEvent('wiki-link-click', {
            detail: { target: wikiTarget },
            bubbles: true,
          })
        );
      }
    }
  }, [selectCell]);

  const handleTableMutation = useCallback((
    mutator: (workingRows: string[][], workingAlignments: TableAlignment[]) => TableMutationResult,
    nextSelection?: CellPosition | null
  ) => {
    const workingRows = getWorkingRows();
    const result = mutator(workingRows, alignments);
    applyTableState(result.rows, result.alignments, nextSelection);
  }, [alignments, applyTableState, getWorkingRows]);

  const cycleAlignment = useCallback((columnIndex: number) => {
    const current = alignments[columnIndex] ?? null;
    const nextIndex = (ALIGNMENT_SEQUENCE.indexOf(current) + 1) % ALIGNMENT_SEQUENCE.length;
    const nextAlignment = ALIGNMENT_SEQUENCE[nextIndex];

    handleTableMutation(
      (workingRows, workingAlignments) =>
        setTableColumnAlignment(workingRows, workingAlignments, hasHeader, columnIndex, nextAlignment),
      selectedCell ? { row: selectedCell.row, col: Math.min(columnIndex, columnCount - 1) } : { row: 0, col: columnIndex }
    );
  }, [alignments, columnCount, handleTableMutation, hasHeader, selectedCell]);

  const handleWrapperKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editingCell || !selectedCell || columnCount === 0 || rows.length === 0) {
      return;
    }

    switch (event.key) {
      case 'Enter':
      case 'F2':
        event.preventDefault();
        startEditingCell(selectedCell);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        setSelectedCell(moveCell(selectedCell, 0, -1));
        return;
      case 'ArrowRight':
        event.preventDefault();
        setSelectedCell(moveCell(selectedCell, 0, 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setSelectedCell(moveCell(selectedCell, -1, 0));
        return;
      case 'ArrowDown':
        event.preventDefault();
        setSelectedCell(moveCell(selectedCell, 1, 0));
        return;
      case 'Tab': {
        event.preventDefault();
        if (event.shiftKey) {
          if (selectedCell.col > 0) {
            setSelectedCell({ row: selectedCell.row, col: selectedCell.col - 1 });
          } else if (selectedCell.row > 0) {
            setSelectedCell({ row: selectedCell.row - 1, col: columnCount - 1 });
          }
        } else if (selectedCell.col < columnCount - 1) {
          setSelectedCell({ row: selectedCell.row, col: selectedCell.col + 1 });
        } else if (selectedCell.row < rows.length - 1) {
          setSelectedCell({ row: selectedCell.row + 1, col: 0 });
        }
        return;
      }
      default:
        return;
    }
  }, [columnCount, editingCell, moveCell, rows.length, selectedCell, startEditingCell]);

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

  const getRowLabel = useCallback((rowIndex: number) => {
    if (hasHeader && rowIndex === 0) {
      return 'H';
    }
    return String(rowIndex - dataRowStart + 1);
  }, [dataRowStart, hasHeader]);

  return (
    <div
      ref={wrapperRef}
      className="table-editor-wrapper"
      tabIndex={0}
      onKeyDown={handleWrapperKeyDown}
      role="group"
      aria-label="Markdown table editor"
    >
      <table className="table-editor">
        <thead>
          <tr className="col-toolbar">
            <th className="row-toolbar">#</th>
            {Array.from({ length: columnCount }, (_, colIndex) => (
              <th
                key={`toolbar-${colIndex}`}
                className={selectedCell?.col === colIndex ? 'selected' : ''}
              >
                <div className="col-toolbar-label">列 {colIndex + 1}</div>
                <div className="col-actions">
                  <button
                    type="button"
                    className="btn-icon"
                    title="切换对齐"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => cycleAlignment(colIndex)}
                  >
                    {alignments[colIndex] === 'left' ? '左' : alignments[colIndex] === 'center' ? '中' : alignments[colIndex] === 'right' ? '右' : '无'}
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    title="在右侧插入列"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleTableMutation(
                      (workingRows, workingAlignments) =>
                        insertTableColumn(workingRows, workingAlignments, hasHeader, colIndex),
                      { row: selectedCell?.row ?? 0, col: Math.min(colIndex + 1, columnCount) }
                    )}
                  >
                    ＋
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    title="删除当前列"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleTableMutation(
                      (workingRows, workingAlignments) =>
                        deleteTableColumn(workingRows, workingAlignments, hasHeader, colIndex),
                      selectedCell ? { row: selectedCell.row, col: Math.max(0, Math.min(colIndex - 1, columnCount - 2)) } : { row: 0, col: 0 }
                    )}
                  >
                    －
                  </button>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <td className="row-toolbar">
                <div className="row-toolbar-label">{getRowLabel(rowIndex)}</div>
                {rowIndex >= dataRowStart ? (
                  <div className="row-actions">
                    <button
                      type="button"
                      className="btn-icon"
                      title="在上方插入行"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleTableMutation(
                        (workingRows, workingAlignments) =>
                          insertTableDataRow(workingRows, workingAlignments, hasHeader, rowIndex, 'above'),
                        { row: rowIndex, col: selectedCell?.col ?? 0 }
                      )}
                    >
                      ↑＋
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      title="在下方插入行"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleTableMutation(
                        (workingRows, workingAlignments) =>
                          insertTableDataRow(workingRows, workingAlignments, hasHeader, rowIndex, 'below'),
                        { row: Math.min(rows.length, rowIndex + 1), col: selectedCell?.col ?? 0 }
                      )}
                    >
                      ↓＋
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      title="删除当前行"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleTableMutation(
                        (workingRows, workingAlignments) =>
                          deleteTableDataRow(workingRows, workingAlignments, hasHeader, rowIndex),
                        { row: Math.max(dataRowStart, rowIndex - 1), col: selectedCell?.col ?? 0 }
                      )}
                    >
                      －
                    </button>
                  </div>
                ) : null}
              </td>
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
                    className={[isEditing ? 'editing' : '', isSelected ? 'selected' : ''].filter(Boolean).join(' ')}
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
  );
};
