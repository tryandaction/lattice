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

  it("keeps different formulas whose generated slugs collide", () => {
    const superscript = buildFormulaRecord("x^2", { label: "Square", now: 100 });
    const subscript = buildFormulaRecord("x_2", { label: "Second item", now: 200 });
    useQuantumFormulaLibraryStore.getState().upsertFormulaRecord(superscript);
    useQuantumFormulaLibraryStore.getState().upsertFormulaRecord(subscript);
    useQuantumFormulaLibraryStore.getState().upsertFormulaRecord({ ...subscript, label: "Second component" });
    const records = useQuantumFormulaLibraryStore.getState().records;
    expect(records.map(record => record.latex)).toEqual(["x_2", "x^2"]);
    expect(new Set(records.map(record => record.id)).size).toBe(2);
    expect(records[0].label).toBe("Second component");
  });

  it("rejects formulas that normalize to empty content", () => {
    useQuantumFormulaLibraryStore.getState().upsertFormulaRecord(buildFormulaRecord("$ $", { label: "Empty" }));
    expect(useQuantumFormulaLibraryStore.getState().records).toEqual([]);
  });

  it("preserves a saved display formula's mode when its name or content is edited", () => {
    const energy = buildFormulaRecord("$$E=mc^2$$", { label: "Energy", now: 100 });
    useQuantumFormulaLibraryStore.getState().upsertFormulaRecord(energy);
    useQuantumFormulaLibraryStore.getState().updateFormulaRecord(energy.id, "Mass energy", energy.latex);
    expect(useQuantumFormulaLibraryStore.getState().records[0]).toMatchObject({
      id: energy.id, label: "Mass energy", displayMode: true, markdown: "$$E=mc^2$$", createdAt: 100,
    });
    useQuantumFormulaLibraryStore.getState().updateFormulaRecord(energy.id, "Relativistic energy", "E^2=p^2c^2+m^2c^4");
    expect(useQuantumFormulaLibraryStore.getState().records[0]).toMatchObject({
      displayMode: true, markdown: "$$E^2=p^2c^2+m^2c^4$$",
    });
  });

  it("recovers incomplete legacy records and ignores malformed entries", async () => {
    localStorage.setItem("quantum-formula-library", JSON.stringify({ version: 0, state: {
      records: [null, { id: "legacy", label: "Integral", latex: "\\int_0^1", createdAt: 10, updatedAt: 20 }],
    } }));
    await useQuantumFormulaLibraryStore.persist.rehydrate();
    expect(useQuantumFormulaLibraryStore.getState().records).toHaveLength(1);
    expect(useQuantumFormulaLibraryStore.getState().queryFormulaRecords("Integral")[0]).toMatchObject({
      id: "legacy", latex: "\\int_0^1", markdown: "$\\int_0^1$", createdAt: 10,
    });
  });
});
