"use client";

import { useEffect, useMemo, useRef, useState, memo, useCallback } from "react";
import { Loader2, Play } from "lucide-react";
import type { Extension } from "@codemirror/state";
import { CodeEditor, type CodeEditorLanguage, type CodeEditorRef } from "@/components/editor/codemirror/code-editor";
import type { JupyterOutput } from "@/lib/notebook-utils";
import { jupyterOutputsToExecutionOutputs } from "@/lib/runner/output-utils";
import { OutputArea } from "./output-area";
import { NotebookAiAssist } from "@/components/ai/notebook-ai-assist";
import type { ExecutionProblem, ExecutionPanelMeta } from "@/lib/runner/types";
import { ProblemsPanel } from "@/components/runner/problems-panel";
import { diagnosticsToExecutionProblems, mergeExecutionProblems, outputsToExecutionProblems } from "@/lib/runner/problem-utils";
import { useI18n } from "@/hooks/use-i18n";
import {
  buildVSCodeLanguageEditorExtensions,
  type VSCodeLanguageDiagnostic,
} from "@/lib/vscode-compat/language-bridge";
import { useVSCodeExtensionHostStore } from "@/stores/vscode-extension-host-store";

interface CodeCellProps {
  source: string;
  outputs?: JupyterOutput[];
  executionCount?: number | null;
  executionMeta?: ExecutionPanelMeta;
  language?: CodeEditorLanguage;
  isActive: boolean;
  onChange: (source: string) => void;
  onFocus: () => void;
  onNavigateUp?: () => void;
  onNavigateDown?: () => void;
  cellId: string;
  notebookFilePath?: string;
  vscodeDocumentPath?: string;
  onRunCell?: (cellId: string, source: string) => Promise<unknown>;
  isExecuting?: boolean;
  canRun?: boolean;
  onEditorCommandsChange?: (
    cellId: string,
    commands: { openSearch: () => void; openGotoLine: () => void } | null,
  ) => void;
}

