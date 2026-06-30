/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PDFHighlighterAdapter } from '../pdf-highlighter-adapter';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useContentCacheStore } from '@/stores/content-cache-store';
import { useLinkNavigationStore } from '@/stores/link-navigation-store';
import { useSettingsStore } from '@/stores/settings-store';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { resetPersistedFileViewStateCache } from '@/lib/file-view-state';
import { clearPdfPageTextCache, getPdfPageTextModel } from '@/lib/pdf-page-text-cache';
import {
  PDF_ANNOTATION_DRAFTS_BEGIN,
  PDF_ANNOTATION_DRAFTS_END,
} from '@/lib/pdf-annotation-markdown-drafts';
import type { AnnotationItem } from '@/types/universal-annotation';

const navigateLinkMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock('@/lib/link-router/navigate-link', () => ({
  navigateLink: navigateLinkMock,
}));

const resizeObserverCallbacks: ResizeObserverCallback[] = [];

const {
  inkStoreState,
  inkHookState,
  pdfMockState,
  selectionMockState,
  mockPdfDocument,
  mockPdfGetPage,
  nativeLayoutMockState,
  nextNavigationMockState,
  pdfItemMockState,
  loadPdfItemManifestMock,
  loadPdfItemManifestForBindingMock,
  useAnnotationNavigationMock,
  useAnnotationSystemMock,
  useObjectUrlMock,
  useInkAnnotationStoreMock,
  resolvePdfDocumentBindingMock,
  readPdfItemAnnotationMarkdownMock,
  removeResolvedPdfItemAnnotationMarkdownDraftsMock,
} = vi.hoisted(() => {
  const state = {
    currentStyle: { color: '#ffeb3b', width: 2 },
    setCurrentStyle: vi.fn((style: Partial<{ color: string; width: number }>) => {
      state.currentStyle = { ...state.currentStyle, ...style };
    }),
    canUndo: vi.fn(() => false),
    undo: vi.fn(),
    canRedo: vi.fn(() => false),
    redo: vi.fn(),
  };

  const inkHookState = {
    pendingStrokes: [] as Array<{
      points: Array<{ x: number; y: number }>;
      page: number;
      color: string;
    }>,
    addStroke: vi.fn((stroke: { points: Array<{ x: number; y: number }>; page: number; color: string }) => {
      inkHookState.pendingStrokes = [...inkHookState.pendingStrokes, stroke];
    }),
    finalizeNow: vi.fn(),
    cancelDrawing: vi.fn(() => {
      inkHookState.pendingStrokes = [];
    }),
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
    clientRectsOverride: null as Array<{ left: number; right: number; top: number; bottom: number }> | null,
    linkLayer: null as null | {
      href: string;
      left: number;
      top: number;
      width: number;
      height: number;
      onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
      onDragStart?: (event: React.DragEvent<HTMLAnchorElement>) => void;
    },
  };

  const pdfMockState = {
    numPages: 2,
    viewerMetrics: {
      width: 800,
      height: 600,
      scrollWidth: 1200,
      scrollHeight: 1800,
      scrollTop: 0,
      scrollLeft: 0,
    },
    pageMetrics: {
      1: { width: 640, height: 960, top: 0, left: 0 },
      2: { width: 640, height: 960, top: 1000, left: 0 },
    } as Record<number, { width: number; height: number; top: number; left: number }>,
    sidebarProps: null as null | Record<string, unknown>,
    navigationOptions: null as null | Record<string, unknown>,
  };

  const nativeLayoutMockState = {
    layout: null as null | {
      source: 'pdfium';
      pageNumber: number;
      width: number;
      height: number;
      text: string;
      chars: Array<{
        charIndex: number;
        text: string;
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        fontSize: number;
      }>;
    },
  };

  const pdfItemMockState = {
    annotationMarkdown: null as string | null,
  };

  const nextNavigationMockState = {
    pathname: '/diagnostics/pdf-regression',
    searchParams: new URLSearchParams(),
  };

  const readPdfItemAnnotationMarkdownMock = vi.fn(async () => pdfItemMockState.annotationMarkdown);
  const removeResolvedPdfItemAnnotationMarkdownDraftsMock = vi.fn(async () => undefined);
  const mockPdfItemManifest = () => ({
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
  });
  const loadPdfItemManifestMock = vi.fn(async () => mockPdfItemManifest());
  const loadPdfItemManifestForBindingMock = vi.fn(async () => mockPdfItemManifest());

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
    render: vi.fn(({ canvasContext, viewport }: { canvasContext?: CanvasRenderingContext2D | null; viewport?: { width: number; height: number } } = {}) => {
      const task = {
        cancel: vi.fn(),
        promise: Promise.resolve().then(() => {
          const canvas = canvasContext?.canvas;
          const pageElement = canvas?.closest<HTMLElement>('[data-page-number]');
          if (pageElement) {
            const scale = viewport?.width
              ? viewport.width / (pdfMockState.pageMetrics[pageNumber]?.width ?? 640)
              : 1;
            configureMockPdfPageDom(pageElement, pageNumber, scale);
          }
        }),
      };
      return task;
    }),
  }));

  const mockPdfDocument = {
    get numPages() {
      return pdfMockState.numPages;
    },
    getPage: mockPdfGetPage,
    getDestination: vi.fn(async (destination: string) => (
      destination === 'References' ? [{ num: 2, gen: 0 }] : null
    )),
    getPageIndex: vi.fn(async () => 1),
    destroy: vi.fn(() => Promise.resolve()),
  };

  return {
    inkStoreState: state,
    inkHookState,
    pdfMockState,
    selectionMockState: selectionState,
    mockPdfDocument,
    mockPdfGetPage,
    nativeLayoutMockState,
    nextNavigationMockState,
    pdfItemMockState,
    loadPdfItemManifestMock,
    loadPdfItemManifestForBindingMock,
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
    readPdfItemAnnotationMarkdownMock,
    removeResolvedPdfItemAnnotationMarkdownDraftsMock,
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
let canvasGetContextSpy: ReturnType<typeof vi.spyOn> | null = null;
let canvasToDataUrlSpy: ReturnType<typeof vi.spyOn> | null = null;
let originalDOMMatrix: typeof DOMMatrix | undefined;

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
  const pageElement = parentElement.closest<HTMLElement>('[data-page-number]');
  const pageNumber = Number(pageElement?.dataset.pageNumber ?? '1') || 1;
  const pageMetrics = pdfMockState.pageMetrics[pageNumber] ?? {
    width: 640,
    height: 960,
    top: (pageNumber - 1) * 1000,
    left: 0,
  };
  return createMockRect(
    pageMetrics.left + left + width * startRatio - pdfMockState.viewerMetrics.scrollLeft,
    pageMetrics.top + top - pdfMockState.viewerMetrics.scrollTop,
    Math.max(0, width * (endRatio - startRatio)),
    height,
  );
}

function getMockRangeClientRects(range: Range): DOMRect[] {
  if (selectionMockState.clientRectsOverride) {
    return selectionMockState.clientRectsOverride.map((rect) => {
      const pageMetrics = pdfMockState.pageMetrics[1] ?? {
        width: 640,
        height: 960,
        top: 0,
        left: 0,
      };
      return createMockRect(
        pageMetrics.left + rect.left - pdfMockState.viewerMetrics.scrollLeft,
        pageMetrics.top + rect.top - pdfMockState.viewerMetrics.scrollTop,
        rect.right - rect.left,
        rect.bottom - rect.top,
      );
    });
  }

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

function getPdfRectUnion(rects: Array<{ x1: number; x2: number; y1?: number; y2?: number }>) {
  return {
    x1: Math.min(...rects.map((rect) => rect.x1)),
    x2: Math.max(...rects.map((rect) => rect.x2)),
    y1: Math.min(...rects.map((rect) => rect.y1 ?? 0)),
    y2: Math.max(...rects.map((rect) => rect.y2 ?? 0)),
  };
}

function configureMockPdfPageDom(pageElement: HTMLElement, pageNumber: number, scale = 1) {
  const pageMetrics = pdfMockState.pageMetrics[pageNumber] ?? {
    width: 640,
    height: 960,
    top: (pageNumber - 1) * 1000,
    left: 0,
  };
  const viewerContainer = pageElement.closest<HTMLElement>('[data-testid^="pdf-viewer-container-"]');
  const scrollContainer = pageElement.closest<HTMLElement>('[data-testid^="pdf-scroll-container-"]');
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
        value: () => createMockRect(0, 0, pdfMockState.viewerMetrics.width, pdfMockState.viewerMetrics.height),
        configurable: true,
      },
    });
  }
  if (scrollContainer) {
    Object.defineProperty(scrollContainer, "getBoundingClientRect", {
      configurable: true,
      value: () => createMockRect(0, 0, pdfMockState.viewerMetrics.width, pdfMockState.viewerMetrics.height),
    });
  }

  pageElement.setAttribute('data-testid', `mock-react-pdf-page-${pageNumber}`);
  pageElement.setAttribute('data-scale', String(scale));
  Object.defineProperty(pageElement, "getBoundingClientRect", {
    configurable: true,
    value: () => createMockRect(
      pageMetrics.left - (viewerContainer?.scrollLeft ?? 0),
      pageMetrics.top - (viewerContainer?.scrollTop ?? 0),
      pageMetrics.width * scale,
      pageMetrics.height * scale,
    ),
  });

  pageElement.querySelector<HTMLCanvasElement>('canvas')?.setAttribute('data-testid', `mock-react-pdf-canvas-${pageNumber}`);

  if (pageNumber === 1 && !pageElement.querySelector('[data-testid="mock-pdf-selection-trigger"]')) {
    if (selectionMockState.linkLayer && !pageElement.querySelector('[data-testid="mock-pdf-link"]')) {
      const annotationLayer = document.createElement('div');
      annotationLayer.className = 'annotationLayer';
      const link = document.createElement('a');
      link.href = selectionMockState.linkLayer.href;
      link.dataset.testid = 'mock-pdf-link';
      link.className = 'linkAnnotation';
      link.textContent = 'link';
      link.style.position = 'absolute';
      link.style.left = `${selectionMockState.linkLayer.left}px`;
      link.style.top = `${selectionMockState.linkLayer.top}px`;
      link.style.width = `${selectionMockState.linkLayer.width}px`;
      link.style.height = `${selectionMockState.linkLayer.height}px`;
      link.addEventListener('click', (event) => {
        selectionMockState.linkLayer?.onClick?.(event as unknown as React.MouseEvent<HTMLAnchorElement>);
      });
      link.addEventListener('dragstart', (event) => {
        selectionMockState.linkLayer?.onDragStart?.(event as unknown as React.DragEvent<HTMLAnchorElement>);
      });
      annotationLayer.appendChild(link);
      pageElement.appendChild(annotationLayer);
    }

    const nativeSource = document.createElement('span');
    nativeSource.dataset.testid = 'mock-native-selection-source';
    nativeSource.textContent = 'Native PDF text';
    pageElement.appendChild(nativeSource);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.dataset.testid = 'mock-pdf-selection-trigger';
    trigger.textContent = 'Trigger selection';
    trigger.addEventListener('mousedown', (event) => {
      if (selectionMockState.autoApplyDomSelection && !window.getSelection()?.toString().trim()) {
        applyMockTextLayerSelection();
      }
      event.preventDefault();
    });
    trigger.addEventListener('click', () => {
      const scrollRoot = pageElement.closest<HTMLElement>('[data-testid^="pdf-scroll-container-"]');
      scrollRoot?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      scrollRoot?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
    });
    pageElement.appendChild(trigger);

    const duplicateTrigger = document.createElement('button');
    duplicateTrigger.type = 'button';
    duplicateTrigger.dataset.testid = 'mock-pdf-duplicate-selection-trigger';
    duplicateTrigger.textContent = 'Trigger duplicate selection';
    duplicateTrigger.addEventListener('mousedown', (event) => {
      if (selectionMockState.autoApplyDomSelection && !window.getSelection()?.toString().trim()) {
        applyMockTextLayerSelection();
      }
      event.preventDefault();
    });
    duplicateTrigger.addEventListener('click', () => {
      const scrollRoot = pageElement.closest<HTMLElement>('[data-testid^="pdf-scroll-container-"]');
      for (let index = 0; index < 2; index += 1) {
        scrollRoot?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
        scrollRoot?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
      }
    });
    pageElement.appendChild(duplicateTrigger);
  } else if (pageNumber !== 1 && !pageElement.querySelector('[data-testid="mock-native-selection-source-page-2"]')) {
    const nativeSource = document.createElement('span');
    nativeSource.dataset.testid = 'mock-native-selection-source-page-2';
    nativeSource.textContent = 'Second page text';
    pageElement.appendChild(nativeSource);
  }

  pageElement.querySelectorAll<HTMLElement>('.textLayer span').forEach((fragment, index) => {
    const source = pageNumber === 1
      ? selectionMockState.fragments[index]
      : { left: 20, top: 48, width: 140, height: 24 };
    if (!source) {
      return;
    }
    fragment.dataset.pdfFragment = 'true';
    fragment.dataset.left = String(source.left);
    fragment.dataset.top = String(source.top);
    fragment.dataset.width = String(source.width);
    fragment.dataset.height = String(source.height);
    Object.defineProperty(fragment, "getBoundingClientRect", {
      configurable: true,
      value: () => createMockRect(
        pageMetrics.left + source.left - (viewerContainer?.scrollLeft ?? 0),
        pageMetrics.top + source.top - (viewerContainer?.scrollTop ?? 0),
        source.width,
        source.height
      ),
    });
  });
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
  originalDOMMatrix = globalThis.DOMMatrix;
  if (!globalThis.DOMMatrix) {
    globalThis.DOMMatrix = class MockDOMMatrix {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
    } as unknown as typeof DOMMatrix;
  }
  canvasGetContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function mockGetContext(this: HTMLCanvasElement) {
    return {
    canvas: this,
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    set lineCap(_value: CanvasLineCap) {},
    set lineJoin(_value: CanvasLineJoin) {},
    set strokeStyle(_value: string | CanvasGradient | CanvasPattern) {},
    set lineWidth(_value: number) {},
    set shadowColor(_value: string) {},
    set shadowBlur(_value: number) {},
  } as unknown as CanvasRenderingContext2D;
  });
  canvasToDataUrlSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,mock');

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
  canvasGetContextSpy?.mockRestore();
  canvasToDataUrlSpy?.mockRestore();
  Range.prototype.getBoundingClientRect = originalRangeGetBoundingClientRect;
  Range.prototype.getClientRects = originalRangeGetClientRects;
  globalThis.DOMMatrix = originalDOMMatrix as typeof DOMMatrix;
});

const mockPdfjsApi = vi.hoisted(() => ({
  version: 'test',
  GlobalWorkerOptions: { workerSrc: '' },
  Util: {
    transform: (left: number[], right: number[]) => [
      left[0] * right[0] + left[2] * right[1],
      left[1] * right[0] + left[3] * right[1],
      left[0] * right[2] + left[2] * right[3],
      left[1] * right[2] + left[3] * right[3],
      left[0] * right[4] + left[2] * right[5] + left[4],
      left[1] * right[4] + left[3] * right[5] + left[5],
    ],
  },
  PDFWorker: {
    create: vi.fn((_params?: unknown) => {
      const worker = {
        destroyed: false,
        destroy: vi.fn(() => {
          worker.destroyed = true;
        }),
      };
      return worker;
    }),
  },
  getDocument: vi.fn((_source: unknown) => {
    const loadingTask = {
      destroyed: false,
      onProgress: undefined as undefined | ((progress: { loaded: number; total: number }) => void),
      promise: Promise.resolve().then(() => {
        loadingTask.onProgress?.({ loaded: 1, total: 1 });
        return mockPdfDocument;
      }),
      destroy: vi.fn(() => {
        loadingTask.destroyed = true;
        return Promise.resolve();
      }),
    };
    return loadingTask;
  }),
}));

vi.mock('pdfjs-dist/build/pdf.mjs', () => mockPdfjsApi);

