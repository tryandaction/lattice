/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const storage = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
};

const promptTemplate = {
  id: "template-chat-1",
  title: "Context Aware Chat",
  description: "Chat template",
  category: "reading",
  userPrompt: "Explain this",
  surfaces: ["chat"],
  outputMode: "structured-chat",
  requiredContext: [],
  optionalContext: ["current_file_content", "pdf_annotations", "workspace_summary"],
  version: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;

const researchAgentMocks = vi.hoisted(() => ({
  runResearchAgentForChat: vi.fn(),
}));

const orchestratorMocks = vi.hoisted(() => ({
  runChat: vi.fn(),
}));

const pdfContextMocks = vi.hoisted(() => ({
  loadPdfJsDocument: vi.fn(),
  getPdfPageSearchText: vi.fn(),
}));

vi.mock('@/lib/storage-adapter', () => ({
  getStorageAdapter: () => storage,
  isTauriHost: () => false,
}));

vi.mock('@/lib/ai/orchestrator', () => ({
  aiOrchestrator: {
    runChat: orchestratorMocks.runChat,
  },
}));

vi.mock('@/lib/ai/research-agent-chat-runner', () => ({
  runResearchAgentForChat: researchAgentMocks.runResearchAgentForChat,
}));

vi.mock('@/lib/pdf-js-document-loader', () => ({
  loadPdfJsDocument: pdfContextMocks.loadPdfJsDocument,
  pdfJsWorkerUrl: 'mock-worker',
}));

vi.mock('@/lib/pdf-page-text-cache', () => ({
  getPdfPageSearchText: pdfContextMocks.getPdfPageSearchText,
}));

vi.mock('@/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const mapping: Record<string, string> = {
        'chat.title': 'AI Chat',
        'chat.newChat': 'New Chat',
        'chat.deleteChat': 'Delete Chat',
        'common.close': 'Close',
        'common.cancel': 'Cancel',
        'common.apply': 'Apply',
        'common.clear': 'Clear',
        'chat.empty': 'Empty',
        'chat.you': 'YOU',
        'chat.ai': 'AI',
        'chat.copy': 'Copy',
        'chat.copied': 'Copied',
        'chat.placeholder': 'Ask',
        'chat.stop': 'Stop',
        'chat.send': 'Send',
        'chat.researchAgent': 'Research Agent',
        'chat.researchAgent.hint': 'Run Research Agent',
        'chat.researchAgent.memorySuggestions': 'Suggest memory',
        'chat.researchAgent.workflow': 'Research workflow',
        'chat.researchAgent.workflowHint': 'Choose Research workflow',
        'chat.agentAdvanced': 'Advanced',
        'chat.agentEffort': 'Agent effort',
        'chat.agentEffort.low': 'Low',
        'chat.agentEffort.medium': 'Medium',
        'chat.agentEffort.high': 'High',
        'chat.agentResult.openTrace': 'Open agent trace',
        'chat.agentResult.reviewMemory': 'Review memory suggestions',
        'chat.model.auto': 'Auto model',
        'chat.model.quickSwitch': 'Model quick switch',
        'chat.workflow.auto': 'Auto',
        'settings.ai.providerLabel': 'AI Provider',
        'settings.ai.modelLabel': 'Model',
        'settings.ai.modelPlaceholder': 'Enter model',
        'chat.selection.agent': '深度分析',
        'chat.selection.plan': '计划生成',
        'chat.selection.quick': '快速问答',
        'chat.selection.preview': '选区：{preview}',
        'chat.workbench.title': 'AI Workbench',
        'chat.workbench.drafts': '{count} 草稿',
        'chat.workbench.proposals': '{count} 计划',
        'chat.workbench.generateTargetDrafts': '生成目标草稿',
        'chat.workbench.standaloneDrafts': 'Standalone Drafts',
        'chat.workbench.linkedDraftsTitle': 'Linked Drafts',
        'chat.workbench.expandProposal': 'Expand proposal',
        'chat.workbench.collapseProposal': 'Collapse proposal',
        'chat.workbench.codingReview.title': 'Coding Review',
        'chat.workbench.codingReview.files': '{count} files',
        'chat.workbench.codingReview.qa': 'QA allowed {allowed} / suggested {suggested} / rejected {rejected}',
        'chat.workbench.codingReview.rejectedWarning': 'Rejected QA commands are deferred; the agent has not executed them.',
        'chat.workbench.codingReview.targetFiles': 'Target Files',
        'chat.workbench.codingReview.patchPreview': 'Patch Preview',
        'chat.workbench.codingReview.risks': 'Risks',
        'chat.workbench.codingReview.approvalPath': 'Approval Path',
        'chat.workbench.codingReview.qaPlan': 'QA Command Plan',
        'chat.workbench.codingReview.allowedQa': 'Allowed QA',
        'chat.workbench.codingReview.suggestedQa': 'Suggested QA',
        'chat.workbench.codingReview.rejectedQa': 'Rejected / Deferred QA',
        'chat.workbench.codingReview.executionBoundary': 'Execution Boundary',
        'chat.workbench.linkedDrafts': '关联草稿：{count}',
      };
      let text = mapping[key] ?? key;
      if (params) {
        Object.entries(params).forEach(([param, value]) => {
          text = text.replace(`{${param}}`, String(value));
        });
      }
      return text;
    },
  }),
}));

vi.mock('@/components/renderers/markdown-renderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('../mention-autocomplete', () => ({
  MentionAutocomplete: () => null,
}));

vi.mock('../diff-preview', () => ({
  DiffPreview: () => null,
}));

vi.mock('../evidence-panel', () => ({
  EvidencePanel: ({ message }: { message?: { id: string } | null }) => (
    <div data-testid="evidence-panel">{message?.id ?? 'none'}</div>
  ),
}));

