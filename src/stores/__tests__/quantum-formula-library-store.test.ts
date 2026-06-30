import { beforeEach, describe, expect, it } from "vitest";
import { buildFormulaRecord } from "@/lib/formula-composer";
import { useQuantumFormulaLibraryStore } from "../quantum-formula-library-store";

describe("quantum formula library store", () => {
  beforeEach(() => {
    useQuantumFormulaLibraryStore.getState().clearFormulaLibrary();
  });

  it("adds formulas once, updates existing records, and keeps newest first", () => {
    const alpha = buildFormulaRecord("\\alpha", { label: "Alpha", now: 100 });
    const beta = buildFormulaRecord("\\beta", { label: "Beta", now: 200 });

    useQuantumFormulaLibraryStore.getState().upsertFormulaRecord(alpha);
    useQuantumFormulaLibraryStore.getState().upsertFormulaRecord(beta);
    useQuantumFormulaLibraryStore.getState().upsertFormulaRecord({
      ...alpha,
      label: "Alpha particle",
      updatedAt: 300,
    });

    expect(useQuantumFormulaLibraryStore.getState().records.map((record) => record.label)).toEqual([
      "Alpha particle",
      "Beta",
    ]);
    expect(useQuantumFormulaLibraryStore.getState().records[0].createdAt).toBe(100);
  });

  it("renames and favorites formulas without changing formula payloads", () => {
    const ratio = buildFormulaRecord("\\frac{a}{b}", { label: "Ratio", now: 100 });
    useQuantumFormulaLibraryStore.getState().upsertFormulaRecord(ratio);

    useQuantumFormulaLibraryStore.getState().renameFormulaRecord(ratio.id, "  Quotient  ");
    useQuantumFormulaLibraryStore.getState().toggleFormulaFavorite(ratio.id);

    const stored = useQuantumFormulaLibraryStore.getState().records[0];
    expect(stored).toMatchObject({
      id: ratio.id,
      label: "Quotient",
      latex: "\\frac{a}{b}",
      markdown: "$\\frac{a}{b}$",
      favorite: true,
      createdAt: 100,
    });
    expect(stored.updatedAt).toBeGreaterThanOrEqual(100);
  });

  it("queries formulas with favorites first and bounded results", () => {
    const alpha = buildFormulaRecord("\\alpha", { label: "Alpha", now: 100 });
    const area = buildFormulaRecord("$$\\int_0^1 x dx$$", { label: "Area", now: 200 });
    const ratio = buildFormulaRecord("\\frac{a}{b}", { label: "Ratio", now: 300 });

    useQuantumFormulaLibraryStore.getState().upsertFormulaRecord(alpha);
    useQuantumFormulaLibraryStore.getState().upsertFormulaRecord(area);
    useQuantumFormulaLibraryStore.getState().upsertFormulaRecord(ratio);
    useQuantumFormulaLibraryStore.getState().toggleFormulaFavorite(alpha.id);

    expect(useQuantumFormulaLibraryStore.getState().queryFormulaRecords("").map((record) => record.label)).toEqual([
      "Alpha",
      "Ratio",
      "Area",
    ]);
    expect(useQuantumFormulaLibraryStore.getState().queryFormulaRecords("int").map((record) => record.label)).toEqual([
      "Area",
    ]);
    expect(useQuantumFormulaLibraryStore.getState().queryFormulaRecords("", 2)).toHaveLength(2);
  });
});
