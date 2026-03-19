import { create } from 'zustand';
import { getStorageAdapter } from '@/lib/storage-adapter';
import type { SelectionAiMode } from '@/lib/ai/types';

const SELECTION_AI_STORAGE_KEY = 'lattice-selection-ai';
const RECENT_PROMPT_LIMIT = 8;

export interface SelectionRecentPrompt {
  mode: SelectionAiMode;
  prompt: string;
  createdAt: number;
}

interface PersistedSelectionAiState {
  preferredMode: SelectionAiMode;
  recentPrompts: SelectionRecentPrompt[];
}

interface SelectionAiActions {
  setPreferredMode: (mode: SelectionAiMode) => void;
  rememberPrompt: (mode: SelectionAiMode, prompt: string) => void;
  clearRecentPrompts: () => void;
}

export type SelectionAiStore = PersistedSelectionAiState & SelectionAiActions;

const DEFAULT_STATE: PersistedSelectionAiState = {
  preferredMode: 'chat',
  recentPrompts: [],
};

function normalizePrompt(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim();
}

function safeReadInitialState(): PersistedSelectionAiState {
  if (typeof window === 'undefined') {
    return DEFAULT_STATE;
  }

  try {
    const raw = window.localStorage.getItem(SELECTION_AI_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_STATE;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedSelectionAiState>;
    return {
      preferredMode: parsed.preferredMode === 'agent' || parsed.preferredMode === 'plan' ? parsed.preferredMode : 'chat',
      recentPrompts: Array.isArray(parsed.recentPrompts)
        ? parsed.recentPrompts
            .filter((item): item is SelectionRecentPrompt =>
              typeof item?.prompt === 'string' &&
              (item.mode === 'chat' || item.mode === 'agent' || item.mode === 'plan') &&
              typeof item.createdAt === 'number'
            )
            .slice(0, RECENT_PROMPT_LIMIT)
        : [],
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function persistSelectionAiState(state: PersistedSelectionAiState) {
  const storage = getStorageAdapter();
  void storage.set(SELECTION_AI_STORAGE_KEY, state);
}

export const useSelectionAiStore = create<SelectionAiStore>((set, get) => ({
  ...safeReadInitialState(),

  setPreferredMode: (mode) => {
    set({ preferredMode: mode });
    persistSelectionAiState({
      preferredMode: mode,
      recentPrompts: get().recentPrompts,
    });
  },

  rememberPrompt: (mode, prompt) => {
    const normalized = normalizePrompt(prompt);
    if (!normalized) {
      return;
    }

    const nextRecentPrompts = [
      {
        mode,
        prompt: normalized,
        createdAt: Date.now(),
      },
      ...get().recentPrompts.filter((item) => !(item.mode === mode && normalizePrompt(item.prompt) === normalized)),
    ].slice(0, RECENT_PROMPT_LIMIT);

    set({ recentPrompts: nextRecentPrompts });
    persistSelectionAiState({
      preferredMode: get().preferredMode,
      recentPrompts: nextRecentPrompts,
    });
  },

  clearRecentPrompts: () => {
    set({ recentPrompts: [] });
    persistSelectionAiState({
      preferredMode: get().preferredMode,
      recentPrompts: [],
    });
  },
}));
