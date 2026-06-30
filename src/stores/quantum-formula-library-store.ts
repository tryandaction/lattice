import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
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
  toggleFormulaFavorite: (id: string) => void;
  queryFormulaRecords: (query: string, limit?: number) => FormulaRecord[];
  clearFormulaLibrary: () => void;
}

const FORMULA_LIBRARY_LIMIT = 80;

export const useQuantumFormulaLibraryStore = create<QuantumFormulaLibraryState>()(
  persist(
    (set, get) => ({
      records: [],

      upsertFormulaRecord: (record) => {
        set((state) => ({
          records: updateRecentFormulaRecords(state.records, record, FORMULA_LIBRARY_LIMIT),
        }));
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
      partialize: (state) => ({ records: state.records }) as QuantumFormulaLibraryState,
    },
  ),
);
