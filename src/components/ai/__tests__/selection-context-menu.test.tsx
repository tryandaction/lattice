/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SelectionContextMenu } from '../selection-context-menu';
import { useSelectionAiStore } from '@/stores/selection-ai-store';

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    locale: "zh-CN",
    t: (key: string) => {
      const zh: Record<string, string> = {
        "ai.selection.menuAria": "选区 AI 菜单",
        "ai.selection.menuTitle": "选区 AI",
        "ai.selection.enterOpen": "Enter 打开",
        "ai.selection.preferred": "最近使用",
        "ai.selection.disabledTitle": "当前未启用 Selection AI",
        "ai.selection.noSelection": "尚未选中文本",
      };
      return zh[key] ?? key;
    },
  }),
}));

describe('SelectionContextMenu', () => {
  const context = {
    sourceKind: 'markdown' as const,
    paneId: 'pane-main' as const,
    fileName: 'notes.md',
    filePath: 'notes/notes.md',
    selectedText: 'Meaningful selected text',
    sourceLabel: 'notes.md · selection',
    evidenceRefs: [],
  };

  beforeEach(() => {
    useSelectionAiStore.setState({
      preferredMode: 'agent',
      recentPrompts: [],
    });
  });

  it('supports keyboard navigation and opens the next action after ArrowDown', () => {
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

    const menu = screen.getByRole('menu', { name: '选区 AI 菜单' });
    expect(screen.queryByText('最近使用')).not.toBeNull();

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
