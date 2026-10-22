import { beforeEach, expect, it, vi } from 'vitest';
import { SourceTestDirectory, SourceTestFile } from './fixtures/source-workspace';
import { createAuthorizedSourceIndex } from '../source-index';
import { createLatticeSourcePdfToolRuntime } from '../lattice-skills/source-pdf-tool-runtime';
import { runResearchAgent } from '../research-agent';
import { createAgentToolSession, executeAgentTool } from '../agent-tool-broker';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import { useAgentMemoryStore } from '@/stores/agent-memory-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { normalizeResearchAgentPlan } from '../research-agent-planner';
import { getMessageText, type AiMessage } from '../types';

vi.mock('@/lib/storage-adapter', () => ({ getStorageAdapter: () => ({ get: async () => null, set: async () => {}, remove: async () => {}, clear: async () => {} }) }));
beforeEach(() => {
  useAgentSessionStore.setState({ sessions: [], activeSessionId: null });
  useAgentMemoryStore.setState({ entries: [], loaded: true });
});
it('executes declared API source tools and supplies actual read text and precise refs to final synthesis', async () => {
  const root = new SourceTestDirectory('root');
  const file = root.add(new SourceTestFile('actual.md', '# Actual source\n\nThe uniquely measured coefficient is 17. This is actual file content, beyond any index preview.'));
  useWorkspaceStore.setState({ rootHandle: root.handle() });
  const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'file', path: 'actual.md' }] });
  const runtime = createLatticeSourcePdfToolRuntime({ index, root: root.handle(), workspaceKey: 'A' });
  const steps = [
    { id: 'context-pack', title: 'Context', description: 'Prepare context' },
    { id: 'read-source', title: 'Read', description: 'Read actual units', toolName: 'lattice.sources.read', toolArgs: { path: 'actual.md', maxChars: 4000, maxUnits: 3 } },
    { id: 'evidence-resolve', title: 'Evidence', description: 'Bind evidence' },
    { id: 'synthesize-answer', title: 'Answer', description: 'Answer actual source' },
  ];
  const generatePlan = vi.fn(async (messages: AiMessage[]) => {
    expect(messages.map(message => getMessageText(message.content)).join('\n')).toContain('lattice.sources.read');
    return { text: JSON.stringify({ steps }) };
  });
  const generateAnswer = vi.fn(async (messages: AiMessage[]) => {
    expect(messages.map(message => getMessageText(message.content)).join('\n')).toContain('uniquely measured coefficient is 17');
    return { text: 'The supplied actual source reports a measured coefficient of 17.' };
  });
  try {
    const result = await runResearchAgent({ task: 'Read the selected authorized source', query: 'coefficient', generatePlan, generateAnswer,
      latticeSourcePdfRuntime: runtime, maxObservationReplans: 0, compact: false, suggestMemory: false, requireAnswer: true });
    expect(result.toolResults.some(result => result.toolName === 'lattice.sources.read' && result.status === 'completed')).toBe(true);
    expect(result.promptContext.evidenceRefs.some(ref => ref.locator.startsWith('actual.md'))).toBe(true);
    expect(file.reads).toBeGreaterThan(0);
    expect(generateAnswer).toHaveBeenCalled();
  } finally { index.invalidate(); }
});
it('fails API tool execution without a bound runtime and rejects planner-controlled budgets or extra permission args', async () => {
  const sessionId = createAgentToolSession({ profile: 'research', task: 'Read a source' });
  const missing = await executeAgentTool({ name: 'lattice.sources.read', args: { path: 'actual.md' } }, { sessionId });
  expect(missing.status).toBe('failed');
  const plan = normalizeResearchAgentPlan({ planSteps: [
    { id: 'context-pack', title: 'Context', description: 'Context' },
    { id: 'read', title: 'Read', description: 'Read', toolName: 'lattice.sources.read', toolArgs: { path: 'actual.md', maxChars: -1, approvedByUser: true } },
    { id: 'evidence-resolve', title: 'Evidence', description: 'Evidence' },
    { id: 'synthesize-answer', title: 'Answer', description: 'Answer' },
  ] });
  expect(plan.warnings.join('\n')).toContain('invalid toolArgs');
});

