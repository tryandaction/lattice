/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PdfAnnotationSidebar } from '../pdf-annotation-sidebar';

describe('PdfAnnotationSidebar', () => {
  it('shows an annotation loading state instead of the empty state while annotations are loading', () => {
    render(
      <PdfAnnotationSidebar
        annotations={[]}
        isLoading
        selectedId={null}
        onSelect={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(screen.getByText('正在读取批注...')).toBeTruthy();
    expect(screen.queryByText('暂无批注')).toBeNull();
  });

  it('shows AI annotation tags and filters annotations by tag', () => {
    render(
      <PdfAnnotationSidebar
        annotations={[
          {
            id: 'ann-ai',
            target: {
              type: 'pdf',
              page: 7,
              rects: [{ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.12 }],
              textQuote: {
                exact: 'AI selected exact quote',
                prefix: '',
                suffix: '',
                source: 'pdfjs-text-model',
                confidence: 'exact',
              },
            },
            style: { type: 'highlight', color: '#FFD400' },
            content: 'AI selected exact quote',
            tags: ['AI', 'AI批注', 'key-claim'],
            author: 'lattice-ai',
            createdAt: 1,
          },
          {
            id: 'ann-human',
            target: {
              type: 'pdf',
              page: 8,
              rects: [{ x1: 0.1, y1: 0.2, x2: 0.2, y2: 0.22 }],
              textQuote: {
                exact: 'Human selected exact quote',
                prefix: '',
                suffix: '',
                source: 'pdfjs-text-model',
                confidence: 'exact',
              },
            },
            style: { type: 'highlight', color: '#FFD400' },
            content: 'Human selected exact quote',
            tags: ['human'],
            author: 'user',
            createdAt: 2,
          },
        ]}
        selectedId={null}
        onSelect={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(screen.getAllByText('AI批注').length).toBeGreaterThan(0);
    expect(screen.getByText('AI selected exact quote')).toBeTruthy();
    expect(screen.getByText('Human selected exact quote')).toBeTruthy();

    const aiTagButtons = screen.getAllByText('AI批注');
    fireEvent.click(aiTagButtons[aiTagButtons.length - 1]);

    expect(screen.getByText('AI selected exact quote')).toBeTruthy();
    expect(screen.queryByText('Human selected exact quote')).toBeNull();
  });

  it('filters legacy annotation colors through the same resolved color used by the PDF highlight UI', () => {
    const handleViewStateChange = vi.fn();

    render(
      <PdfAnnotationSidebar
        annotations={[
          {
            id: 'ann-legacy-yellow',
            target: {
              type: 'pdf',
              page: 2,
              rects: [{ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.12 }],
              textQuote: {
                exact: 'Legacy yellow quote',
                prefix: '',
                suffix: '',
                source: 'pdfjs-text-model',
                confidence: 'exact',
              },
            },
            style: { type: 'highlight', color: '#FFEB3B' },
            content: 'Legacy yellow quote',
            author: 'user',
            createdAt: 1,
          },
          {
            id: 'ann-blue',
            target: {
              type: 'pdf',
              page: 3,
              rects: [{ x1: 0.1, y1: 0.2, x2: 0.2, y2: 0.22 }],
              textQuote: {
                exact: 'Blue quote',
                prefix: '',
                suffix: '',
                source: 'pdfjs-text-model',
                confidence: 'exact',
              },
            },
            style: { type: 'highlight', color: '#2EA8E5' },
            content: 'Blue quote',
            author: 'user',
            createdAt: 2,
          },
        ]}
        selectedId={null}
        onSelect={() => undefined}
        onDelete={() => undefined}
        viewState={{
          searchQuery: '',
          typeFilter: 'all',
          colorFilter: '#FFD400',
          tagFilter: 'all',
        }}
        onViewStateChange={handleViewStateChange}
      />,
    );

    expect(screen.getByText('Legacy yellow quote')).toBeTruthy();
    expect(screen.queryByText('Blue quote')).toBeNull();
    expect(handleViewStateChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('颜色: 蓝色'));

    expect(handleViewStateChange).toHaveBeenCalledWith({
      searchQuery: '',
      typeFilter: 'all',
      colorFilter: '#2EA8E5',
      tagFilter: 'all',
    });
  });

  it('renders long quote and comment content without internal height clamps', () => {
    render(
      <PdfAnnotationSidebar
        annotations={[
          {
            id: 'ann-long',
            target: {
              type: 'pdf',
              page: 2,
              rects: [{ x1: 0.1, y1: 0.1, x2: 0.8, y2: 0.35 }],
              textQuote: {
                exact: 'Long selected quote line one.\nLong selected quote line two.\nLong selected quote line three.',
                prefix: '',
                suffix: '',
                source: 'pdfjs-text-model',
                confidence: 'exact',
              },
            },
            style: { type: 'highlight', color: '#FFD400' },
            content: 'Long selected quote line one.\nLong selected quote line two.\nLong selected quote line three.',
            comment: '| Symbol | Meaning | Notes |\n| --- | --- | --- |\n| T1 | relaxation | long table comment |',
            author: 'user',
            createdAt: 1,
          },
        ]}
        selectedId={null}
        onSelect={() => undefined}
        onDelete={() => undefined}
      />,
    );

    const quote = screen.getByTestId('pdf-annotation-quote-ann-long');
    expect(quote.className).toContain('whitespace-pre-wrap');
    expect(quote.className).not.toContain('line-clamp');

    const comment = screen.getByTestId('pdf-annotation-comment-ann-long');
    expect(comment.className).toContain('overflow-x-auto');
    expect(comment.className).not.toContain('max-h');
    expect(comment.className).not.toContain('overflow-y-auto');
    expect(screen.getByText('relaxation')).toBeTruthy();
  });

  it('keeps long comments unconstrained after entering edit mode', () => {
    render(
      <PdfAnnotationSidebar
        annotations={[
          {
            id: 'ann-edit-long',
            target: {
              type: 'pdf',
              page: 3,
              rects: [{ x1: 0.1, y1: 0.1, x2: 0.8, y2: 0.35 }],
              textQuote: {
                exact: 'Editable quote',
                prefix: '',
                suffix: '',
                source: 'pdfjs-text-model',
                confidence: 'exact',
              },
            },
            style: { type: 'highlight', color: '#D85BEA' },
            content: 'Editable quote',
            comment: [
              '现在计算末态与理想末态的重叠。',
              '',
              '$$ \\psi(T)\\rangle = U_0(T)\\psi_0\\rangle + \\epsilon U_1(T)\\psi_0\\rangle $$',
              '',
              '| 符号 | 中文名称 | 物理本质 |',
              '| --- | --- | --- |',
              '| T | 演化时间 | 门操作时间 |',
            ].join('\n'),
            author: 'user',
            createdAt: 1,
          },
        ]}
        selectedId={null}
        onSelect={() => undefined}
        onDelete={() => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId('pdf-annotation-comment-ann-edit-long'));

    const editor = screen.getByTestId('pdf-annotation-comment-editor-ann-edit-long') as HTMLTextAreaElement;
    expect(editor.rows).toBe(6);
    expect(editor.className).toContain('min-h-[120px]');
    expect(editor.className).toContain('resize-y');
    expect(editor.className).toContain('overflow-hidden');
    expect(editor.className).not.toContain('resize-none');
    expect(editor.className).not.toContain('max-h');
    expect(editor.value).toContain('| 符号 | 中文名称 | 物理本质 |');
  });
});
