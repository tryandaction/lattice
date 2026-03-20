/**
 * @vitest-environment jsdom
 */

import React, { forwardRef, useImperativeHandle } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownCell } from "../markdown-cell";

const livePreviewPropsSpy = vi.hoisted(() => vi.fn());
const focusSpy = vi.hoisted(() => vi.fn());

vi.mock("@/components/editor/codemirror/live-preview/live-preview-editor", () => ({
  LivePreviewEditor: forwardRef((props: Record<string, unknown>, ref) => {
    livePreviewPropsSpy(props);
    useImperativeHandle(ref, () => ({
      focus: focusSpy,
      scrollToLine: vi.fn(),
      flashLine: vi.fn(),
      getEditorState: vi.fn(() => null),
      restoreEditorState: vi.fn(),
    }));

    return <div data-testid="live-preview" data-mode={String(props.mode)} data-readonly={String(props.readOnly)} />;
  }),
}));

describe("MarkdownCell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders active cells in live mode with auto-height", () => {
    render(
      <MarkdownCell
        source="# Demo"
        isActive={true}
        onChange={vi.fn()}
        onFocus={vi.fn()}
        filePath="notes/demo.ipynb"
        cellId="cell-1"
      />,
    );

    const preview = screen.getByTestId("live-preview");
    expect(preview.getAttribute("data-mode")).toBe("live");
    expect(preview.getAttribute("data-readonly")).toBe("false");
    expect(livePreviewPropsSpy).toHaveBeenCalledWith(expect.objectContaining({
      autoHeight: true,
      filePath: "notes/demo.ipynb",
    }));
  });

  it("renders inactive cells in reading mode", () => {
    render(
      <MarkdownCell
        source="# Demo"
        isActive={false}
        onChange={vi.fn()}
        onFocus={vi.fn()}
      />,
    );

    const preview = screen.getByTestId("live-preview");
    expect(preview.getAttribute("data-mode")).toBe("reading");
    expect(preview.getAttribute("data-readonly")).toBe("true");
  });

  it("switches to source mode and focuses on click", () => {
    const onFocus = vi.fn();
    render(
      <MarkdownCell
        source="# Demo"
        isActive={true}
        onChange={vi.fn()}
        onFocus={onFocus}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Source/i }));
    const preview = screen.getByTestId("live-preview");
    expect(preview.getAttribute("data-mode")).toBe("source");

    fireEvent.click(preview);
    expect(onFocus).toHaveBeenCalled();
  });
});
