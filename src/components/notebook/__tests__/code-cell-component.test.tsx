/**
 * @vitest-environment jsdom
 */

import React from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodeCell } from "../code-cell";

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
    expect(container.firstElementChild?.className).toContain("space-y-1.5");
    expect(container.firstElementChild?.className).not.toContain("space-y-2");
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
});
