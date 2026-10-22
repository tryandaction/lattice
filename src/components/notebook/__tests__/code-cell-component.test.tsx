/**
 * @vitest-environment jsdom
 */

import React from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodeCell } from "../code-cell";
import { useVSCodeExtensionHostStore } from "@/stores/vscode-extension-host-store";

const codeEditorPropsSpy = vi.hoisted(() => vi.fn());
const editorCommands = vi.hoisted(() => ({
  openSearch: vi.fn(),
  openGotoLine: vi.fn(),
}));

vi.mock("@/components/editor/codemirror/code-editor", () => ({
  CodeEditor: ({ editorRef, ...props }: { editorRef?: React.RefObject<unknown>; language: string }) => {
    codeEditorPropsSpy(props);
    if (editorRef && "current" in editorRef) {
      editorRef.current = {
        focus: vi.fn(),
        scrollToLine: vi.fn(),
        flashLine: vi.fn(),
        getContent: vi.fn(() => ""),
        getSelection: vi.fn(() => ""),
        getSelectionDetails: vi.fn(() => null),
        hasSelection: vi.fn(() => false),
        getEditorState: vi.fn(() => null),
        restoreEditorState: vi.fn(),
        openSearch: editorCommands.openSearch,
        openGotoLine: editorCommands.openGotoLine,
      };
    }
    return <div data-testid="mock-code-editor" data-language={props.language} />;
  },
}));

vi.mock("../output-area", () => ({
  OutputArea: () => null,
}));

vi.mock("../kernel-status", () => ({
  KernelStatus: () => null,
}));

vi.mock("@/components/runner/problems-panel", () => ({
  ProblemsPanel: () => null,
}));

vi.mock("@/components/ai/notebook-ai-assist", () => ({
  NotebookAiAssist: () => null,
}));

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("CodeCell component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVSCodeExtensionHostStore.setState({
      snapshot: {
        status: "idle",
        runtime: "none",
        commandCount: 0,
        activeExtensionCount: 0,
        commands: [],
        views: [],
        extensions: [],
        lastError: null,
      },
    });
  });

  it("passes notebook language to the shared CodeEditor", () => {
    const { container } = render(
      <CodeCell
        source="const value: number = 1;"
        language="typescript"
        isActive={true}
        onChange={vi.fn()}
        onFocus={vi.fn()}
        cellId="cell-ts"
        notebookFilePath="analysis.ipynb"
      />,
    );

    expect(codeEditorPropsSpy).toHaveBeenCalledWith(expect.objectContaining({
      language: "typescript",
      syntaxDiagnostics: true,
      basicCompletion: true,
    }));
    expect(container.firstElementChild?.className).toContain("space-y-1");
    expect(container.querySelector("[data-testid='notebook-code-cell-grid']")).toBeTruthy();
  });

  it("exposes active cell search and go-to-line commands", async () => {
    const onEditorCommandsChange = vi.fn();
    render(
      <CodeCell
        source="print('hello')"
        isActive={true}
        onChange={vi.fn()}
        onFocus={vi.fn()}
        cellId="cell-1"
        notebookFilePath="analysis.ipynb"
        onEditorCommandsChange={onEditorCommandsChange}
      />,
    );

    await waitFor(() => {
      expect(onEditorCommandsChange).toHaveBeenCalledWith("cell-1", expect.any(Object));
    });

    const commands = onEditorCommandsChange.mock.calls.find((call) => call[1])?.[1] as {
      openSearch: () => void;
      openGotoLine: () => void;
    };
    commands.openSearch();
    commands.openGotoLine();

    expect(editorCommands.openSearch).toHaveBeenCalledTimes(1);
    expect(editorCommands.openGotoLine).toHaveBeenCalledTimes(1);
  });

  it("opens the active notebook cell as a virtual VS Code extension document", async () => {
    const openDocument = vi.fn(async () => undefined);
    useVSCodeExtensionHostStore.setState({
      snapshot: {
        status: "ready",
        runtime: "node",
        commandCount: 0,
        activeExtensionCount: 0,
        commands: [],
        views: [],
        extensions: [],
        lastError: null,
      },
      openDocument,
      requestLanguageFeature: vi.fn(async (request) => ({
        ok: true,
        feature: request.feature,
        documentVersion: request.version,
        providers: [],
        results: [],
      })),
    });

    render(
      <CodeCell
        source="print('hello')"
        language="python"
        isActive={true}
        onChange={vi.fn()}
        onFocus={vi.fn()}
        cellId="cell-1"
        notebookFilePath="analysis.ipynb"
        vscodeDocumentPath="C:/workspace/analysis.cell-cell-1.py"
      />,
    );

    await waitFor(() => {
      expect(openDocument).toHaveBeenCalledWith({
        filePath: "C:/workspace/analysis.cell-cell-1.py",
        languageId: "python",
        content: "print('hello')",
        version: 1,
      });
    });
    expect(codeEditorPropsSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      extraExtensions: expect.any(Array),
    }));
  });
});
