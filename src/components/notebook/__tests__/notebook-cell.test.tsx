/** @vitest-environment jsdom */

import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NotebookCellComponent } from "../notebook-cell";

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../code-cell", () => ({ CodeCell: () => <div data-testid="code-cell" /> }));
vi.mock("../markdown-cell", () => ({ MarkdownCell: () => <div data-testid="markdown-cell" /> }));
vi.mock("../raw-cell", () => ({ RawCell: () => <div data-testid="raw-cell" /> }));

describe("NotebookCellComponent reference navigation", () => {
  it("uses the red dashed reference frame for a highlighted target cell", () => {
    const { container } = render(
      <NotebookCellComponent
        cell={{ id: "target-cell", cell_type: "markdown", source: "Target", metadata: {} }}
        cellId="target-cell"
        isActive={false}
        isHighlighted
        canDelete={false}
        onActivate={vi.fn()}
        onAddAbove={vi.fn()}
        onAddBelow={vi.fn()}
        onDelete={vi.fn()}
        onSourceChange={vi.fn()}
        onTypeChange={vi.fn()}
      />,
    );

    expect(container.firstElementChild?.className).toContain("lattice-reference-target-flash");
  });
});
