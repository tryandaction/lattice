"use client";

import { useEffect, useMemo, useRef, useState, memo, useCallback } from "react";
import { CodeEditor, type CodeEditorRef } from "@/components/editor/codemirror/code-editor";
import type { JupyterOutput } from "@/lib/notebook-utils";
import { jupyterOutputsToExecutionOutputs } from "@/lib/runner/output-utils";
import { OutputArea } from "./output-area";
import { KernelStatus } from "./kernel-status";
import { NotebookAiAssist } from "@/components/ai/notebook-ai-assist";
import type { ExecutionProblem, ExecutionPanelMeta } from "@/lib/runner/types";
import { ProblemsPanel } from "@/components/runner/problems-panel";
import { diagnosticsToExecutionProblems, mergeExecutionProblems, outputsToExecutionProblems } from "@/lib/runner/problem-utils";
import { useI18n } from "@/hooks/use-i18n";

interface CodeCellProps {
  source: string;
  outputs?: JupyterOutput[];
  executionCount?: number | null;
  executionMeta?: ExecutionPanelMeta;
  isActive: boolean;
  onChange: (source: string) => void;
  onFocus: () => void;
  onNavigateUp?: () => void;
  onNavigateDown?: () => void;
  cellId: string;
  notebookFilePath?: string;
  onRunCell?: (cellId: string, source: string) => Promise<unknown>;
  isExecuting?: boolean;
  canRun?: boolean;
}

function PlayIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export const CodeCell = memo(function CodeCell({
  source,
  outputs,
  executionCount,
  executionMeta,
  isActive,
  onChange,
  onFocus,
  onNavigateUp,
  onNavigateDown,
  cellId,
  notebookFilePath,
  onRunCell,
  isExecuting = false,
  canRun = true,
}: CodeCellProps) {
  const { t } = useI18n();
  const [content, setContent] = useState(source);
  const [syntaxProblems, setSyntaxProblems] = useState<ExecutionProblem[]>([]);
  const editorRef = useRef<CodeEditorRef | null>(null);

  useEffect(() => {
    setContent(source);
  }, [source]);

  const executionContext = useMemo(
    () => ({
      kind: "notebook-cell" as const,
      filePath: notebookFilePath,
      cellId,
      label: `Cell [${executionCount ?? " "}]`,
      language: "python",
    }),
    [cellId, executionCount, notebookFilePath],
  );

  const executionOutputs = useMemo(
    () => jupyterOutputsToExecutionOutputs(outputs),
    [outputs],
  );

  const problems = useMemo(
    () =>
      mergeExecutionProblems(
        syntaxProblems,
        diagnosticsToExecutionProblems(executionMeta?.diagnostics ?? [], "preflight", executionMeta?.context ?? executionContext),
        outputsToExecutionProblems(executionOutputs, executionMeta?.context ?? executionContext),
      ),
    [executionContext, executionMeta?.context, executionMeta?.diagnostics, executionOutputs, syntaxProblems],
  );

  const handleChange = useCallback((newContent: string) => {
    setContent(newContent);
    onChange(newContent);
  }, [onChange]);

  const handleRun = useCallback(async () => {
    const code = content.trim();
    if (!code || !onRunCell) {
      return;
    }
    await onRunCell(cellId, code);
  }, [cellId, content, onRunCell]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.shiftKey && event.key === "Enter") {
      event.preventDefault();
      if (canRun) {
        void handleRun();
      }
    }
  }, [canRun, handleRun]);

  const navigateToProblem = useCallback((problem: ExecutionProblem) => {
    onFocus();
    const line = problem.context?.line;
    if (!line) {
      return;
    }

    editorRef.current?.scrollToLine(line);
    window.setTimeout(() => {
      editorRef.current?.flashLine(line);
    }, 120);
  }, [onFocus]);

  return (
    <div className="space-y-2" onKeyDown={handleKeyDown}>
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground font-mono">
          [{executionCount ?? " "}]:
        </div>

        <button
          onClick={() => void handleRun()}
          disabled={isExecuting || !canRun || !onRunCell || !content.trim()}
          className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md
                     bg-primary/10 hover:bg-primary/20 text-primary
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors"
          title={canRun ? t("notebook.cell.runShortcut") : t("notebook.cell.runtimeNotReady")}
        >
          <PlayIcon className="w-3 h-3" />
          <span>{isExecuting ? t("notebook.cell.running") : t("workbench.commandBar.run")}</span>
        </button>
      </div>

      <div
        className={`rounded-lg overflow-hidden border-2 transition-colors ${isActive ? "border-primary" : "border-border"}`}
        onClick={onFocus}
      >
        <CodeEditor
          initialValue={content}
          language="python"
          onChange={handleChange}
          isReadOnly={!isActive}
          autoHeight={true}
          onNavigateUp={onNavigateUp}
          onNavigateDown={onNavigateDown}
          fileId={`${notebookFilePath ?? "notebook"}#${cellId}`}
          editorRef={editorRef}
          basicCompletion={true}
          syntaxDiagnostics={true}
          problemContext={executionContext}
          onProblemsChange={setSyntaxProblems}
        />
      </div>

      <KernelStatus status={isExecuting ? "running" : "idle"} />

      {problems.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("workbench.dock.problems")}</div>
          <ProblemsPanel problems={problems} variant="compact" onSelectProblem={navigateToProblem} />
        </div>
      ) : null}

      {executionOutputs.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("workbench.dock.run")}</div>
          <OutputArea outputs={executionOutputs} meta={executionMeta} variant="compact" showDiagnosticsInline={false} />
        </div>
      ) : null}

      <NotebookAiAssist
        cellSource={content}
        cellOutput={executionOutputs.map((output) => output.content).join("\n")}
        cellError={
          executionOutputs.find((output) => output.type === "error")?.errorValue
            ?? outputs?.find((output) => output.output_type === "error")?.evalue
            ?? undefined
        }
        onInsertCode={(code) => {
          setContent(code);
          onChange(code);
        }}
      />
    </div>
  );
});
