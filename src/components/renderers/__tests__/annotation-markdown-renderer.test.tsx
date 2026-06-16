/**
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnnotationMarkdownRenderer } from "../annotation-markdown-renderer";

vi.mock("@/lib/markdown-links", () => ({
  convertWikiLinksToMarkdown: (content: string) => content,
}));

vi.mock("./app-markdown-link", () => ({
  AppMarkdownLink: ({ href, children, className }: React.PropsWithChildren<{ href?: string; className?: string }>) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

describe("AnnotationMarkdownRenderer", () => {
  it("keeps inline math and inline code inside phrasing nodes", () => {
    const { container } = render(
      <AnnotationMarkdownRenderer content={"Inline $E=mc^2$ and `code` remain compact."} />,
    );

    expect(screen.getByText("E=mc^2")).toBeTruthy();
    expect(screen.getByText("code")).toBeTruthy();
    expect(container.querySelector(".annotation-md p div")).toBeNull();
    expect(container.querySelector(".annotation-md p pre")).toBeNull();
  });

  it("renders fenced code as a legal pre/code block", () => {
    const { container } = render(
      <AnnotationMarkdownRenderer content={"```ts\nconst ok = true;\n```"} />,
    );

    const pre = container.querySelector(".annotation-md pre");
    expect(pre).toBeTruthy();
    expect(pre?.querySelector("code")?.textContent).toContain("const ok = true;");
    expect(container.querySelector(".annotation-md p div")).toBeNull();
  });
});
