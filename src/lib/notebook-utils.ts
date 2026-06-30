import type { ExecutionPanelMeta } from "@/lib/runner/types";
import type { CodeEditorLanguage } from "@/components/editor/codemirror/code-editor";

/**
 * Jupyter Notebook Utilities
 * 
 * Provides parsing, serialization, and manipulation functions
 * for Jupyter Notebook (.ipynb) files.
 */

/**
 * Jupyter Notebook output types
 */
export interface JupyterOutput {
  output_type: "stream" | "execute_result" | "display_data" | "error";
  text?: string | string[];
  name?: string;
  data?: {
    "text/plain"?: string | string[];
    "text/html"?: string | string[];
    "image/png"?: string;
    "image/jpeg"?: string;
    "image/svg+xml"?: string | string[];
  };
  ename?: string;
  evalue?: string;
  traceback?: string[];
  execution_count?: number | null;
}

/**
 * Jupyter Notebook cell (raw format from JSON)
 */
export interface JupyterCell {
  id?: string;
  cell_type: "markdown" | "code" | "raw";
  source: string | string[];
  metadata: Record<string, unknown>;
  outputs?: JupyterOutput[];
  execution_count?: number | null;
}

/**
 * Jupyter Notebook metadata
 */
export interface JupyterMetadata {
  kernelspec?: {
    display_name: string;
    language: string;
    name: string;
  };
  language_info?: {
    name: string;
    version?: string;
    codemirror_mode?: unknown;
  };
  [key: string]: unknown;
}

/**
 * Jupyter Notebook (raw format from JSON)
 */
export interface JupyterNotebook {
  cells: JupyterCell[];
  metadata: JupyterMetadata;
  nbformat: number;
  nbformat_minor: number;
}

/**
 * Editor cell state (internal representation)
 */
export interface NotebookCell {
  id: string;
  cell_type: "markdown" | "code" | "raw";
  source: string;
  metadata: Record<string, unknown>;
  outputs?: JupyterOutput[];
  execution_count?: number | null;
  execution_meta?: ExecutionPanelMeta;
}

/**
 * Editor notebook state
 */
export interface NotebookEditorState {
  cells: NotebookCell[];
  activeCellId: string | null;
  metadata: JupyterMetadata;
  nbformat: number;
  nbformat_minor: number;
}

// Counter for generating unique cell IDs
let cellIdCounter = 0;

/**
 * Generate a unique cell ID
 */
export function generateCellId(): string {
  cellIdCounter++;
  return `cell-${Date.now()}-${cellIdCounter}`;
}

/**
 * Normalize source to string (can be string or string[])
 */
export function normalizeSource(source: string | string[]): string {
  return Array.isArray(source) ? source.join("") : source;
}

/**
 * Convert source string to array format for serialization
 */
