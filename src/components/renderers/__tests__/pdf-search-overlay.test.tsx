/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PdfSearchOverlay } from "../pdf-search-overlay";
import { getPreferredPdfPageSearchText } from "@/lib/pdf-page-text-engine";

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => ({
      "pdf.search.placeholder": "Search in PDF...",
      "pdf.search.noMatch": "0/0",
      "pdf.search.prevMatch": "Previous match",
      "pdf.search.nextMatch": "Next match",
      "pdf.search.close": "Close",
      "pdf.search.matchCase": "Match case",
      "pdf.search.wholeWord": "Whole words",
      "pdf.search.ready": "Type to search this PDF",
      "pdf.search.resultsCount": "{count} results",
      "pdf.search.noResults": "No results",
      "pdf.search.pageLabel": "Page {page}",
    }[key] ?? key),
  }),
}));

vi.mock("@/lib/pdf-page-text-engine", () => ({
  getPreferredPdfPageSearchText: vi.fn(),
}));

describe("PdfSearchOverlay", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("opens instantly without extracting PDF text before the user types a query", async () => {
    vi.mocked(getPreferredPdfPageSearchText).mockResolvedValue("keyword");

    render(
      <PdfSearchOverlay
        pdfDocument={{} as never}
        fileHandle={null}
        numPages={20}
        isOpen
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId("pdf-search-overlay")).toBeTruthy();
    expect(screen.getByPlaceholderText("Search in PDF...")).toBeTruthy();
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)));
    expect(getPreferredPdfPageSearchText).not.toHaveBeenCalled();
  });

  it("reruns search after page text loads and applies professional find options", async () => {
    vi.mocked(getPreferredPdfPageSearchText).mockResolvedValue("Atom atomic ATOM atom.");

    render(
      <PdfSearchOverlay
        pdfDocument={{} as never}
        fileHandle={null}
        numPages={1}
        isOpen
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search in PDF..."), {
      target: { value: "atom" },
    });

    await waitFor(() => {
      expect(screen.getAllByText("1/4").length).toBeGreaterThan(0);
    }, { timeout: 5_000 });

    fireEvent.click(screen.getByTitle("Match case"));
    await waitFor(() => {
      expect(screen.getAllByText("1/2").length).toBeGreaterThan(0);
    }, { timeout: 5_000 });

    fireEvent.click(screen.getByTitle("Whole words"));
    await waitFor(() => {
      expect(screen.getAllByText("1/1").length).toBeGreaterThan(0);
    }, { timeout: 5_000 });
  });

  it("keeps the search panel fixed and shows page-scoped result previews that can navigate", async () => {
    vi.mocked(getPreferredPdfPageSearchText).mockImplementation(async ({ pageNumber }) => (
      pageNumber === 1
        ? "A precise lattice keyword appears in this paragraph."
        : "Another keyword appears on the second page."
    ));
    const onNavigateToPage = vi.fn();
    const onActiveMatchChange = vi.fn();

    render(
      <PdfSearchOverlay
        pdfDocument={{} as never}
        fileHandle={null}
        numPages={2}
        isOpen
        onClose={vi.fn()}
        onNavigateToPage={onNavigateToPage}
        onActiveMatchChange={onActiveMatchChange}
      />,
    );

    const overlay = screen.getByTestId("pdf-search-overlay");
    expect(overlay.className).toContain("fixed");
    expect(screen.getByText("Type to search this PDF")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Search in PDF..."), {
      target: { value: "keyword" },
    });

    await waitFor(() => {
      expect(screen.getByText("2 results")).toBeTruthy();
      expect(screen.getByText("Page 1")).toBeTruthy();
      expect(screen.getByText("Page 2")).toBeTruthy();
    }, { timeout: 5_000 });
    expect(screen.getByText(/precise lattice keyword appears/u)).toBeTruthy();
    expect(onNavigateToPage).not.toHaveBeenCalled();
    expect(onActiveMatchChange).toHaveBeenLastCalledWith(null);

    fireEvent.click(screen.getByText("Page 2"));

    await waitFor(() => {
      expect(onNavigateToPage).toHaveBeenLastCalledWith(2, []);
      expect(onActiveMatchChange).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    }, { timeout: 5_000 });
  });

  it("keeps all result rows in a two-row scrollable list", async () => {
    vi.mocked(getPreferredPdfPageSearchText).mockImplementation(async ({ pageNumber }) => (
      `Page ${pageNumber} keyword context.`
    ));

    render(
      <PdfSearchOverlay
        pdfDocument={{} as never}
        fileHandle={null}
        numPages={3}
        isOpen
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search in PDF..."), {
      target: { value: "keyword" },
    });

    await waitFor(() => {
      expect(screen.getByText("3 results")).toBeTruthy();
      expect(screen.getByText("Page 1")).toBeTruthy();
      expect(screen.getByText("Page 2")).toBeTruthy();
    }, { timeout: 5_000 });
    expect(screen.getByText("Page 3")).toBeTruthy();
    expect(screen.getByTestId("pdf-search-results-list").className).toContain("overflow-y-auto");
    expect(screen.getByTestId("pdf-search-results-list").className).toContain("max-h-[9.75rem]");
  });

  it("does not auto-jump after search and starts arrow navigation from the nearest current-page match", async () => {
    vi.mocked(getPreferredPdfPageSearchText).mockImplementation(async ({ pageNumber }) => (
      `Page ${pageNumber} keyword context.`
    ));
    const onNavigateToPage = vi.fn();
    const onActiveMatchChange = vi.fn();
    let scrolledIndex: string | null = null;
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function mockScrollIntoView() {
      scrolledIndex = this.getAttribute("data-pdf-search-result-index");
    };

    try {
      render(
        <PdfSearchOverlay
          pdfDocument={{} as never}
          fileHandle={null}
          numPages={5}
          currentPage={4}
          isOpen
          onClose={vi.fn()}
          onNavigateToPage={onNavigateToPage}
          onActiveMatchChange={onActiveMatchChange}
        />,
      );

      fireEvent.change(screen.getByPlaceholderText("Search in PDF..."), {
        target: { value: "keyword" },
      });

      await waitFor(() => {
        expect(screen.getByText("5 results")).toBeTruthy();
        expect(scrolledIndex).toBe("3");
      }, { timeout: 5_000 });
      expect(onNavigateToPage).not.toHaveBeenCalled();
      expect(onActiveMatchChange).toHaveBeenLastCalledWith(null);

      fireEvent.click(screen.getByTitle("Next match"));

      await waitFor(() => {
        expect(onNavigateToPage).toHaveBeenLastCalledWith(4, []);
        expect(onActiveMatchChange).toHaveBeenLastCalledWith(expect.objectContaining({ page: 4 }));
      }, { timeout: 5_000 });
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("indexes pages near the current page first after a query is entered", async () => {
    const requestedPages: number[] = [];
    vi.mocked(getPreferredPdfPageSearchText).mockImplementation(async ({ pageNumber }) => {
      requestedPages.push(pageNumber);
      return `Page ${pageNumber} keyword context.`;
    });

    render(
      <PdfSearchOverlay
        pdfDocument={{} as never}
        fileHandle={null}
        numPages={5}
        currentPage={4}
        isOpen
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search in PDF..."), {
      target: { value: "keyword" },
    });

    await waitFor(() => {
      expect(requestedPages.length).toBeGreaterThanOrEqual(3);
    }, { timeout: 5_000 });
    expect(requestedPages.slice(0, 3)).toEqual([4, 3, 5]);
  });

  it("keeps the active result while later page batches extend the search index", async () => {
    let resolveLastPage!: (text: string) => void;
    const lastPageText = new Promise<string>((resolve) => {
      resolveLastPage = resolve;
    });
    vi.mocked(getPreferredPdfPageSearchText).mockImplementation(async ({ pageNumber }) => (
      pageNumber === 4
        ? lastPageText
        : `Page ${pageNumber} keyword context.`
    ));
    const onActiveMatchChange = vi.fn();

    render(
      <PdfSearchOverlay
        pdfDocument={{} as never}
        fileHandle={null}
        numPages={4}
        isOpen
        onClose={vi.fn()}
        onActiveMatchChange={onActiveMatchChange}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search in PDF..."), {
      target: { value: "keyword" },
    });

    await waitFor(() => {
      expect(screen.getByText("3 results")).toBeTruthy();
    }, { timeout: 5_000 });

    fireEvent.click(screen.getByText("Page 2"));
    await waitFor(() => {
      expect(onActiveMatchChange).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
      expect(screen.getAllByText("2/3").length).toBeGreaterThan(0);
    }, { timeout: 5_000 });

    resolveLastPage("Page 4 keyword context.");

    await waitFor(() => {
      expect(screen.getByText("4 results")).toBeTruthy();
    }, { timeout: 5_000 });
    expect(onActiveMatchChange).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(screen.getAllByText("2/4").length).toBeGreaterThan(0);
  });

  it("clears active search annotation when closing the fixed search panel", async () => {
    vi.mocked(getPreferredPdfPageSearchText).mockResolvedValue("Searchable keyword text.");
    const onClose = vi.fn();
    const onActiveMatchChange = vi.fn();
    const onMatchesChange = vi.fn();

    render(
      <PdfSearchOverlay
        pdfDocument={{} as never}
        fileHandle={null}
        numPages={1}
        isOpen
        onClose={onClose}
        onActiveMatchChange={onActiveMatchChange}
        onMatchesChange={onMatchesChange}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search in PDF..."), {
      target: { value: "keyword" },
    });

    await waitFor(() => {
      expect(onMatchesChange).toHaveBeenCalledWith([
        expect.objectContaining({ page: 1 }),
      ]);
    }, { timeout: 5_000 });
    expect(onActiveMatchChange).toHaveBeenLastCalledWith(null);

    fireEvent.click(screen.getByText("Page 1"));
    expect(onActiveMatchChange).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));

    fireEvent.click(screen.getByTitle("Close"));

    expect(onActiveMatchChange).toHaveBeenLastCalledWith(null);
    expect(onMatchesChange).toHaveBeenLastCalledWith([]);
    expect(onClose).toHaveBeenCalled();
  });
});
