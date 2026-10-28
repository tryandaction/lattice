import { KEY_LABELS, quantumKeyboardMap, type QuantumLayerId } from "@/config/quantum-keymap";
import { QUANTUM_FORMULA_PRESETS, type QuantumShortLabel } from "@/config/quantum-formula-presets";
import { getAllEffectiveQuantumLayerMeanings, type QuantumKeymapOverrides } from "@/stores/quantum-keymap-store";
import { SYMBOL_DATA } from "./symbol-data";
import type { CustomKeyMapping } from "@/stores/quantum-custom-store";

export type CatalogCategory = "structure" | "greek" | "calculus" | "algebra" | "relations" | "sets" | "physics" | "chemistry" | "engineering" | "symbols" | "custom";
export type CatalogSection = CatalogCategory | "common" | "favorites" | "recent" | "all";
export interface QuantumCatalogEntry {
  id: string; latex: string; mathlive?: string; displayMode?: boolean;
  nameZh: string; nameEn: string; category: CatalogCategory; keywords: string[];
  shortLabel?: QuantumShortLabel;
  keyCode: string | null; letter: string | null; layer: QuantumLayerId | null; index: number | null;
}
export const CATALOG_CATEGORIES: ReadonlyArray<{ id: CatalogSection; zh: string; en: string }> = [
  { id: "common", zh: "常用", en: "Common" }, { id: "favorites", zh: "收藏", en: "Favorites" },
  { id: "recent", zh: "最近", en: "Recent" }, { id: "all", zh: "全部", en: "All" },
  { id: "structure", zh: "结构与括号", en: "Structures" }, { id: "greek", zh: "希腊字母", en: "Greek" },
  { id: "calculus", zh: "微积分与函数", en: "Calculus" }, { id: "algebra", zh: "矩阵与向量", en: "Linear algebra" },
  { id: "relations", zh: "关系与逻辑", en: "Relations & logic" }, { id: "sets", zh: "集合", en: "Sets" },
  { id: "physics", zh: "物理与量子", en: "Physics & quantum" }, { id: "chemistry", zh: "化学与反应", en: "Chemistry & reactions" },
  { id: "engineering", zh: "工程与电路", en: "Engineering & circuits" },
  { id: "symbols", zh: "更多符号", en: "More symbols" },
  { id: "custom", zh: "我的公式", en: "My formulas" },
];
type Definition = { category: CatalogCategory; latex: string; zh: string; en: string; keywords: string[] };
const DEFINITIONS: Definition[] = [...SYMBOL_DATA.trim().split("\n").map(line => {
  const [category, latex, zh, en, keywords = ""] = line.split(";");
  return { category: category as CatalogCategory, latex, zh, en, keywords: keywords.split(" ") };
}), ...QUANTUM_FORMULA_PRESETS.map(preset => ({
  category: fallbackCategory(preset.category), latex: preset.latex,
  zh: preset.nameZh, en: preset.nameEn, keywords: preset.keywords,
}))];
const definitionByLatex = new Map(DEFINITIONS.map(definition => [definition.latex, definition]));
const CTRL_NAMES_ZH: Record<string, string[]> = {
  KeyQ: ["电荷 q", "热量 Q", "广义速度", "位置算子"],
  KeyW: ["功 W", "波动算子", "朗斯基行列式", "功的微分"],
  KeyE: ["能量 E", "电场", "期望算子", "酶催化简化模型"],
  KeyR: ["电阻 R", "半径 r", "幂律反应速率", "雷诺数"],
  KeyT: ["温度 T", "周期与频率", "力矩", "RC 时间常数"],
  KeyY: ["产额 Y", "球谐函数", "导纳与阻抗"],
  KeyU: ["势能 U", "幺正算子", "内能变化", "速度 u"],
  KeyI: ["电流 I", "单位算子", "示性函数", "转动惯量"],
  KeyO: ["大 O 记号", "序参量期望值", "符号 O", "原子轨道波函数"],
  KeyP: ["压强 P", "概率 P", "动量 p", "瞬时功率"],
  KeyA: ["面积 A", "矢势", "符号 a", "吸光度与透射比"],
  KeyS: ["熵 S", "作用量积分", "自旋", "化学计量系数"],
  KeyD: ["对 x 求导", "微分 d", "扩散系数", "行列式"],
  KeyF: ["力 F", "法拉第常数（C·mol⁻¹）", "通量 Φ", "傅里叶变换符号"],
  KeyG: ["自由能 G", "电导与电阻", "万有引力（质点）", "格林函数"],
  KeyH: ["焓 H", "磁场强度", "厄米共轭", "希尔伯特空间"],
  KeyJ: ["电流密度", "贝塞尔函数", "通量 J", "冲量积分"],
  KeyK: ["玻尔兹曼常数", "开尔文单位", "刚度 K", "系数 k"],
  KeyL: ["拉格朗日量", "长度 L", "角动量", "拉普拉斯变换模板"],
  KeyZ: ["阻抗 Z", "原子序数与质子数", "Z 变换", "标准分数"],
  KeyX: ["位置 x", "随机变量 X", "叉乘", "符号 X"],
  KeyC: ["电容 C", "物种浓度", "定压热容", "符号 C"],
  KeyV: ["电压 V", "电势（势能/电荷）", "区域体积", "速度矢量"],
  KeyB: ["磁感应强度", "贝塔函数", "基底", "边界算子"],
  KeyN: ["数目 N", "正态分布", "常数 Nₐ", "数目 n"],
  KeyM: ["质量 m", "符号 M", "力矩", "度规张量"],
};
function fallbackCategory(category: string): CatalogCategory {
  if (category === "linear-algebra") return "algebra";
  if (category === "logic" || category === "relations") return "relations";
  if (["structure", "greek", "calculus", "sets", "physics", "chemistry", "engineering"].includes(category)) return category as CatalogCategory;
  return "symbols";
}
export function buildQuantumCatalog(
  overrides: QuantumKeymapOverrides = {},
  customMappings: Record<string, CustomKeyMapping> = {},
  records: Array<{ id: string; label: string; latex: string; displayMode: boolean }> = [],
): QuantumCatalogEntry[] {
  const entries: QuantumCatalogEntry[] = [];
  const archivedEntries: QuantumCatalogEntry[] = [];
  for (const keyCode of Object.keys(quantumKeyboardMap)) {
    for (const layer of ["base", "ctrl"] as const) {
      const meanings = getAllEffectiveQuantumLayerMeanings(keyCode, layer, overrides);
      const visibleIds = quantumKeyboardMap[keyCode][layer].map(meaning => meaning.id);
      meanings.forEach(meaning => {
        const index = visibleIds.indexOf(meaning.id);
        if (layer === 'base' && index > 0 && customMappings[keyCode]?.hiddenSymbols.includes(meaning.latex)) return;
        const definition = definitionByLatex.get(meaning.latex);
        const custom = overrides[keyCode]?.[layer]?.[meaning.id];
        const customName = custom?.label?.trim();
        const legacyIndex = /^ctrl-Key[A-Z]-(\d+)$/.exec(meaning.id)?.[1];
        const legacyNameZh = legacyIndex ? CTRL_NAMES_ZH[keyCode]?.[Number(legacyIndex) - 1] : undefined;
        const visible = index >= 0;
        (visible ? entries : archivedEntries).push({
          id: meaning.id, latex: meaning.latex, mathlive: meaning.mathlive,
          displayMode: custom?.displayMode ?? /\\begin\{(?:[pbvV]?matrix|cases)\}/.test(meaning.latex),
          nameZh: customName || (layer === "ctrl" ? legacyNameZh : definition?.zh) || definition?.zh || meaning.label,
          nameEn: customName || (legacyNameZh ? meaning.label : definition?.en) || meaning.label,
          shortLabel: customName || custom?.latex?.trim() ? undefined : meaning.shortLabel,
          category: definition?.category ?? fallbackCategory(meaning.category),
          keywords: [...meaning.keywords, ...(definition?.keywords ?? []), meaning.label],
          keyCode: visible ? keyCode : null, letter: visible ? KEY_LABELS[keyCode] : null, layer: visible ? layer : null, index: visible ? index + 1 : null,
        });
      });
    }
  }
  // Keep the original identities for favorites, overrides and search, without
  // assigning removed meanings a physical shortcut or displacing visible keys.
  entries.push(...archivedEntries);
  const existing = new Set(entries.map(entry => entry.latex));
  for (const definition of DEFINITIONS) {
    if (existing.has(definition.latex)) continue;
    entries.push({
      id: "symbol:" + definition.latex, latex: definition.latex, displayMode: /\\begin\{/.test(definition.latex),
      nameZh: definition.zh, nameEn: definition.en, category: definition.category, keywords: definition.keywords,
      keyCode: null, letter: null, layer: null, index: null,
    });
    existing.add(definition.latex);
  }
  for (const [keyCode, mapping] of Object.entries(customMappings)) {
    for (const latex of mapping.customSymbols) {
      if (entries.some(entry => entry.keyCode === keyCode && entry.layer === "base" && entry.latex === latex)) continue;
      entries.push({ id: 'custom:' + keyCode + ':' + latex, latex, nameZh: latex, nameEn: latex, category: 'custom', keywords: [],
        keyCode, letter: KEY_LABELS[keyCode] ?? null, layer: 'base', index: null });
    }
  }
  for (const record of records) entries.push({
    id: 'saved:' + record.id, latex: record.latex, displayMode: record.displayMode,
    nameZh: record.label, nameEn: record.label, category: 'custom', keywords: [record.label], keyCode: null, letter: null, layer: null, index: null,
  });
  const visibleIndexes = new Map<string, number>();
  return entries.map(entry => {
    if (!entry.keyCode || !entry.layer) return entry;
    const key = entry.keyCode + ":" + entry.layer;
    const index = (visibleIndexes.get(key) ?? 0) + 1;
    visibleIndexes.set(key, index);
    return entry.index === index ? entry : { ...entry, index };
  });
}
function normalizeQuery(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\\+/g, "").trim();
}
export function searchQuantumCatalog(entries: QuantumCatalogEntry[], query: string): QuantumCatalogEntry[] {
  const normalized = normalizeQuery(query);
  const terms = normalized.split(/\s+/).filter(Boolean);
  if (!terms.length) return entries;
  const exact = (entry: QuantumCatalogEntry) => [entry.nameZh, entry.nameEn, entry.latex].some(value => normalizeQuery(value) === normalized);
  return entries.filter(entry => {
    const searchable = normalizeQuery([entry.nameZh, entry.nameEn, entry.latex, entry.letter, ...entry.keywords].join(" "));
    return terms.every(term => searchable.includes(term));
  }).sort((a, b) => Number(exact(b)) - Number(exact(a)));
}
export function uniqueQuantumEntries(entries: QuantumCatalogEntry[]): QuantumCatalogEntry[] {
  const seen = new Set<string>();
  return entries.filter(entry => {
    if (seen.has(entry.latex)) return false;
    seen.add(entry.latex);
    return true;
  });
}
export const COMMON_LATEX = [
  "\\frac{}{}", "\\sqrt{}", "^{}", "_{}", "\\left({}\\right)", "\\int_{}^{}", "\\sum_{}^{} {}",
  "\\lim_{{}\\to{}} {}", "\\frac{d{}}{d{}}", "\\frac{\\partial{}}{\\partial{}}",
  "\\begin{pmatrix}{}&{}\\\\{}&{}\\end{pmatrix}", "\\vec{}", "\\ket{}", "\\bra{}", "\\braket{}{}",
  "\\alpha", "\\beta", "\\theta", "\\pi", "\\infty", "\\neq", "\\leq", "\\geq", "\\rightarrow",
];
export function previewQuantumLatex(latex: string): string {
  let value = latex.replace(/\{\s*\}/g, "{\\square}")
    .replace(/\\ket\{([^{}]*)\}\\bra\{([^{}]*)\}/g, "\\left|$1\\right\\rangle\\!\\left\\langle$2\\right|")
    .replace(/\\braket\{([^{}]*)\}\{([^{}]*)\}/g, "\\left\\langle$1\\middle|$2\\right\\rangle")
    .replace(/\\ket\{([^{}]*)\}/g, "\\left|$1\\right\\rangle")
    .replace(/\\bra\{([^{}]*)\}/g, "\\left\\langle$1\\right|")
    .replace(/\\placeholder\{[^{}]*\}/g, "\\square")
    .replace(/\{\s*\}/g, "{\\square}").replace(/\[\s*\]/g, "[\\square]");
  if (/^[_^]/.test(value)) value = "\\square" + value;
  return value;
}

/** Portable LaTeX: the input does not require physics-package bra/ket macros. */
export function portableQuantumLatex(latex: string): string {
  return latex.replace(/\\braket\{([^{}]*)\}\{([^{}]*)\}/g, '\\left\\langle{$1}\\middle|{$2}\\right\\rangle')
    .replace(/\\ket\{([^{}]*)\}/g, '\\left|{$1}\\right\\rangle')
    .replace(/\\bra\{([^{}]*)\}/g, '\\left\\langle{$1}\\right|');
}
