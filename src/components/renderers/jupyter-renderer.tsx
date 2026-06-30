"use client";

import { useMemo, useRef, useState } from "react";
import { MarkdownRenderer } from "./markdown-renderer";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { PaneId } from "@/types/layout";
import { useI18n } from "@/hooks/use-i18n";
import { useSelectionContextMenu } from "@/hooks/use-selection-context-menu";
import { createSelectionContext, type SelectionAiMode, type SelectionContext } from "@/lib/ai/selection-context";
import { SelectionContextMenu } from "@/components/ai/selection-context-menu";
import { SelectionAiHub } from "@/components/ai/selection-ai-hub";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { buildPersistedFileViewStateKey } from "@/lib/file-view-state";
import { usePersistedViewState } from "@/hooks/use-persisted-view-state";
import { OutputArea } from "@/components/notebook/output-area";
import { jupyterOutputsToExecutionOutputs } from "@/lib/runner/output-utils";
import {
  normalizeSource,
  resolveNotebookCodeEditorLanguage,
  resolveNotebookLanguage,
  type JupyterMetadata,
} from "@/lib/notebook-utils";

interface JupyterRendererProps {
  content: string;
  fileName: string;
  paneId?: PaneId;
  filePath?: string;
  rootHandle?: FileSystemDirectoryHandle | null;
}

interface JupyterOutput {
  output_type: "stream" | "execute_result" | "display_data" | "error";
  text?: string | string[];
  data?: {
    "text/plain"?: string | string[];
    "image/png"?: string;
    "image/jpeg"?: string;
  };
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

interface JupyterCell {
  id?: string;
  cell_type: "markdown" | "code" | "raw";
  source: string | string[];
  outputs?: JupyterOutput[];
  execution_count?: number | null;
  invalidReason?: string;
}

interface JupyterNotebook {
  cells: JupyterCell[];
  metadata: JupyterMetadata;
  nbformat: number;
  nbformat_minor: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeNotebookCellSource(source: unknown): { source: string; invalidReason?: string } {
  if (typeof source === "string") {
    return { source };
  }
  if (Array.isArray(source) && source.every((item) => typeof item === "string")) {
    return { source: normalizeSource(source) };
  }
  return {
    source: "",
    invalidReason: "viewer.jupyter.invalidCell",
  };
}

function parseJupyterNotebook(content: string): { notebook: JupyterNotebook | null; error: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { notebook: null, error: "invalid-json" };
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.cells)) {
    return { notebook: null, error: "invalid-notebook" };
  }

  return {
    notebook: {
      cells: parsed.cells.map((rawCell, index): JupyterCell => {
        if (!isRecord(rawCell)) {
          return {
            id: `invalid-cell-${index}`,
            cell_type: "raw",
            source: "",
            invalidReason: "viewer.jupyter.invalidCell",
          };
        }

        const normalizedSource = normalizeNotebookCellSource(rawCell.source);
        const cellType = rawCell.cell_type === "markdown" || rawCell.cell_type === "code" || rawCell.cell_type === "raw"
          ? rawCell.cell_type
          : "raw";
        return {
          id: typeof rawCell.id === "string" ? rawCell.id : undefined,
          cell_type: normalizedSource.invalidReason ? "raw" : cellType,
          source: normalizedSource.source,
          outputs: Array.isArray(rawCell.outputs) ? rawCell.outputs as JupyterOutput[] : undefined,
          execution_count: typeof rawCell.execution_count === "number" || rawCell.execution_count === null
            ? rawCell.execution_count
            : undefined,
          invalidReason: normalizedSource.invalidReason,
        };
      }),
      metadata: isRecord(parsed.metadata) ? parsed.metadata as JupyterMetadata : {},
      nbformat: typeof parsed.nbformat === "number" ? parsed.nbformat : 4,
      nbformat_minor: typeof parsed.nbformat_minor === "number" ? parsed.nbformat_minor : 0,
    },
    error: null,
  };
}

/**
 * Render a single notebook cell
 */