vi.mock('@/components/prompt/prompt-picker', () => ({
  PromptPicker: ({
    isOpen,
    onSelectTemplate,
  }: {
    isOpen: boolean;
    onSelectTemplate: (template: typeof promptTemplate) => void;
  }) => (
    isOpen ? (
      <aside data-testid="prompt-picker-dock">
        <button
          type="button"
          data-testid="prompt-picker-select-template"
          onClick={() => onSelectTemplate(promptTemplate)}
        >
          select-template
        </button>
      </aside>
    ) : null
  ),
}));

vi.mock('@/components/prompt/prompt-editor-dialog', () => ({
  PromptEditorDialog: () => null,
}));

import { AiChatPanel, readFileForAiContext } from '../ai-chat-panel';
import { useAiChatStore } from '@/stores/ai-chat-store';
import { useAiWorkbenchStore } from '@/stores/ai-workbench-store';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useContentCacheStore } from '@/stores/content-cache-store';
import { useAnnotationStore } from '@/stores/annotation-store';
import { DEFAULT_SETTINGS } from '@/types/settings';
import type { ChatMessage } from '@/stores/ai-chat-store';

describe('AiChatPanel selection-origin flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        aiEnabled: true,
      },
      isLoading: false,
      isInitialized: true,
      error: null,
    });
    useAiChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isOpen: true,
      isGenerating: false,
      abortController: null,
      selectedResearchWorkflowId: null,
      composerDraft: null,
    });
    useAiWorkbenchStore.setState({
      drafts: [],
      proposals: [],
      highlightedProposalId: null,
    });
    useAgentSessionStore.setState({
      sessions: [],
      activeSessionId: null,
    });
    useContentCacheStore.setState({
      cache: new Map(),
      switchingLock: false,
      currentSwitchId: null,
    });
    useAnnotationStore.setState({
      annotations: new Map(),
      activeFileId: null,
      isLoading: false,
      error: null,
      pendingSave: false,
      backup: new Map(),
      rootHandle: null,
    });
    orchestratorMocks.runChat.mockResolvedValue({
      text: 'Context-aware answer',
      evidenceRefs: [],
      context: {
        nodes: [],
        prompt: '',
        evidenceRefs: [],
        truncated: false,
      },
      model: {
        providerId: 'openai',
        providerName: 'OpenAI',
        model: 'gpt-test',
        source: 'cloud',
      },
      followUpActions: [],
    });
    pdfContextMocks.loadPdfJsDocument.mockReset();
    pdfContextMocks.getPdfPageSearchText.mockReset();
  });

  it('shows selection-origin badges and auto-focuses evidence for selection agent results', async () => {
    useAiChatStore.setState({
      conversations: [
        {
          id: 'conv-1',
          title: 'Selection Chat',
          createdAt: Date.now(),
          messages: [
            {
              id: 'msg-user',
              role: 'user',
              content: 'Explain this',
              timestamp: Date.now(),
              origin: {
                kind: 'selection-ai',
                mode: 'agent',
                sourceKind: 'markdown',
                sourceLabel: 'notes.md · 选区',
                selectionPreview: 'A highlighted paragraph',
              },
            },
            {
              id: 'msg-assistant',
              role: 'assistant',
              content: 'Conclusion\n\nImportant answer',
              timestamp: Date.now(),
              evidenceRefs: [
                {
                  kind: 'file',
                  label: 'notes.md',
                  locator: 'notes.md',
                },
              ],
              promptContext: {
                nodes: [],
                prompt: '',
                evidenceRefs: [],
                truncated: false,
              },
              origin: {
                kind: 'selection-ai',
                mode: 'agent',
                sourceKind: 'markdown',
                sourceLabel: 'notes.md · 选区',
                selectionPreview: 'A highlighted paragraph',
              },
            },
          ],
        },
      ],
      activeConversationId: 'conv-1',
      isOpen: true,
    });

    render(<AiChatPanel />);

    expect(screen.getAllByText('Selection AI / 深度分析').length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getByTestId('evidence-panel').textContent).toContain('msg-assistant');
    });
  });

  it('keeps the message stream scrollable inside a constrained right panel', () => {
    useAiChatStore.setState({
      conversations: [
        {
          id: 'conv-scroll',
          title: 'Long Chat',
          createdAt: Date.now(),
          messages: Array.from({ length: 24 }, (_, index) => ({
            id: `msg-${index}`,
            role: index % 2 === 0 ? 'user' : 'assistant',
            content: `Message ${index + 1}`,
            timestamp: Date.now() + index,
          })),
        },
      ],
      activeConversationId: 'conv-scroll',
      isOpen: true,
    });

    const { container } = render(
      <div className="h-[360px] w-[320px]">
        <AiChatPanel />
      </div>,
    );

    const panel = screen.getByTestId('ai-chat-panel');
    const frame = screen.getByTestId('ai-chat-message-frame');
    const scrollRegion = screen.getByTestId('ai-chat-message-scroll');

    expect(panel.className).toContain('overflow-hidden');
    expect(frame.className).toContain('min-h-0');
    expect(frame.className).toContain('flex-col');
    expect(scrollRegion.className).toContain('h-full');
    expect(scrollRegion.className).toContain('min-h-0');
    expect(scrollRegion.className).toContain('overflow-y-auto');
    expect(scrollRegion.parentElement).toBe(frame);
  });

  it('does not force-scroll long chat history when the reader is away from the bottom', () => {
    useAiChatStore.setState({
      conversations: [
        {
          id: 'conv-scroll-memory',
          title: 'Long Chat',
          createdAt: Date.now(),
          messages: Array.from({ length: 20 }, (_, index) => ({
            id: `msg-history-${index}`,
            role: index % 2 === 0 ? 'user' : 'assistant',
            content: `History message ${index + 1}`,
            timestamp: Date.now() + index,
          })),
        },
      ],
      activeConversationId: 'conv-scroll-memory',
      isOpen: true,
    });

    const { rerender } = render(<AiChatPanel />);
    const scrollRegion = screen.getByTestId('ai-chat-message-scroll') as HTMLDivElement;
    Object.defineProperties(scrollRegion, {
      scrollHeight: { configurable: true, value: 2400 },
      clientHeight: { configurable: true, value: 400 },
    });

    scrollRegion.scrollTop = 320;
    fireEvent.scroll(scrollRegion);

    useAiChatStore.setState((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === 'conv-scroll-memory'
          ? {
              ...conversation,
              messages: [
                ...conversation.messages,
                {
                  id: 'msg-new-while-reading',
                  role: 'assistant',
                  content: 'New streamed chunk while the reader is reviewing history',
                  timestamp: Date.now() + 100,
                },
              ],
            }
          : conversation,
      ),
    }));
    rerender(<AiChatPanel />);

    expect(scrollRegion.scrollTop).toBe(320);
  });

  it('keeps following new chat messages when the reader is already near the bottom', () => {
    useAiChatStore.setState({
      conversations: [
        {
          id: 'conv-scroll-follow',
          title: 'Long Chat',
          createdAt: Date.now(),
          messages: Array.from({ length: 20 }, (_, index) => ({
            id: `msg-follow-${index}`,
            role: index % 2 === 0 ? 'user' : 'assistant',
            content: `Message ${index + 1}`,
            timestamp: Date.now() + index,
          })),
        },
      ],
      activeConversationId: 'conv-scroll-follow',
      isOpen: true,
    });

    const { rerender } = render(<AiChatPanel />);
    const scrollRegion = screen.getByTestId('ai-chat-message-scroll') as HTMLDivElement;
    Object.defineProperties(scrollRegion, {
      scrollHeight: { configurable: true, value: 2400 },
      clientHeight: { configurable: true, value: 400 },
    });

    scrollRegion.scrollTop = 1980;
    fireEvent.scroll(scrollRegion);

    useAiChatStore.setState((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === 'conv-scroll-follow'
          ? {
              ...conversation,
              messages: [
                ...conversation.messages,
                {
                  id: 'msg-new-at-bottom',
                  role: 'assistant',
                  content: 'New streamed chunk at bottom',
                  timestamp: Date.now() + 100,
                },
              ],
            }
          : conversation,
      ),
    }));
    rerender(<AiChatPanel />);

    expect(scrollRegion.scrollTop).toBe(2400);
  });

  it('highlights selection-origin plans inside the workbench', async () => {
    useAiWorkbenchStore.setState({
      drafts: [],
      proposals: [
        {
          id: 'proposal-1',
          summary: '整理选区计划',
          steps: [
            { id: 'step-1', title: 'Review', description: 'Inspect the selected note.' },
          ],
          requiredApprovals: ['Confirm target note path'],
          plannedWrites: [
            {
              targetPath: 'AI Drafts/selection-plan.md',
              mode: 'create',
              contentPreview: 'Draft summary',
            },
          ],
          sourceRefs: [],
          status: 'pending',
          confirmedApprovals: ['Confirm target note path'],
          approvedWrites: ['AI Drafts/selection-plan.md'],
          generatedDraftTargets: [],
          createdAt: Date.now(),
          origin: {
            kind: 'selection-ai',
            mode: 'plan',
            sourceKind: 'markdown',
            sourceLabel: 'notes.md · 选区',
            selectionPreview: 'Plan this selection',
          },
        },
      ],
      highlightedProposalId: 'proposal-1',
    });

    render(<AiChatPanel />);

    await waitFor(() => {
      expect(screen.queryByText('Selection AI / 计划生成')).not.toBeNull();
      expect(screen.getByRole('button', { name: '生成目标草稿' }).className).toContain('bg-primary/10');
    });
  });

  it('separates standalone drafts from proposal-linked drafts in the workbench', async () => {
    useAiWorkbenchStore.setState({
      drafts: [
        {
          id: 'draft-standalone',
          type: 'paper_note',
          templateId: 'reading-note',
          title: 'Standalone note',
          sourceRefs: [],
          content: 'Standalone draft content',
          status: 'draft',
          createdAt: Date.now(),
        },
        {
          id: 'draft-linked',
          type: 'task_plan',
          templateId: 'task-plan',
          title: 'Linked plan draft',
          sourceRefs: [],
          content: 'Linked draft content',
          status: 'draft',
          createdAt: Date.now(),
          originProposalId: 'proposal-1',
          targetPath: 'AI Drafts/linked-plan.md',
        },
      ],
      proposals: [
        {
          id: 'proposal-1',
          summary: 'Plan linked drafts',
          steps: [
            { id: 'step-1', title: 'Review', description: 'Review linked drafts.' },
          ],
          requiredApprovals: [],
          plannedWrites: [
            {
              targetPath: 'AI Drafts/linked-plan.md',
              mode: 'create',
              contentPreview: 'Linked draft content',
            },
          ],
          sourceRefs: [],
          status: 'approved',
          confirmedApprovals: [],
          approvedWrites: ['AI Drafts/linked-plan.md'],
          generatedDraftTargets: ['AI Drafts/linked-plan.md'],
          createdAt: Date.now(),
        },
      ],
      highlightedProposalId: 'proposal-1',
    });

    render(<AiChatPanel />);

    await waitFor(() => {
      expect(screen.getByText('Standalone Drafts')).not.toBeNull();
      expect(screen.getByText('Linked Drafts')).not.toBeNull();
    });

    expect(screen.getByText('Standalone note')).not.toBeNull();
    expect(screen.getByText('Linked plan draft')).not.toBeNull();
    expect(screen.getByText('关联草稿：1')).not.toBeNull();
  });

  it('shows a structured coding review surface for code-change proposals', async () => {
    useAiWorkbenchStore.setState({
      drafts: [],
      proposals: [
        {
          id: 'proposal-coding',
          summary: 'Coding proposal: panel state patch',
          steps: [
            { id: 'step-1', title: 'Review target component', description: 'Inspect the smallest safe patch.' },
          ],
          requiredApprovals: ['Review patch preview'],
          plannedWrites: [
            {
              targetPath: 'AI Drafts/Panel state patch Code Review Plan.md',
              mode: 'create',
              contentPreview: [
                'Coding proposal: panel state patch',
                '',
                'Target files:',
                '- src/components/panel.tsx',
                '- src/lib/panel-state.ts',
                '',
                'Patch preview:',
                '- Draft a minimal diff against panel-state.',
                '',
                'Risks:',
                '- Check API contract changes.',
                '',
                'Test plan:',
                'Allowed QA commands:',
                '- npm run typecheck',
                '',
                'Suggested QA commands:',
                '- npm run qa:agent-smoke -- --unit-only',
                '',
                'Rejected / deferred commands:',
                '- npm run typecheck && git reset --hard',
                '',
                'Execution boundary:',
                '- These are approval-gated command plans only.',
                '',
                'Approval path:',
                '- Review this Workbench proposal.',
              ].join('\n'),
            },
          ],
          sourceRefs: [],
          status: 'pending',
          confirmedApprovals: [],
          approvedWrites: ['AI Drafts/Panel state patch Code Review Plan.md'],
          generatedDraftTargets: [],
          createdAt: Date.now(),
        },
      ],
      highlightedProposalId: null,
    });

    render(<AiChatPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Expand proposal' }));

    await waitFor(() => {
      expect(screen.getByTestId('coding-proposal-review-surface')).not.toBeNull();
    });
    expect(screen.getByText('src/components/panel.tsx')).not.toBeNull();
    expect(screen.getByText('src/lib/panel-state.ts')).not.toBeNull();
    expect(screen.getAllByText('npm run typecheck').length).toBeGreaterThan(0);
    expect(screen.getByText('npm run typecheck && git reset --hard')).not.toBeNull();
    expect(screen.getByText('These are approval-gated command plans only.')).not.toBeNull();
  });

  it('applies a prompt template directly to the chat input', async () => {
    render(<AiChatPanel />);

    fireEvent.click(screen.getByText('prompt.chat.open'));

    await waitFor(() => {
      expect(screen.getByTestId('prompt-picker-select-template')).not.toBeNull();
    });

    fireEvent.click(screen.getByTestId('prompt-picker-select-template'));

    await waitFor(() => {
      expect((screen.getByPlaceholderText('Ask') as HTMLTextAreaElement).value).toBe('Explain this');
    });
  });

  it('mounts prompt docks outside the clipped AI chat panel shell', async () => {
    render(<AiChatPanel />);

    fireEvent.click(screen.getByText('prompt.chat.open'));

    await waitFor(() => {
      expect(screen.getByTestId('prompt-picker-dock')).not.toBeNull();
    });

    expect(screen.getByTestId('ai-chat-panel').contains(screen.getByTestId('prompt-picker-dock'))).toBe(false);
  });

  it('updates the active AI model from the compact model switcher', async () => {
    render(<AiChatPanel />);

    fireEvent.click(screen.getByText('Auto model'));

    await waitFor(() => {
      expect(screen.getByText('Model quick switch')).not.toBeNull();
    });

    fireEvent.change(screen.getByLabelText('AI Provider'), {
      target: { value: 'openai' },
    });
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'gpt-4.1' },
    });
    fireEvent.click(screen.getByText('Apply'));

    await waitFor(() => {
      expect(useSettingsStore.getState().settings.aiProvider).toBe('openai');
      expect(useSettingsStore.getState().settings.aiModel).toBe('gpt-4.1');
      expect(screen.getByText('openai / gpt-4.1')).not.toBeNull();
    });
  });

  it('fills the chat composer from a continuation draft and switches to Agent mode', async () => {
    researchAgentMocks.runResearchAgentForChat.mockResolvedValue({
      plannerModel: null,
      plannerModelInfo: null,
      adapterWarnings: [],
      workflow: null,
      workflowPlannerHints: null,
      result: {
        sessionId: 'continuation-session-ui',
        promptContext: {
          nodes: [],
          prompt: '',
          evidenceRefs: [],
          truncated: false,
        },
      },
      agentResult: {
        sessionId: 'continuation-session-ui',
        planSource: 'default',
        warnings: [],
        planSteps: [],
        continuation: {
          sourceSessionId: 'source-session-alpha',
          compactionId: 'source-compaction-alpha',
          sourceSummary: 'Alpha compacted summary.',
        },
      },
      chatText: 'Agent session: continuation-session-ui',
    });
    useAiChatStore.setState({
      composerDraft: {
        text: 'Continue the Research Agent session "Alpha".',
        mode: 'agent',
        continuation: {
          sourceSessionId: 'source-session-alpha',
          compactionId: 'source-compaction-alpha',
          sourceSummary: 'Alpha compacted summary.',
        },
      },
    });

    render(<AiChatPanel />);

    await waitFor(() => {
    expect((screen.getByPlaceholderText('Ask') as HTMLTextAreaElement).value).toBe('Continue the Research Agent session "Alpha".');
    });
    expect(screen.getByText('Agent').className).toContain('bg-background');
    expect(useAiChatStore.getState().composerDraft).toBeNull();

    const runButtons = screen.getAllByTitle('Run Research Agent');
    fireEvent.click(runButtons[runButtons.length - 1]!);

    await waitFor(() => {
      expect(researchAgentMocks.runResearchAgentForChat).toHaveBeenCalledWith(expect.objectContaining({
        continuation: {
          sourceSessionId: 'source-session-alpha',
          compactionId: 'source-compaction-alpha',
          sourceSummary: 'Alpha compacted summary.',
        },
      }));
    });
  });

  it('runs Research Agent from chat input and stores evidence-backed metadata', async () => {
    researchAgentMocks.runResearchAgentForChat.mockResolvedValue({
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
        sessionId: 'research-session-ui',
        promptContext: {
          nodes: [],
          prompt: 'resolved evidence context',
          evidenceRefs: [
            {
              kind: 'file',
              label: 'notes.md',
              locator: 'notes.md',
              preview: 'Alpha evidence',
            },
          ],
          truncated: false,
        },
      },
      agentResult: {
        sessionId: 'research-session-ui',
        workflowLabel: 'Markdown Research',
        workflowInferred: true,
        planSource: 'custom',
        contextSummary: {
          omittedCount: 3,
          omittedTokens: 1800,
          preview: 'workspace_chunk: 3 omitted (notes/alpha.md)',
          modelSummaryStatus: 'generated',
          modelSummaryQuality: 'healthy - Covers omitted methods cues.',
          recoveryPlan: '1. read_indexed_context source=workspace_chunk label=notes/alpha.md',
        },
        memorySummary: {
          pendingSuggestionCount: 1,
          pendingSuggestionTitles: ['Alpha finding'],
        },
        warnings: [],
        planSteps: [
          { title: 'Build context pack', status: 'completed' },
          { title: 'Resolve evidence', status: 'completed', toolName: 'evidence.resolve' },
        ],
        toolObservations: Array.from({ length: 6 }, (_, index) => ({
          stepId: `workspace-search-${index + 1}`,
          toolName: index === 5 ? 'readIndexedContext' : 'workspace.search',
          status: index === 5 ? 'failed' : 'completed',
          preview: `Observation ${index + 1}`,
          evidenceCount: index === 0 ? 2 : 0,
          resultStatus: index === 5 ? 'failed' : 'completed',
          resultSummary: `Result ${index + 1}`,
          resultMetricsPreview: `items=${index + 1}`,
        })),
      },
      draftSuggestion: {
        type: 'research_summary',
        templateId: 'research-summary',
        title: 'Markdown Research: Explain Alpha',
        content: 'Structured draft body',
        targetPath: 'AI Drafts/Markdown Research Explain Alpha.md',
        writeMode: 'create',
      },
      followUpActions: [
        { id: 'create-workflow-draft', label: '保存为草稿', kind: 'create_draft' },
      ],
      chatText: 'Task: Explain Alpha\n\nAgent session: research-session-ui',
    });

    render(<AiChatPanel />);

    fireEvent.change(screen.getByPlaceholderText('Ask'), {
      target: { value: 'Explain Alpha' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Agent/ }));
    const runButtons = screen.getAllByTitle('Run Research Agent');
    fireEvent.click(runButtons[runButtons.length - 1]!);

    await waitFor(() => {
      expect(researchAgentMocks.runResearchAgentForChat).toHaveBeenCalledWith(expect.objectContaining({
        task: 'Explain Alpha',
        query: 'Explain Alpha',
        compact: true,
        suggestMemory: true,
        maxObservationReplans: 1,
        maxReadToolSteps: 5,
      }));
    });
    expect(researchAgentMocks.runResearchAgentForChat.mock.calls[0]?.[0]?.workflowId).toBeUndefined();

    await waitFor(() => {
      expect(screen.getByText(/Task: Explain Alpha/)).not.toBeNull();
      expect(screen.getByText('Run')).not.toBeNull();
      expect(screen.getByText('Workbench')).not.toBeNull();
      expect(screen.getByText(/Mode: draft-ready/)).not.toBeNull();
      expect(screen.getByText('Plan')).not.toBeNull();
      expect(screen.getByText('Observations')).not.toBeNull();
      expect(screen.getByText(/Workflow: Markdown Research \(auto\)/)).not.toBeNull();
      expect(screen.getByText(/Context omitted: 3 items \/ 1800 tokens/)).not.toBeNull();
      expect(screen.getByText(/Memory suggestions: 1 pending/)).not.toBeNull();
      expect(screen.getByText(/completed: Resolve evidence/)).not.toBeNull();
      expect(screen.getByText(/6 observations \/ statuses: completed=5, failed=1/)).not.toBeNull();
      expect(screen.getByText(/workspace-search-4/)).not.toBeNull();
      expect(screen.queryByText(/workspace-search-5/)).toBeNull();
      expect(screen.getByText(/\.\.\. 2 more observations hidden in Trace/)).not.toBeNull();
    });

    const activeConversation = useAiChatStore.getState().getActiveConversation();
    const assistant = activeConversation?.messages.find((message): message is ChatMessage =>
      message.role === 'assistant' && message.content.includes('research-session-ui'),
    );

    expect(activeConversation?.messages[0]?.content).toBe('[Research Agent] Explain Alpha');
    expect(assistant?.model).toMatchObject({ providerName: 'OpenAI', model: 'gpt-test' });
    expect(assistant?.evidenceRefs?.[0]).toMatchObject({ locator: 'notes.md' });
    expect(assistant?.promptContext?.prompt).toBe('resolved evidence context');
    expect(assistant?.draftSuggestion).toEqual({
      type: 'research_summary',
      templateId: 'research-summary',
      title: 'Markdown Research: Explain Alpha',
      content: 'Structured draft body',
      targetPath: 'AI Drafts/Markdown Research Explain Alpha.md',
      writeMode: 'create',
    });
    expect(assistant?.followUpActions?.map((action) => action.kind)).toEqual(['create_draft']);
    expect(assistant?.agentResult?.sessionId).toBe('research-session-ui');
    expect(useAgentSessionStore.getState().activeSessionId).toBeNull();
    expect(screen.getByTestId('ai-chat-follow-up-save-draft')).not.toBeNull();
    expect(screen.queryByTestId('ai-chat-follow-up-generate-proposal')).toBeNull();

    fireEvent.click(screen.getByTestId('ai-chat-follow-up-save-draft'));

    await waitFor(() => {
      expect(useAiWorkbenchStore.getState().drafts[0]).toMatchObject({
        type: 'research_summary',
        templateId: 'research-summary',
        title: 'Markdown Research: Explain Alpha',
        content: 'Structured draft body',
        targetPath: 'AI Drafts/Markdown Research Explain Alpha.md',
        writeMode: 'create',
      });
    });

    fireEvent.click(screen.getByTitle('Open agent trace'));

    expect(useAgentSessionStore.getState().activeSessionId).toBe('research-session-ui');
    expect(useAgentSessionStore.getState().focusTarget).toBeNull();
    useAgentSessionStore.getState().setActiveSession(null);

    fireEvent.click(screen.getByTitle('Review memory suggestions'));

    expect(useAgentSessionStore.getState().activeSessionId).toBe('research-session-ui');
    expect(useAgentSessionStore.getState().focusTarget).toBeNull();
  });

  it('keeps Agent advanced options collapsed while exposing effort presets', async () => {
    researchAgentMocks.runResearchAgentForChat.mockResolvedValue({
      plannerModel: null,
      plannerModelInfo: null,
      adapterWarnings: [],
      workflow: null,
      workflowPlannerHints: null,
      result: {
        sessionId: 'research-session-effort',
        promptContext: {
          nodes: [],
          prompt: '',
          evidenceRefs: [],
          truncated: false,
        },
      },
      agentResult: {
        sessionId: 'research-session-effort',
        planSource: 'default',
        warnings: [],
        planSteps: [],
      },
      chatText: 'Agent session: research-session-effort',
    });

    render(<AiChatPanel />);

    fireEvent.change(screen.getByPlaceholderText('Ask'), {
      target: { value: 'Explain with more effort' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Agent/ }));

    expect(screen.getByTestId('ai-chat-mode-agent').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('ai-chat-agent-effort-medium').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByLabelText('Suggest memory')).toBeNull();

    const advancedToggle = screen.getByTestId('ai-chat-agent-advanced-toggle');
    expect(advancedToggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(advancedToggle);
    expect(advancedToggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('ai-chat-agent-advanced-panel')).not.toBeNull();
    expect(screen.getByTestId('ai-chat-agent-workflow-label').textContent).toContain('Auto');
    expect(screen.getByLabelText('Suggest memory')).not.toBeNull();

    fireEvent.click(screen.getByTestId('ai-chat-agent-effort-high'));
    expect(screen.getByTestId('ai-chat-agent-effort-high').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('ai-chat-submit'));

    await waitFor(() => {
      expect(researchAgentMocks.runResearchAgentForChat).toHaveBeenCalledWith(expect.objectContaining({
        task: 'Explain with more effort',
        maxObservationReplans: 2,
        maxReadToolSteps: 8,
        contextBudgetProfileId: 'research',
      }));
    });
  });

  it('keeps explicit workflow presets visible but easy to clear back to automatic inference', async () => {
    researchAgentMocks.runResearchAgentForChat.mockResolvedValue({
      plannerModel: null,
      plannerModelInfo: null,
      adapterWarnings: [],
      workflow: null,
      workflowPlannerHints: null,
      result: {
        sessionId: 'research-session-workflow',
        promptContext: {
          nodes: [],
          prompt: '',
          evidenceRefs: [],
          truncated: false,
        },
      },
      agentResult: {
        sessionId: 'research-session-workflow',
        planSource: 'default',
        warnings: [],
        planSteps: [],
      },
      chatText: 'Agent session: research-session-workflow',
    });
    useAiChatStore.getState().setResearchWorkflow('knowledge-organization');

    render(<AiChatPanel />);

    fireEvent.change(screen.getByPlaceholderText('Ask'), {
      target: { value: 'Organize this workspace' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Agent/ }));
    fireEvent.click(screen.getByTestId('ai-chat-agent-advanced-toggle'));

    expect(screen.getByTestId('ai-chat-agent-workflow-label').textContent).toContain('Knowledge Organization');
    expect(screen.getByTestId('ai-chat-agent-workflow-label').textContent).toContain('explicit');
    fireEvent.click(screen.getByTestId('ai-chat-submit'));

    await waitFor(() => {
      expect(researchAgentMocks.runResearchAgentForChat).toHaveBeenCalledWith(expect.objectContaining({
        task: 'Organize this workspace',
        workflowId: 'knowledge-organization',
      }));
    });

    researchAgentMocks.runResearchAgentForChat.mockClear();
    fireEvent.change(screen.getByPlaceholderText('Ask'), {
      target: { value: 'Let the agent infer the workflow' },
    });
    fireEvent.click(screen.getByTestId('ai-chat-agent-workflow-clear'));

    expect(screen.getByTestId('ai-chat-agent-workflow-label').textContent).toContain('Auto');
    expect(screen.getByTestId('ai-chat-agent-workflow-label').textContent).toContain('auto');
    expect(useAiChatStore.getState().selectedResearchWorkflowId).toBeNull();

    fireEvent.click(screen.getByTestId('ai-chat-submit'));

    await waitFor(() => {
      expect(researchAgentMocks.runResearchAgentForChat).toHaveBeenCalledWith(expect.objectContaining({
        task: 'Let the agent infer the workflow',
      }));
    });
    expect(researchAgentMocks.runResearchAgentForChat.mock.calls[0]?.[0]?.workflowId).toBeUndefined();
  });

  it('keeps the default chat composer compact until Agent mode is selected', () => {
    render(<AiChatPanel />);

    expect(screen.getByTestId('ai-chat-mode-chat').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('ai-chat-submit').getAttribute('title')).toBe('Send');
    expect(screen.queryByTestId('ai-chat-agent-effort-medium')).toBeNull();
    expect(screen.queryByTestId('ai-chat-agent-advanced-toggle')).toBeNull();
    expect(screen.queryByTestId('ai-chat-agent-advanced-panel')).toBeNull();

    fireEvent.click(screen.getByTestId('ai-chat-mode-agent'));

    expect(screen.getByTestId('ai-chat-mode-agent').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('ai-chat-submit').getAttribute('title')).toBe('Run Research Agent');
    expect(screen.getByTestId('ai-chat-agent-effort-medium')).not.toBeNull();
    expect(screen.getByTestId('ai-chat-agent-advanced-toggle').getAttribute('aria-expanded')).toBe('false');
  });

  it('sends the current file content and PDF annotations in regular Chat mode', async () => {
    const fileId = 'papers-alpha.pdf';
    const activeTab = {
      id: 'tab-current-pdf',
      kind: 'file' as const,
      fileName: 'alpha.pdf',
      filePath: 'papers/alpha.pdf',
      isDirty: false,
      scrollPosition: 0,
      fileHandle: {
        getFile: vi.fn(),
      } as unknown as FileSystemFileHandle,
    };

    useWorkspaceStore.setState({
      rootHandle: null,
      layout: {
        activePaneId: 'pane-ai-context',
        root: {
          type: 'pane',
          id: 'pane-ai-context',
          tabs: [activeTab],
          activeTabIndex: 0,
        },
      },
    });
    useContentCacheStore.getState().setContent(
      activeTab.id,
      'Cached current PDF text extracted from the renderer.',
      'Cached current PDF text extracted from the renderer.',
    );
    useAnnotationStore.setState({
      annotations: new Map([
        [fileId, [
          {
            id: 'ann-1',
            fileId,
            page: 2,
            position: {
              boundingRect: { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2, width: 100, height: 100 },
              rects: [],
            },
            content: { text: 'Important highlighted evidence' },
            comment: 'Use this note as evidence.',
            color: 'yellow',
            timestamp: 1,
            type: 'text',
          },
        ]],
      ]),
    });

    render(<AiChatPanel />);

    fireEvent.change(screen.getByPlaceholderText('Ask'), {
      target: { value: 'Summarize the current PDF.' },
    });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));

    await waitFor(() => {
      expect(orchestratorMocks.runChat).toHaveBeenCalledWith(expect.objectContaining({
        prompt: 'Summarize the current PDF.',
        filePath: 'papers/alpha.pdf',
        content: 'Cached current PDF text extracted from the renderer.',
        annotations: [expect.objectContaining({
          id: 'ann-1',
          comment: 'Use this note as evidence.',
          content: 'Important highlighted evidence',
          target: expect.objectContaining({
            type: 'pdf',
            page: 2,
          }),
          style: expect.objectContaining({
            color: 'yellow',
            type: 'highlight',
          }),
        })],
      }));
    });
  });

  it('falls back to PDF text extraction when the renderer cache is empty', async () => {
    const destroy = vi.fn();
    pdfContextMocks.loadPdfJsDocument.mockResolvedValue({
      numPages: 2,
      destroy,
    });
    pdfContextMocks.getPdfPageSearchText.mockImplementation(async (_document, pageNumber: number) =>
      pageNumber === 1 ? 'Extracted PDF introduction and result evidence.' : 'Extracted PDF methods evidence.',
    );

    const activeTab = {
      id: 'tab-empty-cache-pdf',
      kind: 'file' as const,
      fileName: 'empty-cache.pdf',
      filePath: 'papers/empty-cache.pdf',
      isDirty: false,
      scrollPosition: 0,
      fileHandle: {
        getFile: vi.fn().mockResolvedValue(new File([new Uint8Array([37, 80, 68, 70])], 'empty-cache.pdf', {
          type: 'application/pdf',
        })),
      } as unknown as FileSystemFileHandle,
    };

    useWorkspaceStore.setState({
      rootHandle: null,
      layout: {
        activePaneId: 'pane-empty-cache-pdf',
        root: {
          type: 'pane',
          id: 'pane-empty-cache-pdf',
          tabs: [activeTab],
          activeTabIndex: 0,
        },
      },
    });
    useContentCacheStore.getState().setContent(activeTab.id, '', '');

    render(<AiChatPanel />);

    fireEvent.change(screen.getByPlaceholderText('Ask'), {
      target: { value: 'Summarize this PDF.' },
    });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));

    await waitFor(() => {
      expect(orchestratorMocks.runChat).toHaveBeenCalledWith(expect.objectContaining({
        filePath: 'papers/empty-cache.pdf',
        content: expect.stringContaining('Extracted PDF introduction and result evidence.'),
      }));
    });
    expect(pdfContextMocks.loadPdfJsDocument).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });

  it('keeps prepared current-file context on regular Chat provider errors', async () => {
    orchestratorMocks.runChat.mockRejectedValueOnce(new Error('Provider unavailable'));
    const activeTab = {
      id: 'tab-current-md',
      kind: 'file' as const,
      fileName: 'note.md',
      filePath: 'notes/note.md',
      isDirty: false,
      scrollPosition: 0,
      fileHandle: {
        getFile: vi.fn(),
      } as unknown as FileSystemFileHandle,
    };

    useWorkspaceStore.setState({
      rootHandle: null,
      layout: {
        activePaneId: 'pane-ai-error-context',
        root: {
          type: 'pane',
          id: 'pane-ai-error-context',
          tabs: [activeTab],
          activeTabIndex: 0,
        },
      },
    });
    useContentCacheStore.getState().setContent(
      activeTab.id,
      '# Current Note\n\nEvidence that should stay visible after an AI error.',
      '# Current Note\n\nEvidence that should stay visible after an AI error.',
    );

    render(<AiChatPanel />);

    fireEvent.change(screen.getByPlaceholderText('Ask'), {
      target: { value: 'Use the current note.' },
    });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));

    await waitFor(() => {
      expect(screen.getByText(/Error: Provider unavailable/)).not.toBeNull();
    });

    const activeConversation = useAiChatStore.getState().getActiveConversation();
    const assistant = activeConversation?.messages.find((message) =>
      message.role === 'assistant' && message.content.includes('Provider unavailable'),
    );

    expect(assistant?.promptContext?.nodes.some((node) =>
      node.label === 'Current file: notes/note.md' &&
      node.content.includes('Evidence that should stay visible after an AI error'),
    )).toBe(true);
    expect(assistant?.evidenceRefs?.some((ref) => ref.locator === 'notes/note.md')).toBe(true);
  });

  it('keeps prepared current-file context on Research Agent failures', async () => {
    researchAgentMocks.runResearchAgentForChat.mockRejectedValueOnce(new Error('Agent unavailable'));
    const activeTab = {
      id: 'tab-agent-current-md',
      kind: 'file' as const,
      fileName: 'agent-note.md',
      filePath: 'notes/agent-note.md',
      isDirty: false,
      scrollPosition: 0,
      fileHandle: {
        getFile: vi.fn(),
      } as unknown as FileSystemFileHandle,
    };

    useWorkspaceStore.setState({
      rootHandle: null,
      layout: {
        activePaneId: 'pane-ai-agent-error-context',
        root: {
          type: 'pane',
          id: 'pane-ai-agent-error-context',
          tabs: [activeTab],
          activeTabIndex: 0,
        },
      },
    });
    useContentCacheStore.getState().setContent(
      activeTab.id,
      '# Agent Current Note\n\nEvidence that should stay visible after an agent error.',
      '# Agent Current Note\n\nEvidence that should stay visible after an agent error.',
    );

    render(<AiChatPanel />);

    fireEvent.change(screen.getByPlaceholderText('Ask'), {
      target: { value: 'Use the current note as an agent.' },
    });
    fireEvent.click(screen.getByTestId('ai-chat-mode-agent'));
    fireEvent.click(screen.getByTestId('ai-chat-submit'));

    await waitFor(() => {
      expect(screen.getByText(/Error: Agent unavailable/)).not.toBeNull();
    });

    const activeConversation = useAiChatStore.getState().getActiveConversation();
    const assistant = activeConversation?.messages.find((message) =>
      message.role === 'assistant' && message.content.includes('Agent unavailable'),
    );

    expect(assistant?.promptContext?.nodes.some((node) =>
      node.label === 'Current file: notes/agent-note.md' &&
      node.content.includes('Evidence that should stay visible after an agent error'),
    )).toBe(true);
    expect(assistant?.evidenceRefs?.some((ref) => ref.locator === 'notes/agent-note.md')).toBe(true);
  });

  it('extracts readable text from PDF files for AI context when no cached renderer text exists', async () => {
    const destroy = vi.fn();
    pdfContextMocks.loadPdfJsDocument.mockResolvedValue({
      numPages: 3,
      destroy,
    });
    pdfContextMocks.getPdfPageSearchText.mockImplementation(async (_document, pageNumber: number) =>
      pageNumber === 2 ? 'Second page evidence text' : `Page ${pageNumber} text`,
    );

    const file = new File([new Uint8Array([37, 80, 68, 70])], 'paper.pdf', {
      type: 'application/pdf',
    });

    const context = await readFileForAiContext(file, 'papers/paper.pdf');

    expect(pdfContextMocks.loadPdfJsDocument).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.any(ArrayBuffer),
      label: 'ai-context:papers/paper.pdf',
    }));
    expect(pdfContextMocks.getPdfPageSearchText).toHaveBeenCalledTimes(3);
    expect(context).toContain('PDF text extracted from papers/paper.pdf');
    expect(context).toContain('--- Page 2 ---');
    expect(context).toContain('Second page evidence text');
    expect(destroy).toHaveBeenCalled();
  });

  it('does not show Workbench follow-up buttons for answer-only Agent results', async () => {
    researchAgentMocks.runResearchAgentForChat.mockResolvedValue({
      plannerModel: null,
      plannerModelInfo: null,
      adapterWarnings: [],
      workflow: null,
      workflowPlannerHints: null,
      followUpActions: [],
      result: {
        sessionId: 'research-session-answer-only',
        promptContext: {
          nodes: [],
          prompt: '',
          evidenceRefs: [],
          truncated: false,
        },
      },
      agentResult: {
        sessionId: 'research-session-answer-only',
        workflowLabel: 'Teaching Explain',
        workflowInferred: true,
        planSource: 'default',
        warnings: [],
        planSteps: [],
      },
      chatText: 'Teaching answer\n\nAgent session: research-session-answer-only',
    });

    render(<AiChatPanel />);

    fireEvent.change(screen.getByPlaceholderText('Ask'), {
      target: { value: 'Explain Alpha simply' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Agent/ }));
    const runButtons = screen.getAllByTitle('Run Research Agent');
    fireEvent.click(runButtons[runButtons.length - 1]!);

    await waitFor(() => {
      expect(screen.getByText(/Teaching answer/)).not.toBeNull();
      expect(screen.getByText('Workbench')).not.toBeNull();
      expect(screen.getByText(/Mode: answer-only/)).not.toBeNull();
    });

    expect(screen.queryByText('Save draft')).toBeNull();
    expect(screen.queryByText('Generate proposal')).toBeNull();
  });

  it('can disable Research Agent memory suggestions for the current run', async () => {
    researchAgentMocks.runResearchAgentForChat.mockResolvedValue({
      plannerModel: null,
      plannerModelInfo: null,
      adapterWarnings: [],
      workflow: null,
      workflowPlannerHints: null,
      result: {
        sessionId: 'research-session-no-memory',
        promptContext: {
          nodes: [],
          prompt: '',
          evidenceRefs: [],
          truncated: false,
        },
      },
      agentResult: {
        sessionId: 'research-session-no-memory',
        planSource: 'default',
        warnings: [],
        planSteps: [],
      },
      chatText: 'Agent session: research-session-no-memory',
    });

    render(<AiChatPanel />);

    fireEvent.change(screen.getByPlaceholderText('Ask'), {
      target: { value: 'Explain without memory' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Agent/ }));
    fireEvent.click(screen.getByTestId('ai-chat-agent-advanced-toggle'));
    fireEvent.click(screen.getByLabelText('Suggest memory'));
    fireEvent.click(screen.getByTestId('ai-chat-submit'));

    await waitFor(() => {
      expect(researchAgentMocks.runResearchAgentForChat).toHaveBeenCalledWith(expect.objectContaining({
        task: 'Explain without memory',
        suggestMemory: false,
      }));
    });
  });
});
