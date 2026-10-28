const MATRIX_ENV_RE = /^(?:[pbBvV]?matrix|smallmatrix)$/;
const MIN_MATRIX_SIZE = 1;
const MAX_MATRIX_SIZE = 20;

export interface MatrixSize {
  rows: number;
  columns: number;
}

export interface MatrixTemplate extends MatrixSize {
  environment: string;
}

export function parseMatrixSize(rowsValue: string, columnsValue: string): MatrixSize | null {
  if (!/^\d+$/.test(rowsValue.trim()) || !/^\d+$/.test(columnsValue.trim())) return null;
  const rows = Number(rowsValue);
  const columns = Number(columnsValue);
  if (!Number.isInteger(rows) || !Number.isInteger(columns)) return null;
  if (rows < MIN_MATRIX_SIZE || columns < MIN_MATRIX_SIZE) return null;
  if (rows > MAX_MATRIX_SIZE || columns > MAX_MATRIX_SIZE) return null;
  return { rows, columns };
}

/** Only blank, standalone templates need dimensions; saved formulas retain their content. */
export function parseMatrixTemplate(latex: string): MatrixTemplate | null {
  const match = /^\\begin\{([pbBvV]?matrix|smallmatrix)\}([\s\S]*)\\end\{\1\}$/.exec(latex.trim());
  if (!match) return null;
  const cells = match[2].split("\\\\").map(row => row.split("&"));
  const columns = cells[0].length;
  if (!cells.every(row => row.length === columns && row.every(cell => /^\{\s*\}$/.test(cell.trim())))) return null;
  const size = parseMatrixSize(String(cells.length), String(columns));
  return size ? { environment: match[1], ...size } : null;
}

export function buildMatrixLatex(environment: string, rows: number, columns: number): string {
  if (!MATRIX_ENV_RE.test(environment)) throw new RangeError("Unsupported matrix environment.");
  const size = parseMatrixSize(String(rows), String(columns));
  if (!size) throw new RangeError("Matrix dimensions must be integers between 1 and 20.");
  const row = Array.from({ length: size.columns }, () => "{}").join("&");
  return `\\begin{${environment}}${Array.from({ length: size.rows }, () => row).join("\\\\")}\\end{${environment}}`;
}

export const MATRIX_SIZE_LIMITS = { min: MIN_MATRIX_SIZE, max: MAX_MATRIX_SIZE } as const;
