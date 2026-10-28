import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJSONStorage } from "@/lib/persist-storage";
import { KEY_LABELS, type QuantumLayerId } from "@/config/quantum-keymap";
import type { CatalogSection } from "./catalog";

interface QuantumPreferences {
  view: "browse" | "keys";
  mappingSource: "official" | "custom";
  section: CatalogSection;
  favorites: string[];
  recent: string[];
  shortcutMode: boolean;
  layer: QuantumLayerId;
  selectedKey: string;
  toggleFavorite: (id: string) => void;
  recordUse: (id: string) => void;
}

const SECTIONS: CatalogSection[] = ["all", "common", "favorites", "recent", "structure", "greek", "calculus", "algebra", "relations", "sets", "physics", "chemistry", "engineering", "symbols", "custom"];

function savedIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && Boolean(id.trim())))] : [];
}

function mergePreferences(value: unknown, current: QuantumPreferences): QuantumPreferences {
  const saved = value && typeof value === "object" ? value as Partial<QuantumPreferences> : {};
  return {
    ...current,
    view: "keys",
    mappingSource: saved.mappingSource === "custom" ? "custom" : "official",
    section: SECTIONS.includes(saved.section as CatalogSection) ? saved.section! : "all",
    favorites: savedIds(saved.favorites),
    recent: savedIds(saved.recent).slice(0, 24),
    shortcutMode: true,
    layer: saved.layer === "ctrl" ? "ctrl" : "base",
    selectedKey: typeof saved.selectedKey === "string" && Object.hasOwn(KEY_LABELS, saved.selectedKey) ? saved.selectedKey : "KeyF",
  };
}
export const useQuantumPreferences = create<QuantumPreferences>()(persist(
  set => ({
    view: "keys", mappingSource: "official", section: "all", favorites: [], recent: [], shortcutMode: true, layer: "base", selectedKey: "KeyF",
    toggleFavorite: id => set(state => ({ favorites: state.favorites.includes(id) ? state.favorites.filter(item => item !== id) : [...state.favorites, id] })),
    recordUse: id => set(state => ({ recent: [id, ...state.recent.filter(item => item !== id)].slice(0, 24) })),
  }),
  {
    name: "quantum-keyboard-preferences-v1", version: 2, storage: createSafeJSONStorage<QuantumPreferences>(),
    migrate: value => {
      const saved = value && typeof value === "object" ? value as Partial<QuantumPreferences> : {};
      // Before source selection existed, user overrides were always active.
      return { ...saved, mappingSource: saved.mappingSource === "official" ? "official" : "custom" } as QuantumPreferences;
    },
    merge: mergePreferences,
    partialize: state => ({
      view: "keys", mappingSource: state.mappingSource, section: state.section, favorites: state.favorites, recent: state.recent,
      // Open the physical keyboard in symbol mode; templates enter variable mode.
      layer: state.layer, selectedKey: state.selectedKey,
    }) as QuantumPreferences,
  },
));
