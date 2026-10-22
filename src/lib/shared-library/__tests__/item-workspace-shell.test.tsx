/**
 * @vitest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ItemWorkspaceRegistry } from "../item-workspace";
import { ItemWorkspaceShell } from "../../../components/shared-library/item-workspace-shell";
import type { ItemWorkspaceAdapter } from "../item-workspace";

const pdfAdapter: ItemWorkspaceAdapter = {
  kind: "pdf",
  label: "PDF",
  renderViewer: () => <div data-testid="pdf-viewer">PDF viewer</div>,
  renderHeader: () => <div data-testid="pdf-header">PDF workspace header</div>,
  renderTools: () => <div data-testid="pdf-tools">PDF tools</div>,
};

const markdownAdapter: ItemWorkspaceAdapter = {
  kind: "markdown",
  label: "Markdown",
  renderViewer: () => <div data-testid="md-viewer">Markdown viewer</div>,
};

describe("ItemWorkspaceShell", () => {
  it("mounts the adapter viewer, header and tools for the item kind", () => {
    const registry = new ItemWorkspaceRegistry()
      .register(pdfAdapter)
      .register(markdownAdapter);

    render(
      <ItemWorkspaceShell
        item={{ id: "item-1", kind: "pdf", title: "Paper" }}
        registry={registry}
      />,
    );

    expect(screen.getByTestId("pdf-viewer")).toBeTruthy();
    expect(screen.getByTestId("pdf-header")).toBeTruthy();
    expect(screen.getByTestId("pdf-tools")).toBeTruthy();
    expect(screen.queryByTestId("md-viewer")).toBeNull();
  });

  it("switches the viewer when the item kind changes", () => {
    const registry = new ItemWorkspaceRegistry()
      .register(pdfAdapter)
      .register(markdownAdapter);

    const { rerender } = render(
      <ItemWorkspaceShell
        item={{ id: "item-1", kind: "pdf", title: "Paper" }}
        registry={registry}
      />,
    );
    expect(screen.getByTestId("pdf-viewer")).toBeTruthy();

    rerender(
      <ItemWorkspaceShell
        item={{ id: "item-1", kind: "markdown", title: "Notes" }}
        registry={registry}
      />,
    );

    expect(screen.getByTestId("md-viewer")).toBeTruthy();
    expect(screen.queryByTestId("pdf-viewer")).toBeNull();
  });

  it("falls back to the fallback viewer for an unknown kind", () => {
    const registry = new ItemWorkspaceRegistry().register(pdfAdapter);

    render(
      <ItemWorkspaceShell
        item={{ id: "item-1", kind: "weird", title: "Unknown" }}
        registry={registry}
        fallbackViewer={(item) => (
          <div data-testid="generic-viewer">{item.title}</div>
        )}
      />,
    );

    expect(screen.getByTestId("generic-viewer")).toBeTruthy();
  });
});
