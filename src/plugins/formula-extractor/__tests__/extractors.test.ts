import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  extractDocxFormulas,
  extractHtmlFormulas,
  extractMarkdownFormulas,
  extractPdfFormulasFromPages,
} from "../extractors";
import {
  exportFormulaResultsAsJson,
  exportFormulaResultsAsLatex,
  exportFormulaResultsAsMarkdown,
} from "../export";

async function createDocxWithOmml(omml: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("word/document.xml", `<w:document xmlns:w="w" xmlns:m="m"><w:body>${omml}</w:body></w:document>`);
  return await zip.generateAsync({ type: "arraybuffer" });
}

describe("formula extractor core", () => {
  it("extracts inline and block Markdown formulas while ignoring escaped dollars", () => {
    const formulas = extractMarkdownFormulas([
      "Price is \\$5, not math.",
      "Inline $E = mc^2$ works.",
      "$$",
      "\\int_0^1 x^2 dx",
      "$$",
      "Also \\(\\alpha + \\beta\\).",
    ].join("\n"));

    expect(formulas.map((formula) => formula.latex)).toEqual([
      "E = mc^2",
      "\\int_0^1 x^2 dx",
      "\\alpha + \\beta",
    ]);
    expect(formulas[1]?.displayMode).toBe(true);
  });

  it("extracts HTML formulas from MathJax/KaTeX nodes and delimiters", () => {
    const formulas = extractHtmlFormulas(`
      <span class="katex">
        <annotation encoding="application/x-tex">a^2+b^2=c^2</annotation>
      </span>
      <script type="math/tex; mode=display">\\sum_i x_i</script>
      <p>Inline \\(x+y\\)</p>
    `);

    expect(formulas.map((formula) => formula.latex)).toEqual(
      expect.arrayContaining(["a^2+b^2=c^2", "\\sum_i x_i", "x+y"]),
    );
  });

  it("extracts PDF text-layer formulas and avoids citation-only lines", () => {
    const formulas = extractPdfFormulasFromPages([
      {
        pageNumber: 2,
        text: [
          "The method follows prior work [25].",
          "H = \\sum_i \\omega_i a_i^\\dagger a_i",
          "(12)",
          "E = mc^2",
        ].join("\n"),
        visible: true,
        source: "pdfjs-text-model",
      },
    ]);

    expect(formulas.map((formula) => formula.latex)).toEqual(
      expect.arrayContaining(["H = \\sum_i \\omega_i a_i^\\dagger a_i", "E = mc^2"]),
    );
    expect(formulas.some((formula) => formula.rawText === "(12)")).toBe(false);
    expect(formulas.every((formula) => formula.page === 2)).toBe(true);
  });

  it("extracts DOCX OMML formulas and text fallback formulas", async () => {
    const arrayBuffer = await createDocxWithOmml("<m:oMath><m:r><m:t>x+y</m:t></m:r></m:oMath>");
    const formulas = await extractDocxFormulas({
      arrayBuffer,
      text: "Fallback line: F = ma",
    });

    expect(formulas.map((formula) => formula.latex)).toEqual(
      expect.arrayContaining(["x+y", "F = ma"]),
    );
  });

  it("exports formulas as Markdown, LaTeX, and JSON", () => {
    const formulas = extractMarkdownFormulas("Inline $x^2$ and $$y^2$$.");

    expect(exportFormulaResultsAsMarkdown(formulas)).toContain("$x^2$");
    expect(exportFormulaResultsAsLatex(formulas)).toContain("y^2");
    expect(JSON.parse(exportFormulaResultsAsJson(formulas))[0]).toEqual(
      expect.objectContaining({
        latex: "x^2",
        source: "md",
      }),
    );
  });
});