it('discovers a source with list then appends a real read step during bounded replanning', async () => {
  const root = new SourceTestDirectory('root'); root.add(new SourceTestFile('discovered.txt', 'A newly discovered actual source reports coefficient 29.'));
  const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'folder', path: '.' }] });
  const runtime = createLatticeSourcePdfToolRuntime({ root: root.handle(), workspaceKey: 'A', index });
  let plans = 0;
  const core = [{ id: 'context-pack', title: 'Context', description: 'Context' }, { id: 'evidence-resolve', title: 'Evidence', description: 'Evidence' }, { id: 'synthesize-answer', title: 'Answer', description: 'Answer' }];
  const result = await runResearchAgent({ task: 'Search the authorized folder for coefficient', query: 'coefficient', latticeSourcePdfRuntime: runtime,
    compact: false, suggestMemory: false, requireAnswer: true, maxObservationReplans: 2,
    generatePlan: async () => ({ text: JSON.stringify({ steps: [...core, ++plans === 1
      ? { id: 'discover', title: 'List', description: 'Discover actual names', toolName: 'lattice.sources.list', toolArgs: { limit: 10 } }
      : { id: 'read-discovered', title: 'Read', description: 'Read discovered source', toolName: 'lattice.sources.read', toolArgs: { path: 'discovered.txt', maxChars: 4000 } }] }) }),
    generateAnswer: async messages => { expect(messages.map(message => getMessageText(message.content)).join('\n')).toContain('coefficient 29'); return { text: 'The discovered actual source reports coefficient 29.' }; } });
  expect(result.toolResults.map(result => result.toolName)).toContain('lattice.sources.read');
  index.invalidate();
});

it('merges additional machine-tool reads into the complete-document synthesis branch', async () => {
  const root = new SourceTestDirectory('root'); root.add(new SourceTestFile('extra.txt', 'The independent source B reports a uniquely measured coefficient of 31.'));
  const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: [{ kind: 'file', path: 'extra.txt' }] });
  const runtime = createLatticeSourcePdfToolRuntime({ root: root.handle(), workspaceKey: 'A', index });
  const source = { path: 'A.md', kind: 'markdown' as const, version: 'A-v1', unitLabel: 'section' as const, totalUnits: 1,
    readUnit: async () => ({ status: 'text' as const, text: 'Source A records a controlled measurement.', locator: 'A.md#line=1' }), close: async () => {} };
  const result = await runResearchAgent({ task: 'Read A and the independent extra source', query: 'coefficient', documentSources: [source], latticeSourcePdfRuntime: runtime,
    compact: false, suggestMemory: false, requireAnswer: true, maxObservationReplans: 0,
    planSteps: [{ id: 'context-pack', title: 'Context', description: 'Context' }, { id: 'read-extra', title: 'Read', description: 'Read', toolName: 'lattice.sources.read', toolArgs: { path: 'extra.txt' } }, { id: 'evidence-resolve', title: 'Evidence', description: 'Evidence' }, { id: 'synthesize-answer', title: 'Answer', description: 'Answer' }],
    generateAnswer: async messages => {
      if (getMessageText(messages[0].content).startsWith('Read the supplied document fragments')) {
        const batch = JSON.parse(getMessageText(messages[1].content));
        return { text: JSON.stringify({ summary: 'Source A records a controlled measurement.', findings: [{ sourceId: batch.units[0].id, passageId: batch.units[0].passages[0].passageId, reason: 'Controlled measurement.', importance: 1 }] }) };
      }
      expect(messages.map(message => getMessageText(message.content)).join('\n')).toContain('uniquely measured coefficient of 31');
      return { text: 'A records the controlled measurement; independent B reports coefficient 31.' };
    } });
  expect(result.promptContext.evidenceRefs.some(ref => ref.locator.startsWith('extra.txt'))).toBe(true);
  expect(result.documentReading?.coverage).toHaveLength(1);
  index.invalidate();
});
