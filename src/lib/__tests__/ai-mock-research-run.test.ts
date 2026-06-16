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

import { runMockedResearchAgent } from '../ai/mock-research-run';
import { useAgentMemoryStore } from '@/stores/agent-memory-store';
import { useAgentSessionStore } from '@/stores/agent-session-store';

describe('mock-research-run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentSessionStore.setState({
      sessions: [],
      activeSessionId: null,
    });
    useAgentMemoryStore.setState({
      entries: [],
      loaded: true,
    });
  });

  it('runs a mocked research path through context pack, memory, broker evidence, and compaction', async () => {
    useAgentMemoryStore.getState().addMemory({
      id: 'memory-research-1',
      scope: 'workspace',
      title: 'Reading note rule',
      content: 'Prefer source-backed synthesis.',
      source: {
        label: 'Workspace instruction',
        locator: 'workspace://rules',
      },
      pinned: true,
      now: 100,
    });

    const result = await runMockedResearchAgent({
      sessionId: 'mock-session-1',
      contextPackId: 'mock-pack-1',
      now: 200,
      filePath: 'papers/alpha.md',
      content: '# Alpha\nThe method improves citation grounding.',
      selection: 'The method improves citation grounding.',
      query: 'What does Alpha improve?',
      workspaceKey: 'research-workspace',
      workspaceIndex: {
        files: new Map([
          ['papers/alpha.md', {
            path: 'papers/alpha.md',
            name: 'alpha.md',
            extension: '.md',
            size: 120,
            summary: 'Alpha paper summary.',
            headings: ['Alpha'],
            lastModified: 100,
          }],
        ]),
        lastFullIndex: 100,
        version: 3,
      },
      compact: true,
      maxTraceEvents: 6,
      retainRecentEvents: 3,
    });

    expect(result.sessionId).toBe('mock-session-1');
    expect(result.contextPack.sections.map((section) => section.source)).toEqual(
      expect.arrayContaining(['selection', 'active_file', 'memory', 'workspace_chunk']),
    );
    expect(result.workspaceSummary).toMatchObject({
      workspaceKey: 'research-workspace',
      indexVersion: 3,
    });
    expect(result.memorySnapshotIds).toEqual(['memory-research-1']);
    expect(result.session.status).toBe('completed');
    expect(result.session.contextPackId).toBe('mock-pack-1');
    expect(result.session.memorySnapshotIds).toEqual(['memory-research-1']);
    expect(result.session.compactions[0]).toMatchObject({
      id: 'mock-session-1:compaction',
    });
    expect(result.session.trace.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['session_started', 'context_resolved', 'planning', 'completed']),
    );
    expect(result.session.evidenceRefs.map((ref) => ref.locator)).toContain('papers/alpha.md');
  });
});
