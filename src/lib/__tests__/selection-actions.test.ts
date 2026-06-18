import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = {
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
};

const { proposeTaskMock, runChatMock, runResearchAgentForSurfaceMock } = vi.hoisted(() => ({
  proposeTaskMock: vi.fn(),
  runChatMock: vi.fn(),
  runResearchAgentForSurfaceMock: vi.fn(),
}));

vi.mock('@/lib/storage-adapter', () => ({
  getStorageAdapter: () => storage,
}));

vi.mock('../ai/orchestrator', () => ({
  aiOrchestrator: {
    proposeTask: proposeTaskMock,
    runChat: runChatMock,
  },
}));

vi.mock('../ai/research-agent-chat-runner', () => ({
  runResearchAgentForSurface: runResearchAgentForSurfaceMock,
}));

import { runSelectionAiMode } from '../ai/selection-actions';
import { createSelectionContext, defaultPromptForSelectionMode } from '../ai/selection-context';
import { useAiChatStore } from '@/stores/ai-chat-store';
import { useAiWorkbenchStore } from '@/stores/ai-workbench-store';
import type { AiRuntimeSettings } from '../ai/types';

const settings: AiRuntimeSettings = {
  aiEnabled: true,
  providerId: 'openai',
  model: 'gpt-test',
  temperature: 0.1,
  maxTokens: 800,
  systemPrompt: 'system',
};

function buildContext() {
  return createSelectionContext({
    sourceKind: 'markdown',
    paneId: 'pane-main',
    fileName: 'notes.md',
    filePath: 'notes/notes.md',
    selectedText: 'A highlighted research paragraph',
    documentText: 'Leading context\nA highlighted research paragraph\nTrailing context',
    contextText: 'Local context block',
    blockLabel: 'Method',
  });
}

