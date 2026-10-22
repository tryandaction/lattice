import { describe, expect, it } from "vitest";
import { parseLinkTarget } from "../parse-link-target";

describe("parseLinkTarget", () => {
  it("preserves encoded external URLs without decoding their query delimiters", () => {
    const url = "https://example.com/?q=A%2BB%26C%23D";
    expect(parseLinkTarget(url).target).toEqual({ type: "external_url", url });
  });

  it("keeps a PDF page and exact encoded quote in a single navigation target", () => {
    expect(parseLinkTarget("papers/figure%231.pdf#page=3&text=Energy%20A%2BB%20%26%20C%20%2520").target).toEqual({
      type: "pdf_page", path: "papers/figure#1.pdf", page: 3, snippet: "Energy A+B & C %20",
    });
  });

  it("decodes fragment values exactly once", () => {
    expect(parseLinkTarget("notes.md#text=A%2BB%20%26%20C%20%23D").target).toEqual({
      type: "workspace_text", path: "notes.md", snippet: "A+B & C #D",
    });
    expect(parseLinkTarget("paper.pdf#annotation=ann%2B1%26x%2520&page=2").target).toEqual({
      type: "pdf_annotation", path: "paper.pdf", annotationId: "ann+1&x%20", page: 2,
    });
  });

  it.each(["3oops", "2.5", "0", "-1", "Infinity"])("rejects malformed page locators: %s", (page) => {
    expect(parseLinkTarget(`paper.pdf#page=${page}`).target).toBeNull();
  });

  it("navigates a validated multi-line selection to its first line", () => {
    expect(parseLinkTarget("main.py#line=10-12").target).toEqual({ type: "code_line", path: "main.py", line: 10 });
    expect(parseLinkTarget("main.py#line=12-10").target).toBeNull();
    expect(parseLinkTarget("main.py#line=10-garbage").target).toBeNull();
  });

  it("parses external urls without converting them into in-app routes", () => {
    expect(parseLinkTarget("https://example.com/docs").target).toEqual({
      type: "external_url",
      url: "https://example.com/docs",
    });
  });

  it("parses same-file heading links against the current file", () => {
    expect(parseLinkTarget("#Deep Heading", { currentFilePath: "notes/demo.md" }).target).toEqual({
      type: "workspace_heading",
      path: "notes/demo.md",
      heading: "Deep Heading",
    });
  });

  it("resolves relative markdown links against the current file path", () => {
    expect(parseLinkTarget("../refs/guide.md#API", { currentFilePath: "notes/daily/today.md" }).target).toEqual({
      type: "workspace_heading",
      path: "notes/refs/guide.md",
      heading: "API",
    });
  });

  it("resolves exported source PDF links with relative paths and fragments", () => {
    expect(parseLinkTarget("../paper.pdf#page=2", { currentFilePath: "notes/a/code.md" }).target).toEqual({
      type: "pdf_page",
      path: "notes/paper.pdf",
      page: 2,
    });

    expect(parseLinkTarget("../paper.pdf#annotation=ann-1", { currentFilePath: "notes/a/code.md" }).target).toEqual({
      type: "pdf_annotation",
      path: "notes/paper.pdf",
      annotationId: "ann-1",
    });
  });

  it("resolves relative markdown headings and html files from the current document", () => {
    expect(parseLinkTarget("../source file.md#Heading One", { currentFilePath: "notes/a/code.md" }).target).toEqual({
      type: "workspace_heading",
      path: "notes/source file.md",
      heading: "Heading One",
    });

    expect(parseLinkTarget("./demo.html", { currentFilePath: "notes/a/code.md" }).target).toEqual({
      type: "workspace_file",
      path: "notes/a/demo.html",
    });
  });

  it("decodes escaped spaces in workspace links before resolving", () => {
    expect(parseLinkTarget("Daily%20Note.md#Deep%20Heading", { currentFilePath: "notes/index.md" }).target).toEqual({
      type: "workspace_heading",
      path: "notes/Daily Note.md",
      heading: "Deep Heading",
    });
  });

  it("parses PDF annotation links", () => {
    expect(parseLinkTarget("papers/math.pdf#ann-123").target).toEqual({
      type: "pdf_annotation",
      path: "papers/math.pdf",
      annotationId: "ann-123",
    });
  });

  it("parses PDF page links", () => {
    expect(parseLinkTarget("papers/math.pdf#page=12").target).toEqual({
      type: "pdf_page",
      path: "papers/math.pdf",
      page: 12,
    });
  });

  it("preserves page hints on PDF annotation links", () => {
    expect(parseLinkTarget("papers/math.pdf#page=2&annotation=ann-123").target).toEqual({
      type: "pdf_annotation",
      path: "papers/math.pdf",
      annotationId: "ann-123",
      page: 2,
    });
  });

  it("accepts ann as a PDF annotation parameter alias", () => {
    expect(parseLinkTarget("papers/math.pdf#page=2&ann=ann-123").target).toEqual({
      type: "pdf_annotation",
      path: "papers/math.pdf",
      annotationId: "ann-123",
      page: 2,
    });
  });

  it("treats bare PDF fragments as annotation ids for durable exported links", () => {
    expect(parseLinkTarget("papers/math.pdf#550e8400-e29b-41d4-a716-446655440000").target).toEqual({
      type: "pdf_annotation",
      path: "papers/math.pdf",
      annotationId: "550e8400-e29b-41d4-a716-446655440000",
    });
  });

  it("parses raw wiki link targets with aliases", () => {
    expect(parseLinkTarget("[[notes/Deep Work#Core Idea|read this]]", { currentFilePath: "index.md" }).target).toEqual({
      type: "workspace_heading",
      path: "notes/Deep Work",
      heading: "Core Idea",
    });
  });

  it("parses code line and notebook cell links", () => {
    expect(parseLinkTarget("src/main.py#line=88").target).toEqual({
      type: "code_line",
      path: "src/main.py",
      line: 88,
    });

    expect(parseLinkTarget("analysis.ipynb#cell=cell-42").target).toEqual({
      type: "notebook_cell",
      path: "analysis.ipynb",
      cellId: "cell-42",
    });
  });

  it("treats windows drive paths as system paths instead of URLs", () => {
    expect(parseLinkTarget("C:/Users/demo/file.pdf").target).toEqual({
      type: "system_path",
      path: "C:/Users/demo/file.pdf",
    });
  });
});
