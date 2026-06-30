import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  getQuantumLayerMeanings,
  type QuantumKeyMeaning,
  type QuantumLayerId,
} from "@/config/quantum-keymap";
import { createSafeJSONStorage } from "@/lib/persist-storage";

export type QuantumMeaningOverride = Partial<Pick<
  QuantumKeyMeaning,
  "label" | "latex" | "mathlive" | "markdown" | "displayMode" | "templateKind"
>>;

export type QuantumLayerOverrides = Partial<Record<QuantumLayerId, Record<string, QuantumMeaningOverride>>>;
export type QuantumKeymapOverrides = Record<string, QuantumLayerOverrides | undefined>;

export interface QuantumKeymapCustomizationState {
  overrides: QuantumKeymapOverrides;
  updateMeaning: (
    keyCode: string,
    layer: QuantumLayerId,
    meaningId: string,
    patch: QuantumMeaningOverride,
  ) => void;
  resetMeaning: (keyCode: string, layer: QuantumLayerId, meaningId: string) => void;
  resetKey: (keyCode: string) => void;
  resetAll: () => void;
}

const EDITABLE_TEXT_FIELDS = ["label", "latex", "mathlive", "markdown"] as const;

function normalizeOverride(patch: QuantumMeaningOverride): QuantumMeaningOverride {
  const normalized: QuantumMeaningOverride = {};
  for (const field of EDITABLE_TEXT_FIELDS) {
    if (field in patch) {
      const value = patch[field];
      if (typeof value === "string") {
        normalized[field] = value;
      }
    }
  }
  if (typeof patch.displayMode === "boolean") normalized.displayMode = patch.displayMode;
  if (patch.templateKind) normalized.templateKind = patch.templateKind;
  return normalized;
}

function isEmptyOverride(override: QuantumMeaningOverride | undefined): boolean {
  return !override || Object.keys(override).length === 0;
}

export function applyQuantumMeaningOverride(
  meaning: QuantumKeyMeaning,
  override: QuantumMeaningOverride | undefined,
): QuantumKeyMeaning {
  if (isEmptyOverride(override)) return meaning;
  const nextLabel = typeof override?.label === "string" && override.label.trim()
    ? override.label.trim()
    : meaning.label;
  const nextLatex = typeof override?.latex === "string" && override.latex.trim()
    ? override.latex.trim()
    : meaning.latex;
  return {
    ...meaning,
    ...override,
    label: nextLabel,
    latex: nextLatex,
    id: meaning.id,
    category: meaning.category,
    keywords: meaning.keywords,
  };
}

export function getEffectiveQuantumLayerMeanings(
  keyCode: string,
  layer: QuantumLayerId,
  overrides: QuantumKeymapOverrides = {},
): QuantumKeyMeaning[] {
  const layerOverrides = overrides[keyCode]?.[layer] ?? {};
  return getQuantumLayerMeanings(keyCode, layer).map((meaning) => (
    applyQuantumMeaningOverride(meaning, layerOverrides[meaning.id])
  ));
}

export function getEffectiveQuantumMeaning(
  keyCode: string,
  layer: QuantumLayerId,
  oneBasedIndex: number,
  overrides: QuantumKeymapOverrides = {},
): QuantumKeyMeaning | null {
  const meanings = getEffectiveQuantumLayerMeanings(keyCode, layer, overrides);
  if (meanings.length === 0) return null;
  const safeIndex = Math.max(1, Math.min(Math.trunc(oneBasedIndex), meanings.length));
  return meanings[safeIndex - 1] ?? null;
}

export const useQuantumKeymapStore = create<QuantumKeymapCustomizationState>()(
  persist(
    (set) => ({
      overrides: {},

      updateMeaning: (keyCode, layer, meaningId, patch) => {
        const official = getQuantumLayerMeanings(keyCode, layer).some((meaning) => meaning.id === meaningId);
        if (!official) return;

        set((state) => {
          const keyOverrides = state.overrides[keyCode] ?? {};
          const layerOverrides = keyOverrides[layer] ?? {};
          const nextOverride = {
            ...(layerOverrides[meaningId] ?? {}),
            ...normalizeOverride(patch),
          };

          return {
            overrides: {
              ...state.overrides,
              [keyCode]: {
                ...keyOverrides,
                [layer]: {
                  ...layerOverrides,
                  [meaningId]: nextOverride,
                },
              },
            },
          };
        });
      },

      resetMeaning: (keyCode, layer, meaningId) => {
        set((state) => {
          const keyOverrides = state.overrides[keyCode];
          const layerOverrides = keyOverrides?.[layer];
          if (!keyOverrides || !layerOverrides?.[meaningId]) return state;

          const { [meaningId]: _removed, ...remainingLayer } = layerOverrides;
          const nextKeyOverrides = { ...keyOverrides };
          if (Object.keys(remainingLayer).length > 0) {
            nextKeyOverrides[layer] = remainingLayer;
          } else {
            delete nextKeyOverrides[layer];
          }

          const nextOverrides = { ...state.overrides };
          if (Object.keys(nextKeyOverrides).length > 0) {
            nextOverrides[keyCode] = nextKeyOverrides;
          } else {
            delete nextOverrides[keyCode];
          }

          return { overrides: nextOverrides };
        });
      },

      resetKey: (keyCode) => {
        set((state) => {
          const { [keyCode]: _removed, ...remaining } = state.overrides;
          return { overrides: remaining };
        });
      },

      resetAll: () => {
        set({ overrides: {} });
      },
    }),
    {
      name: "quantum-keyboard-keymap",
      storage: createSafeJSONStorage<QuantumKeymapCustomizationState>(),
      partialize: (state) => ({ overrides: state.overrides }) as QuantumKeymapCustomizationState,
    },
  ),
);
