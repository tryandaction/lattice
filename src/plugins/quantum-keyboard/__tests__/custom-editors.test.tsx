import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useQuantumFormulaLibraryStore } from "@/stores/quantum-formula-library-store";
import { useQuantumKeymapStore } from "@/stores/quantum-keymap-store";
import { useQuantumCustomStore } from "@/stores/quantum-custom-store";
import { buildFormulaRecord } from "@/lib/formula-composer";
import { MyFormulasEditor } from "../my-formulas-editor";
import { QuantumKeyboardEditor } from "../keymap-editor";
import { useQuantumPreferences } from "../preferences";

beforeEach(() => {
  useQuantumFormulaLibraryStore.getState().clearFormulaLibrary();
  useQuantumKeymapStore.getState().resetAll();
  useQuantumCustomStore.getState().resetAll();
  useQuantumPreferences.setState(useQuantumPreferences.getInitialState());
});

describe("custom formula editors", () => {
  it("edits a saved formula without losing its identity or favorites", () => {
    const record = buildFormulaRecord("x^2", { label: "Square", now: 10 });
    useQuantumFormulaLibraryStore.getState().upsertFormulaRecord({ ...record, favorite: true });
    render(<MyFormulasEditor />);
    fireEvent.click(screen.getByText("我的公式"));
    fireEvent.click(screen.getByRole("button", { name: "编辑 Square" }));
    const name = screen.getByRole("textbox", { name: "公式名称" });
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: "Cube" } });
    fireEvent.change(screen.getByRole("textbox", { name: "公式 LaTeX" }), { target: { value: "x^3" } });
    fireEvent.submit(screen.getByRole("form", { name: "我的公式编辑器" }));
    expect(useQuantumFormulaLibraryStore.getState().records).toEqual([expect.objectContaining({
      id: record.id, label: "Cube", latex: "x^3", favorite: true, createdAt: 10,
    })]);
    expect(screen.getByRole("status").textContent).toContain("已更新");
  });

  it("keeps an empty normalized formula in the editor for correction", () => {
    render(<MyFormulasEditor />);
    fireEvent.click(screen.getByText("我的公式"));
    fireEvent.change(screen.getByRole("textbox", { name: "公式名称" }), { target: { value: "Empty" } });
    fireEvent.change(screen.getByRole("textbox", { name: "公式 LaTeX" }), { target: { value: "$ $" } });
    fireEvent.submit(screen.getByRole("form", { name: "我的公式编辑器" }));
    expect(useQuantumFormulaLibraryStore.getState().records).toHaveLength(0);
    expect((screen.getByRole("textbox", { name: "公式 LaTeX" }) as HTMLTextAreaElement).value).toBe("$ $");
    expect(screen.getByRole("alert").textContent).toContain("有效");
    expect(screen.getByRole("textbox", { name: "公式 LaTeX" }).getAttribute("aria-describedby")).toBe("quantum-formula-error");
  });

  it("opens the selected physical key and names each editable candidate", () => {
    useQuantumPreferences.setState({ selectedKey: "KeyF", layer: "ctrl" });
    render(<QuantumKeyboardEditor />);
    const field = screen.getByRole("textbox", { name: "F · 1 · LaTeX" });
    fireEvent.change(field, { target: { value: "\\mathcal{F}" } });
    expect(useQuantumKeymapStore.getState().overrides.KeyF?.ctrl?.["ctrl-KeyF-1"]?.latex).toBe("\\mathcal{F}");
    expect(useQuantumPreferences.getState().mappingSource).toBe("custom");
  });

  it("edits archived meanings in a separate search-only section", () => {
    useQuantumPreferences.setState({ selectedKey: "KeyI", layer: "ctrl" });
    render(<QuantumKeyboardEditor />);
    fireEvent.click(screen.getByText("归档含义 · 仅用于查找"));
    fireEvent.change(screen.getByRole("textbox", { name: "I · 归档 ctrl-KeyI-1 · LaTeX" }), { target: { value: "I_0" } });
    expect(useQuantumKeymapStore.getState().overrides.KeyI?.ctrl?.["ctrl-KeyI-1"]?.latex).toBe("I_0");
  });

  it("adds a candidate to the selected key and edits the saved symbol", () => {
    useQuantumPreferences.setState({ selectedKey: "KeyI", layer: "base" });
    render(<QuantumKeyboardEditor />);
    fireEvent.change(screen.getByRole("textbox", { name: "添加 I 键候选 LaTeX" }), { target: { value: "\\mathcal{I}" } });
    fireEvent.submit(screen.getByRole("form", { name: "添加 I 键候选" }));
    expect(useQuantumCustomStore.getState().getCustomSymbols("KeyI")).toEqual(["\\mathcal{I}"]);
    const custom = screen.getByRole("textbox", { name: "I · 自定义 1 · LaTeX" });
    fireEvent.change(custom, { target: { value: "\\mathscr{I}" } });
    fireEvent.blur(custom);
    expect(useQuantumCustomStore.getState().getCustomSymbols("KeyI")).toEqual(["\\mathscr{I}"]);
    expect(useQuantumPreferences.getState().mappingSource).toBe("custom");
  });

  it("keeps focus and row identity when a custom formula is edited", () => {
    useQuantumPreferences.setState({ selectedKey: "KeyI", layer: "base" });
    useQuantumCustomStore.getState().addCustomSymbol("KeyI", "\\mathcal{I}");
    render(<QuantumKeyboardEditor />);
    const input = screen.getByRole("textbox", { name: "I · 自定义 1 · LaTeX" });
    const row = input.parentElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "\\mathscr{I}" } });
    fireEvent.blur(input);
    expect(screen.getByRole("textbox", { name: "I · 自定义 1 · LaTeX" })).toBe(input);
    expect(input.parentElement).toBe(row);
    expect(useQuantumCustomStore.getState().getCustomSymbols("KeyI")).toEqual(["\\mathscr{I}"]);
  });

  it("syncs keyboard focus selection from the map editor back to preferences", () => {
    render(<QuantumKeyboardEditor />);
    fireEvent.keyDown(screen.getByRole("button", { name: /^F$/ }), { key: "i" });
    expect(useQuantumPreferences.getState().selectedKey).toBe("KeyI");
  });

  it("keeps a custom candidate row stable while editing and rejects official duplicates", () => {
    useQuantumPreferences.setState({ selectedKey: "KeyI", layer: "base" });
    useQuantumCustomStore.getState().addCustomSymbol("KeyI", "\\mathcal{I}");
    render(<QuantumKeyboardEditor />);
    const custom = screen.getByRole("textbox", { name: "I · 自定义 1 · LaTeX" });
    fireEvent.focus(custom);
    fireEvent.change(custom, { target: { value: "\\int" } });
    fireEvent.blur(custom);
    expect(useQuantumCustomStore.getState().getCustomSymbols("KeyI")).toEqual(["\\mathcal{I}"]);
    expect(screen.getByRole("status").textContent).toContain("重复");
  });

  it("saves from the formula field with Ctrl+Enter and persists the result", () => {
    render(<MyFormulasEditor />);
    fireEvent.click(screen.getByText("我的公式"));
    fireEvent.change(screen.getByRole("textbox", { name: "公式名称" }), { target: { value: "Root" } });
    const formula = screen.getByRole("textbox", { name: "公式 LaTeX" });
    fireEvent.change(formula, { target: { value: "\\sqrt{x}" } });
    fireEvent.keyDown(formula, { key: "Enter", ctrlKey: true });
    expect(useQuantumFormulaLibraryStore.getState().records).toHaveLength(1);
    const saved = localStorage.getItem("quantum-formula-library");
    expect(JSON.parse(saved!).state.records[0]).toMatchObject({ label: "Root", latex: "\\sqrt{x}" });
  });

  it("cancels formula edits with Escape while preserving the saved record", () => {
    useQuantumFormulaLibraryStore.getState().upsertFormulaRecord(buildFormulaRecord("x^2", { label: "Square" }));
    render(<MyFormulasEditor />);
    fireEvent.click(screen.getByText("我的公式"));
    fireEvent.click(screen.getByRole("button", { name: "编辑 Square" }));
    const formula = screen.getByRole("textbox", { name: "公式 LaTeX" });
    fireEvent.change(formula, { target: { value: "x^3" } });
    fireEvent.keyDown(formula, { key: "Escape" });
    expect(useQuantumFormulaLibraryStore.getState().records[0].latex).toBe("x^2");
    expect(screen.queryByRole("button", { name: "取消编辑" })).toBeNull();
  });

  it("selects editing keys with letters and arrows without inserting text", () => {
    render(<QuantumKeyboardEditor />);
    fireEvent.keyDown(screen.getByRole("button", { name: "F" }), { key: "i" });
    expect(screen.getByRole("textbox", { name: "I · 1 · LaTeX" })).toBeTruthy();
    const iKey = screen.getByRole("button", { name: "I" });
    expect(document.activeElement).toBe(iKey);
    fireEvent.keyDown(iKey, { key: "ArrowRight" });
    expect(screen.getByRole("textbox", { name: "O · 1 · LaTeX" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "O" }));
  });
});
