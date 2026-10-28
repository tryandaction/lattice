import { describe, expect, it } from "vitest";
import katex from "katex";
import { validateLatex } from "mathlive/ssr";
import { buildQuantumCatalog, CATALOG_CATEGORIES, portableQuantumLatex, previewQuantumLatex } from "../catalog";

describe("portable professional formula presets", () => {
  it("offers chemistry as a browsable category with editable formulas", () => {
    expect(CATALOG_CATEGORIES.some(category => category.id === "chemistry")).toBe(true);
    expect(buildQuantumCatalog().filter(entry => entry.category === "chemistry" && entry.latex.includes("="))).not.toHaveLength(0);
  });

  it("renders and parses each professional formula without extension macros", () => {
    const formulas = buildQuantumCatalog().filter(entry => entry.layer === "ctrl");
    expect(formulas.length).toBeGreaterThan(0);
    for (const entry of formulas) {
      const latex = portableQuantumLatex(entry.latex);
      expect(latex, entry.nameEn).not.toMatch(/\\\\/);
      expect(latex, entry.nameEn).not.toContain("\\\\");
      expect(latex, entry.nameEn).not.toMatch(/\\(?:ce|pu|chemfig|qty|dv|pdv)\b/);
      expect(() => katex.renderToString(previewQuantumLatex(latex), { throwOnError: true }), entry.nameEn).not.toThrow();
      expect(validateLatex(latex), entry.nameEn).toEqual([]);
    }
  });

  it("keeps wide professional equations readable on compact physical keys", () => {
    const entries = buildQuantumCatalog();
    expect(entries.find(entry => entry.nameEn === "Bayes theorem")?.shortLabel).toEqual({ zh: "贝叶斯", en: "Bayes" });
    expect(entries.find(entry => entry.nameEn === "Nernst equation")?.shortLabel).toEqual({ zh: "能斯特", en: "Nernst" });
    expect(entries.find(entry => entry.nameEn === "Arrhenius equation")?.shortLabel).toEqual({ zh: "阿伦尼乌斯", en: "Arrhenius" });
    expect(entries.find(entry => entry.nameEn === "Ideal gas law")?.shortLabel).toEqual({ zh: "理想气体", en: "Ideal gas" });
  });
});
