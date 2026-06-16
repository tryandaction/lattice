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
});
