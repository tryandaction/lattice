/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const storage = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/lib/storage-adapter', () => ({
  getStorageAdapter: () => storage,
}));

vi.mock('@/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
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
      };
      return mapping[key] ?? key;
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
});
