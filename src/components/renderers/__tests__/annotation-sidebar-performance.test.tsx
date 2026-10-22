/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { AnnotationItem } from '@/types/universal-annotation';
import { PdfAnnotationSidebar } from '../pdf-annotation-sidebar';
import { UniversalAnnotationSidebar } from '../universal-annotation-sidebar';

const markdownRender = vi.hoisted(() => vi.fn());
vi.mock('../annotation-markdown-renderer', () => ({
  AnnotationMarkdownRenderer: ({ content }: { content: string }) => {
    markdownRender(content);
    return <div>{content}</div>;
  },
}));
vi.mock('@/components/editor/codemirror/live-preview', () => ({ LivePreviewEditor: () => null }));

function annotations(count: number): AnnotationItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `annotation-${index}`,
    target: { type: 'pdf', page: 1, rects: [{ x1: 0.1, y1: index / count, x2: 0.9, y2: (index + 1) / count }] },
    style: { type: 'highlight', color: '#FFD400' },
    content: `Exact quote ${index}`,
    comment: `**Scientific note ${index}**`,
    author: 'user',
    createdAt: index,
  }));
}

describe('annotation sidebar performance and complete access', () => {
  beforeEach(() => {
    markdownRender.mockClear();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('defers offscreen Markdown parsing without removing its text or navigation target', () => {
    let notify: IntersectionObserverCallback | undefined;
    const observed = new Set<Element>();
    const observerCreated = vi.fn();
    const disconnected = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { notify = callback; observerCreated(); }
      observe(element: Element) { observed.add(element); }
      unobserve(element: Element) { observed.delete(element); }
      disconnect() { observed.clear(); disconnected(); }
    });
    const items = annotations(500);
    const { container, unmount } = render(<PdfAnnotationSidebar annotations={items} selectedId={null} onSelect={() => undefined} onDelete={() => undefined} />);
    expect(container.querySelectorAll('[data-annotation-id]')).toHaveLength(500);
    expect(container.textContent).toContain('Scientific note 499');
    expect(markdownRender.mock.calls.length).toBeLessThanOrEqual(12);
    expect(observerCreated).toHaveBeenCalledTimes(1);
    const last = container.querySelector('[data-annotation-id="annotation-499"]')!;
    const target = [...observed].find((element) => last.contains(element));
    expect(target).toBeDefined();
    act(() => notify?.([{ target, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(markdownRender).toHaveBeenCalledWith(items[499].comment);
    act(() => container.querySelector<HTMLElement>('[data-annotation-id="annotation-498"]')!.focus());
    expect(markdownRender).toHaveBeenCalledWith(items[498].comment);
    unmount();
    expect(observed.size).toBe(0);
    expect(disconnected).toHaveBeenCalledTimes(1);
  });

  it.each(['plain', 'rich'] as const)('preserves all 500 complex quote strings and defers only %s comments', (commentKind) => {
    let notify: IntersectionObserverCallback | undefined;
    const observed = new Set<Element>();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { notify = callback; }
      observe(element: Element) { observed.add(element); }
      unobserve(element: Element) { observed.delete(element); }
      disconnect() { observed.clear(); }
    });
    const items = annotations(500).map((annotation, index) => ({
      ...annotation,
      content: `Evidence ${index}: **measured result** with $\\alpha = ${index}$.`,
      comment: commentKind === 'plain' ? `Observation ${index}.`
        : `## Observation ${index}\n\n**Measured response** $\\beta = ${index}$\n\n| Parameter | Value |\n| --- | --- |\n| Energy | ${index} |`,
    }));
    const { container } = render(<PdfAnnotationSidebar annotations={items} selectedId={null} onSelect={() => undefined} onDelete={() => undefined} />);
    expect(container.querySelectorAll('[data-annotation-id]')).toHaveLength(500);
    const quoteTextById = new Map(Array.from(container.querySelectorAll('[data-testid^="pdf-annotation-quote-"]'))
      .map((element) => [element.getAttribute('data-testid'), element.textContent]));
    for (const item of items) {
      // PDF quotes are canonical source text, not Markdown authored by the user.
      expect(quoteTextById.get(`pdf-annotation-quote-${item.id}`)).toBe(item.content);
    }
    expect(markdownRender).toHaveBeenCalledTimes(12);
    expect(markdownRender.mock.calls.every(([content]) => items.slice(0, 12).some((item) => item.comment === content))).toBe(true);
    expect(markdownRender.mock.calls.some(([content]) => String(content).startsWith('Evidence '))).toBe(false);
    const lastCard = container.querySelector('[data-annotation-id="annotation-499"]')!;
    expect(lastCard.textContent).toContain(items[499].comment);
    const target = [...observed].find((element) => lastCard.contains(element));
    expect(target).toBeDefined();
    act(() => notify?.([{ target, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(markdownRender).toHaveBeenCalledTimes(13);
    expect(markdownRender).toHaveBeenLastCalledWith(items[499].comment);
  });

  it('does not reparse unchanged PDF Markdown when selection and parent callbacks change', () => {
    const items = annotations(500);
    const firstSelect = vi.fn();
    const nextSelect = vi.fn();
    const { container, rerender } = render(<PdfAnnotationSidebar annotations={items} selectedId={items[0].id} onSelect={firstSelect} onDelete={() => undefined} />);
    expect(container.querySelectorAll('[data-annotation-id]')).toHaveLength(500);
    expect(markdownRender).toHaveBeenCalledTimes(500);
    markdownRender.mockClear();
    rerender(<PdfAnnotationSidebar annotations={items} selectedId={items[499].id} onSelect={nextSelect} onDelete={() => undefined} />);
    expect(markdownRender).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('[data-annotation-id="annotation-499"]')!);
    expect(nextSelect).toHaveBeenCalledWith(items[499]);
    expect(firstSelect).not.toHaveBeenCalled();
  });

  it('retains every Universal annotation beyond 80 and makes the last item actionable', () => {
    const items = annotations(150);
    const onAnnotationClick = vi.fn();
    const { container, rerender } = render(<UniversalAnnotationSidebar annotations={items} selectedAnnotationId={items[0].id} onAnnotationClick={onAnnotationClick} />);
    expect(container.querySelectorAll('[data-annotation-id]')).toHaveLength(150);
    markdownRender.mockClear();
    rerender(<UniversalAnnotationSidebar annotations={items} selectedAnnotationId={items[149].id} onAnnotationClick={onAnnotationClick} />);
    expect(markdownRender).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('[data-annotation-id="annotation-149"]')!);
    expect(onAnnotationClick).toHaveBeenCalledWith(items[149]);
  });

  it('updates a changed comment without reparsing the other annotations', () => {
    const items = annotations(150);
    const { rerender } = render(<PdfAnnotationSidebar annotations={items} selectedId={null} onSelect={() => undefined} onDelete={() => undefined} />);
    markdownRender.mockClear();
    const updated = items.map((item, index) => index === 149 ? { ...item, comment: '**Revised scientific interpretation**' } : item);
    rerender(<PdfAnnotationSidebar annotations={updated} selectedId={null} onSelect={() => undefined} onDelete={() => undefined} />);
    expect(markdownRender).toHaveBeenCalledTimes(1);
    expect(screen.getByText('**Revised scientific interpretation**')).toBeTruthy();
  });

  it('finds a late PDF annotation by search and navigates cards with the keyboard', () => {
    const items = annotations(150);
    const onSelect = vi.fn();
    const { container } = render(<PdfAnnotationSidebar annotations={items} selectedId={null} onSelect={onSelect} onDelete={() => undefined} />);
    const first = container.querySelector<HTMLElement>('[data-annotation-id="annotation-0"]')!;
    first.focus();
    fireEvent.keyDown(first, { key: 'End' });
    const last = container.querySelector<HTMLElement>('[data-annotation-id="annotation-149"]')!;
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(items[149]);
    fireEvent.change(screen.getByPlaceholderText('搜索批注...'), { target: { value: 'Exact quote 149' } });
    expect(container.querySelectorAll('[data-annotation-id]')).toHaveLength(1);
    expect(screen.getByText('Exact quote 149')).toBeTruthy();
  });

  it('searches the whole Universal group and reveals an external selection in a collapsed group', () => {
    const items = annotations(150);
    const onAnnotationClick = vi.fn();
    const { container, rerender } = render(<UniversalAnnotationSidebar annotations={items} selectedAnnotationId={null} onAnnotationClick={onAnnotationClick} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Exact quote 149' } });
    expect(container.querySelectorAll('[data-annotation-id]')).toHaveLength(1);
    expect(container.querySelector('[data-annotation-id="annotation-149"]')).not.toBeNull();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    const first = container.querySelector<HTMLElement>('[data-annotation-id="annotation-0"]')!;
    first.focus();
    fireEvent.keyDown(first, { key: 'End' });
    expect(document.activeElement?.getAttribute('data-annotation-id')).toBe(items[149].id);
    fireEvent.click(screen.getByRole('button', { expanded: true }));
    expect(container.querySelectorAll('[data-annotation-id]')).toHaveLength(0);
    rerender(<UniversalAnnotationSidebar annotations={items} selectedAnnotationId={items[149].id} onAnnotationClick={onAnnotationClick} />);
    expect(container.querySelectorAll('[data-annotation-id]')).toHaveLength(150);
    expect(container.querySelector('[data-annotation-id="annotation-149"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('reveals an externally selected PDF annotation hidden by an old search', () => {
    const items = annotations(150);
    const { container, rerender } = render(<PdfAnnotationSidebar annotations={items} selectedId={null} onSelect={() => undefined} onDelete={() => undefined} />);
    fireEvent.change(screen.getByPlaceholderText('搜索批注...'), { target: { value: 'Exact quote 0' } });
    expect(container.querySelectorAll('[data-annotation-id]')).toHaveLength(1);
    rerender(<PdfAnnotationSidebar annotations={items} selectedId={items[149].id} onSelect={() => undefined} onDelete={() => undefined} />);
    expect(container.querySelector('[data-annotation-id="annotation-149"]')?.getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByPlaceholderText('搜索批注...') as HTMLInputElement).value).toBe('');
  });

  it('reveals a restored selection after asynchronous annotation hydration', () => {
    const items = annotations(150);
    const props = { selectedId: items[149].id, onSelect: vi.fn(), onDelete: vi.fn(), viewState: { searchQuery: 'Exact quote 0', typeFilter: 'all' as const, colorFilter: 'all', tagFilter: 'all' } };
    const { container, rerender } = render(<PdfAnnotationSidebar {...props} annotations={[]} isLoading />);
    rerender(<PdfAnnotationSidebar {...props} annotations={items} />);
    expect(container.querySelector('[data-annotation-id="annotation-149"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('[data-annotation-id]')).toHaveLength(150);
  });

  it('scrolls the selected PDF card inside its own pane, even with duplicate IDs in another pane', () => {
    const items = annotations(2);
    const first = render(<PdfAnnotationSidebar annotations={items} selectedId={null} onSelect={() => undefined} onDelete={() => undefined} />);
    const second = render(<PdfAnnotationSidebar annotations={items} selectedId={null} onSelect={() => undefined} onDelete={() => undefined} />);
    const firstCard = first.container.querySelector<HTMLElement>('[data-annotation-id="annotation-1"]')!;
    const secondCard = second.container.querySelector<HTMLElement>('[data-annotation-id="annotation-1"]')!;
    firstCard.scrollIntoView = vi.fn();
    secondCard.scrollIntoView = vi.fn();
    second.rerender(<PdfAnnotationSidebar annotations={items} selectedId={items[1].id} onSelect={() => undefined} onDelete={() => undefined} />);
    expect(secondCard.scrollIntoView).toHaveBeenCalled();
    expect(firstCard.scrollIntoView).not.toHaveBeenCalled();
  });
});
