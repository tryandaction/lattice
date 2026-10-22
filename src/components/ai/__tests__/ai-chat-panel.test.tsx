/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as resultViewModel from '@/lib/ai/result-view-model';
import * as composerModule from '../chat-composer';
import * as markdownModule from '@/components/renderers/markdown-renderer';
import * as documentSourceModule from '@/lib/ai/document-source';
import * as researchCore from '@/lib/ai/research-agent';
import * as fileSystemHooks from '@/hooks/use-file-system';
import * as workbenchActions from '@/lib/ai/workbench-actions';
import * as modelRouter from '@/lib/ai/model-router';
import { WorkbenchQueue } from '../workbench-queue';

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

const linkNavigationMocks = vi.hoisted(() => {
  const navigateLink = vi.fn().mockResolvedValue(true);
  return {
    navigateLink,
    navigateLinkDetailed: vi.fn(async (...args: unknown[]) => {
      const ok = await navigateLink(...args);
      return {
        ok,
        requestId: 'nav-chat-test',
        status: ok ? 'pending' : 'file_not_found',
      };
    }),
  };
});

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

vi.mock('@/lib/link-router/navigate-link', () => ({
  navigateLink: linkNavigationMocks.navigateLink,
  navigateLinkDetailed: linkNavigationMocks.navigateLinkDetailed,
}));

