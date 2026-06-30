import { describe, expect, it } from "vitest";
import {
  findMarkdownHeadingLine,
  isPendingNavigationForFile,
} from "../markdown-navigation";
import type { OutlineItem } from "@/components/editor/codemirror/live-preview/types";

const outline: OutlineItem[] = [
  {
    level: 1,
    text: "Project Overview",
    line: 1,
    from: 0,
    to: 18,
    children: [
      {
        level: 2,
        text: "Deep Heading: 量子效率!",
        line: 8,
        from: 80,
        to: 104,
        children: [],
      },
    ],
  },
];

describe("markdown navigation helpers", () => {
  it("finds headings by readable text and slug fragments", () => {
    expect(findMarkdownHeadingLine(outline, "Project Overview")).toBe(1);
    expect(findMarkdownHeadingLine(outline, "project-overview")).toBe(1);
    expect(findMarkdownHeadingLine(outline, "Deep Heading: 量子效率!")).toBe(8);
    expect(findMarkdownHeadingLine(outline, "deep-heading-量子效率")).toBe(8);
  });

  it("matches pending navigation paths after workspace-root prefix normalization", () => {
    expect(isPendingNavigationForFile("workspace/notes/demo.md", "notes/demo.md", "workspace")).toBe(true);
    expect(isPendingNavigationForFile("notes/demo.md", "workspace/notes/demo.md", "workspace")).toBe(true);
    expect(isPendingNavigationForFile("other/notes/demo.md", "notes/demo.md", "workspace")).toBe(false);
  });
});
