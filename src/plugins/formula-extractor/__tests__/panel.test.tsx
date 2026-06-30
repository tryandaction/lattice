import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FormulaExtractorPanel } from "../panel";
import type { FormulaExtractionResult } from "../types";

const runPluginCommandMock = vi.fn();

vi.mock("@/lib/plugins/runtime", () => ({
  runPluginCommand: (...args: unknown[]) => runPluginCommandMock(...args),
}));

function createResult(): FormulaExtractionResult {
  return {
    sourceFile: "paper.pdf",
    viewerType: "pdf",
    scope: "document",
    scannedAt: Date.now(),
    warnings: [],
    formulas: [
      {
        id: "formula-1",
        source: "pdf",
        kind: "text-layer",
        page: 3,
        location: "page:3:2",
        confidence: 0.91,
        bbox: { x1: 0.2, y1: 0.3, x2: 0.6, y2: 0.35 },
        target: {
          viewerType: "pdf",
          page: 3,
          bbox: { x1: 0.2, y1: 0.3, x2: 0.6, y2: 0.35 },
          quote: "E = mc^2",
        },
        latex: "E = mc^2",
        rawText: "E = mc^2",
        displayMode: true,
        context: "Energy relation",
      },
    ],
    hiddenCandidates: [
      {
        page: 3,
        reason: "prose-like",
        rawText: "This is an ordinary paragraph with numbers 1 and 2.",
        score: 0.12,
      },
    ],
  };
}

describe("FormulaExtractorPanel", () => {
  beforeEach(() => {
    runPluginCommandMock.mockClear();
    runPluginCommandMock.mockResolvedValue(undefined);
  });

  it("renders extracted formulas with KaTeX preview and source LaTeX", () => {
    const { container } = render(<FormulaExtractorPanel result={createResult()} />);

    expect(screen.getByText(/paper\.pdf/)).toBeTruthy();
    expect(screen.queryByText("Locate")).toBeNull();
    expect(screen.queryByText("review")).toBeNull();
    expect(screen.queryByText("Copy all")).toBeNull();
    expect(screen.getByText("Copy LaTeX")).toBeTruthy();
    expect(screen.getByText("Copy Markdown")).toBeTruthy();
    expect(screen.getByText("OCR selection")).toBeTruthy();
    expect(screen.getByText(".md")).toBeTruthy();
    expect(screen.getByText(".tex")).toBeTruthy();
    expect(screen.getByText("Diagnostics / Hidden candidates (1)")).toBeTruthy();
    expect(container.querySelector(".katex")).toBeTruthy();
    expect(screen.getByTestId("formula-rendered-preview")).toBeTruthy();
  });

  it("waits for an explicit scan when opened without an existing result", () => {
    render(<FormulaExtractorPanel result={null} busy={false} error={null} />);

    expect(runPluginCommandMock).not.toHaveBeenCalled();
    expect(screen.getByText("Click Scan to extract formulas from the active document.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    expect(runPluginCommandMock).toHaveBeenCalledWith("formula-extractor.extract.document", undefined);
    fireEvent.click(screen.getByRole("button", { name: /ocr selection/i }));
    expect(runPluginCommandMock).toHaveBeenCalledWith("formula-extractor.ocr.selection", undefined);
  });

  it("routes card click and copy actions to explicit formula commands", () => {
    render(<FormulaExtractorPanel result={createResult()} />);

    fireEvent.click(screen.getByRole("button", { name: /Page 3 .* Energy relation/ }));
    expect(runPluginCommandMock).toHaveBeenCalledWith("formula-extractor.reveal-formula", { formulaId: "formula-1" });

    fireEvent.click(screen.getByRole("button", { name: "Copy LaTeX" }));
    expect(runPluginCommandMock).toHaveBeenCalledWith("formula-extractor.copy-formula-latex", { formulaId: "formula-1" });

    fireEvent.click(screen.getByRole("button", { name: "Copy Markdown" }));
    expect(runPluginCommandMock).toHaveBeenCalledWith("formula-extractor.copy-formula-markdown", { formulaId: "formula-1" });
  });
});
