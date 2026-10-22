/**
 * @vitest-environment jsdom
 */

import React, { useEffect, useImperativeHandle, useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PdfAnnotationSidebar } from '../pdf-annotation-sidebar';

vi.mock('@/components/editor/codemirror/live-preview', () => ({
  LivePreviewEditor: ({ content, onChange, fileId, className, onReady, ref }: {
    content: string;
    onChange: (content: string) => void;
    fileId?: string;
    className?: string;
    onReady?: () => void;
    ref?: React.Ref<{ focus: () => void }>;
  }) => {
    const inputRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);
    useEffect(() => { onReady?.(); }, [onReady]);
    return (
    <div data-testid={`mock-live-preview-editor-${fileId ?? 'comment'}`} className={className}>
      <textarea ref={inputRef} aria-label="Comment markdown" value={content} onChange={event => onChange(event.target.value)} />
      <div data-testid={`mock-live-preview-content-${fileId ?? 'comment'}`}>{content}</div>
      <button type="button" onClick={() => onChange('| Symbol | Meaning |\n| --- | --- |\n| H | Hamiltonian |')}>
        edit live markdown
      </button>
    </div>
    );
  },
}));

describe('PdfAnnotationSidebar', () => {
  const editableAnnotation = {
    id: 'editable', target: { type: 'pdf' as const, page: 1, rects: [{ x1: 0.1, y1: 0.1, x2: 0.8, y2: 0.2 }] },
    style: { type: 'highlight' as const, color: '#FFD400' }, content: 'Source quote', comment: '**My comment**', author: 'user', createdAt: 1,
  };

  it('offers formula OCR from the existing menu for a scanned area without text', async () => {
    const recognize = vi.fn(async () => {});
    render(<PdfAnnotationSidebar annotations={[{ ...editableAnnotation, content: undefined, comment: undefined, style: { type: 'area', color: '#FFD400' } }]} selectedId={null} onSelect={() => {}} onDelete={() => {}} onRecognizeFormula={recognize} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /公式/ }));
    await waitFor(() => expect(recognize).toHaveBeenCalledWith('editable'));
  });

  it('shows the collaborator nickname without changing the annotation author identity', () => {
    const annotation = { ...editableAnnotation, author: 'member-123', authorDisplayName: 'Old nickname' };
    const onSelect = vi.fn();
    render(<PdfAnnotationSidebar annotations={[annotation]} authorNames={{ 'member-123': '小林' }} selectedId={null} onSelect={onSelect} onDelete={() => {}} />);
    expect(screen.getByTitle('批注人：小林')).toBeTruthy();
    fireEvent.click(screen.getByText('Source quote'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ author: 'member-123' }));
  });

  it.each(['user', 'lattice-ai'])('focuses and saves a %s comment after clicking rendered nested markdown', async (author) => {
    const onSelect = vi.fn();
    const onUpdateComment = vi.fn();
    render(<PdfAnnotationSidebar annotations={[{ ...editableAnnotation, author }]} selectedId={null} onSelect={onSelect} onDelete={() => {}} onUpdateComment={onUpdateComment} />);
    fireEvent.click(screen.getByText('My comment'));
    const input = screen.getByRole('textbox', { name: 'Comment markdown' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: 'Updated comment' } });
    fireEvent.click(screen.getByText('保存'));
    expect(onUpdateComment).toHaveBeenCalledWith('editable', 'Updated comment');
    expect(onUpdateComment).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('provides a keyboard-accessible edit action for a link-only comment', async () => {
    const onSelect = vi.fn();
    render(<PdfAnnotationSidebar annotations={[{ ...editableAnnotation, comment: '[reference](https://example.com)' }]} selectedId={null} onSelect={onSelect} onDelete={() => {}} onUpdateComment={() => {}} />);
    const more = screen.getByRole('button', { name: '更多操作' });
    more.focus();
    fireEvent.click(more);
    fireEvent.click(within(screen.getByRole('menu')).getByText('添加评论'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Comment markdown' })));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('取消'));
    expect(screen.getByRole('link', { name: 'reference' })).toBeTruthy();
  });

  it('opens the latest saved comment from the context menu', () => {
    const props = { selectedId: null, onSelect: () => {}, onDelete: () => {}, onUpdateComment: () => {} };
    const { rerender, container } = render(<PdfAnnotationSidebar {...props} annotations={[editableAnnotation]} />);
    rerender(<PdfAnnotationSidebar {...props} annotations={[{ ...editableAnnotation, comment: 'Latest external revision' }]} />);
    fireEvent.contextMenu(container.querySelector('[data-annotation-id="editable"]')!);
    fireEvent.click(screen.getByText('添加评论'));
    expect((screen.getByRole('textbox', { name: 'Comment markdown' }) as HTMLTextAreaElement).value).toBe('Latest external revision');
  });

  it('opens the original three-dot menu outside contained rows and keeps inside clicks active', () => {
    const onSelect = vi.fn();
    const onUpdateColor = vi.fn();
    const { container } = render(<PdfAnnotationSidebar annotations={[editableAnnotation]} selectedId={null} onSelect={onSelect} onDelete={() => {}} onUpdateColor={onUpdateColor} />);
    const trigger = screen.getByRole('button', { name: '更多操作' });
    fireEvent.mouseDown(trigger);
    fireEvent.mouseUp(trigger);
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu');
    // A fixed menu inside content-visibility rows is positioned and clipped by the row.
    expect(container.contains(menu)).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const color = within(menu).getByTitle('红色');
    fireEvent.mouseDown(color);
    expect(screen.getByRole('menu')).toBe(menu);
    fireEvent.mouseUp(color);
    fireEvent.click(color);
    expect(onUpdateColor).toHaveBeenCalledExactlyOnceWith('editable', '#FF6666');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes with Escape and outside pointer clicks and returns keyboard focus to the original trigger', () => {
    render(<PdfAnnotationSidebar annotations={[editableAnnotation]} selectedId={null} onSelect={() => {}} onDelete={() => {}} />);
    const trigger = screen.getByRole('button', { name: '更多操作' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it.each(['underline', 'copy', 'delete'] as const)('runs the %s menu action exactly once without selecting the annotation', (action) => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const onConvertToUnderline = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<PdfAnnotationSidebar annotations={[editableAnnotation]} selectedId={null} onSelect={onSelect} onDelete={onDelete} onConvertToUnderline={onConvertToUnderline} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    const menu = screen.getByRole('menu');
    const label = { underline: '转换为下划线', copy: '复制文本', delete: '删除' }[action];
    const item = within(menu).getByText(label);
    fireEvent.mouseDown(item);
    fireEvent.mouseUp(item);
    fireEvent.click(item);
    expect(onDelete).toHaveBeenCalledTimes(action === 'delete' ? 1 : 0);
    expect(onConvertToUnderline).toHaveBeenCalledTimes(action === 'underline' ? 1 : 0);
    expect(writeText).toHaveBeenCalledTimes(action === 'copy' ? 1 : 0);
    if (action === 'copy') expect(writeText).toHaveBeenCalledWith('Source quote');
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });
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

  it('uses the markdown live preview editor directly when editing long comments', () => {
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

    expect(screen.queryByTestId('pdf-annotation-comment-editor-ann-edit-long')).toBeNull();
    expect(screen.queryByTestId('pdf-annotation-comment-live-preview-ann-edit-long')).toBeNull();
    expect(screen.getByTestId('mock-live-preview-editor-pdf-comment-ann-edit-long').className)
      .toContain('pdf-annotation-comment-editor');
    expect(screen.getByTestId('mock-live-preview-editor-pdf-comment-ann-edit-long').className)
      .toContain('text-xs');
    expect(screen.getByTestId('mock-live-preview-content-pdf-comment-ann-edit-long').textContent)
      .toContain('| 符号 | 中文名称 | 物理本质 |');
  });

  it('saves comment edits from the shared markdown live preview editor', () => {
    const handleUpdateComment = vi.fn();
    render(
      <PdfAnnotationSidebar
        annotations={[
          {
            id: 'ann-live-comment',
            target: {
              type: 'pdf',
              page: 4,
              rects: [{ x1: 0.1, y1: 0.1, x2: 0.8, y2: 0.18 }],
              textQuote: {
                exact: 'Editable quote',
                prefix: '',
                suffix: '',
                source: 'pdfjs-text-model',
                confidence: 'exact',
              },
            },
            style: { type: 'highlight', color: '#FFD400' },
            content: 'Editable quote',
            comment: '**initial**',
            author: 'user',
            createdAt: 1,
          },
        ]}
        selectedId={null}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onUpdateComment={handleUpdateComment}
      />,
    );

    fireEvent.click(screen.getByTestId('pdf-annotation-comment-ann-live-comment'));
    fireEvent.click(screen.getByText('edit live markdown'));

    expect(screen.queryByTestId('pdf-annotation-comment-editor-ann-live-comment')).toBeNull();
    expect(screen.queryByTestId('pdf-annotation-comment-live-preview-ann-live-comment')).toBeNull();
    expect(screen.getByTestId('mock-live-preview-content-pdf-comment-ann-live-comment').textContent).toContain('Hamiltonian');

    fireEvent.click(screen.getByText('保存'));

    expect(handleUpdateComment).toHaveBeenCalledWith(
      'ann-live-comment',
      '| Symbol | Meaning |\n| --- | --- |\n| H | Hamiltonian |',
    );
    expect(screen.queryByTestId('mock-live-preview-editor-pdf-comment-ann-live-comment')).toBeNull();
    expect(screen.getByTestId('pdf-annotation-comment-ann-live-comment').textContent).toContain('Hamiltonian');
    expect(screen.getByTestId('pdf-annotation-comment-ann-live-comment').className).toContain('text-[11px]');
  });
});
