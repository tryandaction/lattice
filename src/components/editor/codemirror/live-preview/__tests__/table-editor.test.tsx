/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import type { ComponentProps } from 'react';
import { TableEditor, type TableAlignment } from '../table-editor';

class MockResizeObserver {
  observe() {}
  disconnect() {}
}

globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

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
  it('does not render the legacy full-width toolbar labels or default selected cell state', () => {
    const { container } = renderTableEditor();

    expect(screen.queryByText('列 1')).toBeNull();
    expect(screen.queryByText('列 2')).toBeNull();
    expect(container.querySelectorAll('.selected').length).toBe(0);
    expect(container.querySelectorAll('.row-toolbar').length).toBe(0);
    expect(container.querySelector('.table-editor-perimeter-panel')).toBeNull();
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

  it('shows perimeter handles and column actions on hover', () => {
    const { container } = renderTableEditor();
    const wrapper = screen.getByRole('group', { name: 'Markdown table editor' });

    fireEvent.mouseEnter(wrapper);

    expect(screen.getByRole('button', { name: 'Table actions' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Column 1 actions' }));
    expect(screen.getByText('Insert Right')).toBeTruthy();
    expect(container.querySelector('.table-editor-perimeter-panel')).toBeTruthy();
  });

  it('supports highlighting a selected cell from the table action menu', () => {
    const onUpdate = vi.fn();
    renderTableEditor({ onUpdate });

    fireEvent.click(screen.getByText('A1'));
    fireEvent.mouseEnter(screen.getByRole('group', { name: 'Markdown table editor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Table actions' }));
    fireEvent.click(screen.getByText('Highlight'));

    expect(onUpdate).toHaveBeenCalledWith('| 标题 A | 标题 B |\n| --- | --- |\n| ==A1== | B1 |');
  });

  it('copies standard markdown and can reveal table source from the table action menu', () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderTableEditor();
    const wrapper = screen.getByRole('group', { name: 'Markdown table editor' });

    fireEvent.mouseEnter(wrapper);
    fireEvent.click(screen.getByRole('button', { name: 'Table actions' }));
    fireEvent.click(screen.getByText('Copy Markdown'));

    expect(writeText).toHaveBeenCalledWith('| 标题 A | 标题 B |\n| --- | --- |\n| A1 | B1 |');

    fireEvent.click(screen.getByRole('button', { name: 'Table actions' }));
    fireEvent.click(screen.getByText('Show Source'));

    expect(screen.getByLabelText('Markdown table source').textContent).toContain('| 标题 A | 标题 B |');
  });

  it('duplicates rows and moves columns from perimeter menus', () => {
    const onUpdate = vi.fn();
    renderTableEditor({ onUpdate });
    const wrapper = screen.getByRole('group', { name: 'Markdown table editor' });

    fireEvent.mouseEnter(wrapper);
    fireEvent.click(screen.getByRole('button', { name: 'Row 2 actions' }));
    fireEvent.click(screen.getByText('Duplicate Row'));

    expect(onUpdate).toHaveBeenLastCalledWith('| 标题 A | 标题 B |\n| --- | --- |\n| A1 | B1 |\n| A1 | B1 |');

    fireEvent.mouseEnter(wrapper);
    fireEvent.click(screen.getByRole('button', { name: 'Column 2 actions' }));
    fireEvent.click(screen.getByText('Move Left'));

    expect(onUpdate).toHaveBeenLastCalledWith('| 标题 B | 标题 A |\n| --- | --- |\n| B1 | A1 |\n| B1 | A1 |');
  });

  it('pastes clipboard cell matrices from the table action menu', async () => {
    const onUpdate = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: vi.fn().mockResolvedValue('X1\tX2\nY1\tY2') },
      configurable: true,
    });

    renderTableEditor({ onUpdate });
    const wrapper = screen.getByRole('group', { name: 'Markdown table editor' });

    fireEvent.click(screen.getByText('A1'));
    fireEvent.mouseEnter(wrapper);
    fireEvent.click(screen.getByRole('button', { name: 'Table actions' }));
    fireEvent.click(screen.getByText('Paste Cells'));

    await vi.waitFor(() => {
      expect(onUpdate).toHaveBeenLastCalledWith('| 标题 A | 标题 B |\n| --- | --- |\n| X1 | X2 |\n| Y1 | Y2 |');
    });
  });
});
