/**
 * @vitest-environment jsdom
 */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownRenderer } from "../markdown-renderer";

const navigateLinkMock = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true);

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

vi.mock("@/lib/link-router/navigate-link", () => ({
  navigateLink: (...args: unknown[]) => navigateLinkMock(...args),
}));

vi.mock("@/stores/workspace-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/workspace-store")>();
  return {
    ...actual,
    useWorkspaceStore: (selector: (state: { layout: { activePaneId: string }; rootHandle: null }) => unknown) =>
      selector({ layout: { activePaneId: "pane-test" }, rootHandle: null }),
  };
});

describe("MarkdownRenderer", () => {
  beforeEach(() => {
    navigateLinkMock.mockClear();
  });

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

  it("renders standalone --- as a horizontal rule without relying on blank lines", () => {
    const { container } = render(
      <MarkdownRenderer
        content={`Paragraph above\n---\nParagraph below`}
        fileName="demo.md"
        variant="document"
      />,
    );

    expect(screen.getByText("Paragraph above")).toBeTruthy();
    expect(screen.getByText("Paragraph below")).toBeTruthy();
    expect(container.querySelector("hr")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Paragraph above" })).toBeNull();
  });

  it("renders Obsidian highlights, callouts, and attachment embeds in reading mode", () => {
    const { container } = render(
      <MarkdownRenderer
        content={[
          "This is ==important== and `==literal==`.",
          "",
          "> [!TIP] Useful Tip",
          "> Callout with **bold** and $x+y$.",
          "",
          "Visible %%hidden comment%% text and `%%literal comment%%`.",
          "Block target ^block-123",
          "",
          "Image embed: ![[assets/diagram.png|160]]",
          "Sized image: ![Plot|120x80](assets/plot.png)",
          "PDF embed: ![[papers/demo.pdf|Demo PDF]]",
        ].join("\n")}
        fileName="demo.md"
        variant="document"
      />,
    );

    expect(container.querySelector("mark")?.textContent).toBe("important");
    expect(screen.getByText("==literal==")).toBeTruthy();
    expect(screen.queryByText("hidden comment")).toBeNull();
    expect(screen.getByText("%%literal comment%%")).toBeTruthy();
    expect(container.textContent).not.toContain("^block-123");
    expect(container.querySelector("pre")).toBeNull();
    expect(container.querySelector(".markdown-callout-tip")).toBeTruthy();
    expect(screen.getByText("Useful Tip")).toBeTruthy();
    expect(screen.getByText("bold")).toBeTruthy();
    const embedImage = container.querySelector('img[src="assets/diagram.png"]') as HTMLImageElement | null;
    expect(embedImage?.getAttribute("width")).toBe("160");
    expect(embedImage?.getAttribute("alt")).toBe("");
    const sizedImage = container.querySelector('img[alt="Plot"]') as HTMLImageElement | null;
    expect(sizedImage?.getAttribute("width")).toBe("120");
    expect(sizedImage?.getAttribute("height")).toBe("80");
    expect(screen.getByRole("link", { name: "Demo PDF" }).getAttribute("href")).toBe("papers/demo.pdf");
  });

  it("renders PDF annotation color chips and routes annotation links through app navigation", () => {
    const { container } = render(
      <MarkdownRenderer
        content={[
          '### 1. Highlight',
          '<!-- lattice-pdf-annotation id="ann-blue" page="2" type="highlight" color="#2ea8e5" -->',
          '<span class="lattice-pdf-annotation-chip" data-color="#2ea8e5" data-type="highlight">Highlight</span>',
          '',
          '[Page 2](../../../docs/paper.pdf#page=2) | [Open annotation](../../../docs/paper.pdf#annotation=ann-blue)',
          '',
          '#### Comment',
          '',
          'A comment with **Markdown**.',
        ].join("\n")}
        fileName="_annotations.md"
        filePath=".lattice/items/paper/_annotations.md"
        paneId="pane-test"
        variant="system-index"
      />,
    );

    const chip = container.querySelector(".lattice-pdf-annotation-chip") as HTMLElement | null;
    expect(chip?.dataset.color).toBe("#2ea8e5");
    expect(chip?.dataset.type).toBe("highlight");
    expect(chip?.style.getPropertyValue("--annotation-color")).toBe("#2ea8e5");
    expect(screen.getByText("Markdown")).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Open annotation" }));

    expect(navigateLinkMock).toHaveBeenCalledWith(
      "../../../docs/paper.pdf#annotation=ann-blue",
      expect.objectContaining({
        paneId: "pane-test",
        currentFilePath: ".lattice/items/paper/_annotations.md",
      }),
    );
  });
});