describe('runSelectionAiMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useAiChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isOpen: false,
      isGenerating: false,
      abortController: null,
    });
    useAiWorkbenchStore.setState({
      drafts: [],
      proposals: [],
      highlightedProposalId: null,
    });
  });

  it('routes chat results into AI chat with origin and evidence metadata', async () => {
    runChatMock.mockResolvedValue({
      text: 'Conclusion\n\nAnswer',
      model: {
        providerId: 'openai',
        providerName: 'OpenAI',
        model: 'gpt-test',
        source: 'cloud',
      },
      evidenceRefs: [
        {
          kind: 'file',
          label: 'notes/notes.md',
          locator: 'notes/notes.md',
        },
      ],
      context: {
        nodes: [],
        prompt: 'Prompt',
        evidenceRefs: [],
        truncated: false,
      },
      followUpActions: [],
      draftSuggestion: {
        type: 'paper_note',
        title: 'Draft',
      },
    });

    const context = buildContext();
    const resultPromise = runSelectionAiMode({
      context,
      mode: 'chat',
      prompt: 'Summarize this selection',
      settings,
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({
      kind: 'chat',
      title: 'Summarize this selection',
    });
    expect(runChatMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('Selected excerpt from notes.md · 选区:'),
      explicitEvidenceRefs: context.evidenceRefs,
      filePath: 'notes/notes.md',
      content: 'Local context block',
      selection: 'A highlighted research paragraph',
    }));

    const conversation = useAiChatStore.getState().getActiveConversation();
    expect(conversation?.messages).toHaveLength(2);
    expect(conversation?.messages[0]).toEqual(expect.objectContaining({
      role: 'user',
      content: 'Summarize this selection',
      origin: expect.objectContaining({
        kind: 'selection-ai',
        mode: 'chat',
        sourceLabel: context.sourceLabel,
      }),
    }));
    expect(conversation?.messages[1]).toEqual(expect.objectContaining({
      role: 'assistant',
      content: 'Conclusion\n\nAnswer',
      evidenceRefs: expect.arrayContaining([
        expect.objectContaining({ locator: 'notes/notes.md' }),
      ]),
      draftSuggestion: {
        type: 'paper_note',
        title: 'Draft',
      },
      origin: expect.objectContaining({
        kind: 'selection-ai',
        mode: 'chat',
      }),
    }));
  });

  it('routes agent mode through the formal Research Agent surface runner', async () => {
    runResearchAgentForSurfaceMock.mockResolvedValue({
      chatText: 'Task: Deep selection analysis\n\nAgent session: selection-research-session',
      plannerModel: 'OpenAI/gpt-test',
      plannerModelInfo: {
        providerId: 'openai',
        providerName: 'OpenAI',
        model: 'gpt-test',
        source: 'cloud',
      },
      adapterWarnings: [],
      workflow: null,
      workflowPlannerHints: null,
      result: {
        sessionId: 'selection-research-session',
        promptContext: {
          nodes: [],
          prompt: 'Resolved selection evidence',
          evidenceRefs: [
            {
              kind: 'file',
              label: 'notes/notes.md',
              locator: 'notes/notes.md',
            },
          ],
          truncated: false,
        },
      },
    });

    const context = buildContext();
    const resultPromise = runSelectionAiMode({
      context,
      mode: 'agent',
      prompt: '   ',
      settings,
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({
      kind: 'chat',
      title: defaultPromptForSelectionMode('agent', context),
    });
    expect(runChatMock).not.toHaveBeenCalled();
    expect(runResearchAgentForSurfaceMock).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: 'markdown-research',
      task: defaultPromptForSelectionMode('agent', context),
      query: expect.stringContaining('Act as a research agent. Be evidence-first'),
      filePath: 'notes/notes.md',
      content: 'Local context block',
      selection: 'A highlighted research paragraph',
      explicitEvidenceRefs: context.evidenceRefs,
      compact: true,
    }));

    const conversation = useAiChatStore.getState().getActiveConversation();
    expect(conversation?.messages[0]).toEqual(expect.objectContaining({
      role: 'user',
      content: defaultPromptForSelectionMode('agent', context),
      origin: expect.objectContaining({
        kind: 'selection-ai',
        mode: 'agent',
      }),
    }));
    expect(conversation?.messages[1]).toEqual(expect.objectContaining({
      role: 'assistant',
      content: expect.stringContaining('selection-research-session'),
      model: expect.objectContaining({ providerName: 'OpenAI', model: 'gpt-test' }),
      evidenceRefs: expect.arrayContaining([
        expect.objectContaining({ locator: 'notes/notes.md' }),
      ]),
      promptContext: expect.objectContaining({
        prompt: 'Resolved selection evidence',
      }),
      origin: expect.objectContaining({
        kind: 'selection-ai',
        mode: 'agent',
      }),
    }));
  });

  it('routes plan mode into workbench proposals and highlights selection-origin plans', async () => {
    proposeTaskMock.mockResolvedValue({
      id: 'proposal-1',
      summary: '整理选区计划',
      steps: [
        { id: 'step-1', title: 'Review', description: 'Inspect the selected note.' },
      ],
      requiredApprovals: ['Confirm target path'],
      plannedWrites: [
        {
          targetPath: 'AI Drafts/selection-plan.md',
          mode: 'create',
          contentPreview: 'Draft summary',
        },
      ],
      sourceRefs: [],
      status: 'pending',
      confirmedApprovals: [],
      approvedWrites: ['AI Drafts/selection-plan.md'],
      generatedDraftTargets: [],
      createdAt: Date.now(),
    });

    const context = buildContext();
    const resultPromise = runSelectionAiMode({
      context,
      mode: 'plan',
      prompt: 'Turn this into a reviewable plan',
      settings,
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({
      kind: 'proposal',
      title: '整理选区计划',
    });
    expect(proposeTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      explicitEvidenceRefs: context.evidenceRefs,
      selection: 'A highlighted research paragraph',
      filePath: 'notes/notes.md',
    }));

    const proposal = useAiWorkbenchStore.getState().getProposal('proposal-1');
    expect(proposal).toEqual(expect.objectContaining({
      origin: expect.objectContaining({
        kind: 'selection-ai',
        mode: 'plan',
        sourceLabel: context.sourceLabel,
      }),
    }));
    expect(useAiWorkbenchStore.getState().highlightedProposalId).toBe('proposal-1');
    expect(useAiChatStore.getState().isOpen).toBe(true);
  });

  it('routes code selections to the code-change workflow in agent mode', async () => {
    runResearchAgentForSurfaceMock.mockResolvedValue({
      chatText: 'Code change plan result',
      plannerModelInfo: null,
      agentResult: {
        sessionId: 'selection-code-session',
        workflowLabel: 'Code Change Plan',
      },
      followUpActions: [
        { id: 'create-code-change-proposal', label: '生成代码变更计划', kind: 'propose_task' },
      ],
      result: {
        sessionId: 'selection-code-session',
        promptContext: {
          nodes: [],
          prompt: 'Resolved code evidence',
          evidenceRefs: [],
          truncated: false,
        },
      },
    });

    const context = createSelectionContext({
      sourceKind: 'code',
      paneId: 'pane-code',
      fileName: 'agent.ts',
      filePath: 'src/lib/ai/agent.ts',
      selectedText: 'export function runAgent() {}',
      documentText: 'export function runAgent() {}',
      contextText: 'export function runAgent() {}',
      blockLabel: 'code',
    });

    const resultPromise = runSelectionAiMode({
      context,
      mode: 'agent',
      prompt: 'Review this function and propose a patch plan',
      settings,
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({
      kind: 'chat',
      title: 'Review this function and propose a patch plan',
    });
    expect(runResearchAgentForSurfaceMock).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: 'code-change-plan',
      filePath: 'src/lib/ai/agent.ts',
      content: 'export function runAgent() {}',
      selection: 'export function runAgent() {}',
    }));
  });
});
