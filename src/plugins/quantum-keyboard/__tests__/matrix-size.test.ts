import { describe, expect, it } from "vitest";
import { buildMatrixLatex, parseMatrixSize, parseMatrixTemplate } from "../matrix-size";

describe("matrix size input", () => {
  it("parses a row and column pair from numeric fields", () => {
    expect(parseMatrixSize("3", "4")).toEqual({ rows: 3, columns: 4 });
  });

  it("builds a matrix with one editable placeholder per cell", () => {
    const latex = buildMatrixLatex("pmatrix", 3, 4);
    expect(latex).toBe("\\begin{pmatrix}{}&{}&{}&{}\\\\{}&{}&{}&{}\\\\{}&{}&{}&{}\\end{pmatrix}");
    expect((latex.match(/\{\}/g) ?? [])).toHaveLength(12);
  });

  it("rejects missing, fractional, zero, and oversized dimensions", () => {
    expect(parseMatrixSize("", "4")).toBeNull();
    expect(parseMatrixSize("2.5", "4")).toBeNull();
    expect(parseMatrixSize("0", "4")).toBeNull();
    expect(parseMatrixSize("21", "4")).toBeNull();
    expect(parseMatrixSize("2e0", "4")).toBeNull();
    expect(parseMatrixSize("0x3", "4")).toBeNull();
  });

  it("recognizes empty matrix templates and preserves their style and default dimensions", () => {
    expect(parseMatrixTemplate(String.raw`\begin{bmatrix}{}&{}&{}\\{}&{}&{}\end{bmatrix}`))
      .toEqual({ environment: "bmatrix", rows: 2, columns: 3 });
    expect(parseMatrixTemplate(String.raw`\begin{Bmatrix}{}\end{Bmatrix}`))
      .toEqual({ environment: "Bmatrix", rows: 1, columns: 1 });
  });

  it("leaves populated formulas, nested matrices and piecewise cases unchanged", () => {
    expect(parseMatrixTemplate(String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`)).toBeNull();
    expect(parseMatrixTemplate(String.raw`A=\begin{pmatrix}{}&{}\end{pmatrix}`)).toBeNull();
    expect(parseMatrixTemplate(String.raw`\begin{cases}{}&{}\\{}&{}\end{cases}`)).toBeNull();
  });

  it("rejects unsupported environments and invalid programmatic dimensions", () => {
    expect(() => buildMatrixLatex("pmatrix", 0, 4)).toThrow(RangeError);
    expect(() => buildMatrixLatex("unknown", 3, 4)).toThrow(RangeError);
  });
});
