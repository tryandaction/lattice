import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCitationContract } from '../ai/citation-contract';
import { getMessageText, type AiMessage, type AiRuntimeSettings } from '../ai/types';

const mocks = vi.hoisted(() => ({
  generateAnswer: vi.fn(),
  storage: { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn(), clear: vi.fn() },
}));

vi.mock('@/lib/storage-adapter', () => ({ getStorageAdapter: () => mocks.storage }));
vi.mock('../ai/research-agent-planner-provider', () => ({
  createResearchAgentPlannerGenerate: () => ({
    generatePlan: vi.fn(), generateAnswer: mocks.generateAnswer,
    modelInfo: { providerId: 'openai', providerName: 'Test', model: 'fixture', source: 'local' },
  }),
}));

import { runResearchAgentForChat } from '../ai/research-agent-chat-runner';
import { runResearchAgent } from '../ai/research-agent';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import { useAgentMemoryStore } from '@/stores/agent-memory-store';
import { useAiWorkbenchStore } from '@/stores/ai-workbench-store';
import { getWorkspaceIndex } from '../ai/workspace-indexer';

const settings: AiRuntimeSettings = {
  aiEnabled: true, providerId: 'openai', model: 'fixture', temperature: 0.2, maxTokens: 4000, systemPrompt: '', preferLocal: true,
};
const quote = 'The magnetic field remained 58 G throughout the experiment.';
const evidence = { kind: 'pdf_page' as const, locator: 'papers/original.pdf#page=4', label: 'Original p.4', preview: quote, anchor: { page: 4, snippet: quote } };
const sourceId = buildCitationContract(evidence).stableId;
const annotation = { sourceId, passageId: sourceId, reason: 'A reproducible experimental condition.' };
const task = 'Annotate this PDF and generate a Markdown document';

function compoundRequest() {
  return {
    sessionId: 'compound-delivery', settings, workflowId: 'pdf-annotation' as const, task,
    filePath: 'papers/original.pdf', content: quote, explicitEvidenceRefs: [evidence],
    suggestMemory: false, compact: false, maxObservationReplans: 0,
    planSteps: [
      { id: 'context-pack', title: 'Context', description: 'Use the supplied original source.' },
      { id: 'evidence-resolve', title: 'Evidence', description: 'Resolve supplied evidence.', toolName: 'evidence.resolve' as const },
      { id: 'synthesize-answer', title: 'Answer', description: 'Generate the requested deliverables.' },
    ],
  };
}