vi.mock('@/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const mapping: Record<string, string> = {
        'chat.title': 'AI Chat',
        'chat.runtime.source': 'AI 来源',
        'chat.runtime.model': 'AI 模型',
        'chat.runtime.defaultApi': '默认 API',
        'chat.runtime.configuredApi': '已配置 API',
        'chat.runtime.localAssistants': '本机助手',
        'chat.runtime.notInstalled': '未安装',
        'chat.runtime.updateRequired': '需更新',
        'chat.runtime.notSignedIn': '未登录',
        'chat.runtime.defaultModel': '默认模型',
        'chat.runtime.noModel': '尚未配置模型',
        'chat.runtime.discovering': '检测本机助手',
        'chat.runtime.switchToApi': '切换到 API',
        'chat.runtime.settings': 'AI 连接设置',
        'chat.runtime.closeSettings': '关闭 AI 连接设置',
        'chat.runtime.desktopRequired': '请在桌面版选择本机助手。',
        'chat.runtime.chooseAssistant': '选择已安装的助手',
        'chat.runtime.executableFilter': '助手可执行程序',
        'chat.runtime.loginRequired': '需要登录',
        'chat.runtime.detected': '已检测到安装',
        'chat.runtime.incompatible': '版本不兼容',
        'chat.runtime.notDetected': '待检测',
        'chat.runtime.refresh': '重新检测',
        'chat.runtime.chooseInstalledApp': '选择已安装应用',
        'chat.runtime.autoFind': '自动查找',
        'chat.runtime.loginHint': '在原助手登录后，点击重新检测。',
        'chat.runtime.advanced': '高级连接与诊断',
        'chat.runtime.location': '程序位置',
        'chat.runtime.executable': 'Agent 可执行文件',
        'chat.runtime.autoDiscover': '自动发现',
        'chat.runtime.customModel': '自定义模型',
        'chat.runtime.agentModel': 'Agent 模型',
        'chat.workspace.title': 'AI Workspace',
          'chat.history.title': 'Chat history',
          'chat.history.clear': 'Clear history',
          'chat.history.empty': 'No conversations yet',
          'chat.history.saveRename': 'Save new name',
          'explorer.context.rename': 'Rename',
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
        'chat.retry': 'Retry',
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
import { addAgentPendingApproval, createAgentSession } from '@/lib/ai/agent-session';
import { useAiPdfCompanionStore } from '@/stores/ai-pdf-companion-store';
import { useScheduledTaskStore } from '@/stores/scheduled-task-store';
import { useAiProviderProfileStore } from '@/stores/ai-provider-profile-store';
import { createDefaultAiProviderProfile } from '@/lib/ai/provider-profiles';
import { useAiHarnessStore } from '@/stores/ai-harness-store';
import { setCloudWorkspaceActive, setCloudWorkspaceProvider, setCloudWorkspaceResource, resetCloudWorkspaceHost, registerCloudWorkspaceNavigator } from '@/lib/cloud-workspace-host';
import type { CloudLibrarySourceProvider, CloudLibraryResource } from '@/lib/shared-library/source-provider';
import { getAgentDocumentVersion } from '@/lib/ai/document-source';
import { buildCitationContract, citationNavigationHref } from '@/lib/ai/citation-contract';
import { SourceTestDirectory, SourceTestFile } from '@/lib/ai/__tests__/fixtures/source-workspace';

describe('AiChatPanel selection-origin flows', () => {
  it('keeps completed messages and the composer out of token-by-token renders', async () => {
    const history: ChatMessage[] = Array.from({ length: 40 }, (_, index) => ({
      id: `stable-${index}`,
      role: 'assistant',
      content: `Completed research answer ${index}: **verified result**.`,
      timestamp: index,
    }));
    useAiChatStore.setState({
      conversations: [{ id: 'stream-performance', title: 'Research', createdAt: 1, messages: [
        ...history, { id: 'streaming', role: 'assistant', content: 'Live', timestamp: 41, isStreaming: true },
      ] }],
      activeConversationId: 'stream-performance', isOpen: true, isGenerating: true, activeAssistantMessageId: 'streaming',
    });
    const modelSpy = vi.spyOn(resultViewModel, 'buildAiResultViewModel');
    const composerSpy = vi.spyOn(composerModule, 'ChatComposer');
    const markdownSpy = vi.spyOn(markdownModule, 'MarkdownRenderer');
    try {
      await act(async () => { render(<AiChatPanel loadPersistedState={false} />); });
      const scrollRegion = screen.getByTestId('ai-chat-message-scroll');
      const readScrollHeight = vi.fn(() => 1200);
      Object.defineProperty(scrollRegion, 'scrollHeight', { configurable: true, get: readScrollHeight });
      await waitFor(() => expect(readScrollHeight).toHaveBeenCalled());
      modelSpy.mockClear();
      composerSpy.mockClear();
      markdownSpy.mockClear();
      readScrollHeight.mockClear();
      for (let index = 0; index < 12; index += 1) {
        act(() => useAiChatStore.getState().appendToAssistantMessage('streaming', ` chunk${index}`));
      }
      expect(screen.getByText(/Live chunk0/).textContent).toContain('chunk11');
      expect(screen.getAllByText(/Completed research answer/)).toHaveLength(40);
      expect(modelSpy.mock.calls.filter(([message]) => message.id.startsWith('stable-'))).toHaveLength(0);
      expect(markdownSpy.mock.calls.filter(([props]) => props.content.startsWith('Completed research answer'))).toHaveLength(0);
      expect(composerSpy).not.toHaveBeenCalled();
      // Multiple token commits in one frame trigger one layout read/write.
      await waitFor(() => expect(readScrollHeight).toHaveBeenCalledTimes(1));
      act(() => {
        useAiChatStore.getState().appendToAssistantMessage('streaming', ' final visible tail');
        useAiChatStore.getState().stopGenerating();
      });
      expect(screen.getByText(/Live chunk0/).textContent).toContain('chunk11 final visible tail');
      expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.isStreaming).toBe(false);
    } finally {
      modelSpy.mockRestore();
      composerSpy.mockRestore();
      markdownSpy.mockRestore();
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetCloudWorkspaceHost();
    useAiHarnessStore.getState().setConfig({ engine: 'api' });
    useWorkspaceStore.setState({ rootHandle: null, workspaceRootPath: null, workspaceIdentity: null, layout: { activePaneId: 'ai-test-empty', root: { type: 'pane', id: 'ai-test-empty', tabs: [], activeTabIndex: -1 } } });
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        aiEnabled: true,
      },
      isLoading: false,
      isInitialized: true,
      error: null,
    });
    useAiProviderProfileStore.setState({
      profiles: [],
      activeProfileId: null,
      isLoading: false,
      isInitialized: true,
      error: null,
    });
    useAiChatStore.setState({
      conversations: [],
      activeConversationId: null,
      hasHydratedConversations: false,
      hydrationError: null,
      persistenceError: null,
      isOpen: true,
      isGenerating: false,
      abortController: null,
      activeAssistantMessageId: null,
      selectedResearchWorkflowId: null,
      composerDraft: null,
      composerMode: 'chat',
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
    useScheduledTaskStore.getState().resetForTests();
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

  it('hydrates scheduled tasks when the AI workspace mounts', async () => {
    const hydrate = vi.spyOn(useScheduledTaskStore.getState(), 'hydrate');
    render(<AiChatPanel loadPersistedState={false} />);
    await waitFor(() => expect(hydrate).toHaveBeenCalled());
    hydrate.mockRestore();
  });

  it('switches, renames, deletes, and clears persisted conversations from the history menu', async () => {
    useAiChatStore.setState({
      conversations: [
        { id: 'conv-history-a', title: 'First', createdAt: 1, messages: [{ id: 'm-a', role: 'user', content: 'A', timestamp: 1 }] },
        { id: 'conv-history-b', title: 'Second', createdAt: 2, messages: [{ id: 'm-b', role: 'user', content: 'B', timestamp: 2 }] },
      ],
      activeConversationId: 'conv-history-a',
    });

    render(<AiChatPanel loadPersistedState={false} />);
    useAiPdfCompanionStore.getState().setTransientAnnotations([{
      id: 'transient-history-delete',
      documentPath: 'paper.pdf',
      page: 1,
      rects: [{ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2 }],
      quote: 'old evidence',
      source: { kind: 'pdf_page', label: 'paper.pdf', locator: 'paper.pdf#page=1' },
    }]);
    fireEvent.click(screen.getByTestId('ai-workspace-history-toggle'));
    expect(screen.getByTestId('ai-workspace-history-menu')).not.toBeNull();

    fireEvent.click(screen.getByText('Second'));
    expect(useAiChatStore.getState().activeConversationId).toBe('conv-history-b');
    fireEvent.click(screen.getByTestId('ai-workspace-history-toggle'));
    fireEvent.click(screen.getByTestId('ai-workspace-history-row-conv-history-b').querySelector('[title="Rename"]')!);
    fireEvent.change(screen.getByTestId('ai-workspace-history-rename-input'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByTitle('Save new name'));
    expect(useAiChatStore.getState().getActiveConversation()?.title).toBe('Renamed');

    fireEvent.click(screen.getAllByTitle('Delete Chat')[0]!);
    expect(useAiChatStore.getState().conversations).toHaveLength(1);
    expect(useAiPdfCompanionStore.getState().transientAnnotations).toEqual([]);
    fireEvent.click(screen.getByTestId('ai-workspace-history-clear'));
    expect(useAiChatStore.getState().conversations).toEqual([]);
    await Promise.resolve();
  });

  it('shows selection-origin badges and keeps the conversation visible after opening a source', async () => {
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
              content: 'Conclusion\n\nImportant answer [Selected passage](notes.md#text=A%20highlighted%20paragraph)',
              timestamp: Date.now(),
              evidenceRefs: [
                {
                  kind: 'file',
                  label: 'notes.md',
                  locator: 'notes.md',
                  anchor: { snippet: 'A highlighted paragraph' },
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

    expect(screen.queryByTestId('agent-inspector-body')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Selected passage' }));
    await waitFor(() => expect(linkNavigationMocks.navigateLink).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('agent-inspector-body')).toBeNull();
    expect(screen.getByTestId('ai-chat-message-frame')).not.toBeNull();
  });

  it('returns to a focused conversation after starting a new chat', async () => {
    useAiChatStore.setState({
      conversations: [{
        id: 'conv-inspector-reset',
        title: 'Inspector reset',
        createdAt: Date.now(),
        messages: [{
          id: 'msg-inspector-reset',
          role: 'assistant',
          content: 'Answer with a source.',
          timestamp: Date.now(),
          evidenceRefs: [{ kind: 'file', label: 'paper.md', locator: 'notes/paper.md' }],
        }],
      }],
      activeConversationId: 'conv-inspector-reset',
      isOpen: true,
    });

    render(<AiChatPanel />);

    fireEvent.click(screen.getByTestId('agent-status-open-review'));
    expect(screen.getByTestId('agent-inspector-body')).not.toBeNull();

    fireEvent.click(screen.getByTestId('ai-workspace-new-chat'));

    await waitFor(() => {
      expect(screen.queryByTestId('agent-inspector-body')).toBeNull();
    });
  });

  it('shows a readable PDF citation and forwards its exact anchor when opened', async () => {
    const anchor = {
      page: 3,
      snippet: 'Erasure conversion preserves the logical information after detection.',
    };
    useAiChatStore.setState({
      conversations: [{
        id: 'conv-pdf-evidence',
        title: 'PDF evidence',
        createdAt: Date.now(),
        messages: [{
          id: 'msg-pdf-evidence',
          role: 'assistant',
          content: 'Detailed answer with a [paper.pdf · p.3](papers/research/paper.pdf#page=3&text=Erasure%20conversion%20preserves%20the%20logical%20information%20after%20detection.).',
          timestamp: Date.now(),
          evidenceRefs: [{
            kind: 'pdf_page',
            label: 'paper.pdf',
            locator: 'papers/research/paper.pdf',
            anchor,
          }],
        }],
      }],
      activeConversationId: 'conv-pdf-evidence',
      isOpen: true,
    });

    render(<AiChatPanel />);

    const chip = screen.getByRole('link', { name: 'paper.pdf · p.3' });
    expect(chip.textContent).toContain('paper.pdf');
    expect(chip.textContent).toContain('p.3');
    expect(chip.textContent).not.toContain('Erasure conversion preserves the logical information');
    expect(linkNavigationMocks.navigateLink).not.toHaveBeenCalled();
    expect(chip.title).toContain('p.3');
    expect(chip.title).toContain('Erasure conversion preserves the logical information');
    fireEvent.click(chip);

    await waitFor(() => {
      expect(linkNavigationMocks.navigateLink).toHaveBeenCalledWith(
        'papers/research/paper.pdf',
        expect.objectContaining({ evidenceAnchor: anchor }),
      );
    });
    expect(linkNavigationMocks.navigateLink).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('agent-inspector-body')).toBeNull();
  });

  it('keeps model-authored evidence text visible instead of replacing it with source chips', () => {
    useAiChatStore.setState({
      conversations: [{ id: 'evidence-body', title: 'Evidence', createdAt: 1, messages: [{
        id: 'evidence-answer', role: 'assistant', timestamp: 1,
        content: '## Conclusion\nA measured field.\n\n## Evidence\nThe measured field is documented in the experimental methods.',
      }] }],
      activeConversationId: 'evidence-body', isOpen: true,
    });
    render(<AiChatPanel />);
    expect(screen.getByText('The measured field is documented in the experimental methods.')).toBeTruthy();
  });

  it('does not present supplied context pages as citations when the answer cites none', () => {
    useAiChatStore.setState({
      conversations: [{
        id: 'conv-chip-window',
        title: 'Citation chips',
        createdAt: Date.now(),
        messages: [{
          id: 'msg-chip-window',
          role: 'assistant',
          content: 'Answer with several passages.',
          timestamp: Date.now(),
          evidenceRefs: Array.from({ length: 4 }, (_, index) => ({
            kind: 'pdf_page' as const,
            label: 'papers/quantum.pdf',
            locator: `papers/quantum.pdf#page=${index + 1}`,
            preview: `Passage ${index + 1}`,
            anchor: { page: index + 1, snippet: `Passage ${index + 1}` },
          })),
        }],
      }],
      activeConversationId: 'conv-chip-window',
      isOpen: true,
    });

    render(<AiChatPanel />);

    expect(screen.queryByTestId('ai-chat-evidence-chips')).toBeNull();
    expect(screen.queryByTestId('ai-chat-evidence-more')).toBeNull();
    expect(screen.getByTestId('ai-chat-context-details')).toBeTruthy();
    expect(screen.queryByTestId('agent-inspector-body')).toBeNull();
  });

  it('keeps the composer available below the full-height review workspace', () => {
    useAiChatStore.setState({
      conversations: [{
        id: 'conv-review-workspace',
        title: 'Review workspace',
        createdAt: Date.now(),
        messages: [{
          id: 'msg-review-workspace',
          role: 'assistant',
          content: 'Answer with one source.',
          timestamp: Date.now(),
          evidenceRefs: [{ kind: 'file', label: 'paper.pdf', locator: 'papers/paper.pdf' }],
        }],
      }],
      activeConversationId: 'conv-review-workspace',
      isOpen: true,
    });

    render(<AiChatPanel />);

    expect(screen.getByTestId('ai-chat-message-frame')).not.toBeNull();
    expect(screen.getByTestId('ai-chat-mode-chat')).not.toBeNull();
    expect(screen.queryByTestId('agent-inspector')).toBeNull();

    fireEvent.click(screen.getByTestId('agent-status-open-review'));

    expect(screen.getByTestId('agent-review-workspace')).not.toBeNull();
    expect(screen.queryByTestId('ai-chat-message-frame')).toBeNull();
    expect(screen.getByTestId('ai-chat-mode-chat')).not.toBeNull();
    expect(screen.getByPlaceholderText('Ask')).not.toBeNull();
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

  it('keeps input and primary controls inside one compact composer surface', () => {
    render(<AiChatPanel />);

    const surface = screen.getByTestId('ai-chat-composer-surface');
    expect(surface.contains(screen.getByPlaceholderText('Ask'))).toBe(true);
    expect(surface.contains(screen.getByTestId('ai-chat-mode-chat'))).toBe(true);
    expect(surface.contains(screen.getByTestId('ai-chat-mode-agent'))).toBe(true);
    expect(surface.contains(screen.getByTestId('ai-chat-model-select'))).toBe(true);
    expect(surface.contains(screen.getByTestId('ai-chat-templates'))).toBe(true);
    expect(surface.contains(screen.getByTestId('ai-chat-submit'))).toBe(true);
    expect(screen.queryByTestId('ai-chat-agent-advanced-panel')).toBeNull();
  });

  it('keeps the empty state compact and leaves the inspector collapsed', () => {
    render(<AiChatPanel />);

    const emptyState = screen.getByTestId('ai-chat-empty-state');

    expect(emptyState.className).toContain('justify-start');
    expect(emptyState.className).not.toContain('justify-center');
    expect(screen.queryByTestId('agent-inspector')).toBeNull();
    expect(screen.queryByTestId('agent-inspector-toggle')).toBeNull();
    expect(screen.queryByTestId('agent-inspector-body')).toBeNull();
  });

  it('keeps all review tabs accessible without horizontal overflow', () => {
    useAiChatStore.setState({
      conversations: [{
        id: 'conv-review-tabs',
        title: 'Review tabs',
        createdAt: Date.now(),
        messages: [{ id: 'msg-review-tabs', role: 'assistant', content: 'Answer', timestamp: Date.now(), evidenceRefs: [{ kind: 'file', label: 'notes.md', locator: 'notes.md' }] }],
      }],
      activeConversationId: 'conv-review-tabs',
      isOpen: true,
    });
    render(<AiChatPanel />);
    fireEvent.click(screen.getByTestId('agent-status-open-review'));
    expect(screen.getByTestId('agent-inspector-tab-scheduled')).toBeTruthy();
    expect(screen.getByTestId('agent-inspector-tab-scheduled').getAttribute('aria-selected')).toBe('false');
    fireEvent.click(screen.getByTestId('agent-inspector-tab-scheduled'));
    expect(screen.getByTestId('agent-inspector-tab-scheduled').getAttribute('aria-selected')).toBe('true');
    const tabList = screen.getByTestId('agent-inspector-tabs');
    expect(tabList.className).toContain('grid-cols-5');
  });

  it('does not show a misleading non-interactive resize grip in the header', () => {
    render(<AiChatPanel />);

    expect(screen.queryByTestId('ai-workspace-resize-hint')).toBeNull();
    expect(screen.getByTestId('ai-workspace-title').textContent).toBe('AI Workspace');
  });

  it('renders a restrained user block and an unframed assistant response', () => {
    useAiChatStore.setState({
      conversations: [{
        id: 'conv-professional-timeline',
        title: 'Professional timeline',
        createdAt: Date.now(),
        messages: [
          { id: 'msg-user-professional', role: 'user', content: 'Review this', timestamp: Date.now() },
          { id: 'msg-ai-professional', role: 'assistant', content: 'Review complete', timestamp: Date.now() },
        ],
      }],
      activeConversationId: 'conv-professional-timeline',
      isOpen: true,
    });

    const { container } = render(<AiChatPanel />);
    const userMessage = container.querySelector('[data-message-role="user"]');
    const assistantMessage = container.querySelector('[data-message-role="assistant"]');

    expect(userMessage?.className).toContain('max-w-[88%]');
    expect(userMessage?.className).toContain('ml-auto');
    expect(assistantMessage?.className).toContain('bg-transparent');
    expect(assistantMessage?.className).not.toContain('rounded-lg');
  });

  it('keeps token accounting out of ordinary assistant responses', () => {
    useAiChatStore.setState({
      conversations: [{
        id: 'conv-no-token-debug',
        title: 'No token debug',
        createdAt: Date.now(),
        messages: [{
          id: 'msg-no-token-debug',
          role: 'assistant',
          content: 'A concise answer.',
          timestamp: Date.now(),
          usage: { promptTokens: 120, completionTokens: 24, totalTokens: 144 },
        }],
      }],
      activeConversationId: 'conv-no-token-debug',
      isOpen: true,
    });

    render(<AiChatPanel />);

    expect(screen.getByText('A concise answer.')).not.toBeNull();
    expect(screen.queryByText(/144 tokens/)).toBeNull();
  });

  it('keeps agent audit sections and workbench actions out of the conversation stream', () => {
    useAiChatStore.setState({
      conversations: [{
        id: 'conv-focused-agent',
        title: 'Focused Agent',
        createdAt: Date.now(),
        messages: [{
          id: 'msg-focused-agent',
          role: 'assistant',
          content: '直接回答：Alpha 提升了证据可追溯性。',
          timestamp: Date.now(),
          agentResult: {
            sessionId: 'session-focused-agent',
            planSteps: [{ title: 'Resolve evidence', status: 'completed', toolName: 'evidence.resolve' }],
            toolObservations: [{ stepId: 'evidence', toolName: 'evidence.resolve', status: 'completed', preview: '2 refs' }],
          },
          followUpActions: [{ id: 'save', label: 'Save draft', kind: 'create_draft' }],
        }],
      }],
      activeConversationId: 'conv-focused-agent',
      isOpen: true,
    });

    render(<AiChatPanel />);

    expect(screen.getByText('直接回答：Alpha 提升了证据可追溯性。')).not.toBeNull();
    expect(screen.queryByText('RUN')).toBeNull();
    expect(screen.queryByText('PLAN')).toBeNull();
    expect(screen.queryByText('Workbench actions')).toBeNull();
  });

  it('does not render an empty Review entry when there is nothing to review', () => {
    render(<AiChatPanel />);

    expect(screen.queryByTestId('agent-inspector-toggle')).toBeNull();
  });

  it('keeps status bound to the current composer mode instead of a historical session', () => {
    useAgentSessionStore.setState({
      sessions: [createAgentSession({
        id: 'historical-session',
        profile: 'research',
        title: 'Historical run',
        task: 'Old task',
        now: 1,
      })],
      activeSessionId: null,
    });

    render(<AiChatPanel />);

    expect(screen.getByTestId('ai-chat-mode-chat').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('agent-status-state').getAttribute('title')).toBe('idle');

    fireEvent.click(screen.getByTestId('ai-chat-mode-agent'));
    expect(screen.getByTestId('ai-chat-mode-agent').getAttribute('aria-pressed')).toBe('true');
  });

  it('opens Trace from the approval status action', () => {
    render(<AiChatPanel />);

    expect(screen.queryByTestId('agent-inspector-body')).toBeNull();
    expect(screen.queryByTestId('agent-status-review-approvals')).toBeNull();
    fireEvent.click(screen.getByTestId('agent-status-open-review'));

    expect(screen.getByTestId('agent-inspector-body')).not.toBeNull();
    expect(screen.getByTestId('agent-inspector-tab-trace').getAttribute('aria-selected')).toBe('true');
  });

  it('switches the collapsed inspector between Memory, Trace, Evidence, and Workbench', () => {
    useAiChatStore.setState({
      conversations: [{
        id: 'conv-inspector-tabs',
        title: 'Inspector tabs',
        createdAt: Date.now(),
        messages: [{
          id: 'msg-inspector-evidence',
          role: 'assistant',
          content: 'Answer with evidence',
          timestamp: Date.now(),
          evidenceRefs: [{ kind: 'file', label: 'notes.md', locator: 'notes.md' }],
        }],
      }],
      activeConversationId: 'conv-inspector-tabs',
      isOpen: true,
    });
    render(<AiChatPanel />);

    fireEvent.click(screen.getByTestId('agent-status-open-review'));
    expect(screen.getByTestId('agent-inspector-body')).not.toBeNull();

    const tabList = screen.getByTestId('agent-inspector-tabs');
    expect(tabList.className).toContain('grid-cols-5');
    expect(tabList.className).not.toContain('overflow-x-auto');

    for (const tab of ['memory', 'trace', 'evidence', 'workbench']) {
      const button = screen.getByTestId(`agent-inspector-tab-${tab}`);
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.className).toContain('min-w-0');
      expect(screen.getByTestId(`agent-inspector-tab-${tab}-label`).className).toContain('hidden');
      expect(screen.getByTestId(`agent-inspector-tab-${tab}-label`).className).toContain('sm:inline');
      fireEvent.click(button);
      expect(button.getAttribute('aria-selected')).toBe('true');
    }
  });

  it('truncates long Workbench draft and proposal fields until details are requested', () => {
    const longTitle = `Long draft ${'title '.repeat(30)}`;
    const longContent = `Long draft content ${'detail '.repeat(80)}`;
    const longPath = `AI Drafts/${'nested-directory/'.repeat(12)}proposal.md`;
    useAiWorkbenchStore.setState({
      drafts: [{
        id: 'draft-long',
        type: 'paper_note',
        title: longTitle,
        sourceRefs: [],
        content: longContent,
        targetPath: longPath,
        status: 'draft',
        createdAt: Date.now(),
      }],
      proposals: [{
        id: 'proposal-long',
        summary: `Long proposal ${'summary '.repeat(30)}`,
        steps: [],
        requiredApprovals: ['Review long path'],
        plannedWrites: [{ targetPath: longPath, mode: 'create', contentPreview: longContent }],
        sourceRefs: [],
        status: 'pending',
        confirmedApprovals: [],
        approvedWrites: [longPath],
        generatedDraftTargets: [],
        createdAt: Date.now(),
      }],
      highlightedProposalId: null,
    });

    render(<AiChatPanel />);
    fireEvent.click(screen.getByTestId('agent-status-open-review'));
    fireEvent.click(screen.getByTestId('agent-inspector-tab-workbench'));
    fireEvent.click(screen.getByTestId('workbench-queue-toggle'));

    expect(screen.getByTestId('workbench-draft-title').className).toContain('truncate');
    expect(screen.getByTestId('workbench-draft-content').className).toContain('line-clamp-3');
    expect(screen.getByTestId('workbench-draft-path').className).toContain('truncate');
    expect(screen.getByTestId('workbench-proposal-title').className).toContain('line-clamp-2');
  });

  it('keeps a written PDF child draft applied when refreshing virtual children fails', async () => {
    const hydrate = vi.fn().mockRejectedValue(new Error('Tree refresh unavailable'));
    const hook = vi.spyOn(fileSystemHooks, 'useFileSystem').mockReturnValue({ hydratePdfVirtualChildren: hydrate } as unknown as ReturnType<typeof fileSystemHooks.useFileSystem>);
    const write = vi.spyOn(workbenchActions, 'writeDraftArtifactToTarget').mockResolvedValue({
      handle: { kind: 'file', name: 'reading.md' } as FileSystemFileHandle,
      path: 'workspace/.lattice/items/original/reading.md', parentPdfPath: 'workspace/original.pdf',
    });
    const open = vi.spyOn(useWorkspaceStore.getState(), 'openFileInPane').mockImplementation(() => {});
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useWorkspaceStore.setState({ rootHandle: { name: 'workspace' } as FileSystemDirectoryHandle });
    const id = useAiWorkbenchStore.getState().createDraft({ type: 'paper_note', title: 'Original note', content: 'Grounded note', sourceRefs: [] });
    try {
      render(<WorkbenchQueue loadPersisted={false} />);
      fireEvent.click(screen.getByTestId('workbench-queue-toggle'));
      fireEvent.click(screen.getByRole('button', { name: 'chat.workbench.approveAndApply' }));
      await waitFor(() => expect(hydrate).toHaveBeenCalledWith('workspace/original.pdf', { force: true, expand: true }));
      expect(useAiWorkbenchStore.getState().drafts.find(draft => draft.id === id)).toMatchObject({ status: 'applied', targetPath: 'workspace/.lattice/items/original/reading.md' });
      expect(write).toHaveBeenCalledOnce();
    } finally { hook.mockRestore(); write.mockRestore(); open.mockRestore(); warning.mockRestore(); }
  });

  it('rechecks a cloud citation before opening the cloud reader and never navigates the personal workspace', async () => {
    const content = { kind: 'text' as const, text: '# Verified cloud source', mimeType: 'text/markdown', updatedAt: '2026-10-08T00:00:00Z' };
    const current: CloudLibraryResource = { id: 'lattice-cloud:scope:library:item', libraryId: 'library', itemId: 'item', versionId: 'v2', role: 'commenter', kind: 'markdown', name: 'same.md', path: 'cloud://library/item/same.md', content };
    const version = `v2|${await getAgentDocumentVersion(new File([content.text], current.name, { type: content.mimeType }), current.id)}`;
    const provider: CloudLibrarySourceProvider = { scope: 'scope', list: vi.fn(), read: vi.fn().mockResolvedValue(current), search: vi.fn(), save: vi.fn() };
    const navigate = vi.fn().mockResolvedValue(true);
    const unregister = registerCloudWorkspaceNavigator(navigate);
    setCloudWorkspaceProvider(provider); setCloudWorkspaceResource(current); setCloudWorkspaceActive(true);
    const ref = { kind: 'file' as const, label: 'same.md', locator: current.id, anchor: { lineStart: 2, snippet: 'Verified cloud source' }, cloudIdentity: { resourceId: current.id, libraryId: 'library', itemId: 'item', versionId: 'v2', version, role: 'commenter' as const, name: 'same.md' } };
    useAiChatStore.setState({ conversations: [{ id: 'cloud-cite', title: 'Cloud', createdAt: 1, messages: [{ id: 'cloud-answer', role: 'assistant', timestamp: 1, content: `Cloud answer [same.md](${citationNavigationHref(buildCitationContract(ref))}).`, evidenceRefs: [ref] }] }], activeConversationId: 'cloud-cite', isOpen: true });
    try {
      render(<AiChatPanel loadPersistedState={false} />);
      fireEvent.click(screen.getByRole('link', { name: /same.md/ }));
      await waitFor(() => expect(navigate).toHaveBeenCalledWith({ libraryId: 'library', itemId: 'item', anchor: { page: undefined, line: 2, cellId: undefined, snippet: 'Verified cloud source' } }));
      expect(provider.read).toHaveBeenCalledWith('library', 'item', undefined);
      expect(linkNavigationMocks.navigateLinkDetailed).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledTimes(1);

      vi.mocked(provider.read).mockResolvedValue({ ...current, versionId: 'v3' });
      navigate.mockClear();
      fireEvent.click(screen.getByRole('link', { name: /same.md/ }));
      await waitFor(() => expect(provider.read).toHaveBeenCalledTimes(2));
      expect(navigate).not.toHaveBeenCalled();
      expect(linkNavigationMocks.navigateLinkDetailed).not.toHaveBeenCalled();
    } finally { unregister(); }
  });

  it('uses the current cloud resource through fresh provider access without touching the personal active tab', async () => {
    const privateRead = vi.fn().mockRejectedValue(new Error('Personal file must not be read'));
    useWorkspaceStore.setState({ layout: { activePaneId: 'personal', root: { type: 'pane', id: 'personal', activeTabIndex: 0, tabs: [{ id: 'personal-file', kind: 'file', fileName: 'same.md', filePath: 'private/same.md', fileHandle: { getFile: privateRead } as unknown as FileSystemFileHandle, isDirty: false, scrollPosition: 0 }] } } });
    const current: CloudLibraryResource = { id: 'lattice-cloud:scope:library:item', libraryId: 'library', itemId: 'item', versionId: 'v2', role: 'commenter', kind: 'markdown', name: 'same.md', path: 'cloud://library/item/same.md', content: { kind: 'text', text: '# Fresh\n\nThe current cloud version was actually authorized and read.', mimeType: 'text/markdown', updatedAt: '2026-10-08T00:00:00Z' } };
    const provider: CloudLibrarySourceProvider = { scope: 'scope', list: vi.fn().mockResolvedValue([]), read: vi.fn().mockResolvedValue(current), search: vi.fn(), save: vi.fn() };
    setCloudWorkspaceProvider(provider); setCloudWorkspaceResource({ ...current, versionId: 'v1', content: { kind: 'text', text: 'STALE CACHE', mimeType: 'text/markdown', updatedAt: '2026-10-07T00:00:00Z' } }); setCloudWorkspaceActive(true);
    let actualText = '';
    researchAgentMocks.runResearchAgentForChat.mockImplementationOnce(async input => {
      const unit = await input.documentSources[0].readUnit(2);
      actualText = unit.text;
      return { chatText: 'Cloud answer', result: { promptContext: { nodes: [], prompt: '', evidenceRefs: [], truncated: false } }, agentResult: { sessionId: input.sessionId }, followUpActions: [] };
    });
    render(<AiChatPanel loadPersistedState={false} />);
    fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: '详细解释本文的当前版本' } });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));
    await waitFor(() => expect(researchAgentMocks.runResearchAgentForChat).toHaveBeenCalled());
    await waitFor(() => expect(useAiChatStore.getState().isGenerating).toBe(false));
    expect(actualText).toContain('current cloud version');
    expect(actualText).not.toContain('STALE CACHE');
    expect(privateRead).not.toHaveBeenCalled();
    expect(researchAgentMocks.runResearchAgentForChat.mock.calls.at(-1)?.[0].workspaceKey).toBe('cloud:library');
    expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.documentContext?.cloudSnapshots?.[0].cloudIdentity.role).toBe('commenter');
  });
  it('continues the earlier cloud document after another cloud file becomes active', async () => {
    const original: CloudLibraryResource = { id: 'lattice-cloud:scope:library:original', libraryId: 'library', itemId: 'original', versionId: 'v1', role: 'viewer', kind: 'markdown', name: 'original.md', path: 'cloud://original', content: { kind: 'text', text: '# Original\n\nOriginal cloud coefficient 73.', mimeType: 'text/markdown', updatedAt: '2026-10-12' } };
    const other = { ...original, id: 'lattice-cloud:scope:library:other', itemId: 'other', name: 'other.md', path: 'cloud://other', content: { ...original.content!, kind: 'text' as const, text: 'WRONG CLOUD DOCUMENT' } };
    const read = vi.fn(async (_library: string, itemId: string) => itemId === 'original' ? original : other);
    const provider: CloudLibrarySourceProvider = { scope: 'scope', read, list: vi.fn().mockResolvedValue([]), search: vi.fn(), save: vi.fn() };
    const { captureCloudAgentDocumentSources } = await import('@/lib/ai/cloud-source');
    const captured = await captureCloudAgentDocumentSources({ provider, resource: original });
    await Promise.all(captured.sources.map(source => source.close()));
    useAiChatStore.setState({ activeConversationId: 'cloud-follow', conversations: [{ id: 'cloud-follow', title: 'Cloud discussion', createdAt: 1, messages: [{ id: 'prior-user', role: 'user', timestamp: 1, content: 'Explain original.md' }, { id: 'prior-assistant', role: 'assistant', timestamp: 2, content: 'We discussed original.', documentContext: { workspaceKey: 'cloud:library', paths: [original.id], cloudSnapshots: captured.snapshots } }] }] });
    setCloudWorkspaceProvider(provider); setCloudWorkspaceResource(other); setCloudWorkspaceActive(true);
    let sourceText = '';
    researchAgentMocks.runResearchAgentForChat.mockImplementationOnce(async input => {
      expect(input.documentSources.map((source: { path: string }) => source.path)).toEqual([original.id]);
      sourceText = (await input.documentSources[0].readUnit(2)).text;
      return { chatText: 'Cloud coefficient 73', result: { promptContext: { nodes: [], prompt: '', evidenceRefs: [], truncated: false } }, agentResult: { sessionId: input.sessionId }, followUpActions: [] };
    });
    render(<AiChatPanel loadPersistedState={false} />);
    fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: '它的系数是多少？' } });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));
    await waitFor(() => expect(sourceText).toContain('coefficient 73'));
    expect(read.mock.calls.some(call => call[1] === 'other')).toBe(false);
  });

  it.each([
    ['cloud-to-local', '它的系数是多少？', 'cloud'],
    ['local-to-cloud', '它的系数是多少？', 'local'],
    ['cloud-to-local', '总结当前文件', 'local'],
    ['local-to-cloud', '总结当前文件', 'cloud'],
    ['cloud-to-local', '总结 local.md', 'local'],
    ['local-to-cloud', '总结 cloud.md', 'cloud'],
    ['cloud-to-local', '它的系数是多少？', 'stale'],
  ] as const)('keeps the conversation source across storage types: %s / %s / %s', async (direction, query, expectedSource) => {
    const cloud: CloudLibraryResource = { id: 'lattice-cloud:scope:library:cloud', libraryId: 'library', itemId: 'cloud', versionId: 'v1', role: 'viewer', kind: 'markdown', name: 'cloud.md', path: 'cloud://cloud', content: { kind: 'text', text: '# Cloud\n\nCLOUD coefficient 73.', mimeType: 'text/markdown', updatedAt: '2026-10-12' } };
    const read = vi.fn(async () => cloud);
    const provider: CloudLibrarySourceProvider = { scope: 'scope', read, list: vi.fn().mockResolvedValue([{ id: 'cloud', libraryId: 'library', canonicalName: 'cloud.md', title: 'cloud.md', kind: 'markdown', status: 'active', metadata: {}, createdBy: 'user', createdAt: '', updatedAt: '' }]), search: vi.fn(), save: vi.fn() };
    const { captureCloudAgentDocumentSources } = await import('@/lib/ai/cloud-source');
    const cloudCapture = await captureCloudAgentDocumentSources({ provider, resource: cloud });
    await Promise.all(cloudCapture.sources.map(source => source.close()));
    const root = new SourceTestDirectory('fixture'), file = root.add(new SourceTestFile('local.md', '# Local\n\nLOCAL coefficient 29.'));
    const source = await documentSourceModule.openAgentDocumentSource(await file.getFile(), 'local.md');
    const localSnapshot = { workspaceKey: 'local-workspace', path: source.path, sourceId: 'local-id', version: source.version, kind: source.kind, unitLabel: source.unitLabel, totalUnits: source.totalUnits };
    await source.close();
    const localTab = { id: 'local', kind: 'file' as const, fileName: 'local.md', filePath: 'local.md', fileHandle: file as unknown as FileSystemFileHandle, isDirty: false, scrollPosition: 0 };
    const cloudTab = { id: 'cloud', kind: 'cloud-file' as const, fileName: 'cloud.md', filePath: 'cloud://cloud', isDirty: false, scrollPosition: 0, cloud: { scope: 'scope', resourceId: cloud.id, libraryId: 'library', itemId: 'cloud', versionId: 'v1', role: 'viewer' as const } };
    useWorkspaceStore.setState({ rootHandle: root.handle(), workspaceIdentity: { workspaceKey: 'local-workspace' } as ReturnType<typeof useWorkspaceStore.getState>['workspaceIdentity'], layout: { activePaneId: 'cross', root: { type: 'pane', id: 'cross', tabs: [localTab, cloudTab], activeTabIndex: direction === 'cloud-to-local' ? 0 : 1 } } });
    setCloudWorkspaceProvider(provider); setCloudWorkspaceResource(direction === 'cloud-to-local' ? null : cloud); setCloudWorkspaceActive(direction === 'local-to-cloud');
    const priorContext = direction === 'cloud-to-local' ? { workspaceKey: 'cloud:library', paths: [cloud.id], cloudSnapshots: cloudCapture.snapshots } : { workspaceKey: 'local-workspace', paths: ['local.md'], snapshots: [localSnapshot] };
    useAiChatStore.setState({ activeConversationId: 'cross', conversations: [{ id: 'cross', title: 'Cross source', createdAt: 1, messages: [{ id: 'question', role: 'user', content: 'Read the original paper', timestamp: 1 }, { id: 'answer', role: 'assistant', content: 'VERIFIED PRIOR ANSWER', timestamp: 2, documentContext: priorContext }] }] });
    if (expectedSource === 'stale') Object.defineProperty(provider, 'scope', { value: 'another-account' });
    const followsPrior = expectedSource === (direction === 'cloud-to-local' ? 'cloud' : 'local');
    let sourceText = '', requestKey = '';
    researchAgentMocks.runResearchAgentForChat.mockImplementation(async request => {
      requestKey = request.workspaceKey;
      sourceText = request.documentSources ? (await request.documentSources[0].readUnit(2)).text : request.content;
      if (followsPrior) expect(request.history).toContainEqual({ role: 'assistant', content: 'VERIFIED PRIOR ANSWER' });
      return { chatText: 'result', result: { promptContext: { nodes: [], prompt: '', evidenceRefs: [], truncated: false } }, agentResult: { sessionId: request.sessionId }, followUpActions: [] };
    });
    orchestratorMocks.runChat.mockImplementation(async request => { sourceText = request.content; if (followsPrior) expect(request.history).toContainEqual({ role: 'assistant', content: 'VERIFIED PRIOR ANSWER' }); return { text: 'result', evidenceRefs: [], context: { nodes: [], prompt: '', evidenceRefs: [], truncated: false }, model: { providerId: 'openai', providerName: 'OpenAI', modelId: 'test' } }; });
    render(<AiChatPanel loadPersistedState={false} />);
    fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: query } }); fireEvent.click(screen.getByTestId('ai-chat-submit'));
    await waitFor(() => expect(useAiChatStore.getState().isGenerating).toBe(false));
    if (expectedSource === 'stale') { expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.error).toMatch(/账号|权限/); expect(sourceText).toBe(''); return; }
    expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.error).toBeUndefined();
    expect(sourceText).toContain(expectedSource === 'cloud' ? 'CLOUD coefficient 73' : 'LOCAL coefficient 29');
    if (expectedSource === 'cloud') expect(requestKey).toBe('cloud:library');
    expect(useAiChatStore.getState().getActiveConversation()?.workspace?.workspaceKey).toBe(expectedSource === 'cloud' ? 'cloud:library' : 'local-workspace');
  });

  it('keeps local source and actual model selection in the compact composer without a runtime panel', async () => {
    useAiHarnessStore.getState().setConfig({ engine: 'codex' });
    render(<AiChatPanel loadPersistedState={false} />);
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.getByTestId('ai-chat-composer-surface').contains(screen.getByLabelText('AI 来源'))).toBe(true);
    expect(screen.getByTestId('ai-chat-composer-surface').contains(screen.getByTestId('ai-harness-model-select'))).toBe(true);
    expect(screen.queryByTestId('agent-runtime-settings')).toBeNull();
    expect(screen.queryByTestId('ai-chat-connection-select')).toBeNull();
    expect(screen.queryByTestId('ai-chat-model-select')).toBeNull();
    expect((screen.getByLabelText('AI 来源') as HTMLSelectElement).value).toBe('codex');
  });

  it.each(['agent', 'chat'] as const)('routes all articles in a 101-file folder to durable directory reading from %s without eager extraction', async mode => {
    const root = new SourceTestDirectory('fixture');
    const docs = root.add(new SourceTestDirectory('docs'));
    for (let index = 0; index < 101; index++) docs.add(new SourceTestFile(`note-${index}.md`, 'Synthetic source.'));
    const other = root.add(new SourceTestFile('other.md', 'UNRELATED ACTIVE CONTENT'));
    useWorkspaceStore.setState({ rootHandle: root.handle(), workspaceRootPath: 'C:/fixture', workspaceIdentity: { workspaceKey: 'A' } as ReturnType<typeof useWorkspaceStore.getState>['workspaceIdentity'],
      layout: { activePaneId: 'other', root: { type: 'pane', id: 'other', activeTabIndex: 0, tabs: [{ id: 'other', kind: 'file', fileName: other.name, filePath: other.name, fileHandle: other as unknown as FileSystemFileHandle, isDirty: false, scrollPosition: 0 }] } } });
    researchAgentMocks.runResearchAgentForChat.mockImplementationOnce(async request => {
      expect(request.documentDirectory).toMatchObject({ rootHandle: root.handle(), selections: [{ kind: 'folder', path: 'docs' }] });
      expect(request.documentSources).toBeUndefined();
      expect(request.requireSourceDiscovery).toBe(false);
      expect(request.content).toBe('');
      return { chatText: 'Directory reading completed.', result: { promptContext: { nodes: [], prompt: '', evidenceRefs: [], truncated: false } }, agentResult: { sessionId: request.sessionId }, followUpActions: [] };
    });
    render(<AiChatPanel loadPersistedState={false} />);
    fireEvent.click(screen.getByTestId(`ai-chat-mode-${mode}`));
    fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: mode === 'chat' ? 'docs中文章都阅读并讲述文章内容，对话内回复' : '@folder:docs 中文章都阅读并讲述文章内容，对话内回复' } });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));
    await waitFor(() => expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.content).toBe('Directory reading completed.'));
    expect(other.reads).toBe(0);
  });

  it('searches a 101-file selected folder with lazy tools without reading the unselected active file', async () => {
    const root = new SourceTestDirectory('fixture');
    const docs = root.add(new SourceTestDirectory('docs'));
    for (let index = 0; index < 101; index++) docs.add(new SourceTestFile(`note-${index}.md`, 'Authorized measurement source.'));
    const privateFile = root.add(new SourceTestFile('private.md', 'UNSELECTED ACTIVE CONTENT'));
    useWorkspaceStore.setState({ rootHandle: root.handle(), workspaceRootPath: 'C:/fixture', workspaceIdentity: { workspaceKey: 'A' } as ReturnType<typeof useWorkspaceStore.getState>['workspaceIdentity'], layout: { activePaneId: 'private', root: { type: 'pane', id: 'private', activeTabIndex: 0, tabs: [{ id: 'private', kind: 'file', fileName: 'private.md', filePath: 'private.md', fileHandle: privateFile as unknown as FileSystemFileHandle, isDirty: false, scrollPosition: 0 }] } } });
    let listed = 0;
    researchAgentMocks.runResearchAgentForChat.mockImplementationOnce(async input => {
      expect(input.documentSources).toBeUndefined();
      expect(input.content).toBe('');
      const page = await input.apiToolRuntime.execute('lattice.sources.list', { limit: 10 });
      listed = page.entries.length;
      return { chatText: 'Selected folder result', result: { promptContext: { nodes: [], prompt: '', evidenceRefs: [], truncated: false } }, agentResult: { sessionId: input.sessionId }, followUpActions: [] };
    });
    render(<AiChatPanel loadPersistedState={false} />);
    fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: '@folder:docs 搜索 measurement 并回答' } });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));
    await waitFor(() => expect(listed).toBe(10));
    expect(privateFile.reads).toBe(0);
    expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.error).toBeFalsy();
  });
  it('resumes the original directory from natural continue when no file was opened in its saved window', async () => {
    const root = new SourceTestDirectory('fixture'); root.add(new SourceTestDirectory('docs')).add(new SourceTestFile('one.md', 'Synthetic source.'));
    const other = root.add(new SourceTestFile('other.md', 'UNRELATED ACTIVE CONTENT'));
    useWorkspaceStore.setState({ rootHandle: root.handle(), workspaceRootPath: 'C:/fixture', workspaceIdentity: { workspaceKey: 'A' } as ReturnType<typeof useWorkspaceStore.getState>['workspaceIdentity'],
      layout: { activePaneId: 'other', root: { type: 'pane', id: 'other', activeTabIndex: 0, tabs: [{ id: 'other', kind: 'file', fileName: other.name, filePath: other.name, fileHandle: other as unknown as FileSystemFileHandle, isDirty: false, scrollPosition: 0 }] } } });
    const task = '读取docs目录的所有文章';
    const sessions = useAgentSessionStore.getState();
    const sessionId = sessions.createSession({ profile: 'research', task });
    await sessions.saveDocumentResearch(sessionId, { workspaceKey: 'A', status: 'paused', workflowId: 'paper-reading',
      checkpoint: { version: 1, queryKey: JSON.stringify([task, task]), sources: [], coverage: [], summaries: [], findings: [], completedBatches: 0 },
      directory: { version: 2, workspaceKey: 'A', selections: [{ kind: 'folder', path: 'docs' }], task, query: task, files: [], reductions: [], removedPaths: [], calls: 0, phase: 'paused' } });
    sessions.cancelSession(sessionId);
    const chat = useAiChatStore.getState(); chat.addUserMessage(task);
    const id = chat.startAssistantMessage({ requestMode: 'agent' });
    chat.setAssistantMetadata(id, { agentResult: { sessionId }, documentContext: { workspaceKey: 'A', paths: [] } });
    chat.finishAssistantMessage(id, '检查点已保存，可继续剩余材料。');
    researchAgentMocks.runResearchAgentForChat.mockImplementationOnce(async request => {
      expect(request.sessionId).toBe(sessionId);
      expect(request.documentDirectory.selections).toEqual([{ kind: 'folder', path: 'docs' }]);
      expect(request.documentReadingObjective).toEqual({ task, query: task });
      expect(request.documentSources).toBeUndefined();
      expect(request.requireSourceDiscovery).toBe(false);
      return { chatText: 'Original directory resumed.', result: { promptContext: { nodes: [], prompt: '', evidenceRefs: [], truncated: false } }, agentResult: { sessionId }, followUpActions: [] };
    });
    render(<AiChatPanel loadPersistedState={false} />);
    fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: '继续' } });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));
    await waitFor(() => expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.content).toBe('Original directory resumed.'));
    expect(other.reads).toBe(0);
  });
  it.each(['本文的实验参数如何与补充笔记对应？', '@paper.md 只读取本文实验参数'])('keeps the document target separate from workspace tool authorization: %s', async (query) => {
    const root = new SourceTestDirectory('fixture');
    const paper = root.add(new SourceTestFile('paper.md', '# Paper\nRead the supplementary calibration note for the measured coefficient.'));
    root.add(new SourceTestDirectory('notes')).add(new SourceTestFile('calibration.md', '# Calibration\nThe synthetic measured coefficient is 73.'));
    useWorkspaceStore.setState({ rootHandle: root.handle(), workspaceRootPath: 'C:/fixture', workspaceIdentity: { workspaceKey: 'A' } as ReturnType<typeof useWorkspaceStore.getState>['workspaceIdentity'],
      layout: { activePaneId: 'paper', root: { type: 'pane', id: 'paper', activeTabIndex: 0, tabs: [{ id: 'paper', kind: 'file', fileName: 'paper.md', filePath: 'paper.md', fileHandle: paper as unknown as FileSystemFileHandle, isDirty: false, scrollPosition: 0 }] } } });
    useAiChatStore.setState({ composerMode: 'agent' });
    let completed = false;
    researchAgentMocks.runResearchAgentForChat.mockImplementationOnce(async request => {
      expect(request.filePath).toBe('paper.md');
      expect(request.sourceSelections).toContainEqual({ kind: 'file', path: 'paper.md' });
      expect(request.requireSourceDiscovery).toBe(false);
      expect(request.apiToolRuntime.authorizedSourceSelections).toEqual(query.startsWith('@') ? [{ kind: 'file', path: 'paper.md' }] : [{ kind: 'folder', path: '.' }]);
      if (query.startsWith('@')) await expect(request.apiToolRuntime.execute('lattice.sources.read', { path: 'notes/calibration.md' })).rejects.toThrow(/authorized/u);
      else {
        const supplementary = await request.apiToolRuntime.execute('lattice.sources.read', { path: 'notes/calibration.md' });
        expect(supplementary.chunks.map((chunk: { text: string }) => chunk.text).join('\n')).toContain('coefficient is 73');
      }
      completed = true;
      return { chatText: 'Scoped result', result: { promptContext: { nodes: [], prompt: '', evidenceRefs: [], truncated: false } }, agentResult: { sessionId: request.sessionId }, followUpActions: [] };
    });
    render(<AiChatPanel loadPersistedState={false} />);
    fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: query } });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));
    await waitFor(() => expect(completed).toBe(true));
    expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.error).toBeFalsy();
  });

  it('answers about the previous paper after an unrelated file becomes active', async () => {
    const root = new SourceTestDirectory('fixture');
    const paper = root.add(new SourceTestFile('paper.md', '# Paper\nThe earlier paper uses resonant blockade with fidelity 0.99.'));
    const other = root.add(new SourceTestFile('unrelated.md', 'WRONG ACTIVE DOCUMENT CONTENT'));
    const { getAgentDocumentVersion } = await import('@/lib/ai/document-source');
    const version = await getAgentDocumentVersion(await paper.getFile(), 'paper.md');
    useWorkspaceStore.setState({ rootHandle: root.handle(), workspaceRootPath: 'C:/fixture', workspaceIdentity: { workspaceKey: 'A' } as ReturnType<typeof useWorkspaceStore.getState>['workspaceIdentity'], layout: { activePaneId: 'other', root: { type: 'pane', id: 'other', activeTabIndex: 0, tabs: [{ id: 'other', kind: 'file', fileName: 'unrelated.md', filePath: 'unrelated.md', fileHandle: other as unknown as FileSystemFileHandle, isDirty: false, scrollPosition: 0 }] } } });
    useAiChatStore.setState({ activeConversationId: 'context-followup', conversations: [{ id: 'context-followup', title: 'Paper question', createdAt: 1, messages: [{ id: 'before-user', role: 'user', timestamp: 1, content: 'Explain paper.md' }, { id: 'before-answer', role: 'assistant', timestamp: 2, content: 'The paper uses blockade.', documentContext: { workspaceKey: 'A', paths: ['paper.md'], snapshots: [{ sourceId: 'paper-source', workspaceKey: 'A', path: 'paper.md', version, kind: 'markdown', unitLabel: 'section', totalUnits: 1 }] } }] }] });
    render(<AiChatPanel loadPersistedState={false} />);
    fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: '它的保真度是多少？' } });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));
    await waitFor(() => expect(orchestratorMocks.runChat).toHaveBeenCalled());
    const request = orchestratorMocks.runChat.mock.calls.at(-1)?.[0];
    expect(request.filePath).toBe('paper.md');
    expect(request.content).toContain('0.99');
    expect(request.content).not.toContain('WRONG ACTIVE');
    expect(request.history).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'The paper uses blockade.' })]));
    expect(other.reads).toBe(0);
  });
  it.each([
    ['本文单比特门实现方案详细整理讲解', 'chat'], ['详细讲解，不是一句话', 'chat'],
    ['本文单比特门实现方案详细整理讲解', 'agent'], ['详细讲解，不是一句话', 'agent'],
  ] as const)('reopens the legacy cited paper after a rules tab becomes active: %s / %s', async (query, mode) => {
    // Exercise real binding/targeting/capture through the Composer; only model I/O and PDF decoding are replaced.
      const root = new SourceTestDirectory('fixture');
      const paper = root.add(new SourceTestDirectory('papers')).add(new SourceTestFile('Senoo 2026.pdf', 'SYNTHETIC PDF BYTES'));
      const rules = root.add(new SourceTestFile('AGENTS.md', 'RULES ARE NOT PAPER EVIDENCE'));
      pdfContextMocks.loadPdfJsDocument.mockResolvedValue({ numPages: 3, destroy: vi.fn() });
      pdfContextMocks.getPdfPageSearchText.mockImplementation(async (_pdf, page) => `CURRENT SENOO PAGE ${page}: synthetic single qubit mechanism.`);
      useWorkspaceStore.setState({ rootHandle: root.handle(), workspaceRootPath: 'C:/fixture', workspaceIdentity: { workspaceKey: 'A' } as ReturnType<typeof useWorkspaceStore.getState>['workspaceIdentity'],
        layout: { activePaneId: 'rules', root: { type: 'pane', id: 'rules', activeTabIndex: 0, tabs: [{ id: 'rules', kind: 'file', fileName: 'AGENTS.md', filePath: 'AGENTS.md', fileHandle: rules as unknown as FileSystemFileHandle, isDirty: false, scrollPosition: 0 }] } } });
      useAiChatStore.setState({ composerMode: mode, hasHydratedConversations: true, activeConversationId: 'legacy-paper', conversations: [{ id: 'legacy-paper', title: 'Senoo question', createdAt: 1, workspace: { workspaceKey: 'A' }, messages: [
        { id: 'old-user', role: 'user', content: '讲解 Senoo 2026', timestamp: 1 },
        { id: 'old-answer', role: 'assistant', content: 'STALE UNVERIFIED 61/61 CLAIM', timestamp: 2, evidenceRefs: [{ kind: 'pdf_page', label: 'Senoo 2026', locator: 'papers/Senoo%202026.pdf#page=61', preview: 'STALE QUOTE' }] },
      ] }] });
      let actualText = '';
      researchAgentMocks.runResearchAgentForChat.mockImplementationOnce(async request => {
        expect(request.documentSources.map((source: { path: string }) => source.path)).toEqual(['papers/Senoo 2026.pdf']);
        expect(request.documentSources[0].totalUnits).toBe(3);
        expect(request.history.some((message: { content: string }) => message.content.includes('STALE UNVERIFIED'))).toBe(false);
        actualText = (await request.documentSources[0].readUnit(1)).text;
        return { chatText: 'Fresh answer', result: { promptContext: { nodes: [], prompt: '', evidenceRefs: [], truncated: false } }, agentResult: { sessionId: request.sessionId }, followUpActions: [] };
      });
      render(<AiChatPanel loadPersistedState={false} />);
      fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: query } }); fireEvent.click(screen.getByTestId('ai-chat-submit'));
      await waitFor(() => expect({ actualText, error: useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.error,
        agentCalls: researchAgentMocks.runResearchAgentForChat.mock.calls.length, chatCalls: orchestratorMocks.runChat.mock.calls.length }).toMatchObject({ actualText: expect.stringContaining('CURRENT SENOO PAGE 1') }));
      await waitFor(() => expect(useAiChatStore.getState().isGenerating).toBe(false));
      expect(rules.reads).toBe(0);
      expect(paper.reads).toBeGreaterThan(0);
      const context = useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.documentContext;
      expect(context?.paths).toEqual(['papers/Senoo 2026.pdf']);
      expect(context?.snapshots?.[0].totalUnits).toBe(3);
  });
  it('reports a missing historical paper in the Composer without reading rules or showing complete coverage', async () => {
    const root = new SourceTestDirectory('fixture'), rules = root.add(new SourceTestFile('AGENTS.md', 'UNRELATED RULES'));
    useWorkspaceStore.setState({ rootHandle: root.handle(), workspaceRootPath: 'C:/fixture', workspaceIdentity: { workspaceKey: 'A' } as ReturnType<typeof useWorkspaceStore.getState>['workspaceIdentity'],
      layout: { activePaneId: 'rules', root: { type: 'pane', id: 'rules', activeTabIndex: 0, tabs: [{ id: 'rules', kind: 'file', fileName: 'AGENTS.md', filePath: 'AGENTS.md', fileHandle: rules as unknown as FileSystemFileHandle, isDirty: false, scrollPosition: 0 }] } } });
    useAiChatStore.setState({ composerMode: 'agent', hasHydratedConversations: true, activeConversationId: 'missing-paper', conversations: [{ id: 'missing-paper', title: 'Missing', createdAt: 1, workspace: { workspaceKey: 'A' }, messages: [
      { id: 'old-user', role: 'user', content: '讲解 Senoo 2026', timestamp: 1 },
      { id: 'old-answer', role: 'assistant', content: 'Historical 61/61 claim', timestamp: 2,
        promptContext: { nodes: [], prompt: '', truncated: false, evidenceRefs: [{ kind: 'pdf_page', label: 'Senoo', locator: 'papers/Senoo.pdf#page=61' }] } },
    ] }] });
    render(<AiChatPanel loadPersistedState={false} />);
    fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: '本文单比特门详细讲解' } }); fireEvent.click(screen.getByTestId('ai-chat-submit'));
    await waitFor(() => expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.error).toMatch(/未找到先前论文来源/));
    await waitFor(() => expect(useAiChatStore.getState().isGenerating).toBe(false));
    expect(researchAgentMocks.runResearchAgentForChat).not.toHaveBeenCalled();
    expect(orchestratorMocks.runChat).not.toHaveBeenCalled();
    expect(rules.reads).toBe(0);
    expect(screen.queryByTestId('document-reading-progress')).toBeNull();
    expect(useAgentSessionStore.getState().sessions.every(session => !session.documentResearch)).toBe(true);
  });
  it('refuses to relabel an old workspace paper as a same-named current-workspace paper in a comparison', async () => {
    const root = new SourceTestDirectory('B');
    const impostor = root.add(new SourceTestDirectory('papers')).add(new SourceTestFile('Senoo.pdf', 'WRONG B PAPER'));
    const current = root.add(new SourceTestFile('current.md', 'CURRENT B NOTE'));
    useWorkspaceStore.setState({ rootHandle: root.handle(), workspaceIdentity: { workspaceKey: 'B' } as ReturnType<typeof useWorkspaceStore.getState>['workspaceIdentity'],
      layout: { activePaneId: 'B-pane', root: { type: 'pane', id: 'B-pane', activeTabIndex: 0, tabs: [{ id: 'B-current', kind: 'file', fileName: 'current.md', filePath: 'current.md', fileHandle: current as unknown as FileSystemFileHandle, isDirty: false, scrollPosition: 0 }] } } });
    useAiChatStore.setState({ hasHydratedConversations: true, activeConversationId: 'legacy-A', conversations: [{ id: 'legacy-A', title: 'Original A', createdAt: 1, workspace: { workspaceKey: 'A' }, messages: [
      { id: 'A-user', role: 'user', timestamp: 1, content: 'Read Senoo.pdf' },
      { id: 'A-answer', role: 'assistant', timestamp: 2, content: 'OLD A ANSWER', evidenceRefs: [{ kind: 'pdf_page', label: 'Senoo', locator: 'papers/Senoo.pdf#page=61' }] },
    ] }] });
    render(<AiChatPanel loadPersistedState={false} />);
    fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: '比较当前文件与之前的论文' } }); fireEvent.click(screen.getByTestId('ai-chat-submit'));
    await waitFor(() => expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.error).toMatch(/原工作区|先前.*工作区/));
    expect(impostor.reads).toBe(0);
    expect(current.reads).toBe(0);
    expect(researchAgentMocks.runResearchAgentForChat).not.toHaveBeenCalled();
    expect(orchestratorMocks.runChat).not.toHaveBeenCalled();
  });
  it('reads the new active paper when the user explicitly asks for a different paper', async () => {
    const root = new SourceTestDirectory('A');
    const old = root.add(new SourceTestFile('Senoo.md', '# Old\nOLD PAPER'));
    const current = root.add(new SourceTestFile('New.md', '# New\nCURRENT NEW PAPER'));
    useWorkspaceStore.setState({ rootHandle: root.handle(), workspaceIdentity: { workspaceKey: 'A' } as ReturnType<typeof useWorkspaceStore.getState>['workspaceIdentity'],
      layout: { activePaneId: 'A-pane', root: { type: 'pane', id: 'A-pane', activeTabIndex: 0, tabs: [{ id: 'new', kind: 'file', fileName: 'New.md', filePath: 'New.md', fileHandle: current as unknown as FileSystemFileHandle, isDirty: false, scrollPosition: 0 }] } } });
    useAiChatStore.setState({ composerMode: 'agent', hasHydratedConversations: true, activeConversationId: 'different-paper', conversations: [{ id: 'different-paper', title: 'Old', createdAt: 1, messages: [
      { id: 'old-user', role: 'user', timestamp: 1, content: 'Read Senoo.md' },
      { id: 'old-answer', role: 'assistant', timestamp: 2, content: 'Old paper', documentContext: { workspaceKey: 'A', paths: ['Senoo.md'] } },
    ] }] });
    let sourcePath = '';
    researchAgentMocks.runResearchAgentForChat.mockImplementationOnce(async request => {
      sourcePath = request.documentSources?.[0]?.path ?? request.filePath;
      return { chatText: 'New result', result: { promptContext: { nodes: [], prompt: '', evidenceRefs: [], truncated: false } }, agentResult: { sessionId: request.sessionId }, followUpActions: [] };
    });
    render(<AiChatPanel loadPersistedState={false} />);
    fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: '换个话题，分析另一篇论文' } }); fireEvent.click(screen.getByTestId('ai-chat-submit'));
    await waitFor(() => expect(sourcePath).toBe('New.md'));
    await waitFor(() => expect(useAiChatStore.getState().isGenerating).toBe(false));
    expect(old.reads).toBe(0);
  });
  it('finds an unopened document named naturally and reads that document instead of the active tab', async () => {
    const root = new SourceTestDirectory('fixture');
    root.add(new SourceTestDirectory('papers')).add(new SourceTestFile('Results.md', '# Results\nThe measured coefficient is 42.'));
    const other = root.add(new SourceTestFile('unrelated.md', 'WRONG ACTIVE DOCUMENT'));
    useWorkspaceStore.setState({ rootHandle: root.handle(), workspaceRootPath: 'C:/fixture', workspaceIdentity: { workspaceKey: 'A' } as ReturnType<typeof useWorkspaceStore.getState>['workspaceIdentity'], layout: { activePaneId: 'other', root: { type: 'pane', id: 'other', activeTabIndex: 0, tabs: [{ id: 'other', kind: 'file', fileName: other.name, filePath: other.name, fileHandle: other as unknown as FileSystemFileHandle, isDirty: false, scrollPosition: 0 }] } } });
    render(<AiChatPanel loadPersistedState={false} />);
    fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: 'Results.md 里的系数是多少？' } });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));
    await waitFor(() => expect(orchestratorMocks.runChat).toHaveBeenCalled());
    const request = orchestratorMocks.runChat.mock.calls.at(-1)?.[0];
    expect(request.filePath).toBe('papers/Results.md');
    expect(request.content).toContain('coefficient is 42');
    expect(request.content).not.toContain('WRONG ACTIVE');
  });
  it('resolves the pasted absolute essay directory in Agent mode and reads through actual tools without the active file', async () => {
    const root = new SourceTestDirectory('taiyi'); Object.assign(root, { fullPath: 'C:/study/Theoretical Research/taiyi' });
    const essay = root.add(new SourceTestDirectory('essay'));
    const paper = essay.add(new SourceTestFile('logical qubits.md', '# Logical qubits\nWe implement a single-qubit gate with logical 0 and 1 in two metastable states.'));
    const privateFile = root.add(new SourceTestFile('current.md', 'PRIVATE ACTIVE MUST NOT BE READ'));
    useWorkspaceStore.setState({ rootHandle: root.handle(), workspaceRootPath: 'C:/study/Theoretical Research/taiyi', workspaceIdentity: { workspaceKey: 'pasted-folder' } as ReturnType<typeof useWorkspaceStore.getState>['workspaceIdentity'],
      layout: { activePaneId: 'folder', root: { type: 'pane', id: 'folder', activeTabIndex: 0, tabs: [{ id: 'current', kind: 'file', fileName: privateFile.name, filePath: privateFile.name, fileHandle: privateFile as unknown as FileSystemFileHandle, isDirty: false, scrollPosition: 0 }] } } });
    researchAgentMocks.runResearchAgentForChat.mockImplementation(async request => {
      expect(request.requireSourceDiscovery).toBe(true);
      expect(request.documentSources).toBeUndefined();
      const page = await request.apiToolRuntime.execute('lattice.sources.list', { limit: 10 });
      expect(page.entries.map((entry: { path: string }) => entry.path)).toEqual(['essay/logical qubits.md']);
      const read = await request.apiToolRuntime.execute('lattice.sources.read', { path: page.entries[0].path, maxChars: 4000 });
      expect(read.chunks[0].text).toContain('two metastable states');
      await expect(request.apiToolRuntime.execute('lattice.sources.read', { path: 'current.md' })).rejects.toThrow(/authorized/u);
      expect(await request.apiToolRuntime.execute('lattice.compute.evaluate', { expression: 'sqrt(9)+2' })).toMatchObject({ value: 5 });
      return { chatText: '文献实现单比特门。', result: { promptContext: { nodes: [], prompt: '', evidenceRefs: [], truncated: false } }, agentResult: { sessionId: request.sessionId }, followUpActions: [] };
    });
    render(<AiChatPanel loadPersistedState={false} />);
    expect(screen.queryByTestId('ai-source-select-toggle')).toBeNull();
    expect(screen.getByTestId('ai-chat-attach-button')).toBeTruthy();
    fireEvent.click(screen.getByTestId('ai-chat-mode-agent'));
    fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: 'C:/study/Theoretical Research/taiyi/essay中有哪些文章做了单比特门并把0，1编码在亚稳态？' } });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));
    await waitFor(() => expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.content).toBe('文献实现单比特门。'));
    expect(paper.reads).toBeGreaterThan(0);
    expect(privateFile.reads).toBe(0);
  });

  it('uses an opened PDF name immediately after switching tabs without scanning a large workspace', async () => {
    const root = new SourceTestDirectory('huge');
    for (let i = 0; i < 1025; i++) root.add(new SourceTestDirectory(`unrelated-${i}`));
    const name = 'Logical qubits with erasure conversion using metastable neutral atoms.pdf';
    const file = new File(['%PDF-fixture'], name, { type: 'application/pdf' });
    pdfContextMocks.loadPdfJsDocument.mockResolvedValue({ numPages: 1, destroy: vi.fn() });
    pdfContextMocks.getPdfPageSearchText.mockResolvedValue('The logical states are metastable and the single-qubit gate is applied here.');
    useWorkspaceStore.setState({ rootHandle: root.handle(), workspaceRootPath: 'C:/huge', workspaceIdentity: { workspaceKey: 'huge' } as ReturnType<typeof useWorkspaceStore.getState>['workspaceIdentity'],
      layout: { activePaneId: 'pdf', root: { type: 'pane', id: 'pdf', activeTabIndex: 0, tabs: [{ id: 'pdf', kind: 'file', fileName: name, filePath: `papers/${name}`, fileHandle: { getFile: async () => file } as FileSystemFileHandle, isDirty: false, scrollPosition: 0 }] } } });
    useAiChatStore.setState({ activeConversationId: 'switched', conversations: [{ id: 'switched', title: 'Older legacy', createdAt: 1, messages: [{ id: 'old', role: 'assistant', content: '旧回答', timestamp: 1, documentContext: { workspaceKey: 'old', paths: ['old.pdf'] } }] }] });
    researchAgentMocks.runResearchAgentForChat.mockImplementation(async request => {
      const supplied = request.documentSources?.length ? (await request.documentSources[0].readUnit(1)).text : request.content;
      expect(supplied).toContain('metastable');
      return { chatText: '当前论文中逻辑态为亚稳态。', result: { promptContext: { nodes: [], prompt: '', evidenceRefs: [], truncated: false } }, agentResult: { sessionId: request.sessionId }, followUpActions: [] };
    });
    render(<AiChatPanel loadPersistedState={false} />);
    fireEvent.click(screen.getByTestId('ai-chat-mode-agent'));
    fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: name + '本文单比特门编码在亚稳态吗，为什么？' } });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));
    await waitFor(() => expect(useAiChatStore.getState().isGenerating).toBe(false));
    expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.error).toBeUndefined();
    expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.content).toContain('当前论文中逻辑态');
    expect(screen.queryByTestId('ai-source-validation-notice')).toBeNull();
  });
  it('supplies conversation context and verified source excerpts to a local assistant after switching tabs', async () => {
    const root = new SourceTestDirectory('fixture');
    const source = root.add(new SourceTestFile('original.md', '# Original\nThe verified synthetic marker is ORCHID-27.'));
    const other = root.add(new SourceTestFile('other.md', 'UNRELATED TEXT'));
    const { getAgentDocumentVersion } = await import('@/lib/ai/document-source');
    const version = await getAgentDocumentVersion(await source.getFile(), 'original.md');
    useWorkspaceStore.setState({ rootHandle: root.handle(), workspaceRootPath: 'C:/fixture', workspaceIdentity: { workspaceKey: 'A' } as ReturnType<typeof useWorkspaceStore.getState>['workspaceIdentity'], layout: { activePaneId: 'other', root: { type: 'pane', id: 'other', activeTabIndex: 0, tabs: [{ id: 'other', kind: 'file', fileName: other.name, filePath: other.name, fileHandle: other as unknown as FileSystemFileHandle, isDirty: false, scrollPosition: 0 }] } } });
    useAiChatStore.setState({ hasHydratedConversations: true, activeConversationId: 'local-history', conversations: [{ id: 'local-history', title: 'Original', createdAt: 1, messages: [{ id: 'prior-question', role: 'user', timestamp: 1, content: 'Discuss original.md' }, { id: 'prior-answer', role: 'assistant', timestamp: 2, content: 'Use the original measurement.', documentContext: { workspaceKey: 'A', paths: ['original.md'], snapshots: [{ sourceId: 'original-source', workspaceKey: 'A', path: 'original.md', version, kind: 'markdown', unitLabel: 'section', totalUnits: 1 }] } }] }] });
    useAiHarnessStore.getState().setConfig({ engine: 'claude' });
    const nativeTurn = vi.spyOn(useAiHarnessStore.getState(), 'sendTurn').mockResolvedValue('ORCHID-27');
    try {
      render(<AiChatPanel loadPersistedState={false} />);
      fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: '它的测量标识是什么？' } });
      fireEvent.click(screen.getByTestId('ai-chat-submit'));
      await waitFor(() => expect(nativeTurn).toHaveBeenCalled());
      expect(nativeTurn.mock.calls[0][0].text).toContain('ORCHID-27');
      expect(nativeTurn.mock.calls[0][0].text).toContain('Use the original measurement.');
      expect(nativeTurn.mock.calls[0][0].text).not.toContain('UNRELATED TEXT');
      await waitFor(() => expect(useAiChatStore.getState().isGenerating).toBe(false));
      expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.documentContext?.paths).toEqual(['original.md']);
    } finally { nativeTurn.mockRestore(); }
  });

  it('runs Codex over a remembered cloud source without a local workspace and creates a real review draft', async () => {
    const { webcrypto } = await import('node:crypto');
    vi.stubGlobal('crypto', webcrypto);
    const original: CloudLibraryResource = { id: 'lattice-cloud:scope:library:original', libraryId: 'library', itemId: 'original', versionId: 'v1', role: 'editor', kind: 'markdown', name: 'original.md', path: 'cloud://original',
      content: { kind: 'text', text: '# Original\n\nCLOUD_HARNESS coefficient 73.', mimeType: 'text/markdown', updatedAt: '2026-10-12' } };
    const other = { ...original, id: 'lattice-cloud:scope:library:other', itemId: 'other', name: 'other.md', path: 'cloud://other', content: { ...original.content!, kind: 'text' as const, text: 'WRONG ACTIVE CLOUD DOCUMENT' } };
    const read = vi.fn(async (_library: string, item: string) => item === original.itemId ? original : other);
    const provider: CloudLibrarySourceProvider = { scope: JSON.stringify(['managed', 'https://api.example.com', 'user']), read, list: vi.fn().mockResolvedValue([]), search: vi.fn(), save: vi.fn() };
    const { captureCloudAgentDocumentSources } = await import('@/lib/ai/cloud-source');
    const captured = await captureCloudAgentDocumentSources({ provider, resource: original });
    await Promise.all(captured.sources.map(source => source.close()));
    setCloudWorkspaceProvider(provider); setCloudWorkspaceResource(other); setCloudWorkspaceActive(true);
    useAiChatStore.setState({ hasHydratedConversations: true, activeConversationId: 'harness-cloud', conversations: [{ id: 'harness-cloud', title: 'Cloud discussion', createdAt: 1,
      messages: [{ id: 'cloud-prior-user', role: 'user', timestamp: 1, content: '阅读 original.md' }, { id: 'cloud-prior-answer', role: 'assistant', timestamp: 2, content: '我们正在讨论系数73。',
        documentContext: { workspaceKey: 'cloud:library', paths: [original.id], cloudSnapshots: captured.snapshots } }] }] });
    useAiHarnessStore.getState().setConfig({ engine: 'codex' });
    const nativeTurn = vi.spyOn(useAiHarnessStore.getState(), 'sendTurn').mockImplementation(async request => {
      expect(request.workspace).toMatch(/^lattice-cloud:[a-f0-9]{64}$/u);
      expect(request.text).toContain('CLOUD_HARNESS coefficient 73');
      expect(request.text).not.toContain('WRONG ACTIVE CLOUD');
      const active = await request.onToolCall!({ requestId: 'read', callId: 'read', tool: 'lattice_sources_active', arguments: {} });
      expect(active.success).toBe(true);
      expect(active.text).toContain('CLOUD_HARNESS coefficient 73');
      const draft = await request.onToolCall!({ requestId: 'write', callId: 'write', tool: 'lattice_workspace_proposeWrite', arguments: { targetPath: original.id, mode: 'update', content: '# Revised\n\nThe coefficient is 73.' } });
      expect(draft.success).toBe(true);
      expect(draft.text).toContain('pending-review');
      return '系数是73，修改草稿已供审查。';
    });
    try {
      render(<AiChatPanel loadPersistedState={false} />);
      fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: '总结本文并修订笔记' } });
      fireEvent.click(screen.getByTestId('ai-chat-submit'));
      await waitFor(() => expect(nativeTurn).toHaveBeenCalled());
      await waitFor(() => expect(useAiChatStore.getState().isGenerating).toBe(false));
      expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.error).toBeUndefined();
      expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.documentContext?.cloudSnapshots?.[0].path).toBe(original.id);
      expect(useAiWorkbenchStore.getState().drafts[0]).toMatchObject({ content: '# Revised\n\nThe coefficient is 73.', cloudFileProposal: { resource: { resourceId: original.id }, mode: 'update' } });
      expect(provider.save).not.toHaveBeenCalled();
      expect(read.mock.calls.every(([, item]) => item === original.itemId)).toBe(true);
    } finally { nativeTurn.mockRestore(); vi.unstubAllGlobals(); }
  });

  it('discovers a cloud folder through API tools without pre-reading every file', async () => {
    const folder: CloudLibraryResource = { id: 'lattice-cloud:scope:library:folder', libraryId: 'library', itemId: 'folder', versionId: 'v1', role: 'editor', kind: 'folder', name: 'papers', path: 'cloud://folder', content: null };
    const paper: CloudLibraryResource = { ...folder, id: 'lattice-cloud:scope:library:paper', itemId: 'paper', kind: 'markdown', name: 'paper.md', path: 'cloud://paper', content: { kind: 'text', text: 'CLOUD_FOLDER_VALUE_42', mimeType: 'text/markdown', updatedAt: '2026-10-17' } };
    const read = vi.fn(async (_library: string, item: string) => item === 'folder' ? folder : paper);
    const provider: CloudLibrarySourceProvider = { scope: 'scope', read, resourceIdentity: (_library, item) => 'lattice-cloud:scope:library:' + item,
      list: vi.fn().mockResolvedValue([{ id: 'paper', libraryId: 'library', kind: 'markdown', canonicalName: 'paper.md', currentVersionId: 'v1', status: 'active', metadata: { parentItemId: 'folder' } }]), search: vi.fn(), save: vi.fn() };
    setCloudWorkspaceProvider(provider); setCloudWorkspaceResource(folder); setCloudWorkspaceActive(true);
    useAiChatStore.setState({ composerMode: 'agent' });
    researchAgentMocks.runResearchAgentForChat.mockImplementation(async request => {
      expect(request.requireSourceDiscovery).toBe(true);
      expect(read.mock.calls.every(([, item]) => item === 'folder')).toBe(true);
      const listing = await request.apiToolRuntime.execute('lattice.sources.list', { limit: 2 });
      expect(listing.entries.map((entry: { path: string }) => entry.path)).toContain(paper.id);
      expect(read.mock.calls.every(([, item]) => item === 'folder')).toBe(true);
      const result = await request.apiToolRuntime.execute('lattice.sources.read', { path: paper.id, maxChars: 1000 });
      expect(result.chunks[0].text).toContain('CLOUD_FOLDER_VALUE_42');
      return { chatText: '42', result: { promptContext: { nodes: [], prompt: '', evidenceRefs: [], truncated: false } }, agentResult: { sessionId: request.sessionId }, followUpActions: [] };
    });
    render(<AiChatPanel loadPersistedState={false} />);
    fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: '在当前文件夹里搜索系数' } });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));
    await waitFor(() => expect(useAiChatStore.getState().isGenerating).toBe(false));
    expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.error).toBeUndefined();
    expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.content).toBe('42');
    expect(provider.save).not.toHaveBeenCalled();
  });

  it('runs API Agent over a remembered cloud source without a local workspace and creates a real review draft', async () => {
    const { webcrypto } = await import('node:crypto');
    vi.stubGlobal('crypto', webcrypto);
    const original: CloudLibraryResource = { id: 'lattice-cloud:scope:library:original', libraryId: 'library', itemId: 'original', versionId: 'v1', role: 'editor', kind: 'markdown', name: 'original.md', path: 'cloud://original',
      content: { kind: 'text', text: '# Original\n\nCLOUD_HARNESS coefficient 73.', mimeType: 'text/markdown', updatedAt: '2026-10-12' } };
    const other = { ...original, id: 'lattice-cloud:scope:library:other', itemId: 'other', name: 'other.md', path: 'cloud://other', content: { ...original.content!, kind: 'text' as const, text: 'WRONG ACTIVE CLOUD DOCUMENT' } };
    const read = vi.fn(async (_library: string, item: string) => item === original.itemId ? original : other);
    const provider: CloudLibrarySourceProvider = { scope: JSON.stringify(['managed', 'https://api.example.com', 'user']), read, list: vi.fn().mockResolvedValue([]), search: vi.fn(), save: vi.fn() };
    const { captureCloudAgentDocumentSources } = await import('@/lib/ai/cloud-source');
    const captured = await captureCloudAgentDocumentSources({ provider, resource: original });
    await Promise.all(captured.sources.map(source => source.close()));
    setCloudWorkspaceProvider(provider); setCloudWorkspaceResource(other); setCloudWorkspaceActive(true);
    useAiChatStore.setState({ hasHydratedConversations: true, activeConversationId: 'harness-cloud', conversations: [{ id: 'harness-cloud', title: 'Cloud discussion', createdAt: 1,
      messages: [{ id: 'cloud-prior-user', role: 'user', timestamp: 1, content: '阅读 original.md' }, { id: 'cloud-prior-answer', role: 'assistant', timestamp: 2, content: '我们正在讨论系数73。',
        documentContext: { workspaceKey: 'cloud:library', paths: [original.id], cloudSnapshots: captured.snapshots } }] }] });
    useAiHarnessStore.getState().setConfig({ engine: 'api' });
    useAiChatStore.setState({ composerMode: 'agent' });
    const nativeTurn = researchAgentMocks.runResearchAgentForChat.mockImplementation(async request => {
      expect(request.apiToolRuntime).toBeDefined();
      const active = await request.apiToolRuntime.execute('lattice.sources.active', {});
      expect(active.chunks.map((chunk: { text: string }) => chunk.text).join('')).toContain('CLOUD_HARNESS coefficient 73');
      const draft = await request.apiToolRuntime.execute('lattice.workspace.proposeWrite', { targetPath: original.id, mode: 'update', content: '# Revised\n\nThe coefficient is 73.' });
      expect(draft).toMatchObject({ status: 'pending-review' });
      return { chatText: '系数是73，修改草稿已供审查。', result: { promptContext: { nodes: [], prompt: '', evidenceRefs: [], truncated: false } }, agentResult: { sessionId: request.sessionId }, followUpActions: [] };
    });
    try {
      render(<AiChatPanel loadPersistedState={false} />);
      fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: '总结本文并修订笔记' } });
      fireEvent.click(screen.getByTestId('ai-chat-submit'));
      await waitFor(() => expect(nativeTurn).toHaveBeenCalled());
      await waitFor(() => expect(useAiChatStore.getState().isGenerating).toBe(false));
      expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.error).toBeUndefined();
      expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.documentContext?.cloudSnapshots?.[0].path).toBe(original.id);
      expect(useAiWorkbenchStore.getState().drafts[0]).toMatchObject({ content: '# Revised\n\nThe coefficient is 73.', cloudFileProposal: { resource: { resourceId: original.id }, mode: 'update' } });
      expect(provider.save).not.toHaveBeenCalled();
      expect(read.mock.calls.every(([, item]) => item === original.itemId)).toBe(true);
    } finally { nativeTurn.mockReset(); vi.unstubAllGlobals(); }
  });

  it.each(['changed', 'missing', 'permission'] as const)('cancels local Harness source %s during connection before sending captured excerpts', async mutation => {
    const root = new SourceTestDirectory('fixture');
    const original = root.add(new SourceTestFile('source.md', '# Source\n\nPRIVATE_SYNTHETIC_ORIGINAL_27'));
    useWorkspaceStore.setState({ rootHandle: root.handle(), workspaceRootPath: 'C:/fixture', workspaceIdentity: { workspaceKey: 'A' } as ReturnType<typeof useWorkspaceStore.getState>['workspaceIdentity'], layout: { activePaneId: 'source', root: { type: 'pane', id: 'source', activeTabIndex: 0, tabs: [{ id: 'source', kind: 'file', fileName: original.name, filePath: original.name, fileHandle: original as unknown as FileSystemFileHandle, isDirty: false, scrollPosition: 0 }] } } });
    useAiHarnessStore.getState().setConfig({ engine: 'codex' });
    const nativeTurn = vi.spyOn(useAiHarnessStore.getState(), 'sendTurn').mockImplementation(async request => {
      expect(request.text).toContain('PRIVATE_SYNTHETIC_ORIGINAL_27');
      if (mutation === 'changed') { original.content = '# Revised'; original.lastModified++; }
      if (mutation === 'missing') root.entries.delete(original.name);
      if (mutation === 'permission') root.permission = 'denied';
      await request.onBeforeTurn?.();
      return 'must not be sent';
    });
    try {
      render(<AiChatPanel loadPersistedState={false} />);
      fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: '总结当前文件' } });
      fireEvent.click(screen.getByTestId('ai-chat-submit'));
      await waitFor(() => expect(nativeTurn).toHaveBeenCalled());
      await waitFor(() => expect(useAiChatStore.getState().isGenerating).toBe(false));
      const latest = useAiChatStore.getState().getActiveConversation()?.messages.at(-1);
      expect(latest?.error).toMatch(/版本|权限|文档|来源/);
      expect(latest?.content).not.toContain('must not be sent');
    } finally { nativeTurn.mockRestore(); }
  });

  it('cancels a cloud-bound Harness turn if its account changes during the first native connection', async () => {
    const original: CloudLibraryResource = { id: 'lattice-cloud:scope:library:source', libraryId: 'library', itemId: 'source', versionId: 'v1', role: 'viewer', kind: 'markdown', name: 'source.md', path: 'cloud://source',
      content: { kind: 'text', text: '# Source\n\nPRIVATE_CONNECTION_FIXTURE_19', mimeType: 'text/markdown', updatedAt: '2026-10-12' } };
    const provider: CloudLibrarySourceProvider = { scope: 'scope', read: vi.fn(async () => original), list: vi.fn().mockResolvedValue([]), search: vi.fn(), save: vi.fn() };
    setCloudWorkspaceProvider(provider); setCloudWorkspaceResource(original); setCloudWorkspaceActive(true);
    useAiHarnessStore.getState().setConfig({ engine: 'codex' });
    const nativeTurn = vi.spyOn(useAiHarnessStore.getState(), 'sendTurn').mockImplementation(async request => {
      setCloudWorkspaceProvider(null);
      await request.onBeforeTurn?.();
      return 'must not be returned';
    });
    try {
      render(<AiChatPanel loadPersistedState={false} />);
      fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: '总结当前文件' } });
      fireEvent.click(screen.getByTestId('ai-chat-submit'));
      await waitFor(() => expect(nativeTurn).toHaveBeenCalled());
      await waitFor(() => expect(useAiChatStore.getState().isGenerating).toBe(false));
      const latest = useAiChatStore.getState().getActiveConversation()?.messages.at(-1);
      expect(latest?.error).toContain('对话、账号或来源范围已改变');
      expect(latest?.documentContext?.cloudSnapshots).toHaveLength(1);
      expect(latest?.content).not.toContain('must not be returned');
    } finally { nativeTurn.mockRestore(); }
  });

  it('greets through Codex without scanning or reading the open workspace', async () => {
    const root = new SourceTestDirectory('greeting');
    const file = root.add(new SourceTestFile('private.md', 'MUST NOT READ ON HI'));
    const scan = vi.spyOn(root, 'values');
    const read = vi.spyOn(file, 'getFile');
    useWorkspaceStore.setState({ rootHandle: root.handle(), workspaceRootPath: 'C:/greeting', workspaceIdentity: { workspaceKey: 'greeting' } as ReturnType<typeof useWorkspaceStore.getState>['workspaceIdentity'],
      layout: { activePaneId: 'greeting', root: { type: 'pane', id: 'greeting', activeTabIndex: 0, tabs: [{ id: 'private', kind: 'file', fileName: file.name, filePath: file.name, fileHandle: file as unknown as FileSystemFileHandle, isDirty: false, scrollPosition: 0 }] } } });
    useAiHarnessStore.getState().setConfig({ engine: 'codex' });
    const nativeTurn = vi.spyOn(useAiHarnessStore.getState(), 'sendTurn').mockResolvedValue('你好！');
    try {
      render(<AiChatPanel loadPersistedState={false} />);
      fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: 'hi' } });
      fireEvent.click(screen.getByTestId('ai-chat-submit'));
      await waitFor(() => expect(nativeTurn).toHaveBeenCalled());
      expect(scan).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(nativeTurn.mock.calls[0][0].text).not.toContain('private.md');
      await waitFor(() => expect(useAiChatStore.getState().isGenerating).toBe(false));
    } finally { nativeTurn.mockRestore(); }
  });

  it('retains a 50K mixed Markdown draft across unmount and a different conversation without truncation', async () => {
    const long = ('中文 English\n$$\\int_0^1 x^2 dx$$\n\n```tex\n\\alpha+\\beta\n```\n').repeat(1200).slice(0, 50000);
    const first = useAiChatStore.getState().newConversation();
    const view = render(<AiChatPanel loadPersistedState={false} />);
    fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: long } });
    expect(useAiChatStore.getState().getConversationDraft(first)?.text).toBe(long);
    view.unmount();
    render(<AiChatPanel loadPersistedState={false} />);
    expect((screen.getByTestId('ai-chat-input') as HTMLTextAreaElement).value).toBe(long);
    act(() => { useAiChatStore.getState().newConversation(); });
    expect((screen.getByTestId('ai-chat-input') as HTMLTextAreaElement).value).toBe('');
    act(() => { useAiChatStore.getState().setActiveConversation(first); });
    expect((screen.getByTestId('ai-chat-input') as HTMLTextAreaElement).value).toBe(long);
    fireEvent.click(screen.getByTestId('ai-chat-submit'));
    await waitFor(() => expect(orchestratorMocks.runChat).toHaveBeenCalled());
    expect(orchestratorMocks.runChat.mock.calls.at(-1)?.[0].prompt).toBe(long);
  });

  it('does not submit Enter while a Chinese IME is composing', async () => {
    render(<AiChatPanel loadPersistedState={false} />);
    const textarea = screen.getByTestId('ai-chat-input');
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: '正在输入中文' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true });
    expect(orchestratorMocks.runChat).not.toHaveBeenCalled();
    expect((textarea as HTMLTextAreaElement).value).toBe('正在输入中文');
    fireEvent.compositionEnd(textarea);
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(orchestratorMocks.runChat).toHaveBeenCalled());
  });

  it('prepares a full version-bound planned update before presenting it for file approval', async () => {
    const getFile = vi.fn(async () => new File(['value=1\n'], 'test.py'));
    const root = { name: 'workspace', getFileHandle: vi.fn(async () => ({ getFile })) } as unknown as FileSystemDirectoryHandle;
    useWorkspaceStore.setState({ rootHandle: root });
    const generate = vi.fn(async (_messages: import('@/lib/ai/types').AiMessage[]) => ({ text: 'value=2\n', model: 'synthetic-model', finishReason: 'stop' as const }));
    const route = vi.spyOn(modelRouter, 'routeModel').mockReturnValue({ provider: { generate }, modelInfo: { model: 'synthetic-model' } } as unknown as ReturnType<typeof modelRouter.routeModel>);
    useAiWorkbenchStore.setState({ proposals: [{
      id: 'planned-edit', summary: 'Update value', steps: [], requiredApprovals: [], plannedWrites: [{ targetPath: 'test.py', mode: 'update', contentPreview: 'Set value to 2' }],
      sourceRefs: [], status: 'approved', confirmedApprovals: [], approvedWrites: ['test.py'], generatedDraftTargets: [], createdAt: Date.now(),
    }], highlightedProposalId: 'planned-edit' });
    try {
      render(<WorkbenchQueue loadPersisted={false} />);
      await waitFor(() => expect(screen.getByRole('button', { name: '生成目标草稿' })).not.toBeNull());
      fireEvent.click(screen.getByRole('button', { name: '生成目标草稿' }));
      await waitFor(() => expect(useAiWorkbenchStore.getState().drafts).toHaveLength(1));
      expect(useAiWorkbenchStore.getState().drafts[0]).toMatchObject({ originProposalId: 'planned-edit', writeMode: 'update', contentFormat: 'raw', content: 'value=2\n', fileChange: { expectedContent: 'value=1\n', targetPath: 'test.py' } });
      expect(generate.mock.calls[0][0]).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'user', content: expect.stringContaining('value=1') })]));
      expect(useAiWorkbenchStore.getState().proposals[0].generatedDraftTargets).toEqual(['test.py']);
    } finally { route.mockRestore(); }
  });

  it('auto-opens Trace with a pending approval badge and keeps status visible', async () => {
    let session = createAgentSession({
      id: 'session-pending-ui',
      profile: 'research',
      title: 'Pending review',
      task: 'Review a proposal',
      now: 100,
    });
    session = addAgentPendingApproval(session, {
      id: 'approval-pending-ui',
      capability: 'propose_write',
      toolName: 'workbench.createProposal',
      request: { name: 'workbench.createProposal', args: {} },
      decision: {
        capability: 'propose_write',
        permission: 'ask',
        requiresApproval: true,
        allowed: true,
      },
      now: 101,
    });
    useAgentSessionStore.setState({
      sessions: [session],
      activeSessionId: session.id,
      focusTarget: 'trace',
    });

    render(<AiChatPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-review-workspace')).not.toBeNull();
      expect(screen.getByTestId('agent-inspector-tab-trace').getAttribute('aria-selected')).toBe('true');
      expect(screen.getByTestId('agent-status-pending-approvals').textContent).toContain('1');
    });
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

  it('keeps following new chat messages when the reader is already near the bottom', async () => {
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

    await waitFor(() => { expect(scrollRegion.scrollTop).toBe(2400); });
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

    fireEvent.click(screen.getByTestId('agent-status-open-review'));
    fireEvent.click(screen.getByTestId('agent-inspector-tab-workbench'));
    fireEvent.click(screen.getByTestId('workbench-queue-toggle'));
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

    fireEvent.click(screen.getByTestId('ai-chat-templates'));

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

    fireEvent.click(screen.getByTestId('ai-chat-templates'));

    await waitFor(() => {
      expect(screen.getByTestId('prompt-picker-dock')).not.toBeNull();
    });

    expect(screen.getByTestId('ai-chat-panel').contains(screen.getByTestId('prompt-picker-dock'))).toBe(false);
  });

  it('shows connection and model selectors in the chat composer', () => {
    render(<AiChatPanel />);

    expect(screen.queryByTestId('ai-chat-model-summary')).toBeNull();
    expect(screen.queryByTestId('agent-status-model')).toBeNull();
    expect(screen.getByLabelText('AI 来源').tagName).toBe('SELECT');
    expect(screen.getByLabelText('AI 模型').tagName).toBe('SELECT');
  });

  it('uses the connection and model selected in the chat composer for the request', async () => {
    const firstProfile = createDefaultAiProviderProfile('openai-chat', {
      id: 'chat-profile-one',
      model: 'first-model',
    });
    const secondProfile = createDefaultAiProviderProfile('anthropic', {
      id: 'chat-profile-two',
      model: 'second-model',
    });
    useAiProviderProfileStore.setState({
      profiles: [firstProfile, secondProfile],
      activeProfileId: firstProfile.id,
      isLoading: false,
      isInitialized: true,
      error: null,
    });

    render(<AiChatPanel />);

    fireEvent.change(screen.getByLabelText('AI 来源'), { target: { value: `api:${secondProfile.id}` } });
    await waitFor(() => expect((screen.getByLabelText('AI 模型') as HTMLSelectElement).value).toBe('second-model'));
    fireEvent.change(screen.getByLabelText('AI 模型'), { target: { value: 'second-model' } });
    fireEvent.change(screen.getByPlaceholderText('Ask'), { target: { value: 'Use the selected model.' } });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));

    await waitFor(() => {
      expect(orchestratorMocks.runChat).toHaveBeenCalledWith(expect.objectContaining({
        settings: expect.objectContaining({
          profileId: secondProfile.id,
          providerId: 'anthropic',
          model: 'second-model',
        }),
      }));
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
    expect(screen.getByTestId('ai-chat-mode-agent').className).toContain('bg-background');
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
      chatText: 'Conclusion: Alpha improves evidence grounding.\n\nExample: compare the cited result with the original note.',
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
        suggestMemory: false,
        maxObservationReplans: 1,
        maxReadToolSteps: 5,
      }));
    });
    expect(researchAgentMocks.runResearchAgentForChat.mock.calls[0]?.[0]?.workflowId).toBeUndefined();

    await waitFor(() => {
      expect(screen.getByText(/Conclusion: Alpha improves evidence grounding/)).not.toBeNull();
      expect(screen.queryByText('Run')).toBeNull();
      expect(screen.queryByText('Workbench')).toBeNull();
      expect(screen.queryByText('Plan')).toBeNull();
      expect(screen.queryByText('Observations')).toBeNull();
    });

    const activeConversation = useAiChatStore.getState().getActiveConversation();
    const assistant = activeConversation?.messages.find((message): message is ChatMessage =>
      message.role === 'assistant' && message.agentResult?.sessionId === 'research-session-ui',
    );

    expect(activeConversation?.messages[0]?.content).toBe('Explain Alpha');
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
    expect(useAgentSessionStore.getState().getActiveSession()?.task).toBe('Explain Alpha');
    expect(screen.queryByTestId('ai-chat-follow-up-save-draft')).toBeNull();
    expect(screen.queryByTestId('ai-chat-follow-up-generate-proposal')).toBeNull();

    fireEvent.click(screen.getByTestId('ai-chat-review-document'));
    expect(screen.getByTestId('agent-inspector-tab-workbench').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByTestId('workbench-queue-toggle'));
    expect(screen.getByTestId('ai-chat-follow-up-actions')).not.toBeNull();
    expect(screen.getByTestId('ai-chat-follow-up-save-draft')).not.toBeNull();

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

    fireEvent.click(screen.getByTestId('agent-review-back'));
    fireEvent.click(screen.getByTitle('Open agent trace'));

    expect(useAgentSessionStore.getState().activeSessionId).toBe('research-session-ui');
    expect(useAgentSessionStore.getState().focusTarget).toBeNull();
    useAgentSessionStore.getState().setActiveSession(null);

    fireEvent.click(screen.getByTestId('agent-review-back'));
    fireEvent.click(screen.getByTitle('Review memory suggestions'));

    expect(useAgentSessionStore.getState().activeSessionId).toBe('research-session-ui');
    expect(useAgentSessionStore.getState().focusTarget).toBeNull();
  });

  it('does not carry a continuation command into a different conversation', async () => {
    useAiChatStore.getState().setComposerDraft({ text: 'Continue Alpha', mode: 'agent', continuation: { sourceSessionId: 'session-A', sourceSummary: 'Private A checkpoint' } });
    render(<AiChatPanel loadPersistedState={false} />);
    await waitFor(() => expect((screen.getByTestId('ai-chat-input') as HTMLTextAreaElement).value).toBe('Continue Alpha'));
    expect(useAiChatStore.getState().getConversationDraft()?.continuation?.sourceSessionId).toBe('session-A');
    act(() => { useAiChatStore.getState().newConversation(); });
    fireEvent.change(screen.getByTestId('ai-chat-input'), { target: { value: 'Answer B using its own context' } });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));
    await waitFor(() => expect(researchAgentMocks.runResearchAgentForChat).toHaveBeenCalled());
    expect(researchAgentMocks.runResearchAgentForChat.mock.calls.at(-1)?.[0].continuation).toBeUndefined();
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
    expect(screen.queryByTestId('ai-chat-agent-effort-medium')).toBeNull();
    expect(screen.queryByLabelText('Suggest memory')).toBeNull();

    const advancedToggle = screen.getByTestId('ai-chat-agent-advanced-toggle');
    expect(advancedToggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(advancedToggle);
    expect(advancedToggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('ai-chat-agent-advanced-panel')).not.toBeNull();
    expect(screen.getByTestId('ai-chat-agent-effort-medium').getAttribute('aria-pressed')).toBe('true');
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

  it('uses an explicit workflow once and then returns to automatic inference while preserving writing preferences', async () => {
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
    useAiChatStore.getState().setNoteConfigOverrides({ language: 'en-US', noteStyle: 'concise' });

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
        noteConfigOverrides: expect.objectContaining({ language: 'en-US', noteStyle: 'concise' }),
      }));
    });

    researchAgentMocks.runResearchAgentForChat.mockClear();
    fireEvent.change(screen.getByPlaceholderText('Ask'), {
      target: { value: 'Let the agent infer the workflow' },
    });
    expect(screen.getByTestId('ai-chat-agent-workflow-label').textContent).toContain('Auto');
    expect(screen.getByTestId('ai-chat-agent-workflow-label').textContent).toContain('auto');
    expect(useAiChatStore.getState().selectedResearchWorkflowId).toBeNull();
    expect(useAiChatStore.getState().noteConfigOverrides).toMatchObject({ language: 'en-US', noteStyle: 'concise' });

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
    expect(screen.queryByTestId('ai-chat-agent-effort-medium')).toBeNull();
    expect(screen.getByTestId('ai-chat-agent-advanced-toggle').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByTestId('ai-chat-agent-advanced-toggle'));
    expect(screen.getByTestId('ai-chat-agent-effort-medium')).not.toBeNull();
  });

  it('submits a second Chat message after the first response completes', async () => {
    orchestratorMocks.runChat
      .mockResolvedValueOnce({
        text: 'First answer',
        evidenceRefs: [],
        context: { nodes: [], prompt: '', evidenceRefs: [], truncated: false },
        model: null,
        followUpActions: [],
      })
      .mockResolvedValueOnce({
        text: 'Second answer',
        evidenceRefs: [],
        context: { nodes: [], prompt: '', evidenceRefs: [], truncated: false },
        model: null,
        followUpActions: [],
      });

    render(<AiChatPanel />);
    const input = screen.getByPlaceholderText('Ask');
    const submit = screen.getByTestId('ai-chat-submit');

    fireEvent.change(input, { target: { value: 'First question' } });
    fireEvent.click(submit);
    await waitFor(() => expect(orchestratorMocks.runChat).toHaveBeenCalledTimes(1));

    fireEvent.change(input, { target: { value: 'Second question' } });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));

    await waitFor(() => expect(orchestratorMocks.runChat).toHaveBeenCalledTimes(2));
    expect(orchestratorMocks.runChat.mock.calls[1]?.[0]).toMatchObject({ prompt: 'Second question' });
  });

  it.each([false, true])('retries a failed Chat request with the original prompt and active connection (partial: %s)', async (partial) => {
    const profile = createDefaultAiProviderProfile('custom-openai-compatible', {
      id: 'chat-retry-gateway',
      model: 'vendor-retry-model',
    });
    useAiProviderProfileStore.setState({
      profiles: [profile],
      activeProfileId: profile.id,
      isLoading: false,
      isInitialized: true,
      error: null,
    });
    orchestratorMocks.runChat
      .mockImplementationOnce(async () => {
        if (partial) {
          const store = useAiChatStore.getState();
          store.appendToAssistantMessage(store.activeAssistantMessageId!, 'Preserved partial answer');
        }
        throw new Error('Provider unavailable');
      })
      .mockResolvedValueOnce({
        text: 'Recovered answer',
        evidenceRefs: [],
        context: { nodes: [], prompt: '', evidenceRefs: [], truncated: false },
        model: null,
        followUpActions: [],
      });

    render(<AiChatPanel />);
    fireEvent.change(screen.getByPlaceholderText('Ask'), { target: { value: 'Retry this question' } });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));

    await waitFor(() => expect(screen.getByTestId('ai-chat-request-error').textContent).toContain('Provider unavailable'));
    expect(screen.getAllByText(/^Provider unavailable$/)).toHaveLength(1);
    expect(screen.queryByText(/^Error: Provider unavailable$/)).toBeNull();
    if (partial) expect(screen.getByText('Preserved partial answer')).not.toBeNull();
    fireEvent.click(screen.getByTestId('ai-chat-retry'));

    await waitFor(() => {
      expect(orchestratorMocks.runChat).toHaveBeenCalledTimes(2);
      expect(orchestratorMocks.runChat.mock.calls[1]?.[0]).toMatchObject({
        prompt: 'Retry this question',
        settings: expect.objectContaining({
          providerId: 'custom',
          model: 'vendor-retry-model',
          profileId: 'chat-retry-gateway',
        }),
      });
    });
    expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.content).toBe('Recovered answer');
  });

  it('sends the active PDF identity and annotations without sending cached PDF text', async () => {
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
      target: { value: 'Summarize this selected annotation.' },
    });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));

    await waitFor(() => {
      expect(orchestratorMocks.runChat).toHaveBeenCalledWith(expect.objectContaining({
        prompt: 'Summarize this selected annotation.',
        filePath: 'papers/alpha.pdf',
        content: undefined,
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

  it.each([false, true])('keeps a depth follow-up on the latest substantive topic (new subject: %s)', async (hasNewTopic) => {
    const source: documentSourceModule.AgentDocumentSource = {
      path: 'paper.pdf', kind: 'pdf', version: 'sha-A', totalUnits: 2, unitLabel: 'page',
      readUnit: async () => ({ status: 'text', text: 'Verified source text' }), close: async () => {},
    };
    const capture = vi.spyOn(documentSourceModule, 'openAgentDocumentSource').mockResolvedValue(source);
    pdfContextMocks.loadPdfJsDocument.mockResolvedValue({ numPages: 2, destroy: vi.fn() });
    pdfContextMocks.getPdfPageSearchText.mockResolvedValue('Old paper text unrelated to the new Python topic.');
    const saved = { ...createAgentSession({ id: 'full-paper-session', profile: 'research', task: '通读全文，解释原理' }), status: 'completed' as const, documentResearch: {
      status: 'ready' as const, workflowId: 'paper-reading', workspaceKey: 'workspace-A', checkpoint: {
        version: 1 as const, queryKey: '["通读全文，解释原理","解释所有机制"]', completedBatches: 1, summaries: ['Verified full reading'], findings: [],
        sources: [{ path: 'paper.pdf', version: 'sha-A', totalUnits: 2, completedUnits: [1, 2], offsets: {} }],
        coverage: [{ path: 'paper.pdf', kind: 'pdf' as const, unitLabel: 'page' as const, totalUnits: 2, readUnits: [1, 2], pendingUnits: [], emptyUnits: [], unreadableUnits: [] }],
      },
    } };
    const messages: ChatMessage[] = [
      { id: 'paper-question', role: 'user', content: '通读全文，解释原理', timestamp: 1 },
      { id: 'paper-answer', role: 'assistant', content: 'Verified paper answer', timestamp: 2, agentResult: { sessionId: saved.id }, documentContext: { workspaceKey: 'workspace-A', paths: ['paper.pdf'] } },
      ...(hasNewTopic ? [
        { id: 'new-question', role: 'user' as const, content: '换个话题，解释 Python 装饰器', timestamp: 3 },
        { id: 'new-answer', role: 'assistant' as const, content: 'A decorator wraps a callable.', timestamp: 4, documentContext: { workspaceKey: 'workspace-A', paths: ['paper.pdf'] } },
      ] : []),
    ];
    useAgentSessionStore.setState({ sessions: [saved], activeSessionId: saved.id });
    useAiChatStore.setState({ conversations: [{ id: 'document-followup', title: 'Reading', createdAt: 1, messages }], activeConversationId: 'document-followup' });
    useWorkspaceStore.setState({ rootHandle: { name: 'workspace-A', getFileHandle: async () => ({ getFile: async () => new File(['paper bytes'], 'paper.pdf') }) } as unknown as FileSystemDirectoryHandle });
    researchAgentMocks.runResearchAgentForChat.mockImplementation(async ({ sessionId }) => ({
      plannerModel: null, plannerModelInfo: null, adapterWarnings: [], workflow: null, workflowPlannerHints: null,
      result: { sessionId, promptContext: { nodes: [], prompt: '', evidenceRefs: [], truncated: false } },
      agentResult: { sessionId, planSource: 'default', warnings: [], planSteps: [] }, chatText: 'Detailed explanation',
    }));
    try {
      render(<AiChatPanel loadPersistedState={false} />);
      fireEvent.change(screen.getByPlaceholderText('Ask'), { target: { value: '详细讲解，不是一句话' } });
      fireEvent.click(screen.getByTestId('ai-chat-submit'));
      if (hasNewTopic) {
        await waitFor(() => expect(useAiChatStore.getState().isGenerating).toBe(false));
        expect(useAiChatStore.getState().getActiveConversation()?.messages.at(-1)?.error).toBeUndefined();
        await waitFor(() => expect(orchestratorMocks.runChat).toHaveBeenCalledWith(expect.objectContaining({ prompt: '详细讲解，不是一句话' })));
        expect(orchestratorMocks.runChat.mock.calls[0][0].content).toBeUndefined();
        expect(researchAgentMocks.runResearchAgentForChat).not.toHaveBeenCalled();
        expect(capture).not.toHaveBeenCalled();
        expect(pdfContextMocks.loadPdfJsDocument).not.toHaveBeenCalled();
      } else {
        await waitFor(() => expect(researchAgentMocks.runResearchAgentForChat).toHaveBeenCalledWith(expect.objectContaining({
          workflowId: 'paper-reading', responseMode: 'conversation', documentSources: [source],
          documentReadingObjective: { task: '通读全文，解释原理', query: '解释所有机制' },
        })));
        const request = researchAgentMocks.runResearchAgentForChat.mock.calls[0][0];
        expect(useAgentSessionStore.getState().getSession(request.sessionId)?.documentResearch?.checkpoint.summaries).toEqual(['Verified full reading']);
        expect(orchestratorMocks.runChat).not.toHaveBeenCalled();
        await waitFor(() => expect(useAiChatStore.getState().isGenerating).toBe(false));
      }
    } finally {
      capture.mockRestore();
    }
  });

  it('routes retry of a completed execution receipt to the original session and source snapshot', async () => {
    const session = { ...createAgentSession({ id: 'execution-retry', profile: 'research', task: 'Run Python code' }), status: 'failed' as const,
      executionContinuation: { planSteps: [], request: { task: 'Run Python code', query: 'Run Python code', content: 'Original authorized input', filePath: 'original.py', workflowId: 'notebook-analysis', workspaceKey: '' } } };
    useAgentSessionStore.setState({ sessions: [session], activeSessionId: session.id });
    const store = useAiChatStore.getState();
    store.addUserMessage('Run Python code');
    const messageId = store.startAssistantMessage({ requestMode: 'agent' });
    store.setAssistantMetadata(messageId, { agentResult: { sessionId: session.id } });
    store.setAssistantError(messageId, 'Synthesis timed out');
    const retryable = vi.spyOn(researchCore, 'canRetryResearchAgentSynthesis').mockReturnValue(true);
    researchAgentMocks.runResearchAgentForChat.mockImplementation(async ({ sessionId }) => ({
      plannerModel: null, plannerModelInfo: null, adapterWarnings: [], workflow: null, workflowPlannerHints: null,
      result: { sessionId, promptContext: { nodes: [], prompt: '', evidenceRefs: [], truncated: false } },
      agentResult: { sessionId }, chatText: 'The prior execution returned 5.',
    }));
    try {
      render(<AiChatPanel loadPersistedState={false} />);
      fireEvent.click(screen.getByTestId('ai-chat-retry'));
      await waitFor(() => expect(researchAgentMocks.runResearchAgentForChat).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: session.id, content: 'Original authorized input', filePath: 'original.py', workflowId: 'notebook-analysis',
        continuation: { sourceSessionId: session.id, approvalResume: true },
      })));
      expect(useAgentSessionStore.getState().sessions).toHaveLength(1);
      expect(orchestratorMocks.runChat).not.toHaveBeenCalled();
    } finally { retryable.mockRestore(); }
  });

  async function restoreDocumentRetryFixture() {
    const path = 'Benchmarking and Fidelity Response Theory.pdf';
    const task = '通读全文，解释原理';
    const pages = Array.from({ length: 28 }, (_, index) => index + 1);
    const session = { ...createAgentSession({ id: 'original-document-session', profile: 'research', task }), status: 'failed' as const,
      error: 'Final synthesis failed', documentResearch: {
        status: 'ready' as const, workflowId: 'paper-reading', workspaceKey: 'workspace-A', checkpoint: {
          version: 1 as const, queryKey: JSON.stringify([task, task]), completedBatches: 13, summaries: ['Verified original paper reading'], findings: [],
          sources: [{ path, version: 'original-bytes', totalUnits: 28, completedUnits: pages, offsets: {} }],
          coverage: [{ path, kind: 'pdf' as const, unitLabel: 'page' as const, totalUnits: 28, readUnits: pages, pendingUnits: [], emptyUnits: [], unreadableUnits: [] }],
        },
      },
    };
    useAgentSessionStore.setState({ sessions: [session], activeSessionId: session.id });
    await useAgentSessionStore.getState().saveDocumentResearch(session.id, session.documentResearch);
    const chat = useAiChatStore.getState();
    chat.addUserMessage(task);
    const id = chat.startAssistantMessage({ requestMode: 'chat' });
    // Reproduce the previously persisted mismatch; the checkpoint is authoritative.
    chat.setAssistantMetadata(id, { agentResult: { sessionId: session.id }, documentContext: { workspaceKey: 'workspace-A', paths: ['A quantum processor.pdf'] } });
    chat.setAssistantError(id, 'Final synthesis failed', 'Unfinished original answer');
    await chat.flushConversations();
    const savedSessions = structuredClone(storage.set.mock.calls.filter(([key]) => key === 'lattice-agent-sessions-v1').at(-1)?.[1]);
    const savedChat = structuredClone(storage.set.mock.calls.filter(([key]) => key === 'lattice-ai-chat').at(-1)?.[1]);
    useAgentSessionStore.setState({ sessions: [], activeSessionId: null });
    useAiChatStore.setState({ conversations: [], activeConversationId: null, hasHydratedConversations: false });
    storage.get.mockResolvedValueOnce(savedSessions).mockResolvedValueOnce(savedChat);
    await useAgentSessionStore.getState().loadSessions();
    await useAiChatStore.getState().loadConversations();

    const originalFile = new File(['original bytes'], path);
    const activeFile = new File(['different bytes'], 'A quantum processor.pdf');
    const getOriginalFile = vi.fn().mockResolvedValue(originalFile);
    const getActiveFile = vi.fn().mockResolvedValue(activeFile);
    useWorkspaceStore.setState({
      rootHandle: { name: 'workspace-A', getFileHandle: async () => ({ getFile: getOriginalFile }) } as unknown as FileSystemDirectoryHandle,
      layout: { activePaneId: 'retry-pane', root: { type: 'pane', id: 'retry-pane', activeTabIndex: 0, tabs: [{
        id: 'different-pdf', kind: 'file', fileName: 'A quantum processor.pdf', filePath: 'A quantum processor.pdf',
        fileHandle: { getFile: getActiveFile } as unknown as FileSystemFileHandle, isDirty: false, scrollPosition: 0,
      }] } },
    });
    const source: documentSourceModule.AgentDocumentSource = {
      path, kind: 'pdf', version: 'original-bytes', totalUnits: 28, unitLabel: 'page',
      readUnit: vi.fn().mockResolvedValue({ status: 'text', text: 'Original paper' }), close: vi.fn().mockResolvedValue(undefined),
    };
    const openSource = vi.spyOn(documentSourceModule, 'openAgentDocumentSource').mockImplementation(async (_file, sourcePath) => ({ ...source, path: sourcePath }));
    researchAgentMocks.runResearchAgentForChat.mockImplementation(async ({ sessionId }) => ({
      plannerModel: null, plannerModelInfo: null, adapterWarnings: [], workflow: null, workflowPlannerHints: null,
      result: { sessionId, promptContext: { nodes: [], prompt: '', evidenceRefs: [], truncated: false } },
      agentResult: { sessionId }, chatText: 'Complete answer from original paper',
    }));
    return { session, path, getOriginalFile, getActiveFile, openSource };
  }

  it.each(['ai-chat-retry', 'document-reading-resume'])('restores original document checkpoint after reload and tab switch through %s', async (button) => {
    const fixture = await restoreDocumentRetryFixture();
    try {
      render(<AiChatPanel loadPersistedState={false} />);
      fireEvent.click(screen.getByTestId(button));
      await waitFor(() => expect(useAiChatStore.getState().isGenerating).toBe(false));
      expect(researchAgentMocks.runResearchAgentForChat).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'original-document-session', filePath: 'Benchmarking and Fidelity Response Theory.pdf', workspaceKey: 'workspace-A',
        documentSources: [expect.objectContaining({ path: 'Benchmarking and Fidelity Response Theory.pdf', version: 'original-bytes' })],
      }));
      expect(fixture.getActiveFile).not.toHaveBeenCalled();
      expect(useAgentSessionStore.getState().sessions).toHaveLength(1);
      expect(useAgentSessionStore.getState().getSession(fixture.session.id)?.documentResearch?.checkpoint).toEqual(fixture.session.documentResearch.checkpoint);
      const request = researchAgentMocks.runResearchAgentForChat.mock.calls[0][0];
      expect(JSON.stringify(request.history)).not.toContain('Unfinished original answer');
      await useAiChatStore.getState().flushConversations();
      const persisted = storage.set.mock.calls.filter(([key]) => key === 'lattice-ai-chat').at(-1)?.[1];
      expect(persisted.conversations[0].messages.at(-1).documentContext).toEqual({ workspaceKey: 'workspace-A', paths: [fixture.path], snapshots: [expect.objectContaining({ path: fixture.path, version: 'original-bytes' })] });
    } finally { fixture.openSource.mockRestore(); }
  });

  it.each(['missing-file', 'different-workspace'])('retains original source identity when document recovery fails: %s', async (failure) => {
    const fixture = await restoreDocumentRetryFixture();
    if (failure === 'missing-file') fixture.getOriginalFile.mockRejectedValueOnce(new Error('Original file unavailable'));
    else useWorkspaceStore.setState({ rootHandle: { name: 'workspace-B' } as FileSystemDirectoryHandle });
    try {
      render(<AiChatPanel loadPersistedState={false} />);
      fireEvent.click(screen.getByTestId('document-reading-resume'));
      await waitFor(() => expect(useAiChatStore.getState().isGenerating).toBe(false));
      const message = useAiChatStore.getState().getActiveConversation()?.messages.at(-1);
      expect(message?.error).toBeTruthy();
      expect(message?.documentContext).toEqual({ workspaceKey: 'workspace-A', paths: [fixture.path] });
      expect(fixture.getActiveFile).not.toHaveBeenCalled();
      expect(researchAgentMocks.runResearchAgentForChat).not.toHaveBeenCalled();
      expect(useAgentSessionStore.getState().getSession(fixture.session.id)?.documentResearch?.checkpoint).toEqual(fixture.session.documentResearch.checkpoint);
    } finally { fixture.openSource.mockRestore(); }
  });

  it('starts a deliberate new reading request on the newly selected document', async () => {
    const fixture = await restoreDocumentRetryFixture();
    try {
      render(<AiChatPanel loadPersistedState={false} />);
      fireEvent.change(screen.getByPlaceholderText('Ask'), { target: { value: '通读这篇新论文，详细讲解原理' } });
      fireEvent.click(screen.getByTestId('ai-chat-submit'));
      await waitFor(() => expect(researchAgentMocks.runResearchAgentForChat).toHaveBeenCalled());
      const request = researchAgentMocks.runResearchAgentForChat.mock.calls[0][0];
      expect(request.sessionId).not.toBe(fixture.session.id);
      expect(request.filePath).toBe('A quantum processor.pdf');
      expect(fixture.getActiveFile).toHaveBeenCalledOnce();
      expect(fixture.getOriginalFile).not.toHaveBeenCalled();
      expect(useAgentSessionStore.getState().getSession(request.sessionId)?.documentResearch).toBeUndefined();
      expect(useAgentSessionStore.getState().getSession(fixture.session.id)?.documentResearch?.checkpoint).toEqual(fixture.session.documentResearch.checkpoint);
    } finally { fixture.openSource.mockRestore(); }
  });

  it('routes an explicit document resume by its checkpoint even when the saved task has no document keywords', async () => {
    const fixture = await restoreDocumentRetryFixture();
    useAgentSessionStore.setState(state => ({ sessions: state.sessions.map(session => ({ ...session, task: 'Investigate gates' })) }));
    try {
      render(<AiChatPanel loadPersistedState={false} />);
      fireEvent.click(screen.getByTestId('document-reading-resume'));
      await waitFor(() => expect(useAiChatStore.getState().isGenerating).toBe(false));
      expect(researchAgentMocks.runResearchAgentForChat).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: fixture.session.id, filePath: fixture.path,
        documentReadingObjective: { task: '通读全文，解释原理', query: '通读全文，解释原理' },
      }));
      expect(orchestratorMocks.runChat).not.toHaveBeenCalled();
    } finally { fixture.openSource.mockRestore(); }
  });

  it('shows a document synthesis failure once while keeping its recovery progress', async () => {
    const fixture = await restoreDocumentRetryFixture();
    try {
      render(<AiChatPanel loadPersistedState={false} />);
      expect(screen.getAllByText('Final synthesis failed')).toHaveLength(1);
      expect(screen.getByTestId('document-reading-progress')).toBeTruthy();
      expect(screen.getByTestId('document-reading-resume')).toBeTruthy();
      expect(screen.getByText('Unfinished original answer')).toBeTruthy();
    } finally { fixture.openSource.mockRestore(); }
  });

  it('reads independently numbered PDF pages instead of binding all chat evidence to the visible page', async () => {
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

    render(
      <>
        <div data-testid="pdf-scroll-container-pane-empty-cache-pdf">
          <div data-page-number="2" data-pdf-page-visible="true">
            <div className="textLayer">Visible current PDF page text</div>
          </div>
        </div>
        <AiChatPanel />
      </>,
    );

    fireEvent.change(screen.getByPlaceholderText('Ask'), {
      target: { value: 'Explain page 1 of this PDF.' },
    });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));

    await waitFor(() => {
      expect(orchestratorMocks.runChat).toHaveBeenCalledWith(expect.objectContaining({
        filePath: 'papers/empty-cache.pdf',
        content: expect.stringContaining('--- Page 1 ---\nExtracted PDF introduction and result evidence.'),
      }));
    });
    expect(orchestratorMocks.runChat.mock.calls[0][0].content).toContain('--- Page 2 ---\nExtracted PDF methods evidence.');
    expect(pdfContextMocks.loadPdfJsDocument).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
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
      expect(screen.getByText(/^Provider unavailable$/)).not.toBeNull();
    });

    const activeConversation = useAiChatStore.getState().getActiveConversation();
    const assistant = activeConversation?.messages.find((message) =>
      message.role === 'assistant' && message.error === 'Provider unavailable',
    );

    expect(assistant?.promptContext?.nodes.some((node) =>
      node.label === 'Current file: notes/note.md' &&
      node.content.includes('Evidence that should stay visible after an AI error'),
    )).toBe(true);
    expect(assistant?.evidenceRefs?.some((ref) => ref.locator === 'notes/note.md')).toBe(true);
  });

  it('shows a visible recovery message when Chat returns citations without answer text', async () => {
    orchestratorMocks.runChat.mockResolvedValueOnce({
      text: '   ',
      evidenceRefs: [{ kind: 'file', label: 'paper.md', locator: 'notes/paper.md' }],
      context: {
        nodes: [],
        prompt: '',
        evidenceRefs: [{ kind: 'file', label: 'paper.md', locator: 'notes/paper.md' }],
        truncated: false,
      },
      model: null,
      followUpActions: [],
    });

    render(<AiChatPanel />);

    fireEvent.change(screen.getByPlaceholderText('Ask'), {
      target: { value: 'Please answer this question.' },
    });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-chat-answer-section-conclusion').textContent)
        .toContain('model returned an empty answer');
    });
    const assistant = useAiChatStore.getState().getActiveConversation()?.messages.at(-1);
    expect(assistant?.role).toBe('assistant');
    expect(assistant?.content.trim()).not.toBe('');
  });

  it('shows an explicit context truncation state next to the answer', async () => {
    orchestratorMocks.runChat.mockResolvedValueOnce({
      text: 'Answer based on the available context.',
      evidenceRefs: [],
      context: {
        nodes: [],
        prompt: 'partial context',
        evidenceRefs: [],
        truncated: true,
      },
      model: null,
      followUpActions: [],
    });

    render(<AiChatPanel />);
    fireEvent.change(screen.getByPlaceholderText('Ask'), { target: { value: 'Use the context.' } });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));

    await waitFor(() => expect(screen.getByTestId('ai-chat-context-truncated')).not.toBeNull());
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
      expect(screen.getByText(/^Agent unavailable$/)).not.toBeNull();
    });

    const activeConversation = useAiChatStore.getState().getActiveConversation();
    const assistant = activeConversation?.messages.find((message) =>
      message.role === 'assistant' && message.error === 'Agent unavailable',
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

  it('reuses bounded PDF context for repeated questions about the same unchanged file', async () => {
    const destroy = vi.fn();
    pdfContextMocks.loadPdfJsDocument.mockResolvedValue({
      numPages: 2,
      destroy,
    });
    pdfContextMocks.getPdfPageSearchText.mockImplementation(async (_document, pageNumber: number) =>
      `Cached page ${pageNumber} text`,
    );
    const file = new File([new Uint8Array([37, 80, 68, 70, 45])], 'cached-paper.pdf', {
      type: 'application/pdf',
      lastModified: 42,
    });

    const first = await readFileForAiContext(file, 'papers/cached-paper.pdf');
    const second = await readFileForAiContext(file, 'papers/cached-paper.pdf');

    expect(second).toBe(first);
    expect(pdfContextMocks.loadPdfJsDocument).toHaveBeenCalledTimes(1);
    expect(pdfContextMocks.getPdfPageSearchText).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('includes requested later PDF pages within a transparent extraction budget', async () => {
    pdfContextMocks.loadPdfJsDocument.mockResolvedValue({ numPages: 40, destroy: vi.fn() });
    pdfContextMocks.getPdfPageSearchText.mockImplementation(async (_document, page: number) => `Evidence on page ${page}`);
    const file = new File(['later-pages'], 'later.pdf', { type: 'application/pdf', lastModified: 903 });
    const context = await readFileForAiContext(file, 'papers/later.pdf', { preferredPdfPages: [32, 24] });
    expect(context).toContain('--- Page 32 ---\nEvidence on page 32');
    expect(context).toContain('--- Page 24 ---\nEvidence on page 24');
    expect(pdfContextMocks.getPdfPageSearchText).toHaveBeenCalledTimes(16);
    expect(context).toContain('Omitted pages were not read');
  });

  it('reads page text for multiple mentioned PDFs instead of sending binary placeholders', async () => {
    pdfContextMocks.loadPdfJsDocument.mockResolvedValue({ numPages: 2, destroy: vi.fn() });
    pdfContextMocks.getPdfPageSearchText.mockImplementation(async (_document, page: number) => `Mentioned page ${page} evidence`);
    const getFileHandle = vi.fn(async (name: string) => ({
      getFile: async () => new File(['pdf'], name, { type: 'application/pdf', lastModified: 927 }),
    }));
    useWorkspaceStore.setState({
      rootHandle: { name: 'Research', getFileHandle } as unknown as FileSystemDirectoryHandle,
      layout: { activePaneId: 'mentions-pane', root: { type: 'pane', id: 'mentions-pane', tabs: [], activeTabIndex: -1 } },
    });
    render(<AiChatPanel />);
    fireEvent.change(screen.getByPlaceholderText('Ask'), { target: { value: 'Compare @mention-a.pdf#page=2 and @mention-b.pdf' } });
    fireEvent.click(screen.getByTestId('ai-chat-submit'));
    await waitFor(() => expect(orchestratorMocks.runChat).toHaveBeenCalled());
    expect(orchestratorMocks.runChat.mock.calls[0][0].references).toEqual([
      { path: 'mention-a.pdf', content: expect.stringContaining('--- Page 2 ---\nMentioned page 2 evidence') },
      { path: 'mention-b.pdf', content: expect.stringContaining('--- Page 1 ---\nMentioned page 1 evidence') },
    ]);
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
      expect(screen.queryByText('Workbench')).toBeNull();
      expect(screen.queryByText(/Mode: answer-only/)).toBeNull();
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
    expect((screen.getByLabelText('Suggest memory') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText('Suggest memory'));
    expect((screen.getByLabelText('Suggest memory') as HTMLInputElement).checked).toBe(true);
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
