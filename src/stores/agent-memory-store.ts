import { create } from 'zustand';
import {
  createAgentMemoryEntry,
  memoryMatchesQuery,
  sortAgentMemoryEntries,
  type AgentMemoryEntry,
  type AgentMemoryQuery,
  type AgentMemoryStatus,
  type CreateAgentMemoryEntryInput,
} from '@/lib/ai/agent-memory';
import { getStorageAdapter } from '@/lib/storage-adapter';

const AGENT_MEMORY_STORAGE_KEY = 'lattice-agent-memory-v1';
const MAX_PERSISTED_MEMORY_ENTRIES = 300;

interface AgentMemoryState {
  entries: AgentMemoryEntry[];
  loaded: boolean;
}

interface AgentMemoryActions {
  addMemory: (input: CreateAgentMemoryEntryInput) => string;
  updateMemory: (
    id: string,
    patch: Partial<Pick<AgentMemoryEntry, 'title' | 'content' | 'source' | 'tags'>>,
  ) => void;
  setPinned: (id: string, pinned: boolean) => void;
  setStatus: (id: string, status: AgentMemoryStatus) => void;
  disableMemory: (id: string) => void;
  deleteMemory: (id: string) => void;
  restoreMemory: (id: string) => void;
  getMemory: (id: string) => AgentMemoryEntry | null;
  queryMemories: (query?: AgentMemoryQuery) => AgentMemoryEntry[];
  loadMemories: () => Promise<void>;
}

function normalizeEntries(entries: AgentMemoryEntry[] = []): AgentMemoryEntry[] {
  return sortAgentMemoryEntries(entries)
    .slice(0, MAX_PERSISTED_MEMORY_ENTRIES);
}

async function persistEntries(entries: AgentMemoryEntry[]) {
  try {
    await getStorageAdapter().set(AGENT_MEMORY_STORAGE_KEY, {
      entries: normalizeEntries(entries),
    });
  } catch (error) {
    console.error('Failed to save agent memory:', error);
  }
}

function updateEntry(
  entries: AgentMemoryEntry[],
  id: string,
  updater: (entry: AgentMemoryEntry) => AgentMemoryEntry,
): AgentMemoryEntry[] {
  return normalizeEntries(entries.map((entry) => entry.id === id ? updater(entry) : entry));
}

export const useAgentMemoryStore = create<AgentMemoryState & AgentMemoryActions>((set, get) => ({
  entries: [],
  loaded: false,

  addMemory: (input) => {
    const entry = createAgentMemoryEntry(input);
    set((state) => ({
      entries: normalizeEntries([entry, ...state.entries]),
    }));
    void persistEntries(get().entries);
    return entry.id;
  },

  updateMemory: (id, patch) => {
    const now = Date.now();
    set((state) => ({
      entries: updateEntry(state.entries, id, (entry) => ({
        ...entry,
        ...patch,
        title: patch.title?.trim() ?? entry.title,
        content: patch.content?.trim() ?? entry.content,
        updatedAt: now,
      })),
    }));
    void persistEntries(get().entries);
  },

  setPinned: (id, pinned) => {
    const now = Date.now();
    set((state) => ({
      entries: updateEntry(state.entries, id, (entry) => ({
        ...entry,
        pinned,
        updatedAt: now,
      })),
    }));
    void persistEntries(get().entries);
  },

  setStatus: (id, status) => {
    const now = Date.now();
    set((state) => ({
      entries: updateEntry(state.entries, id, (entry) => ({
        ...entry,
        status,
        updatedAt: now,
      })),
    }));
    void persistEntries(get().entries);
  },

  disableMemory: (id) => get().setStatus(id, 'disabled'),
  deleteMemory: (id) => get().setStatus(id, 'deleted'),
  restoreMemory: (id) => get().setStatus(id, 'active'),

  getMemory: (id) => get().entries.find((entry) => entry.id === id) ?? null,

  queryMemories: (query = {}) => {
    const entries = sortAgentMemoryEntries(
      get().entries.filter((entry) => memoryMatchesQuery(entry, query)),
    );
    return typeof query.limit === 'number' ? entries.slice(0, query.limit) : entries;
  },

  loadMemories: async () => {
    try {
      const saved = await getStorageAdapter().get<AgentMemoryState>(AGENT_MEMORY_STORAGE_KEY);
      set({
        entries: normalizeEntries(saved?.entries ?? []),
        loaded: true,
      });
    } catch (error) {
      console.error('Failed to load agent memory:', error);
      set({ loaded: true });
    }
  },
}));
