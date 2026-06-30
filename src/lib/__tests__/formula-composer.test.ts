import { describe, expect, it } from "vitest";
import {
  buildFormulaClipboardText,
  buildFormulaInsertPayload,
  buildFormulaRecord,
  renameFormulaRecord,
  searchFormulaRecords,
  toggleFavoriteFormulaRecord,
  updateRecentFormulaRecords,
} from "../formula-composer";
import { FORMULA_TEMPLATES } from "../formula-templates";

describe("formula composer", () => {
  it("builds insertion payloads from structure templates for Markdown and MathLive targets", () => {
    expect(buildFormulaInsertPayload(FORMULA_TEMPLATES.fraction)).toEqual({
      latex: "\\frac{}{}",
      mathLiveLatex: "\\frac{\\placeholder{}}{\\placeholder{}}",
      markdown: "$\\frac{}{}$",
      displayMode: false,
      previewLatex: "\\frac{\\square}{\\square}",
      source: "template",
      templateId: "fraction",
    });

    expect(buildFormulaInsertPayload(FORMULA_TEMPLATES["matrix-2x2"])).toMatchObject({
      markdown: "$$\\begin{pmatrix}{}&{}\\\\{}&{}\\end{pmatrix}$$",
      displayMode: true,
      templateId: "matrix-2x2",
    });
  });

  it("normalizes arbitrary Markdown or LaTeX formulas into exportable records", () => {
    const record = buildFormulaRecord("$$\nE = mc^2\n$$", {
      label: "Energy",
    });

    expect(record).toMatchObject({
      label: "Energy",
      latex: "E = mc^2",
      markdown: "$$E = mc^2$$",
      displayMode: true,
      source: "markdown",
    });
    expect(record.id).toBe("formula:e-mc2");
  });

  it("exports formulas as raw LaTeX, inline Markdown, or display Markdown", () => {
    const record = buildFormulaRecord("\\int_0^1 x dx", { displayMode: true });

    expect(buildFormulaClipboardText(record, "latex")).toBe("\\int_0^1 x dx");
    expect(buildFormulaClipboardText(record, "markdown")).toBe("$$\\int_0^1 x dx$$");
    expect(buildFormulaClipboardText(record, "inline-markdown")).toBe("$\\int_0^1 x dx$");
    expect(buildFormulaClipboardText(record, "display-markdown")).toBe("$$\\int_0^1 x dx$$");
  });

  it("keeps recent formulas deduplicated, newest first, and bounded", () => {
    const existing = [
      buildFormulaRecord("a+b"),
      buildFormulaRecord("c+d"),
    ];

    const next = updateRecentFormulaRecords(existing, buildFormulaRecord("$a+b$"), 2);

    expect(next.map((record) => record.latex)).toEqual(["a+b", "c+d"]);
    expect(next[0].updatedAt).toBeGreaterThanOrEqual(existing[0].updatedAt);

    const bounded = updateRecentFormulaRecords(next, buildFormulaRecord("\\sqrt{x}"), 2);
    expect(bounded.map((record) => record.latex)).toEqual(["\\sqrt{x}", "a+b"]);
  });

  it("toggles favorites while preserving formula identity and timestamps", () => {
    const record = buildFormulaRecord("\\frac{a}{b}", {
      label: "Ratio",
      now: 100,
    });

    const favorite = toggleFavoriteFormulaRecord(record, 200);
    expect(favorite).toMatchObject({
      id: record.id,
      latex: "\\frac{a}{b}",
      label: "Ratio",
      favorite: true,
      createdAt: 100,
      updatedAt: 200,
    });

    const unfavorite = toggleFavoriteFormulaRecord(favorite, 300);
    expect(unfavorite.favorite).toBe(false);
    expect(unfavorite.createdAt).toBe(100);
    expect(unfavorite.updatedAt).toBe(300);
  });

  it("renames formula records without changing the reusable formula payload", () => {
    const record = buildFormulaRecord("\\sqrt{x}", { label: "Root", now: 100 });
    const renamed = renameFormulaRecord(record, "  Square root  ", 200);

    expect(renamed).toMatchObject({
      id: record.id,
      label: "Square root",
      latex: "\\sqrt{x}",
      markdown: "$\\sqrt{x}$",
      createdAt: 100,
      updatedAt: 200,
    });
  });

  it("searches formula records by label, latex, markdown, source, and favorites first", () => {
    const records = [
      buildFormulaRecord("\\alpha", { label: "Alpha", now: 100 }),
      toggleFavoriteFormulaRecord(buildFormulaRecord("\\frac{a}{b}", { label: "Ratio", now: 200 }), 220),
      buildFormulaRecord("$$\\int_0^1 x dx$$", { label: "Area", now: 300 }),
    ];

    expect(searchFormulaRecords(records, "ratio").map((record) => record.label)).toEqual(["Ratio"]);
    expect(searchFormulaRecords(records, "int").map((record) => record.label)).toEqual(["Area"]);
    expect(searchFormulaRecords(records, "markdown").map((record) => record.label)).toEqual(["Area"]);
    expect(searchFormulaRecords(records, "").map((record) => record.label)).toEqual(["Ratio", "Area", "Alpha"]);
  });
});
