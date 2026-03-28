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

vi.mock('@/lib/storage-adapter', () => ({
  getStorageAdapter: () => storage,
  isTauriHost: () => false,
}));

vi.mock('@/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const mapping: Record<string, string> = {
        'chat.title': 'AI Chat',
        'chat.newChat': 'New Chat',
        'chat.deleteChat': 'Delete Chat',
        'common.close': 'Close',
        'chat.empty': 'Empty',
        'chat.you': 'YOU',
        'chat.ai': 'AI',
        'chat.copy': 'Copy',
        'chat.copied': 'Copied',
        'chat.placeholder': 'Ask',
        'chat.stop': 'Stop',
        'chat.send': 'Send',
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
      <button
        type="button"
        data-testid="prompt-picker-select-template"
        onClick={() => onSelectTemplate(promptTemplate)}
      >
        select-template
      </button>
    ) : null
  ),
}));

vi.mock('@/components/prompt/prompt-editor-dialog', () => ({
  PromptEditorDialog: () => null,
}));

vi.mock('@/components/prompt/prompt-run-sheet', () => ({
  PromptRunSheet: ({
    isOpen,
    contextValues,
    contextControls,
  }: {
    isOpen: boolean;
    contextValues: Record<string, unknown>;
    contextControls?: Array<{ key: string; checked: boolean }>;
  }) => (
    isOpen ? (
      <div data-testid="prompt-run-sheet-state">
        {JSON.stringify({
          contextValues,
          contextControls,
        })}
      </div>
    ) : null
  ),
}));

import { AiChatPanel } from '../ai-chat-panel';
import { useAiChatStore } from '@/stores/ai-chat-store';
import { useAiWorkbenchStore } from '@/stores/ai-workbench-store';
import { useSettingsStore } from '@/stores/settings-store';
import { DEFAULT_SETTINGS } from '@/types/settings';

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
    });
    useAiWorkbenchStore.setState({
      drafts: [],
      proposals: [],
      highlightedProposalId: null,
    });
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

    expect(screen.getAllByText('Selection AI · 深度分析').length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getByTestId('evidence-panel').textContent).toContain('msg-assistant');
    });
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
      expect(screen.queryByText('Selection AI · 计划生成')).not.toBeNull();
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

  it('keeps heavy prompt-run context opt-in by default for chat templates', async () => {
    render(<AiChatPanel />);

    fireEvent.click(screen.getByText('prompt.chat.open'));

    await waitFor(() => {
      expect(screen.getByTestId('prompt-picker-select-template')).not.toBeNull();
    });

    fireEvent.click(screen.getByTestId('prompt-picker-select-template'));

    await waitFor(() => {
      expect(screen.getByTestId('prompt-run-sheet-state')).not.toBeNull();
    });

    const payload = JSON.parse(screen.getByTestId('prompt-run-sheet-state').textContent ?? '{}') as {
      contextValues: Record<string, unknown>;
      contextControls: Array<{ key: string; checked: boolean }>;
    };

    expect(payload.contextValues.current_file_content ?? null).toBeNull();
    expect(payload.contextValues.pdf_annotations ?? null).toBeNull();
    expect(payload.contextValues.workspace_summary ?? null).toBeNull();
    expect(payload.contextControls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'includeCurrentFileContent', checked: false }),
        expect.objectContaining({ key: 'includeAnnotations', checked: false }),
        expect.objectContaining({ key: 'includeWorkspaceSummary', checked: false }),
      ]),
    );
  });
});