vi.mock('react-pdf', async () => {
  const ReactModule = await import('react');

  return {
    pdfjs: mockPdfjsApi,
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
        const canvas = pageRef.current.querySelector<HTMLCanvasElement>('canvas');
        if (canvas) {
          canvas.width = Math.max(1, Math.round(pageMetrics.width));
          canvas.height = Math.max(1, Math.round(pageMetrics.height));
        }

        const renderedScale = scale ?? 1;
        Object.defineProperty(pageElement, "getBoundingClientRect", {
          configurable: true,
          value: () => ({
            left: pageMetrics.left - (viewerContainer?.scrollLeft ?? 0),
            top: pageMetrics.top - (viewerContainer?.scrollTop ?? 0),
            right: pageMetrics.left - (viewerContainer?.scrollLeft ?? 0) + (pageMetrics.width * renderedScale),
            bottom: pageMetrics.top - (viewerContainer?.scrollTop ?? 0) + (pageMetrics.height * renderedScale),
            width: pageMetrics.width * renderedScale,
            height: pageMetrics.height * renderedScale,
            x: pageMetrics.left - (viewerContainer?.scrollLeft ?? 0),
            y: pageMetrics.top - (viewerContainer?.scrollTop ?? 0),
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
              left: pageMetrics.left + left - (viewerContainer?.scrollLeft ?? 0),
              top: pageMetrics.top + top - (viewerContainer?.scrollTop ?? 0),
              right: pageMetrics.left + left - (viewerContainer?.scrollLeft ?? 0) + width,
              bottom: pageMetrics.top + top - (viewerContainer?.scrollTop ?? 0) + height,
              width,
              height,
              x: pageMetrics.left + left - (viewerContainer?.scrollLeft ?? 0),
              y: pageMetrics.top + top - (viewerContainer?.scrollTop ?? 0),
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
          <canvas data-testid={`mock-react-pdf-canvas-${pageNumber}`} />
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
              {selectionMockState.linkLayer ? (
                <div className="annotationLayer">
                  <a
                    href={selectionMockState.linkLayer.href}
                    data-testid="mock-pdf-link"
                    className="linkAnnotation"
                    onClick={(event) => {
                      selectionMockState.linkLayer?.onClick?.(event);
                    }}
                    onDragStart={(event) => {
                      selectionMockState.linkLayer?.onDragStart?.(event);
                    }}
                    style={{
                      position: 'absolute',
                      left: selectionMockState.linkLayer.left,
                      top: selectionMockState.linkLayer.top,
                      width: selectionMockState.linkLayer.width,
                      height: selectionMockState.linkLayer.height,
                    }}
                  >
                    link
                  </a>
                </div>
              ) : null}
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
    addStroke: inkHookState.addStroke,
    isDrawing: inkHookState.pendingStrokes.length > 0,
    strokeCount: inkHookState.pendingStrokes.length,
    pendingStrokes: inkHookState.pendingStrokes,
    finalizeNow: inkHookState.finalizeNow,
    cancelDrawing: inkHookState.cancelDrawing,
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
  exportOriginalPdf: vi.fn(async () => undefined),
  exportPdfWithAnnotations: vi.fn(async () => undefined),
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

vi.mock('@/lib/pdf-native-text-engine', () => ({
  clearDesktopPdfPageTextLayoutCache: vi.fn(),
  getDesktopPdfPageTextLayout: vi.fn(async () => {
    throw new Error('desktop native layout must not run during live selection');
  }),
  getDesktopPdfPath: vi.fn(() => 'C:/mock/paper.pdf'),
  peekDesktopPdfPageTextLayout: vi.fn(() => null),
  prefetchDesktopPdfPageTextLayout: vi.fn(),
}));

vi.mock('@/lib/pdf-item', () => ({
  loadPdfItemManifest: loadPdfItemManifestMock,
  loadPdfItemManifestForBinding: loadPdfItemManifestForBindingMock,
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
  readPdfItemAnnotationMarkdown: readPdfItemAnnotationMarkdownMock,
  removeResolvedPdfItemAnnotationMarkdownDrafts: removeResolvedPdfItemAnnotationMarkdownDraftsMock,
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
  usePathname: () => nextNavigationMockState.pathname,
  useSearchParams: () => nextNavigationMockState.searchParams,
}));

function renderPdfPane(props: { paneId: 'pane-left' | 'pane-right'; fileId: string }) {
  return (
    <div className="h-[600px] w-[800px]">
      <PDFHighlighterAdapter
        source={{ kind: 'buffer', data: new Uint8Array([1, 2, 3]).buffer }}
        fileName={`${props.fileId}.pdf`}
        fileHandle={{ name: `${props.fileId}.pdf` } as FileSystemFileHandle}
        rootHandle={{
          name: 'workspace',
          getDirectoryHandle: vi.fn(),
          values: vi.fn(),
        } as unknown as FileSystemDirectoryHandle}
        paneId={props.paneId}
        fileId={props.fileId}
        filePath={`docs/${props.fileId}.pdf`}
      />
    </div>
  );
}

async function waitForMockPdfViewerContainer(paneId: 'pane-left' | 'pane-right') {
  return waitFor(() => {
    const viewerContainer = document.querySelector(`[data-testid="pdf-viewer-container-${paneId}"]`) as (HTMLElement & {
      scrollTo?: ReturnType<typeof vi.fn>;
    }) | null;
    const pageElement = document.querySelector<HTMLElement>('[data-page-number="1"]');
    if (viewerContainer && pageElement && !(viewerContainer.scrollTo && 'mock' in viewerContainer.scrollTo)) {
      configureMockPdfPageDom(pageElement, 1);
    }
    expect(viewerContainer?.scrollTo && 'mock' in viewerContainer.scrollTo).toBe(true);
    return viewerContainer as HTMLElement & { scrollTo: ReturnType<typeof vi.fn> };
  });
}

async function waitForPdfTextModelPrefetch() {
  const pageElement = await waitFor(() => {
    const element = document.querySelector<HTMLElement>('[data-testid="mock-react-pdf-page-1"]')
      ?? document.querySelector<HTMLElement>('[data-page-number="1"]');
    expect(element).toBeTruthy();
    return element as HTMLElement;
  });
  await waitFor(() => {
    expect(pageElement.querySelector('.textLayer[data-pdf-text-layer-ready="true"]')).toBeTruthy();
  });
  configureMockPdfPageDom(pageElement, 1);
  await act(async () => {
    await getPdfPageTextModel(mockPdfDocument as never, 1);
    await Promise.resolve();
  });
}

async function waitUntil(
  predicate: () => boolean,
  message: string,
  timeoutMs = 1000,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(message);
}

function triggerPdfSelection(
  paneId: 'pane-left' | 'pane-right' = 'pane-left',
  pointer?: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  },
) {
  const container = screen.getByTestId(`pdf-scroll-container-${paneId}`);
  if (!window.getSelection()?.toString().trim()) {
    const trigger = screen.getByTestId('mock-pdf-selection-trigger');
    fireEvent.mouseDown(trigger);
  }
  fireEvent.pointerDown(container, {
    button: 0,
    clientX: pointer?.start.x ?? 0,
    clientY: pointer?.start.y ?? 0,
  });
  if (pointer?.end) {
    fireEvent.pointerMove(container, {
      button: 0,
      clientX: pointer.end.x,
      clientY: pointer.end.y,
    });
  }
  fireEvent.pointerUp(container, {
    button: 0,
    clientX: pointer?.end.x ?? pointer?.start.x ?? 0,
    clientY: pointer?.end.y ?? pointer?.start.y ?? 0,
  });
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
  const fragmentElement = screen.getAllByText(fragmentText).find((element) => (
    element instanceof HTMLElement && element.dataset.pdfFragment === 'true'
  ));
  const fragmentNode = fragmentElement?.firstChild;
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
      scrollTop: 0,
      scrollLeft: 0,
    };
    pdfMockState.pageMetrics = {
      1: { width: 640, height: 960, top: 0, left: 0 },
      2: { width: 640, height: 960, top: 1000, left: 0 },
    };
    pdfMockState.sidebarProps = null;
    pdfMockState.navigationOptions = null;
    inkStoreState.currentStyle = { color: '#ffeb3b', width: 2 };
    inkHookState.pendingStrokes = [];
    inkHookState.addStroke.mockClear();
    inkHookState.finalizeNow.mockClear();
    inkHookState.cancelDrawing.mockClear();
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
    selectionMockState.clientRectsOverride = null;
    selectionMockState.linkLayer = null;
    nativeLayoutMockState.layout = null;
    nextNavigationMockState.pathname = '/diagnostics/pdf-regression';
    nextNavigationMockState.searchParams = new URLSearchParams();
    pdfItemMockState.annotationMarkdown = null;
    loadPdfItemManifestMock.mockClear();
    loadPdfItemManifestForBindingMock.mockClear();
    readPdfItemAnnotationMarkdownMock.mockClear();
    removeResolvedPdfItemAnnotationMarkdownDraftsMock.mockClear();
    navigateLinkMock.mockClear();
    mockPdfDocument.getDestination.mockClear();
    mockPdfDocument.getPageIndex.mockClear();
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
    useSettingsStore.setState({
      settings: DEFAULT_SETTINGS,
      isLoading: false,
      isInitialized: true,
      error: null,
    });
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
    const rightZoomBefore = screen.getByTestId('pdf-zoom-label-pane-right').textContent;
    fireEvent.keyDown(document, { ctrlKey: true, key: '=' });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-zoom-label-pane-left').textContent).toBe('145%');
      expect(screen.getByTestId('pdf-zoom-label-pane-right').textContent).not.toBe(rightZoomBefore);
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
      expect(screen.getByTestId('pdf-selection-phase-pane-left').textContent).toBe('frozen');
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe('Selected PDF text');
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button:last-of-type') as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-phase-pane-left').textContent).toBe('cancelled');
    });
  });

  it('shows the complete selected PDF quote in the creation menu', async () => {
    const longQuote = 'Fig. 5, that tend to cause shifts in opposite directions when the electric field stability changes near the selected Rydberg transition';
    const lineLeft = 40;
    const lineTop = 120;
    const charWidth = 5;

    selectionMockState.rawText = longQuote;
    selectionMockState.position = {
      boundingRect: {
        x1: lineLeft,
        y1: lineTop,
        x2: lineLeft + longQuote.length * charWidth,
        y2: lineTop + 22,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        {
          x1: lineLeft,
          y1: lineTop,
          x2: lineLeft + longQuote.length * charWidth,
          y2: lineTop + 22,
          width: 640,
          height: 960,
          pageNumber: 1,
        },
      ],
      pageNumber: 1,
    };
    selectionMockState.fragments = [
      { text: longQuote, left: lineLeft, top: lineTop, width: longQuote.length * charWidth, height: 22 },
    ];
    selectionMockState.domSelection = {
      startFragment: longQuote,
      endFragment: longQuote,
    };

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    triggerPdfSelection();

    const picker = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('.pdf-selection-color-picker');
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });

    expect(picker.textContent).toContain(longQuote);
    expect(picker.textContent).not.toContain('...');
  });

  it('keeps the committed highlight visible until the persisted overlay takes over', async () => {
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
      expect(screen.getByTestId('pdf-selection-phase-pane-left').textContent).toBe('committed');
      expect(screen.getByTestId('pdf-transient-selection-pane-left-page-1')).toBeTruthy();
    });
    const committedRects = addAnnotation.mock.calls[0][0].target.rects;
    expect(committedRects.length).toBeGreaterThanOrEqual(2);
    expect(committedRects.some((rect: { x1: number; x2: number }) => rect.x2 - rect.x1 > 0.5)).toBe(false);
  });

  it('hands off a committed text markup overlay once the stored annotation segment renders', async () => {
    let loadedAnnotations: AnnotationItem[] = [];
    const addAnnotation = vi.fn((annotation: Omit<AnnotationItem, 'id' | 'createdAt'>) => {
      loadedAnnotations = [{
        ...annotation,
        id: 'ann-new-highlight',
        createdAt: Date.now(),
      }];
      return 'ann-new-highlight';
    });
    useAnnotationSystemMock.mockImplementation(() => ({
      annotations: loadedAnnotations,
      error: null,
      addAnnotation,
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    }));

    const { rerender } = render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    triggerPdfSelection();
    await waitFor(() => {
      expect(screen.getByTestId('pdf-transient-selection-pane-left-page-1')).toBeTruthy();
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);

    expect(addAnnotation).toHaveBeenCalledTimes(1);

    rerender(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(document.querySelector('.pdf-stored-annotation-overlay-ann-new-highlight [data-pdf-stored-annotation-segment="true"]')).toBeTruthy();
      expect(screen.getByTestId('pdf-selection-phase-pane-left').textContent).toBe('idle');
      expect(screen.queryByTestId('pdf-transient-selection-pane-left-page-1')).toBeNull();
    });
  });

  it('stores fragmented same-line PDF selections as one Zotero-style visual-line highlight', async () => {
    const addAnnotation = vi.fn();
    selectionMockState.rawText = 'Here we demonstrate a new neutral atom qubit';
    selectionMockState.position = {
      boundingRect: {
        x1: 100,
        y1: 240,
        x2: 550,
        y2: 264,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: 100, y1: 240, x2: 162, y2: 264, width: 640, height: 960, pageNumber: 1 },
        { x1: 178, y1: 241, x2: 256, y2: 265, width: 640, height: 960, pageNumber: 1 },
        { x1: 272, y1: 239, x2: 342, y2: 263, width: 640, height: 960, pageNumber: 1 },
        { x1: 360, y1: 240, x2: 454, y2: 264, width: 640, height: 960, pageNumber: 1 },
        { x1: 470, y1: 240, x2: 550, y2: 264, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.fragments = [
      { text: 'Here', left: 100, top: 240, width: 62, height: 24 },
      { text: 'we demonstrate', left: 178, top: 241, width: 78, height: 24 },
      { text: 'a new', left: 272, top: 239, width: 70, height: 24 },
      { text: 'neutral atom', left: 360, top: 240, width: 94, height: 24 },
      { text: 'qubit', left: 470, top: 240, width: 80, height: 24 },
    ];
    selectionMockState.domSelection = {
      startFragment: 'Here',
      endFragment: 'qubit',
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
      expect(screen.getByTestId('pdf-transient-selection-pane-left-page-1').children.length).toBe(1);
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });
    const storedRects = addAnnotation.mock.calls[0][0].target.rects;
    expect(storedRects).toHaveLength(1);
    expect(storedRects[0].x1).toBeCloseTo(100 / 640, 3);
    expect(storedRects[0].x2).toBeCloseTo(550 / 640, 3);
    expect(storedRects[0].y2 - storedRects[0].y1).toBeLessThan(0.04);
    expect(addAnnotation.mock.calls[0][0].content).toBe('Here we demonstrate a new neutral atom qubit');
  });

  it('renders committed multi-line text selections as thin visual-line bands instead of one coarse block', async () => {
    const addAnnotation = vi.fn();
    const lineA = 'from Fig. 5, that tend to cause shifts in opposite direc-';
    const lineB = 'tions. Even so, the electric field stability required to hold';
    const lineC = 'Stark shifts below 1 MHz is typically of order';
    const lineD = '0.01(100/n)7/2 V/cm.';
    const lineLeft = 80;
    const lineTop = 282;
    const lineHeight = 24;

    selectionMockState.rawText = [lineA, lineB, lineC, lineD].join(' ');
    selectionMockState.position = {
      boundingRect: {
        x1: lineLeft,
        y1: lineTop,
        x2: 510,
        y2: lineTop + (lineHeight * 4) + 72,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        {
          x1: lineLeft,
          y1: lineTop,
          x2: 510,
          y2: lineTop + (lineHeight * 4) + 72,
          width: 640,
          height: 960,
          pageNumber: 1,
        },
      ],
      pageNumber: 1,
    };
    selectionMockState.clientRectsOverride = [
      { left: lineLeft, right: 510, top: lineTop, bottom: lineTop + (lineHeight * 4) + 72 },
    ];
    selectionMockState.fragments = [
      { text: lineA, left: lineLeft, top: lineTop, width: 420, height: lineHeight },
      { text: lineB, left: lineLeft, top: lineTop + 32, width: 430, height: lineHeight },
      { text: lineC, left: lineLeft, top: lineTop + 64, width: 360, height: lineHeight },
      { text: lineD, left: lineLeft, top: lineTop + 96, width: 170, height: lineHeight },
    ];
    selectionMockState.domSelection = {
      startFragment: lineA,
      endFragment: lineD,
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

    triggerPdfSelection('pane-left', {
      start: { x: lineLeft + 2, y: lineTop + (lineHeight / 2) },
      end: { x: lineLeft + 168, y: lineTop + 96 + (lineHeight / 2) },
    });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-transient-selection-pane-left-page-1').children.length).toBeGreaterThanOrEqual(4);
    });
    const transientRects = Array.from(
      screen.getByTestId('pdf-transient-selection-pane-left-page-1').children,
    ) as HTMLElement[];
    expect(transientRects.every((rect) => Number.parseFloat(rect.style.height) <= lineHeight + 2)).toBe(true);

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });
    const storedRects = addAnnotation.mock.calls[0][0].target.rects;
    expect(storedRects.length).toBeGreaterThanOrEqual(4);
    expect(storedRects.every((rect: { y1: number; y2: number }) => rect.y2 - rect.y1 < 0.035)).toBe(true);
    expect(storedRects.some((rect: { y1: number; y2: number }) => rect.y2 - rect.y1 > 0.08)).toBe(false);
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

  it('keeps popup quote, annotation content, target quote, and rects aligned when PDF offsets drift to Rydberg text', async () => {
    const addAnnotation = vi.fn();
    const line = 'fast, high-fidelity excitation to the Rydberg state21 and mid-circuit';
    const selectedText = 'high-fidelity excitation';
    const wrongOffsetText = 'to the Rydberg state21';
    const lineLeft = 40;
    const lineTop = 120;
    const charWidth = 8;
    const selectedStart = line.indexOf(selectedText);
    const selectedLeft = lineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);
    const driftStart = line.indexOf(wrongOffsetText);

    selectionMockState.rawText = selectedText;
    selectionMockState.position = {
      boundingRect: {
        x1: selectedLeft,
        y1: lineTop,
        x2: selectedRight,
        y2: lineTop + 24,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: selectedLeft, y1: lineTop, x2: selectedRight, y2: lineTop + 24, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.clientRectsOverride = [{
      left: selectedLeft,
      right: selectedRight,
      top: lineTop,
      bottom: lineTop + 24,
    }];
    selectionMockState.fragments = [
      { text: line, left: lineLeft, top: lineTop, width: line.length * charWidth, height: 24 },
    ];
    selectionMockState.domSelection = {
      startFragment: line,
      endFragment: line,
      startOffset: selectedStart,
      endOffset: selectedStart + selectedText.length,
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
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe(selectedText);
      expect(screen.getByTestId('pdf-selection-source-pane-left').textContent).toBe('pdfjs-text-model');
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });

    const annotation = addAnnotation.mock.calls[0][0];
    expect(annotation.content).toBe(selectedText);
    expect(annotation.target.textQuote.exact).toBe(selectedText);
    expect(annotation.target.textQuote.exact).not.toContain('Rydberg');
    expect(annotation.target.textKernelVersion).toBe(1);
    expect(annotation.target.startCharIndex).toBeGreaterThanOrEqual(0);
    expect(annotation.target.endCharIndex).toBeGreaterThan(annotation.target.startCharIndex);
    expect(annotation.target.textSource).toBe('pdfjs-text-model');
    expect(annotation.target.textConfidence).toBeGreaterThan(0);
    expect(annotation.target.quads.length).toBe(annotation.target.rects.length);
    expect(annotation.target.rects.length).toBeGreaterThanOrEqual(1);
    const pdfPageWidth = 640;
    const rectUnion = getPdfRectUnion(annotation.target.rects);
    expect(rectUnion.x1).toBeCloseTo(selectedLeft / pdfPageWidth, 3);
    expect(rectUnion.x2).toBeCloseTo(selectedRight / pdfPageWidth, 3);
  });

  it('keeps frozen selection rects anchored when the PDF is scrolled before committing', async () => {
    const addAnnotation = vi.fn();
    const line = 'fast, high-fidelity excitation to the Rydberg state21 and mid-circuit';
    const selectedText = 'high-fidelity excitation';
    const wrongOffsetText = 'to the Rydberg state21';
    const lineLeft = 40;
    const lineTop = 220;
    const charWidth = 8;
    const selectedStart = line.indexOf(selectedText);
    const selectedLeft = lineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);
    const driftStart = line.indexOf(wrongOffsetText);

    selectionMockState.rawText = selectedText;
    selectionMockState.position = {
      boundingRect: {
        x1: selectedLeft,
        y1: lineTop,
        x2: selectedRight,
        y2: lineTop + 24,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: selectedLeft, y1: lineTop, x2: selectedRight, y2: lineTop + 24, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.clientRectsOverride = [{
      left: selectedLeft,
      right: selectedRight,
      top: lineTop,
      bottom: lineTop + 24,
    }];
    selectionMockState.fragments = [
      { text: line, left: lineLeft, top: lineTop, width: line.length * charWidth, height: 24 },
    ];
    selectionMockState.domSelection = {
      startFragment: line,
      endFragment: line,
      startOffset: driftStart,
      endOffset: driftStart + wrongOffsetText.length,
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
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe(selectedText);
      expect(screen.getByTestId('pdf-selection-phase-pane-left').textContent).toBe('frozen');
    });

    pdfMockState.viewerMetrics.scrollTop = 96;
    const page = screen.getByTestId('mock-react-pdf-page-1');
    configureMockPdfPageDom(page, 1);
    window.getSelection()?.removeAllRanges();

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });

    const annotation = addAnnotation.mock.calls[0][0];
    const rectUnion = getPdfRectUnion(annotation.target.rects);
    expect(annotation.content).toBe(selectedText);
    expect(annotation.target.textQuote.exact).toBe(selectedText);
    expect(rectUnion.x1).toBeCloseTo(selectedLeft / 640, 3);
    expect(rectUnion.x2).toBeCloseTo(selectedRight / 640, 3);
    expect(rectUnion.y1).toBeCloseTo(lineTop / 960, 3);
    expect(rectUnion.y2).toBeCloseTo((lineTop + 24) / 960, 3);
  });

  it('keeps geometry-trusted frozen selections anchored after scrolling before commit', async () => {
    const addAnnotation = vi.fn();
    const line = 'a single lattice site. Furthermore, we show how a Mott insulator';
    const selectedText = 'Furthermore';
    const lineLeft = 130;
    const lineTop = 288;
    const lineWidth = 620;
    const charWidth = lineWidth / line.length;
    const selectedStart = line.indexOf(selectedText);
    const selectedLeft = lineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);

    selectionMockState.fragments = [
      { text: '0', left: 540, top: 214, width: 12, height: 12 },
      { text: line, left: lineLeft, top: lineTop, width: lineWidth, height: 24 },
    ];
    selectionMockState.rawText = '0';
    selectionMockState.position = {
      boundingRect: {
        x1: 540,
        y1: 214,
        x2: 552,
        y2: 226,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: 540, y1: 214, x2: 552, y2: 226, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.domSelection = {
      startFragment: '0',
      endFragment: '0',
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

    const container = screen.getByTestId('pdf-scroll-container-pane-left');
    fireEvent.pointerDown(container, {
      clientX: selectedLeft + (charWidth * 2),
      clientY: lineTop + 12,
    });
    fireEvent.pointerMove(container, {
      clientX: selectedLeft + (charWidth * 2.4),
      clientY: lineTop + 12,
    });
    fireEvent.pointerUp(container, {
      clientX: selectedLeft + (charWidth * 2.4),
      clientY: lineTop + 12,
    });

    selectPdfFragmentSubstring(line, selectedText);
    dispatchSelectionChange();

    selectPdfFragmentSubstring('0', '0');
    selectionMockState.rawText = '0';
    selectionMockState.domSelection = {
      startFragment: '0',
      endFragment: '0',
    };
    dispatchSelectionChange();

    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe(selectedText);
      expect(screen.getByTestId('pdf-selection-phase-pane-left').textContent).toBe('frozen');
    });

    pdfMockState.viewerMetrics.scrollTop = 96;
    configureMockPdfPageDom(screen.getByTestId('mock-react-pdf-page-1'), 1);
    window.getSelection()?.removeAllRanges();

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });

    const annotation = addAnnotation.mock.calls[0][0];
    const rectUnion = getPdfRectUnion(annotation.target.rects);
    expect(annotation.content).toBe(selectedText);
    expect(annotation.target.textQuote.exact).toBe(selectedText);
    expect(annotation.target.textQuote.exact).not.toBe('0');
    expect(rectUnion.x1).toBeCloseTo(selectedLeft / 640, 2);
    expect(rectUnion.x2).toBeCloseTo(selectedRight / 640, 2);
    expect(rectUnion.y1).toBeCloseTo(lineTop / 960, 2);
    expect(rectUnion.y2).toBeCloseTo((lineTop + 24) / 960, 2);
  });

  it('uses pointer-grounded rendered text when a literature short selection drifts to later text', async () => {
    const addAnnotation = vi.fn();
    const line = 'The development of scalable, high-fidelity qubits is a key challenge in quantum';
    const selectedText = 'development';
    const wrongOffsetText = 'able, high-fid';
    const lineLeft = 80;
    const lineTop = 560;
    const charWidth = 7.5;
    const selectedStart = line.indexOf(selectedText);
    const selectedLeft = lineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);
    const driftStart = line.indexOf(wrongOffsetText);

    selectionMockState.rawText = wrongOffsetText;
    selectionMockState.position = {
      boundingRect: {
        x1: selectedLeft,
        y1: lineTop,
        x2: selectedRight,
        y2: lineTop + 22,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: selectedLeft, y1: lineTop, x2: selectedRight, y2: lineTop + 22, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.fragments = [
      { text: line, left: lineLeft, top: lineTop, width: line.length * charWidth, height: 22 },
    ];
    selectionMockState.domSelection = {
      startFragment: line,
      endFragment: line,
      startOffset: driftStart,
      endOffset: driftStart + wrongOffsetText.length,
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

    triggerPdfSelection('pane-left', {
      start: { x: selectedLeft + 1, y: lineTop + 11 },
      end: { x: selectedRight - 1, y: lineTop + 11 },
    });
    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe(selectedText);
      expect(screen.getByTestId('pdf-selection-source-pane-left').textContent).toBe('pdfjs-text-model');
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });

    const annotation = addAnnotation.mock.calls[0][0];
    expect(annotation.content).toBe(selectedText);
    expect(annotation.target.textQuote.exact).toBe(selectedText);
    expect(annotation.target.textQuote.exact).not.toContain('able');
    expect(annotation.target.textQuote.exact).not.toContain('high-fid');
    expect(annotation.target.textKernelVersion).toBe(1);
    expect(annotation.target.textSource).toBe('pdfjs-text-model');
    expect(annotation.target.quads).toHaveLength(1);
    expect(annotation.target.rects.length).toBeGreaterThanOrEqual(1);
    const pdfPageWidth = 640;
    const rectUnion = getPdfRectUnion(annotation.target.rects);
    expect(rectUnion.x1).toBeCloseTo(selectedLeft / pdfPageWidth, 3);
    expect(rectUnion.x2).toBeCloseTo(selectedRight / pdfPageWidth, 3);
  });

  it('keeps repeated-phrase selections anchored to the dragged geometry when trimming a drifted DOM quote', async () => {
    const addAnnotation = vi.fn();
    const firstLine = 'alpha repeated phrase beta and nearby context';
    const secondLine = 'gamma repeated phrase delta and final context';
    const selectedText = 'repeated phrase';
    const left = 80;
    const firstTop = 220;
    const secondTop = 260;
    const charWidth = 7;
    const firstWidth = firstLine.length * charWidth;
    const secondWidth = secondLine.length * charWidth;
    const secondStart = secondLine.indexOf(selectedText);
    const selectedLeft = left + (secondStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);

    selectionMockState.rawText = `${firstLine} ${secondLine}`;
    selectionMockState.fragments = [
      { text: firstLine, left, top: firstTop, width: firstWidth, height: 24 },
      { text: secondLine, left, top: secondTop, width: secondWidth, height: 24 },
    ];
    selectionMockState.position = {
      boundingRect: {
        x1: selectedLeft,
        y1: secondTop,
        x2: selectedRight,
        y2: secondTop + 24,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: selectedLeft, y1: secondTop, x2: selectedRight, y2: secondTop + 24, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.clientRectsOverride = [{
      left: selectedLeft,
      right: selectedRight,
      top: secondTop,
      bottom: secondTop + 24,
    }];
    selectionMockState.domSelection = {
      startFragment: firstLine,
      endFragment: secondLine,
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

    triggerPdfSelection('pane-left', {
      start: { x: selectedLeft + 1, y: secondTop + 12 },
      end: { x: selectedRight - 1, y: secondTop + 12 },
    });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe(selectedText);
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });

    const annotation = addAnnotation.mock.calls[0][0];
    const rectUnion = getPdfRectUnion(annotation.target.rects);
    expect(annotation.content).toBe(selectedText);
    expect(annotation.target.textQuote.exact).toBe(selectedText);
    expect(rectUnion.y1).toBeCloseTo(secondTop / 960, 3);
    expect(rectUnion.x1).toBeCloseTo(selectedLeft / 640, 3);
    expect(rectUnion.x2).toBeCloseTo(selectedRight / 640, 3);
  });

  it('keeps Saffman two-column geometry authoritative when the live quote drifts to the opposite column', async () => {
    const addAnnotation = vi.fn();
    const leftLine = 'from Fig. 5, that tend to cause shifts in opposite direc-';
    const wrongRightLine = 'two-atom states within ±4 GHz of the initial state. De-';
    const selectedText = 'Fig. 5, that tend';
    const wrongQuote = 'two-atom states within ±4 GHz';
    const leftLineLeft = 50;
    const leftLineTop = 550;
    const rightLineLeft = 314;
    const rightLineTop = 293;
    const charWidth = 4.7;
    const selectedStart = leftLine.indexOf(selectedText);
    const selectedLeft = leftLineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);

    selectionMockState.rawText = wrongQuote;
    selectionMockState.position = {
      boundingRect: {
        x1: selectedLeft,
        y1: leftLineTop,
        x2: selectedRight,
        y2: leftLineTop + 20,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: selectedLeft, y1: leftLineTop, x2: selectedRight, y2: leftLineTop + 20, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.clientRectsOverride = [{
      left: selectedLeft,
      right: selectedRight,
      top: leftLineTop,
      bottom: leftLineTop + 20,
    }];
    selectionMockState.fragments = [
      { text: leftLine, left: leftLineLeft, top: leftLineTop, width: leftLine.length * charWidth, height: 20 },
      { text: wrongRightLine, left: rightLineLeft, top: rightLineTop, width: wrongRightLine.length * charWidth, height: 20 },
    ];
    selectionMockState.domSelection = {
      startFragment: wrongRightLine,
      endFragment: wrongRightLine,
      startOffset: 0,
      endOffset: wrongQuote.length,
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

    triggerPdfSelection('pane-left', {
      start: { x: selectedLeft + 1, y: leftLineTop + 10 },
      end: { x: selectedRight - 1, y: leftLineTop + 10 },
    });
    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toContain('Fig. 5, that tend');
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).not.toContain('two-atom');
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });

    const annotation = addAnnotation.mock.calls[0][0];
    expect(annotation.content).toContain('Fig. 5, that tend');
    expect(annotation.target.textQuote.exact).toContain('Fig. 5, that tend');
    expect(annotation.target.textQuote.exact).not.toContain('two-atom');
    expect(annotation.target.textQuote.exact).not.toContain('±4 GHz');
    expect(annotation.target.rects[0].x1).toBeLessThan(0.2);
    expect(annotation.target.rects[0].x2).toBeLessThan(0.55);
  });

  it('uses right-column geometry when the desktop selection text collapses to zero', async () => {
    const addAnnotation = vi.fn();
    const leftLine = 'For small dc electric fields E such that the dipole cou-';
    const rightLine = 'where a and b are the positions of the two Rydberg';
    const selectedText = 'where a and b are';
    const rightLineLeft = 320;
    const rightLineTop = 210;
    const charWidth = 5.2;
    const selectedStart = rightLine.indexOf(selectedText);
    const selectedLeft = rightLineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);

    selectionMockState.rawText = '0';
    selectionMockState.position = {
      boundingRect: {
        x1: selectedLeft,
        y1: rightLineTop,
        x2: selectedRight,
        y2: rightLineTop + 22,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: selectedLeft, y1: rightLineTop, x2: selectedRight, y2: rightLineTop + 22, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.clientRectsOverride = [{
      left: selectedLeft,
      right: selectedRight,
      top: rightLineTop,
      bottom: rightLineTop + 22,
    }];
    selectionMockState.fragments = [
      { text: leftLine, left: 52, top: rightLineTop, width: leftLine.length * charWidth, height: 22 },
      { text: '0', left: 260, top: 300, width: 8, height: 12 },
      { text: rightLine, left: rightLineLeft, top: rightLineTop, width: rightLine.length * charWidth, height: 22 },
    ];
    selectionMockState.domSelection = {
      startFragment: '0',
      endFragment: '0',
      startOffset: 0,
      endOffset: 1,
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

    triggerPdfSelection('pane-left', {
      start: { x: selectedLeft + 1, y: rightLineTop + 11 },
      end: { x: selectedRight - 1, y: rightLineTop + 11 },
    });
    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toContain(selectedText);
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).not.toBe('0');
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });

    const annotation = addAnnotation.mock.calls[0][0];
    expect(annotation.content).toContain(selectedText);
    expect(annotation.target.textQuote.exact).toContain(selectedText);
    expect(annotation.target.textQuote.exact).not.toBe('0');
    expect(annotation.target.rects[0].x1).toBeGreaterThan(0.45);
  });

  it('uses right-column client rects when native text is zero without drag metadata', async () => {
    const addAnnotation = vi.fn();
    const rightLine = 'where a and b are the positions of the two Rydberg';
    const selectedText = 'where a and b are';
    const rightLineLeft = 320;
    const rightLineTop = 210;
    const charWidth = 5.2;
    const selectedStart = rightLine.indexOf(selectedText);
    const selectedLeft = rightLineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);

    selectionMockState.rawText = '0';
    selectionMockState.position = {
      boundingRect: {
        x1: selectedLeft,
        y1: rightLineTop,
        x2: selectedRight,
        y2: rightLineTop + 22,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: selectedLeft, y1: rightLineTop, x2: selectedRight, y2: rightLineTop + 22, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.clientRectsOverride = [{
      left: selectedLeft,
      right: selectedRight,
      top: rightLineTop,
      bottom: rightLineTop + 22,
    }];
    selectionMockState.fragments = [
      { text: '0', left: 260, top: 300, width: 8, height: 12 },
      { text: rightLine, left: rightLineLeft, top: rightLineTop, width: rightLine.length * charWidth, height: 22 },
    ];
    selectionMockState.domSelection = {
      startFragment: '0',
      endFragment: '0',
      startOffset: 0,
      endOffset: 1,
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
      const preview = screen.getByTestId('pdf-selection-preview-pane-left').textContent ?? '';
      expect(preview).toContain(selectedText);
      expect(preview).not.toBe('0');
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });

    const annotation = addAnnotation.mock.calls[0][0];
    expect(annotation.content).toContain(selectedText);
    expect(annotation.target.textQuote.exact).toContain(selectedText);
    expect(annotation.target.textQuote.exact).not.toBe('0');
    expect(annotation.target.rects[0].x1).toBeGreaterThan(0.45);
  });

  it('keeps a Saffman multi-line saved highlight inside the dragged left column when native rects include right-column text', async () => {
    const addAnnotation = vi.fn();
    const previousLine = 'of states with equal and opposite Delta E, as can be inferred';
    const firstSelectedLine = 'from Fig. 5, that tend to cause shifts in opposite direc-';
    const secondSelectedLine = 'tions. Even so, the electric field stability required to hold';
    const thirdSelectedLine = 'Stark shifts below 1 MHz is typically of order';
    const fourthSelectedLine = '0.01(100/n)7/2 V/cm.';
    const rightLineA = 'where j is the total angular momentum';
    const rightLineB = 'dipole-dipole interaction of atom states';
    const leftLineLeft = 52;
    const leftLineRight = 302;
    const rightLineLeft = 356;
    const rightLineRight = 616;
    const lineHeight = 22;
    const firstLineTop = 452;
    const figStart = firstSelectedLine.indexOf('Fig. 5');
    const firstLineCharWidth = (leftLineRight - leftLineLeft) / firstSelectedLine.length;
    const selectedLeft = leftLineLeft + (figStart * firstLineCharWidth);
    const selectedEndX = leftLineLeft + 122;
    const selectedText = [
      'Fig. 5, that tend to cause shifts in opposite direc-',
      'tions. Even so, the electric field stability required to hold',
      'Stark shifts below 1 MHz is typically of order',
      fourthSelectedLine,
    ].join(' ');

    selectionMockState.rawText = selectedText;
    selectionMockState.position = {
      boundingRect: {
        x1: selectedLeft,
        y1: firstLineTop,
        x2: selectedEndX,
        y2: firstLineTop + (lineHeight * 4),
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: selectedLeft, y1: firstLineTop, x2: leftLineRight, y2: firstLineTop + lineHeight, width: 640, height: 960, pageNumber: 1 },
        { x1: leftLineLeft, y1: firstLineTop + 32, x2: leftLineRight, y2: firstLineTop + 32 + lineHeight, width: 640, height: 960, pageNumber: 1 },
        { x1: leftLineLeft, y1: firstLineTop + 64, x2: leftLineRight - 24, y2: firstLineTop + 64 + lineHeight, width: 640, height: 960, pageNumber: 1 },
        { x1: leftLineLeft, y1: firstLineTop + 96, x2: selectedEndX, y2: firstLineTop + 96 + lineHeight, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.clientRectsOverride = [
      { left: 138, right: leftLineRight, top: 420, bottom: 420 + lineHeight },
      { left: selectedLeft, right: leftLineRight, top: firstLineTop, bottom: firstLineTop + lineHeight },
      { left: leftLineLeft, right: leftLineRight, top: firstLineTop + 32, bottom: firstLineTop + 32 + lineHeight },
      { left: rightLineLeft, right: rightLineRight, top: firstLineTop + 32, bottom: firstLineTop + 32 + lineHeight },
      { left: leftLineLeft, right: leftLineRight - 24, top: firstLineTop + 64, bottom: firstLineTop + 64 + lineHeight },
      { left: rightLineLeft, right: rightLineRight, top: firstLineTop + 64, bottom: firstLineTop + 64 + lineHeight },
      { left: leftLineLeft, right: selectedEndX, top: firstLineTop + 96, bottom: firstLineTop + 96 + lineHeight },
    ];
    selectionMockState.fragments = [
      { text: previousLine, left: leftLineLeft, top: 420, width: leftLineRight - leftLineLeft, height: lineHeight },
      { text: firstSelectedLine, left: leftLineLeft, top: firstLineTop, width: leftLineRight - leftLineLeft, height: lineHeight },
      { text: secondSelectedLine, left: leftLineLeft, top: firstLineTop + 32, width: leftLineRight - leftLineLeft, height: lineHeight },
      { text: rightLineA, left: rightLineLeft, top: firstLineTop + 32, width: rightLineRight - rightLineLeft, height: lineHeight },
      { text: thirdSelectedLine, left: leftLineLeft, top: firstLineTop + 64, width: leftLineRight - leftLineLeft - 24, height: lineHeight },
      { text: rightLineB, left: rightLineLeft, top: firstLineTop + 64, width: rightLineRight - rightLineLeft, height: lineHeight },
      { text: fourthSelectedLine, left: leftLineLeft, top: firstLineTop + 96, width: selectedEndX - leftLineLeft, height: lineHeight },
    ];
    selectionMockState.domSelection = {
      startFragment: previousLine,
      endFragment: fourthSelectedLine,
      startOffset: previousLine.indexOf('with equal'),
      endOffset: fourthSelectedLine.length,
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

    triggerPdfSelection('pane-left', {
      start: { x: selectedLeft + 1, y: firstLineTop + (lineHeight / 2) },
      end: { x: selectedEndX - 1, y: firstLineTop + 96 + (lineHeight / 2) },
    });
    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toContain('Fig. 5, that tend');
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });

    const annotation = addAnnotation.mock.calls[0][0];
    expect(annotation.target.textQuote.exact).toContain('Fig. 5, that tend');
    expect(annotation.target.textQuote.exact).not.toContain('where j');
    expect(annotation.target.textQuote.exact).not.toContain('dipole-dipole');
    expect(Math.max(...annotation.target.rects.map((rect: { x2: number }) => rect.x2))).toBeLessThan(0.55);
  });

  it('uses selection rect coverage for long Saffman abstract selections instead of truncating to the left fragment', async () => {
    const addAnnotation = vi.fn();
    pdfMockState.viewerMetrics.scrollTop = 0;
    pdfMockState.viewerMetrics.scrollLeft = 0;
    const lines = [
      'qubits. The availability of a strong long-range interaction that can',
      'an enabling resource for a wide range of quantum information tasks',
      'gate proposal. Rydberg enabled capabilities include long-range two-qubit gates,',
      'multiqubit registers, implementation of robust light-atom quantum interfaces,',
      'simulating quantum many-body physics. The advances of the last',
      'theoretical and experimental aspects of Rydberg-mediated quantum information processing.',
    ];
    const lineLeft = 46;
    const lineTop = 180;
    const lineHeight = 28;
    const charWidth = 6.4;
    const selectedText = lines.join(' ');
    const viewportLeft = (x: number) => x - pdfMockState.viewerMetrics.scrollLeft;
    const viewportTop = (y: number) => y - pdfMockState.viewerMetrics.scrollTop;

    selectionMockState.rawText = 'qubits. The availability of a strong long-range interaction that can be...';
    selectionMockState.position = {
      boundingRect: {
        x1: lineLeft,
        y1: lineTop,
        x2: lineLeft + 410,
        y2: lineTop + (lineHeight * lines.length),
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: lines.map((line, index) => ({
        x1: lineLeft,
        y1: lineTop + (index * lineHeight),
        x2: lineLeft + (line.length * charWidth),
        y2: lineTop + (index * lineHeight) + 22,
        width: 640,
        height: 960,
        pageNumber: 1,
      })),
      pageNumber: 1,
    };
    selectionMockState.clientRectsOverride = lines.map((line, index) => ({
      left: viewportLeft(lineLeft),
      right: viewportLeft(lineLeft + (line.length * charWidth)),
      top: viewportTop(lineTop + (index * lineHeight)),
      bottom: viewportTop(lineTop + (index * lineHeight) + 22),
    }));
    selectionMockState.fragments = lines.map((line, index) => ({
      text: line,
      left: lineLeft,
      top: lineTop + (index * lineHeight),
      width: line.length * charWidth,
      height: 22,
    }));
    selectionMockState.domSelection = {
      startFragment: lines[0],
      endFragment: lines[lines.length - 1],
      startOffset: 0,
      endOffset: lines[lines.length - 1].length,
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

    triggerPdfSelection('pane-left', {
      start: { x: viewportLeft(lineLeft + 1), y: viewportTop(lineTop + 11) },
      end: {
        x: viewportLeft(lineLeft + (lines[lines.length - 1].length * charWidth) - 1),
        y: viewportTop(lineTop + ((lines.length - 1) * lineHeight) + 11),
      },
    });
    await waitFor(() => {
      const preview = screen.getByTestId('pdf-selection-preview-pane-left').textContent ?? '';
      expect(preview).toContain('qubits. The availability');
      expect(preview).toContain('theoretical and experimental aspects');
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });

    const annotation = addAnnotation.mock.calls[0][0];
    expect(annotation.content).toContain('qubits. The availability');
    expect(annotation.content).toContain('theoretical and experimental aspects');
    expect(annotation.target.textQuote.exact).toContain('Rydberg-mediated quantum information processing');
    expect(annotation.target.rects).toHaveLength(lines.length);
    expect(Math.max(...annotation.target.rects.map((rect: { y1: number; y2: number }) => rect.y2 - rect.y1))).toBeLessThan(0.04);
    const orderedTops = annotation.target.rects.map((rect: { y1: number }) => rect.y1);
    expect(orderedTops).toEqual([...orderedTops].sort((left, right) => left - right));
  });

  it('rejects desktop native rects that would save highlight before the browser selection', async () => {
    const addAnnotation = vi.fn();
    const line = 'The development of scalable, high-fidelity qubits is a key challenge in quantum';
    const selectedText = 'scalable, high-fidelity';
    const lineLeft = 80;
    const lineTop = 560;
    const charWidth = 7.5;
    const selectedStart = line.indexOf(selectedText);
    const selectedLeft = lineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);
    const nativeDriftLeft = lineLeft - (selectedStart * charWidth);

    selectionMockState.rawText = selectedText;
    selectionMockState.position = {
      boundingRect: {
        x1: selectedLeft,
        y1: lineTop,
        x2: selectedRight,
        y2: lineTop + 22,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: selectedLeft, y1: lineTop, x2: selectedRight, y2: lineTop + 22, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.clientRectsOverride = [{
      left: selectedLeft,
      right: selectedRight,
      top: lineTop,
      bottom: lineTop + 22,
    }];
    selectionMockState.fragments = [
      { text: line, left: lineLeft, top: lineTop, width: line.length * charWidth, height: 22 },
    ];
    selectionMockState.domSelection = {
      startFragment: line,
      endFragment: line,
      startOffset: selectedStart,
      endOffset: selectedStart + selectedText.length,
    };
    nativeLayoutMockState.layout = {
      source: 'pdfium',
      pageNumber: 1,
      width: 640,
      height: 960,
      text: line,
      chars: Array.from(line).map((character, index) => ({
        charIndex: index,
        text: character,
        x1: nativeDriftLeft + (index * charWidth),
        y1: lineTop,
        x2: nativeDriftLeft + ((index + 1) * charWidth),
        y2: lineTop + 22,
        fontSize: 22,
      })),
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
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe(selectedText);
      expect(screen.getByTestId('pdf-selection-source-pane-left').textContent).not.toBe('pdfium-native');
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });

    const annotation = addAnnotation.mock.calls[0][0];
    expect(annotation.content).toBe(selectedText);
    expect(annotation.target.textQuote.exact).toBe(selectedText);
    expect(annotation.target.textQuote.source).not.toBe('pdfium-native');
    expect(annotation.target.rects.length).toBeGreaterThanOrEqual(1);
    const pdfPageWidth = 640;
    const rectUnion = getPdfRectUnion(annotation.target.rects);
    expect(rectUnion.x1).toBeCloseTo(selectedLeft / pdfPageWidth, 3);
    expect(rectUnion.x2).toBeCloseTo(selectedRight / pdfPageWidth, 3);
  });

  it('keeps visual browser selection authoritative when desktop native text resolves to a later paper sentence', async () => {
    const addAnnotation = vi.fn();
    const line = 'This architecture improves readout fidelity for neutral atom arrays in experiments';
    const selectedText = 'readout fidelity';
    const wrongNativeText = 'neutral atom arrays';
    const lineLeft = 72;
    const lineTop = 420;
    const charWidth = 7;
    const selectedStart = line.indexOf(selectedText);
    const selectedLeft = lineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);

    selectionMockState.rawText = selectedText;
    selectionMockState.position = {
      boundingRect: {
        x1: selectedLeft,
        y1: lineTop,
        x2: selectedRight,
        y2: lineTop + 22,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: selectedLeft, y1: lineTop, x2: selectedRight, y2: lineTop + 22, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.clientRectsOverride = [{
      left: selectedLeft,
      right: selectedRight,
      top: lineTop,
      bottom: lineTop + 22,
    }];
    selectionMockState.fragments = [
      { text: line, left: lineLeft, top: lineTop, width: line.length * charWidth, height: 22 },
    ];
    selectionMockState.domSelection = {
      startFragment: line,
      endFragment: line,
      startOffset: selectedStart,
      endOffset: selectedStart + selectedText.length,
    };
    nativeLayoutMockState.layout = {
      source: 'pdfium',
      pageNumber: 1,
      width: 640,
      height: 960,
      text: wrongNativeText,
      chars: Array.from(wrongNativeText).map((character, index) => ({
        charIndex: index,
        text: character,
        x1: selectedLeft + (index * charWidth),
        y1: lineTop,
        x2: selectedLeft + ((index + 1) * charWidth),
        y2: lineTop + 22,
        fontSize: 22,
      })),
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
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe(selectedText);
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).not.toContain('neutral');
      expect(screen.getByTestId('pdf-selection-source-pane-left').textContent).not.toBe('pdfium-native');
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });

    const annotation = addAnnotation.mock.calls[0][0];
    expect(annotation.content).toBe(selectedText);
    expect(annotation.target.textQuote.exact).toBe(selectedText);
    expect(annotation.target.textQuote.exact).not.toContain('neutral');
    const pdfPageWidth = 640;
    const rectUnion = getPdfRectUnion(annotation.target.rects);
    expect(rectUnion.x1).toBeCloseTo(selectedLeft / pdfPageWidth, 3);
    expect(rectUnion.x2).toBeCloseTo(selectedRight / pdfPageWidth, 3);
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

  it('keeps the frozen pointer snapshot when a later selectionchange drifts to a stray digit', async () => {
    const line = 'a single lattice site. Furthermore, we show how a Mott insulator';
    const selectedText = 'Furthermore';
    const lineLeft = 130;
    const lineTop = 288;
    const lineWidth = 620;
    const charWidth = lineWidth / line.length;
    const selectedStart = line.indexOf(selectedText);
    const selectedLeft = lineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);

    selectionMockState.fragments = [
      { text: '0', left: 540, top: 214, width: 12, height: 12 },
      { text: line, left: lineLeft, top: lineTop, width: lineWidth, height: 24 },
    ];
    selectionMockState.rawText = '0';
    selectionMockState.position = {
      boundingRect: {
        x1: 540,
        y1: 214,
        x2: 552,
        y2: 226,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: 540, y1: 214, x2: 552, y2: 226, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.domSelection = {
      startFragment: '0',
      endFragment: '0',
    };

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    const container = screen.getByTestId('pdf-scroll-container-pane-left');
    fireEvent.pointerDown(container, {
      clientX: selectedLeft + (charWidth * 2),
      clientY: lineTop + 12,
    });
    fireEvent.pointerMove(container, {
      clientX: selectedLeft + (charWidth * 2.4),
      clientY: lineTop + 12,
    });
    fireEvent.pointerUp(container, {
      clientX: selectedLeft + (charWidth * 2.4),
      clientY: lineTop + 12,
    });

    selectPdfFragmentSubstring(line, selectedText);
    dispatchSelectionChange();

    selectPdfFragmentSubstring('0', '0');
    selectionMockState.rawText = '0';
    selectionMockState.domSelection = {
      startFragment: '0',
      endFragment: '0',
    };
    selectionMockState.position = {
      boundingRect: {
        x1: 540,
        y1: 214,
        x2: 552,
        y2: 226,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: 540, y1: 214, x2: 552, y2: 226, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    dispatchSelectionChange();

    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe('Furthermore');
    });
  });

  it('keeps a pointer-defined Fig. 5 sentence when browser selection later includes neighboring lines', async () => {
    const previousLine = 'of states with equal and opposite E, as can be inferred';
    const firstLine = 'from Fig. 5, that tend to cause shifts in opposite direc-';
    const secondLine = 'tions. Even so, the electric field stability required to hold';
    const thirdLine = 'Stark shifts below 1 MHz is typically of order';
    const fourthLine = '0.01(100/n)7/2 V/cm.';
    const nextLine = 'In higher electric fields, mixing of opposite parity';
    const left = 80;
    const right = 510;
    const lineTop = 240;
    const lineGap = 32;
    const lineHeight = 24;
    const firstLineCharWidth = (right - left) / firstLine.length;
    const figStartX = left + (firstLine.indexOf('Fig. 5') * firstLineCharWidth);
    const endX = left + 172;
    const targetText = 'Fig. 5, that tend to cause shifts in opposite directions. Even so, the electric field stability required to hold Stark shifts below 1 MHz is typically of order 0.01(100/n)^(7/2) V/cm.';

    selectionMockState.fragments = [
      { text: previousLine, left, top: lineTop - lineGap, width: right - left, height: lineHeight },
      { text: firstLine, left, top: lineTop, width: right - left, height: lineHeight },
      { text: secondLine, left, top: lineTop + lineGap, width: right - left, height: lineHeight },
      { text: thirdLine, left, top: lineTop + lineGap * 2, width: right - left - 44, height: lineHeight },
      { text: fourthLine, left, top: lineTop + lineGap * 3, width: endX - left, height: lineHeight },
      { text: nextLine, left, top: lineTop + lineGap * 4, width: right - left, height: lineHeight },
    ];
    selectionMockState.rawText = [
      previousLine,
      firstLine,
      secondLine,
      thirdLine,
      fourthLine,
      nextLine,
    ].join(' ');
    selectionMockState.position = {
      boundingRect: {
        x1: left,
        y1: lineTop - lineGap,
        x2: right,
        y2: lineTop + lineGap * 4 + lineHeight,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: left, y1: lineTop - lineGap, x2: right, y2: lineTop - lineGap + lineHeight, width: 640, height: 960, pageNumber: 1 },
        { x1: figStartX, y1: lineTop, x2: right, y2: lineTop + lineHeight, width: 640, height: 960, pageNumber: 1 },
        { x1: left, y1: lineTop + lineGap, x2: right, y2: lineTop + lineGap + lineHeight, width: 640, height: 960, pageNumber: 1 },
        { x1: left, y1: lineTop + lineGap * 2, x2: right - 44, y2: lineTop + lineGap * 2 + lineHeight, width: 640, height: 960, pageNumber: 1 },
        { x1: left, y1: lineTop + lineGap * 3, x2: endX, y2: lineTop + lineGap * 3 + lineHeight, width: 640, height: 960, pageNumber: 1 },
        { x1: left, y1: lineTop + lineGap * 4, x2: right, y2: lineTop + lineGap * 4 + lineHeight, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.domSelection = {
      startFragment: previousLine,
      endFragment: nextLine,
    };
    selectionMockState.clientRectsOverride = [
      { left, right, top: lineTop - lineGap, bottom: lineTop - lineGap + lineHeight },
      { left: figStartX, right, top: lineTop, bottom: lineTop + lineHeight },
      { left, right, top: lineTop + lineGap, bottom: lineTop + lineGap + lineHeight },
      { left, right: right - 44, top: lineTop + lineGap * 2, bottom: lineTop + lineGap * 2 + lineHeight },
      { left, right: endX, top: lineTop + lineGap * 3, bottom: lineTop + lineGap * 3 + lineHeight },
      { left, right, top: lineTop + lineGap * 4, bottom: lineTop + lineGap * 4 + lineHeight },
    ];

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    triggerPdfSelection('pane-left', {
      start: { x: figStartX + 2, y: lineTop + lineHeight / 2 },
      end: { x: endX - 2, y: lineTop + lineGap * 3 + lineHeight / 2 },
    });

    await waitFor(() => {
      const preview = screen.getByTestId('pdf-selection-preview-pane-left').textContent ?? '';
      expect(preview).toContain('Fig. 5, that tend');
      expect(preview).toContain('V/cm.');
      expect(preview).not.toContain('of states with equal');
      expect(preview).not.toContain('In higher electric fields');
    });
    expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe(targetText);
  });

  it('keeps a word selection alive when selection text is empty but the range rect still exists', async () => {
    const line = 'apply the same trained model';
    const selectedText = 'trained';
    const lineLeft = 120;
    const lineTop = 240;
    const lineWidth = 320;
    const charWidth = lineWidth / line.length;
    const selectedStart = line.indexOf(selectedText);
    const selectedLeft = lineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);

    selectionMockState.fragments = [
      { text: line, left: lineLeft, top: lineTop, width: lineWidth, height: 24 },
    ];
    selectionMockState.rawText = '';
    selectionMockState.position = {
      boundingRect: {
        x1: selectedLeft,
        y1: lineTop,
        x2: selectedRight,
        y2: lineTop + 24,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: selectedLeft, y1: lineTop, x2: selectedRight, y2: lineTop + 24, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.domSelection = {
      startFragment: line,
      endFragment: line,
      startOffset: selectedStart,
      endOffset: selectedStart + selectedText.length,
    };

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    selectPdfFragmentSubstring(line, selectedText);
    triggerPdfSelection('pane-left', {
      start: { x: selectedLeft + 2, y: lineTop + 12 },
      end: { x: selectedRight - 2, y: lineTop + 12 },
    });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe(selectedText);
      expect(screen.getByTestId('pdf-selection-phase-pane-left').textContent).toBe('frozen');
    });
  });

  it('preserves drag selection when it passes over a link annotation', async () => {
    const line = 'Apply the same trained model from Task 1 to a new dataset';
    const selectedText = 'trained model';
    const lineLeft = 80;
    const lineTop = 180;
    const lineWidth = 520;
    const charWidth = lineWidth / line.length;
    const selectedStart = line.indexOf(selectedText);
    const selectedLeft = lineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);

    selectionMockState.fragments = [
      { text: line, left: lineLeft, top: lineTop, width: lineWidth, height: 24 },
    ];
    selectionMockState.rawText = selectedText;
    selectionMockState.position = {
      boundingRect: {
        x1: selectedLeft,
        y1: lineTop,
        x2: selectedRight,
        y2: lineTop + 24,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: selectedLeft, y1: lineTop, x2: selectedRight, y2: lineTop + 24, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.domSelection = {
      startFragment: line,
      endFragment: line,
      startOffset: selectedStart,
      endOffset: selectedStart + selectedText.length,
    };
    selectionMockState.linkLayer = {
      href: 'https://example.com/task1',
      left: selectedLeft + 8,
      top: lineTop,
      width: 60,
      height: 24,
    };

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    selectPdfFragmentSubstring(line, selectedText);
    triggerPdfSelection('pane-left', {
      start: { x: selectedLeft + 2, y: lineTop + 12 },
      end: { x: selectedRight - 2, y: lineTop + 12 },
    });

    fireEvent.click(screen.getByTestId('mock-pdf-link'));

    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe(selectedText);
      expect(screen.getByTestId('pdf-selection-phase-pane-left').textContent).toBe('frozen');
    });
  });

  it('prevents link dragstart after a text-selection drag crosses an annotation link', async () => {
    const line = 'Apply the same trained model from Task 1 to a new dataset';
    const selectedText = 'trained model';
    const lineLeft = 80;
    const lineTop = 180;
    const lineWidth = 520;
    const charWidth = lineWidth / line.length;
    const selectedStart = line.indexOf(selectedText);
    const selectedLeft = lineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);
    const onDragStart = vi.fn();

    selectionMockState.fragments = [
      { text: line, left: lineLeft, top: lineTop, width: lineWidth, height: 24 },
    ];
    selectionMockState.rawText = selectedText;
    selectionMockState.position = {
      boundingRect: {
        x1: selectedLeft,
        y1: lineTop,
        x2: selectedRight,
        y2: lineTop + 24,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: selectedLeft, y1: lineTop, x2: selectedRight, y2: lineTop + 24, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.domSelection = {
      startFragment: line,
      endFragment: line,
      startOffset: selectedStart,
      endOffset: selectedStart + selectedText.length,
    };
    selectionMockState.linkLayer = {
      href: 'https://example.com/task1',
      left: selectedLeft + 8,
      top: lineTop,
      width: 60,
      height: 24,
      onDragStart,
    };

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    selectPdfFragmentSubstring(line, selectedText);
    const container = screen.getByTestId('pdf-scroll-container-pane-left');
    fireEvent.pointerDown(container, {
      button: 0,
      clientX: selectedLeft + 2,
      clientY: lineTop + 12,
    });
    fireEvent.pointerMove(container, {
      button: 0,
      clientX: selectedRight - 2,
      clientY: lineTop + 12,
    });
    fireEvent.pointerUp(container, {
      button: 0,
      clientX: selectedRight - 2,
      clientY: lineTop + 12,
    });

    const dragStartEvent = createEvent.dragStart(screen.getByTestId('mock-pdf-link'));
    fireEvent(screen.getByTestId('mock-pdf-link'), dragStartEvent);

    expect(onDragStart).not.toHaveBeenCalled();
    expect(dragStartEvent.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe(selectedText);
    });
  });

  it('routes ordinary PDF web links through the Lattice link router', async () => {
    const onClick = vi.fn();

    selectionMockState.linkLayer = {
      href: 'https://example.com/task1',
      left: 120,
      top: 180,
      width: 60,
      height: 24,
      onClick,
    };

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    const clickEvent = createEvent.click(screen.getByTestId('mock-pdf-link'));
    fireEvent(screen.getByTestId('mock-pdf-link'), clickEvent);

    expect(onClick).not.toHaveBeenCalled();
    expect(clickEvent.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(navigateLinkMock).toHaveBeenCalledWith(
        'https://example.com/task1',
        expect.objectContaining({
          paneId: 'pane-left',
          currentFilePath: 'docs/paper-left.pdf',
          externalUrlMode: 'internal',
        }),
      );
    });
  });

  it('opens PDF web links in the browser for modifier clicks or browser setting', async () => {
    selectionMockState.linkLayer = {
      href: 'https://example.com/task1',
      left: 120,
      top: 180,
      width: 60,
      height: 24,
    };

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    fireEvent.click(screen.getByTestId('mock-pdf-link'), { ctrlKey: true });

    await waitFor(() => {
      expect(navigateLinkMock).toHaveBeenCalledWith(
        'https://example.com/task1',
        expect.objectContaining({ externalUrlMode: 'external' }),
      );
    });
  });

  it('jumps to internal PDF page links without opening a web tab', async () => {
    selectionMockState.linkLayer = {
      href: '#page=2',
      left: 120,
      top: 180,
      width: 60,
      height: 24,
    };

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    const viewerContainer = await waitForMockPdfViewerContainer('pane-left');
    const pageTwo = document.querySelector<HTMLElement>('[data-page-number="2"]');
    expect(pageTwo).toBeTruthy();
    configureMockPdfPageDom(pageTwo as HTMLElement, 2);

    fireEvent.click(screen.getByTestId('mock-pdf-link'));

    expect(navigateLinkMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(viewerContainer.scrollTo).toHaveBeenCalled();
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
      const left = Number.parseFloat(picker.parentElement.style.left || '0');
      const popupRight = left + 184;
      const popupBottom = top + 360;
      const selectionRect = selectionMockState.position.rects[0];
      const selectionLeft = selectionRect?.x1 ?? 0;
      const selectionTop = selectionRect?.y1 ?? 0;
      const selectionRight = selectionRect?.x2 ?? 0;
      const selectionBottom = selectionRect?.y2 ?? 0;
      const overlapsSelection = !(
        popupRight <= selectionLeft ||
        selectionRight <= left ||
        popupBottom <= selectionTop ||
        selectionBottom <= top
      );
      expect(overlapsSelection).toBe(false);
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
    const frozenCopyPayload = screen.getByTestId('pdf-copy-payload-pane-left').textContent ?? '';
    expect(frozenCopyPayload).not.toBe('');

    selectNativePdfText();
    expect(window.getSelection()?.toString()).toBe('Native PDF text');

    const clipboardData = { setData: vi.fn() };
    const copyEvent = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(copyEvent, 'clipboardData', {
      configurable: true,
      value: clipboardData,
    });

    document.dispatchEvent(copyEvent);
    expect(clipboardData.setData).toHaveBeenCalledWith('text/plain', frozenCopyPayload);
    expect(clipboardData.setData).not.toHaveBeenCalledWith('text/plain', 'Native PDF text');

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

  it('keeps the current anchor stable when toggling the PDF sidebar', async () => {
    useContentCacheStore.getState().saveEditorState('paper-left', {
      cursorPosition: 0,
      scrollTop: 240,
      scrollLeft: 48,
      viewState: {
        pdf: {
          scale: 1.2,
          zoomMode: 'fit-width',
          showSidebar: false,
        },
      },
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().commandBarByPane['pane-left']).toBeTruthy();
      expect(screen.getByTestId('pdf-anchor-page-pane-left').textContent).toBe('1');
    });

    const toggleSidebarAction = useWorkspaceStore
      .getState()
      .commandBarByPane['pane-left']
      ?.actions.find((item) => item.id === 'toggle-sidebar');
    expect(toggleSidebarAction).toBeTruthy();

    pdfMockState.viewerMetrics.width = 680;
    pdfMockState.viewerMetrics.scrollWidth = 1600;
    await act(async () => {
      toggleSidebarAction?.onTrigger?.();
      await Promise.resolve();
      triggerResizeObservers();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-restore-actual-page-pane-left').textContent).toBe('1');
      expect(Number(screen.getByTestId('pdf-restore-delta-top-pane-left').textContent)).toBeLessThan(0.01);
      expect(Number(screen.getByTestId('pdf-restore-delta-left-pane-left').textContent)).toBeLessThan(0.01);
    });
  });

  it('allows the PDF annotation sidebar to expand beyond the old narrow cap', async () => {
    useContentCacheStore.getState().saveEditorState('paper-left', {
      cursorPosition: 0,
      scrollTop: 0,
      scrollLeft: 0,
      viewState: {
        pdf: {
          scale: 1.2,
          zoomMode: 'fit-width',
          showSidebar: true,
        },
      },
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    const sidebar = await screen.findByTestId('mock-annotation-sidebar');
    const sidebarPanel = sidebar.closest<HTMLElement>('[style*="flex"]');
    expect(sidebarPanel?.style.flex).toContain('32 1 0%');

    const resizeHandle = screen.getByRole('separator', { name: 'Resize panels horizontally' });
    for (let index = 0; index < 8; index += 1) {
      fireEvent.keyDown(resizeHandle, { key: 'ArrowRight', shiftKey: true });
    }

    await waitFor(() => {
      expect(sidebarPanel?.style.flex).toContain('72 1 0%');
    });
  });

  it('replaces the browser PDF right-click menu with a Lattice PDF tools menu', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    const scrollContainer = await screen.findByTestId('pdf-scroll-container-pane-left');
    const contextMenuEvent = createEvent.contextMenu(scrollContainer, {
      clientX: 420,
      clientY: 260,
    });
    const preventDefault = vi.spyOn(contextMenuEvent, 'preventDefault');

    fireEvent(scrollContainer, contextMenuEvent);

    expect(preventDefault).toHaveBeenCalled();
    expect(await screen.findByTestId('pdf-viewer-context-menu')).toBeTruthy();
    expect(screen.getByText('PDF 工具')).toBeTruthy();
    expect(screen.getByTestId('pdf-context-menu-action-open-search')).toBeTruthy();
    expect(screen.getByTestId('pdf-context-menu-action-copy-page-reference')).toBeTruthy();
    expect(screen.getByTestId('pdf-context-menu-action-toggle-sidebar')).toBeTruthy();
    expect(screen.queryByTestId('pdf-context-menu-action-fit-width')).toBeNull();
    expect(screen.queryByTestId('pdf-context-menu-action-export-pdf')).toBeNull();
    expect(screen.queryByText('Save as')).toBeNull();
    expect(screen.queryByText('Share')).toBeNull();
    expect(screen.queryByText('Inspect')).toBeNull();
  });

  it('routes the PDF right-click search action without duplicating toolbar view controls', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    const scrollContainer = await screen.findByTestId('pdf-scroll-container-pane-left');

    fireEvent.contextMenu(scrollContainer, { clientX: 420, clientY: 260 });
    fireEvent.click(await screen.findByTestId('pdf-context-menu-action-open-search'));

    await waitFor(() => {
      const searchAction = useWorkspaceStore
        .getState()
        .commandBarByPane['pane-left']
        ?.actions.find((item) => item.id === 'search');
      expect(searchAction?.active).toBe(true);
    });

    fireEvent.contextMenu(scrollContainer, { clientX: 420, clientY: 260 });
    expect(screen.getByTestId('pdf-context-menu-action-toggle-sidebar')).toBeTruthy();
    expect(screen.queryByTestId('pdf-context-menu-action-fit-page')).toBeNull();
    expect(screen.queryByTestId('pdf-context-menu-action-reset-zoom')).toBeNull();
  });

  it('routes PDF right-click page actions to sidebar and page reference tools', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText,
      },
    });
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    const scrollContainer = await screen.findByTestId('pdf-scroll-container-pane-left');

    fireEvent.contextMenu(scrollContainer, { clientX: 420, clientY: 260 });
    fireEvent.click(await screen.findByTestId('pdf-context-menu-action-copy-page-reference'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('docs/paper-left.pdf#page=1');
    });

    fireEvent.contextMenu(scrollContainer, { clientX: 420, clientY: 260 });
    fireEvent.click(await screen.findByTestId('pdf-context-menu-action-toggle-sidebar'));

    expect(await screen.findByTestId('mock-annotation-sidebar')).toBeTruthy();
  });

  it('shows selection actions in the PDF right-click menu and commits highlight markup', async () => {
    const addAnnotation = vi.fn((annotation: Omit<AnnotationItem, 'id' | 'createdAt'>) => {
      expect(annotation).toBeTruthy();
      return 'ann-context-highlight';
    });
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
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe('Selected PDF text');
    });

    const scrollContainer = await screen.findByTestId('pdf-scroll-container-pane-left');
    fireEvent.contextMenu(scrollContainer, { clientX: 420, clientY: 260 });

    expect(await screen.findByTestId('pdf-context-menu-action-copy-selection')).toBeTruthy();
    expect(screen.getByTestId('pdf-context-menu-action-search-selection')).toBeTruthy();
    expect(screen.getByTestId('pdf-context-menu-action-highlight-selection')).toBeTruthy();
    expect(screen.getByTestId('pdf-context-menu-action-underline-selection')).toBeTruthy();
    expect(screen.getByTestId('pdf-context-menu-action-ask-ai-selection')).toBeTruthy();

    fireEvent.click(screen.getByTestId('pdf-context-menu-action-highlight-selection'));

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });
    const annotationDraft = addAnnotation.mock.calls[0]?.[0];
    expect(annotationDraft).toBeTruthy();
    expect(annotationDraft?.style.type).toBe('highlight');
    expect(annotationDraft?.content).toBe('Selected PDF text');
  });

  it('keeps the PDF search overlay open while interacting with its input', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    await waitFor(() => {
      expect(useWorkspaceStore.getState().commandBarByPane['pane-left']).toBeTruthy();
    });

    const searchAction = useWorkspaceStore
      .getState()
      .commandBarByPane['pane-left']
      ?.actions.find((item) => item.id === 'search');
    expect(searchAction).toBeTruthy();

    await act(async () => {
      searchAction?.onTrigger?.();
    });

    const overlay = await screen.findByTestId('pdf-search-overlay');
    const input = overlay.querySelector('input');
    expect(input).toBeTruthy();
    if (!input) {
      throw new Error('Missing PDF search input');
    }
    fireEvent.pointerDown(input);
    fireEvent.mouseDown(input);
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: 'Selected PDF' } });

    expect(overlay).toBeTruthy();
    await waitFor(() => {
      const activeSearchAction = useWorkspaceStore
        .getState()
        .commandBarByPane['pane-left']
        ?.actions.find((item) => item.id === 'search');
      expect(activeSearchAction?.active).toBe(true);
    });
  });

  it('keeps the PDF search overlay open when the command bar search button is triggered again', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().commandBarByPane['pane-left']).toBeTruthy();
    });

    const getSearchAction = () => useWorkspaceStore
      .getState()
      .commandBarByPane['pane-left']
      ?.actions.find((item) => item.id === 'search');

    await act(async () => {
      getSearchAction()?.onTrigger?.();
    });

    expect(await screen.findByTestId('pdf-search-overlay')).toBeTruthy();

    await act(async () => {
      getSearchAction()?.onTrigger?.();
    });

    expect(screen.getByTestId('pdf-search-overlay')).toBeTruthy();
  });

  it('passes annotation loading state to the PDF sidebar instead of showing an empty state', async () => {
    useContentCacheStore.getState().saveEditorState('paper-left', {
      cursorPosition: 0,
      scrollTop: 0,
      scrollLeft: 0,
      viewState: {
        pdf: {
          scale: 1.2,
          zoomMode: 'fit-width',
          showSidebar: true,
        },
      },
    });

    useAnnotationSystemMock.mockReturnValue({
      annotations: [],
      isLoading: true,
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(pdfMockState.sidebarProps).toBeTruthy();
      expect(pdfMockState.sidebarProps?.isLoading).toBe(true);
      expect(pdfMockState.sidebarProps?.annotations).toEqual([]);
    });
  });

  it('warms the cached anchor page on open so restored reading position does not start at page one only', async () => {
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

    useContentCacheStore.getState().saveEditorState('paper-left', {
      cursorPosition: 0,
      scrollTop: 4000,
      scrollLeft: 0,
      viewState: {
        pdf: {
          scale: 1.2,
          zoomMode: 'fit-width',
          showSidebar: false,
          anchor: {
            pageNumber: 5,
            pageOffsetTopRatio: 0.22,
            pageOffsetLeftRatio: 0.1,
            viewportAnchorY: 0.35,
            viewportAnchorX: 0.5,
            captureRevision: 3,
          },
        },
      },
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(screen.getByTestId('mock-react-pdf-page-5')).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-restore-expected-page-pane-left').textContent).toBe('5');
      expect(screen.getByTestId('pdf-restore-actual-page-pane-left').textContent).toBe('5');
      expect(screen.getByTestId('pdf-restore-status-pane-left').textContent).toBe('restored');
    });

    const viewerContainer = await waitForMockPdfViewerContainer('pane-left');
    const preciseRestoreCall = viewerContainer.scrollTo.mock.calls.find(([options]) => (
      typeof options?.top === 'number' &&
      options.top > 3800 &&
      options.top < 4300
    ));
    expect(preciseRestoreCall).toBeTruthy();
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

    const pageElement = await screen.findByTestId('mock-react-pdf-page-1');

    fireEvent.mouseDown(pageElement, { clientX: 80, clientY: 120 });
    fireEvent.mouseMove(pageElement, { clientX: 180, clientY: 220 });
    fireEvent.mouseUp(pageElement);

    expect(addAnnotation).toHaveBeenCalledTimes(1);
    expect(addAnnotation.mock.calls[0][0].style).toEqual({
      color: '#FF6666',
      type: 'area',
    });
  });

  it('saves new area annotations on the actual PDF page instead of falling back to page one', async () => {
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

    const areaAction = useWorkspaceStore
      .getState()
      .commandBarByPane['pane-left']
      ?.actions.find((item) => item.id === 'tool-area');
    if (!areaAction) {
      throw new Error('Missing area command bar action');
    }

    await act(async () => {
      areaAction.onTrigger?.();
    });

    const pageElement = await screen.findByTestId('mock-react-pdf-page-2');
    const pageRect = pageElement.getBoundingClientRect();
    const start = { x: pageRect.left + 64, y: pageRect.top + 40 };
    const end = { x: pageRect.left + 164, y: pageRect.top + 140 };

    fireEvent.mouseDown(pageElement, { clientX: start.x, clientY: start.y });
    fireEvent.mouseMove(pageElement, { clientX: end.x, clientY: end.y });
    fireEvent.mouseUp(pageElement);

    expect(addAnnotation).toHaveBeenCalledTimes(1);
    const annotation = addAnnotation.mock.calls[0][0];
    expect(annotation.target.page).toBe(2);
    expect(annotation.target.rects[0].x1).toBeCloseTo(64 / pageRect.width, 3);
    expect(annotation.target.rects[0].y1).toBeCloseTo(40 / pageRect.height, 3);
    expect(annotation.target.rects[0].x2).toBeCloseTo(164 / pageRect.width, 3);
    expect(annotation.target.rects[0].y2).toBeCloseTo(140 / pageRect.height, 3);
  });

  it('keeps area annotations on the drag-start page when mouseup happens outside the page element', async () => {
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

    const areaAction = useWorkspaceStore
      .getState()
      .commandBarByPane['pane-left']
      ?.actions.find((item) => item.id === 'tool-area');
    if (!areaAction) {
      throw new Error('Missing area command bar action');
    }

    await act(async () => {
      areaAction.onTrigger?.();
    });

    const pageElement = await screen.findByTestId('mock-react-pdf-page-2');
    const pageRect = pageElement.getBoundingClientRect();
    const start = { x: pageRect.left + 72, y: pageRect.top + 52 };
    const end = { x: pageRect.left + 222, y: pageRect.top + 172 };

    fireEvent.mouseDown(pageElement, { button: 0, clientX: start.x, clientY: start.y });
    fireEvent.mouseMove(document, { clientX: end.x, clientY: end.y });
    fireEvent.mouseUp(document, { clientX: end.x, clientY: end.y });

    expect(addAnnotation).toHaveBeenCalledTimes(1);
    const annotation = addAnnotation.mock.calls[0][0];
    expect(annotation.target.page).toBe(2);
    expect(annotation.target.rects[0].x1).toBeCloseTo(72 / pageRect.width, 3);
    expect(annotation.target.rects[0].y1).toBeCloseTo(52 / pageRect.height, 3);
    expect(annotation.target.rects[0].x2).toBeCloseTo(222 / pageRect.width, 3);
    expect(annotation.target.rects[0].y2).toBeCloseTo(172 / pageRect.height, 3);
  });

  it('draws a new area annotation even when the drag starts over an existing text markup annotation', async () => {
    const addAnnotation = vi.fn();
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-existing-highlight',
          target: {
            type: 'pdf',
            page: 1,
            rects: [{ x1: 0.08, y1: 0.10, x2: 0.36, y2: 0.18 }],
          },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: 'existing highlight',
          author: 'user',
          createdAt: 1,
        },
      ],
      error: null,
      addAnnotation,
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitUntil(() => Boolean(useWorkspaceStore.getState().commandBarByPane['pane-left']), 'Command bar did not register');

    const areaAction = useWorkspaceStore
      .getState()
      .commandBarByPane['pane-left']
      ?.actions.find((item) => item.id === 'tool-area');
    if (!areaAction) {
      throw new Error('Missing area command bar action');
    }

    await act(async () => {
      areaAction.onTrigger?.();
    });

    await waitUntil(() => {
      const nextAreaAction = useWorkspaceStore
        .getState()
        .commandBarByPane['pane-left']
        ?.actions.find((item) => item.id === 'tool-area');
      return nextAreaAction?.active === true;
    }, 'Area tool did not become active');

    await waitUntil(() => Boolean(document.querySelector('[data-testid="mock-react-pdf-page-1"]')), 'Mock page 1 did not render');
    const pageElement = document.querySelector<HTMLElement>('[data-testid="mock-react-pdf-page-1"]');
    if (!pageElement) {
      throw new Error('Missing mock page 1');
    }
    const pageRect = pageElement.getBoundingClientRect();
    const start = { x: pageRect.left + 80, y: pageRect.top + 120 };
    const end = { x: pageRect.left + 210, y: pageRect.top + 235 };

    const scrollContainer = document.querySelector<HTMLElement>('[data-testid="pdf-scroll-container-pane-left"]');
    if (!scrollContainer) {
      throw new Error('Missing PDF scroll container');
    }

    fireEvent.pointerDown(pageElement, {
      button: 0,
      clientX: start.x,
      clientY: start.y,
    });
    fireEvent.mouseDown(pageElement, { clientX: start.x, clientY: start.y });
    await waitUntil(
      () => Boolean(document.querySelector('[data-testid="pdf-area-selection-draft-page-1"]')),
      'Area drag did not create a draft rectangle',
    );
    fireEvent.mouseMove(pageElement, { clientX: end.x, clientY: end.y });
    fireEvent.mouseUp(pageElement);

    expect(addAnnotation).toHaveBeenCalledTimes(1);
    const annotation = addAnnotation.mock.calls[0][0];
    expect(annotation.style.type).toBe('area');
    expect(annotation.target.page).toBe(1);
    expect(annotation.target.rects[0].x1).toBeCloseTo(80 / pageRect.width, 3);
  });

  it('does not let an existing area annotation steal text-selection drags', async () => {
    const line = 'For small dc electric fields E such that the dipole couplings';
    const selectedText = 'electric fields E';
    const lineLeft = 80;
    const lineTop = 220;
    const lineWidth = 520;
    const charWidth = lineWidth / line.length;
    const selectedStart = line.indexOf(selectedText);
    const selectedLeft = lineLeft + (selectedStart * charWidth);
    const selectedRight = selectedLeft + (selectedText.length * charWidth);

    selectionMockState.fragments = [
      { text: line, left: lineLeft, top: lineTop, width: lineWidth, height: 24 },
    ];
    selectionMockState.rawText = selectedText;
    selectionMockState.position = {
      boundingRect: {
        x1: selectedLeft,
        y1: lineTop,
        x2: selectedRight,
        y2: lineTop + 24,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: selectedLeft, y1: lineTop, x2: selectedRight, y2: lineTop + 24, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.domSelection = {
      startFragment: line,
      endFragment: line,
      startOffset: selectedStart,
      endOffset: selectedStart + selectedText.length,
    };
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-area-over-text',
          target: {
            type: 'pdf',
            page: 1,
            rects: [{ x1: 0.05, y1: 0.20, x2: 0.92, y2: 0.28 }],
          },
          style: { color: '#4CAF50', type: 'area' },
          content: 'area over text',
          author: 'user',
          createdAt: 1,
        },
      ],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    selectPdfFragmentSubstring(line, selectedText);
    triggerPdfSelection('pane-left', {
      start: { x: selectedLeft + 2, y: lineTop + 12 },
      end: { x: selectedRight - 2, y: lineTop + 12 },
    });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe(selectedText);
      expect(screen.queryByTestId('pdf-annotation-menu-ann-area-over-text')).toBeNull();
    });
  });

  it('upgrades legacy thin PDF ink width to a clearer default on mount', async () => {
    inkStoreState.currentStyle = { color: '#ffeb3b', width: 2 };

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(inkStoreState.setCurrentStyle).toHaveBeenCalledWith({ width: 5 });
    });
  });

  it('exposes professional underline style defaults from the underline tool menu', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().commandBarByPane['pane-left']).toBeTruthy();
    });

    const underlineAction = useWorkspaceStore
      .getState()
      .commandBarByPane['pane-left']
      ?.actions.find((item) => item.id === 'tool-underline');
    if (!underlineAction) {
      throw new Error('Missing underline command bar action');
    }

    await act(async () => {
      underlineAction.onContextMenu?.({ x: 32, y: 48 });
    });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-annotation-defaults-menu')).toBeTruthy();
    });

    expect(screen.getByText('直线')).toBeTruthy();
    expect(screen.getByText('波浪线')).toBeTruthy();
    expect(screen.getByText('双线')).toBeTruthy();
    expect(screen.getByText('虚线')).toBeTruthy();
  });

  it('keeps finished ink strokes visible while they wait for merge finalization', async () => {
    useAnnotationSystemMock.mockReturnValue({
      annotations: [],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().commandBarByPane['pane-left']).toBeTruthy();
    });

    const inkAction = useWorkspaceStore.getState().commandBarByPane['pane-left']?.actions.find((item) => item.id === 'tool-draw');
    if (!inkAction) {
      throw new Error('Missing ink command bar action');
    }

    await act(async () => {
      inkAction.onTrigger?.();
    });

    const pageElement = await screen.findByTestId('mock-react-pdf-page-1');

    fireEvent.mouseDown(pageElement, { clientX: 120, clientY: 140 });
    fireEvent.mouseMove(pageElement, { clientX: 180, clientY: 200 });
    fireEvent.mouseUp(pageElement);

    await waitFor(() => {
      expect(inkHookState.addStroke).toHaveBeenCalledTimes(1);
    });

    expect(inkHookState.addStroke.mock.calls[0][0]).toMatchObject({
      width: inkStoreState.currentStyle.width,
    });
    expect(document.querySelector('[data-testid="pdf-pending-ink-strokes"]')).toBeTruthy();
    expect(document.body.textContent).not.toContain('绘制中');
  });

  it('keeps the live ink overlay mounted while the stroke path changes', async () => {
    useAnnotationSystemMock.mockReturnValue({
      annotations: [],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().commandBarByPane['pane-left']).toBeTruthy();
    });

    const inkAction = useWorkspaceStore.getState().commandBarByPane['pane-left']?.actions.find((item) => item.id === 'tool-draw');
    if (!inkAction) {
      throw new Error('Missing ink command bar action');
    }

    await act(async () => {
      inkAction.onTrigger?.();
    });

    const pageElement = await screen.findByTestId('mock-react-pdf-page-1');

    fireEvent.mouseDown(pageElement, { clientX: 120, clientY: 140 });
    fireEvent.mouseMove(pageElement, { clientX: 180, clientY: 200 });
    await act(async () => {
      await Promise.resolve();
    });

    const firstOverlay = pageElement.querySelector('.current-ink-overlay');
    expect(firstOverlay).toBeTruthy();

    fireEvent.mouseMove(pageElement, { clientX: 220, clientY: 240 });
    await act(async () => {
      await Promise.resolve();
    });

    expect(pageElement.querySelector('.current-ink-overlay')).toBe(firstOverlay);
  });

  it('erases a saved ink stroke as a first-class PDF tool', async () => {
    const updateAnnotation = vi.fn();
    const deleteAnnotation = vi.fn();
    const inkAnnotation = {
      id: 'ink-ann',
      target: {
        type: 'pdf',
        page: 1,
        rects: [{ x1: 0.18, y1: 0.18, x2: 0.34, y2: 0.28 }],
      },
      style: { color: '#FFCC00', type: 'ink' },
      content: JSON.stringify({
        paths: [[
          { x: 0.2, y: 0.2 },
          { x: 0.25, y: 0.24 },
          { x: 0.3, y: 0.26 },
        ]],
        width: 5,
      }),
      author: 'user',
      createdAt: 1,
    } as const;

    useAnnotationSystemMock.mockReturnValue({
      annotations: [inkAnnotation],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation,
      deleteAnnotation,
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().commandBarByPane['pane-left']).toBeTruthy();
    });

    const eraserAction = useWorkspaceStore.getState().commandBarByPane['pane-left']?.actions.find((item) => item.id === 'tool-eraser');
    if (!eraserAction) {
      throw new Error('Missing eraser command bar action');
    }

    await act(async () => {
      eraserAction.onTrigger?.();
    });

    const pageElement = await screen.findByTestId('mock-react-pdf-page-1');

    const pageRect = pageElement.getBoundingClientRect();
    fireEvent.mouseDown(pageElement, {
      clientX: pageRect.left + (pageRect.width * 0.25),
      clientY: pageRect.top + (pageRect.height * 0.24),
    });
    fireEvent.mouseUp(pageElement);

    expect(inkHookState.finalizeNow).toHaveBeenCalledTimes(1);
    expect(deleteAnnotation).toHaveBeenCalledWith('ink-ann');
    expect(updateAnnotation.mock.calls.every(([, patch]) => (
      patch &&
      typeof patch === 'object' &&
      'preview' in patch &&
      Object.keys(patch).length === 1
    ))).toBe(true);
  });

  it('deletes a non-ink PDF annotation when the eraser clicks it', async () => {
    const deleteAnnotation = vi.fn();
    const annotation = {
      id: 'area-ann',
      target: {
        type: 'pdf',
        page: 1,
        rects: [{ x1: 0.18, y1: 0.18, x2: 0.34, y2: 0.28 }],
      },
      style: { color: '#FFCC00', type: 'area' },
      content: 'area note',
      author: 'user',
      createdAt: 1,
    } as const;

    useAnnotationSystemMock.mockReturnValue({
      annotations: [annotation],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation: vi.fn(),
      deleteAnnotation,
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().commandBarByPane['pane-left']).toBeTruthy();
    });

    const eraserAction = useWorkspaceStore.getState().commandBarByPane['pane-left']?.actions.find((item) => item.id === 'tool-eraser');
    if (!eraserAction) {
      throw new Error('Missing eraser command bar action');
    }

    await act(async () => {
      eraserAction.onTrigger?.();
    });

    const segment = await screen.findByTestId('pdf-stored-annotation-segment-area-ann-0');
    fireEvent.click(segment);

    expect(deleteAnnotation).toHaveBeenCalledWith('area-ann');
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

    const viewerContainer = await waitForMockPdfViewerContainer('pane-left');
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
          Math.abs(options.top - 0) < 0.01 &&
          options.left !== undefined &&
          Math.abs(options.left - 0) < 0.01
        );
      });
      expect(matchedCall).toBeTruthy();
    });
  });

  it('registers a search action in the PDF command bar', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().commandBarByPane['pane-left']).toBeTruthy();
    });

    const searchAction = useWorkspaceStore
      .getState()
      .commandBarByPane['pane-left']
      ?.actions.find((item) => item.id === 'search');

    expect(searchAction).toBeTruthy();
    expect(searchAction?.active).toBe(false);
    expect(searchAction?.group).toBe('utility');

    const zoomInAction = useWorkspaceStore
      .getState()
      .commandBarByPane['pane-left']
      ?.actions.find((item) => item.id === 'zoom-in');
    const zoomOutAction = useWorkspaceStore
      .getState()
      .commandBarByPane['pane-left']
      ?.actions.find((item) => item.id === 'zoom-out');
    const exportOriginalAction = useWorkspaceStore
      .getState()
      .commandBarByPane['pane-left']
      ?.actions.find((item) => item.id === 'export-original');
    const exportAnnotatedAction = useWorkspaceStore
      .getState()
      .commandBarByPane['pane-left']
      ?.actions.find((item) => item.id === 'export-annotated');

    expect(zoomInAction?.group).toBe('overflow');
    expect(zoomOutAction?.group).toBe('overflow');
    expect(exportOriginalAction?.group).toBe('overflow');
    expect(exportAnnotatedAction?.group).toBe('overflow');

    await act(async () => {
      searchAction?.onTrigger?.();
    });

    await waitFor(() => {
      const updated = useWorkspaceStore
        .getState()
        .commandBarByPane['pane-left']
        ?.actions.find((item) => item.id === 'search');
      expect(updated?.active).toBe(true);
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

    const viewerContainer = await waitForMockPdfViewerContainer('pane-left');
    viewerContainer.scrollTo.mockClear();

    await act(async () => {
      const onSelect = pdfMockState.sidebarProps?.onSelect as ((annotationItem: typeof annotation) => void);
      onSelect(annotation);
      await Promise.resolve();
    });

    let activeViewerContainer = viewerContainer;
    await waitFor(() => {
      expect(screen.getByTestId('mock-react-pdf-page-5')).toBeTruthy();
      activeViewerContainer = document.querySelector(`[data-testid="pdf-viewer-container-pane-left"]`) as typeof viewerContainer;
      expect(activeViewerContainer.scrollTo).toHaveBeenCalled();
    });

    await waitFor(() => {
      const preciseCall = activeViewerContainer.scrollTo.mock.calls.find((call) => {
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

    const viewerContainer = await waitForMockPdfViewerContainer('pane-left');
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

  it('uses a page hint while waiting for a pending PDF annotation target', async () => {
    let loadedAnnotations: AnnotationItem[] = [];

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
        annotationId: 'ann-page-hint',
        page: 2,
      },
    });

    const { rerender } = render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    const viewerContainer = await waitForMockPdfViewerContainer('pane-left');

    await waitFor(() => {
      const pageHintScroll = viewerContainer.scrollTo.mock.calls.find((call) => {
        const options = call[0] as { top?: number; left?: number } | undefined;
        return options?.top !== undefined && options.top > 800 && options.left === 0;
      });
      expect(pageHintScroll).toBeTruthy();
    });

    loadedAnnotations = [{
      id: 'ann-page-hint',
      target: {
        type: 'pdf',
        page: 2,
        rects: [{ x1: 0.25, y1: 0.30, x2: 0.45, y2: 0.36 }],
      },
      style: { color: '#FFEB3B', type: 'highlight' },
      content: 'delayed annotation',
      author: 'user',
      createdAt: 1,
    }];
    rerender(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(pdfMockState.sidebarProps?.selectedId).toBe('ann-page-hint');
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

    const highlightSegment = document.querySelector<HTMLElement>('.pdf-stored-annotation-overlay-ann-highlight [data-pdf-stored-annotation-segment="true"]');
    const underlineSegment = document.querySelector<HTMLElement>('.pdf-stored-annotation-overlay-ann-underline [data-pdf-stored-annotation-segment="true"]');
    const areaSegment = document.querySelector<HTMLElement>('.pdf-stored-annotation-overlay-ann-area [data-pdf-stored-annotation-segment="true"]');
    const textSegment = document.querySelector<HTMLElement>('.text-overlay-ann-text [data-pdf-text-annotation-content="true"]');
    const inkSegment = document.querySelector('.ink-overlay-ann-ink [data-pdf-ink-annotation-segment="true"]');

    expect(highlightSegment?.dataset.pdfStoredAnnotationType).toBe('highlight');
    expect(highlightSegment?.style.mixBlendMode).toBe('multiply');
    expect(highlightSegment?.style.opacity).toBe('1');
    expect(highlightSegment?.style.backgroundColor).toContain('rgba');
    expect(underlineSegment?.dataset.pdfStoredAnnotationType).toBe('underline');
    expect(underlineSegment?.style.opacity).toBe('1');
    expect(underlineSegment?.style.backgroundImage).toContain('linear-gradient');
    expect(areaSegment?.dataset.pdfStoredAnnotationType).toBe('area');
    expect(textSegment?.dataset.pdfTextAnnotationId).toBe('ann-text');
    expect(inkSegment).toBeTruthy();
  });

  it('anchors stored underline strokes below the text segment instead of at the segment top', async () => {
    const underlineStyles = ['solid', 'dashed', 'double', 'wavy'] as const;

    useAnnotationSystemMock.mockReturnValue({
      annotations: underlineStyles.map((underlineStyle, index) => ({
        id: `ann-${underlineStyle}`,
        target: {
          type: 'pdf' as const,
          page: 1,
          rects: [{ x1: 0.10, y1: 0.10 + index * 0.06, x2: 0.36, y2: 0.14 + index * 0.06 }],
        },
        style: {
          color: '#2196F3',
          type: 'underline' as const,
          underlineStyle,
        },
        content: underlineStyle,
        author: 'user',
        createdAt: index + 1,
      })),
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    for (const underlineStyle of underlineStyles) {
      const segment = await waitFor(() => {
        const element = document.querySelector<HTMLElement>(`[data-testid="pdf-stored-annotation-segment-ann-${underlineStyle}-0"]`);
        expect(element).toBeTruthy();
        return element as HTMLElement;
      });

      expect(segment.style.backgroundPosition).toContain('calc(100%');
      expect(segment.style.backgroundPosition).not.toBe('left 0px');
    }
  });

  it('renders area annotations from the original page-relative rectangle without text-row merging', async () => {
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-area-precise',
          target: { type: 'pdf', page: 1, rects: [{ x1: 0.10, y1: 0.20, x2: 0.28, y2: 0.30 }] },
          style: { color: '#4CAF50', type: 'area' },
          content: 'area',
          author: 'user',
          createdAt: 1,
        },
      ],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    const areaOverlay = await waitFor(() => {
      const overlay = document.querySelector<HTMLElement>('.pdf-stored-annotation-overlay-ann-area-precise div[style*="position: absolute"]');
      expect(overlay).toBeTruthy();
      return overlay as HTMLElement;
    });

    expect(Number.parseFloat(areaOverlay.style.left)).toBeCloseTo(10, 6);
    expect(Number.parseFloat(areaOverlay.style.top)).toBeCloseTo(20, 6);
    expect(Number.parseFloat(areaOverlay.style.width)).toBeCloseTo(18, 6);
    expect(Number.parseFloat(areaOverlay.style.height)).toBeCloseTo(10, 6);
  });

  it('resizes a stored area annotation by dragging a corner handle', async () => {
    const updateAnnotation = vi.fn();
    const annotation = {
      id: 'ann-area-resize',
      target: { type: 'pdf' as const, page: 1, rects: [{ x1: 0.10, y1: 0.20, x2: 0.28, y2: 0.30 }] },
      style: { color: '#4CAF50', type: 'area' as const },
      content: 'area',
      author: 'user',
      createdAt: 1,
    };
    useAnnotationSystemMock.mockReturnValue({
      annotations: [annotation],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation,
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    const areaSegment = await waitFor(() => {
      const segment = document.querySelector<HTMLElement>(
        '.pdf-stored-annotation-overlay-ann-area-resize [data-pdf-stored-annotation-segment="true"]',
      );
      expect(segment).toBeTruthy();
      return segment as HTMLElement;
    });
    fireEvent.pointerDown(areaSegment, { button: 0, clientX: 116, clientY: 240, pointerId: 1 });
    fireEvent.click(areaSegment, { clientX: 116, clientY: 240 });

    const seHandle = await screen.findByLabelText('Adjust area se');
    expect(seHandle.getAttribute('data-pdf-stored-annotation-id')).toBe('ann-area-resize');
    const overlayContainer = document.querySelector<HTMLElement>('.pdf-stored-annotation-overlay-ann-area-resize');
    expect(overlayContainer?.style.pointerEvents).toBe('auto');
    const page = screen.getByTestId('mock-react-pdf-page-1');
    const pageRect = page.getBoundingClientRect();
    fireEvent.pointerDown(seHandle, {
      button: 0,
      clientX: pageRect.left + (0.28 * pageRect.width),
      clientY: pageRect.top + (0.30 * pageRect.height),
      pointerId: 7,
    });
    fireEvent.pointerMove(document, {
      clientX: pageRect.left + (0.34 * pageRect.width),
      clientY: pageRect.top + (0.36 * pageRect.height),
      pointerId: 7,
    });
    fireEvent.pointerUp(document, {
      clientX: pageRect.left + (0.34 * pageRect.width),
      clientY: pageRect.top + (0.36 * pageRect.height),
      pointerId: 7,
    });

    await waitFor(() => {
      expect(updateAnnotation).toHaveBeenCalled();
    });
    const lastCall = updateAnnotation.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe('ann-area-resize');
    expect(lastCall?.[1]?.target?.rects?.[0]).toMatchObject({
      x1: 0.10,
      y1: 0.20,
      x2: 0.34,
      y2: 0.36,
    });
  });

  it('moves a stored area annotation by dragging the selected area body', async () => {
    const updateAnnotation = vi.fn();
    const annotation = {
      id: 'ann-area-move',
      target: { type: 'pdf' as const, page: 1, rects: [{ x1: 0.10, y1: 0.20, x2: 0.30, y2: 0.35 }] },
      style: { color: '#4CAF50', type: 'area' as const },
      content: 'area',
      author: 'user',
      createdAt: 1,
    };
    useAnnotationSystemMock.mockReturnValue({
      annotations: [annotation],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation,
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    const areaSegment = await waitFor(() => {
      const segment = document.querySelector<HTMLElement>(
        '.pdf-stored-annotation-overlay-ann-area-move [data-pdf-stored-annotation-segment="true"]',
      );
      expect(segment).toBeTruthy();
      return segment as HTMLElement;
    });

    fireEvent.pointerDown(areaSegment, { button: 0, clientX: 128, clientY: 240, pointerId: 11 });
    fireEvent.click(areaSegment, { clientX: 128, clientY: 240 });

    await waitFor(() => {
      expect(areaSegment.getAttribute('data-pdf-annotation-area-handle')).toBe('move');
    });

    const page = screen.getByTestId('mock-react-pdf-page-1');
    const pageRect = page.getBoundingClientRect();
    fireEvent.pointerDown(areaSegment, {
      button: 0,
      clientX: pageRect.left + (0.20 * pageRect.width),
      clientY: pageRect.top + (0.275 * pageRect.height),
      pointerId: 12,
    });
    fireEvent.pointerMove(document, {
      clientX: pageRect.left + (0.25 * pageRect.width),
      clientY: pageRect.top + (0.325 * pageRect.height),
      pointerId: 12,
    });
    fireEvent.pointerUp(document, {
      clientX: pageRect.left + (0.25 * pageRect.width),
      clientY: pageRect.top + (0.325 * pageRect.height),
      pointerId: 12,
    });

    await waitFor(() => {
      expect(updateAnnotation).toHaveBeenCalled();
    });
    const lastCall = updateAnnotation.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe('ann-area-move');
    const movedRect = lastCall?.[1]?.target?.rects?.[0];
    expect(movedRect?.x1).toBeCloseTo(0.15, 6);
    expect(movedRect?.y1).toBeCloseTo(0.25, 6);
    expect(movedRect?.x2).toBeCloseTo(0.35, 6);
    expect(movedRect?.y2).toBeCloseTo(0.40, 6);
  });

  it('closes the stored annotation popup when clicking another PDF location', async () => {
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-click-close',
          target: { type: 'pdf', page: 1, rects: [{ x1: 0.10, y1: 0.10, x2: 0.30, y2: 0.14 }] },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: 'click close highlight',
          author: 'user',
          createdAt: 1,
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
      expect(document.querySelector('.pdf-stored-annotation-overlay-ann-click-close')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mock-react-pdf-page-1'), {
      clientX: 120,
      clientY: 125,
    });

    await waitFor(() => {
      expect(document.querySelector('[data-pdf-annotation-menu="ann-click-close"]')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mock-react-pdf-page-1'), {
      clientX: 520,
      clientY: 520,
    });

    await waitFor(() => {
      expect(document.querySelector('[data-pdf-annotation-menu="ann-click-close"]')).toBeNull();
    });
  });

  it('opens stored annotation settings even while creation tools are active', async () => {
    const addAnnotation = vi.fn();
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-tool-hit',
          target: { type: 'pdf', page: 1, rects: [{ x1: 0.10, y1: 0.10, x2: 0.30, y2: 0.14 }] },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: 'tool hit highlight',
          author: 'user',
          createdAt: 1,
        },
      ],
      error: null,
      addAnnotation,
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    await waitFor(() => {
      expect(document.querySelector('.pdf-stored-annotation-overlay-ann-tool-hit')).toBeTruthy();
    });

    const getAction = (id: string) => {
      const action = useWorkspaceStore.getState().commandBarByPane['pane-left']?.actions.find((item) => item.id === id);
      if (!action) {
        throw new Error(`Missing command bar action: ${id}`);
      }
      return action;
    };

    for (const toolId of ['tool-note', 'tool-text', 'tool-area', 'tool-draw']) {
      await act(async () => {
        getAction(toolId).onTrigger?.();
      });

      const page = screen.getByTestId('mock-react-pdf-page-1');
      fireEvent.mouseDown(page, { clientX: 120, clientY: 125 });
      fireEvent.mouseUp(page, { clientX: 120, clientY: 125 });
      fireEvent.click(page, { clientX: 120, clientY: 125 });

      await waitFor(() => {
        expect(document.querySelector('[data-pdf-annotation-menu="ann-tool-hit"]')).toBeTruthy();
      });

      fireEvent.click(page, { clientX: 520, clientY: 520 });
      await waitFor(() => {
        expect(document.querySelector('[data-pdf-annotation-menu="ann-tool-hit"]')).toBeNull();
      });
    }

    expect(addAnnotation).not.toHaveBeenCalled();
    expect(inkHookState.addStroke).not.toHaveBeenCalled();
  });

  it('opens an existing PDF annotation before a live text selection can steal the click', async () => {
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-existing-priority',
          target: { type: 'pdf', page: 1, rects: [{ x1: 0.10, y1: 0.10, x2: 0.30, y2: 0.14 }] },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: 'existing highlight',
          author: 'user',
          createdAt: 1,
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
      expect(document.querySelector('.pdf-stored-annotation-overlay-ann-existing-priority')).toBeTruthy();
    });

    applyMockTextLayerSelection();
    expect(window.getSelection()?.toString().trim()).toBeTruthy();

    const page = screen.getByTestId('mock-react-pdf-page-1');
    fireEvent.pointerDown(page, { pointerId: 1, clientX: 120, clientY: 125 });
    fireEvent.pointerUp(page, { pointerId: 1, clientX: 120, clientY: 125 });
    fireEvent.click(page, { clientX: 120, clientY: 125 });

    await waitFor(() => {
      expect(document.querySelector('[data-pdf-annotation-menu="ann-existing-priority"]')).toBeTruthy();
    });
    expect(document.querySelector('.pdf-selection-color-picker')).toBeNull();
    expect(window.getSelection()?.toString()).toBe('');
  });

  it('shows the complete stored PDF quote in the annotation menu', async () => {
    const longQuote = 'Fig. 5, that tend to cause shifts in opposite directions when the electric field stability changes near the selected Rydberg transition';

    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-long-menu-quote',
          target: {
            type: 'pdf',
            page: 1,
            rects: [{ x1: 0.10, y1: 0.10, x2: 0.30, y2: 0.14 }],
            textQuote: {
              exact: longQuote,
              prefix: '',
              suffix: '',
              source: 'pdfjs-text-model',
              confidence: 'exact',
            },
          },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: longQuote,
          author: 'user',
          createdAt: 1,
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
      expect(document.querySelector('.pdf-stored-annotation-overlay-ann-long-menu-quote')).toBeTruthy();
    });

    const page = screen.getByTestId('mock-react-pdf-page-1');
    fireEvent.click(page, { clientX: 120, clientY: 125 });

    const menu = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('[data-pdf-annotation-menu="ann-long-menu-quote"]');
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });

    expect(menu.textContent).toContain(longQuote);
    expect(menu.textContent).not.toContain('...');
  });

  it('opens an existing text annotation editor before a live text selection can steal the click', async () => {
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-existing-text-priority',
          target: { type: 'pdf', page: 1, rects: [{ x1: 0.10, y1: 0.36, x2: 0.24, y2: 0.40 }] },
          style: {
            color: '#FFFFFF',
            type: 'text',
            textStyle: { textColor: '#111111', fontSize: 14 },
          },
          content: 'existing text note',
          author: 'user',
          createdAt: 1,
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
      expect(document.querySelector('.text-overlay-ann-existing-text-priority')).toBeTruthy();
    });

    applyMockTextLayerSelection();
    expect(window.getSelection()?.toString().trim()).toBeTruthy();

    const page = screen.getByTestId('mock-react-pdf-page-1');
    fireEvent.pointerDown(page, { pointerId: 1, clientX: 128, clientY: 365 });
    fireEvent.pointerUp(page, { pointerId: 1, clientX: 128, clientY: 365 });
    fireEvent.click(page, { clientX: 128, clientY: 365 });

    await waitFor(() => {
      expect(screen.getByDisplayValue('existing text note')).toBeTruthy();
    });
    expect(document.querySelector('.pdf-selection-color-picker')).toBeNull();
    expect(window.getSelection()?.toString()).toBe('');
  });

  it('opens stored underline settings when clicking near a thin text-markup segment', async () => {
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-thin-underline',
          target: { type: 'pdf', page: 1, rects: [{ x1: 0.20, y1: 0.100, x2: 0.42, y2: 0.106 }] },
          style: { color: '#2196F3', type: 'underline', underlineStyle: 'solid' },
          content: 'thin underline',
          author: 'user',
          createdAt: 1,
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
      expect(document.querySelector('.pdf-stored-annotation-overlay-ann-thin-underline')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mock-react-pdf-page-1'), {
      clientX: 180,
      clientY: 110,
    });

    await waitFor(() => {
      expect(document.querySelector('[data-pdf-annotation-menu="ann-thin-underline"]')).toBeTruthy();
    });
  });

  it('optimistically reflects highlight and underline conversion before annotation storage refreshes', async () => {
    const updateAnnotation = vi.fn();
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-convert-optimistic',
          target: {
            type: 'pdf',
            page: 1,
            rects: [{ x1: 0.18, y1: 0.125, x2: 0.40, y2: 0.15 }],
            textQuote: {
              exact: 'phenomenon, which',
              prefix: 'This ',
              suffix: ' we call',
              source: 'pdfjs-text-model',
              confidence: 'exact',
            },
          },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: 'phenomenon, which',
          author: 'user',
          createdAt: 1,
        },
      ],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation,
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();
    fireEvent.keyDown(window, {
      ctrlKey: true,
      shiftKey: true,
      key: 'a',
    });
    await waitFor(() => {
      expect(pdfMockState.sidebarProps).toBeTruthy();
    });

    const convert = pdfMockState.sidebarProps?.onConvertToUnderline as ((id: string) => void);
    act(() => {
      convert('ann-convert-optimistic');
    });

    expect(updateAnnotation).toHaveBeenCalledWith('ann-convert-optimistic', {
      style: { type: 'underline' },
    });
    await waitFor(() => {
      const sidebarAnnotations = pdfMockState.sidebarProps?.annotations as AnnotationItem[] | undefined;
      const displayed = sidebarAnnotations?.find((item) => item.id === 'ann-convert-optimistic');
      expect(displayed?.style.type).toBe('underline');
    });
  });

  it('applies stored annotation menu actions for comment, color, and style conversion', async () => {
    const updateAnnotation = vi.fn();
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-menu-actions',
          target: {
            type: 'pdf',
            page: 1,
            rects: [{ x1: 0.18, y1: 0.125, x2: 0.40, y2: 0.15 }],
            textQuote: {
              exact: 'phenomenon, which',
              prefix: 'This ',
              suffix: ' we call',
              source: 'pdfjs-text-model',
              confidence: 'exact',
            },
          },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: 'phenomenon, which',
          author: 'user',
          createdAt: 1,
        },
      ],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation,
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    fireEvent.click(screen.getByTestId('mock-react-pdf-page-1'), {
      clientX: 180,
      clientY: 132,
    });
    await waitFor(() => {
      expect(document.querySelector('[data-pdf-annotation-menu="ann-menu-actions"]')).toBeTruthy();
    });

    const firstMenu = document.querySelector<HTMLElement>('[data-pdf-annotation-menu="ann-menu-actions"]');
    const firstMenuButtons = Array.from(firstMenu?.querySelectorAll('button') ?? []);
    fireEvent.click(firstMenuButtons[0]);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Important note' },
    });
    const commentEditor = document.querySelector<HTMLElement>('[data-pdf-annotation-menu="ann-menu-actions"]');
    const editorButtons = Array.from(commentEditor?.querySelectorAll('button') ?? []);
    fireEvent.click(editorButtons[editorButtons.length - 1]);
    expect(updateAnnotation).toHaveBeenCalledWith('ann-menu-actions', { comment: 'Important note' });

    fireEvent.click(screen.getByTestId('mock-react-pdf-page-1'), {
      clientX: 180,
      clientY: 132,
    });
    await waitFor(() => {
      expect(document.querySelector('[data-pdf-annotation-menu="ann-menu-actions"]')).toBeTruthy();
    });
    const secondMenu = document.querySelector<HTMLElement>('[data-pdf-annotation-menu="ann-menu-actions"]');
    const secondMenuButtons = Array.from(secondMenu?.querySelectorAll('button') ?? []);
    fireEvent.click(secondMenuButtons[1]);
    const colorMenu = document.querySelector<HTMLElement>('[data-pdf-annotation-menu="ann-menu-actions"]');
    const colorButtons = Array.from(colorMenu?.querySelectorAll('button') ?? []);
    fireEvent.click(colorButtons[4]);
    expect(updateAnnotation).toHaveBeenCalledWith('ann-menu-actions', { style: { color: '#2EA8E5' } });

    fireEvent.click(screen.getByTestId('mock-react-pdf-page-1'), {
      clientX: 180,
      clientY: 132,
    });
    await waitFor(() => {
      expect(document.querySelector('[data-pdf-annotation-menu="ann-menu-actions"]')).toBeTruthy();
    });
    const thirdMenu = document.querySelector<HTMLElement>('[data-pdf-annotation-menu="ann-menu-actions"]');
    const thirdMenuButtons = Array.from(thirdMenu?.querySelectorAll('button') ?? []);
    fireEvent.click(thirdMenuButtons[2]);
    expect(updateAnnotation).toHaveBeenCalledWith('ann-menu-actions', { style: { type: 'underline' } });
  });

  it('opens stored PDF annotation controls for area, pin, text, and ink annotations', async () => {
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-click-area',
          target: { type: 'pdf', page: 1, rects: [{ x1: 0.10, y1: 0.20, x2: 0.28, y2: 0.30 }] },
          style: { color: '#4CAF50', type: 'area' },
          content: 'area',
          author: 'user',
          createdAt: 1,
        },
        {
          id: 'ann-click-pin',
          target: { type: 'pdf', page: 1, rects: [{ x1: 0.60, y1: 0.20, x2: 0.62, y2: 0.22 }] },
          style: { color: '#FFC107', type: 'area' },
          comment: 'pin',
          author: 'user',
          createdAt: 2,
        },
        {
          id: 'ann-click-text',
          target: { type: 'pdf', page: 1, rects: [{ x1: 0.10, y1: 0.36, x2: 0.24, y2: 0.40 }] },
          style: {
            color: '#FFFFFF',
            type: 'text',
            textStyle: { textColor: '#111111', fontSize: 14 },
          },
          content: 'text note',
          author: 'user',
          createdAt: 3,
        },
        {
          id: 'ann-click-ink',
          target: { type: 'pdf', page: 1, rects: [{ x1: 0.10, y1: 0.44, x2: 0.30, y2: 0.52 }] },
          style: { color: '#FF5252', type: 'ink' },
          content: JSON.stringify({
            paths: [[
              { x: 0.10, y: 0.44 },
              { x: 0.20, y: 0.48 },
              { x: 0.30, y: 0.52 },
            ]],
            width: 5,
          }),
          author: 'user',
          createdAt: 4,
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
      expect(document.querySelector('.pdf-stored-annotation-overlay-ann-click-area')).toBeTruthy();
      expect(document.querySelector('.pdf-stored-annotation-overlay-ann-click-pin')).toBeTruthy();
      expect(document.querySelector('.text-overlay-ann-click-text')).toBeTruthy();
      expect(document.querySelector('.ink-overlay-ann-click-ink')).toBeTruthy();
    });

    const page = screen.getByTestId('mock-react-pdf-page-1');

    fireEvent.click(page, { clientX: 120, clientY: 240 });
    await waitFor(() => {
      expect(document.querySelector('[data-pdf-annotation-menu="ann-click-area"]')).toBeTruthy();
    });
    fireEvent.click(page, { clientX: 520, clientY: 520 });
    await waitFor(() => {
      expect(document.querySelector('[data-pdf-annotation-menu="ann-click-area"]')).toBeNull();
    });

    fireEvent.click(page, { clientX: 390, clientY: 205 });
    await waitFor(() => {
      expect(document.querySelector('[data-pdf-annotation-menu="ann-click-pin"]')).toBeTruthy();
    });
    fireEvent.click(page, { clientX: 520, clientY: 520 });
    await waitFor(() => {
      expect(document.querySelector('[data-pdf-annotation-menu="ann-click-pin"]')).toBeNull();
    });

    fireEvent.click(page, { clientX: 128, clientY: 460 });
    await waitFor(() => {
      expect(document.querySelector('[data-pdf-annotation-menu="ann-click-ink"]')).toBeTruthy();
    });
    fireEvent.click(page, { clientX: 520, clientY: 520 });
    await waitFor(() => {
      expect(document.querySelector('[data-pdf-annotation-menu="ann-click-ink"]')).toBeNull();
    });

    const textOverlay = document.querySelector('.text-overlay-ann-click-text div');
    if (!(textOverlay instanceof HTMLElement)) {
      throw new Error('Missing text annotation overlay');
    }
    fireEvent.click(textOverlay);
    await waitFor(() => {
      expect(screen.getByDisplayValue('text note')).toBeTruthy();
    });
  });

  it('opens an ink annotation from its bounding hit area, not only from the drawn stroke', async () => {
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-ink-bounds-hit',
          target: { type: 'pdf', page: 1, rects: [{ x1: 0.10, y1: 0.44, x2: 0.30, y2: 0.52 }] },
          style: { color: '#FF5252', type: 'ink' },
          content: JSON.stringify({
            paths: [[
              { x: 0.10, y: 0.44 },
              { x: 0.30, y: 0.52 },
            ]],
            width: 5,
          }),
          author: 'user',
          createdAt: 4,
        },
      ],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    const boundsHitArea = await waitFor(() => {
      const element = document.querySelector<SVGRectElement>(
        '.ink-overlay-ann-ink-bounds-hit [data-pdf-ink-annotation-bounds-hit-area="true"]',
      );
      expect(element).toBeTruthy();
      return element as SVGRectElement;
    });

    fireEvent.pointerDown(boundsHitArea, { pointerId: 1, clientX: 180, clientY: 480 });
    fireEvent.click(boundsHitArea, { clientX: 180, clientY: 480 });

    await waitFor(() => {
      expect(document.querySelector('[data-pdf-annotation-menu="ann-ink-bounds-hit"]')).toBeTruthy();
    });
  });

  it('renders same-line PDF text rects as one visual-line highlight and underline segment', async () => {
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-highlight-merged',
          target: {
            type: 'pdf',
            page: 1,
            rects: [
              { x1: 0.10, y1: 0.10, x2: 0.20, y2: 0.14 },
              { x1: 0.205, y1: 0.10, x2: 0.35, y2: 0.14 },
            ],
          },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: 'merged highlight',
          author: 'user',
          createdAt: 1,
        },
        {
          id: 'ann-underline-merged',
          target: {
            type: 'pdf',
            page: 1,
            rects: [
              { x1: 0.36, y1: 0.10, x2: 0.44, y2: 0.14 },
              { x1: 0.445, y1: 0.10, x2: 0.58, y2: 0.14 },
            ],
          },
          style: { color: '#2196F3', type: 'underline', underlineStyle: 'solid' },
          content: 'merged underline',
          author: 'user',
          createdAt: 2,
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
      const highlightOverlay = document.querySelector('.pdf-stored-annotation-overlay-ann-highlight-merged');
      const underlineOverlay = document.querySelector('.pdf-stored-annotation-overlay-ann-underline-merged');
      expect(highlightOverlay?.firstElementChild?.children.length).toBe(1);
      expect(underlineOverlay?.firstElementChild?.children.length).toBe(1);
    });
  });

  it('adjusts a stored highlight by dragging the right boundary handle', async () => {
    const updateAnnotation = vi.fn();
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-adjust-highlight',
          target: {
            type: 'pdf',
            page: 1,
            rects: [
              { x1: 0.18125, y1: 0.125, x2: 0.3125, y2: 0.15 },
              { x1: 0.325, y1: 0.125, x2: 0.40625, y2: 0.15 },
            ],
            textQuote: {
              exact: 'phenomenon, which',
              prefix: 'This ',
              suffix: ' we call',
              source: 'pdfjs-text-model',
              confidence: 'exact',
            },
          },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: 'phenomenon, which',
          author: 'user',
          createdAt: 1,
        },
      ],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation,
      deleteAnnotation: vi.fn(),
    });

    selectionMockState.fragments = [
      { text: 'This phenomenon,', left: 80, top: 120, width: 120, height: 24 },
      { text: 'which we call algorithm aversion,', left: 208, top: 120, width: 250, height: 24 },
      { text: 'is costly,', left: 466, top: 120, width: 76, height: 24 },
    ];

    const annotation = {
      id: 'ann-adjust-highlight',
      target: {
        type: 'pdf' as const,
        page: 1,
        rects: [
          { x1: 0.18125, y1: 0.125, x2: 0.3125, y2: 0.15 },
          { x1: 0.325, y1: 0.125, x2: 0.40625, y2: 0.15 },
        ],
        textQuote: {
          exact: 'phenomenon, which',
          prefix: 'This ',
          suffix: ' we call',
          source: 'pdfjs-text-model' as const,
          confidence: 'exact' as const,
        },
      },
      style: { color: '#FFEB3B', type: 'highlight' as const },
      content: 'phenomenon, which',
      author: 'user',
      createdAt: 1,
    };

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();
    fireEvent.keyDown(window, {
      ctrlKey: true,
      shiftKey: true,
      key: 'a',
    });
    await waitFor(() => {
      expect(pdfMockState.sidebarProps).toBeTruthy();
    });

    const page = screen.getByTestId('mock-react-pdf-page-1');
    const pageRect = page.getBoundingClientRect();
    const renderedStartX = pageRect.left + (0.59 * pageRect.width);
    await act(async () => {
      const onSelect = pdfMockState.sidebarProps?.onSelect as ((annotationItem: typeof annotation) => void);
      onSelect(annotation);
      await Promise.resolve();
    });

    const endHandle = await screen.findByTestId('pdf-annotation-adjust-end-ann-adjust-highlight');
    fireEvent.pointerDown(endHandle, {
      button: 0,
      clientX: pageRect.left + 260,
      clientY: pageRect.top + 132,
      pointerId: 1,
    });
    fireEvent.pointerMove(document, {
      clientX: pageRect.left + 272,
      clientY: pageRect.top + 132,
      pointerId: 1,
    });
    fireEvent.pointerUp(document, {
      clientX: pageRect.left + 272,
      clientY: pageRect.top + 132,
      pointerId: 1,
    });

    await waitFor(() => {
      expect(updateAnnotation).toHaveBeenCalled();
    });

    const lastCall = updateAnnotation.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe('ann-adjust-highlight');
    expect(lastCall?.[1]?.content).toBe('phenomenon, which we');
    expect(lastCall?.[1]?.target?.textQuote?.exact).toBe('phenomenon, which we');
    expect(lastCall?.[1]?.target?.rects?.length).toBeGreaterThanOrEqual(1);
    await waitFor(() => {
      const sidebarAnnotations = pdfMockState.sidebarProps?.annotations as AnnotationItem[] | undefined;
      const displayed = sidebarAnnotations?.find((item) => item.id === 'ann-adjust-highlight');
      expect(displayed?.content).toBe('phenomenon, which we');
      expect(displayed?.target.type).toBe('pdf');
      if (displayed?.target.type === 'pdf') {
        expect(displayed.target.textQuote?.exact).toBe('phenomenon, which we');
      }
    });
  });

  it('keeps boundary adjustment isolated from native text selection state', async () => {
    const updateAnnotation = vi.fn();
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-adjust-open-menu',
          target: {
            type: 'pdf',
            page: 1,
            rects: [
              { x1: 0.18125, y1: 0.125, x2: 0.3125, y2: 0.15 },
              { x1: 0.325, y1: 0.125, x2: 0.40625, y2: 0.15 },
            ],
            textQuote: {
              exact: 'phenomenon, which',
              prefix: 'This ',
              suffix: ' we call',
              source: 'pdfjs-text-model',
              confidence: 'exact',
            },
          },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: 'phenomenon, which',
          author: 'user',
          createdAt: 1,
        },
      ],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation,
      deleteAnnotation: vi.fn(),
    });

    selectionMockState.fragments = [
      { text: 'This phenomenon,', left: 80, top: 120, width: 120, height: 24 },
      { text: 'which we call algorithm aversion,', left: 208, top: 120, width: 250, height: 24 },
      { text: 'is costly,', left: 466, top: 120, width: 76, height: 24 },
    ];

    const annotation = {
      id: 'ann-adjust-open-menu',
      target: {
        type: 'pdf',
        page: 1,
        rects: [
          { x1: 0.18125, y1: 0.125, x2: 0.3125, y2: 0.15 },
          { x1: 0.325, y1: 0.125, x2: 0.40625, y2: 0.15 },
        ],
        textQuote: {
          exact: 'phenomenon, which',
          prefix: 'This ',
          suffix: ' we call',
          source: 'pdfjs-text-model',
          confidence: 'exact',
        },
      },
      style: { color: '#FFEB3B', type: 'highlight' },
      content: 'phenomenon, which',
      author: 'user',
      createdAt: 1,
    } as const;

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();
    fireEvent.keyDown(window, {
      ctrlKey: true,
      shiftKey: true,
      key: 'a',
    });
    await waitFor(() => {
      expect(pdfMockState.sidebarProps).toBeTruthy();
    });

    const page = screen.getByTestId('mock-react-pdf-page-1');
    const pageRect = page.getBoundingClientRect();
    const renderedStartX = pageRect.left + (0.59 * pageRect.width);
    await act(async () => {
      const onSelect = pdfMockState.sidebarProps?.onSelect as ((annotationItem: typeof annotation) => void);
      onSelect(annotation);
      await Promise.resolve();
    });

    const endHandle = await screen.findByTestId('pdf-annotation-adjust-end-ann-adjust-open-menu');
    fireEvent.pointerDown(endHandle, {
      button: 0,
      clientX: pageRect.left + 260,
      clientY: pageRect.top + 132,
      pointerId: 7,
    });
    fireEvent.pointerMove(document, {
      clientX: pageRect.left + 272,
      clientY: pageRect.top + 132,
      pointerId: 7,
    });
    fireEvent.pointerUp(document, {
      clientX: pageRect.left + 272,
      clientY: pageRect.top + 132,
      pointerId: 7,
    });

    await waitFor(() => {
      expect(updateAnnotation).toHaveBeenCalled();
    });

    const lastCall = updateAnnotation.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe('ann-adjust-open-menu');
    expect(lastCall?.[1]?.content).toBe('phenomenon, which we');
    expect(screen.getByTestId('pdf-selection-phase-pane-left').textContent).not.toBe('frozen');
  });

  it('does not clear the active annotation immediately on the click that follows a boundary drag', async () => {
    const updateAnnotation = vi.fn();
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-adjust-click-guard',
          target: {
            type: 'pdf',
            page: 1,
            rects: [
              { x1: 0.18125, y1: 0.125, x2: 0.3125, y2: 0.15 },
              { x1: 0.325, y1: 0.125, x2: 0.40625, y2: 0.15 },
            ],
            textQuote: {
              exact: 'phenomenon, which',
              prefix: 'This ',
              suffix: ' we call',
              source: 'pdfjs-text-model',
              confidence: 'exact',
            },
          },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: 'phenomenon, which',
          author: 'user',
          createdAt: 1,
        },
      ],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation,
      deleteAnnotation: vi.fn(),
    });

    selectionMockState.fragments = [
      { text: 'This phenomenon,', left: 80, top: 120, width: 120, height: 24 },
      { text: 'which we call algorithm aversion,', left: 208, top: 120, width: 250, height: 24 },
      { text: 'is costly,', left: 466, top: 120, width: 76, height: 24 },
    ];

    const annotation = {
      id: 'ann-adjust-click-guard',
      target: {
        type: 'pdf',
        page: 1,
        rects: [
          { x1: 0.18125, y1: 0.125, x2: 0.3125, y2: 0.15 },
          { x1: 0.325, y1: 0.125, x2: 0.40625, y2: 0.15 },
        ],
        textQuote: {
          exact: 'phenomenon, which',
          prefix: 'This ',
          suffix: ' we call',
          source: 'pdfjs-text-model',
          confidence: 'exact',
        },
      },
      style: { color: '#FFEB3B', type: 'highlight' },
      content: 'phenomenon, which',
      author: 'user',
      createdAt: 1,
    } as const;

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();
    fireEvent.keyDown(window, {
      ctrlKey: true,
      shiftKey: true,
      key: 'a',
    });
    await waitFor(() => {
      expect(pdfMockState.sidebarProps).toBeTruthy();
    });

    const page = screen.getByTestId('mock-react-pdf-page-1');
    const pageRect = page.getBoundingClientRect();
    const renderedStartX = pageRect.left + (0.59 * pageRect.width);
    await act(async () => {
      const onSelect = pdfMockState.sidebarProps?.onSelect as ((annotationItem: typeof annotation) => void);
      onSelect(annotation);
      await Promise.resolve();
    });

    const endHandle = await screen.findByTestId('pdf-annotation-adjust-end-ann-adjust-click-guard');
    fireEvent.pointerDown(endHandle, {
      button: 0,
      clientX: pageRect.left + 260,
      clientY: pageRect.top + 132,
      pointerId: 9,
    });
    fireEvent.pointerMove(document, {
      clientX: pageRect.left + 272,
      clientY: pageRect.top + 132,
      pointerId: 9,
    });
    fireEvent.pointerUp(document, {
      clientX: pageRect.left + 272,
      clientY: pageRect.top + 132,
      pointerId: 9,
    });
    fireEvent.click(screen.getByTestId('pdf-scroll-container-pane-left'), {
      clientX: pageRect.left + 272,
      clientY: pageRect.top + 132,
    });

    await waitFor(() => {
      expect(updateAnnotation).toHaveBeenCalled();
    });
    expect(screen.getByTestId('pdf-annotation-adjust-end-ann-adjust-click-guard')).toBeTruthy();
  });

  it('hides adjustment handles after clicking an unrelated PDF area', async () => {
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-adjust-dismiss',
          target: {
            type: 'pdf',
            page: 1,
            rects: [
              { x1: 0.18125, y1: 0.125, x2: 0.3125, y2: 0.15 },
              { x1: 0.325, y1: 0.125, x2: 0.40625, y2: 0.15 },
            ],
            textQuote: {
              exact: 'phenomenon, which',
              prefix: 'This ',
              suffix: ' we call',
              source: 'pdfjs-text-model',
              confidence: 'exact',
            },
          },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: 'phenomenon, which',
          author: 'user',
          createdAt: 1,
        },
      ],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });

    selectionMockState.fragments = [
      { text: 'This phenomenon,', left: 80, top: 120, width: 120, height: 24 },
      { text: 'which we call algorithm aversion,', left: 208, top: 120, width: 250, height: 24 },
      { text: 'is costly,', left: 466, top: 120, width: 76, height: 24 },
    ];

    const annotation = {
      id: 'ann-adjust-dismiss',
      target: {
        type: 'pdf' as const,
        page: 1,
        rects: [
          { x1: 0.18125, y1: 0.125, x2: 0.3125, y2: 0.15 },
          { x1: 0.325, y1: 0.125, x2: 0.40625, y2: 0.15 },
        ],
        textQuote: {
          exact: 'phenomenon, which',
          prefix: 'This ',
          suffix: ' we call',
          source: 'pdfjs-text-model' as const,
          confidence: 'exact' as const,
        },
      },
      style: { color: '#FFEB3B', type: 'highlight' as const },
      content: 'phenomenon, which',
      author: 'user',
      createdAt: 1,
    };

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();
    fireEvent.keyDown(window, {
      ctrlKey: true,
      shiftKey: true,
      key: 'a',
    });
    await waitFor(() => {
      expect(pdfMockState.sidebarProps).toBeTruthy();
    });

    await act(async () => {
      const onSelect = pdfMockState.sidebarProps?.onSelect as ((annotationItem: typeof annotation) => void);
      onSelect(annotation);
      await Promise.resolve();
    });

    expect(await screen.findByTestId('pdf-annotation-adjust-end-ann-adjust-dismiss')).toBeTruthy();

    const page = screen.getByTestId('mock-react-pdf-page-1');
    const pageRect = page.getBoundingClientRect();
    fireEvent.click(page, {
      clientX: pageRect.left + 620,
      clientY: pageRect.top + 420,
    });

    await waitFor(() => {
      expect(screen.queryByTestId('pdf-annotation-adjust-end-ann-adjust-dismiss')).toBeNull();
    });
  });

  it('restores the original annotation content and exact quote after dragging a boundary out and back', async () => {
    const updateAnnotation = vi.fn();
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-adjust-reversible',
          target: {
            type: 'pdf',
            page: 1,
            rects: [
              { x1: 0.18125, y1: 0.125, x2: 0.3125, y2: 0.15 },
              { x1: 0.325, y1: 0.125, x2: 0.40625, y2: 0.15 },
            ],
            textQuote: {
              exact: 'phenomenon, which',
              prefix: 'This ',
              suffix: ' we call',
              source: 'pdfjs-text-model',
              confidence: 'exact',
            },
          },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: 'phenomenon, which',
          author: 'user',
          createdAt: 1,
        },
      ],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation,
      deleteAnnotation: vi.fn(),
    });

    selectionMockState.fragments = [
      { text: 'This phenomenon,', left: 80, top: 120, width: 120, height: 24 },
      { text: 'which we call algorithm aversion,', left: 208, top: 120, width: 250, height: 24 },
      { text: 'is costly,', left: 466, top: 120, width: 76, height: 24 },
    ];
    const pageText = selectionMockState.fragments.map((fragment) => fragment.text).join(' ');
    const restoredStart = pageText.indexOf('phenomenon, which');

    const annotation = {
      id: 'ann-adjust-reversible',
      target: {
        type: 'pdf' as const,
        page: 1,
        rects: [
          { x1: 0.18125, y1: 0.125, x2: 0.3125, y2: 0.15 },
          { x1: 0.325, y1: 0.125, x2: 0.40625, y2: 0.15 },
        ],
        textQuote: {
          exact: 'phenomenon, which',
          prefix: 'This ',
          suffix: ' we call',
          source: 'pdfjs-text-model' as const,
          confidence: 'exact' as const,
        },
      },
      style: { color: '#FFEB3B', type: 'highlight' as const },
      content: 'phenomenon, which',
      author: 'user',
      createdAt: 1,
    };

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();
    fireEvent.keyDown(window, {
      ctrlKey: true,
      shiftKey: true,
      key: 'a',
    });
    await waitFor(() => {
      expect(pdfMockState.sidebarProps).toBeTruthy();
    });

    await act(async () => {
      const onSelect = pdfMockState.sidebarProps?.onSelect as ((annotationItem: typeof annotation) => void);
      onSelect(annotation);
      await Promise.resolve();
    });

    const endHandle = await screen.findByTestId('pdf-annotation-adjust-end-ann-adjust-reversible');
    fireEvent.pointerDown(endHandle, {
      button: 0,
      clientX: 260,
      clientY: 132,
      pointerId: 11,
    });
    fireEvent.pointerMove(document, {
      clientX: 272,
      clientY: 132,
      pointerId: 11,
    });
    fireEvent.pointerMove(document, {
      clientX: 246,
      clientY: 132,
      pointerId: 11,
    });
    fireEvent.pointerUp(document, {
      clientX: 246,
      clientY: 132,
      pointerId: 11,
    });

    await waitFor(() => {
      expect(updateAnnotation).toHaveBeenCalled();
    });

    const lastCall = updateAnnotation.mock.calls.at(-1);
    expect(lastCall?.[1]?.content).toBe('phenomenon, which');
    expect(lastCall?.[1]?.target?.textQuote?.exact).toBe('phenomenon, which');
    expect(lastCall?.[1]?.target?.startCharIndex).toBe(restoredStart);
    expect(lastCall?.[1]?.target?.endCharIndex).toBe(restoredStart + 'phenomenon, which'.length);
    expect(lastCall?.[1]?.target?.textSource).toBe('pdfjs-text-model');
    expect(lastCall?.[1]?.target?.textConfidence).toBe(1);
    expect(lastCall?.[1]?.target?.textKernelVersion).toBe(1);
    expect(lastCall?.[1]?.target?.quads).toHaveLength(lastCall?.[1]?.target?.rects.length);
  });

  it('keeps text selection available when dragging from an existing text markup annotation', async () => {
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-drag-through-highlight',
          target: { type: 'pdf', page: 1, rects: [{ x1: 0.10, y1: 0.10, x2: 0.30, y2: 0.14 }] },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: 'existing highlight',
          author: 'user',
          createdAt: 1,
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
      expect(document.querySelector('.pdf-stored-annotation-overlay-ann-drag-through-highlight')).toBeTruthy();
    });

    const page = screen.getByTestId('mock-react-pdf-page-1');
    fireEvent.pointerDown(page, { pointerId: 1, clientX: 120, clientY: 125 });
    fireEvent.pointerMove(page, { pointerId: 1, clientX: 240, clientY: 125 });

    expect(document.querySelector('[data-pdf-annotation-menu="ann-drag-through-highlight"]')).toBeNull();
    expect(document.querySelector('.pdf-selection-color-picker')).toBeNull();
  });

  it('renders fragmented long paragraph highlights as one segment per visual row', async () => {
    const firstRowRects = [
      { x1: 0.10, y1: 0.10, x2: 0.18, y2: 0.125 },
      { x1: 0.215, y1: 0.101, x2: 0.31, y2: 0.126 },
      { x1: 0.35, y1: 0.099, x2: 0.46, y2: 0.124 },
      { x1: 0.50, y1: 0.10, x2: 0.61, y2: 0.125 },
      { x1: 0.65, y1: 0.101, x2: 0.80, y2: 0.126 },
    ];
    const secondRowRects = [
      { x1: 0.08, y1: 0.145, x2: 0.21, y2: 0.17 },
      { x1: 0.245, y1: 0.146, x2: 0.40, y2: 0.171 },
      { x1: 0.44, y1: 0.144, x2: 0.58, y2: 0.169 },
      { x1: 0.62, y1: 0.145, x2: 0.76, y2: 0.17 },
    ];

    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-long-fragmented-highlight',
          target: {
            type: 'pdf',
            page: 1,
            rects: [...firstRowRects, ...secondRowRects],
          },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: 'long fragmented highlight',
          author: 'user',
          createdAt: 1,
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
      const highlightOverlay = document.querySelector('.pdf-stored-annotation-overlay-ann-long-fragmented-highlight');
      expect(highlightOverlay?.firstElementChild?.children.length).toBe(2);
    });
    const segments = Array.from(document.querySelectorAll<HTMLElement>('.pdf-stored-annotation-overlay-ann-long-fragmented-highlight [data-pdf-stored-annotation-segment="true"]'));
    expect(Number.parseFloat(segments[0]?.style.left ?? '0')).toBeCloseTo(10, 6);
    expect(Number.parseFloat(segments[0]?.style.width ?? '0')).toBeCloseTo(70, 6);
  });

  it('rebuilds a legacy coarse stored highlight into multiple thin visual rows', async () => {
    selectionMockState.fragments = [
      { text: 'legacy coarse first visual row', left: 80, top: 180, width: 420, height: 24 },
      { text: 'legacy coarse second visual row', left: 80, top: 212, width: 410, height: 24 },
    ];
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-legacy-coarse',
          target: {
            type: 'pdf',
            page: 1,
            rects: [
              { x1: 0.08, y1: 0.17, x2: 0.84, y2: 0.26 },
            ],
          },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: 'legacy coarse highlight',
          author: 'user',
          createdAt: 1,
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
      const segments = document.querySelectorAll<HTMLElement>('.pdf-stored-annotation-overlay-ann-legacy-coarse [data-pdf-stored-annotation-segment="true"]');
      expect(segments.length).toBeGreaterThan(1);
    });
    const segments = Array.from(document.querySelectorAll<HTMLElement>('.pdf-stored-annotation-overlay-ann-legacy-coarse [data-pdf-stored-annotation-segment="true"]'));
    expect(segments.every((segment) => Number.parseFloat(segment.style.height) < 6)).toBe(true);
  });

  it('renders a legacy Fig. 5 text markup with read-only repair without rewriting persisted annotations', async () => {
    const updateAnnotation = vi.fn();
    const line0 = 'of states with equal and opposite Delta E, as can be inferred';
    const line1 = 'from Fig. 5, that tend to cause shifts in opposite direc-';
    const line2 = 'tions. Even so, the electric field stability required to hold';
    const line3 = 'Stark shifts below 1 MHz is typically of order';
    const line4 = '0.01(100/n)7/2 V/cm.';
    const pageText = [line0, line1, line2, line3, line4].join(' ');
    const start = pageText.indexOf('. 5, that tend');
    const end = pageText.indexOf(' V/cm.') + ' V/cm.'.length;
    selectionMockState.fragments = [
      { text: line0, left: 80, top: 250, width: 430, height: 24 },
      { text: line1, left: 80, top: 282, width: 420, height: 24 },
      { text: line2, left: 80, top: 314, width: 430, height: 24 },
      { text: line3, left: 80, top: 346, width: 360, height: 24 },
      { text: line4, left: 80, top: 378, width: 170, height: 24 },
    ];
    selectionMockState.domSelection = {
      startFragment: line1,
      endFragment: line4,
    };
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-legacy-fig5',
          target: {
            type: 'pdf',
            page: 1,
            rects: [
              { x1: 0.08180486037934669, y1: 0.2929662402432586, x2: 0.4691286880927292, y2: 0.3504093537490697 },
            ],
            textQuote: {
              exact: '. 5, that tend to cause shifts in opposite directions. Even so, the electric field stability required to hold Stark shifts below 1 MHz is typically of order 0.01(100/n)7/2 V/cm.',
              prefix: ' E, as can be inferred from Fig',
              suffix: ' In higher electric fields, mixi',
              source: 'pdfjs-text-model',
              confidence: 'exact',
            },
            textKernelVersion: 1,
            startCharIndex: start,
            endCharIndex: end,
            textSource: 'pdfjs-text-model',
            textConfidence: 1,
          },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: '. 5, that tend to cause shifts in opposite directions. Even so, the electric field stability required to hold Stark shifts below 1 MHz is typically of order 0.01(100/n)7/2 V/cm.',
          author: 'user',
          createdAt: 1,
        },
      ],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation,
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    await waitFor(() => {
      const segments = document.querySelectorAll<HTMLElement>('.pdf-stored-annotation-overlay-ann-legacy-fig5 [data-pdf-stored-annotation-segment="true"]');
      expect(segments.length).toBeGreaterThan(1);
    });
    const storedSegments = Array.from(document.querySelectorAll<HTMLElement>('.pdf-stored-annotation-overlay-ann-legacy-fig5 [data-pdf-stored-annotation-segment="true"]'));
    expect(storedSegments.every((segment) => Number.parseFloat(segment.style.height) < 4)).toBe(true);
    expect(storedSegments.some((segment) => Number.parseFloat(segment.style.top) > 32)).toBe(true);
    expect(updateAnnotation).not.toHaveBeenCalled();
  });

  it('keeps a precise stored Fig. 5 annotation stable on load instead of expanding it from stale character offsets', async () => {
    const updateAnnotation = vi.fn();
    const line0 = 'of states with equal and opposite Delta E, as can be inferred';
    const line1 = 'from Fig. 5, that tend to cause shifts in opposite direc-';
    const line2 = 'tions. Even so, the electric field stability required to hold';
    const line3 = 'Stark shifts below 1 MHz is typically of order';
    const line4 = '0.01(100/n)7/2 V/cm.';
    const pageText = [line0, line1, line2, line3, line4].join(' ');
    const preciseExact = 'Fig. 5, that tend to cause shifts in opposite direc-';
    selectionMockState.fragments = [
      { text: line0, left: 80, top: 250, width: 430, height: 24 },
      { text: line1, left: 80, top: 282, width: 420, height: 24 },
      { text: line2, left: 80, top: 314, width: 430, height: 24 },
      { text: line3, left: 80, top: 346, width: 360, height: 24 },
      { text: line4, left: 80, top: 378, width: 170, height: 24 },
    ];
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-stable-fig5',
          target: {
            type: 'pdf',
            page: 1,
            rects: [
              { x1: 140 / 640, y1: 282 / 960, x2: 500 / 640, y2: 306 / 960 },
            ],
            textQuote: {
              exact: preciseExact,
              prefix: 'of states with equal and opposite Delta E, as can be inferred from ',
              suffix: 'tions. Even so',
              source: 'pdfjs-text-model',
              confidence: 'exact',
            },
            textKernelVersion: 1,
            startCharIndex: 0,
            endCharIndex: pageText.length,
            textSource: 'pdfjs-text-model',
            textConfidence: 1,
          },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: preciseExact,
          author: 'user',
          createdAt: 1,
        },
      ],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation,
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    const segments = await waitFor(() => {
      const elements = Array.from(document.querySelectorAll<HTMLElement>('.pdf-stored-annotation-overlay-ann-stable-fig5 [data-pdf-stored-annotation-segment="true"]'));
      expect(elements).toHaveLength(1);
      return elements;
    });
    const renderedTop = Number.parseFloat(segments[0]?.style.top ?? '0');
    const renderedHeight = Number.parseFloat(segments[0]?.style.height ?? '0');
    expect(renderedTop).toBeGreaterThan(29);
    expect(renderedTop).toBeLessThan(31);
    expect(renderedHeight).toBeLessThan(2);
    expect(Number.parseFloat(segments[0]?.style.left ?? '0')).toBeCloseTo((140 / 640) * 100, 2);
    expect(updateAnnotation).not.toHaveBeenCalled();
  });

  it('does not replay a resolved markdown draft over an existing precise annotation on open', async () => {
    const updateAnnotation = vi.fn();
    const upsertAnnotations = vi.fn();
    const exact = 'Fig. 5, that tend to cause shifts in opposite directions.';
    nextNavigationMockState.pathname = '/workspace/paper-left';
    pdfItemMockState.annotationMarkdown = [
      PDF_ANNOTATION_DRAFTS_BEGIN,
      '<!-- lattice-pdf-annotation id="ann-ai-fig5" page="1" type="highlight" color="#FFD400" -->',
      `- Quote: ${exact}`,
      '- Comment: stale AI draft should not overwrite the accepted annotation',
      '',
      PDF_ANNOTATION_DRAFTS_END,
    ].join('\n');
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-ai-fig5',
          target: {
            type: 'pdf',
            page: 1,
            rects: [
              { x1: 0.21875, y1: 0.29375, x2: 0.78125, y2: 0.31875 },
            ],
            textQuote: {
              exact,
              prefix: 'inferred from ',
              suffix: ' Even so',
              source: 'pdfjs-text-model',
              confidence: 'exact',
            },
          },
          style: { color: '#FF5252', type: 'highlight' },
          content: exact,
          comment: 'user edited comment',
          author: 'user',
          createdAt: 1,
        },
      ],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation,
      deleteAnnotation: vi.fn(),
      upsertAnnotations,
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();
    await waitFor(() => {
      expect(loadPdfItemManifestForBindingMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(removeResolvedPdfItemAnnotationMarkdownDraftsMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ itemId: 'paper-id' }),
        ['ann-ai-fig5'],
      );
    });
    expect(upsertAnnotations).not.toHaveBeenCalled();
    expect(updateAnnotation).not.toHaveBeenCalled();
  });

  it('refuses to overwrite an existing annotation when a markdown draft reuses the id with a different quote', async () => {
    const updateAnnotation = vi.fn();
    const upsertAnnotations = vi.fn();
    nextNavigationMockState.pathname = '/workspace/paper-left';
    pdfItemMockState.annotationMarkdown = [
      PDF_ANNOTATION_DRAFTS_BEGIN,
      '<!-- lattice-pdf-annotation id="ann-ai-fig5" page="1" type="highlight" color="#FFD400" -->',
      '- Quote: stale draft tries to expand this annotation into a different sentence',
      '',
      PDF_ANNOTATION_DRAFTS_END,
    ].join('\n');
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-ai-fig5',
          target: {
            type: 'pdf',
            page: 1,
            rects: [
              { x1: 0.21875, y1: 0.29375, x2: 0.78125, y2: 0.31875 },
            ],
            textQuote: {
              exact: 'Fig. 5, that tend to cause shifts in opposite directions.',
              source: 'pdfjs-text-model',
              confidence: 'exact',
            },
          },
          style: { color: '#FF5252', type: 'highlight' },
          content: 'Fig. 5, that tend to cause shifts in opposite directions.',
          author: 'user',
          createdAt: 1,
        },
      ],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation,
      deleteAnnotation: vi.fn(),
      upsertAnnotations,
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();
    await waitFor(() => {
      expect(loadPdfItemManifestForBindingMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(readPdfItemAnnotationMarkdownMock).toHaveBeenCalled();
    });
    expect(upsertAnnotations).not.toHaveBeenCalled();
    expect(updateAnnotation).not.toHaveBeenCalled();
    expect(removeResolvedPdfItemAnnotationMarkdownDraftsMock).not.toHaveBeenCalled();
  });

  it('keeps adjacent PDF text rows as separate stored annotation segments', async () => {
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-highlight-rows',
          target: {
            type: 'pdf',
            page: 1,
            rects: [
              { x1: 0.10, y1: 0.10, x2: 0.92, y2: 0.13 },
              { x1: 0.06, y1: 0.145, x2: 0.84, y2: 0.175 },
            ],
          },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: 'two-line highlight',
          author: 'user',
          createdAt: 1,
        },
        {
          id: 'ann-underline-rows',
          target: {
            type: 'pdf',
            page: 1,
            rects: [
              { x1: 0.10, y1: 0.22, x2: 0.86, y2: 0.25 },
              { x1: 0.08, y1: 0.265, x2: 0.76, y2: 0.295 },
            ],
          },
          style: { color: '#2196F3', type: 'underline', underlineStyle: 'solid' },
          content: 'two-line underline',
          author: 'user',
          createdAt: 2,
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
      const highlightOverlay = document.querySelector('.pdf-stored-annotation-overlay-ann-highlight-rows');
      const underlineOverlay = document.querySelector('.pdf-stored-annotation-overlay-ann-underline-rows');
      expect(highlightOverlay?.firstElementChild?.children.length).toBe(2);
      expect(underlineOverlay?.firstElementChild?.children.length).toBe(2);
    });
  });

  it('closes the annotation popup when clicking blank pdf space after opening it from a text markup hit', async () => {
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-popup-close',
          target: {
            type: 'pdf',
            page: 1,
            rects: [
              { x1: 0.11, y1: 0.11, x2: 0.40, y2: 0.14 },
            ],
            textQuote: {
              exact: 'popup close highlight',
              prefix: '',
              suffix: '',
              source: 'pdfjs-text-model',
              confidence: 'exact',
            },
          },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: 'popup close highlight',
          author: 'user',
          createdAt: 1,
        },
      ],
      error: null,
      addAnnotation: vi.fn(),
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    const page = screen.getByTestId('mock-react-pdf-page-1');
    fireEvent.click(page, { clientX: 120, clientY: 125 });
    await waitFor(() => {
      expect(document.querySelector('[data-pdf-annotation-menu="ann-popup-close"]')).toBeTruthy();
    });

    fireEvent.click(page, { clientX: 520, clientY: 520 });
    await waitFor(() => {
      expect(document.querySelector('[data-pdf-annotation-menu="ann-popup-close"]')).toBeNull();
    });
  });

  it('creates a visible stored text markup from an exact PDF quote through the diagnostics bridge', async () => {
    let loadedAnnotations: AnnotationItem[] = [];
    const exact = 'Fig. 5, that tend to cause shifts in opposite directions';
    const line = 'from Fig. 5, that tend to cause shifts in opposite directions. Even so, the electric field stability';
    const lineLeft = 80;
    const lineTop = 282;
    const lineWidth = 520;
    const lineHeight = 24;
    const addAnnotation = vi.fn((annotation: Omit<AnnotationItem, 'id' | 'createdAt'>) => {
      loadedAnnotations = [{
        ...annotation,
        id: 'ann-programmatic-exact',
        createdAt: Date.now(),
      }];
      return 'ann-programmatic-exact';
    });
    useAnnotationSystemMock.mockImplementation(() => ({
      annotations: loadedAnnotations,
      error: null,
      addAnnotation,
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    }));
    selectionMockState.fragments = [
      { text: line, left: lineLeft, top: lineTop, width: lineWidth, height: lineHeight },
    ];
    selectionMockState.domSelection = {
      startFragment: line,
      endFragment: line,
    };

    const { rerender } = render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    const bridge = await waitFor(() => {
      const candidate = (window as Window & {
        __latticePdfDiagnostics?: Record<string, {
          createTextMarkupOnPage?: (
            pageNumber: number,
            exact: string,
            styleType?: 'highlight' | 'underline',
            color?: string,
          ) => Promise<unknown> | unknown;
        }>;
      }).__latticePdfDiagnostics?.['pane-left']?.createTextMarkupOnPage;
      expect(typeof candidate).toBe('function');
      return candidate;
    });

    let result: unknown;
    await act(async () => {
      result = await bridge?.(1, exact, 'underline', '#2196F3');
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      text: exact,
      source: 'pdfjs-text-model',
      annotationId: 'ann-programmatic-exact',
    }));
    expect(addAnnotation).toHaveBeenCalledTimes(1);
    const annotation = addAnnotation.mock.calls[0][0];
    expect(annotation.content).toBe(exact);
    expect(annotation.target.type).toBe('pdf');
    if (annotation.target.type === 'pdf') {
      const expectedStart = line.indexOf(exact);
      const expectedLeft = (lineLeft + (lineWidth * (expectedStart / line.length))) / 640;
      expect(annotation.target.textQuote?.exact).toBe(exact);
      expect(annotation.target.startCharIndex).toBe(expectedStart);
      expect(annotation.target.endCharIndex).toBe(expectedStart + exact.length);
      expect(annotation.target.rects).toHaveLength(1);
      expect(annotation.target.rects[0].x1).toBeCloseTo(expectedLeft, 2);
      expect(annotation.target.rects[0].x1).toBeGreaterThan(lineLeft / 640);
      expect(annotation.target.quads).toHaveLength(annotation.target.rects.length);
    }

    rerender(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();
    await waitFor(() => {
      const segments = document.querySelectorAll<HTMLElement>('.pdf-stored-annotation-overlay-ann-programmatic-exact [data-pdf-stored-annotation-segment="true"]');
      expect(segments).toHaveLength(1);
      expect(Number.parseFloat(segments[0].style.height)).toBeLessThan(4);
    });
  });

});
