/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PDFHighlighterAdapter } from '../pdf-highlighter-adapter';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useContentCacheStore } from '@/stores/content-cache-store';

const {
  inkStoreState,
  useAnnotationSystemMock,
  useObjectUrlMock,
  useInkAnnotationStoreMock,
} = vi.hoisted(() => {
  const state = {
    currentStyle: { color: '#ffeb3b', width: 2 },
    setCurrentStyle: vi.fn(),
    canUndo: vi.fn(() => false),
    undo: vi.fn(),
    canRedo: vi.fn(() => false),
    redo: vi.fn(),
  };

  return {
    inkStoreState: state,
    useAnnotationSystemMock: vi.fn(),
    useObjectUrlMock: vi.fn((_input?: unknown) => 'blob:pdf'),
    useInkAnnotationStoreMock: Object.assign(
      (selector?: (store: typeof state) => unknown) => selector ? selector(state) : state,
      {
        getState: () => state,
      },
    ),
  };
});

vi.mock('react-pdf-highlighter', async () => {
  const ReactModule = await import('react');

  return {
    PdfLoader: ({ children }: { children: (pdfDocument: object) => React.ReactNode }) => (
      <div data-testid="mock-pdf-loader">{children({})}</div>
    ),
    Popup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    PdfHighlighter: ReactModule.forwardRef(function MockPdfHighlighter(
      { pdfScaleValue }: { pdfScaleValue: string },
      ref: React.ForwardedRef<{ viewer: { container: HTMLDivElement | null }; handleScaleValue: () => void }>,
    ) {
      const viewerRef = ReactModule.useRef<HTMLDivElement>(null);
      const apiRef = ReactModule.useRef({
        viewer: { container: null as HTMLDivElement | null },
        handleScaleValue: vi.fn(),
      });

      ReactModule.useEffect(() => {
        if (!viewerRef.current) {
          return;
        }

        Object.defineProperties(viewerRef.current, {
          scrollTop: { value: 240, writable: true, configurable: true },
          scrollLeft: { value: 48, writable: true, configurable: true },
          scrollHeight: { value: 1800, configurable: true },
          clientHeight: { value: 600, configurable: true },
          scrollWidth: { value: 1200, configurable: true },
          clientWidth: { value: 400, configurable: true },
          scrollTo: { value: vi.fn(), configurable: true },
        });
        apiRef.current.viewer.container = viewerRef.current;
      }, []);

      ReactModule.useImperativeHandle(ref, () => apiRef.current, []);

      return (
        <div ref={viewerRef} data-testid="mock-pdf-highlighter" data-scale={pdfScaleValue}>
          {pdfScaleValue}
        </div>
      );
    }),
  };
});

vi.mock('@/hooks/use-annotation-system', () => ({
  useAnnotationSystem: (input: unknown) => useAnnotationSystemMock(input),
}));

vi.mock('@/hooks/use-annotation-navigation', () => ({
  useAnnotationNavigation: () => {},
}));

vi.mock('@/hooks/use-ink-annotation', () => ({
  useInkAnnotation: () => ({
    addStroke: vi.fn(),
    isDrawing: false,
    strokeCount: 0,
    finalizeNow: vi.fn(),
    cancelDrawing: vi.fn(),
  }),
}));

vi.mock('@/stores/ink-annotation-store', () => ({
  useInkAnnotationStore: useInkAnnotationStoreMock,
}));

vi.mock('@/components/ai/selection-context-menu', () => ({
  SelectionContextMenu: () => null,
}));

vi.mock('@/components/ai/selection-ai-hub', () => ({
  SelectionAiHub: () => null,
}));

vi.mock('@/hooks/use-selection-context-menu', () => ({
  useSelectionContextMenu: () => ({
    menuState: null,
    closeMenu: vi.fn(),
  }),
}));

vi.mock('../pdf-export-button', () => ({
  PDFExportButton: () => <div data-testid="mock-export" />,
}));

vi.mock('../pdf-annotation-sidebar', () => ({
  PdfAnnotationSidebar: () => <div data-testid="mock-annotation-sidebar" />,
}));

vi.mock('../ink-session-indicator', () => ({
  InkSessionIndicator: () => null,
}));

vi.mock('../ink-color-picker', () => ({
  InkColorPicker: () => null,
  InkWidthPicker: () => null,
}));

vi.mock('@/hooks/use-object-url', () => ({
  useObjectUrl: (input: unknown) => useObjectUrlMock(input),
}));

function renderPdfPane(props: { paneId: 'pane-left' | 'pane-right'; fileId: string }) {
  return (
    <div className="h-[600px] w-[800px]">
      <PDFHighlighterAdapter
        content={new Uint8Array([1, 2, 3]).buffer}
        fileName={`${props.fileId}.pdf`}
        fileHandle={{ name: `${props.fileId}.pdf` } as FileSystemFileHandle}
        rootHandle={{ name: 'workspace' } as FileSystemDirectoryHandle}
        paneId={props.paneId}
        fileId={props.fileId}
        filePath={`docs/${props.fileId}.pdf`}
      />
    </div>
  );
}

describe('PDFHighlighterAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useContentCacheStore.getState().clearCache();
    useWorkspaceStore.setState((state) => ({
      layout: {
        ...state.layout,
        activePaneId: 'pane-left',
      },
    }));
    useAnnotationSystemMock.mockReturnValue({
      annotations: [],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });
  });

  it('reads cached pdf view state per file and scopes keyboard zoom to one pane', async () => {
    useContentCacheStore.getState().saveEditorState('paper-right', {
      cursorPosition: 0,
      scrollTop: 320,
      scrollLeft: 12,
      viewState: {
        pdf: {
          scale: 1.75,
          zoomMode: 'fit-width',
          showSidebar: true,
        },
      },
    });

    render(
      <div className="grid grid-cols-2 gap-4">
        {renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' })}
        {renderPdfPane({ paneId: 'pane-right', fileId: 'paper-right' })}
      </div>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('pdf-zoom-label-pane-left').textContent).toBe('适宽');
      expect(screen.getByTestId('pdf-zoom-label-pane-right').textContent).toBe('适宽');
    });

    fireEvent.keyDown(document, { ctrlKey: true, key: '=' });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-zoom-label-pane-left').textContent).toBe('145%');
      expect(screen.getByTestId('pdf-zoom-label-pane-right').textContent).toBe('适宽');
    });

    fireEvent.pointerEnter(screen.getByTestId('pdf-pane-pane-right'));
    fireEvent.keyDown(document, { ctrlKey: true, key: '=' });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-zoom-label-pane-left').textContent).toBe('145%');
      expect(screen.getByTestId('pdf-zoom-label-pane-right').textContent).toBe('200%');
    });
  });

  it('scopes ctrl+wheel zoom to the hovered pane container', async () => {
    render(
      <div className="grid grid-cols-2 gap-4">
        {renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' })}
        {renderPdfPane({ paneId: 'pane-right', fileId: 'paper-right' })}
      </div>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('pdf-zoom-label-pane-left').textContent).toBe('适宽');
      expect(screen.getByTestId('pdf-zoom-label-pane-right').textContent).toBe('适宽');
    });

    fireEvent.wheel(screen.getByTestId('pdf-scroll-container-pane-right'), {
      ctrlKey: true,
      deltaY: -100,
    });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-zoom-label-pane-left').textContent).toBe('适宽');
      expect(screen.getByTestId('pdf-zoom-label-pane-right').textContent).toBe('145%');
    });
  });
});
