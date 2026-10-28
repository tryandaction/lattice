import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useHUDStore } from "@/stores/hud-store";
import { useQuantumKeymapStore } from "@/stores/quantum-keymap-store";
import { useQuantumCustomStore } from "@/stores/quantum-custom-store";
import { KeyboardPanel } from "../keyboard-panel";
import { useQuantumPreferences } from "../preferences";
import { useQuantumPluginRuntime } from "../runtime";
import { useQuantumFormulaLibraryStore } from "@/stores/quantum-formula-library-store";
import { buildFormulaRecord } from "@/lib/formula-composer";
import { setLocale } from "@/lib/i18n";
import { setActiveInputTargetFromElement } from "@/lib/unified-input-handler";
beforeEach(() => {
  setLocale("zh-CN");
  useHUDStore.getState().openHUD("test");
  useQuantumKeymapStore.getState().resetAll();
  useQuantumCustomStore.getState().resetAll();
  useQuantumFormulaLibraryStore.getState().clearFormulaLibrary();
  useQuantumPreferences.setState({ view: "keys", mappingSource: "official", section: "all", favorites: [], recent: [], shortcutMode: true, layer: "base", selectedKey: "KeyF" });
  useQuantumPluginRuntime.setState({ tab: "input" });
});
afterEach(cleanup);
describe("physical multi-symbol keyboard", () => {
  it("shows QWERTY and every meaning on the key itself", () => {
    const { container } = render(<KeyboardPanel onInsertSymbol={vi.fn()} />);
    expect(container.querySelectorAll(".qk-keycap")).toHaveLength(26);
    const sKey = screen.getByRole("group", { name: "S 键全部符号" });
    expect(within(sKey).getAllByRole("button").length).toBeGreaterThanOrEqual(7);
    expect(within(sKey).getByRole("button", { name: "S 键 6 正弦" })).toBeTruthy();
    expect(container.querySelectorAll(".qk-keycap-symbol .katex").length).toBeGreaterThanOrEqual(130);
  });

  it("uses a compact two-column grid for short keys and preserves numbered slots", () => {
    useQuantumCustomStore.setState({ customMappings: { KeyZ: { customSymbols: [], hiddenSymbols: ["\\\\mathbb{Z}"] } } });
    useQuantumPreferences.setState({ mappingSource: "custom" });
    useQuantumCustomStore.setState({ customMappings: { KeyZ: { customSymbols: [], hiddenSymbols: ["\\mathbb{Z}"] } } });
    useQuantumPreferences.setState({ mappingSource: "custom" });
    render(<KeyboardPanel onInsertSymbol={vi.fn()} />);
    const zGrid = document.querySelector('[data-keycode="KeyZ"] .qk-keycap-symbols');
    const iGrid = document.querySelector('[data-keycode="KeyI"] .qk-keycap-symbols');
    expect(zGrid?.getAttribute("data-density")).toBe("compact");
    expect(zGrid?.querySelectorAll(".qk-keycap-symbol")).toHaveLength(4);
    expect(iGrid?.getAttribute("data-density")).toBe("full");
    expect([...iGrid!.querySelectorAll(".qk-keycap-symbol > sup")].map(node => node.textContent)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });
  it("selects a key then taps its number to insert a meaning", () => {
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    const editor = document.createElement("textarea"); document.body.appendChild(editor); editor.focus();
    fireEvent.keyDown(editor, { key: "i", code: "KeyI" });
    fireEvent.keyDown(editor, { key: "2", code: "Digit2" });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ latex: "\\iint" }));
  });
  it("exposes the extended layer with a visible control", () => {
    render(<KeyboardPanel onInsertSymbol={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "扩展层" }));
    expect(screen.getByRole("button", { name: "S 键 1 熵 S" })).toBeTruthy();
  });
  it("switches official and user mapping without deleting edits", () => {
    useQuantumKeymapStore.getState().updateMeaning("KeyF", "base", "base-KeyF-1", { label: "我的张量", latex: "\\mathcal{T}" });
    render(<KeyboardPanel onInsertSymbol={vi.fn()} />);
    expect(screen.getByRole("button", { name: "F 键 1 分式" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "我的映射" }));
    expect(screen.getByRole("button", { name: "F 键 1 我的张量" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "官方推荐" }));
    expect(screen.getByRole("button", { name: "F 键 1 分式" })).toBeTruthy();
    expect(useQuantumKeymapStore.getState().overrides.KeyF).toBeTruthy();
  });
  it("keeps lookup auxiliary and preserves ordinary search typing", () => {
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    fireEvent.click(screen.getByRole("button", { name: "查找更多公式" }));
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "分式" } });
    fireEvent.keyDown(search, { key: "f", code: "KeyF" });
    expect(insert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "插入 分式" }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ latex: "\\frac{}{}" }));
  });
  it("reports a missing target instead of claiming success", () => {
    render(<KeyboardPanel onInsertSymbol={() => false} />);
    fireEvent.click(screen.getByRole("button", { name: "F 键 1 分式" }));
    expect(screen.getByRole("status").textContent).toContain("点击");
    expect(useQuantumPreferences.getState().recent).toHaveLength(0);
  });
  it("asks for numeric dimensions before inserting an empty matrix template", () => {
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    fireEvent.click(screen.getByRole("button", { name: /M 键 1 / }));
    expect(insert).not.toHaveBeenCalled();
    const rows = screen.getByRole("spinbutton", { name: "矩阵行数" });
    const columns = screen.getByRole("spinbutton", { name: "矩阵列数" });
    expect(document.activeElement).toBe(rows);
    fireEvent.change(rows, { target: { value: "3" } });
    fireEvent.change(columns, { target: { value: "4" } });
    fireEvent.submit(screen.getByRole("form", { name: "矩阵尺寸" }));
    const matrix = insert.mock.calls[0][0].latex;
    expect(insert.mock.calls[0][0].displayMode).toBe(true);
    expect(matrix.startsWith(String.fromCharCode(92) + "begin{pmatrix}")).toBe(true);
    expect((matrix.match(/\{\}/g) ?? [])).toHaveLength(12);
    expect(matrix.split(String.fromCharCode(92).repeat(2))).toHaveLength(3);
    expect(screen.queryByRole("form", { name: "矩阵尺寸" })).toBeNull();
    expect(useQuantumPreferences.getState().shortcutMode).toBe(false);
  });
  it("cancels the size chooser without inserting or closing the keyboard", () => {
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    fireEvent.click(screen.getByRole("button", { name: /M 键 2 / }));
    fireEvent.keyDown(screen.getByRole("spinbutton", { name: "矩阵行数" }), { key: "Escape" });
    expect(insert).not.toHaveBeenCalled();
    expect(screen.queryByRole("form", { name: "矩阵尺寸" })).toBeNull();
    expect(useHUDStore.getState().isOpen).toBe(true);
  });
  it("selects a key from its title then accepts a visible candidate number", () => {
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    const editor = document.createElement("textarea"); document.body.appendChild(editor); editor.focus();
    try {
      fireEvent.click(screen.getByRole("button", { name: "S 键候选" }));
      fireEvent.keyDown(editor, { key: "6", code: "Digit6" });
      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ latex: "\\sin" }));
    } finally { editor.remove(); }
  });
  it("uses press a key for choice one and hold a key plus number for later choices", () => {
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    const editor = document.createElement("textarea"); document.body.appendChild(editor); editor.focus();
    try {
      fireEvent.keyDown(editor, { key: "s", code: "KeyS" });
      expect(insert).not.toHaveBeenCalled();
      fireEvent.keyDown(editor, { key: "1", code: "Digit1" });
      expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ latex: "\\sum" }));
      fireEvent.keyDown(editor, { key: "s", code: "KeyS" });
      fireEvent.keyDown(editor, { key: "6", code: "Digit6" });
      expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ latex: "\\sin" }));
    } finally { editor.remove(); }
  });
  it("uses Shift plus a letter and number to select the extended layer", () => {
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    const editor = document.createElement("textarea"); document.body.appendChild(editor); editor.focus();
    try {
      fireEvent.keyDown(editor, { key: "i", code: "KeyI", shiftKey: true });
      fireEvent.keyUp(editor, { key: "i", code: "KeyI", shiftKey: true });
      fireEvent.keyDown(editor, { key: "2", code: "Digit2" });
      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ latex: "\\iint_{}^{}" }));
    } finally { editor.remove(); }
  });
  it("builds integrals from Ctrl+I digits when Ctrl is released", () => {
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    const editor = document.createElement("textarea"); document.body.appendChild(editor); editor.focus();
    try {
      fireEvent.keyDown(editor, { key: "Control", code: "ControlLeft", ctrlKey: true });
      fireEvent.keyDown(editor, { key: "i", code: "KeyI", ctrlKey: true });
      fireEvent.keyDown(editor, { key: "2", code: "Digit2", ctrlKey: true });
      fireEvent.keyUp(editor, { key: "Control", code: "ControlLeft" });
      expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ latex: "\\iint" }));
      fireEvent.keyDown(editor, { key: "Control", code: "ControlLeft", ctrlKey: true });
      fireEvent.keyDown(editor, { key: "i", code: "KeyI", ctrlKey: true });
      fireEvent.keyDown(editor, { key: "2", code: "Digit2", ctrlKey: true });
      fireEvent.keyDown(editor, { key: "0", code: "Digit0", ctrlKey: true });
      fireEvent.keyUp(editor, { key: "Control", code: "ControlLeft" });
      expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ latex: "\\oiint" }));
      expect(screen.queryByRole("form", { name: "矩阵尺寸" })).toBeNull();
    } finally { editor.remove(); }
  });
  it("builds a rectangular matrix from Ctrl+M digits without opening the size form", () => {
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    const editor = document.createElement("textarea"); document.body.appendChild(editor); editor.focus();
    try {
      fireEvent.keyDown(editor, { key: "Control", code: "ControlLeft", ctrlKey: true });
      fireEvent.keyDown(editor, { key: "m", code: "KeyM", ctrlKey: true });
      fireEvent.keyDown(editor, { key: "3", code: "Digit3", ctrlKey: true });
      fireEvent.keyDown(editor, { key: "4", code: "Digit4", ctrlKey: true });
      fireEvent.keyUp(editor, { key: "Control", code: "ControlLeft" });
      const matrix = insert.mock.calls[0][0].latex;
      expect(insert.mock.calls[0][0].displayMode).toBe(true);
      expect(matrix.startsWith(String.fromCharCode(92) + "begin{pmatrix}")).toBe(true);
      expect((matrix.match(/\{\}/g) ?? [])).toHaveLength(12);
      expect(matrix.split(String.fromCharCode(92).repeat(2))).toHaveLength(3);
      expect(screen.queryByRole("form", { name: "矩阵尺寸" })).toBeNull();
    } finally { editor.remove(); }
  });
  it("rejects an overlong Ctrl matrix chord instead of inserting its valid prefix", () => {
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    const editor = document.createElement("textarea"); document.body.appendChild(editor); editor.focus();
    try {
      fireEvent.keyDown(editor, { key: "Control", code: "ControlLeft", ctrlKey: true });
      fireEvent.keyDown(editor, { key: "m", code: "KeyM", ctrlKey: true });
      fireEvent.keyDown(editor, { key: "1", code: "Digit1", ctrlKey: true });
      fireEvent.keyDown(editor, { key: "2", code: "Digit2", ctrlKey: true });
      fireEvent.keyDown(editor, { key: "3", code: "Digit3", ctrlKey: true });
      fireEvent.keyUp(editor, { key: "Control", code: "ControlLeft" });
      expect(insert).not.toHaveBeenCalled();
      expect(screen.getByRole("status").textContent).toContain("两位");
    } finally { editor.remove(); }
  });
  it("cancels a Ctrl formula chord on Escape and keeps the keyboard open", () => {
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    const editor = document.createElement("textarea"); document.body.appendChild(editor); editor.focus();
    try {
      fireEvent.keyDown(editor, { key: "Control", code: "ControlLeft", ctrlKey: true });
      fireEvent.keyDown(editor, { key: "i", code: "KeyI", ctrlKey: true });
      fireEvent.keyDown(editor, { key: "2", code: "Digit2", ctrlKey: true });
      fireEvent.keyDown(editor, { key: "Escape", code: "Escape", ctrlKey: true });
      fireEvent.keyUp(editor, { key: "Control", code: "ControlLeft" });
      expect(insert).not.toHaveBeenCalled();
      expect(useHUDStore.getState().isOpen).toBe(true);
    } finally { editor.remove(); }
  });
  it("cancels a pending chord when focus leaves its originating editor", () => {
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    const editor = document.createElement("textarea"), other = document.createElement("textarea");
    document.body.append(editor, other); editor.focus();
    try {
      fireEvent.keyDown(editor, { key: "Control", code: "ControlLeft", ctrlKey: true });
      fireEvent.keyDown(editor, { key: "i", code: "KeyI", ctrlKey: true });
      fireEvent.keyDown(editor, { key: "2", code: "Digit2", ctrlKey: true });
      other.focus();
      fireEvent.keyUp(other, { key: "Control", code: "ControlLeft" });
      expect(insert).not.toHaveBeenCalled();
    } finally { editor.remove(); other.remove(); }
  });
  it("finds and selects search results with ArrowDown and Enter", () => {
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    fireEvent.click(screen.getByRole("button", { name: "查找更多公式" }));
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "积分" } });
    const cards = document.querySelectorAll<HTMLButtonElement>(".qk-card-insert");
    expect(cards.length).toBeGreaterThan(2);
    const expectedId = cards[1].dataset.formulaId;
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.querySelector(".qk-card.is-selected .qk-card-insert")?.getAttribute("data-formula-id")).toBe(expectedId);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(insert).toHaveBeenCalledOnce();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(useHUDStore.getState().isOpen).toBe(true);
  });
  it("lets the keyboard choose user candidates beyond number nine", () => {
    useQuantumCustomStore.setState({ customMappings: { KeyS: { customSymbols: ["\\mathcal{A}", "\\mathcal{B}", "\\mathcal{C}", "\\mathcal{D}"], hiddenSymbols: [] } } });
    useQuantumPreferences.setState({ mappingSource: "custom" });
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    const editor = document.createElement("textarea"); document.body.appendChild(editor); editor.focus();
    try {
      fireEvent.click(screen.getByRole("button", { name: "S 键候选" }));
      fireEvent.keyDown(editor, { key: "ArrowLeft", code: "ArrowLeft" });
      fireEvent.keyDown(editor, { key: "Enter", code: "Enter" });
      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ latex: "\\mathcal{D}" }));
    } finally { editor.remove(); }
  });

  it("cancels candidates when focus moves to another editor", () => {
    useQuantumPreferences.setState({ shortcutMode: false });
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    const editor = document.createElement("textarea"), other = document.createElement("textarea");
    document.body.append(editor, other); editor.focus();
    try {
      fireEvent.keyDown(editor, { key: "s", code: "KeyS", altKey: true });
      act(() => other.focus());
      expect(fireEvent.keyDown(other, { key: "2", code: "Digit2" })).toBe(true);
      expect(insert).not.toHaveBeenCalled();
      expect(screen.queryByRole("group", { name: "当前键全部候选" })).toBeNull();
    } finally { editor.remove(); other.remove(); }
  });

  it("cancels numbered prefixes when focus moves to another editor", () => {
    useQuantumPreferences.setState({ shortcutMode: false });
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    const editor = document.createElement("textarea"), other = document.createElement("textarea");
    document.body.append(editor, other); editor.focus();
    try {
      fireEvent.keyDown(editor, { key: "2", code: "Digit2", altKey: true });
      act(() => other.focus());
      expect(fireEvent.keyDown(other, { key: "i", code: "KeyI" })).toBe(true);
      expect(insert).not.toHaveBeenCalled();
    } finally { editor.remove(); other.remove(); }
  });

  it("keeps candidates during a round trip through panel controls", () => {
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    const editor = document.createElement("textarea"); document.body.append(editor); editor.focus();
    setActiveInputTargetFromElement(editor);
    try {
      fireEvent.keyDown(editor, { key: "s", code: "KeyS" });
      act(() => screen.getByRole("button", { name: "官方推荐" }).focus());
      act(() => editor.focus());
      fireEvent.keyDown(editor, { key: "6", code: "Digit6" });
      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ latex: "\\sin" }));
    } finally { editor.remove(); }
  });

  it("clears an out-of-range candidate when switching back to official mappings", () => {
    useQuantumCustomStore.setState({ customMappings: { KeyS: { customSymbols: ["s_1", "s_2", "s_3", "s_4"], hiddenSymbols: [] } } });
    useQuantumPreferences.setState({ mappingSource: "custom" });
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    const editor = document.createElement("textarea"); document.body.append(editor); editor.focus();
    try {
      fireEvent.keyDown(editor, { key: "s", code: "KeyS" });
      fireEvent.keyDown(editor, { key: "ArrowLeft", code: "ArrowLeft" });
      expect(screen.getByRole("button", { name: "选择 10 s_4" }).getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "官方推荐" }));
      expect(screen.queryByRole("group", { name: "当前键全部候选" })).toBeNull();
      expect(fireEvent.keyDown(editor, { key: "Enter", code: "Enter" })).toBe(true);
      expect(insert).not.toHaveBeenCalled();
    } finally { editor.remove(); }
  });

  it("keeps the selected index valid when the current catalog loses candidates", () => {
    useQuantumCustomStore.setState({ customMappings: { KeyS: { customSymbols: ["s_1", "s_2", "s_3", "s_4"], hiddenSymbols: [] } } });
    useQuantumPreferences.setState({ mappingSource: "custom" });
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    const editor = document.createElement("textarea"); document.body.append(editor); editor.focus();
    try {
      fireEvent.keyDown(editor, { key: "s", code: "KeyS" });
      fireEvent.keyDown(editor, { key: "ArrowLeft", code: "ArrowLeft" });
      act(() => useQuantumCustomStore.getState().resetAll());
      expect(screen.getByRole("button", { name: "选择 6 正弦" }).getAttribute("aria-pressed")).toBe("true");
      fireEvent.keyDown(editor, { key: "Enter", code: "Enter" });
      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ latex: "\\sin" }));
    } finally { editor.remove(); }
  });

  it("cancels ordinary candidate selection when the window loses focus", () => {
    render(<KeyboardPanel onInsertSymbol={vi.fn()} />);
    const editor = document.createElement("textarea"); document.body.append(editor); editor.focus();
    try {
      fireEvent.keyDown(editor, { key: "s", code: "KeyS" });
      expect(screen.getByRole("group", { name: "当前键全部候选" })).toBeTruthy();
      fireEvent.blur(window);
      expect(screen.queryByRole("group", { name: "当前键全部候选" })).toBeNull();
      expect(screen.getByRole("status").textContent).not.toContain("Ctrl");
    } finally { editor.remove(); }
  });

  it("advances selected candidates on repeated arrow events", () => {
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    const editor = document.createElement("textarea"); document.body.append(editor); editor.focus();
    try {
      fireEvent.keyDown(editor, { key: "s", code: "KeyS" });
      expect(fireEvent.keyDown(editor, { key: "ArrowRight", code: "ArrowRight", repeat: true })).toBe(false);
      fireEvent.keyDown(editor, { key: "Enter", code: "Enter" });
      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ latex: "\\Sigma" }));
    } finally { editor.remove(); }
  });

  it("consumes repeated symbol letters without leaking native text or reopening choices", () => {
    render(<KeyboardPanel onInsertSymbol={vi.fn()} />);
    const editor = document.createElement("textarea"); document.body.append(editor); editor.focus();
    try {
      fireEvent.keyDown(editor, { key: "s", code: "KeyS" });
      fireEvent.keyDown(editor, { key: "ArrowRight", code: "ArrowRight" });
      expect(fireEvent.keyDown(editor, { key: "s", code: "KeyS", repeat: true })).toBe(false);
      expect(screen.getByRole("button", { name: "选择 2 大写西格马 Σ" }).getAttribute("aria-pressed")).toBe("true");
    } finally { editor.remove(); }
  });

  it("keeps variable repeats native while consuming a held Alt symbol after Alt is released", () => {
    useQuantumPreferences.setState({ shortcutMode: false });
    render(<KeyboardPanel onInsertSymbol={vi.fn()} />);
    const editor = document.createElement("textarea"); document.body.append(editor); editor.focus();
    try {
      expect(fireEvent.keyDown(editor, { key: "x", code: "KeyX", repeat: true })).toBe(true);
      fireEvent.keyDown(editor, { key: "s", code: "KeyS", altKey: true });
      expect(fireEvent.keyDown(editor, { key: "s", code: "KeyS", repeat: true })).toBe(false);
      fireEvent.keyUp(editor, { key: "s", code: "KeyS" });
      expect(fireEvent.keyDown(editor, { key: "s", code: "KeyS", repeat: true })).toBe(true);
    } finally { editor.remove(); }
  });
  it("keeps settings open when Escape cancels a saved formula edit", () => {
    useQuantumFormulaLibraryStore.getState().upsertFormulaRecord(buildFormulaRecord("x^2", { label: "Escape test" }));
    useQuantumPluginRuntime.setState({ tab: "settings" });
    render(<KeyboardPanel onInsertSymbol={vi.fn()} />);
    fireEvent.click(screen.getByText("我的公式"));
    fireEvent.click(screen.getByRole("button", { name: "编辑 Escape test" }));
    const formula = screen.getByRole("textbox", { name: "公式 LaTeX" });
    fireEvent.change(formula, { target: { value: "x^3" } });
    fireEvent.keyDown(formula, { key: "Escape" });
    expect(useHUDStore.getState().isOpen).toBe(true);
    expect(useQuantumPluginRuntime.getState().tab).toBe("settings");
    expect(screen.queryByRole("button", { name: "取消编辑" })).toBeNull();
  });
  it("preserves the active mapping after inspecting settings", () => {
    useQuantumPluginRuntime.setState({ tab: "settings" });
    render(<KeyboardPanel onInsertSymbol={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "返回公式输入" }));
    expect(useQuantumPreferences.getState().mappingSource).toBe("official");
  });
  it("localizes the keyboard, candidate names and matrix fields to English", () => {
    setLocale("en-US");
    const insert = vi.fn(); render(<KeyboardPanel onInsertSymbol={insert} />);
    expect(screen.getByRole("dialog", { name: "Quantum Keyboard" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Find more formulas" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "M key 1 Parenthesized matrix 2×2" }));
    expect(screen.getByRole("spinbutton", { name: "Matrix rows" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Matrix columns" })).toBeTruthy();
    fireEvent.click(document.querySelector<HTMLButtonElement>(".qk-matrix-cancel")!);
    expect(screen.getByRole("button", { name: "S key 6 Sine" })).toBeTruthy();
  });
});
