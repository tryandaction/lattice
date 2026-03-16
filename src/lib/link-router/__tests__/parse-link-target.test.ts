import { describe, expect, it } from "vitest";
import { parseLinkTarget } from "../parse-link-target";

describe("parseLinkTarget", () => {
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
