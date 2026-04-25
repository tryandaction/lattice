/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PDFHighlighterAdapter } from '../pdf-highlighter-adapter';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useContentCacheStore } from '@/stores/content-cache-store';
import { useLinkNavigationStore } from '@/stores/link-navigation-store';
import { resetPersistedFileViewStateCache } from '@/lib/file-view-state';
import { clearPdfPageTextCache, getPdfPageTextModel } from '@/lib/pdf-page-text-cache';

const resizeObserverCallbacks: ResizeObserverCallback[] = [];

const {
  inkStoreState,
  pdfMockState,
  selectionMockState,
  mockPdfDocument,
  mockPdfGetPage,
  useAnnotationNavigationMock,
  useAnnotationSystemMock,
  useObjectUrlMock,
  useInkAnnotationStoreMock,
  resolvePdfDocumentBindingMock,
} = vi.hoisted(() => {
  const state = {
    currentStyle: { color: '#ffeb3b', width: 2 },
    setCurrentStyle: vi.fn(),
    canUndo: vi.fn(() => false),
    undo: vi.fn(),
    canRedo: vi.fn(() => false),
    redo: vi.fn(),
  };

  const selectionState = {
    rawText: 'Selected PDF text',
    position: {
      boundingRect: {
        x1: 12,
        y1: 24,
        x2: 172,
        y2: 46,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: 12, y1: 24, x2: 132, y2: 46, width: 640, height: 960, pageNumber: 1 },
        { x1: 12, y1: 52, x2: 100, y2: 74, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    },
    fragments: [
      { text: 'Selected', left: 12, top: 24, width: 78, height: 24 },
      { text: 'PDF', left: 96, top: 24, width: 36, height: 24 },
      { text: 'text', left: 12, top: 52, width: 44, height: 24 },
    ],
    domSelection: null as null | {
      startFragment: string;
      endFragment: string;
      startOffset?: number;
      endOffset?: number;
      startIndex?: number;
      endIndex?: number;
    },
    autoApplyDomSelection: true,
    pageTextItems: null as string[] | null,
  };

  const pdfMockState = {
    numPages: 2,
    viewerMetrics: {
      width: 800,
      height: 600,
      scrollWidth: 1200,
      scrollHeight: 1800,
      scrollTop: 240,
      scrollLeft: 48,
    },
    pageMetrics: {
      1: { width: 640, height: 960, top: 0, left: 0 },
      2: { width: 640, height: 960, top: 1000, left: 0 },
    } as Record<number, { width: number; height: number; top: number; left: number }>,
    sidebarProps: null as null | Record<string, unknown>,
    navigationOptions: null as null | Record<string, unknown>,
  };

  const mockPdfGetPage = vi.fn(async (pageNumber: number) => ({
    getViewport: vi.fn(({ scale = 1 }: { scale?: number } = {}) => ({
      width: (pdfMockState.pageMetrics[pageNumber]?.width ?? 640) * scale,
      height: (pdfMockState.pageMetrics[pageNumber]?.height ?? 960) * scale,
      transform: [scale, 0, 0, scale, 0, 0],
    })),
    getTextContent: vi.fn(async () => ({
      items: (pageNumber === 1
        ? selectionState.fragments.map((fragment) => ({
            str: fragment.text,
            dir: 'ltr',
            transform: [1, 0, 0, fragment.height, fragment.left, fragment.top + fragment.height],
            width: fragment.width,
            height: fragment.height,
            fontName: 'mock-font',
            hasEOL: false,
          }))
        : [{
            str: 'Second page text',
            dir: 'ltr',
            transform: [1, 0, 0, 24, 20, 48],
            width: 140,
            height: 24,
            fontName: 'mock-font',
            hasEOL: false,
          }]
      ),
      styles: {},
      lang: null,
    })),
  }));

  const mockPdfDocument = {
    get numPages() {
      return pdfMockState.numPages;
    },
    getPage: mockPdfGetPage,
  };

  return {
    inkStoreState: state,
    pdfMockState,
    selectionMockState: selectionState,
    mockPdfDocument,
    mockPdfGetPage,
    useAnnotationNavigationMock: vi.fn((input?: unknown) => {
      pdfMockState.navigationOptions = (input ?? null) as Record<string, unknown> | null;
    }),
    useAnnotationSystemMock: vi.fn(),
    useObjectUrlMock: vi.fn((_input?: unknown) => 'blob:pdf'),
    resolvePdfDocumentBindingMock: vi.fn(async (_input?: unknown) => ({
      documentId: 'paper-id',
      fileIdentity: {
        primaryFileId: 'paper-id',
        fileIdCandidates: ['paper-id'],
        canonicalPath: 'workspace:docs/paper-id.pdf',
        relativePathFromRoot: 'docs/paper-id.pdf',
        fileName: 'paper-id.pdf',
        fileFingerprint: null,
        versionFingerprint: null,
        size: null,
        lastModified: null,
      },
      canonicalStorageFileId: 'paper-id',
      storageCandidates: ['paper-id'],
      annotationFile: {
        version: 3,
        documentId: 'paper-id',
        fileId: 'paper-id',
        fileType: 'pdf',
        annotations: [],
        lastModified: Date.now(),
      },
      resolvedSource: null,
    })),
    useInkAnnotationStoreMock: Object.assign(
      (selector?: (store: typeof state) => unknown) => selector ? selector(state) : state,
      {
        getState: () => state,
      },
    ),
  };
});

const originalRangeGetBoundingClientRect = Range.prototype.getBoundingClientRect;
const originalRangeGetClientRects = Range.prototype.getClientRects;

function createMockRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function createMockRectList(rects: DOMRect[]): DOMRectList {
  const list = rects as unknown as DOMRectList & DOMRect[];
  Object.defineProperty(list, 'item', {
    configurable: true,
    value: (index: number) => rects[index] ?? null,
  });
  return list;
}

function createFragmentSelectionRect(textNode: Text, startOffset: number, endOffset: number): DOMRect | null {
  const parentElement = textNode.parentElement;
  if (parentElement?.dataset.pdfFragment !== 'true') {
    return null;
  }
  const fullText = textNode.textContent ?? '';
  const totalLength = Math.max(1, fullText.length);
  const left = Number(parentElement.dataset.left ?? 0);
  const top = Number(parentElement.dataset.top ?? 0);
  const width = Number(parentElement.dataset.width ?? 0);
  const height = Number(parentElement.dataset.height ?? 0);
  const startRatio = startOffset / totalLength;
  const endRatio = endOffset / totalLength;
  return createMockRect(
    left + width * startRatio,
    top,
    Math.max(0, width * (endRatio - startRatio)),
    height,
  );
}

function getMockRangeClientRects(range: Range): DOMRect[] {
  const startContainer = range.startContainer;
  const endContainer = range.endContainer;

  if (startContainer === endContainer && startContainer instanceof Text) {
    const rect = createFragmentSelectionRect(startContainer, range.startOffset, range.endOffset);
    return rect ? [rect] : [];
  }

  const rects: DOMRect[] = [];
  const fragments = Array.from(document.querySelectorAll<HTMLElement>('[data-pdf-fragment="true"]'));
  fragments.forEach((fragment) => {
    const textNode = fragment.firstChild;
    if (!(textNode instanceof Text) || !range.intersectsNode(fragment)) {
      return;
    }

    const startOffset = textNode === range.startContainer ? range.startOffset : 0;
    const endOffset = textNode === range.endContainer ? range.endOffset : (textNode.textContent?.length ?? 0);
    if (endOffset <= startOffset) {
      return;
    }

    const rect = createFragmentSelectionRect(textNode, startOffset, endOffset);
    if (rect) {
      rects.push(rect);
    }
  });

  return rects;
}

function dispatchSelectionChange() {
  document.dispatchEvent(new Event('selectionchange'));
}

function triggerResizeObservers() {
  resizeObserverCallbacks.forEach((callback) => {
    callback([], {} as ResizeObserver);
  });
}

function applyMockTextLayerSelection() {
  const selection = window.getSelection();
  selection?.removeAllRanges();

  const config = selectionMockState.domSelection ?? {
    startFragment: selectionMockState.fragments[0]?.text ?? '',
    endFragment: selectionMockState.fragments[selectionMockState.fragments.length - 1]?.text ?? '',
  };
  if (!config.startFragment || !config.endFragment) {
    return;
  }

  const findTextNode = (fragmentText: string, index = 0): Text => {
    const matches = Array.from(document.querySelectorAll<HTMLElement>('[data-pdf-fragment="true"]'))
      .filter((element) => element.textContent === fragmentText);
    const textNode = matches[index]?.firstChild;
    if (!(textNode instanceof Text)) {
      throw new Error(`Missing text node for fragment: ${fragmentText}`);
    }
    return textNode;
  };

  const startNode = findTextNode(config.startFragment, config.startIndex ?? 0);
  const endNode = findTextNode(config.endFragment, config.endIndex ?? 0);
  const range = document.createRange();
  range.setStart(startNode, config.startOffset ?? 0);
  range.setEnd(endNode, config.endOffset ?? (endNode.textContent?.length ?? 0));
  selection?.addRange(range);
  dispatchSelectionChange();
}

beforeAll(() => {
  Range.prototype.getBoundingClientRect = function mockGetBoundingClientRect() {
    const rects = getMockRangeClientRects(this);
    if (rects.length > 0) {
      const left = Math.min(...rects.map((rect) => rect.left));
      const top = Math.min(...rects.map((rect) => rect.top));
      const right = Math.max(...rects.map((rect) => rect.right));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      return createMockRect(left, top, right - left, bottom - top);
    }

    return createMockRect(0, 0, 0, 0);
  };

  Range.prototype.getClientRects = function mockGetClientRects() {
    const rects = getMockRangeClientRects(this);
    if (rects.length === 0) {
      return createMockRectList([]);
    }
    return createMockRectList(rects);
  };
});

afterAll(() => {
  Range.prototype.getBoundingClientRect = originalRangeGetBoundingClientRect;
  Range.prototype.getClientRects = originalRangeGetClientRects;
});

vi.mock('react-pdf', async () => {
  const ReactModule = await import('react');

  return {
    pdfjs: {
      version: 'test',
      GlobalWorkerOptions: { workerSrc: '' },
    },
    Document: ({
      children,
      onLoadSuccess,
    }: {
      children: React.ReactNode;
      onLoadSuccess?: (pdf: typeof mockPdfDocument) => void;
    }) => {
      ReactModule.useEffect(() => {
        onLoadSuccess?.(mockPdfDocument);
      }, [onLoadSuccess]);

      return <div data-testid="mock-react-pdf-document">{children}</div>;
    },
    Page: ({
      pageNumber,
      scale,
      onLoadSuccess,
    }: {
      pageNumber: number;
      scale?: number;
      onLoadSuccess?: (page: { width: number; height: number; getViewport: (options: { scale: number }) => { width: number; height: number } }) => void;
    }) => {
      const pageRef = ReactModule.useRef<HTMLDivElement>(null);
      const pageMetrics = pdfMockState.pageMetrics[pageNumber] ?? {
        width: 640,
        height: 960,
        top: (pageNumber - 1) * 1000,
        left: 0,
      };

      ReactModule.useEffect(() => {
        onLoadSuccess?.({
          width: pageMetrics.width,
          height: pageMetrics.height,
          getViewport: ({ scale: viewportScale }: { scale: number }) => ({
            width: pageMetrics.width * viewportScale,
            height: pageMetrics.height * viewportScale,
          }),
        });
      }, [onLoadSuccess, pageMetrics.height, pageMetrics.width]);

      ReactModule.useEffect(() => {
        if (!pageRef.current) {
          return;
        }

        const viewerContainer = pageRef.current.closest<HTMLElement>('[data-testid^="pdf-viewer-container-"]');
        const scrollContainer = pageRef.current.closest<HTMLElement>('[data-testid^="pdf-scroll-container-"]');
        if (viewerContainer) {
          Object.defineProperties(viewerContainer, {
            scrollTop: { value: pdfMockState.viewerMetrics.scrollTop, writable: true, configurable: true },
            scrollLeft: { value: pdfMockState.viewerMetrics.scrollLeft, writable: true, configurable: true },
            scrollHeight: { value: pdfMockState.viewerMetrics.scrollHeight, configurable: true },
            clientHeight: { value: pdfMockState.viewerMetrics.height, configurable: true },
            scrollWidth: { value: pdfMockState.viewerMetrics.scrollWidth, configurable: true },
            clientWidth: { value: pdfMockState.viewerMetrics.width, configurable: true },
            scrollTo: {
              value: vi.fn(function scrollTo(
                this: HTMLElement & { scrollTop: number; scrollLeft: number },
                options?: { top?: number; left?: number },
              ) {
                if (typeof options?.top === 'number') {
                  this.scrollTop = options.top;
                }
                if (typeof options?.left === 'number') {
                  this.scrollLeft = options.left;
                }
              }),
              configurable: true,
            },
            getBoundingClientRect: {
              value: () => ({
                left: 0,
                top: 0,
                right: pdfMockState.viewerMetrics.width,
                bottom: pdfMockState.viewerMetrics.height,
                width: pdfMockState.viewerMetrics.width,
                height: pdfMockState.viewerMetrics.height,
                x: 0,
                y: 0,
                toJSON: () => ({}),
              }),
              configurable: true,
            },
          });
        }
        if (scrollContainer) {
          Object.defineProperty(scrollContainer, "getBoundingClientRect", {
            configurable: true,
            value: () => ({
              left: 0,
              top: 0,
              right: pdfMockState.viewerMetrics.width,
              bottom: pdfMockState.viewerMetrics.height,
              width: pdfMockState.viewerMetrics.width,
              height: pdfMockState.viewerMetrics.height,
              x: 0,
              y: 0,
              toJSON: () => ({}),
            }),
          });
        }

        const pageElement = pageRef.current.closest<HTMLElement>('[data-page-number]') ?? pageRef.current;
        const renderedScale = scale ?? 1;
        Object.defineProperty(pageElement, "getBoundingClientRect", {
          configurable: true,
          value: () => ({
            left: pageMetrics.left,
            top: pageMetrics.top,
            right: pageMetrics.left + (pageMetrics.width * renderedScale),
            bottom: pageMetrics.top + (pageMetrics.height * renderedScale),
            width: pageMetrics.width * renderedScale,
            height: pageMetrics.height * renderedScale,
            x: pageMetrics.left,
            y: pageMetrics.top,
            toJSON: () => ({}),
          }),
        });

        const fragments = pageRef.current.querySelectorAll<HTMLElement>('[data-pdf-fragment]');
        fragments.forEach((fragment) => {
          const left = Number(fragment.dataset.left ?? 0);
          const top = Number(fragment.dataset.top ?? 0);
          const width = Number(fragment.dataset.width ?? 0);
          const height = Number(fragment.dataset.height ?? 0);
          Object.defineProperty(fragment, "getBoundingClientRect", {
            configurable: true,
            value: () => ({
              left,
              top,
              right: left + width,
              bottom: top + height,
              width,
              height,
              x: left,
              y: top,
              toJSON: () => ({}),
            }),
          });
        });
      }, [pageMetrics.height, pageMetrics.left, pageMetrics.top, pageMetrics.width, pageNumber, scale]);

      const dispatchSelectionInteraction = (duplicate = false) => {
        const scrollContainer = pageRef.current?.closest<HTMLElement>('[data-testid^="pdf-scroll-container-"]');
        if (!scrollContainer) {
          return;
        }

        const dispatchPointerSequence = () => {
          scrollContainer.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
          scrollContainer.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
        };

        dispatchPointerSequence();
        if (duplicate) {
          dispatchPointerSequence();
        }
      };

      const ensureSelectionReady = () => {
        if (selectionMockState.autoApplyDomSelection && !window.getSelection()?.toString().trim()) {
          applyMockTextLayerSelection();
        }
      };

      return (
        <div ref={pageRef} data-testid={`mock-react-pdf-page-${pageNumber}`} data-scale={scale}>
          {pageNumber === 1 ? (
            <>
              <div className="textLayer">
                {selectionMockState.fragments.map((fragment, index) => (
                  <span
                    key={`${fragment.text}-${index}`}
                    data-pdf-fragment="true"
                    data-left={String(fragment.left)}
                    data-top={String(fragment.top)}
                    data-width={String(fragment.width)}
                    data-height={String(fragment.height)}
                  >
                    {fragment.text}
                  </span>
                ))}
              </div>
              <span data-testid="mock-native-selection-source">Native PDF text</span>
              <button
                type="button"
                data-testid="mock-pdf-selection-trigger"
                onMouseDown={(event) => {
                  ensureSelectionReady();
                  event.preventDefault();
                }}
                onClick={() => dispatchSelectionInteraction(false)}
              >
                Trigger selection
              </button>
              <button
                type="button"
                data-testid="mock-pdf-duplicate-selection-trigger"
                onMouseDown={(event) => {
                  ensureSelectionReady();
                  event.preventDefault();
                }}
                onClick={() => dispatchSelectionInteraction(true)}
              >
                Trigger duplicate selection
              </button>
            </>
          ) : (
            <span data-testid="mock-native-selection-source-page-2">Second page text</span>
          )}
        </div>
      );
    },
  };
});

vi.mock('@/hooks/use-annotation-system', () => ({
  useAnnotationSystem: (input: unknown) => useAnnotationSystemMock(input),
}));

vi.mock('@/hooks/use-annotation-navigation', () => ({
  useAnnotationNavigation: (input: unknown) => useAnnotationNavigationMock(input),
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
  PdfAnnotationSidebar: (props: Record<string, unknown>) => {
    pdfMockState.sidebarProps = props;
    return <div data-testid="mock-annotation-sidebar" />;
  },
}));

vi.mock('../pdf-item-workspace-panel', () => ({
  PdfItemWorkspacePanel: () => <div data-testid="mock-pdf-item-workspace-panel" />,
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

vi.mock('@/lib/pdf-document-binding', () => ({
  resolvePdfDocumentBinding: (input: unknown) => resolvePdfDocumentBindingMock(input),
}));

vi.mock('@/lib/pdf-item', () => ({
  loadPdfItemManifest: vi.fn(async () => ({
    version: 4,
    itemId: 'paper-id',
    pdfPath: 'docs/paper-id.pdf',
    itemFolderPath: '.lattice/items/paper-id.pdf',
    annotationIndexPath: null,
    fileFingerprint: null,
    versionFingerprint: null,
    knownPdfPaths: ['docs/paper-id.pdf'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })),
  loadPdfItemManifestForBinding: vi.fn(async () => ({
    version: 4,
    itemId: 'paper-id',
    pdfPath: 'docs/paper-id.pdf',
    itemFolderPath: '.lattice/items/paper-id.pdf',
    annotationIndexPath: null,
    fileFingerprint: null,
    versionFingerprint: null,
    knownPdfPaths: ['docs/paper-id.pdf'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })),
  ensurePdfItemWorkspace: vi.fn(async () => ({
    version: 4,
    itemId: 'paper-id',
    pdfPath: 'docs/paper-id.pdf',
    itemFolderPath: '.lattice/items/paper-id.pdf',
    annotationIndexPath: null,
    fileFingerprint: null,
    versionFingerprint: null,
    knownPdfPaths: ['docs/paper-id.pdf'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })),
  ensurePdfItemWorkspaceForBinding: vi.fn(async () => ({
    version: 4,
    itemId: 'paper-id',
    pdfPath: 'docs/paper-id.pdf',
    itemFolderPath: '.lattice/items/paper-id.pdf',
    annotationIndexPath: null,
    fileFingerprint: null,
    versionFingerprint: null,
    knownPdfPaths: ['docs/paper-id.pdf'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })),
  syncPdfManagedFiles: vi.fn(async () => undefined),
  syncPdfAnnotationsMarkdown: vi.fn(async (_rootHandle: unknown, manifest: unknown) => ({
    handle: null,
    path: null,
    manifest,
  })),
}));

vi.mock('@/hooks/use-file-system', () => ({
  useFileSystem: () => ({
    refreshDirectory: vi.fn(async () => undefined),
  }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/diagnostics/pdf-regression',
}));

function renderPdfPane(props: { paneId: 'pane-left' | 'pane-right'; fileId: string }) {
  return (
    <div className="h-[600px] w-[800px]">
      <PDFHighlighterAdapter
        source={{ kind: 'buffer', data: new Uint8Array([1, 2, 3]).buffer }}
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

async function waitForPdfTextModelPrefetch() {
  await act(async () => {
    await getPdfPageTextModel(mockPdfDocument as never, 1);
    await Promise.resolve();
  });
}

function triggerPdfSelection(paneId: 'pane-left' | 'pane-right' = 'pane-left') {
  const container = screen.getByTestId(`pdf-scroll-container-${paneId}`);
  if (!window.getSelection()?.toString().trim()) {
    const trigger = screen.getByTestId('mock-pdf-selection-trigger');
    fireEvent.mouseDown(trigger);
  }
  fireEvent.pointerDown(container, { button: 0 });
  fireEvent.pointerUp(container, { button: 0 });
}

function selectNativePdfText() {
  const textNode = screen.getByTestId('mock-native-selection-source').firstChild;
  if (!textNode) {
    throw new Error('Missing native selection text node');
  }

  const selection = window.getSelection();
  selection?.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(textNode);
  selection?.addRange(range);
  dispatchSelectionChange();
}

function selectPdfFragmentSubstring(fragmentText: string, selectedText: string) {
  const fragmentNode = screen.getByText(fragmentText).firstChild;
  if (!fragmentNode || fragmentNode.nodeType !== Node.TEXT_NODE) {
    throw new Error(`Missing text node for fragment: ${fragmentText}`);
  }

  const startIndex = fragmentText.indexOf(selectedText);
  if (startIndex < 0) {
    throw new Error(`Selected text "${selectedText}" not found in fragment "${fragmentText}"`);
  }

  const selection = window.getSelection();
  selection?.removeAllRanges();
  const range = document.createRange();
  range.setStart(fragmentNode, startIndex);
  range.setEnd(fragmentNode, startIndex + selectedText.length);
  selection?.addRange(range);
  dispatchSelectionChange();
}

describe('PDFHighlighterAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockPdfGetPage.mockClear();
    clearPdfPageTextCache(mockPdfDocument as never);
    resizeObserverCallbacks.length = 0;
    pdfMockState.numPages = 2;
    pdfMockState.viewerMetrics = {
      width: 800,
      height: 600,
      scrollWidth: 1200,
      scrollHeight: 1800,
      scrollTop: 240,
      scrollLeft: 48,
    };
    pdfMockState.pageMetrics = {
      1: { width: 640, height: 960, top: 0, left: 0 },
      2: { width: 640, height: 960, top: 1000, left: 0 },
    };
    pdfMockState.sidebarProps = null;
    pdfMockState.navigationOptions = null;
    selectionMockState.rawText = 'Selected PDF text';
    selectionMockState.position = {
      boundingRect: {
        x1: 12,
        y1: 24,
        x2: 172,
        y2: 46,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: 12, y1: 24, x2: 132, y2: 46, width: 640, height: 960, pageNumber: 1 },
        { x1: 12, y1: 52, x2: 100, y2: 74, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.fragments = [
      { text: 'Selected', left: 12, top: 24, width: 78, height: 24 },
      { text: 'PDF', left: 96, top: 24, width: 36, height: 24 },
      { text: 'text', left: 12, top: 52, width: 44, height: 24 },
    ];
    selectionMockState.domSelection = {
      startFragment: 'Selected',
      endFragment: 'text',
    };
    selectionMockState.autoApplyDomSelection = true;
    selectionMockState.pageTextItems = null;
    class MockResizeObserver {
      private callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        resizeObserverCallbacks.push(callback);
      }

      observe() {}

      disconnect() {
        const index = resizeObserverCallbacks.indexOf(this.callback);
        if (index >= 0) {
          resizeObserverCallbacks.splice(index, 1);
        }
      }
    }

    class MockIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
    resetPersistedFileViewStateCache();
    useContentCacheStore.getState().clearCache();
    useLinkNavigationStore.setState({ pendingByPane: {} });
    useWorkspaceStore.setState((state) => ({
      layout: {
        ...state.layout,
        activePaneId: 'pane-left',
      },
      commandBarByPane: {},
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
      expect(screen.getByTestId('pdf-zoom-label-pane-left').textContent).not.toBe('');
      expect(screen.getByTestId('pdf-zoom-label-pane-right').textContent).not.toBe('');
    });

    fireEvent.keyDown(document, { ctrlKey: true, key: '=' });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-zoom-label-pane-left').textContent).toBe('145%');
      expect(screen.getByTestId('pdf-zoom-label-pane-right').textContent).not.toBe('145%');
    });

    fireEvent.pointerEnter(screen.getByTestId('pdf-pane-pane-right'));
    fireEvent.keyDown(document, { ctrlKey: true, key: '=' });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-zoom-label-pane-left').textContent).toBe('145%');
      expect(screen.getByTestId('pdf-zoom-label-pane-right').textContent).toBe('145%');
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
      expect(screen.getByTestId('pdf-zoom-label-pane-left').textContent).not.toBe('');
      expect(screen.getByTestId('pdf-zoom-label-pane-right').textContent).not.toBe('');
    });

    fireEvent.keyDown(document, { key: 'Control', ctrlKey: true });
    fireEvent.wheel(screen.getByTestId('pdf-scroll-container-pane-right'), {
      ctrlKey: true,
      deltaY: -100,
    });
    fireEvent.keyUp(document, { key: 'Control' });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-zoom-label-pane-left').textContent).not.toBe('145%');
      expect(screen.getByTestId('pdf-zoom-label-pane-right').textContent).toBe('145%');
    });
  });

  it('shows transient selection overlay and clears it on cancel', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    triggerPdfSelection();

    await waitFor(() => {
      expect(screen.getByTestId('pdf-transient-selection-pane-left-page-1')).toBeTruthy();
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button:last-of-type') as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.queryByTestId('pdf-transient-selection-pane-left-page-1')).toBeNull();
    });
  });

  it('creates highlight from transient selection and clears overlay', async () => {
    const addAnnotation = vi.fn();
    useAnnotationSystemMock.mockReturnValue({
      annotations: [],
      error: null,
      addAnnotation,
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    triggerPdfSelection();
    await waitFor(() => {
      expect(screen.getByTestId('pdf-transient-selection-pane-left-page-1')).toBeTruthy();
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('pdf-transient-selection-pane-left-page-1')).toBeNull();
    });
  });

  it('prefers text-layer extraction over misaligned library text for saved annotation content', async () => {
    const addAnnotation = vi.fn();
    selectionMockState.rawText = 'd by DiVi';
    selectionMockState.position = {
      boundingRect: {
        x1: 120,
        y1: 24,
        x2: 240,
        y2: 46,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: 120, y1: 24, x2: 240, y2: 46, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.fragments = [
      { text: 'Led by', left: 20, top: 24, width: 70, height: 24 },
      { text: 'DiVincenzo', left: 120, top: 24, width: 120, height: 24 },
      { text: 'criteria', left: 260, top: 24, width: 80, height: 24 },
    ];
    selectionMockState.domSelection = {
      startFragment: 'DiVincenzo',
      endFragment: 'DiVincenzo',
    };
    useAnnotationSystemMock.mockReturnValue({
      annotations: [],
      error: null,
      addAnnotation,
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    triggerPdfSelection();
    await waitFor(() => {
      expect(screen.getByTestId('pdf-transient-selection-pane-left-page-1')).toBeTruthy();
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });

    expect(addAnnotation.mock.calls[0][0].content).toBe('DiVincenzo');
  });

  it('extracts the exact selected word from an oversized text-layer span', async () => {
    const addAnnotation = vi.fn();
    selectionMockState.rawText = 'tum computatio';
    selectionMockState.position = {
      boundingRect: {
        x1: 228,
        y1: 24,
        x2: 540,
        y2: 46,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: 228, y1: 24, x2: 540, y2: 46, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.fragments = [
      { text: 'quantum computation.', left: 20, top: 24, width: 520, height: 24 },
    ];
    selectionMockState.domSelection = {
      startFragment: 'quantum computation.',
      endFragment: 'quantum computation.',
      startOffset: 'quantum '.length,
      endOffset: 'quantum computation.'.length,
    };
    useAnnotationSystemMock.mockReturnValue({
      annotations: [],
      error: null,
      addAnnotation,
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    triggerPdfSelection();
    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe('computation.');
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });

    expect(addAnnotation.mock.calls[0][0].content).toBe('computation.');
  });

  it('falls back to native selection when text-layer cropping lands inside word boundaries', async () => {
    const addAnnotation = vi.fn();
    selectionMockState.rawText = 'ral intr';
    selectionMockState.position = {
      boundingRect: {
        x1: 70,
        y1: 24,
        x2: 140,
        y2: 46,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: 70, y1: 24, x2: 140, y2: 46, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.fragments = [
      { text: 'several intrinsic', left: 20, top: 24, width: 180, height: 24 },
    ];
    useAnnotationSystemMock.mockReturnValue({
      annotations: [],
      error: null,
      addAnnotation,
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    selectPdfFragmentSubstring('several intrinsic', 'intrinsic');
    triggerPdfSelection();
    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe('intrinsic');
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });

    expect(addAnnotation.mock.calls[0][0].content).toBe('intrinsic');
  });

  it('cancels when no DOM selection snapshot survives into the current pointer interaction', async () => {
    selectionMockState.rawText = 'm inform';
    selectionMockState.position = {
      boundingRect: {
        x1: 180,
        y1: 24,
        x2: 280,
        y2: 46,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: 180, y1: 24, x2: 280, y2: 46, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.fragments = [
      { text: 'quantum information can be found', left: 20, top: 24, width: 360, height: 24 },
    ];
    selectionMockState.autoApplyDomSelection = false;

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    selectPdfFragmentSubstring('quantum information can be found', 'information');
    window.getSelection()?.removeAllRanges();

    fireEvent.pointerDown(screen.getByTestId('pdf-scroll-container-pane-left'));
    fireEvent.pointerUp(screen.getByTestId('pdf-scroll-container-pane-left'));
    triggerPdfSelection();

    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-phase-pane-left').textContent).toBe('cancelled');
    });
    expect(document.querySelector('.pdf-selection-color-picker')).toBeNull();
  });

  it('does not replay an earlier text selection after the user changes the live DOM selection', async () => {
    selectionMockState.rawText = 'mation';
    selectionMockState.position = {
      boundingRect: {
        x1: 170,
        y1: 24,
        x2: 255,
        y2: 46,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: 170, y1: 24, x2: 255, y2: 46, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.fragments = [
      { text: 'quantum information', left: 20, top: 24, width: 260, height: 24 },
    ];

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    selectPdfFragmentSubstring('quantum information', 'information');
    triggerPdfSelection();
    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe('information');
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button:last-of-type') as HTMLButtonElement);
    await waitFor(() => {
      expect(window.getSelection()?.toString()).toBe('');
      expect(screen.queryByTestId('pdf-transient-selection-pane-left-page-1')).toBeNull();
    });

    selectPdfFragmentSubstring('quantum information', 'mation');
    triggerPdfSelection();
    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe('mation');
    });
  });

  it('promotes the settled pointer-up selection when the drag snapshot was captured too early', async () => {
    selectionMockState.fragments = [
      { text: 'Quantum', left: 20, top: 24, width: 76, height: 24 },
      { text: 'computing', left: 110, top: 24, width: 110, height: 24 },
      { text: 'is', left: 234, top: 24, width: 28, height: 24 },
      { text: 'attracting', left: 276, top: 24, width: 112, height: 24 },
      { text: 'great', left: 402, top: 24, width: 72, height: 24 },
      { text: 'interest', left: 488, top: 24, width: 96, height: 24 },
      { text: 'due', left: 598, top: 24, width: 42, height: 24 },
    ];
    selectionMockState.position = {
      boundingRect: {
        x1: 276,
        y1: 24,
        x2: 584,
        y2: 46,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: 276, y1: 24, x2: 388, y2: 46, width: 640, height: 960, pageNumber: 1 },
        { x1: 402, y1: 24, x2: 474, y2: 46, width: 640, height: 960, pageNumber: 1 },
        { x1: 488, y1: 24, x2: 584, y2: 46, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.domSelection = null;

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    selectPdfFragmentSubstring('computing', 'g');
    const isNode = screen.getByText('is').firstChild;
    const attractingNode = screen.getByText('attracting').firstChild;
    const greatNode = screen.getByText('great').firstChild;
    if (!(isNode instanceof Text) || !(attractingNode instanceof Text) || !(greatNode instanceof Text)) {
      throw new Error('Missing text nodes for early drag snapshot test');
    }
    const earlyRange = document.createRange();
    earlyRange.setStart(screen.getByText('computing').firstChild as Text, 'computing'.length - 1);
    earlyRange.setEnd(greatNode, 'great'.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(earlyRange);
    dispatchSelectionChange();

    fireEvent.pointerDown(screen.getByTestId('pdf-scroll-container-pane-left'), {
      clientX: 214,
      clientY: 36,
    });
    fireEvent.pointerUp(screen.getByTestId('pdf-scroll-container-pane-left'), {
      clientX: 574,
      clientY: 36,
    });

    const settledRange = document.createRange();
    settledRange.setStart(attractingNode, 0);
    settledRange.setEnd(screen.getByText('interest').firstChild as Text, 'interest'.length);
    selection?.removeAllRanges();
    selection?.addRange(settledRange);
    dispatchSelectionChange();

    triggerPdfSelection();

    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe('attracting great interest');
    });
  });

  it('keeps the selection menu close to the selected text edge when the selection is near the viewport bottom', async () => {
    const originalInnerHeight = window.innerHeight;
    const originalInnerWidth = window.innerWidth;
    try {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });

      selectionMockState.rawText = 'acousto-optic modulators';
      selectionMockState.position = {
        boundingRect: {
          x1: 140,
          y1: 680,
          x2: 320,
          y2: 714,
          width: 640,
          height: 960,
          pageNumber: 1,
        },
        rects: [
          { x1: 140, y1: 680, x2: 320, y2: 714, width: 640, height: 960, pageNumber: 1 },
        ],
        pageNumber: 1,
      };
      selectionMockState.fragments = [
        { text: 'acousto-optic modulators', left: 140, top: 680, width: 180, height: 34 },
      ];
      selectionMockState.domSelection = {
        startFragment: 'acousto-optic modulators',
        endFragment: 'acousto-optic modulators',
      };

      render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
      await waitForPdfTextModelPrefetch();

      triggerPdfSelection();

      await waitFor(() => {
        expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe('acousto-optic modulators');
      });

      const picker = document.querySelector('.pdf-selection-color-picker');
      if (!(picker instanceof HTMLElement) || !(picker.parentElement instanceof HTMLElement)) {
        throw new Error('Missing selection color picker portal');
      }

      const top = Number.parseFloat(picker.parentElement.style.top || '0');
      expect(top).toBeGreaterThan(340);
    } finally {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight });
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
    }
  });

  it('copies transient selection text on copy event and ctrl+c', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText,
      },
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    triggerPdfSelection();
    await waitFor(() => {
      expect(screen.getByTestId('pdf-transient-selection-pane-left-page-1')).toBeTruthy();
    });

    const clipboardData = { setData: vi.fn() };
    const copyEvent = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(copyEvent, 'clipboardData', {
      configurable: true,
      value: clipboardData,
    });

    document.dispatchEvent(copyEvent);
    expect(clipboardData.setData).toHaveBeenCalledWith('text/plain', 'Selected PDF text');
    expect(copyEvent.defaultPrevented).toBe(true);

    fireEvent.keyDown(document, { ctrlKey: true, key: 'c' });
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('Selected PDF text');
    });
  });

  it('copies native pdf selection text when no transient selection is active', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();
    fireEvent.pointerEnter(screen.getByTestId('pdf-pane-pane-left'));

    selectNativePdfText();

    const clipboardData = { setData: vi.fn() };
    const copyEvent = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(copyEvent, 'clipboardData', {
      configurable: true,
      value: clipboardData,
    });

    document.dispatchEvent(copyEvent);
    expect(clipboardData.setData).toHaveBeenCalledWith('text/plain', 'Native PDF text');
    expect(copyEvent.defaultPrevented).toBe(true);
  });

  it('prefers frozen selection text for copy while a transient selection is active, and clears frozen state on cancel', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    triggerPdfSelection();
    await waitFor(() => {
      expect(screen.getByTestId('pdf-transient-selection-pane-left-page-1')).toBeTruthy();
    });

    selectNativePdfText();

    const clipboardData = { setData: vi.fn() };
    const copyEvent = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(copyEvent, 'clipboardData', {
      configurable: true,
      value: clipboardData,
    });

    document.dispatchEvent(copyEvent);
    expect(clipboardData.setData).toHaveBeenCalledWith('text/plain', 'Selected PDF text');

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button:last-of-type') as HTMLButtonElement);
    await waitFor(() => {
      expect(window.getSelection()?.toString()).toBe('');
      expect(screen.queryByTestId('pdf-transient-selection-pane-left-page-1')).toBeNull();
    });
  });

  it('exposes the inner pdf.js viewer container in diagnostics mode', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      const diagnosticsContainer = document.querySelector('[data-testid="pdf-viewer-container-pane-left"]');
      const shellContainer = screen.getByTestId('pdf-scroll-container-pane-left');
      expect(diagnosticsContainer).toBeTruthy();
      expect(diagnosticsContainer).not.toBe(shellContainer);
    });
  });

  it('uses the widest measured page for fit-width zoom', async () => {
    pdfMockState.pageMetrics[2] = { width: 720, height: 960, top: 1000, left: 0 };
    pdfMockState.viewerMetrics.scrollWidth = 1600;

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-pdf-page-2').getAttribute('data-scale')).toBe('1.0666666666666667');
    });
  });

  it('keeps the current anchor stable when fit zoom relayout shrinks the viewer width', async () => {
    useContentCacheStore.getState().saveEditorState('paper-left', {
      cursorPosition: 0,
      scrollTop: 240,
      scrollLeft: 48,
      viewState: {
        pdf: {
          scale: 1.2,
          zoomMode: 'fit-width',
          showSidebar: true,
        },
      },
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(screen.getByTestId('pdf-anchor-page-pane-left').textContent).toBe('1');
    });

    pdfMockState.viewerMetrics.width = 680;
    pdfMockState.viewerMetrics.scrollWidth = 1600;
    await act(async () => {
      triggerResizeObservers();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-restore-actual-page-pane-left').textContent).toBe('1');
      expect(Number(screen.getByTestId('pdf-restore-delta-top-pane-left').textContent)).toBeLessThan(0.01);
      expect(Number(screen.getByTestId('pdf-restore-delta-left-pane-left').textContent)).toBeLessThan(0.01);
    });
  });

  it('keeps manual zoom when the viewer width becomes narrower', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(screen.getByTestId('pdf-zoom-label-pane-left').textContent).toBe('适宽');
    });

    fireEvent.keyDown(document, { ctrlKey: true, key: '=' });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-zoom-label-pane-left').textContent).toBe('145%');
    });

    pdfMockState.viewerMetrics.width = 500;
    pdfMockState.viewerMetrics.scrollWidth = 2000;
    await act(async () => {
      triggerResizeObservers();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-zoom-label-pane-left').textContent).toBe('145%');
    });

    const pageElement = document.querySelector<HTMLElement>('[data-page-number="1"]');
    expect(pageElement?.style.minWidth).toBe('928px');
  });

  it('opens annotation defaults from command bar right click and applies the default color to new area annotations', async () => {
    const addAnnotation = vi.fn();
    useAnnotationSystemMock.mockReturnValue({
      annotations: [],
      error: null,
      addAnnotation,
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().commandBarByPane['pane-left']).toBeTruthy();
    });

    const getAction = (id: string) => {
      const action = useWorkspaceStore.getState().commandBarByPane['pane-left']?.actions.find((item) => item.id === id);
      if (!action) {
        throw new Error(`Missing command bar action: ${id}`);
      }
      return action;
    };

    await act(async () => {
      getAction('tool-area').onContextMenu?.({ x: 32, y: 48 });
    });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-annotation-defaults-menu')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Red'));

    await act(async () => {
      getAction('tool-area').onTrigger?.();
    });

    const pageElement = document.querySelector<HTMLElement>('[data-page-number="1"]');
    if (!pageElement) {
      throw new Error('Missing PDF page element');
    }

    fireEvent.mouseDown(pageElement, { clientX: 80, clientY: 120 });
    fireEvent.mouseMove(pageElement, { clientX: 180, clientY: 220 });
    fireEvent.mouseUp(pageElement);

    expect(addAnnotation).toHaveBeenCalledTimes(1);
    expect(addAnnotation.mock.calls[0][0].style).toEqual({
      color: '#FF6666',
      type: 'area',
    });
  });

  it('scrolls sidebar annotation selection to the union rect center on the first click', async () => {
    const annotation = {
      id: 'ann-multi',
      target: {
        type: 'pdf',
        page: 1,
        rects: [
          { x1: 0.10, y1: 0.10, x2: 0.22, y2: 0.14 },
          { x1: 0.24, y1: 0.20, x2: 0.35, y2: 0.24 },
        ],
      },
      style: { color: '#FFEB3B', type: 'highlight' },
      content: 'multi-line highlight',
      author: 'user',
      createdAt: 1,
    } as const;

    useContentCacheStore.getState().saveEditorState('paper-left', {
      cursorPosition: 0,
      scrollTop: 240,
      scrollLeft: 48,
      viewState: {
        pdf: {
          scale: 1.2,
          zoomMode: 'fit-width',
          showSidebar: true,
        },
      },
    });

    useAnnotationSystemMock.mockReturnValue({
      annotations: [annotation],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(pdfMockState.sidebarProps).toBeTruthy();
    });

    const viewerContainer = document.querySelector('[data-testid="pdf-viewer-container-pane-left"]') as HTMLElement & {
      scrollTo: ReturnType<typeof vi.fn>;
    };
    viewerContainer.scrollTo.mockClear();

    await act(async () => {
      const onSelect = pdfMockState.sidebarProps?.onSelect as ((annotationItem: typeof annotation) => void);
      onSelect(annotation);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(viewerContainer.scrollTo).toHaveBeenCalled();
    });

    await waitFor(() => {
      const matchedCall = viewerContainer.scrollTo.mock.calls.find((call) => {
        const options = call[0] as { top?: number; left?: number } | undefined;
        return (
          options?.top !== undefined &&
          Math.abs(options.top - 135.84) < 0.01 &&
          options.left !== undefined &&
          Math.abs(options.left - 0) < 0.01
        );
      });
      expect(matchedCall).toBeTruthy();
    });
  });

  it('navigates to an annotation on an initially unrendered page on the first sidebar click', async () => {
    pdfMockState.numPages = 6;
    pdfMockState.viewerMetrics.scrollHeight = 7200;
    pdfMockState.viewerMetrics.scrollWidth = 1600;
    pdfMockState.pageMetrics = {
      1: { width: 640, height: 960, top: 0, left: 0 },
      2: { width: 640, height: 960, top: 1000, left: 0 },
      3: { width: 640, height: 960, top: 2000, left: 0 },
      4: { width: 640, height: 960, top: 3000, left: 0 },
      5: { width: 640, height: 960, top: 4000, left: 0 },
      6: { width: 640, height: 960, top: 5000, left: 0 },
    };

    const annotation = {
      id: 'ann-page-5',
      target: {
        type: 'pdf',
        page: 5,
        rects: [{ x1: 0.20, y1: 0.20, x2: 0.40, y2: 0.26 }],
      },
      style: { color: '#FFEB3B', type: 'highlight' },
      content: 'page five',
      author: 'user',
      createdAt: 1,
    } as const;

    useContentCacheStore.getState().saveEditorState('paper-left', {
      cursorPosition: 0,
      scrollTop: 240,
      scrollLeft: 48,
      viewState: {
        pdf: {
          scale: 1.2,
          zoomMode: 'fit-width',
          showSidebar: true,
        },
      },
    });

    useAnnotationSystemMock.mockReturnValue({
      annotations: [annotation],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(pdfMockState.sidebarProps).toBeTruthy();
    });

    const viewerContainer = document.querySelector('[data-testid="pdf-viewer-container-pane-left"]') as HTMLElement & {
      scrollTo: ReturnType<typeof vi.fn>;
    };
    viewerContainer.scrollTo.mockClear();

    await act(async () => {
      const onSelect = pdfMockState.sidebarProps?.onSelect as ((annotationItem: typeof annotation) => void);
      onSelect(annotation);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-pdf-page-5')).toBeTruthy();
      expect(viewerContainer.scrollTo).toHaveBeenCalled();
    });

    await waitFor(() => {
      const preciseCall = viewerContainer.scrollTo.mock.calls.find((call) => {
        const options = call[0] as { top?: number; left?: number } | undefined;
        return (
          options?.top !== undefined &&
          options.top > 3500 &&
          options.left === 0
        );
      });
      expect(preciseCall).toBeTruthy();
    });
  });

  it('keeps a markdown annotation navigation pending until annotations finish loading', async () => {
    const annotation = {
      id: 'ann-delayed',
      target: {
        type: 'pdf',
        page: 2,
        rects: [{ x1: 0.25, y1: 0.30, x2: 0.45, y2: 0.36 }],
      },
      style: { color: '#FFEB3B', type: 'highlight' },
      content: 'delayed annotation',
      author: 'user',
      createdAt: 1,
    } as const;
    let loadedAnnotations: readonly [typeof annotation] | [] = [];

    useAnnotationSystemMock.mockImplementation(() => ({
      annotations: loadedAnnotations,
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    }));

    useLinkNavigationStore.getState().setPendingNavigation('pane-left', {
      filePath: 'docs/paper-left.pdf',
      target: {
        type: 'pdf_annotation',
        path: 'docs/paper-left.pdf',
        annotationId: 'ann-delayed',
      },
    });

    const { rerender } = render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    const viewerContainer = await waitFor(() => (
      document.querySelector('[data-testid="pdf-viewer-container-pane-left"]') as HTMLElement & {
        scrollTo: ReturnType<typeof vi.fn>;
      }
    ));
    viewerContainer.scrollTo.mockClear();

    await waitFor(() => {
      expect(useLinkNavigationStore.getState().pendingByPane['pane-left']).toBeUndefined();
    });
    expect(viewerContainer.scrollTo).not.toHaveBeenCalled();

    loadedAnnotations = [annotation];
    rerender(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(document.querySelector('.pdf-stored-annotation-overlay-ann-delayed')).toBeTruthy();
      expect(pdfMockState.sidebarProps?.selectedId).toBe('ann-delayed');
    });
  });

  it('renders persisted PDF annotations for all supported PDF annotation styles after reload', async () => {
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-highlight',
          target: { type: 'pdf', page: 1, rects: [{ x1: 0.10, y1: 0.10, x2: 0.30, y2: 0.14 }] },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: 'highlight',
          author: 'user',
          createdAt: 1,
        },
        {
          id: 'ann-underline',
          target: { type: 'pdf', page: 1, rects: [{ x1: 0.32, y1: 0.10, x2: 0.52, y2: 0.14 }] },
          style: { color: '#2196F3', type: 'underline' },
          content: 'underline',
          author: 'user',
          createdAt: 2,
        },
        {
          id: 'ann-area',
          target: { type: 'pdf', page: 1, rects: [{ x1: 0.10, y1: 0.20, x2: 0.28, y2: 0.30 }] },
          style: { color: '#4CAF50', type: 'area' },
          content: 'area',
          author: 'user',
          createdAt: 3,
        },
        {
          id: 'ann-pin',
          target: { type: 'pdf', page: 1, rects: [{ x1: 0.60, y1: 0.20, x2: 0.62, y2: 0.22 }] },
          style: { color: '#FFC107', type: 'area' },
          comment: 'pin',
          author: 'user',
          createdAt: 4,
        },
        {
          id: 'ann-text',
          target: { type: 'pdf', page: 1, rects: [{ x1: 0.10, y1: 0.36, x2: 0.24, y2: 0.40 }] },
          style: {
            color: '#FFFFFF',
            type: 'text',
            textStyle: { textColor: '#111111', fontSize: 14 },
          },
          content: 'text note',
          author: 'user',
          createdAt: 5,
        },
        {
          id: 'ann-ink',
          target: { type: 'pdf', page: 1, rects: [{ x1: 0.10, y1: 0.44, x2: 0.30, y2: 0.52 }] },
          style: { color: '#FF5252', type: 'ink' },
          content: JSON.stringify([[{ x: 0.10, y: 0.44 }, { x: 0.30, y: 0.52 }]]),
          author: 'user',
          createdAt: 6,
        },
      ],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    await waitFor(() => {
      expect(document.querySelector('.pdf-stored-annotation-overlay-ann-highlight')).toBeTruthy();
      expect(document.querySelector('.pdf-stored-annotation-overlay-ann-underline')).toBeTruthy();
      expect(document.querySelector('.pdf-stored-annotation-overlay-ann-area')).toBeTruthy();
      expect(document.querySelector('.pdf-stored-annotation-overlay-ann-pin')).toBeTruthy();
      expect(document.querySelector('.text-overlay-ann-text')).toBeTruthy();
      expect(document.querySelector('.ink-overlay-ann-ink')).toBeTruthy();
    });
  });

});


