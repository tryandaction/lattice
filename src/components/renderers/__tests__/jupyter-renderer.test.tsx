/**
 * @vitest-environment jsdom
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JupyterRenderer } from "../jupyter-renderer";

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
  OutputArea: () => <div data-testid="output-area" />,
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
});
