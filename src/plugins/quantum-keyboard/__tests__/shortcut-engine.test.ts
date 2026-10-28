import { describe, expect, it } from "vitest";
import { resolveControlFormulaChord } from "../shortcut-engine";

describe("compact physical formula chords", () => {
  it.each([
    ["1", "\\int"],
    ["2", "\\iint"],
    ["3", "\\iiint"],
    ["0", "\\oint"],
    ["20", "\\oiint"],
    ["30", "\\oiiint"],
  ])("maps Ctrl+I+%s to its integral family", (digits, latex) => {
    expect(resolveControlFormulaChord("KeyI", digits)).toEqual({ kind: "formula", latex });
  });

  it("maps one matrix digit to a square and two digits to rows times columns", () => {
    expect(resolveControlFormulaChord("KeyM", "3")).toEqual({ kind: "matrix", rows: 3, columns: 3 });
    expect(resolveControlFormulaChord("KeyM", "34")).toEqual({ kind: "matrix", rows: 3, columns: 4 });
  });

  it("rejects unsupported keys, sizes, and extra digits", () => {
    expect(resolveControlFormulaChord("KeyM", "0")).toBeNull();
    expect(resolveControlFormulaChord("KeyM", "34")).not.toBeNull();
    expect(resolveControlFormulaChord("KeyM", "123")).toBeNull();
    expect(resolveControlFormulaChord("KeyI", "4")).toBeNull();
    expect(resolveControlFormulaChord("KeyF", "2")).toBeNull();
  });
});
