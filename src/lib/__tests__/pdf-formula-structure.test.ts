import { describe, expect, it } from "vitest";
import katex from "katex";
import { inferPdfFormulaFromSelection, type PdfFormulaGlyph } from "../pdf-formula-structure";

const glyph = (text: string, x: number, y: number, width = 10, height = 20): PdfFormulaGlyph => ({
  text, x1: x, y1: y, x2: x + width, y2: y + height,
});
const line = (text: string, x: number, y: number, size = 20) =>
  [...text].map((char, index) => glyph(char, x + index * size / 2, y, size / 2, size));
const infer = (chars: PdfFormulaGlyph[], text = chars.map((char) => char.text).join("")) =>
  inferPdfFormulaFromSelection({ text, chars, rects: chars.map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 })) });

function expectReady(chars: PdfFormulaGlyph[], latex: string, text?: string) {
  const result = infer(chars, text);
  expect(result.status, result.reason).toBe("ready");
  expect(result.latex).toBe(latex);
  expect(() => katex.renderToString(result.latex!, { throwOnError: true, strict: "error" })).not.toThrow();
  expect(result.rects).toEqual([result.bounds]);
  return result;
}

describe("inferPdfFormulaFromSelection", () => {
  it("uses actual raised and lowered glyph geometry for scripts", () => {
    expectReady([glyph("x", 10, 20), glyph("2", 20, 9, 6, 12), glyph("+", 36, 20),
      glyph("y", 52, 20), glyph("i", 62, 33, 6, 12), glyph("=", 80, 20), glyph("z", 98, 20)],
    "x^{2}+y_{i}=z");
  });

  it("does not invent subscripts for same-baseline digits", () => {
    expectReady(line("x2=y", 10, 20), "x2=y");
  });

  it("restores a fraction only when a visible rule supports it", () => {
    expectReady([glyph("f", 10, 25), glyph("=", 25, 25), glyph("α", 48, 10, 8, 16),
      glyph("−", 44, 34, 18, 1), glyph("2", 48, 40, 8, 16)], "f=\\frac{\\alpha}{2}");
  });

  it("keeps unsupported stacked text for review when the rule is absent", () => {
    const chars = [glyph("f", 10, 25), glyph("=", 25, 25), glyph("α", 48, 10, 8, 16), glyph("2", 48, 40, 8, 16)];
    const result = infer(chars);
    expect(result.status).toBe("needs-review");
    expect(result.latex).toBeUndefined();
    expect(result.rects).toHaveLength(chars.length);
  });

  it("restores Greek letters, combining macrons, and semantic hbar without guessing words", () => {
    expectReady([glyph("Ω", 10, 20), glyph("=", 27, 20), glyph("x̄", 43, 20),
      glyph("+", 60, 20), glyph("ℏ", 77, 20)], "\\Omega=\\bar{x}+\\hbar");
  });

  it("attaches a separate macron glyph to its base", () => {
    expectReady([glyph("x", 10, 20), glyph("¯", 10, 14, 10, 2), glyph("=", 28, 20), glyph("y", 46, 20)], "\\bar{x}=y");
  });

  it("recovers a two-by-two matrix inside scalable delimiters", () => {
    expectReady([glyph("M", 0, 25), glyph("=", 16, 25), glyph("(", 35, 0, 7, 70),
      glyph("a", 53, 8), glyph("b", 103, 8), glyph("c", 53, 42), glyph("d", 103, 42),
      glyph(")", 123, 0, 7, 70)], "M=\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}");
  });

  it("recovers a three-by-three matrix from common column gaps across every row", () => {
    expectReady([
      glyph("M", 0, 42), glyph("=", 16, 42), glyph("(", 35, 0, 7, 105), glyph(")", 173, 0, 7, 105),
      glyph("a", 53, 8), glyph("b", 103, 8), glyph("c", 153, 8),
      glyph("d", 53, 42), glyph("e", 103, 42), glyph("f", 153, 42),
      glyph("g", 53, 76), glyph("h", 103, 76), glyph("i", 153, 76),
    ], "M=\\begin{pmatrix}a & b & c \\\\ d & e & f \\\\ g & h & i\\end{pmatrix}");
  });

  it("recovers a rectangular two-by-three matrix without inventing a missing cell", () => {
    expectReady([
      glyph("M", 0, 25), glyph("=", 16, 25), glyph("[", 35, 0, 7, 70), glyph("]", 173, 0, 7, 70),
      glyph("a", 53, 8), glyph("b", 103, 8), glyph("c", 153, 8),
      glyph("d", 53, 42), glyph("e", 103, 42), glyph("f", 153, 42),
    ], "M=\\begin{bmatrix}a & b & c \\\\ d & e & f\\end{bmatrix}");
  });

  it("keeps an irregular matrix layout under review when a row has a different column count", () => {
    const chars = [
      glyph("M", 0, 42), glyph("=", 16, 42), glyph("(", 35, 0, 7, 105), glyph(")", 173, 0, 7, 105),
      glyph("a", 53, 8), glyph("b", 103, 8), glyph("c", 153, 8),
      glyph("d", 53, 42), glyph("e", 103, 42),
      glyph("f", 53, 76), glyph("g", 103, 76), glyph("h", 153, 76),
    ];
    expect(infer(chars).status).toBe("needs-review");
    expect(infer(chars).latex).toBeUndefined();
  });

  it('includes matrix cells above a PDF scalable delimiter font box when their centers remain within half an em', () => {
    expectReady([glyph('M',337,202.706,14.994,18),glyph('=',359,202.706,10.152,18),
      glyph('(',383,197.533,16.317,49),glyph(')',468,197.533,16.317,49),
      glyph('a',406,182.072,8,16),glyph('b',446,182.072,8,16),
      glyph('c',406,213.072,7.104,16),glyph('d',446,213.072,8,16)],
    'M=\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}');
  });

  it("restores scientific matrix fractions and scripts without relying on formula text order", () => {
    const chars = [
      glyph("H", 3, 38, 8, 16), glyph("R", 11, 48, 5, 10), glyph("b", 16, 48, 5, 10),
      glyph("−", 0, 63, 26, 1), glyph("h", 9, 70, 8, 16), glyph("=", 34, 53),
      glyph("(", 52, 0, 8, 130), glyph(")", 266, 0, 8, 130),
      glyph("0", 95, 25),
      glyph("Ω", 185, 8, 8, 16), glyph("R", 193, 19, 5, 10), glyph("b", 198, 19, 5, 10),
      glyph("e", 208, 8, 8, 16), ...line("−iφ", 216, 0, 10), glyph("−", 179, 34, 63, 1), glyph("2", 208, 41, 8, 16),
      glyph("Ω", 76, 80, 8, 16), glyph("R", 84, 91, 5, 10), glyph("b", 89, 91, 5, 10),
      glyph("e", 99, 80, 8, 16), ...line("iφ", 107, 72, 10), glyph("−", 70, 106, 63, 1), glyph("2", 99, 113, 8, 16),
      ...line("−i", 207, 80, 16), glyph("−", 175, 106, 82, 1),
      ...line("4πτ", 180, 113, 16), ...line("Rb,56S", 204, 123, 10),
    ];
    expectReady(chars.reverse(), "\\frac{H_{Rb}}{h}=\\begin{pmatrix}0 & \\frac{\\Omega_{Rb}e^{-i\\phi}}{2} \\\\ \\frac{\\Omega_{Rb}e^{i\\phi}}{2} & \\frac{-i}{4\\pi\\tau_{Rb,56S}}\\end{pmatrix}");
  });

  it("excludes a distant equation number from formula output and bounding box", () => {
    const result = expectReady([...line("x=y", 10, 20), ...line("(12)", 150, 20)], "x=y");
    expect(result.bounds).toEqual({ x1: 10, y1: 20, x2: 40, y2: 40 });
  });

  it("does not remove nearby numeric parentheses that belong to the formula", () => {
    expectReady(line("f(x)=g(12)", 10, 20), "f(x)=g(12)");
  });

  it("rejects prose containing an inline equation without merging paragraph rectangles", () => {
    const chars = line("The result x = y follows from the method.", 0, 20);
    const result = infer(chars);
    expect(result.status).toBe("unavailable");
    expect(result.latex).toBeUndefined();
    expect(result.rects).toHaveLength(chars.length);
  });

  it("does not merge mathematical content from separate columns", () => {
    const result = infer([...line("a=b", 0, 20), ...line("c=d", 300, 20)]);
    expect(result.status).toBe("needs-review");
    expect(result.latex).toBeUndefined();
    expect(result.rects).toHaveLength(6);
  });

  it("does not treat arbitrary multiline equations as an exact matrix", () => {
    const result = infer([...line("a=b", 0, 10), ...line("c=d", 0, 60)]);
    expect(result.status).toBe("needs-review");
    expect(result.latex).toBeUndefined();
  });

  it("fails safely for missing or invalid glyph geometry", () => {
    expect(inferPdfFormulaFromSelection({ text: "x=y", chars: [], rects: [] }).status).toBe("needs-review");
    expect(infer([glyph("x", Number.NaN, 0), glyph("=", 20, 0)]).status).toBe("needs-review");
    expect(inferPdfFormulaFromSelection({ text: "", chars: [], rects: [] }).status).toBe("unavailable");
  });

  it("does not mutate caller geometry or depend on coordinate scale", () => {
    const chars = [glyph("x", 10, 20), glyph("2", 20, 9, 6, 12), glyph("=", 40, 20), glyph("y", 60, 20)];
    const before = structuredClone(chars);
    const scaled = chars.map((char) => ({ text: char.text, x1: char.x1 / 1000, x2: char.x2 / 1000, y1: char.y1 / 1000, y2: char.y2 / 1000 }));
    expect(infer(scaled).latex).toBe("x^{2}=y");
    expect(infer(chars).latex).toBe("x^{2}=y");
    expect(chars).toEqual(before);
  });

  it("refuses a reliable result when selected text contains missing glyphs", () => {
    const result = infer(line("x=y", 10, 20), "x=y+z");
    expect(result.status).toBe("needs-review");
    expect(result.latex).toBeUndefined();
  });

  it.each(["x=", "=y", "x+", "x/", "x==y", "x+*y"])("rejects incomplete or malformed expression %s", (source) => {
    const result = infer(line(source, 10, 20));
    expect(result.status).toBe("needs-review");
    expect(result.latex).toBeUndefined();
  });

  it("does not emit bare structural underscores as reliable TeX", () => {
    const result = infer(line("x_=y", 10, 20));
    expect(result.status).toBe("needs-review");
    expect(result.latex).toBeUndefined();
  });

  it("checks unmatched delimiters even within a multi-character glyph run", () => {
    const result = infer([glyph("x=(y", 10, 20, 40)]);
    expect(result.status).toBe("needs-review");
    expect(result.latex).toBeUndefined();
  });

  it("does not guess a radical span or a malformed matrix", () => {
    expect(infer(line("y=√x+1", 10, 20)).status).toBe("needs-review");
    expect(infer([glyph("M", 0, 25), glyph("=", 16, 25), glyph("(", 35, 0, 7, 70),
      glyph("a", 53, 8), glyph("b", 103, 8), glyph("c", 53, 42), glyph(")", 123, 0, 7, 70)]).status).toBe("needs-review");
  });

  it("preserves a single stacked fraction within scalable parentheses", () => {
    expectReady([glyph("f", 0, 25), glyph("=", 14, 25), glyph("(", 29, 5, 6, 55),
      glyph("a", 44, 10, 8, 16), glyph("−", 39, 34, 18, 1), glyph("b", 44, 40, 8, 16),
      glyph(")", 62, 5, 6, 55)], "f=\\left(\\frac{a}{b}\\right)");
  });

  it("keeps simultaneous subscript and superscript on one base", () => {
    expectReady([glyph("x", 10, 20), glyph("i", 20, 33, 6, 12), glyph("2", 20, 9, 6, 12),
      glyph("=", 40, 20), glyph("y", 60, 20)], "x_{i}^{2}=y");
  });
});