function NotebookCell({
  cell,
  index,
  paneId,
  filePath,
  rootHandle,
  language,
  invalidCellLabel,
}: {
  cell: JupyterCell;
  index: number;
  paneId?: PaneId;
  filePath?: string;
  rootHandle?: FileSystemDirectoryHandle | null;
  language: string;
  invalidCellLabel: string;
}) {
  const source = normalizeSource(cell.source);

  if (cell.invalidReason) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {invalidCellLabel}
      </div>
    );
  }

  if (cell.cell_type === "markdown") {
    return (
      <div className="border-l-2 border-primary/20 pl-4">
        <MarkdownRenderer
          content={source}
          fileName={`cell-${index}.md`}
          paneId={paneId}
          filePath={filePath}
          rootHandle={rootHandle}
        />
      </div>
    );
  }

  if (cell.cell_type === "code") {
    return (
      <div className="space-y-2">
        {/* Execution count */}
        <div className="flex items-start gap-2">
          <span className="min-w-[3rem] text-right text-xs text-muted-foreground">
            [{cell.execution_count ?? " "}]:
          </span>
          <div className="flex-1">
            <SyntaxHighlighter
              language={language}
              style={oneDark}
              customStyle={{
                margin: 0,
                borderRadius: "0.375rem",
                fontSize: "0.875rem",
              }}
            >
              {source}
            </SyntaxHighlighter>
          </div>
        </div>

        {/* Outputs */}
        {cell.outputs && cell.outputs.length > 0 && (
          <div className="ml-[3.5rem]">
            <OutputArea outputs={jupyterOutputsToExecutionOutputs(cell.outputs)} variant="compact" />
          </div>
        )}
      </div>
    );
  }

  // Raw cell
  return (
    <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-sm font-mono">
      {source}
    </pre>
  );
}

/**
 * Jupyter Notebook Renderer component
 * Renders .ipynb notebook files in read-only mode
 */
export function JupyterRenderer({ content, fileName, paneId, filePath, rootHandle = null }: JupyterRendererProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const workspaceKey = useWorkspaceStore((state) => state.workspaceIdentity?.workspaceKey ?? null);
  const persistedViewStateKey = buildPersistedFileViewStateKey({
    kind: "jupyter-readonly",
    workspaceKey,
    workspaceRootPath,
    filePath,
    fallbackName: fileName,
  });
  const [selectionHubState, setSelectionHubState] = useState<{
    context: SelectionContext;
    mode: SelectionAiMode;
    returnFocusTo?: HTMLElement | null;
  } | null>(null);
  const parsedNotebook = useMemo(() => parseJupyterNotebook(content), [content]);
  const notebook = parsedNotebook.notebook;
  const notebookLanguage = useMemo(() => {
    if (!notebook) {
      return "python";
    }
    return resolveNotebookCodeEditorLanguage(
      resolveNotebookLanguage(notebook.metadata),
      notebook.metadata.language_info?.codemirror_mode,
    );
  }, [notebook]);

  const { menuState: selectionMenuState, closeMenu: closeSelectionMenu } = useSelectionContextMenu(
    containerRef,
    ({ text, eventTarget }) => {
      if (!paneId) return null;
      const sourceElement = eventTarget instanceof HTMLElement ? eventTarget : eventTarget instanceof Node ? eventTarget.parentElement : null;
      const cellElement = sourceElement?.closest<HTMLElement>("[data-cell-index]");
      const cellIndex = Number(cellElement?.dataset.cellIndex ?? '');
      const cell = notebook && Number.isInteger(cellIndex) && cellIndex >= 0 ? notebook.cells[cellIndex] : undefined;
      const cellId = cell?.id ?? cellElement?.dataset.cellId;

      return createSelectionContext({
        sourceKind: "notebook",
        paneId,
        fileName,
        filePath: filePath ?? fileName,
        selectedText: text,
        documentText: cell ? normalizeSource(cell.source) : content,
        notebookCellId: cellId,
        notebookCellIndex: Number.isInteger(cellIndex) && cellIndex >= 0 ? cellIndex : undefined,
      });
    }
  );

  usePersistedViewState({
    storageKey: persistedViewStateKey,
    containerRef,
  });

  if (!notebook) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <p className="text-destructive">{t("viewer.jupyter.error")}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("viewer.jupyter.errorDescription")}
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} data-testid="jupyter-renderer-root" className="mx-auto max-w-4xl px-4 py-4 md:px-6">
      <SelectionContextMenu
        state={selectionMenuState}
        onClose={closeSelectionMenu}
        onOpenHub={(context, mode, returnFocusTo) => setSelectionHubState({ context, mode, returnFocusTo })}
      />
      <SelectionAiHub
        context={selectionHubState?.context ?? null}
        initialMode={selectionHubState?.mode ?? "chat"}
        returnFocusTo={selectionHubState?.returnFocusTo}
        onClose={() => setSelectionHubState(null)}
      />
      <div className="mb-4 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        {t("viewer.jupyter.meta", {
          count: notebook.cells.length,
          version: `${notebook.nbformat}.${notebook.nbformat_minor}`,
        })}
      </div>

      {/* Cells */}
      <div data-testid="jupyter-cell-list" className="space-y-3">
        {notebook.cells.map((cell, index) => (
          <div
            key={cell.id ?? index}
            data-cell-id={cell.id ?? `cell-${index}`}
            data-cell-index={String(index)}
          >
            <NotebookCell
              cell={cell}
              index={index}
              paneId={paneId}
              filePath={filePath}
              rootHandle={rootHandle}
              language={notebookLanguage}
              invalidCellLabel={t("viewer.jupyter.invalidCell")}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