export function sourceToArray(source: string): string[] {
  if (!source) return [];
  const lines = source.split("\n");
  return lines.map((line, i) => (i < lines.length - 1 ? line + "\n" : line));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatUnknownNotebookValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function createRawNotebookCell(source: string, metadata: Record<string, unknown> = {}): NotebookCell {
  return {
    id: generateCellId(),
    cell_type: "raw",
    source,
    metadata,
  };
}

function normalizeEditableNotebookSource(source: unknown): { source: string; valid: boolean } {
  if (typeof source === "string") {
    return { source, valid: true };
  }
  if (Array.isArray(source) && source.every((item) => typeof item === "string")) {
    return { source: normalizeSource(source), valid: true };
  }
  return { source: formatUnknownNotebookValue(source), valid: false };
}

function isNotebookCellType(value: unknown): value is NotebookCell["cell_type"] {
  return value === "markdown" || value === "code" || value === "raw";
}

/**
 * Parse a Jupyter Notebook JSON string into editor state
 */
export function parseNotebook(jsonString: string): NotebookEditorState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    const fallbackCell = createRawNotebookCell(jsonString, {
      latticeInvalidNotebookReason: "invalid-json",
    });

    return {
      cells: [fallbackCell],
      activeCellId: fallbackCell.id,
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    };
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.cells)) {
    const fallbackCell = createRawNotebookCell(formatUnknownNotebookValue(parsed), {
      latticeInvalidNotebookReason: "invalid-notebook",
    });
    return {
      cells: [fallbackCell],
      activeCellId: fallbackCell.id,
      metadata: isRecord(parsed) && isRecord(parsed.metadata) ? parsed.metadata as JupyterMetadata : {},
      nbformat: isRecord(parsed) && typeof parsed.nbformat === "number" ? parsed.nbformat : 4,
      nbformat_minor: isRecord(parsed) && typeof parsed.nbformat_minor === "number" ? parsed.nbformat_minor : 5,
    };
  }

  const notebook = parsed as Record<string, unknown>;
  const cells: NotebookCell[] = parsed.cells.map((rawCell) => {
    if (!isRecord(rawCell)) {
      return createRawNotebookCell("Invalid notebook cell", {
        latticeInvalidNotebookReason: "invalid-cell",
      });
    }

    const rawType = rawCell.cell_type;
    const normalizedSource = normalizeEditableNotebookSource(rawCell.source);
    const cellType = isNotebookCellType(rawType) && normalizedSource.valid ? rawType : "raw";
    const metadata = isRecord(rawCell.metadata) ? rawCell.metadata : {};

    return {
      id: typeof rawCell.id === "string" ? rawCell.id : generateCellId(),
      cell_type: cellType,
      source: normalizedSource.source,
      metadata,
      ...(cellType === "code" && {
        outputs: Array.isArray(rawCell.outputs) ? rawCell.outputs as JupyterOutput[] : [],
        execution_count: typeof rawCell.execution_count === "number" || rawCell.execution_count === null
          ? rawCell.execution_count
          : null,
      }),
    };
  });

  // Ensure at least one cell exists
  if (cells.length === 0) {
    cells.push({
      id: generateCellId(),
      cell_type: "code",
      source: "",
      metadata: {},
      outputs: [],
      execution_count: null,
    });
  }

  return {
    cells,
    activeCellId: cells[0]?.id || null,
    metadata: isRecord(notebook.metadata) ? notebook.metadata as JupyterMetadata : {},
    nbformat: typeof notebook.nbformat === "number" ? notebook.nbformat : 4,
    nbformat_minor: typeof notebook.nbformat_minor === "number" ? notebook.nbformat_minor : 5,
  };
}

/**
 * Serialize notebook editor state back to JSON string
 */
export function serializeNotebook(state: NotebookEditorState): string {
  const notebook: JupyterNotebook = {
    cells: state.cells.map((cell) => ({
      id: cell.id,
      cell_type: cell.cell_type,
      source: sourceToArray(cell.source),
      metadata: cell.metadata,
      ...(cell.cell_type === "code" && {
        outputs: cell.outputs || [],
        execution_count: cell.execution_count ?? null,
      }),
    })),
    metadata: state.metadata,
    nbformat: state.nbformat,
    nbformat_minor: state.nbformat_minor,
  };

  return JSON.stringify(notebook, null, 2);
}

/**
 * Create an empty notebook state
 */
