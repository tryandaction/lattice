/**
 * @vitest-environment jsdom
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownRenderer } from "../markdown-renderer";

vi.mock("@/hooks/use-selection-context-menu", () => ({
  useSelectionContextMenu: () => ({
    menuState: null,
    closeMenu: vi.fn(),
  }),
}));

vi.mock("@/components/ai/selection-context-menu", () => ({
  SelectionContextMenu: () => null,
}));

vi.mock("@/components/ai/selection-ai-hub", () => ({
  SelectionAiHub: () => null,
}));

describe("MarkdownRenderer", () => {
  it("hides leading frontmatter in document reading render", () => {
    const { container } = render(
      <MarkdownRenderer
        content={`---\ntitle: Demo\n---\n# Hello`}
        fileName="demo.md"
        variant="document"
      />,
    );

    expect(screen.queryByText("title: Demo")).toBeNull();
    expect(screen.getByRole("heading", { name: "Hello" })).toBeTruthy();
    expect(container.querySelector(".prose-lattice")).toBeTruthy();
  });

  it("uses the system index variant styling and still strips frontmatter", () => {
    const { container } = render(
      <MarkdownRenderer
        content={`---\ntitle: Index\n---\n# Overview`}
        fileName="_overview.md"
        variant="system-index"
      />,
    );

    expect(screen.queryByText("title: Index")).toBeNull();
    expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy();
    expect(container.querySelector(".prose-system-index")).toBeTruthy();
  });
});
