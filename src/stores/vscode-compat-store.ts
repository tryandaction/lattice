"use client";

import { create } from "zustand";
import { normalizeVSCodeExtensionInventory } from "@/lib/vscode-compat/extensions";
import { createDefaultVSCodeWorkbenchSettings, importVSCodeSettingsFile } from "@/lib/vscode-compat/mapper";
import type {
  VSCodeSettingsFile,
  VSCodeWorkbenchSettings,
  VSCodeSnippetDefinition,
  VSCodeTask,
  VSCodeLaunchConfiguration,
  VSCodeKeybinding,
  VSCodeExtensionInventoryEntry,
} from "@/lib/vscode-compat/types";

const STORAGE_KEY = "lattice-vscode-compat-workbench";

export interface VSCodeCompatState {
  settings: VSCodeWorkbenchSettings;
  keybindings: VSCodeKeybinding[];
  snippets: VSCodeSnippetDefinition[];
  tasks: VSCodeTask[];
  launches: VSCodeLaunchConfiguration[];
  extensions: VSCodeExtensionInventoryEntry[];
  importedAt: number | null;
  sourceLabel: string | null;
  warnings: string[];
}

interface VSCodeCompatActions {
  load: () => Promise<void>;
  importFromJson: (source: VSCodeSettingsFile, sourceLabel?: string | null, warnings?: string[]) => Promise<void>;
  replaceState: (nextState: Partial<VSCodeCompatState>) => Promise<void>;
  reset: () => Promise<void>;
}

export type VSCodeCompatStore = VSCodeCompatState & VSCodeCompatActions;

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function readPersistedState(): VSCodeCompatState | null {
  const storage = getStorage();
  if (!storage) return null;
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as VSCodeCompatState;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      settings: parsed.settings ?? createDefaultVSCodeWorkbenchSettings(),
      keybindings: Array.isArray(parsed.keybindings) ? parsed.keybindings : [],
      snippets: Array.isArray(parsed.snippets) ? parsed.snippets : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      launches: Array.isArray(parsed.launches) ? parsed.launches : [],
      extensions: Array.isArray(parsed.extensions)
        ? normalizeVSCodeExtensionInventory(parsed.extensions.filter((entry): entry is VSCodeExtensionInventoryEntry => {
          return Boolean(entry && typeof entry === "object" && typeof entry.id === "string");
        }))
        : [],
      importedAt: typeof parsed.importedAt === "number" ? parsed.importedAt : null,
      sourceLabel: typeof parsed.sourceLabel === "string" ? parsed.sourceLabel : null,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((item): item is string => typeof item === "string") : [],
    };
  } catch {
    return null;
  }
}

function persistState(state: VSCodeCompatState): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const DEFAULT_STATE: VSCodeCompatState = {
  settings: createDefaultVSCodeWorkbenchSettings(),
  keybindings: [],
  snippets: [],
  tasks: [],
  launches: [],
  extensions: [],
  importedAt: null,
  sourceLabel: null,
  warnings: [],
};

export const useVSCodeCompatStore = create<VSCodeCompatStore>((set) => ({
  ...DEFAULT_STATE,

  load: async () => {
    const persisted = readPersistedState();
    if (persisted) {
      set(persisted);
    }
  },

  importFromJson: async (source, sourceLabel = null, importWarnings = []) => {
    const imported = importVSCodeSettingsFile(source);
    const nextState: VSCodeCompatState = {
      settings: imported.settings,
      keybindings: imported.keybindings,
      snippets: imported.snippets,
      tasks: imported.tasks,
      launches: imported.launches,
      extensions: normalizeVSCodeExtensionInventory(imported.extensions),
      importedAt: Date.now(),
      sourceLabel,
      warnings: [...imported.warnings, ...importWarnings],
    };
    set(nextState);
    persistState(nextState);
  },

  replaceState: async (nextState) => {
    const merged: VSCodeCompatState = {
      ...DEFAULT_STATE,
      ...readPersistedState(),
      ...nextState,
      settings: nextState.settings ?? readPersistedState()?.settings ?? DEFAULT_STATE.settings,
      keybindings: nextState.keybindings ?? readPersistedState()?.keybindings ?? DEFAULT_STATE.keybindings,
      snippets: nextState.snippets ?? readPersistedState()?.snippets ?? DEFAULT_STATE.snippets,
      tasks: nextState.tasks ?? readPersistedState()?.tasks ?? DEFAULT_STATE.tasks,
      launches: nextState.launches ?? readPersistedState()?.launches ?? DEFAULT_STATE.launches,
      extensions: normalizeVSCodeExtensionInventory(
        nextState.extensions ?? readPersistedState()?.extensions ?? DEFAULT_STATE.extensions,
      ),
      warnings: nextState.warnings ?? readPersistedState()?.warnings ?? DEFAULT_STATE.warnings,
    };
    set(merged);
    persistState(merged);
  },

  reset: async () => {
    set(DEFAULT_STATE);
    persistState(DEFAULT_STATE);
  },
}));