export const CodeCell = memo(function CodeCell({
  source,
  outputs,
  executionCount,
  executionMeta,
  language = "python",
  isActive,
  onChange,
  onFocus,
  onNavigateUp,
  onNavigateDown,
  cellId,
  notebookFilePath,
  vscodeDocumentPath,
  onRunCell,
  isExecuting = false,
  canRun = true,
  onEditorCommandsChange,
}: CodeCellProps) {
  const { t } = useI18n();
  const [content, setContent] = useState(source);
  const [syntaxProblems, setSyntaxProblems] = useState<ExecutionProblem[]>([]);
  const [extensionProblems, setExtensionProblems] = useState<ExecutionProblem[]>([]);
  const editorRef = useRef<CodeEditorRef | null>(null);
  const contentRef = useRef(source);
  const vscodeDocumentVersionRef = useRef(1);
  const vscodeDocumentSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vscodeHostStatus = useVSCodeExtensionHostStore((state) => state.snapshot.status);
  const openVSCodeDocument = useVSCodeExtensionHostStore((state) => state.openDocument);
  const changeVSCodeDocument = useVSCodeExtensionHostStore((state) => state.changeDocument);
  const requestVSCodeLanguageFeature = useVSCodeExtensionHostStore((state) => state.requestLanguageFeature);

  useEffect(() => {
    setContent(source);
    contentRef.current = source;
  }, [source]);

  const executionContext = useMemo(
    () => ({
      kind: "notebook-cell" as const,
      filePath: notebookFilePath,
      cellId,
      label: `Cell [${executionCount ?? " "}]`,
      language,
    }),
    [cellId, executionCount, language, notebookFilePath],
  );

  const executionOutputs = useMemo(
    () => jupyterOutputsToExecutionOutputs(outputs),
    [outputs],
  );

  const problems = useMemo(
    () =>
      mergeExecutionProblems(
        syntaxProblems,
        extensionProblems,
        diagnosticsToExecutionProblems(executionMeta?.diagnostics ?? [], "preflight", executionMeta?.context ?? executionContext),
        outputsToExecutionProblems(executionOutputs, executionMeta?.context ?? executionContext),
      ),
    [executionContext, executionMeta?.context, executionMeta?.diagnostics, executionOutputs, extensionProblems, syntaxProblems],
  );

  const handleExtensionDiagnostics = useCallback((diagnostics: VSCodeLanguageDiagnostic[]) => {
    setExtensionProblems(diagnostics.map((diagnostic, index) => ({
      id: `vscode-extension:${cellId}:${diagnostic.from}:${index}`,
      severity: diagnostic.severity === "warning" ? "warning" : diagnostic.severity === "error" ? "error" : "info",
      source: "syntax",
      title: diagnostic.source || "VS Code extension",
      message: diagnostic.message,
      context: {
        ...executionContext,
        line: diagnostic.line,
      },
    })));
  }, [cellId, executionContext]);

  const vscodeLanguageExtensions = useMemo<Extension[]>(() => {
    if (!isActive || vscodeHostStatus !== "ready" || !vscodeDocumentPath) {
      return [];
    }
    return buildVSCodeLanguageEditorExtensions({
      filePath: vscodeDocumentPath,
      languageId: language,
      getVersion: () => vscodeDocumentVersionRef.current,
      request: requestVSCodeLanguageFeature,
      onDiagnostics: handleExtensionDiagnostics,
    });
  }, [handleExtensionDiagnostics, isActive, language, requestVSCodeLanguageFeature, vscodeDocumentPath, vscodeHostStatus]);

  useEffect(() => {
    if (!isActive || vscodeHostStatus !== "ready" || !vscodeDocumentPath) {
      return;
    }
    vscodeDocumentVersionRef.current = 1;
    void openVSCodeDocument({
      filePath: vscodeDocumentPath,
      languageId: language,
      content: contentRef.current,
      version: 1,
    }).catch(() => undefined);
    return () => {
      if (vscodeDocumentSyncTimerRef.current) {
        clearTimeout(vscodeDocumentSyncTimerRef.current);
        vscodeDocumentSyncTimerRef.current = null;
      }
    };
  }, [isActive, language, openVSCodeDocument, vscodeDocumentPath, vscodeHostStatus]);

  const handleChange = useCallback((newContent: string) => {
    setContent(newContent);
    contentRef.current = newContent;
    onChange(newContent);
    if (!isActive || vscodeHostStatus !== "ready" || !vscodeDocumentPath) {
      return;
    }
    vscodeDocumentVersionRef.current += 1;
    const version = vscodeDocumentVersionRef.current;
    if (vscodeDocumentSyncTimerRef.current) {
      clearTimeout(vscodeDocumentSyncTimerRef.current);
    }
    vscodeDocumentSyncTimerRef.current = setTimeout(() => {
      void changeVSCodeDocument({
        filePath: vscodeDocumentPath,
        languageId: language,
        content: newContent,
        version,
      }).catch(() => undefined);
    }, 150);
  }, [changeVSCodeDocument, isActive, language, onChange, vscodeDocumentPath, vscodeHostStatus]);

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

  useEffect(() => {
    if (!isActive || !onEditorCommandsChange) {
      return;
    }

    onEditorCommandsChange(cellId, {
      openSearch: () => editorRef.current?.openSearch(),
      openGotoLine: () => editorRef.current?.openGotoLine(),
    });

    return () => {
      onEditorCommandsChange(cellId, null);
    };
  }, [cellId, isActive, onEditorCommandsChange]);

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
    <div className="space-y-1" onKeyDown={handleKeyDown}>
      <div data-testid="notebook-code-cell-grid" className="grid grid-cols-[64px_minmax(0,1fr)] items-start">
        <div className="flex min-h-8 flex-col items-end gap-1 pr-2 pt-1">
          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={isExecuting || !canRun || !onRunCell || !content.trim()}
            className="flex h-7 w-7 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            title={canRun ? t("notebook.cell.runShortcut") : t("notebook.cell.runtimeNotReady")}
            aria-label={isExecuting ? t("notebook.cell.running") : t("workbench.commandBar.run")}
          >
            {isExecuting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
          </button>
          <span className="font-mono text-[11px] text-muted-foreground">[{executionCount ?? " "}]</span>
        </div>

        <div
          className={`overflow-hidden border bg-background transition-colors ${isActive ? "border-primary shadow-[0_0_0_1px_var(--primary)]" : "border-border"}`}
          onClick={onFocus}
        >
          <CodeEditor
            initialValue={content}
            language={language}
            onChange={handleChange}
            isReadOnly={!isActive}
            autoHeight={true}
            onNavigateUp={onNavigateUp}
            onNavigateDown={onNavigateDown}
            fileId={`${notebookFilePath ?? "notebook"}#${cellId}`}
            editorRef={editorRef}
            basicCompletion={true}
            syntaxDiagnostics={true}
            extraExtensions={vscodeLanguageExtensions}
            problemContext={executionContext}
            onProblemsChange={setSyntaxProblems}
          />
        </div>
      </div>

      {problems.length > 0 ? (
        <div className="ml-16 space-y-1 border-l border-border pl-3">
          <div className="code-workbench-soft-text text-[11px] uppercase tracking-wide">{t("workbench.dock.problems")}</div>
          <ProblemsPanel problems={problems} variant="compact" onSelectProblem={navigateToProblem} />
        </div>
      ) : null}

      {executionOutputs.length > 0 ? (
        <div className="ml-16 space-y-1 border-l border-border pl-3 pt-1">
          <div className="code-workbench-soft-text text-[11px] uppercase tracking-wide">{t("workbench.dock.run")}</div>
          <OutputArea
            outputs={executionOutputs}
            meta={executionMeta}
            context={executionMeta?.context ?? executionContext}
            variant="compact"
            showDiagnosticsInline={false}
            onSelectProblem={navigateToProblem}
          />
        </div>
      ) : null}

      <div className="ml-16">
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
            contentRef.current = code;
            onChange(code);
          }}
        />
      </div>
    </div>
  );
});
