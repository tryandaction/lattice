/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import type { ComponentProps } from 'react';
import { TableEditor, type TableAlignment } from '../table-editor';

function createViewStub(): EditorView {
  return {
    state: {
      doc: {
        length: 128,
      },
    },
    dispatch: vi.fn(),
  } as unknown as EditorView;
}

function renderTableEditor(overrides?: Partial<ComponentProps<typeof TableEditor>>) {
  const rows = [
    ['标题 A', '标题 B'],
    ['A1', 'B1'],
  ];
  const alignments: TableAlignment[] = [null, null];

  return render(
    <TableEditor
      rows={rows}
      hasHeader
      alignments={alignments}
      from={0}
      to={24}
      view={createViewStub()}
      onUpdate={vi.fn()}
      {...overrides}
    />
  );
}

describe('TableEditor', () => {
  it('does not render the legacy full-width column toolbar labels or default active cell state', () => {
    const { container } = renderTableEditor();

    expect(screen.queryByText('列 1')).toBeNull();
    expect(screen.queryByText('列 2')).toBeNull();
    expect(container.querySelectorAll('.selected').length).toBe(0);
    expect(container.querySelectorAll('.row-toolbar').length).toBe(0);
    expect(screen.queryByRole('button', { name: '表格操作' })).toBeNull();
  });

  it('starts editing immediately when typing even without an initial selected cell', () => {
    renderTableEditor();

    fireEvent.keyDown(screen.getByRole('group', { name: 'Markdown table editor' }), {
      key: 'x',
    });

    const input = screen.getByDisplayValue('x');
    expect(input.tagName).toBe('TEXTAREA');
  });

  it('opens an external perimeter action panel instead of rendering controls inside cells', () => {
    const { container } = renderTableEditor();
    fireEvent.mouseEnter(screen.getByRole('group', { name: 'Markdown table editor' }));

    fireEvent.click(screen.getByRole('button', { name: '表格操作' }));

    expect(container.querySelector('.table-editor-perimeter-panel')).toBeTruthy();
    expect(container.querySelectorAll('.column-quick-actions').length).toBe(0);
    expect(screen.getByText('右侧插列')).toBeTruthy();
    expect(screen.getByText('删除列')).toBeTruthy();
  });

  it('shows the perimeter handle on keyboard focus and opens the menu with Shift+F10', () => {
    renderTableEditor();

    const wrapper = screen.getByRole('group', { name: 'Markdown table editor' });
    fireEvent.focus(wrapper);

    expect(screen.getByRole('button', { name: '表格操作' })).toBeTruthy();

    fireEvent.keyDown(wrapper, { key: 'F10', shiftKey: true });

    expect(screen.getByRole('menu', { name: '表格操作菜单' })).toBeTruthy();
    expect(screen.getByText('对齐：无')).toBeTruthy();
  });
});
