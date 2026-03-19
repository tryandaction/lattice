/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SelectionContextMenu } from '../selection-context-menu';
import { useSelectionAiStore } from '@/stores/selection-ai-store';

describe('SelectionContextMenu', () => {
  const context = {
    sourceKind: 'markdown' as const,
    paneId: 'pane-main' as const,
    fileName: 'notes.md',
    filePath: 'notes/notes.md',
    selectedText: 'Meaningful selected text',
    sourceLabel: 'notes.md · 选区',
    evidenceRefs: [],
  };

  beforeEach(() => {
    useSelectionAiStore.setState({
      preferredMode: 'agent',
      recentPrompts: [],
    });
  });

  it('supports keyboard navigation and opens the preferred action first', () => {
    const onOpenHub = vi.fn();

    render(
      <SelectionContextMenu
        state={{
          context,
          selectedText: context.selectedText,
          position: { x: 20, y: 20 },
        }}
        onClose={() => {}}
        onOpenHub={onOpenHub}
      />,
    );

    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'Enter' });

    expect(onOpenHub).toHaveBeenCalledWith(context, 'chat', undefined);
  });

  it('shows disabled reason when the current selection is not eligible', () => {
    render(
      <SelectionContextMenu
        state={{
          context: null,
          selectedText: 'ab',
          position: { x: 20, y: 20 },
          disabledReason: 'Selection AI 仅在长度至少 3 且包含有效文本内容的选区上启用。',
        }}
        onClose={() => {}}
        onOpenHub={vi.fn()}
      />,
    );

    expect(screen.queryByText('当前未启用 Selection AI')).not.toBeNull();
    expect(screen.queryByText('Selection AI 仅在长度至少 3 且包含有效文本内容的选区上启用。')).not.toBeNull();
  });
});