export function createEmptyNotebookState(): NotebookEditorState {
  const defaultCell: NotebookCell = {
    id: generateCellId(),
    cell_type: "code",
    source: "",
    metadata: {},
    outputs: [],
    execution_count: null,
  };

  return {
    cells: [defaultCell],
    activeCellId: defaultCell.id,
    metadata: {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3",
      },
      language_info: {
        name: "python",
        version: "3.9.0",
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

/**
 * Add a new cell after the specified cell
 */
export function addCellAfter(
  state: NotebookEditorState,
  afterCellId: string,
  cellType: "markdown" | "code" | "raw"
): NotebookEditorState {
  const index = state.cells.findIndex((c) => c.id === afterCellId);
  if (index === -1) return state;

  const newCell: NotebookCell = {
    id: generateCellId(),
    cell_type: cellType,
    source: "",
    metadata: {},
    ...(cellType === "code" && {
      outputs: [],
      execution_count: null,
    }),
  };

  const newCells = [...state.cells];
  newCells.splice(index + 1, 0, newCell);

  return {
    ...state,
    cells: newCells,
    activeCellId: newCell.id,
  };
}

/**
 * Add a new cell before the specified cell
 */
export function addCellBefore(
  state: NotebookEditorState,
  beforeCellId: string,
  cellType: "markdown" | "code" | "raw"
): NotebookEditorState {
  const index = state.cells.findIndex((c) => c.id === beforeCellId);
  if (index === -1) return state;

  const newCell: NotebookCell = {
    id: generateCellId(),
    cell_type: cellType,
    source: "",
    metadata: {},
    ...(cellType === "code" && {
      outputs: [],
      execution_count: null,
    }),
  };

  const newCells = [...state.cells];
  newCells.splice(index, 0, newCell);

  return {
    ...state,
    cells: newCells,
    activeCellId: newCell.id,
  };
}

/**
 * Delete a cell from the notebook
 */
export function deleteCell(
  state: NotebookEditorState,
  cellId: string
): NotebookEditorState {
  // Don't delete if only one cell remains
  if (state.cells.length <= 1) return state;

  const index = state.cells.findIndex((c) => c.id === cellId);
  if (index === -1) return state;

  const newCells = state.cells.filter((c) => c.id !== cellId);
  
  // Update active cell to adjacent cell
  let newActiveCellId = state.activeCellId;
  if (cellId === state.activeCellId) {
    const newIndex = Math.min(index, newCells.length - 1);
    newActiveCellId = newCells[newIndex]?.id || null;
  }

  return {
    ...state,
    cells: newCells,
    activeCellId: newActiveCellId,
  };
}

/**
 * Update a cell's source
 */
export function updateCellSource(
  state: NotebookEditorState,
  cellId: string,
  source: string
): NotebookEditorState {
  return {
    ...state,
    cells: state.cells.map((cell) =>
      cell.id === cellId ? { ...cell, source } : cell
    ),
  };
}

/**
 * Set the active cell
 */
export function setActiveCell(
  state: NotebookEditorState,
  cellId: string
): NotebookEditorState {
  if (state.activeCellId === cellId) {
    return state;
  }
  return {
    ...state,
    activeCellId: cellId,
  };
}

export function resolveNotebookLanguage(metadata: JupyterMetadata | null | undefined): string {
  return metadata?.language_info?.name?.trim()
    || metadata?.kernelspec?.language?.trim()
    || "python";
}

export function resolveNotebookKernelLabel(metadata: JupyterMetadata | null | undefined): string | null {
  return metadata?.kernelspec?.display_name?.trim()
    || metadata?.kernelspec?.name?.trim()
    || null;
}

export function resolveNotebookCodeEditorLanguage(
  language: string,
  codemirrorMode?: unknown,
): CodeEditorLanguage {
  const mode = typeof codemirrorMode === "string" ? codemirrorMode.trim().toLowerCase() : "";
  const normalized = (mode || language).trim().toLowerCase();
  if (normalized === "python" || normalized === "py" || normalized === "ipython") return "python";
  if (normalized === "javascript" || normalized === "js" || normalized === "node" || normalized === "node.js") return "javascript";
  if (normalized === "typescript" || normalized === "ts") return "typescript";
  if (normalized === "c") return "c";
  if (normalized === "cpp" || normalized === "c++" || normalized === "cc" || normalized === "cxx") return "cpp";
  if (normalized === "json") return "json";
  if (normalized === "html" || normalized === "xml") return "html";
  if (normalized === "markdown" || normalized === "md") return "markdown";
  return "plaintext";
}

/**
 * Change a cell's type
 */
export function changeCellType(
  state: NotebookEditorState,
  cellId: string,
  newType: "markdown" | "code" | "raw"
): NotebookEditorState {
  return {
    ...state,
    cells: state.cells.map((cell) =>
      cell.id === cellId
        ? {
            ...cell,
            cell_type: newType,
            ...(newType === "code" && {
              outputs: [],
              execution_count: null,
            }),
          }
        : cell
    ),
  };
}
