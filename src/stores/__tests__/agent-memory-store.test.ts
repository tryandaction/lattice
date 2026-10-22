import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = {
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
};

vi.mock('@/lib/storage-adapter', () => ({
  getStorageAdapter: () => storage,
}));

import { createAgentMemoryEntry, formatAgentMemoryCitation } from '@/lib/ai/agent-memory';
import { useAgentMemoryStore } from '../agent-memory-store';

describe('agent-memory-store', () => {
  beforeEach(async () => {
    await useAgentMemoryStore.getState().loadMemories();
    vi.clearAllMocks();
    storage.get.mockResolvedValue(null);
    storage.set.mockResolvedValue(undefined);
    useAgentMemoryStore.setState({
      entries: [],
      loaded: false,
      persistenceError: null,
    });
  });

  it('adds scoped memories and queries active entries by scope', async () => {
    const id = useAgentMemoryStore.getState().addMemory({
      id: 'memory-workspace-1',
      scope: 'workspace',
      title: 'Citation style',
      content: 'Prefer evidence-backed notes.',
      source: { label: 'User instruction', locator: 'settings://memory' },
      workspaceKey: 'workspace-a',
      now: 100,
    });

    expect(id).toBe('memory-workspace-1');
    expect(useAgentMemoryStore.getState().queryMemories({
      scopes: ['workspace'],
      workspaceKey: 'workspace-a',
    })).toEqual([
      expect.objectContaining({
        id: 'memory-workspace-1',
        scope: 'workspace',
      }),
    ]);
    await vi.waitFor(() => expect(storage.set).toHaveBeenCalledWith('lattice-agent-memory-v1', expect.any(Object)));
  });

  it('pins, disables, restores, and deletes memory entries without hard removal', () => {
    useAgentMemoryStore.getState().addMemory({
      id: 'regular',
      scope: 'project',
      title: 'Regular',
      content: 'Regular fact.',
      source: { label: 'Project note' },
      now: 100,
    });
    useAgentMemoryStore.getState().addMemory({
      id: 'pinned',
      scope: 'project',
      title: 'Pinned',
      content: 'Pinned fact.',
      source: { label: 'Project note' },
      now: 110,
    });

    useAgentMemoryStore.getState().setPinned('regular', true);
    expect(useAgentMemoryStore.getState().queryMemories({ scopes: ['project'] })[0].id).toBe('regular');

    useAgentMemoryStore.getState().disableMemory('regular');
    expect(useAgentMemoryStore.getState().queryMemories({ scopes: ['project'] }).map((entry) => entry.id)).toEqual(['pinned']);
    expect(useAgentMemoryStore.getState().queryMemories({
      scopes: ['project'],
      includeDisabled: true,
    }).map((entry) => entry.id)).toContain('regular');

    useAgentMemoryStore.getState().restoreMemory('regular');
    useAgentMemoryStore.getState().deleteMemory('regular');
    expect(useAgentMemoryStore.getState().getMemory('regular')).toMatchObject({
      status: 'deleted',
    });
    expect(useAgentMemoryStore.getState().queryMemories({
      includeDeleted: true,
    }).map((entry) => entry.id)).toContain('regular');
  });

  it('loads persisted entries and formats citations for UI copy actions', async () => {
    storage.get.mockResolvedValue({
      entries: [
        {
          id: 'memory-user-1',
          scope: 'user',
          title: 'Tone preference',
          content: 'Use concise Chinese.',
          source: { label: 'User preference', locator: 'chat://preference' },
          createdAt: 100,
          updatedAt: 100,
          pinned: true,
          status: 'active',
        },
      ],
    });

    await useAgentMemoryStore.getState().loadMemories();

    const entry = useAgentMemoryStore.getState().getMemory('memory-user-1');
    expect(entry).not.toBeNull();
    expect(formatAgentMemoryCitation(entry!)).toBe('[user] Tone preference - User preference (chat://preference)');
  });

  it('preserves persisted entries and an edit made while hydration is pending', async () => {
    let finishLoad!: (value: unknown) => void;
    storage.get.mockImplementationOnce(() => new Promise((resolve) => { finishLoad = resolve; }));
    const loading = useAgentMemoryStore.getState().loadMemories();
    useAgentMemoryStore.getState().addMemory({
      id: 'new-memory', scope: 'user', title: 'New preference', content: 'Use concise Chinese.',
      source: { label: 'Current conversation' }, now: 200,
    });
    expect(storage.set).not.toHaveBeenCalled();
    finishLoad({ entries: [createAgentMemoryEntry({
      id: 'saved-memory', scope: 'user', title: 'Existing preference', content: 'Preserve citations.',
      source: { label: 'Earlier conversation' }, now: 100,
    })] });
    await loading;
    expect(useAgentMemoryStore.getState().entries.map((entry) => entry.id).sort()).toEqual(['new-memory', 'saved-memory']);
    await vi.waitFor(() => expect(storage.set).toHaveBeenCalledWith('lattice-agent-memory-v1', {
      entries: expect.arrayContaining([expect.objectContaining({ id: 'saved-memory' }), expect.objectContaining({ id: 'new-memory' })]),
    }));
  });

  it('serializes saves so an older slow write cannot replace the latest edit', async () => {
    await useAgentMemoryStore.getState().loadMemories();
    let finishFirstSave!: () => void;
    storage.set.mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirstSave = resolve; }));
    useAgentMemoryStore.getState().addMemory({
      id: 'editable', scope: 'user', title: 'First title', content: 'Keep the latest edit.',
      source: { label: 'Current conversation' }, now: 100,
    });
    await vi.waitFor(() => expect(storage.set).toHaveBeenCalledTimes(1));
    useAgentMemoryStore.getState().updateMemory('editable', { title: 'Latest title' });
    await Promise.resolve();
    expect(storage.set).toHaveBeenCalledTimes(1);
    finishFirstSave();
    await vi.waitFor(() => expect(storage.set).toHaveBeenLastCalledWith('lattice-agent-memory-v1', {
      entries: [expect.objectContaining({ id: 'editable', title: 'Latest title' })],
    }));
  });

  it('does not overwrite an unreadable store and can retry after recovery', async () => {
    storage.get.mockRejectedValue(new Error('Storage temporarily unavailable'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useAgentMemoryStore.getState().addMemory({
      id: 'unsaved', scope: 'user', title: 'Pending preference', content: 'Keep this after retry.',
      source: { label: 'Current conversation' }, now: 200,
    });
    await useAgentMemoryStore.getState().loadMemories();
    expect(useAgentMemoryStore.getState()).toMatchObject({ loaded: false, persistenceError: 'load' });
    expect(storage.set).not.toHaveBeenCalled();
    storage.get.mockResolvedValue({ entries: [createAgentMemoryEntry({
      id: 'original', scope: 'user', title: 'Original preference', content: 'Keep existing data.',
      source: { label: 'Earlier conversation' }, now: 100,
    })] });
    await useAgentMemoryStore.getState().loadMemories();
    expect(useAgentMemoryStore.getState().entries.map((entry) => entry.id).sort()).toEqual(['original', 'unsaved']);
    expect(useAgentMemoryStore.getState().persistenceError).toBeNull();
    expect(storage.set).toHaveBeenCalledTimes(1);
    errorLog.mockRestore();
  });

  it('retries a failed save without losing the current entry', async () => {
    await useAgentMemoryStore.getState().loadMemories();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    storage.set.mockRejectedValueOnce(new Error('Disk unavailable'));
    useAgentMemoryStore.getState().addMemory({
      id: 'retry-save', scope: 'user', title: 'Keep this preference', content: 'Do not lose unsaved changes.',
      source: { label: 'Current conversation' }, now: 300,
    });
    await vi.waitFor(() => expect(useAgentMemoryStore.getState().persistenceError).toBe('save'));
    expect(useAgentMemoryStore.getState().getMemory('retry-save')).not.toBeNull();
    await useAgentMemoryStore.getState().loadMemories();
    expect(useAgentMemoryStore.getState().persistenceError).toBeNull();
    expect(storage.set).toHaveBeenCalledTimes(2);
    errorLog.mockRestore();
  });
});
