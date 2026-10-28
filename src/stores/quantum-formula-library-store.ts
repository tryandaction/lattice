import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  buildFormulaRecord,
  renameFormulaRecord as renameRecord,
  searchFormulaRecords,
  toggleFavoriteFormulaRecord,
  updateRecentFormulaRecords,
  type FormulaRecord,
} from "@/lib/formula-composer";
import { createSafeJSONStorage } from "@/lib/persist-storage";

export interface QuantumFormulaLibraryState {
  records: FormulaRecord[];
  upsertFormulaRecord: (record: FormulaRecord) => void;
  renameFormulaRecord: (id: string, label: string) => void;
  updateFormulaRecord: (id: string, label: string, latex: string) => void;
  removeFormulaRecord: (id: string) => void;
  toggleFormulaFavorite: (id: string) => void;
  queryFormulaRecords: (query: string, limit?: number) => FormulaRecord[];
  clearFormulaLibrary: () => void;
}

const FORMULA_LIBRARY_LIMIT = 80;

function uniqueRecordId(records: FormulaRecord[], preferred: string): string {
  let id = preferred;
  let suffix = 2;
  while (records.some(record => record.id === id)) id = `${preferred}:${suffix++}`;
  return id;
}

function restoreRecords(value: unknown): FormulaRecord[] {
  if (!Array.isArray(value)) return [];
  const records: FormulaRecord[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || typeof raw.latex !== "string" || !raw.latex.trim()) continue;
    const record = buildFormulaRecord(raw.latex, {
      label: typeof raw.label === "string" ? raw.label : undefined,
      displayMode: typeof raw.displayMode === "boolean" ? raw.displayMode : undefined,
      now: typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
    });
    if (!record.latex) continue;
    const id = typeof raw.id === "string" && raw.id ? raw.id : record.id;
    records.push({
      ...record,
      id: uniqueRecordId(records, id),
      updatedAt: typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : record.updatedAt,
      favorite: raw.favorite === true,
      // Preserve valid source metadata and older template identifiers.
      source: ["markdown", "latex", "mathml", "omml", "unknown", "template"].includes(raw.source) ? raw.source : record.source,
      templateId: typeof raw.templateId === "string" ? raw.templateId : undefined,
    });
  }
  return records;
}

export const useQuantumFormulaLibraryStore = create<QuantumFormulaLibraryState>()(
  persist(
    (set, get) => ({
      records: [],

      upsertFormulaRecord: (record) => {
        if (!record.latex.trim()) return;
        set((state) => {
          const existing = state.records.find(item => item.latex === record.latex && item.displayMode === record.displayMode);
          const id = existing?.id ?? uniqueRecordId(state.records, record.id);
          return { records: updateRecentFormulaRecords(state.records, { ...record, id }, FORMULA_LIBRARY_LIMIT) };
        });
      },

      updateFormulaRecord: (id, label, latex) => {
        const existing = get().records.find(record => record.id === id);
        if (!existing) return;
        const next = buildFormulaRecord(latex, { label, displayMode: existing.displayMode });
        if (!next.latex) return;
        set(state => ({ records: state.records.map(record => record.id === id ? {
          ...record, ...next, id, createdAt: record.createdAt,
        } : record) }));
      },

      removeFormulaRecord: id => {
        set(state => ({ records: state.records.filter(record => record.id !== id) }));
      },

      renameFormulaRecord: (id, label) => {
        set((state) => ({
          records: state.records.map((record) => (
            record.id === id ? renameRecord(record, label) : record
          )),
        }));
      },

      toggleFormulaFavorite: (id) => {
        set((state) => ({
          records: state.records.map((record) => (
            record.id === id ? toggleFavoriteFormulaRecord(record) : record
          )),
        }));
      },

      queryFormulaRecords: (query, limit = 8) => {
        return searchFormulaRecords(get().records, query).slice(0, Math.max(1, limit));
      },

      clearFormulaLibrary: () => {
        set({ records: [] });
      },
    }),
    {
      name: "quantum-formula-library",
      storage: createSafeJSONStorage<QuantumFormulaLibraryState>(),
      merge: (value, current) => ({
        ...current,
        records: restoreRecords((value as Partial<QuantumFormulaLibraryState> | null)?.records),
      }),
      partialize: (state) => ({ records: state.records }) as QuantumFormulaLibraryState,
    },
  ),
);
