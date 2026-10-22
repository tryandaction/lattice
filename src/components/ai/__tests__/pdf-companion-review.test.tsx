import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAiPdfCompanionStore } from "@/stores/ai-pdf-companion-store";
import { PdfCompanionReview } from "../pdf-companion-review";

const annotation = {
  id: "transient-ai-claim",
  documentPath: "papers/paper.pdf",
  page: 3,
  rects: [{ x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.25 }],
  quote: "The experiment establishes the central claim.",
  source: {
    kind: "pdf_page" as const,
    label: "paper.pdf page 3",
    locator: "papers/paper.pdf#page=3",
  },
};

describe("PdfCompanionReview", () => {
  beforeEach(() => {
    useAiPdfCompanionStore.getState().clear();
  });

  it("stays absent without AI annotations", () => {
    const { container } = render(<PdfCompanionReview />);

    expect(container.innerHTML).toBe("");
  });

  it("queues an explicit injection only after user confirmation", () => {
    useAiPdfCompanionStore.getState().setTransientAnnotations([annotation]);
    render(<PdfCompanionReview />);

    fireEvent.click(screen.getByTestId("pdf-companion-confirm-all"));

    expect(useAiPdfCompanionStore.getState().pendingInjection).toEqual(
      expect.objectContaining({ annotations: [annotation] }),
    );
  });

  it("discards only the transient layer", () => {
    useAiPdfCompanionStore.getState().setTransientAnnotations([annotation]);
    render(<PdfCompanionReview />);

    fireEvent.click(screen.getByTestId("pdf-companion-discard-all"));

    expect(useAiPdfCompanionStore.getState().transientAnnotations).toEqual([]);
    expect(useAiPdfCompanionStore.getState().pendingInjection).toBeNull();
  });

  it("groups cross-file suggestions and approves only the selected file", () => {
    const second = { ...annotation, id: 'second', documentPath: 'papers/second.pdf', reason: '比较第二篇论文的测量条件。' };
    useAiPdfCompanionStore.getState().setTransientAnnotations([annotation, second], 'message-2');
    render(<PdfCompanionReview />);
    fireEvent.click(screen.getAllByText('应用到此 PDF（1 条）')[1]);
    expect(useAiPdfCompanionStore.getState().pendingInjection?.annotations).toEqual([second]);
    expect(screen.getByText(second.reason)).toBeTruthy();
    expect(screen.getByText(/尚未完成/)).toBeTruthy();
    expect(useAiPdfCompanionStore.getState().sourceMessageId).toBe('message-2');
  });

  it("removes one suggestion without approving the rest", () => {
    useAiPdfCompanionStore.getState().setTransientAnnotations([annotation, { ...annotation, id: 'second' }]);
    render(<PdfCompanionReview />);
    fireEvent.click(screen.getAllByText('移除此建议')[0]);
    expect(useAiPdfCompanionStore.getState().transientAnnotations.map((item) => item.id)).toEqual(['second']);
    expect(useAiPdfCompanionStore.getState().pendingInjection).toBeNull();
  });
});
