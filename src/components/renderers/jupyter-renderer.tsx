"use client";

import { useMemo, useRef, useState } from "react";
import { MarkdownRenderer } from "./markdown-renderer";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { PaneId } from "@/types/layout";
import { useSelectionContextMenu } from "@/hooks/use-selection-context-menu";
import { createSelectionContext, type SelectionAiMode, type SelectionContext } from "@/lib/ai/selection-context";
import { SelectionContextMenu } from "@/components/ai/selection-context-menu";
import { SelectionAiHub } from "@/components/ai/selection-ai-hub";
import { OutputArea } from "@/components/notebook/output-area";
import { jupyterOutputsToExecutionOutputs } from "@/lib/runner/output-utils";

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
}

interface JupyterNotebook {
  cells: JupyterCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

/**
 * Normalize source to string (can be string or string[])
 */
function normalizeSource(source: string | string[]): string {
  return Array.isArray(source) ? source.join("") : source;
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
}: {
  cell: JupyterCell;
  index: number;
  paneId?: PaneId;
  filePath?: string;
  rootHandle?: FileSystemDirectoryHandle | null;
}) {
  const source = normalizeSource(cell.source);

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
              language="python"
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectionHubState, setSelectionHubState] = useState<{
    context: SelectionContext;
    mode: SelectionAiMode;
    returnFocusTo?: HTMLElement | null;
  } | null>(null);
  const notebook = useMemo(() => {
    try {
      return JSON.parse(content) as JupyterNotebook;
    } catch {
      return null;
    }
  }, [content]);

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

  if (!notebook) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <p className="text-destructive">Error: Invalid Jupyter notebook format</p>
        <p className="mt-2 text-sm text-muted-foreground">
          The file could not be parsed as a valid .ipynb file.
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="mx-auto max-w-4xl p-8">
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
      {/* File header */}
      <div className="mb-6 border-b border-border pb-4">
        <h1 className="font-serif text-2xl font-bold text-foreground">{fileName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {notebook.cells.length} cells • nbformat {notebook.nbformat}.{notebook.nbformat_minor}
        </p>
      </div>

      {/* Cells */}
      <div className="space-y-6">
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
            />
          </div>
        ))}
      </div>
    </div>
  );
}
