import { describe, it, expect } from "vitest";
import { normalizeFormulaInput, wrapLatexForMarkdown } from "../formula-utils";

describe("formula-utils", () => {
  it("normalizes markdown inline math", () => {
    const result = normalizeFormulaInput("$x^2$");
    expect(result.latex).toBe("x^2");
    expect(result.displayMode).toBe(false);
    expect(result.source).toBe("markdown");
  });

  it("normalizes markdown block math", () => {
    const result = normalizeFormulaInput("$$E=mc^2$$");
    expect(result.latex).toBe("E=mc^2");
    expect(result.displayMode).toBe(true);
    expect(result.source).toBe("markdown");
  });

  it("normalizes bracketed math delimiters", () => {
    const inline = normalizeFormulaInput("\\(a+b\\)");
    expect(inline.latex).toBe("a+b");
    expect(inline.displayMode).toBe(false);

    const block = normalizeFormulaInput("\\[c+d\\]");
    expect(block.latex).toBe("c+d");
    expect(block.displayMode).toBe(true);
  });

  it("treats multiline inline delimiters as display mode", () => {
    const result = normalizeFormulaInput("$a\nb$");
    expect(result.latex).toBe("a\nb");
    expect(result.displayMode).toBe(true);
  });

  it("treats block environments as display mode", () => {
    const result = normalizeFormulaInput("\\begin{align}a&=b\\end{align}");
    expect(result.latex).toBe("a&=b");
    expect(result.displayMode).toBe(true);
  });

  it("wraps latex for markdown", () => {
    expect(wrapLatexForMarkdown("x", false)).toBe("$x$");
    expect(wrapLatexForMarkdown("x", true)).toBe("$$x$$");
  });
});
