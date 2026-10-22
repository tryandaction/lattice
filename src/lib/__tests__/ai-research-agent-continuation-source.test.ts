import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage-adapter', () => ({ getStorageAdapter: () => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn(), clear: vi.fn() }) }));
vi.mock('@/lib/pdf-js-document-loader', () => ({ loadPdfJsDocument: async () => ({ numPages: 20, destroy: async () => {} }) }));
vi.mock('@/lib/pdf-page-text-cache', () => ({ getPdfPageSearchText: async (_pdf: unknown, unit: number) => unit === 12
  ? 'BB1 is a composite pulse sequence. Correction phases cancel amplitude error.' : 'General instrument setup only.' }));

import { runResearchAgent } from '../ai/research-agent';
import { resolveResearchContinuation } from '../ai/conversation-task-context';
import { createLatticeHarnessToolRuntime } from '../ai/harness/lattice-source-tools';
import { createAuthorizedSourceIndex } from '../ai/source-index';
import { SourceTestDirectory, SourceTestFile } from '../ai/__tests__/fixtures/source-workspace';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import { getMessageText } from '../ai/types';
import type { AiMessage } from '../ai/types';

const path = 'paper.pdf';
const history = [{ role: 'user' as const, content: 'BB1是什么？请解释原理。' },
  { role: 'assistant' as const, content: '下一步：解释幅度误差抵消的机制。还需要检查第17–20页。' }];
const core = ['context-pack', 'evidence-resolve', 'synthesize-answer'].map(id => ({ id, title: id, description: id }));

describe('accepted next-step original-source recovery', () => {
  beforeEach(() => useAgentSessionStore.setState({ sessions: [], activeSessionId: null }));

  it.each([3, 2])('rechecks a missing middle page within a total tool allowance of %i', async maxReadToolSteps => {
    const root = new SourceTestDirectory('workspace');
    root.add(new SourceTestFile(path, '%PDF synthetic fixture'));
    const sourceSelections = [{ kind: 'file' as const, path }];
    const runtime = createLatticeHarnessToolRuntime({ kind: 'local', root: root.handle(), workspaceKey: 'A',
      index: createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: sourceSelections }) });
    const execute = vi.fn(runtime.execute);
    const next = resolveResearchContinuation('做', history)!;
    const generateAnswer = vi.fn(async (_messages: AiMessage[]) => ({ text: '这是一次离线工具链回归。' }));
    const result = await runResearchAgent({ task: next.task, query: next.query, sourceIntentQuery: next.sourceIntentQuery, history,
      filePath: path, workspaceKey: 'A', sourceSelections, apiToolRuntime: { ...runtime, execute, sourceSelections },
      maxReadToolSteps, includeWorkspaceSummary: false, suggestMemory: false, compact: false, requireAnswer: true,
      planSteps: [...core,
        { id: 'search', title: 'Search bounded source', description: 'Initial bounded search', toolName: 'lattice.sources.search', toolArgs: { query: 'BB1', paths: [path], maxUnits: 10, maxFiles: 1 } },
        { id: 'read-tail', title: 'Read the remaining tail', description: 'Check previously unread pages', toolName: 'lattice.sources.read', toolArgs: { path, units: [17, 18, 19, 20], maxUnits: 4 } }],
      generateAnswer });
    const prompt = generateAnswer.mock.calls[0][0].map(message => getMessageText(message.content)).join('\n');
    expect(execute.mock.calls.length).toBeLessThanOrEqual(maxReadToolSteps);
    if (maxReadToolSteps === 3) {
      expect(execute.mock.calls).toHaveLength(3);
      expect(execute.mock.calls[2][0]).toBe('lattice.sources.search');
      expect(execute.mock.calls[2][1]).toMatchObject({ query: 'BB1', paths: [path], cursor: expect.any(Number), maxUnits: 10 });
      expect(prompt).toContain('BB1 is a composite pulse sequence. Correction phases cancel amplitude error.');
      expect(result.promptContext.evidenceRefs).toContainEqual(expect.objectContaining({ locator: 'paper.pdf#page=12' }));
    } else {
      expect(execute.mock.calls).toHaveLength(2);
      expect(prompt).not.toContain('BB1 is a composite pulse sequence.');
      expect(result.promptContext.evidenceRefs.some(ref => ref.locator === 'paper.pdf#page=12')).toBe(false);
    }
  });
});
