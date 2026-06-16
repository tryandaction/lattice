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

import { formatAgentMemoryCitation } from '@/lib/ai/agent-memory';
import { useAgentMemoryStore } from '../agent-memory-store';

describe('agent-memory-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.get.mockResolvedValue(null);
    useAgentMemoryStore.setState({
      entries: [],
      loaded: false,
    });
  });

  it('adds scoped memories and queries active entries by scope', () => {
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
    expect(storage.set).toHaveBeenCalledWith('lattice-agent-memory-v1', expect.any(Object));
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
});
