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
  it('does not render the legacy full-width column toolbar labels', () => {
    const { container } = renderTableEditor();

    expect(screen.queryByText('列 1')).toBeNull();
    expect(screen.queryByText('列 2')).toBeNull();
    expect(container.querySelectorAll('.column-quick-actions.visible').length).toBe(1);
  });

  it('starts editing immediately when typing on the selected cell', () => {
    renderTableEditor();

    fireEvent.keyDown(screen.getByRole('group', { name: 'Markdown table editor' }), {
      key: 'x',
    });

    const input = screen.getByDisplayValue('x');
    expect(input.tagName).toBe('TEXTAREA');
  });

  it('moves the floating column controls with the active column', () => {
    const { container } = renderTableEditor();

    fireEvent.click(screen.getByText('标题 B'));

    expect(container.querySelectorAll('.column-quick-actions.visible').length).toBe(1);
    expect(screen.getByText('标题 B').closest('th')?.className).toContain('column-control-anchor');
    expect(screen.getByText('标题 A').closest('th')?.className).not.toContain('column-control-anchor');
  });
});
