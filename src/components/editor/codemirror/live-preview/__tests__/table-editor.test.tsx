/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen, within } from '@testing-library/react';
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
    ['Header A', 'Header B'],
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

    expect(screen.queryByText('Column 1')).toBeNull();
    expect(screen.queryByText('Column 2')).toBeNull();
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

    expect(onUpdate).toHaveBeenCalledWith('| Header A | Header B |\n| --- | --- |\n| A1 updated | B1 |');
    expect(screen.queryByDisplayValue('A1 updated')).toBeNull();
  });

  it('places the caret without selecting the whole cell when editing starts', () => {
    renderTableEditor();

    fireEvent.doubleClick(screen.getByText('A1'));

    const input = screen.getByDisplayValue('A1') as HTMLTextAreaElement;
    expect(input.selectionStart).toBe(input.value.length);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('preserves the active cell draft before applying structure menu actions', () => {
    const onUpdate = vi.fn();
    renderTableEditor({ onUpdate });

    fireEvent.doubleClick(screen.getByText('A1'));
    fireEvent.change(screen.getByDisplayValue('A1'), { target: { value: 'draft kept' } });

    const wrapper = screen.getByRole('group', { name: 'Markdown table editor' });
    fireEvent.mouseEnter(wrapper);
    fireEvent.click(screen.getByRole('button', { name: 'Column 2 actions' }));
    const panel = document.body.querySelector('.table-editor-perimeter-panel') as HTMLElement;
    fireEvent.click(within(panel).getByText('Move Left'));

    expect(onUpdate).toHaveBeenLastCalledWith('| Header B | Header A |\n| --- | --- |\n| B1 | draft kept |');
  });

  it('shows perimeter handles and column actions in a persistent portal panel', () => {
    const { container } = renderTableEditor();
    const wrapper = screen.getByRole('group', { name: 'Markdown table editor' });

    fireEvent.mouseEnter(wrapper);

    expect(screen.getByRole('button', { name: 'Table actions' })).toBeTruthy();
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Column 1 actions' }));
    expect(screen.getByText('Insert Right')).toBeTruthy();
    expect(container.querySelector('.table-editor-perimeter-panel')).toBeNull();
    expect(document.body.querySelector('.table-editor-perimeter-panel')).toBeTruthy();

    fireEvent.mouseLeave(wrapper);
    expect(screen.getByText('Insert Right')).toBeTruthy();
  });

  it('supports highlighting a selected cell from the table action menu', () => {
    const onUpdate = vi.fn();
    renderTableEditor({ onUpdate });

    fireEvent.click(screen.getByText('A1'));
    fireEvent.mouseEnter(screen.getByRole('group', { name: 'Markdown table editor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Table actions' }));
    fireEvent.click(screen.getByText('Highlight'));

    expect(onUpdate).toHaveBeenCalledWith('| Header A | Header B |\n| --- | --- |\n| ==A1== | B1 |');
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

    expect(writeText).toHaveBeenCalledWith('| Header A | Header B |\n| --- | --- |\n| A1 | B1 |');

    fireEvent.click(screen.getByRole('button', { name: 'Table actions' }));
    fireEvent.click(screen.getByText('Show Source'));

    expect(screen.getByLabelText('Markdown table source').textContent).toContain('| Header A | Header B |');
  });

  it('duplicates rows and moves columns from perimeter menus', () => {
    const onUpdate = vi.fn();
    renderTableEditor({ onUpdate });
    const wrapper = screen.getByRole('group', { name: 'Markdown table editor' });

    fireEvent.mouseEnter(wrapper);
    fireEvent.click(screen.getByRole('button', { name: 'Row 2 actions' }));
    fireEvent.click(screen.getByText('Duplicate Row'));

    expect(onUpdate).toHaveBeenLastCalledWith('| Header A | Header B |\n| --- | --- |\n| A1 | B1 |\n| A1 | B1 |');

    fireEvent.mouseEnter(wrapper);
    fireEvent.click(screen.getByRole('button', { name: 'Column 2 actions' }));
    fireEvent.click(screen.getByText('Move Left'));

    expect(onUpdate).toHaveBeenLastCalledWith('| Header B | Header A |\n| --- | --- |\n| B1 | A1 |\n| B1 | A1 |');
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
      expect(onUpdate).toHaveBeenLastCalledWith('| Header A | Header B |\n| --- | --- |\n| X1 | X2 |\n| Y1 | Y2 |');
    });
  });

  it('keeps display cell mouse presses inside the table widget selection model', () => {
    renderTableEditor();

    const mouseDown = createEvent.mouseDown(screen.getByText('A1'), { button: 0 });
    fireEvent(screen.getByText('A1'), mouseDown);

    expect(mouseDown.defaultPrevented).toBe(true);
    expect(screen.queryByDisplayValue('A1')).toBeNull();
  });

  it('resizes columns with a drag handle without entering cell edit mode', () => {
    renderTableEditor();
    const wrapper = screen.getByRole('group', { name: 'Markdown table editor' });

    fireEvent.mouseEnter(wrapper);
    const resizeHandle = screen.getByRole('separator', { name: 'Resize column 1' });

    fireEvent.pointerDown(resizeHandle, { pointerId: 1, clientX: 160 });
    expect(resizeHandle.classList.contains('is-resizing')).toBe(true);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 240 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 240 });

    const col = document.querySelector<HTMLTableColElement>('col[data-table-col-width="0"]');
    expect(col?.style.width).toBe('152px');
    expect(screen.queryByDisplayValue('A1')).toBeNull();
  });
});
