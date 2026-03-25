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

  it('enters source editing on double click and commits when focus leaves the cell', () => {
    const onUpdate = vi.fn();
    renderTableEditor({ onUpdate });

    fireEvent.doubleClick(screen.getByText('A1'));

    const input = screen.getByDisplayValue('A1');
    fireEvent.change(input, { target: { value: 'A1 updated' } });
    fireEvent.blur(input);

    expect(onUpdate).toHaveBeenCalledWith('| 标题 A | 标题 B |\n| --- | --- |\n| A1 updated | B1 |');
    expect(screen.queryByDisplayValue('A1 updated')).toBeNull();
  });

  it('removes the perimeter handle and action menu in the simplified editing mode', () => {
    const { container } = renderTableEditor();
    const wrapper = screen.getByRole('group', { name: 'Markdown table editor' });

    fireEvent.focus(wrapper);

    expect(screen.queryByRole('button', { name: '表格操作' })).toBeNull();
    expect(container.querySelector('.table-editor-perimeter-panel')).toBeNull();
  });
});
