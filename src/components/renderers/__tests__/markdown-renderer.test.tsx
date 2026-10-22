/**
 * @vitest-environment jsdom
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownRenderer } from "../markdown-renderer";
import { buildCitationContracts } from "@/lib/ai/citation-contract";
import { AssetSourceContext } from '@/lib/asset-source-context';

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
  it('keeps cloud images scoped to each renderer and releases their URLs on unmount', async () => {
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) { this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
      disconnect() {}
    });
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => `blob:${(blob as File).name}`);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const a = { identity: 'tab-a', resolveAsset: async () => new File(['a'], 'a.png') };
    const b = { identity: 'tab-b', resolveAsset: async () => new File(['b'], 'b.png') };
    const view = render(<><AssetSourceContext.Provider value={a}><MarkdownRenderer content="![A](plot.png)" /></AssetSourceContext.Provider><AssetSourceContext.Provider value={b}><MarkdownRenderer content="![B](plot.png)" /></AssetSourceContext.Provider></>);
    try {
      await waitFor(() => {
        expect(screen.getByRole('img', { name: 'A' }).getAttribute('src')).toBe('blob:a.png');
        expect(screen.getByRole('img', { name: 'B' }).getAttribute('src')).toBe('blob:b.png');
      }, { timeout: 10000 });
      view.unmount();
      expect(create).toHaveBeenCalled();
      for (const result of create.mock.results) if (result.type === 'return') expect(revoke).toHaveBeenCalledWith(result.value);
    } finally {
      view.unmount(); create.mockRestore(); revoke.mockRestore(); vi.unstubAllGlobals();
    }
  });
  it("renders approved live plugin Blob images without allowing Blob links or unrelated resources", () => {
    const own = "blob:http://localhost/owned-plugin-image";
    const other = "blob:http://localhost/another-plugin-image";
    render(<MarkdownRenderer
      content={`![Owned](${own}) ![Other](${other}) [Unsafe link](${own}) [Script](javascript:alert)`}
      isImageUrlAllowed={(url) => url === own}
    />);
    expect(screen.getByRole("img", { name: "Owned" }).getAttribute("src")).toBe(own);
    expect(screen.getByRole("img", { name: "Other" }).getAttribute("src")).not.toBe(other);
    expect(screen.getByText("Unsafe link").closest("a")?.getAttribute("href")).toBe("");
    expect(screen.getByText("Script").closest("a")?.getAttribute("href")).toBe("");
  });

  it("numbers only cited passages in appearance order after resolving page-context quote tokens", () => {
    const citations = buildCitationContracts([
      { kind: "pdf_page", label: "paper", locator: "paper.pdf#page=1", anchor: { page: 1 }, preview: "Unused context" },
      { kind: "pdf_page", label: "paper", locator: "paper.pdf#page=7", anchor: { page: 7 }, preview: "First precise quote. Second precise quote." },
    ]);
    const id = citations[1].stableId;
    render(<MarkdownRenderer content={`A [First](citation:${id}?quote=First%20precise%20quote.)\n\nB [Second](citation:${id}?quote=Second%20precise%20quote.)\n\nC [Repeat](citation:${id}?quote=First%20precise%20quote.)`} linkPolicy="strict-ai" citationContracts={citations} />);
    expect(screen.getByRole("link", { name: "First" }).querySelector('[aria-hidden="true"]')?.textContent).toBe("1");
    expect(screen.getByRole("link", { name: "Second" }).querySelector('[aria-hidden="true"]')?.textContent).toBe("2");
    expect(screen.getByRole("link", { name: "Repeat" }).querySelector('[aria-hidden="true"]')?.textContent).toBe("1");
  });

  it("shows compact circular citation numbers while preserving descriptive accessible labels and passage targets", () => {
    const citations = buildCitationContracts([
      { kind: "pdf_page", label: "First paper", locator: "first.pdf#page=2", anchor: { page: 2, snippet: "First passage" } },
      { kind: "pdf_page", label: "Second paper", locator: "second.pdf#page=9", anchor: { page: 9, snippet: "Second passage" } },
    ]);
    const navigate = vi.fn();
    render(<MarkdownRenderer content={`Finding [Second source](citation:${citations[1].stableId}); repeated [Same source](citation:${citations[1].stableId}). [Website](https://example.org)`} linkPolicy="strict-ai" citationContracts={citations} onCitationNavigate={navigate} />);
    const second = screen.getByRole("link", { name: "Second source" });
    expect(second.className).toContain("rounded-full");
    expect(second.querySelector('[aria-hidden="true"]')?.textContent).toBe("1");
    expect(screen.getByRole("link", { name: "Same source" }).querySelector('[aria-hidden="true"]')?.textContent).toBe("1");
    expect(second.title).toContain("p.9");
    expect(second.title).toContain("Second passage");
    fireEvent.click(second);
    expect(navigate).toHaveBeenCalledWith(citations[1].evidenceRef);
    expect(screen.getByRole("link", { name: "Website" }).hasAttribute("data-ai-citation")).toBe(false);
  });

  it("explicitly labels a model citation without a verifiable passage instead of offering a fake precise link", () => {
    const refs = buildCitationContracts([{ kind: "pdf_page", label: "paper.pdf", locator: "paper.pdf#page=3", anchor: { page: 3 }, preview: "The measured field is 58 G." }]);
    const { container } = render(<MarkdownRenderer content={`A claim [p.3](citation:${refs[0].stableId})`} linkPolicy="strict-ai" citationContracts={refs} />);
    expect(screen.queryByRole("link", { name: "p.3" })).toBeNull();
    expect(container.querySelector('[data-ai-citation-unresolved="true"]')?.textContent).toMatch(/Unresolved|未定位/);
  });

  it("uses the supplied citation navigation entry for inline links", () => {
    const citations = buildCitationContracts([{ kind: "pdf_page", label: "paper.pdf", locator: "nested/paper.pdf#page=12", anchor: { page: 12, snippet: "Exact source passage" } }]);
    const onCitationNavigate = vi.fn();
    render(<MarkdownRenderer content={`Claim [source](citation:${citations[0].stableId})`} linkPolicy="strict-ai" citationContracts={citations} onCitationNavigate={onCitationNavigate} />);
    fireEvent.click(screen.getByRole("link", { name: "source" }));
    expect(onCitationNavigate).toHaveBeenCalledWith(citations[0].evidenceRef);
    expect(navigateLinkMock).not.toHaveBeenCalled();
  });

  it("keeps multiple citations next to their claims and navigates to each independent passage", async () => {
    const citationContracts = buildCitationContracts([
      { kind: "pdf_page", label: "paper.pdf", locator: "paper.pdf#page=3", anchor: { page: 3, snippet: "First finding" } },
      { kind: "pdf_page", label: "paper.pdf", locator: "paper.pdf#page=3", anchor: { page: 3, snippet: "Second finding" } },
      { kind: "pdf_page", label: "paper.pdf", locator: "paper.pdf#page=12", anchor: { page: 12, snippet: "58 G" } },
    ]);
    render(<MarkdownRenderer content={'First claim [1](paper.pdf#page=3&text=First%20finding).\n\nSecond claim [2](paper.pdf#page=3&text=Second%20finding).\n\nField [3](paper.pdf#page=12&text=58%20G).'} linkPolicy="strict-ai" citationContracts={citationContracts} />);
    const second = screen.getByRole("link", { name: "2" });
    expect(second.closest("p")?.textContent).toContain("Second claim");
    fireEvent.click(second);
    await waitFor(() => expect(navigateLinkMock).toHaveBeenLastCalledWith("paper.pdf#page=3&text=Second%20finding", expect.objectContaining({ evidenceAnchor: { page: 3, snippet: "Second finding" } })));
    fireEvent.click(screen.getByRole("link", { name: "3" }));
    await waitFor(() => expect(navigateLinkMock).toHaveBeenLastCalledWith("paper.pdf#page=12&text=58%20G", expect.objectContaining({ evidenceAnchor: { page: 12, snippet: "58 G" } })));
  });

  it("retains the PDF evidence geometry when an inline AI source is clicked", async () => {
    const anchor = { page: 3, snippet: "Exact passage", rects: [{ left: 0.1, top: 0.2, width: 0.3, height: 0.02 }] };
    const citationContracts = buildCitationContracts([{ kind: "pdf_page", label: "paper.pdf", locator: "paper.pdf#page=3", anchor }]);
    render(<MarkdownRenderer content={`[Source](citation:${citationContracts[0].stableId})`} linkPolicy="strict-ai" citationContracts={citationContracts} />);
    fireEvent.click(screen.getByRole("link", { name: "Source" }));
    await waitFor(() => expect(navigateLinkMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ evidenceAnchor: anchor })));
  });

  it("renders a verified citation token as a source link without allowing arbitrary schemes", () => {
    const citations = buildCitationContracts([{ kind: "pdf_page", label: "paper.pdf", locator: "paper.pdf#page=2", anchor: { page: 2, snippet: "Verified text" } }]);
    render(<MarkdownRenderer content={`[Source](citation:${citations[0].stableId}) [Unsafe](javascript:alert)`} linkPolicy="strict-ai" citationContracts={citations} />);
    expect(screen.getByRole("link", { name: "Source" }).getAttribute("href")).toBe("paper.pdf#page=2&text=Verified%20text");
    expect(screen.queryByRole("link", { name: "Unsafe" })).toBeNull();
  });

  beforeEach(() => {
    navigateLinkMock.mockClear();
  });

  it("renders arbitrary model-generated relative targets as plain text in strict AI mode", () => {
    const citationContracts = buildCitationContracts([{
      kind: "pdf_page",
      label: "papers/paper.pdf",
      locator: "papers/paper.pdf#page=3",
      anchor: { page: 3, snippet: "Verified passage" },
    }]);
    render(
      <MarkdownRenderer
        content={'The [4,2,2](4,2,2) code is an erasure-detecting code. [Source](papers/paper.pdf#page=3&text=Verified%20passage)'}
        variant="document"
        linkPolicy="strict-ai"
        citationContracts={citationContracts}
      />,
    );

    expect(screen.queryByRole("link", { name: "4,2,2" })).toBeNull();
    expect(screen.getByText("4,2,2")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Source" }).getAttribute("href")).toBe("papers/paper.pdf#page=3&text=Verified%20passage");
  });

  it("keeps fabricated file-like AI targets as plain text", () => {
    render(
      <MarkdownRenderer
        content={'The model suggested [a source](missing-paper.pdf), but no citation is bound.'}
        variant="document"
        linkPolicy="strict-ai"
      />,
    );

    expect(screen.queryByRole("link", { name: "a source" })).toBeNull();
    expect(screen.getByText("a source")).toBeTruthy();
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

  it("renders legacy PDF annotation quotes and local screenshots with their real color", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:annotation-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const previewFile = new File(["preview"], "ann-blue.png", { type: "image/png" });
    const previewDir = {
      getFileHandle: vi.fn(async () => ({ getFile: vi.fn(async () => previewFile) })),
    };
    const paperDir = {
      getDirectoryHandle: vi.fn(async () => previewDir),
    };
    const itemsDir = {
      getDirectoryHandle: vi.fn(async () => paperDir),
    };
    const latticeDir = {
      getDirectoryHandle: vi.fn(async () => itemsDir),
    };
    const rootHandle = {
      name: "workspace",
      getDirectoryHandle: vi.fn(async () => latticeDir),
    } as unknown as FileSystemDirectoryHandle;

    const { container } = render(
      <MarkdownRenderer
        content={[
          '### 1. Area',
          '<!-- lattice-pdf-annotation id="ann-blue" page="2" type="area" color="#2ea8e5" -->',
          '<span class="lattice-pdf-annotation-chip" data-color="#2ea8e5" data-type="area">Area</span>',
          '',
          '#### Quote',
          '',
          '> selected PDF text',
          '',
          '#### Screenshot',
          '',
          '![Area Screenshot ann-blue Page 2](./_annotation_previews/ann-blue.png)',
        ].join("\n")}
        fileName="_annotations.md"
        filePath=".lattice/items/paper/_annotations.md"
        rootHandle={rootHandle}
        variant="system-index"
      />,
    );

    const quote = container.querySelector(".lattice-pdf-annotation-quote") as HTMLElement | null;
    expect(quote?.style.getPropertyValue("--annotation-color")).toBe("#2ea8e5");
    const image = container.querySelector(".lattice-pdf-annotation-preview") as HTMLImageElement | null;
    expect(image?.style.getPropertyValue("--annotation-color")).toBe("#2ea8e5");
    await waitFor(() => expect(image?.getAttribute("src")).toBe("blob:annotation-preview"));
  });
});
