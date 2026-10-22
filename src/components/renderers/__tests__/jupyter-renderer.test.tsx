/**
 * @vitest-environment jsdom
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JupyterRenderer } from "../jupyter-renderer";
import { useSettingsStore } from "@/stores/settings-store";
import { useVSCodeCompatStore } from "@/stores/vscode-compat-store";
import { useVSCodeExtensionHostStore } from "@/stores/vscode-extension-host-store";
import { createDefaultVSCodeWorkbenchSettings } from "@/lib/vscode-compat/mapper";

const outputArea = vi.hoisted(() => vi.fn(({ outputs }: { outputs: Array<{ type: string }> }) => (
  <div data-testid="output-area" data-output-types={outputs.map((output) => output.type).join(",")} />
)));

vi.mock("../markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-cell">{content}</div>
  ),
}));

vi.mock("react-syntax-highlighter", () => ({
  Prism: ({ language, children, customStyle }: { language: string; children: React.ReactNode; customStyle?: React.CSSProperties }) => (
    <pre data-testid="code-cell" data-language={language} data-margin={String(customStyle?.margin ?? "")}>
      {children}
    </pre>
  ),
}));

vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({
  oneDark: {},
}));

vi.mock("@/components/notebook/output-area", () => ({
  OutputArea: outputArea,
}));

vi.mock("@/components/ai/selection-context-menu", () => ({
  SelectionContextMenu: () => null,
}));

vi.mock("@/components/ai/selection-ai-hub", () => ({
  SelectionAiHub: () => null,
}));

vi.mock("@/hooks/use-selection-context-menu", () => ({
  useSelectionContextMenu: () => ({ menuState: null, closeMenu: vi.fn() }),
}));

vi.mock("@/hooks/use-persisted-view-state", () => ({
  usePersistedViewState: () => undefined,
}));

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      workspaceRootPath: "C:/workspace",
      workspaceIdentity: { workspaceKey: "workspace" },
    }),
}));

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "viewer.jupyter.meta") {
        return `${params?.count} cells, nbformat ${params?.version}`;
      }
      if (key === "viewer.jupyter.error") {
        return "Invalid notebook";
      }
      if (key === "viewer.jupyter.errorDescription") {
        return "This file is not a valid Jupyter notebook.";
      }
      if (key === "viewer.jupyter.invalidCell") {
        return "This notebook cell has an invalid source and was skipped.";
      }
      return key;
    },
  }),
}));

describe("JupyterRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        vscodeCompatEnabled: false,
      },
    });
    useVSCodeCompatStore.setState({
      settings: createDefaultVSCodeWorkbenchSettings(),
      keybindings: [],
      snippets: [],
      tasks: [],
      extensions: [],
      importedAt: null,
      sourceLabel: null,
      warnings: [],
    });
    useVSCodeExtensionHostStore.setState({
      snapshot: {
        status: "stopped",
        runtime: "none",
        commandCount: 0,
        activeExtensionCount: 0,
        commands: [],
        views: [],
        extensions: [],
        lastError: null,
      },
      openDocument: vi.fn(async () => undefined),
    } as never);
  });

  it("uses notebook metadata language instead of hard-coded python", () => {
    const content = JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {
        language_info: { name: "javascript" },
      },
      cells: [
        {
          cell_type: "code",
          source: "const value = 1;",
          metadata: {},
          outputs: [],
          execution_count: 1,
        },
      ],
    });

    render(<JupyterRenderer content={content} fileName="analysis.ipynb" />);

    expect(screen.getByTestId("code-cell").getAttribute("data-language")).toBe("javascript");
  });

  it("renders invalid cell source as a cell-level warning instead of crashing the page", () => {
    const content = JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {},
      cells: [
        { cell_type: "markdown", source: "# Good", metadata: {} },
        { cell_type: "code", source: { bad: true }, metadata: {}, outputs: [] },
      ],
    });

    render(<JupyterRenderer content={content} fileName="analysis.ipynb" />);

    expect(screen.getByText("# Good")).toBeTruthy();
    expect(screen.getByText("This notebook cell has an invalid source and was skipped.")).toBeTruthy();
  });

  it("shows a clear notebook-level error for json without cells", () => {
    render(<JupyterRenderer content={JSON.stringify({ nbformat: 4, metadata: {} })} fileName="broken.ipynb" />);

    expect(screen.getByText("Invalid notebook")).toBeTruthy();
    expect(screen.getByText("This file is not a valid Jupyter notebook.")).toBeTruthy();
  });

  it("uses compact read-only spacing for notebook cells", () => {
    const content = JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {},
      cells: [
        { cell_type: "markdown", source: "# A", metadata: {} },
        { cell_type: "markdown", source: "# B", metadata: {} },
      ],
    });
    const { container } = render(<JupyterRenderer content={content} fileName="analysis.ipynb" />);

    expect(container.querySelector("[data-testid='jupyter-renderer-root']")?.className).toContain("py-4");
    expect(container.querySelector("[data-testid='jupyter-cell-list']")?.className).toContain("space-y-3");
  });

  it("adds coding status without taking over imported read-only notebooks", () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        vscodeCompatEnabled: true,
      },
    });
    useVSCodeCompatStore.setState({
      settings: createDefaultVSCodeWorkbenchSettings(),
      keybindings: [],
      snippets: [],
      tasks: [],
      extensions: [
        { id: "ms-python.python", source: "installed", displayName: "Python" },
      ],
      importedAt: 1,
      sourceLabel: "VS Code",
      warnings: [],
    });
    const content = JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {
        kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      },
      cells: [
        { cell_type: "code", source: "print('ready')", metadata: {}, outputs: [] },
      ],
    });

    render(<JupyterRenderer content={content} fileName="analysis.ipynb" />);

    expect(screen.getByTestId("code-cell").textContent).toContain("print('ready')");
    expect(screen.getByTestId("jupyter-renderer-root")).toBeTruthy();
    expect(screen.queryByText(/Open in VS Code/)).toBeNull();
    expect(screen.queryByLabelText("VS Code activity bar")).toBeNull();
  });

  it("does not register notebook documents with the removed simulated extension host", async () => {
    const openDocument = vi.fn(async () => undefined);
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        vscodeCompatEnabled: true,
      },
    });
    useVSCodeExtensionHostStore.setState({
      snapshot: {
        status: "ready",
        runtime: "node",
        commandCount: 0,
        activeExtensionCount: 1,
        commands: [],
        views: [],
        extensions: [],
        lastError: null,
      },
      openDocument,
    } as never);
    const content = JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {},
      cells: [],
    });

    render(<JupyterRenderer content={content} fileName="analysis.ipynb" filePath="C:/workspace/analysis.ipynb" />);

    expect(openDocument).not.toHaveBeenCalled();
  });

  it("renders notebook error output as native execution output without a compatibility diagnostic", () => {
    const content = JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {},
      cells: [{
        cell_type: "code",
        source: "1 / 0",
        metadata: {},
        execution_count: 1,
        outputs: [{
          output_type: "error",
          ename: "ZeroDivisionError",
          evalue: "division by zero",
          traceback: ["Traceback (most recent call last):", "ZeroDivisionError: division by zero"],
        }],
      }],
    });

    render(<JupyterRenderer content={content} fileName="errors.ipynb" />);

    expect(screen.getByTestId("output-area").getAttribute("data-output-types")).toBe("error");
    expect(outputArea).toHaveBeenCalledWith(
      expect.objectContaining({
        outputs: [expect.objectContaining({
          type: "error",
          errorName: "ZeroDivisionError",
          errorValue: "division by zero",
        })],
        variant: "compact",
      }),
      undefined,
    );
    expect(screen.queryByText(/extension activation failed/i)).toBeNull();
  });
});
