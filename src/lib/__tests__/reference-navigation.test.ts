import { describe, expect, it } from "vitest";
import type { WorkspaceNavigationTarget } from "@/lib/link-router/types";
import { resolveCodeReference, resolveMarkdownReference, resolveNotebookReference } from "../reference-navigation";

describe("workspace reference navigation", () => {
  it("finds a quote spanning wrapped Markdown source lines", () => {
    expect(resolveMarkdownReference(
      { type: "workspace_text", path: "notes.md", snippet: "Evidence survives the line break." },
      [], 5, "# Results\r\n\r\nEvidence survives\r\nthe line break.\r\nEnd",
    )).toEqual({ status: "success", line: 3, range: { from: 13, to: 47 } });
  });

  it("does not navigate an empty quote to the first line", () => {
    expect(resolveMarkdownReference(
      { type: "workspace_text", path: "notes.md", snippet: "   " }, [], 2, "Intro\nEnd",
    )).toEqual({ status: "quote_not_found" });
  });

  it("resolves valid Markdown headings and reports missing headings", () => {
    const target: WorkspaceNavigationTarget = {
      type: "workspace_heading",
      path: "notes/demo.md",
      heading: "Methods",
    };
    const outline = [{ text: "Methods", line: 6 }];

    expect(resolveMarkdownReference(target, outline, 10)).toEqual({ status: "success", line: 6 });
    expect(resolveMarkdownReference({ ...target, heading: "Missing" }, outline, 10)).toEqual({ status: "quote_not_found" });
  });

  it("resolves a real Markdown paragraph or quote snippet to its source line", () => {
    expect(resolveMarkdownReference(
      { type: "workspace_text", path: "notes/demo.md", snippet: "quoted evidence" },
      [],
      4,
      "Intro\n> quoted evidence\n\nConclusion",
    )).toEqual({ status: "success", line: 2, range: { from: 8, to: 23 } });
  });

  it("rejects code lines outside the real document range", () => {
    expect(resolveCodeReference({ type: "code_line", path: "src/demo.ts", line: 3 }, 3)).toEqual({ status: "success", line: 3 });
    expect(resolveCodeReference({ type: "code_line", path: "src/demo.ts", line: 4 }, 3)).toEqual({ status: "quote_not_found" });
  });

  it.each(["script.py", "notes.txt"])("locates only the quoted span in %s", (path) => {
    expect(resolveCodeReference({ type: "workspace_text", path, snippet: "return x - y" }, 3,
      "def difference(x, y):\n    return x - y\n")).toEqual({ status: "success", line: 2, range: { from: 26, to: 38 } });
  });

  it("rejects missing, ambiguous, and altered code quotes", () => {
    for (const snippet of ["", "return x y", "return x + y", "return"]) {
      expect(resolveCodeReference({ type: "workspace_text", path: "script.py", snippet }, 2,
        "return x - y\nreturn z")).toEqual({ status: "quote_not_found" });
    }
  });

  it("resolves Notebook cells only when the real cell id exists", () => {
    expect(resolveNotebookReference({ type: "notebook_cell", path: "demo.ipynb", cellId: "cell-2" }, ["cell-1", "cell-2"])).toEqual({ status: "success", cellId: "cell-2" });
    expect(resolveNotebookReference({ type: "notebook_cell", path: "demo.ipynb", cellId: "missing" }, ["cell-1", "cell-2"])).toEqual({ status: "quote_not_found" });
  });
});
