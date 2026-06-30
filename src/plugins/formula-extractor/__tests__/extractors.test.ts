import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  extractDocxFormulas,
  extractFormulasFromSource,
  extractHtmlFormulas,
  extractMarkdownFormulas,
  extractPdfFormulasFromPages,
} from "../extractors";
import {
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
      expect.arrayContaining(["a^2 + b^2 = c^2", "\\sum_i x_i", "x + y"]),
    );
  });

  it("extracts PDF text-layer formulas from geometry items and avoids citation-only lines", () => {
    const formulas = extractPdfFormulasFromPages([
      {
        pageNumber: 2,
        text: [
          "The method follows prior work [25].",
          "This paragraph has several ordinary words and ends like prose.",
          "H = \\sum_i \\omega_i a_i^\\dagger a_i",
          "(12)",
          "[3, 4]",
          "E = mc^2",
        ].join("\n"),
        visible: true,
        source: "pdfjs-text-model",
        items: [
          {
            text: "The method follows prior work [25].",
            normalizedText: "The method follows prior work [25].",
            lineIndex: 0,
            blockIndex: 0,
            bbox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.12 },
          },
          {
            text: "H = \\sum_i \\omega_i a_i^\\dagger a_i",
            normalizedText: "H = \\sum_i \\omega_i a_i^\\dagger a_i",
            lineIndex: 1,
            blockIndex: 1,
            bbox: { x1: 0.22, y1: 0.3, x2: 0.62, y2: 0.34 },
          },
          {
            text: "(12)",
            normalizedText: "(12)",
            lineIndex: 2,
            blockIndex: 2,
            bbox: { x1: 0.8, y1: 0.3, x2: 0.84, y2: 0.34 },
          },
          {
            text: "E = mc^2",
            normalizedText: "E = mc^2",
            lineIndex: 3,
            blockIndex: 3,
            bbox: { x1: 0.22, y1: 0.42, x2: 0.35, y2: 0.46 },
          },
        ],
      },
    ]);

    expect(formulas.map((formula) => formula.latex)).toEqual(
      expect.arrayContaining(["H = \\sum_i \\omega_i a_i^\\dagger a_i", "E = mc^2"]),
    );
    expect(formulas.some((formula) => formula.rawText === "(12)")).toBe(false);
    expect(formulas.some((formula) => formula.rawText.includes("ordinary words"))).toBe(false);
    expect(formulas.some((formula) => formula.rawText === "[3, 4]")).toBe(false);
    expect(formulas.every((formula) => formula.page === 2)).toBe(true);
  });

  it("extracts PDF item lines with bbox targets for click-to-locate", () => {
    const formulas = extractPdfFormulasFromPages([
      {
        pageNumber: 7,
        text: "The model uses\nE = \\hbar \\omega",
        visible: true,
        source: "rendered-text-layer",
        items: [
          {
            text: "The model uses",
            normalizedText: "The model uses",
            lineIndex: 0,
            blockIndex: 0,
            bbox: { x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.12 },
          },
          {
            text: "E = ",
            normalizedText: "E =",
            lineIndex: 1,
            blockIndex: 1,
            bbox: { x1: 0.25, y1: 0.3, x2: 0.32, y2: 0.33 },
          },
          {
            text: "\\hbar \\omega",
            normalizedText: "\\hbar \\omega",
            lineIndex: 1,
            blockIndex: 1,
            bbox: { x1: 0.32, y1: 0.29, x2: 0.52, y2: 0.34 },
          },
        ],
      },
    ]);

    expect(formulas).toHaveLength(1);
    expect(formulas[0]).toEqual(
      expect.objectContaining({
        latex: "E = \\hbar \\omega",
        page: 7,
        bbox: { x1: 0.25, y1: 0.29, x2: 0.52, y2: 0.34 },
        target: expect.objectContaining({
          page: 7,
          bbox: { x1: 0.25, y1: 0.29, x2: 0.52, y2: 0.34 },
        }),
      }),
    );
  });

  it("extracts Saffman-style physics formulas from PDF geometry fragments", () => {
    const formulas = extractPdfFormulasFromPages([
      {
        pageNumber: 5,
        text: "",
        visible: true,
        source: "pdfjs-text-model",
        items: [
          {
            text: "E",
            normalizedText: "E",
            lineIndex: 0,
            blockIndex: 0,
            columnIndex: 0,
            bbox: { x1: 0.22, y1: 0.22, x2: 0.24, y2: 0.245 },
          },
          {
            text: "nlj",
            normalizedText: "nlj",
            lineIndex: 0,
            blockIndex: 0,
            columnIndex: 0,
            bbox: { x1: 0.24, y1: 0.238, x2: 0.275, y2: 0.255 },
          },
          {
            text: " = - Ry / [n - δj(n)]²",
            normalizedText: " = - Ry / [n - δj(n)]²",
            lineIndex: 0,
            blockIndex: 0,
            columnIndex: 0,
            bbox: { x1: 0.28, y1: 0.218, x2: 0.5, y2: 0.252 },
          },
          {
            text: "⟨r′n′l′j′ | r | rnlj⟩",
            normalizedText: "⟨r′n′l′j′ | r | rnlj⟩",
            lineIndex: 1,
            blockIndex: 1,
            columnIndex: 0,
            bbox: { x1: 0.19, y1: 0.64, x2: 0.35, y2: 0.68 },
          },
          {
            text: " = ∫ r Pn′l′(r) Pnl(r) dr",
            normalizedText: " = ∫ r Pn′l′(r) Pnl(r) dr",
            lineIndex: 1,
            blockIndex: 1,
            columnIndex: 0,
            bbox: { x1: 0.36, y1: 0.638, x2: 0.58, y2: 0.682 },
          },
          {
            text: "1/τnl = 1/τnl(0) + 1/τnl(bb)",
            normalizedText: "1/τnl = 1/τnl(0) + 1/τnl(bb)",
            lineIndex: 2,
            blockIndex: 2,
            columnIndex: 1,
            bbox: { x1: 0.63, y1: 0.42, x2: 0.86, y2: 0.46 },
          },
          {
            text: "The radial matrix elements can be calculated numerically.",
            normalizedText: "The radial matrix elements can be calculated numerically.",
            lineIndex: 3,
            blockIndex: 3,
            columnIndex: 0,
            bbox: { x1: 0.12, y1: 0.7, x2: 0.48, y2: 0.73 },
          },
        ],
      },
    ]);

    expect(formulas.length).toBeGreaterThanOrEqual(3);
    expect(formulas.map((formula) => formula.latex)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Ry"),
        expect.stringContaining("\\int"),
        expect.stringContaining("\\tau"),
      ]),
    );
    expect(formulas.some((formula) => formula.rawText.includes("radial matrix elements can be calculated"))).toBe(false);
    expect(formulas.every((formula) => formula.page === 5)).toBe(true);
    expect(formulas.every((formula) => formula.target?.bbox)).toBe(true);
  });

  it("extracts centered multi-line Hamiltonian formulas from PDF text geometry", async () => {
    const result = await extractFormulasFromSource({
      viewerType: "pdf",
      scope: "current-page",
      pdfPages: [
        {
          pageNumber: 6,
          text: "",
          visible: true,
          source: "pdfjs-text-model",
          items: [
            {
              text: "time-dependent Hamiltonian for each initial state is given by",
              normalizedText: "time-dependent Hamiltonian for each initial state is given by",
              lineIndex: 0,
              blockIndex: 0,
              bbox: { x1: 0.12, y1: 0.12, x2: 0.74, y2: 0.15 },
            },
            {
              text: "H",
              normalizedText: "H",
              lineIndex: 1,
              blockIndex: 1,
              bbox: { x1: 0.25, y1: 0.20, x2: 0.27, y2: 0.23 },
            },
            {
              text: "00",
              normalizedText: "00",
              lineIndex: 1,
              blockIndex: 1,
              bbox: { x1: 0.27, y1: 0.222, x2: 0.295, y2: 0.24 },
            },
            {
              text: "(t) =",
              normalizedText: "(t) =",
              lineIndex: 1,
              blockIndex: 1,
              bbox: { x1: 0.30, y1: 0.20, x2: 0.36, y2: 0.23 },
            },
            {
              text: "(1 + ε)Ω(t)e",
              normalizedText: "(1 + ε)Ω(t)e",
              lineIndex: 1,
              blockIndex: 1,
              bbox: { x1: 0.37, y1: 0.19, x2: 0.49, y2: 0.218 },
            },
            {
              text: "iφ(t)",
              normalizedText: "iφ(t)",
              lineIndex: 1,
              blockIndex: 1,
              bbox: { x1: 0.49, y1: 0.175, x2: 0.53, y2: 0.196 },
            },
            {
              text: "2",
              normalizedText: "2",
              lineIndex: 1,
              blockIndex: 1,
              bbox: { x1: 0.435, y1: 0.222, x2: 0.45, y2: 0.242 },
            },
            {
              text: "(|0r′⟩⟨00| + |r′0⟩⟨00|) + h.c.",
              normalizedText: "(|0r′⟩⟨00| + |r′0⟩⟨00|) + h.c.",
              lineIndex: 1,
              blockIndex: 1,
              bbox: { x1: 0.54, y1: 0.20, x2: 0.85, y2: 0.235 },
            },
            {
              text: "+ Δr(|0r′⟩⟨0r′| + |r′0⟩⟨r′0|),",
              normalizedText: "+ Δr(|0r′⟩⟨0r′| + |r′0⟩⟨r′0|),",
              lineIndex: 2,
              blockIndex: 1,
              bbox: { x1: 0.40, y1: 0.265, x2: 0.76, y2: 0.30 },
            },
            {
              text: "H",
              normalizedText: "H",
              lineIndex: 3,
              blockIndex: 2,
              bbox: { x1: 0.22, y1: 0.36, x2: 0.24, y2: 0.39 },
            },
            {
              text: "11",
              normalizedText: "11",
              lineIndex: 3,
              blockIndex: 2,
              bbox: { x1: 0.24, y1: 0.382, x2: 0.265, y2: 0.40 },
            },
            {
              text: "(t) =",
              normalizedText: "(t) =",
              lineIndex: 3,
              blockIndex: 2,
              bbox: { x1: 0.27, y1: 0.36, x2: 0.33, y2: 0.39 },
            },
            {
              text: "(1 + ε)Ω(t)e^{iφ(t)} / 2 (|1r′⟩⟨11| + |r′1⟩⟨11|) + h.c.,",
              normalizedText: "(1 + ε)Ω(t)e^{iφ(t)} / 2 (|1r′⟩⟨11| + |r′1⟩⟨11|) + h.c.,",
              lineIndex: 3,
              blockIndex: 2,
              bbox: { x1: 0.34, y1: 0.355, x2: 0.83, y2: 0.395 },
            },
            {
              text: "where T is the gate duration. To realize a CZ gate, we require the",
              normalizedText: "where T is the gate duration. To realize a CZ gate, we require the",
              lineIndex: 4,
              blockIndex: 3,
              bbox: { x1: 0.12, y1: 0.46, x2: 0.80, y2: 0.49 },
            },
            {
              text: "θ11 = 2θ01 − θ00 + π.",
              normalizedText: "θ11 = 2θ01 − θ00 + π.",
              lineIndex: 5,
              blockIndex: 4,
              bbox: { x1: 0.42, y1: 0.54, x2: 0.63, y2: 0.575 },
            },
          ],
        },
      ],
    });

    expect(result.formulas.length).toBeGreaterThanOrEqual(3);
    expect(result.formulas.map((formula) => formula.latex)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("H_{00}"),
        expect.stringContaining("H_{11}"),
        expect.stringContaining("\\theta_{11}"),
      ]),
    );
    expect(result.formulas.every((formula) => formula.target?.page === 6)).toBe(true);
    expect(result.formulas.every((formula) => formula.target?.bbox)).toBe(true);
    expect(exportFormulaResultsAsMarkdown(result.formulas)).toContain("H_{00}");
    expect(exportFormulaResultsAsLatex(result.formulas)).toContain("\\theta_{11}");
  });

  it("keeps conservative PDF selection heuristic results reviewable", async () => {
    const result = await extractFormulasFromSource({
      viewerType: "pdf",
      scope: "selection",
      selectionText: "Hamiltonian: H = p^2 / 2m + V(x)",
      pdfPages: [
      {
        pageNumber: 4,
        text: "Hamiltonian: H = p^2 / 2m + V(x)",
        visible: true,
        source: "rendered-text-layer",
      },
      ],
    });
    const formulas = result.formulas;

    expect(formulas).toHaveLength(1);
    expect(formulas[0]).toEqual(
      expect.objectContaining({
        latex: "H = p^2 / 2m + V(x)",
        needsReview: true,
        page: 4,
      }),
    );
  });

  it("rejects Saffman-style prose paragraphs as PDF formula candidates", () => {
    const page = {
      pageNumber: 7,
      text: "",
      visible: true,
      source: "pdfjs-text-model" as const,
      items: [
        {
          text: "Quantum information with Rydberg atoms et al.50\\leftrightarrow, and gates with delocal - interactions, but to date only the quantum 1 CNOT, 2009 K are sufficient for a. Many - particle entanglement mediated by collisions observed in optical lattice based experiments.",
          normalizedText: "Quantum information with Rydberg atoms et al.50\\leftrightarrow, and gates with delocal - interactions, but to date only the quantum 1 CNOT, 2009 K are sufficient for a. Many - particle entanglement mediated by collisions observed in optical lattice based experiments.",
          lineIndex: 0,
          blockIndex: 0,
          bbox: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.5 },
        },
      ],
    };
    const formulas = extractPdfFormulasFromPages([page]);

    expect(formulas).toHaveLength(0);
  });

  it("rejects PDF caption fragments and DOI metadata as formulas", async () => {
    const result = await extractFormulasFromSource({
      viewerType: "pdf",
      scope: "document",
      pdfPages: [
        {
          pageNumber: 19,
          text: "",
          visible: true,
          source: "pdfjs-text-model",
          items: [
            {
              text: "thepreparationcircuit.(b)| + + \\rangle fracpi2)gates",
              normalizedText: "thepreparationcircuit.(b)| + + \\rangle fracpi2)gates",
              lineIndex: 0,
              blockIndex: 0,
              bbox: { x1: 0.22, y1: 0.42, x2: 0.74, y2: 0.49 },
            },
            {
              text: "the preparation circuit. (b)| + +)L can be prepared by adding extra R y (π /2) gates",
              normalizedText: "the preparation circuit. (b)| + +)L can be prepared by adding extra R y (π /2) gates",
              lineIndex: 1,
              blockIndex: 0,
              bbox: { x1: 0.12, y1: 0.52, x2: 0.86, y2: 0.56 },
            },
            {
              text: "Article https://doi.org/10.1038/s41567-026-03309-0",
              normalizedText: "Article https://doi.org/10.1038/s41567-026-03309-0",
              lineIndex: 2,
              blockIndex: 1,
              bbox: { x1: 0.1, y1: 0.7, x2: 0.72, y2: 0.74 },
            },
          ],
        },
      ],
    });

    expect(result.formulas).toHaveLength(0);
    expect(result.hiddenCandidates?.map((candidate) => candidate.rawText)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("thepreparationcircuit"),
        expect.stringContaining("doi.org/10.1038"),
      ]),
    );
  });

  it("keeps rejected PDF prose in hidden diagnostics instead of the main formula list", async () => {
    const result = await extractFormulasFromSource({
      viewerType: "pdf",
      scope: "document",
      pdfPages: [
      {
        pageNumber: 7,
        text: "",
        visible: true,
        source: "pdfjs-text-model",
        items: [
          {
            text: "Quantum information with Rydberg atoms et al.50\\leftrightarrow, and gates with delocal - interactions, but to date only the quantum 1 CNOT, 2009 K are sufficient for a. Many - particle entanglement mediated by collisions observed in optical lattice based experiments.",
            normalizedText: "Quantum information with Rydberg atoms et al.50\\leftrightarrow, and gates with delocal - interactions, but to date only the quantum 1 CNOT, 2009 K are sufficient for a. Many - particle entanglement mediated by collisions observed in optical lattice based experiments.",
            lineIndex: 0,
            blockIndex: 0,
            bbox: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.5 },
          },
        ],
      },
      ],
    });

    expect(result.formulas).toHaveLength(0);
    expect(result.hiddenCandidates?.[0]).toEqual(
      expect.objectContaining({
        reason: "too-long",
        page: 7,
      }),
    );
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

  it("exports formulas as Markdown and LaTeX", () => {
    const formulas = extractMarkdownFormulas("Inline $x^2$ and $$y^2$$.");

    expect(exportFormulaResultsAsMarkdown(formulas)).toContain("$x^2$");
    expect(exportFormulaResultsAsLatex(formulas)).toContain("y^2");
  });
});
