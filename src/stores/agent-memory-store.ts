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
  persistenceError: 'load' | 'save' | null;
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

function updateEntry(
  entries: AgentMemoryEntry[],
  id: string,
  updater: (entry: AgentMemoryEntry) => AgentMemoryEntry,
): AgentMemoryEntry[] {
  return normalizeEntries(entries.map((entry) => entry.id === id ? updater(entry) : entry));
}

export const useAgentMemoryStore = create<AgentMemoryState & AgentMemoryActions>((set, get) => {
  let hydration: Promise<void> | null = null;
  let writeQueue: Promise<void> = Promise.resolve();
  let revision = 0;
  let persistedRevision = 0;

  const ensureLoaded = (): Promise<void> => {
    if (get().loaded) return Promise.resolve();
    if (hydration) return hydration;
    hydration = (async () => {
      try {
        const storage = getStorageAdapter();
        const saved = await (storage.getStrict ?? storage.get).call(storage, AGENT_MEMORY_STORAGE_KEY) as AgentMemoryState | null;
        if (saved && !Array.isArray(saved.entries)) throw new Error('Invalid saved agent memory');
        // In-memory edits made during loading win, including disabled/deleted entries.
        const entries = new Map((saved?.entries ?? []).map((entry) => [entry.id, entry]));
        for (const entry of get().entries) entries.set(entry.id, entry);
        set({ entries: normalizeEntries([...entries.values()]), loaded: true, persistenceError: null });
      } catch (error) {
        console.error('Failed to load agent memory:', error);
        // An unreadable store must never become a writable empty store.
        set({ persistenceError: 'load' });
      }
    })().finally(() => { hydration = null; });
    return hydration;
  };

  const persistEntries = (): Promise<void> => {
    writeQueue = writeQueue.then(async () => {
      await ensureLoaded();
      if (!get().loaded || revision === persistedRevision) return;
      const snapshotRevision = revision;
      const storage = getStorageAdapter();
      await (storage.setStrict ?? storage.set).call(storage, AGENT_MEMORY_STORAGE_KEY, { entries: get().entries });
      persistedRevision = snapshotRevision;
      set({ persistenceError: null });
    }).catch((error) => {
      console.error('Failed to save agent memory:', error);
      set({ persistenceError: 'save' });
    });
    return writeQueue;
  };

  const saveMutation = () => {
    revision += 1;
    void persistEntries();
  };

  return {
  entries: [],
  loaded: false,
  persistenceError: null,

  addMemory: (input) => {
    const entry = createAgentMemoryEntry(input);
    set((state) => ({
      entries: normalizeEntries([entry, ...state.entries]),
    }));
    saveMutation();
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
    saveMutation();
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
    saveMutation();
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
    saveMutation();
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
    await ensureLoaded();
    if (get().loaded && revision !== persistedRevision) await persistEntries();
  },
  };
});
