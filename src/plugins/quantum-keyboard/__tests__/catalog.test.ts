import { describe, expect, it } from "vitest";
import { getAllQuantumLayerMeanings, getCandidateSymbol, quantumKeyboardMap } from "@/config/quantum-keymap";
import { buildQuantumCatalog, searchQuantumCatalog, previewQuantumLatex } from "../catalog";
import { getQuickFormulaTemplates } from "@/lib/formula-templates";

describe("visible quantum formula catalog", () => {
  it("exposes every candidate from both layers without a five-item cutoff", () => {
    const catalog = buildQuantumCatalog();
    for (const key of Object.values(quantumKeyboardMap)) {
      for (const layer of ["base", "ctrl"] as const) {
        for (const meaning of key[layer]) {
          expect(catalog.find(entry => entry.id === meaning.id)?.latex).toBe(meaning.latex);
        }
      }
    }
    expect(catalog.some(entry => entry.keyCode === "KeyS" && entry.index === 6 && entry.latex === "\\sin")).toBe(true);
  });

  it.each([
    ["分式", "\\frac{}{}"],
    ["integral", "\\int"],
    ["\\iint", "\\iint"],
    ["贝塔", "\\beta"],
    ["上标", "^{}"],
  ])("finds %s without knowing its key", (query, latex) => {
    expect(searchQuantumCatalog(buildQuantumCatalog(), query).map(entry => entry.latex)).toContain(latex);
  });

  it("classifies individual meanings instead of copying the entire key's category", () => {
    const catalog = buildQuantumCatalog();
    expect(catalog.find(entry => entry.latex === "\\sin")?.category).toBe("calculus");
    expect(catalog.find(entry => entry.latex === "\\sqrt{}")?.category).toBe("structure");
    expect(catalog.find(entry => entry.latex === "\\forall")?.category).toBe("relations");
  });

  it("uses user overrides in previews, search and insertion", () => {
    const catalog = buildQuantumCatalog({ KeyF: { base: { "base-KeyF-1": { label: "我的张量", latex: "\\mathcal{T}" } } } });
    const result = searchQuantumCatalog(catalog, "我的张量");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "base-KeyF-1", latex: "\\mathcal{T}", nameZh: "我的张量" });
  });

  it("renumbers visible candidates consistently after hidden defaults", () => {
    const entries = buildQuantumCatalog({}, {
      KeyS: { customSymbols: ["custom-s"], hiddenSymbols: ["\\Sigma"] },
    }).filter(entry => entry.keyCode === "KeyS" && entry.layer === "base");

    expect(entries.slice(0, 3).map(entry => [entry.latex, entry.index])).toEqual([
      ["\\sum", 1], ["\\sigma", 2], ["\\sqrt{}", 3],
    ]);
    expect(entries.at(-1)).toMatchObject({ latex: "custom-s", index: entries.length });
  });

  it("shows fillable positions and handles bra-ket previews", () => {
    expect(previewQuantumLatex("\\frac{}{}")).toContain("\\square");
    expect(previewQuantumLatex("^{}")).toBe("\\square^{\\square}");
    expect(previewQuantumLatex("\\ket{}")).toContain("\\rangle");
  });

  it("finds matrix sizes and integral families as visible templates", () => {
    const catalog = buildQuantumCatalog();
    expect(searchQuantumCatalog(catalog, "3x3").some((entry) => entry.nameEn.includes("3×3"))).toBe(true);
    expect(searchQuantumCatalog(catalog, "double contour").some((entry) => entry.latex.includes("oiint"))).toBe(true);
    expect(getQuickFormulaTemplates().map((template) => template.id)).toEqual(
      expect.arrayContaining(["matrix-3x3", "matrix-4x4"]),
    );
  });

  it("keeps the first five integral shortcuts within six base choices", () => {
    const expected = ["\\int", "\\iint", "\\iiint", "\\oint", "\\int_{}^{}", "\\oiint"];
    const entries = buildQuantumCatalog().filter(entry => entry.keyCode === "KeyI" && entry.layer === "base");
    expect(entries.map(entry => entry.latex)).toEqual(expected);
    for (const [index, latex] of expected.entries()) {
      expect(getCandidateSymbol("KeyI", index + 1)).toBe(latex);
      expect(entries[index]).toMatchObject({ id: `base-KeyI-${index + 1}`, index: index + 1 });
    }
  });

  it.each([
    ["无穷", "KeyN", "\\infty"],
    ["上标", "KeyP", "^{}"],
    ["n 次方根", "KeyR", "\\sqrt[]{}"],
    ["导数模板", "KeyF", "\\frac{d{}}{d{}}"],
    ["偏导模板", "KeyF", "\\frac{\\partial{}}{\\partial{}}"],
    ["二阶时间导数", "KeyV", "\\ddot{}"],
    ["极限模板", "KeyL", "\\lim_{{}\\to{}} {}"],
  ])("makes %s available from a mnemonic physical key", (query, keyCode, latex) => {
    expect(searchQuantumCatalog(buildQuantumCatalog(), query)).toEqual(expect.arrayContaining([
      expect.objectContaining({ keyCode, layer: "base", latex }),
    ]));
  });

  it.each([
    ["薛定谔", "KeyE", "physics"],
    ["傅里叶变换", "KeyF", "calculus"],
    ["贝叶斯", "KeyB", "calculus"],
    ["特征值", "KeyA", "algebra"],
    ["反应箭头", "KeyR", "chemistry"],
    ["核素", "KeyC", "chemistry"],
    ["离子", "KeyC", "chemistry"],
    ["吉布斯", "KeyG", "chemistry"],
    ["能斯特", "KeyN", "chemistry"],
    ["阿伦尼乌斯", "KeyR", "chemistry"],
    ["酸碱度", "KeyP", "chemistry"],
  ])("finds the editable %s formula on its extended physical key", (query, keyCode, category) => {
    const matches = searchQuantumCatalog(buildQuantumCatalog(), query);
    expect(matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ keyCode, layer: "ctrl", category, index: expect.any(Number) }),
    ]));
  });

  it("keeps all built-in key candidates accessible with a single digit", () => {
    for (const key of Object.values(quantumKeyboardMap)) {
      for (const layer of ["base", "ctrl"] as const) {
        expect(key[layer].length, `${key.letter} ${layer}`).toBeGreaterThanOrEqual(5);
        expect(key[layer].length, `${key.letter} ${layer}`).toBeLessThanOrEqual(6);
      }
    }
  });

  it.each([
    ["薛定谔", "薛定谔", "Schröd."],
    ["傅里叶变换", "傅里叶", "Fourier"],
    ["散度定理", "散度定理", "Gauss"],
    ["斯托克斯定理", "斯托克斯", "Stokes"],
    ["正态分布概率密度", "正态分布", "Normal"],
    ["浓度平衡常数", "平衡常数", "Equil."],
  ])("provides a readable keycap short label for %s", (query, zh, en) => {
    expect(searchQuantumCatalog(buildQuantumCatalog(), query)[0]?.shortLabel).toEqual({ zh, en });
  });

  it("does not show an official short label after the user changes the formula", () => {
    const official = searchQuantumCatalog(buildQuantumCatalog(), "傅里叶变换").find(entry => entry.latex.includes("="))!;
    const catalog = buildQuantumCatalog({ KeyF: { ctrl: { [official.id]: { label: "我的长公式", latex: "x^2+y^2=z^2" } } } });
    expect(searchQuantumCatalog(catalog, "我的长公式")[0]?.shortLabel).toBeUndefined();
  });

  it("inserts the Reynolds number as an upright quantity rather than the real-part operator", () => {
    expect(searchQuantumCatalog(buildQuantumCatalog(), "雷诺数")[0]).toMatchObject({
      id: "ctrl-KeyR-4", latex: "\\mathrm{Re}", keyCode: "KeyR", layer: "ctrl", index: 4,
    });
  });

  it("uses distinct extended candidates instead of repeating a bare letter for different quantities", () => {
    for (const key of Object.values(quantumKeyboardMap)) {
      const commands = key.ctrl.map(meaning => meaning.latex);
      expect(new Set(commands).size, key.letter).toBe(commands.length);
    }
  });

  it.each([
    ["KeyG", 2, String.raw`G=\frac{1}{R}`],
    ["KeyC", 3, String.raw`C_p=\left(\frac{\partial H}{\partial T}\right)_p`],
    ["KeyV", 2, String.raw`V=\frac{U}{q}`],
    ["KeyT", 2, String.raw`T=\frac{1}{f}`],
    ["KeyT", 4, String.raw`\tau=RC`],
    ["KeyP", 4, String.raw`P=\frac{\mathrm{d}W}{\mathrm{d}t}`],
    ["KeyF", 2, "F=N_Ae"],
  ])("keeps the %s extended slot %s useful without changing its ID", (keyCode, index, latex) => {
    expect(buildQuantumCatalog().find(entry => entry.id === `ctrl-${keyCode}-${index}`)).toMatchObject({ keyCode, layer: "ctrl", index, latex });
  });

  it("applies existing user overrides to repaired extended slots", () => {
    const catalog = buildQuantumCatalog({ KeyG: { ctrl: { "ctrl-KeyG-2": { label: "我的电导", latex: "G_0" } } } });
    expect(catalog.find(entry => entry.id === "ctrl-KeyG-2")).toMatchObject({ latex: "G_0", nameZh: "我的电导", index: 2 });
  });

  it("keeps every removed official meaning searchable under its original identity", () => {
    const catalog = buildQuantumCatalog();
    for (const key of Object.values(quantumKeyboardMap)) {
      for (const layer of ["base", "ctrl"] as const) {
        const visibleIds = new Set(key[layer].map(meaning => meaning.id));
        for (const meaning of getAllQuantumLayerMeanings(key.keyCode, layer)) {
          if (visibleIds.has(meaning.id)) continue;
          expect(catalog.find(entry => entry.id === meaning.id), meaning.id).toMatchObject({ latex: meaning.latex, keyCode: null, layer: null, index: null });
        }
      }
    }
  });

  it("uses independent IDs for advanced integral shortcuts without stealing old overrides", () => {
    const entries = buildQuantumCatalog({ KeyI: { ctrl: { "ctrl-KeyI-1": { label: "自定义电流", latex: "I_0" } } } });
    expect(entries.find(entry => entry.id === "ctrl-KeyI-1")).toMatchObject({ latex: "I_0", nameZh: "自定义电流", keyCode: null });
    expect(entries.find(entry => entry.id === "ctrl-KeyI-integral-1")).toMatchObject({ latex: String.raw`\oiiint`, keyCode: "KeyI", layer: "ctrl", index: 1 });
    expect(entries.find(entry => entry.id === "ctrl-KeyI-integral-1")?.nameZh).toBe("闭体积分");
  });

  it("keeps legacy extended names aligned by stable ID after visible filtering", () => {
    const catalog = buildQuantumCatalog();
    expect(catalog.find(entry => entry.id === "ctrl-KeyE-5")?.nameZh).not.toBe("酶催化简化模型");
    expect(catalog.find(entry => entry.id === "ctrl-KeyE-4")).toMatchObject({ nameZh: "酶催化简化模型", keyCode: null });
    expect(searchQuantumCatalog(catalog, "current").some(entry => entry.id === "ctrl-KeyI-1")).toBe(true);
    expect(searchQuantumCatalog(catalog, "3x3").some(entry => entry.id === "base-KeyM-4" && entry.nameEn.includes("3×3"))).toBe(true);
  });
});

it("keeps existing user symbols and named formulas discoverable", () => {
  const catalog = buildQuantumCatalog({}, { KeyF: { customSymbols: ["\\mathcal{T}"], hiddenSymbols: [] } }, [
    { id: "energy", label: "我的能量公式", latex: "E=mc^2", displayMode: false },
  ]);
  expect(searchQuantumCatalog(catalog, "\\mathcal{T}").some(entry => entry.id.startsWith("custom:"))).toBe(true);
  expect(searchQuantumCatalog(catalog, "我的能量公式")[0]).toMatchObject({ latex: "E=mc^2", category: "custom" });
});
