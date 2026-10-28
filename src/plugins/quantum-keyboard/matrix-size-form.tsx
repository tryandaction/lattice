import { useEffect, useRef, useState } from "react";
import { MATRIX_SIZE_LIMITS, parseMatrixSize, type MatrixSize } from "./matrix-size";

interface MatrixSizeFormProps {
  initialSize: MatrixSize;
  zh: boolean;
  onConfirm: (size: MatrixSize) => void;
  onCancel: () => void;
}

export function MatrixSizeForm({ initialSize, zh, onConfirm, onCancel }: MatrixSizeFormProps) {
  const [rows, setRows] = useState(String(initialSize.rows));
  const [columns, setColumns] = useState(String(initialSize.columns));
  const rowRef = useRef<HTMLInputElement>(null);
  const size = parseMatrixSize(rows, columns);
  useEffect(() => { rowRef.current?.focus(); rowRef.current?.select(); }, []);

  return <form data-quantum-matrix-size className="qk-matrix-size" aria-label={zh ? "矩阵尺寸" : "Matrix dimensions"}
    onSubmit={event => { event.preventDefault(); if (size) onConfirm(size); }}
    onKeyDown={event => {
      if (event.key === "Escape" && !event.nativeEvent.isComposing) {
        event.preventDefault(); event.stopPropagation(); onCancel();
      }
    }}>
    <strong>{zh ? "矩阵" : "Matrix"}</strong>
    <label>{zh ? "行" : "Rows"}<input ref={rowRef} type="number" inputMode="numeric" required
      aria-label={zh ? "矩阵行数" : "Matrix rows"} min={MATRIX_SIZE_LIMITS.min} max={MATRIX_SIZE_LIMITS.max} step={1}
      value={rows} onChange={event => setRows(event.target.value)} onFocus={event => event.currentTarget.select()} /></label>
    <span aria-hidden="true">×</span>
    <label>{zh ? "列" : "Columns"}<input type="number" inputMode="numeric" required
      aria-label={zh ? "矩阵列数" : "Matrix columns"} min={MATRIX_SIZE_LIMITS.min} max={MATRIX_SIZE_LIMITS.max} step={1}
      value={columns} onChange={event => setColumns(event.target.value)} onFocus={event => event.currentTarget.select()} /></label>
    <button className="qk-matrix-confirm btn-sm" type="submit" disabled={!size}>{zh ? "生成矩阵" : "Insert matrix"}<kbd>Enter</kbd></button>
    <button className="qk-matrix-cancel btn-sm" type="button" onClick={onCancel}>{zh ? "取消" : "Cancel"}<kbd>Esc</kbd></button>
    <span className="qk-matrix-hint">{size
      ? (zh ? `${size.rows} 行 × ${size.columns} 列 · Tab 切换` : `${size.rows} rows × ${size.columns} columns · Tab to switch`)
      : (zh ? "行、列请输入 1–20 的整数" : "Enter 1–20 for rows and columns")}</span>
  </form>;
}