describe('compound document delivery through the real research engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentSessionStore.setState({ sessions: [], activeSessionId: null });
    useAgentMemoryStore.setState({ entries: [], loaded: true });
    useAiWorkbenchStore.setState({ drafts: [], proposals: [], highlightedProposalId: null });
    const index = getWorkspaceIndex();
    index.files.clear(); index.lastFullIndex = 0; index.version = 0;
  });

  it.each(['lattice-annotations', 'json'])('rejects a %s annotation payload without the requested Markdown narrative after repair', async (fence) => {
    mocks.generateAnswer.mockResolvedValue({ text: `\`\`\`${fence}\n${JSON.stringify({ annotations: [annotation] })}\n\`\`\`` });
    await expect(runResearchAgentForChat(compoundRequest())).rejects.toThrow('缺少用户要求的 Markdown');
    expect(mocks.generateAnswer).toHaveBeenCalledTimes(2);
    expect(useAgentSessionStore.getState().getSession('compound-delivery')?.status).toBe('failed');
    expect(useAiWorkbenchStore.getState().drafts).toEqual([]);
  });

  it.each([true, false])('keeps the note and original source with accurate delivery status (valid annotations: %s)', async (valid) => {
    const note = '## Experimental condition\nThe measurement used a constant magnetic field. The available passage establishes the field value but does not establish its sensitivity to drift.';
    mocks.generateAnswer.mockResolvedValue({ text: `${note}\n\n\`\`\`lattice-annotations\n${JSON.stringify({ annotations: [valid ? annotation : { ...annotation, sourceId: 'invented' }] })}\n\`\`\`` });
    const result = await runResearchAgentForChat(compoundRequest());
    expect(result.draftSuggestion).toMatchObject({ content: note, targetPath: 'papers/original Reading Note.md', writeMode: 'create' });
    expect(result.annotationProposal).toHaveLength(valid ? 1 : 0);
    expect(result.agentResult.deliveryStatus).toBe(valid ? 'ready_for_review' : 'partial');
    expect(result.chatText).toContain(valid ? '尚未写入 PDF' : '批注未就绪');
    expect(result.chatText).toContain('尚未保存为文件');
    expect(result.chatText).not.toContain('lattice-annotations');
    expect(result.chatText).not.toContain('invented');
    expect(useAiWorkbenchStore.getState().drafts).toEqual([]);
  });

  it('does not treat an annotations envelope with extra fields as the requested Markdown narrative', async () => {
    mocks.generateAnswer.mockResolvedValue({ text: `\`\`\`json\n${JSON.stringify({ annotations: [annotation], status: 'proposed' })}\n\`\`\`` });
    await expect(runResearchAgentForChat(compoundRequest())).rejects.toThrow();
    expect(useAgentSessionStore.getState().getSession('compound-delivery')?.status).toBe('failed');
  });

  it('reuses all 28 persisted pages after failed synthesis without any readUnit or batch calls', async () => {
    const pages = Array.from({ length: 28 }, (_, index) => `Page ${index + 1} reports a unique measured pulse fidelity under a calibrated magnetic field.`);
    const source = {
      path: 'papers/original.pdf', version: 'unchanged-original-bytes', kind: 'pdf' as const, unitLabel: 'page' as const, totalUnits: pages.length,
      readUnit: vi.fn(async (unit: number) => ({ status: 'text' as const, text: pages[unit - 1] })), close: vi.fn(async () => {}),
    };
    const firstGenerate = vi.fn(async (messages: AiMessage[]) => {
      if (!getMessageText(messages[0].content).startsWith('Read the supplied document fragments')) throw new Error('Final synthesis unavailable');
      const batch = JSON.parse(getMessageText(messages[1].content));
      return { text: JSON.stringify({ summary: 'Verified experimental conditions.', findings: batch.units.map((unit: { id: string; passages: Array<{ passageId: string }> }) => ({
        sourceId: unit.id, passageId: unit.passages[0].passageId, reason: 'Original measured result.',
      })) }) };
    });
    const request = { sessionId: 'complete-reading-retry', task: 'Read all', query: 'Read all', documentSources: [source], requireAnswer: true, suggestMemory: false, compact: false };
    await expect(runResearchAgent({ ...request, generateAnswer: firstGenerate })).rejects.toThrow('Final synthesis unavailable');
    const saved = structuredClone(mocks.storage.set.mock.calls.filter(([key]) => key === 'lattice-agent-sessions-v1').at(-1)?.[1]);
    const checkpoint = useAgentSessionStore.getState().getSession(request.sessionId)?.documentResearch?.checkpoint;
    expect(checkpoint?.coverage[0].readUnits).toEqual(Array.from({ length: 28 }, (_, index) => index + 1));
    expect(useAgentSessionStore.getState().getSession(request.sessionId)?.documentResearch?.status).toBe('ready');
    useAgentSessionStore.setState({ sessions: [], activeSessionId: null });
    mocks.storage.get.mockResolvedValueOnce(saved);
    await useAgentSessionStore.getState().loadSessions();
    useAgentSessionStore.getState().resumeDocumentSession(request.sessionId);
    source.readUnit.mockClear();
    const resumedGenerate = vi.fn().mockResolvedValue({ text: 'The full reading establishes the measurement conditions; the preserved original passages support this conclusion.' });
    const result = await runResearchAgent({ ...request, generateAnswer: resumedGenerate });
    expect(result.session.status).toBe('completed');
    expect(result.sessionId).toBe(request.sessionId);
    expect(result.documentReading?.complete).toBe(true);
    expect(result.documentReading?.coverage[0].readUnits).toHaveLength(28);
    expect(result.session.documentResearch?.checkpoint.completedBatches).toBe(checkpoint?.completedBatches);
    expect(source.readUnit).not.toHaveBeenCalled();
    expect(resumedGenerate).toHaveBeenCalledOnce();
    expect(getMessageText(resumedGenerate.mock.calls[0][0][0].content)).not.toContain('Read the supplied document fragments');
  });
});
