/**
 * @vitest-environment jsdom
 */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LivePreviewGuide } from "../live-preview-guide";

let locale = "zh-CN";

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({ locale }),
}));

vi.mock("@/components/editor/obsidian-markdown-viewer", () => ({
  ObsidianMarkdownViewer: ({ content }: { content: string }) => (
    <div data-testid="markdown-demo">{content}</div>
  ),
}));

describe("LivePreviewGuide", () => {
  beforeEach(() => {
    locale = "zh-CN";
  });

  it("renders the product guide in Chinese", () => {
    render(<LivePreviewGuide surface="dialog" onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Lattice 用户指南" })).toBeTruthy();
    expect(screen.getByText("PDF 批注与子文档")).toBeTruthy();
    expect(screen.getByText("量子键盘")).toBeTruthy();
    expect(screen.getByText("AI 工作台")).toBeTruthy();
  });

  it("renders the product guide in English", () => {
    locale = "en-US";

    render(<LivePreviewGuide surface="dialog" onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Lattice User Guide" })).toBeTruthy();
    expect(screen.getByText("PDF Annotations And Sidecars")).toBeTruthy();
    expect(screen.getByText("Quantum Keyboard")).toBeTruthy();
    expect(screen.getByText("AI Workspace")).toBeTruthy();
  });

  it("moves through guide sections with next and previous controls", () => {
    render(<LivePreviewGuide surface="dialog" onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "快速开始" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /下一项/ }));

    expect(screen.getByRole("heading", { name: "Markdown 编辑" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "可编辑示例" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /上一项/ }));
    expect(screen.getByRole("heading", { name: "快速开始" })).toBeTruthy();
  });
});
