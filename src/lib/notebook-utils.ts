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
  cell_type: "markdown" | "code";
  source: string;
  metadata: Record<string, unknown>;
  outputs?: JupyterOutput[];
  execution_count?: number | null;
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

/**
 * Parse a Jupyter Notebook JSON string into editor state
 */
export function parseNotebook(jsonString: string): NotebookEditorState {
  try {
    const notebook = JSON.parse(jsonString) as JupyterNotebook;
    
    const cells: NotebookCell[] = notebook.cells.map((cell) => ({
      id: generateCellId(),
      cell_type: cell.cell_type === "raw" ? "code" : cell.cell_type,
      source: normalizeSource(cell.source),
      metadata: cell.metadata || {},
      outputs: cell.outputs,
      execution_count: cell.execution_count,
    }));

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
      metadata: notebook.metadata || {},
      nbformat: notebook.nbformat || 4,
      nbformat_minor: notebook.nbformat_minor || 5,
    };
  } catch {
    // Return empty notebook on parse error
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
}

/**
 * Serialize notebook editor state back to JSON string
 */
export function serializeNotebook(state: NotebookEditorState): string {
  const notebook: JupyterNotebook = {
    cells: state.cells.map((cell) => ({
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
  cellType: "markdown" | "code"
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
  cellType: "markdown" | "code"
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
  return {
    ...state,
    activeCellId: cellId,
  };
}

/**
 * Change a cell's type
 */
export function changeCellType(
  state: NotebookEditorState,
  cellId: string,
  newType: "markdown" | "code"
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
