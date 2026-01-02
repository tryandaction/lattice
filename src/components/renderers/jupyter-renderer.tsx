"use client";

import { useMemo } from "react";
import { MarkdownRenderer } from "./markdown-renderer";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface JupyterRendererProps {
  content: string;
  fileName: string;
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
 * Normalize text output to string
 */
function normalizeText(text: string | string[] | undefined): string {
  if (!text) return "";
  return Array.isArray(text) ? text.join("") : text;
}

/**
 * Render a single cell output
 */
function CellOutput({ output }: { output: JupyterOutput }) {
  if (output.output_type === "stream") {
    return (
      <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-sm font-mono">
        {normalizeText(output.text)}
      </pre>
    );
  }

  if (output.output_type === "execute_result" || output.output_type === "display_data") {
    const data = output.data;
    if (!data) return null;

    // Image output
    if (data["image/png"]) {
      return (
        <img
          src={`data:image/png;base64,${data["image/png"]}`}
          alt="Output"
          className="max-w-full"
        />
      );
    }
    if (data["image/jpeg"]) {
      return (
        <img
          src={`data:image/jpeg;base64,${data["image/jpeg"]}`}
          alt="Output"
          className="max-w-full"
        />
      );
    }

    // Text output
    if (data["text/plain"]) {
      return (
        <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-sm font-mono">
          {normalizeText(data["text/plain"])}
        </pre>
      );
    }
  }

  if (output.output_type === "error") {
    return (
      <pre className="whitespace-pre-wrap rounded bg-destructive/10 p-3 text-sm font-mono text-destructive">
        {output.ename}: {output.evalue}
        {output.traceback && "\n" + output.traceback.join("\n")}
      </pre>
    );
  }

  return null;
}

/**
 * Render a single notebook cell
 */
function NotebookCell({ cell, index }: { cell: JupyterCell; index: number }) {
  const source = normalizeSource(cell.source);

  if (cell.cell_type === "markdown") {
    return (
      <div className="border-l-2 border-primary/20 pl-4">
        <MarkdownRenderer content={source} fileName={`cell-${index}.md`} />
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
          <div className="ml-[3.5rem] space-y-2">
            {cell.outputs.map((output, outputIndex) => (
              <CellOutput key={outputIndex} output={output} />
            ))}
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
export function JupyterRenderer({ content, fileName }: JupyterRendererProps) {
  const notebook = useMemo(() => {
    try {
      return JSON.parse(content) as JupyterNotebook;
    } catch {
      return null;
    }
  }, [content]);

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
    <div className="mx-auto max-w-4xl p-8">
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
          <NotebookCell key={index} cell={cell} index={index} />
        ))}
      </div>
    </div>
  );
}
