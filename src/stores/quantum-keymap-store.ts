import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  getAllQuantumLayerMeanings,
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
  if (patch.templateKind && ["symbol", "structure", "matrix", "bracket", "operator"].includes(patch.templateKind)) normalized.templateKind = patch.templateKind;
  return normalized;
}

function restoreOverrides(value: unknown): QuantumKeymapOverrides {
  if (!value || typeof value !== "object") return {};
  const keys: [string, QuantumLayerOverrides][] = [];
  for (const [keyCode, rawKey] of Object.entries(value)) {
    if (!rawKey || typeof rawKey !== "object") continue;
    const layers: QuantumLayerOverrides = {};
    for (const layer of ["base", "ctrl"] as const) {
      const rawLayer = (rawKey as QuantumLayerOverrides)[layer];
      if (!rawLayer || typeof rawLayer !== "object") continue;
      const entries = Object.entries(rawLayer).flatMap(([id, raw]) => {
        if (!raw || typeof raw !== "object") return [];
        const override = normalizeOverride(raw);
        return Object.keys(override).length ? [[id, override] as const] : [];
      });
      if (entries.length) layers[layer] = Object.fromEntries(entries);
    }
    if (Object.keys(layers).length) keys.push([keyCode, layers]);
  }
  return Object.fromEntries(keys);
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

export function getAllEffectiveQuantumLayerMeanings(
  keyCode: string,
  layer: QuantumLayerId,
  overrides: QuantumKeymapOverrides = {},
): QuantumKeyMeaning[] {
  const layerOverrides = overrides[keyCode]?.[layer] ?? {};
  return getAllQuantumLayerMeanings(keyCode, layer).map(meaning => applyQuantumMeaningOverride(meaning, layerOverrides[meaning.id]));
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
        const official = getAllQuantumLayerMeanings(keyCode, layer).some((meaning) => meaning.id === meaningId);
        if (!official) return;

        set((state) => {
          const keyOverrides = state.overrides[keyCode] ?? {};
          const layerOverrides = keyOverrides[layer] ?? {};
          const nextOverride = {
            ...(layerOverrides[meaningId] ?? {}),
            ...normalizeOverride(patch),
          };
          if (typeof patch.latex === "string" && patch.latex !== layerOverrides[meaningId]?.latex) {
            if (!("mathlive" in patch)) delete nextOverride.mathlive;
            if (!("markdown" in patch)) delete nextOverride.markdown;
          }

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
      merge: (value, current) => ({
        ...current,
        overrides: restoreOverrides((value as Partial<QuantumKeymapCustomizationState> | null)?.overrides),
      }),
      partialize: (state) => ({ overrides: state.overrides }) as QuantumKeymapCustomizationState,
    },
  ),
);
