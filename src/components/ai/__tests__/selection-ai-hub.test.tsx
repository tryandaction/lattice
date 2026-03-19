/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SelectionAiHub } from '../selection-ai-hub';
import { useSelectionAiStore } from '@/stores/selection-ai-store';
import { useSettingsStore } from '@/stores/settings-store';
import { DEFAULT_SETTINGS } from '@/types/settings';

const runSelectionAiMode = vi.fn();

vi.mock('@/lib/ai/selection-actions', () => ({
  runSelectionAiMode: (...args: unknown[]) => runSelectionAiMode(...args),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SelectionAiHub', () => {
  const context = {
    sourceKind: 'markdown' as const,
    paneId: 'pane-main' as const,
    fileName: 'notes.md',
    filePath: 'notes/notes.md',
    selectedText: 'A highlighted research paragraph',
    contextText: 'Surrounding local context',
    contextSummary: '选区上下文',
    sourceLabel: 'notes.md · 选区',
    evidenceRefs: [
      {
        kind: 'file' as const,
        label: 'notes/notes.md',
        locator: 'notes/notes.md',
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useSelectionAiStore.setState({
      preferredMode: 'chat',
      recentPrompts: [],
    });
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        aiEnabled: true,
      },
      isLoading: false,
      isInitialized: true,
      error: null,
    });
  });

  it('uses preferred mode when no explicit initial mode is provided', () => {
    useSelectionAiStore.setState({
      preferredMode: 'agent',
      recentPrompts: [
        { mode: 'agent', prompt: '查找风险', createdAt: 1 },
        { mode: 'chat', prompt: '快速总结', createdAt: 2 },
      ],
    });

    render(
      <SelectionAiHub
        context={context}
        initialMode={null}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText('结果进入 AI Chat，并自动接入 Evidence Panel。')).not.toBeNull();
    expect(screen.queryByText('查找风险')).not.toBeNull();
    expect(screen.queryByText('快速总结')).toBeNull();
  });

  it('supports keyboard mode switch, template fill, and submit shortcut', async () => {
    runSelectionAiMode.mockResolvedValue({
      kind: 'chat',
      title: 'done',
    });

    render(
      <SelectionAiHub
        context={context}
        initialMode="chat"
        onClose={() => {}}
      />,
    );

    fireEvent.keyDown(document, { altKey: true, key: '2' });
    await waitFor(() => {
      expect(screen.queryByText('结果进入 AI Chat，并自动接入 Evidence Panel。')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: '找出风险与缺口' }));
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toContain('关键风险');

    fireEvent.keyDown(document, { ctrlKey: true, key: 'Enter' });

    await waitFor(() => {
      expect(runSelectionAiMode).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'agent',
        prompt: textarea.value,
      }));
    });

    expect(useSelectionAiStore.getState().recentPrompts[0]?.prompt).toBe(textarea.value);
    expect(useSelectionAiStore.getState().preferredMode).toBe('agent');
  });
});
