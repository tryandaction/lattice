import { beforeEach, expect, it, vi } from 'vitest';
import { SourceTestDirectory, SourceTestFile } from './fixtures/source-workspace';
import { runResearchAgent } from '../research-agent';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import { useAgentMemoryStore } from '@/stores/agent-memory-store';
import { getMessageText } from '../types';

vi.mock('@/lib/storage-adapter', () => ({ getStorageAdapter: () => ({ get: async () => null, set: async () => {}, setStrict: async () => {}, remove: async () => {}, clear: async () => {} }) }));
beforeEach(() => { useAgentSessionStore.setState({ sessions: [], activeSessionId: null }); useAgentMemoryStore.setState({ entries: [], loaded: true }); });
it('runs the real Agent evidence branch over 101 files and persists a directory scope rather than the active tab', async () => {
  const root = new SourceTestDirectory('synthetic');
  for (let i = 0; i < 101; i++) root.add(new SourceTestFile(`paper-${String(i).padStart(3, '0')}.md`, `The source ${i} reports a measured coefficient of ${i + 10}.`));
  const handle = root.handle();
  const result = await runResearchAgent({ task: 'Read every paper', query: 'Read every paper', workspaceKey: 'synthetic',
    documentDirectory: { rootHandle: handle, selections: [{ kind: 'folder', path: '.' }], isCurrent: () => true }, documentMaxCalls: 128,
    compact: false, suggestMemory: false, requireAnswer: true, maxObservationReplans: 0,
    planSteps: [{ id: 'context-pack', title: 'Context', description: 'Context' }, { id: 'evidence-resolve', title: 'Evidence', description: 'Evidence' }, { id: 'synthesize-answer', title: 'Answer', description: 'Answer' }],
    generateAnswer: async messages => {
      const system = getMessageText(messages[0].content);
      if (system.startsWith('Read the supplied document fragments')) {
        const batch = JSON.parse(getMessageText(messages[1].content));
        return { text: JSON.stringify({ summary: `Observed ${batch.units[0].path}.`, findings: [] }) };
      }
      if (system.startsWith('Summarize ALL supplied research notes')) return { text: JSON.stringify({ summary: 'Every supplied source was combined with its differences retained.' }) };
      expect(messages.map(message => getMessageText(message.content)).join('\n')).toContain('Discovered supported files: 101');
      return { text: 'The directory contains 101 analyzed synthetic sources. The detailed verified task ledger is retained.' };
    } });
  expect(result.documentReading?.coverage).toHaveLength(101);
  expect(result.documentReading?.complete).toBe(true);
  const saved = useAgentSessionStore.getState().getSession(result.sessionId)?.documentResearch;
  expect(saved?.directory?.selections).toEqual([{ kind: 'folder', path: '.' }]);
  expect(saved?.directory?.files.at(-1)?.status).toBe('complete');
  expect(saved?.status).toBe('ready');
});
