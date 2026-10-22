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
import { useAiPdfCompanionStore } from '@/stores/ai-pdf-companion-store';
import { useSettingsStore } from '@/stores/settings-store';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { resetPersistedFileViewStateCache } from '@/lib/file-view-state';
import { clearPdfPageTextCache, getPdfPageTextModel } from '@/lib/pdf-page-text-cache';
import * as pdfSelectionReconciler from '@/lib/pdf-selection-reconciler';
import * as pdfFormulaSelection from '@/lib/pdf-formula-selection';
import {
  PDF_ANNOTATION_DRAFTS_BEGIN,
  PDF_ANNOTATION_DRAFTS_END,
} from '@/lib/pdf-annotation-markdown-drafts';
import type { AnnotationItem } from '@/types/universal-annotation';
import { ensurePdfItemWorkspace, ensurePdfItemWorkspaceForBinding } from '@/lib/pdf-item';
import { getActivePdfSelectionImage } from '@/lib/pdf-selection-image-provider';
import { recognizeFormulaImageWithPix2tex } from '@/lib/formula-ocr';
vi.mock('@/lib/formula-ocr', () => ({ recognizeFormulaImageWithPix2tex: vi.fn(async () => ({ latex: '\\frac{a}{b}', confidence: .9 })) }));

const navigateLinkMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock('@/lib/link-router/navigate-link', () => ({
  navigateLink: navigateLinkMock,
}));

const resizeObserverCallbacks: ResizeObserverCallback[] = [];
const mockTextGeometryObservers = new WeakMap<HTMLElement, { layer: HTMLElement; observer: MutationObserver }>();

const {
  inkStoreState,
  inkHookState,
  pdfMockState,
  selectionMockState,
  mockPdfDocument,
  mockPdfGetPage,
  nativeLayoutMockState,
  ocrLayoutMockState,
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
    characterWidths: {} as Record<string, number[]>,
    linkLayer: null as null | {
      href: string;
      left: number;
      top: number;
      width: number;
      height: number;
      id?: string;
      url?: string;
      unsafeUrl?: string;
      dest?: string | unknown[];
      action?: string;
      rect?: number[];
      quadPoints?: number[];
      renderUnboundSection?: boolean;
      onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
      onDragStart?: (event: React.DragEvent<HTMLAnchorElement>) => void;
    },
  };

  const pdfMockState = {
    numPages: 2,
    officialTextLayerEnabled: false,
    officialTextLayerRenderCount: 0,
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
    fetchedLayout: null as null | {
      source: 'pdfium';
      pageNumber: number;
      width: number;
      height: number;
      text: string;
      chars: Array<{
        charIndex: number;
        charEndIndex?: number;
        text: string;
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        fontSize: number;
      }>;
    },
  };

  const ocrLayoutMockState = {
    layout: null as null | {
      source: 'ocr';
      pageNumber: number;
      width: number;
      height: number;
      text: string;
      confidence: number;
      words: Array<{
        text: string;
        left: number;
        top: number;
        width: number;
        height: number;
        confidence: number;
        lineIndex?: number;
        wordIndex?: number;
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
    getAnnotations: vi.fn(async () => (
      pageNumber === 1 && selectionState.linkLayer
        ? [{
            id: selectionState.linkLayer.id ?? 'mock-link-1',
            url: selectionState.linkLayer.url ?? selectionState.linkLayer.href,
            unsafeUrl: selectionState.linkLayer.unsafeUrl,
            dest: selectionState.linkLayer.dest,
            action: selectionState.linkLayer.action,
            rect: selectionState.linkLayer.rect,
            quadPoints: selectionState.linkLayer.quadPoints,
            renderUnboundSection: selectionState.linkLayer.renderUnboundSection,
            subtype: 'Link',
          }]
        : []
    )),
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
    ocrLayoutMockState,
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
  const characterWidths = selectionMockState.characterWidths[fullText];
  const selectionLeft = characterWidths
    ? characterWidths.slice(0, startOffset).reduce((sum, value) => sum + value, 0)
    : width * startRatio;
  const selectionWidth = characterWidths
    ? characterWidths.slice(startOffset, endOffset).reduce((sum, value) => sum + value, 0)
    : width * (endRatio - startRatio);
  const pageElement = parentElement.closest<HTMLElement>('[data-page-number]');
  const pageNumber = Number(pageElement?.dataset.pageNumber ?? '1') || 1;
  const pageMetrics = pdfMockState.pageMetrics[pageNumber] ?? {
    width: 640,
    height: 960,
    top: (pageNumber - 1) * 1000,
    left: 0,
  };
  return createMockRect(
    pageMetrics.left + left + selectionLeft - pdfMockState.viewerMetrics.scrollLeft,
    pageMetrics.top + top - pdfMockState.viewerMetrics.scrollTop,
    Math.max(0, selectionWidth),
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
  // Real DOM glyph geometry updates independently of canvas painting. The mock
  // must also configure spans inserted after an early canvas render.
  const textLayer = pageElement.querySelector<HTMLElement>('.textLayer');
  const observed = mockTextGeometryObservers.get(pageElement);
  if (textLayer && observed?.layer !== textLayer) {
    observed?.observer.disconnect();
    const observer = new MutationObserver(() => configureMockPdfPageDom(pageElement, pageNumber, Number(pageElement.dataset.scale ?? scale)));
    observer.observe(textLayer, { childList: true, subtree: true });
    mockTextGeometryObservers.set(pageElement, { layer: textLayer, observer });
  }
  const pageMetrics = pdfMockState.pageMetrics[pageNumber] ?? {
    width: 640,
    height: 960,
    top: (pageNumber - 1) * 1000,
    left: 0,
  };
  const viewerContainer = pageElement.closest<HTMLElement>('[data-testid^="pdf-viewer-container-"]');
  const scrollContainer = pageElement.closest<HTMLElement>('[data-testid^="pdf-scroll-container-"]');
  if (viewerContainer) {
    // Rendering another page must preserve user scrolling and navigation calls.
    if (!vi.isMockFunction(viewerContainer.scrollTo)) {
      Object.defineProperties(viewerContainer, {
        scrollTop: { value: pdfMockState.viewerMetrics.scrollTop, writable: true, configurable: true },
        scrollLeft: { value: pdfMockState.viewerMetrics.scrollLeft, writable: true, configurable: true },
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
      });
    }
    Object.defineProperties(viewerContainer, {
      scrollHeight: { value: pdfMockState.viewerMetrics.scrollHeight, configurable: true },
      clientHeight: { value: pdfMockState.viewerMetrics.height, configurable: true },
      scrollWidth: { value: pdfMockState.viewerMetrics.scrollWidth, configurable: true },
      clientWidth: { value: pdfMockState.viewerMetrics.width, configurable: true },
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
  TextLayer: class MockTextLayer {
    private container: HTMLElement;
    private textContentSource: { items?: Array<{ str?: string }> };

    constructor({
      container,
      textContentSource,
    }: {
      container: HTMLElement;
      textContentSource: { items?: Array<{ str?: string }> };
    }) {
      this.container = container;
      this.textContentSource = textContentSource;
    }

    async render() {
      if (!pdfMockState.officialTextLayerEnabled) {
        return;
      }
      pdfMockState.officialTextLayerRenderCount += 1;
      this.textContentSource.items?.forEach((item, index) => {
        if (!item.str?.trim()) {
          return;
        }
        const span = document.createElement('span');
        span.textContent = item.str;
        span.dataset.pdfTextItemIndex = String(index);
        span.dataset.officialTextLayer = 'true';
        this.container.appendChild(span);
      });
    }
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
  AnnotationLayer: class MockAnnotationLayer {
    private div: HTMLElement;

    constructor({ div }: { div: HTMLElement }) {
      this.div = div;
    }

    render({ annotations }: { annotations: Array<{ id?: string; url?: string; unsafeUrl?: string; dest?: string | unknown[]; action?: string; rect?: number[]; quadPoints?: number[]; renderUnboundSection?: boolean }> }) {
      annotations.forEach((annotation, index) => {
        if (annotation.renderUnboundSection) {
          const section = document.createElement('section');
          section.className = 'linkAnnotation';
          section.dataset.annotationId = annotation.id ?? `mock-link-${index}`;
          this.div.appendChild(section);
          return;
        }
        if (annotation.rect || annotation.quadPoints) {
          return;
        }
        const section = document.createElement('section');
        section.className = 'linkAnnotation';
        section.dataset.annotationId = annotation.id ?? `mock-link-${index}`;

        const link = document.createElement('a');
        link.href = annotation.url ?? annotation.unsafeUrl ?? (annotation.dest
          ? Array.isArray(annotation.dest)
            ? `#explicitDest=${encodeURIComponent(JSON.stringify(annotation.dest))}`
            : `#nameddest=${encodeURIComponent(annotation.dest)}`
          : annotation.action
            ? `#action=${encodeURIComponent(annotation.action)}`
            : '#page=1');
        link.dataset.elementId = annotation.id ?? `mock-link-${index}`;
        link.dataset.testid = 'mock-pdf-link';
        link.textContent = 'link';
        section.appendChild(link);
        this.div.appendChild(section);
      });
      return Promise.resolve();
    }
  },
  getDocument: vi.fn((_source: unknown) => {
    const loadingTask = {
      destroyed: false,
      onProgress: undefined as undefined | ((progress: { loaded: number; total: number }) => void),
      promise: Promise.resolve().then(() => {
        loadingTask.onProgress?.({ loaded: 1, total: 1 });
        // Each loading task owns a distinct document, as PDF.js does. Methods
        // remain shared spies while the loader can decorate this instance.
        return Object.create(mockPdfDocument) as typeof mockPdfDocument;
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
  getDesktopPdfPageTextLayout: vi.fn(async () => nativeLayoutMockState.fetchedLayout ?? nativeLayoutMockState.layout),
  getDesktopPdfPath: vi.fn(() => 'C:/mock/paper.pdf'),
  peekDesktopPdfPageTextLayout: vi.fn(() => nativeLayoutMockState.layout),
  prefetchDesktopPdfPageTextLayout: vi.fn(),
}));

vi.mock('@/lib/pdf-ocr-text-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pdf-ocr-text-engine')>();
  return {
    ...actual,
    getDesktopPdfOcrPageTextLayout: vi.fn(async () => ocrLayoutMockState.layout),
    peekDesktopPdfOcrPageTextLayout: vi.fn(() => ocrLayoutMockState.layout),
    prefetchDesktopPdfOcrPageTextLayout: vi.fn(),
  };
});

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
  ensurePdfItemWorkspaceForBinding: vi.fn(async () => loadPdfItemManifestForBindingMock()),
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

function renderPdfPane(props: { paneId: 'pane-left' | 'pane-right'; fileId: string; filePath?: string; preloaded?: boolean; sourceRevision?: string | null; diskRevision?: number; noFileHandle?: boolean; desktopUrl?: string; getFile?: () => Promise<File> }) {
  return (
    <div className="h-[600px] w-[800px]">
      <PDFHighlighterAdapter
        source={props.desktopUrl ? { kind: 'desktop-url', url: props.desktopUrl } : { kind: 'buffer', data: new Uint8Array([1, 2, 3]).buffer, sourceRevision: props.sourceRevision === null ? undefined : props.sourceRevision ?? '3:1' }}
        fileName={`${props.fileId}.pdf`}
        fileHandle={props.noFileHandle ? undefined : { name: `${props.fileId}.pdf`, getFile: props.getFile ?? (async () => new File([new Uint8Array([1, 2, 3])], `${props.fileId}.pdf`, { lastModified: props.diskRevision ?? 1 })) } as FileSystemFileHandle}
        rootHandle={{
          name: 'workspace',
          getDirectoryHandle: vi.fn(),
          values: vi.fn(),
        } as unknown as FileSystemDirectoryHandle}
        paneId={props.paneId}
        fileId={props.fileId}
        filePath={props.filePath ?? `docs/${props.fileId}.pdf`}
        preloadedPdfDocument={props.preloaded ? mockPdfDocument as never : undefined}
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
    pdfMockState.officialTextLayerEnabled = false;
    pdfMockState.officialTextLayerRenderCount = 0;
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
    selectionMockState.characterWidths = {};
    selectionMockState.linkLayer = null;
    nativeLayoutMockState.layout = null;
    nativeLayoutMockState.fetchedLayout = null;
    ocrLayoutMockState.layout = null;
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
    useAiPdfCompanionStore.getState().clear();
    resetPersistedFileViewStateCache();
    useContentCacheStore.getState().clearCache();
    useLinkNavigationStore.setState({ pendingByPane: {}, outcomesByRequestId: {} });
    useSettingsStore.setState({
      settings: DEFAULT_SETTINGS,
      isLoading: false,
      isInitialized: true,
      error: null,
    });
    useWorkspaceStore.setState((state) => ({
      workspaceRootPath: null,
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

  it('renders selectable text with the official PDF.js TextLayer before using the fallback layer', async () => {
    pdfMockState.officialTextLayerEnabled = true;

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(pdfMockState.officialTextLayerRenderCount).toBeGreaterThan(0);
    });
    expect(document.querySelector('[data-official-text-layer="true"]')).toBeTruthy();
    const textLayer = document.querySelector<HTMLElement>('.textLayer');
    expect(textLayer?.style.getPropertyValue('--scale-factor')).toBe('1');
    expect(textLayer?.style.getPropertyValue('--user-unit')).toBeTruthy();
    expect(textLayer?.style.getPropertyValue('--total-scale-factor')).toBe(
      'calc(var(--scale-factor) * var(--user-unit))',
    );
    expect(textLayer?.style.lineHeight).toBe('1');
    expect(textLayer?.style.getPropertyValue('text-size-adjust')).toBe('none');
    const officialSpan = document.querySelector<HTMLElement>('[data-official-text-layer="true"]');
    expect(officialSpan?.style.position).toBe('absolute');
    expect(officialSpan?.style.whiteSpace).toBe('pre');
    expect(officialSpan?.style.getPropertyValue('-webkit-text-size-adjust')).toBe('none');
    expect(officialSpan?.style.getPropertyValue('text-size-adjust')).toBe('none');
  });

  it('defers annotation storage loading until the single PDF binding resolution completes', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    expect(useAnnotationSystemMock).toHaveBeenCalledWith(expect.objectContaining({
      deferLoad: true,
      binding: null,
    }));

    await waitFor(() => {
      expect(useAnnotationSystemMock).toHaveBeenLastCalledWith(expect.objectContaining({
        deferLoad: false,
        binding: expect.objectContaining({ documentId: 'paper-id' }),
      }));
    });
  });

  it('does not create a path-derived child workspace while the stable PDF identity is pending', async () => {
    resolvePdfDocumentBindingMock.mockImplementationOnce(() => new Promise(() => {}));
    vi.mocked(ensurePdfItemWorkspace).mockClear();
    vi.mocked(ensurePdfItemWorkspaceForBinding).mockClear();
    const view = render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-pending' }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    expect(ensurePdfItemWorkspace).not.toHaveBeenCalled();
    expect(ensurePdfItemWorkspaceForBinding).not.toHaveBeenCalled();
    view.unmount();
  });

  it('uses the catalogued item root for annotation storage after the PDF moves', async () => {
    const itemRootHandle = { name: 'old-workspace' } as FileSystemDirectoryHandle;
    resolvePdfDocumentBindingMock.mockResolvedValueOnce({
      documentId: 'paper-id',
      fileIdentity: {
        primaryFileId: 'paper-id',
        fileIdCandidates: ['paper-id'],
        canonicalPath: 'new-workspace/docs/paper-id.pdf',
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
        lastModified: 1,
      },
      resolvedSource: null,
      itemRootHandle,
    } as never);

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(useAnnotationSystemMock).toHaveBeenLastCalledWith(expect.objectContaining({
        rootHandle: itemRootHandle,
      }));
    });
  });

  it('never passes the previous file binding to storage while a replacement file resolves', async () => {
    const view = render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-first' }));
    await waitFor(() => expect(useAnnotationSystemMock).toHaveBeenLastCalledWith(expect.objectContaining({ deferLoad: false, binding: expect.any(Object) })));
    resolvePdfDocumentBindingMock.mockImplementationOnce(() => new Promise(() => {}));
    useAnnotationSystemMock.mockClear();
    view.rerender(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-second' }));
    const callsForSecondFile = useAnnotationSystemMock.mock.calls
      .map(([input]) => input as { filePath: string; deferLoad: boolean; binding: unknown })
      .filter((input) => input.filePath === 'docs/paper-second.pdf');
    expect(callsForSecondFile.length).toBeGreaterThan(0);
    expect(callsForSecondFile.every((input) => input.deferLoad && input.binding === null)).toBe(true);
    view.unmount();
  });

  it('destroys the internally owned PDF.js document when the tab unmounts', async () => {
    const view = render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(screen.getByTestId('pdf-viewer-container-pane-left')).toBeTruthy();
      expect(mockPdfGetPage).toHaveBeenCalled();
    });
    view.unmount();

    await waitFor(() => {
      expect(mockPdfDocument.destroy).toHaveBeenCalledTimes(1);
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

  it('creates an underline directly from the frozen selection menu', async () => {
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

    fireEvent.click(await screen.findByTestId('pdf-selection-draft-action-underline'));

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });
    expect(addAnnotation.mock.calls[0][0].style.type).toBe('underline');
    expect(addAnnotation.mock.calls[0][0].content).toBe('Selected PDF text');
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

    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });

    rerender(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(document.querySelector('.pdf-stored-annotation-overlay-ann-new-highlight [data-pdf-stored-annotation-segment="true"]')).toBeTruthy();
      expect(screen.getByTestId('pdf-selection-phase-pane-left').textContent).toBe('idle');
      expect(screen.queryByTestId('pdf-transient-selection-pane-left-page-1')).toBeNull();
    });
  });

  it('retains a display formula superscript when a forward drag ends above its baseline', async () => {
    selectionMockState.fragments = [
      { text: 'The following relation defines the calibrated energy for this demonstration.', left: 50, top: 80, width: 470, height: 18 },
      { text: 'E = mc', left: 80, top: 180, width: 59, height: 18 },
      { text: '2', left: 139, top: 171, width: 6, height: 10 },
      { text: '(1)', left: 540, top: 180, width: 22, height: 18 },
    ];
    selectionMockState.domSelection = { startFragment: 'E = mc', endFragment: '2' };
    selectionMockState.rawText = 'E = mc2';
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();
    triggerPdfSelection('pane-left', { start: { x: 80, y: 189 }, end: { x: 145, y: 176 } });
    await waitFor(() => expect(screen.getByTestId('pdf-selection-phase-pane-left').textContent).toBe('frozen'));
    expect(screen.getByTestId('pdf-copy-payload-pane-left').textContent?.replace(/\s/g, '')).toBe('E=mc2');
  });

  it.each([1, 2])('binds the frozen selection formula OCR button to its loaded PDF revision (current revision: %s)', async diskRevision => {
    selectionMockState.fragments = [{ text: 'E = mc2', left: 80, top: 180, width: 70, height: 18 }];
    selectionMockState.domSelection = { startFragment: 'E = mc2', endFragment: 'E = mc2' };
    selectionMockState.rawText = 'E = mc2';
    const enrich = vi.spyOn(pdfFormulaSelection, 'enrichPdfFormulaSelection').mockImplementation(selection => ({ ...selection,
      formula: { latex: 'E=mc^2', rawText: selection.text, source: 'geometry', status: 'needs-review', originalRects: selection.pageRects },
      formulaPreview: { type: 'image', dataUrl: 'data:image/png;base64,mock', width: 100, height: 30 },
    }));
    try {
      render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left', sourceRevision: '3:1', diskRevision }));
      await waitForPdfTextModelPrefetch();
      triggerPdfSelection('pane-left', { start: { x: 80, y: 189 }, end: { x: 150, y: 189 } });
      const recognize = await screen.findByRole('button', { name: '本地识别公式' });
      vi.mocked(recognizeFormulaImageWithPix2tex).mockClear();
      canvasToDataUrlSpy!.mockClear();
      fireEvent.click(recognize);
      if (diskRevision === 2) {
        await waitFor(() => expect(screen.getByTestId('pdf-formula-recognition-error').textContent).toMatch(/source changed|来源或选区已改变/));
        expect(recognizeFormulaImageWithPix2tex).not.toHaveBeenCalled();
      } else {
        await waitFor(() => expect(recognizeFormulaImageWithPix2tex).toHaveBeenCalledWith(expect.objectContaining({ imageDataUrl: 'data:image/png;base64,mock', signal: expect.any(AbortSignal) })));
        expect(canvasToDataUrlSpy).toHaveBeenCalled();
        await waitFor(() => expect(screen.getByRole('img', { name: '原始公式截图' }).getAttribute('width')).not.toBe('100'));
      }
    } finally { enrich.mockRestore(); }
  });

  it.each([true, false])('saves a cross-page selection as one validated batch (first save succeeds: %s)', async firstSaveSucceeds => {
    const persistAnnotationChanges = vi.fn(async (_items: AnnotationItem[]) => firstSaveSucceeds);
    const addAnnotation = vi.fn();
    useAnnotationSystemMock.mockReturnValue({ annotations: [], error: null, addAnnotation, persistAnnotationChanges,
      updateAnnotation: vi.fn(), deleteAnnotation: vi.fn() });
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();
    const secondPage = screen.getByTestId('mock-react-pdf-page-2');
    let secondLayer = secondPage.querySelector('.textLayer');
    if (!secondLayer) {
      secondLayer = document.createElement('div'); secondLayer.className = 'textLayer'; secondPage.appendChild(secondLayer);
    }
    secondLayer.innerHTML = '<span data-pdf-fragment="true" data-left="20" data-top="48" data-width="140" data-height="24">Second page text</span>';
    const last = secondLayer.firstChild as HTMLElement;
    Object.defineProperty(last, 'getBoundingClientRect', { configurable: true, value: () => {
      const pageRect = secondPage.getBoundingClientRect(); return createMockRect(pageRect.left + 20, pageRect.top + 48, 140, 24);
    } });
    const first = document.querySelector('.textLayer [data-pdf-fragment="true"]')?.firstChild;
    const range = document.createRange();
    range.setStart(first!, 0); range.setEnd(last.firstChild!, 16);
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    dispatchSelectionChange();
    triggerPdfSelection();
    await waitFor(() => expect(screen.getByTestId('pdf-transient-selection-pane-left-page-2')).toBeTruthy());
    const overlayWidth = () => Number.parseFloat((screen.getByTestId('pdf-transient-selection-pane-left-page-2').firstElementChild as HTMLElement).style.width);
    const widthBefore = overlayWidth();
    const scaleBefore = Number(secondPage.getAttribute('data-scale'));
    fireEvent.keyDown(document, { ctrlKey: true, key: '=' });
    await waitFor(() => expect(Number(secondPage.getAttribute('data-scale'))).toBeGreaterThan(scaleBefore));
    expect(overlayWidth() / widthBefore).toBeCloseTo(Number(secondPage.getAttribute('data-scale')) / scaleBefore, 2);
    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);
    await waitFor(() => expect(persistAnnotationChanges).toHaveBeenCalledTimes(1));
    const saved = persistAnnotationChanges.mock.calls[0][0];
    expect(saved.map(item => item.target.type === 'pdf' ? item.target.page : null)).toEqual([1, 2]);
    expect(saved.map(item => item.content)).toEqual(['Selected PDF text', 'Second page text']);
    expect(saved[1].target).toMatchObject({ type: 'pdf', startCharIndex: 0, endCharIndex: 16 });
    expect(addAnnotation).not.toHaveBeenCalled();
    if (!firstSaveSucceeds) {
      expect(screen.getByTestId('pdf-selection-phase-pane-left').textContent).toBe('frozen');
      expect(screen.getByTestId('pdf-copy-payload-pane-left').textContent).toContain('Second page text');
      persistAnnotationChanges.mockResolvedValue(true);
      fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);
      await waitFor(() => expect(screen.getByTestId('pdf-selection-phase-pane-left').textContent).toBe('idle'));
      expect(persistAnnotationChanges).toHaveBeenCalledTimes(2);
    }
  });

  it('persists every page when a cross-page selection begins in a two-column reading-order page', async () => {
    selectionMockState.fragments = [
      { text: 'Unselected left opening.', left: 30, top: 100, width: 210, height: 20 },
      { text: 'Selected right opening.', left: 350, top: 100, width: 210, height: 20 },
      { text: 'Selected left ending.', left: 30, top: 730, width: 210, height: 20 },
      { text: 'Selected right ending.', left: 350, top: 730, width: 210, height: 20 },
    ];
    const persistAnnotationChanges = vi.fn(async (_items: AnnotationItem[]) => true);
    useAnnotationSystemMock.mockReturnValue({ annotations: [], error: null, addAnnotation: vi.fn(), persistAnnotationChanges,
      updateAnnotation: vi.fn(), deleteAnnotation: vi.fn() });
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();
    const secondPage = screen.getByTestId('mock-react-pdf-page-2');
    let secondLayer = secondPage.querySelector('.textLayer');
    if (!secondLayer) { secondLayer = document.createElement('div'); secondLayer.className = 'textLayer'; secondPage.appendChild(secondLayer); }
    secondLayer.innerHTML = '<span data-pdf-fragment="true" data-left="20" data-top="48" data-width="140" data-height="24">Second page text</span>';
    const last = secondLayer.firstChild as HTMLElement;
    Object.defineProperty(last, 'getBoundingClientRect', { configurable: true, value: () => {
      const pageRect = secondPage.getBoundingClientRect(); return createMockRect(pageRect.left + 20, pageRect.top + 48, 140, 24);
    } });
    const first = Array.from(document.querySelectorAll('.textLayer [data-pdf-fragment="true"]')).find(node => node.textContent === 'Selected left ending.')!.firstChild;
    const range = document.createRange();
    range.setStart(first!, 0); range.setEnd(last.firstChild!, 16);
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    dispatchSelectionChange(); triggerPdfSelection();
    await waitFor(() => expect(screen.getByTestId('pdf-transient-selection-pane-left-page-2')).toBeTruthy());
    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);
    await waitFor(() => expect(persistAnnotationChanges).toHaveBeenCalledTimes(1));
    const saved = persistAnnotationChanges.mock.calls[0][0];
    expect(saved.map(item => item.target.type === 'pdf' ? item.target.page : null)).toEqual([1, 2]);
    expect(saved.map(item => item.content)).toEqual(['Selected left ending. Selected right opening. Selected right ending.', 'Second page text']);
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

  it('persists every interior text run when native multi-line selection rects are incomplete', async () => {
    const addAnnotation = vi.fn();
    const lines = [
      'For the 100s state the crossover length',
      'is close to Rc=9.5 um, and at this length scale the ratio of',
      'the Rydberg interaction to the ground-state interaction',
      'is approximately 10^12.',
    ];
    const left = 72;
    const top = 210;
    const height = 24;
    const widths = [500, 520, 490, 240];
    selectionMockState.rawText = lines.join(' ');
    selectionMockState.fragments = lines.map((text, index) => ({
      text,
      left,
      top: top + (index * 34),
      width: widths[index],
      height,
    }));
    selectionMockState.position = {
      boundingRect: {
        x1: left,
        y1: top,
        x2: left + widths[3],
        y2: top + 102 + height,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: [
        { x1: left, y1: top, x2: left + widths[0], y2: top + height, width: 640, height: 960, pageNumber: 1 },
        { x1: left, y1: top + 34, x2: left + 180, y2: top + 34 + height, width: 640, height: 960, pageNumber: 1 },
        { x1: left, y1: top + 68, x2: left + 210, y2: top + 68 + height, width: 640, height: 960, pageNumber: 1 },
        { x1: left, y1: top + 102, x2: left + widths[3], y2: top + 102 + height, width: 640, height: 960, pageNumber: 1 },
      ],
      pageNumber: 1,
    };
    selectionMockState.clientRectsOverride = [
      { left, right: left + widths[0], top, bottom: top + height },
      { left, right: left + 180, top: top + 34, bottom: top + 34 + height },
      { left, right: left + 210, top: top + 68, bottom: top + 68 + height },
      { left, right: left + widths[3], top: top + 102, bottom: top + 102 + height },
    ];
    selectionMockState.domSelection = {
      startFragment: lines[0],
      endFragment: lines[3],
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
      start: { x: left + 2, y: top + (height / 2) },
      end: { x: left + widths[3] - 2, y: top + 102 + (height / 2) },
    });

    await waitFor(() => {
      expect(document.querySelector('.pdf-selection-color-picker')).toBeTruthy();
    });
    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);
    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });

    const storedRects = [...addAnnotation.mock.calls[0][0].target.rects]
      .sort((leftRect, rightRect) => leftRect.y1 - rightRect.y1 || leftRect.x1 - rightRect.x1);
    expect(storedRects).toHaveLength(4);
    const canonicalWidthScale = (storedRects[0].x2 - storedRects[0].x1) / widths[0];
    storedRects.forEach((rect, index) => {
      expect(rect.x2 - rect.x1).toBeCloseTo(widths[index] * canonicalWidthScale, 3);
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
    expect(annotation.target.textKernelVersion).toBe(2);
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
    (await waitForMockPdfViewerContainer('pane-left')).scrollTop = 96;
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
    expect(rectUnion.y1).toBeCloseTo(lineTop / 960, 1);
    expect(rectUnion.y2).toBeCloseTo((lineTop + 24) / 960, 1);
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
    (await waitForMockPdfViewerContainer('pane-left')).scrollTop = 96;
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
    expect(rectUnion.y1).toBeCloseTo(lineTop / 960, 1);
    expect(rectUnion.y2).toBeCloseTo((lineTop + 24) / 960, 1);
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
    expect(annotation.target.textKernelVersion).toBe(2);
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
    expect(rectUnion.y1).toBeCloseTo(secondTop / 960, 1);
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
    // WebView can collapse a multi-line DOM range into one oversized rect that
    // crosses the gutter. The physical drag still starts and ends in the left column.
    selectionMockState.clientRectsOverride = [
      {
        left: selectedLeft,
        right: rightLineRight,
        top: firstLineTop,
        bottom: firstLineTop + 96 + lineHeight,
      },
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
    const nativeLines = [
      { text: previousLine, left: leftLineLeft, top: 420, width: leftLineRight - leftLineLeft },
      { text: firstSelectedLine, left: leftLineLeft, top: firstLineTop, width: leftLineRight - leftLineLeft },
      { text: secondSelectedLine, left: leftLineLeft, top: firstLineTop + 32, width: leftLineRight - leftLineLeft },
      { text: thirdSelectedLine, left: leftLineLeft, top: firstLineTop + 64, width: leftLineRight - leftLineLeft - 24 },
      { text: fourthSelectedLine, left: leftLineLeft, top: firstLineTop + 96, width: selectedEndX - leftLineLeft },
      { text: rightLineA, left: rightLineLeft, top: firstLineTop + 32, width: rightLineRight - rightLineLeft },
      { text: rightLineB, left: rightLineLeft, top: firstLineTop + 64, width: rightLineRight - rightLineLeft },
    ];
    let nativeCharIndex = 0;
    nativeLayoutMockState.layout = {
      source: 'pdfium',
      pageNumber: 1,
      width: 640,
      height: 960,
      text: nativeLines.map(({ text }) => text).join('\n'),
      chars: nativeLines.flatMap(({ text, left, top, width }, lineIndex) => {
        const charWidth = width / Math.max(1, text.length);
        const chars = Array.from(text).map((character, index) => ({
          charIndex: nativeCharIndex + index,
          text: character,
          x1: left + (index * charWidth),
          y1: top,
          x2: left + ((index + 1) * charWidth),
          y2: top + lineHeight,
          fontSize: lineHeight,
        }));
        nativeCharIndex += text.length + (lineIndex < nativeLines.length - 1 ? 1 : 0);
        return chars;
      }),
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
    expect(annotation.target.textQuote.source).toBe('pdfjs-text-model');
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

  it('preserves complete PDFium text when the rendered Jenkins text layer is fragmented', async () => {
    const addAnnotation = vi.fn();
    const nativeLines = [
      'Here, we report such',
      'methods, reveal scalability characteristics of 171Yb that are',
      'powerful for quantum science broadly, and benchmark',
      'techniques for controlling the nuclear qubit on submicro-',
    ];
    const fragmentedLines = [
      'Here, we report such',
      'methods, reveal scalability characteristics of 171 Yb that are',
      'powerful for quantum science broadly, and benchmark',
      'techniques for controlling the nuclear qubit on submicro',
    ];
    const expectedText = nativeLines.join(' ');
    const lineLeft = 52;
    const lineTop = 275;
    const lineHeight = 20;
    const lineGap = 30;
    const charWidth = 4.2;
    const nativeText = nativeLines.join(' ');
    let nativeOffset = 0;
    const nativeChars = nativeLines.flatMap((line, lineIndex) => {
      const chars = Array.from(line).map((character, charIndex) => ({
        charIndex: nativeOffset + charIndex,
        text: character,
        x1: lineLeft + (charIndex * charWidth),
        y1: lineTop + (lineIndex * lineGap),
        x2: lineLeft + ((charIndex + 1) * charWidth),
        y2: lineTop + (lineIndex * lineGap) + lineHeight,
        fontSize: lineHeight,
      }));
      nativeOffset += line.length + (lineIndex < nativeLines.length - 1 ? 1 : 0);
      return chars;
    });
    const viewportRects = fragmentedLines.map((line, lineIndex) => ({
      left: lineLeft,
      right: lineLeft + (line.length * charWidth),
      top: lineTop + (lineIndex * lineGap),
      bottom: lineTop + (lineIndex * lineGap) + lineHeight,
    }));

    selectionMockState.rawText = fragmentedLines.join(' ');
    selectionMockState.position = {
      boundingRect: {
        x1: lineLeft,
        y1: lineTop,
        x2: viewportRects[viewportRects.length - 1].right,
        y2: viewportRects[viewportRects.length - 1].bottom,
        width: 640,
        height: 960,
        pageNumber: 1,
      },
      rects: viewportRects.map((rect) => ({
        x1: rect.left,
        y1: rect.top,
        x2: rect.right,
        y2: rect.bottom,
        width: 640,
        height: 960,
        pageNumber: 1,
      })),
      pageNumber: 1,
    };
    selectionMockState.clientRectsOverride = viewportRects.flatMap((rect) => {
      const fragmentWidth = (rect.right - rect.left) / 3;
      return Array.from({ length: 3 }, (_, fragmentIndex) => ({
        left: rect.left + (fragmentIndex * fragmentWidth),
        right: fragmentIndex === 2 ? rect.right : rect.left + ((fragmentIndex + 1) * fragmentWidth),
        top: rect.top,
        bottom: rect.bottom,
      }));
    });
    selectionMockState.fragments = fragmentedLines.map((text, lineIndex) => ({
      text,
      left: lineLeft,
      top: lineTop + (lineIndex * lineGap),
      width: text.length * charWidth,
      height: lineHeight,
    }));
    selectionMockState.domSelection = {
      startFragment: fragmentedLines[0],
      endFragment: fragmentedLines[fragmentedLines.length - 1],
    };
    nativeLayoutMockState.fetchedLayout = {
      source: 'pdfium',
      pageNumber: 1,
      width: 640,
      height: 960,
      text: nativeText,
      chars: nativeChars,
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
      start: { x: lineLeft + 1, y: lineTop + (lineHeight / 2) },
      end: {
        x: lineLeft + (nativeLines[nativeLines.length - 1].length * charWidth) - 1,
        y: lineTop + ((nativeLines.length - 1) * lineGap) + (lineHeight / 2),
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe(expectedText);
      expect(screen.getByTestId('pdf-selection-source-pane-left').textContent).toBe('pdfium-native');
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);
    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });
    expect(addAnnotation.mock.calls[0][0].content).toBe(expectedText);
    expect(addAnnotation.mock.calls[0][0].target.textQuote.exact).toBe(expectedText);
    expect(addAnnotation.mock.calls[0][0].target.rects).toHaveLength(nativeLines.length);
  });

  it('selects and annotates an OCR-only scanned page from pointer geometry', async () => {
    const addAnnotation = vi.fn();
    selectionMockState.fragments = [];
    selectionMockState.rawText = '';
    selectionMockState.domSelection = null;
    selectionMockState.autoApplyDomSelection = false;
    ocrLayoutMockState.layout = {
      source: 'ocr',
      pageNumber: 1,
      width: 640,
      height: 960,
      text: 'Scanned paragraph',
      confidence: 0.93,
      words: [
        { text: 'Scanned', left: 60, top: 120, width: 90, height: 24, confidence: 0.94, lineIndex: 0, wordIndex: 0 },
        { text: 'paragraph', left: 160, top: 120, width: 100, height: 24, confidence: 0.92, lineIndex: 0, wordIndex: 1 },
      ],
    };
    useAnnotationSystemMock.mockReturnValue({
      annotations: [],
      error: null,
      addAnnotation,
      updateAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'scanned-paper' }));
    const pageElement = await screen.findByTestId('mock-react-pdf-page-1');
    pageElement.dataset.pdfTextLayerSource = 'empty';
    pageElement.querySelector<HTMLElement>('.textLayer')?.setAttribute('data-pdf-text-layer-source', 'empty');
    window.getSelection()?.removeAllRanges();
    const renderedPageRect = pageElement.getBoundingClientRect();
    const toClientPoint = (x: number, y: number) => ({
      x: renderedPageRect.left + ((x / 640) * renderedPageRect.width),
      y: renderedPageRect.top + ((y / 960) * renderedPageRect.height),
    });

    triggerPdfSelection('pane-left', {
      start: toClientPoint(61, 132),
      end: toClientPoint(259, 132),
    });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe('Scanned paragraph');
      expect(screen.getByTestId('pdf-selection-source-pane-left').textContent).toBe('ocr-text-model');
    });

    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);
    await waitFor(() => {
      expect(addAnnotation).toHaveBeenCalledTimes(1);
    });
    const annotation = addAnnotation.mock.calls[0][0];
    expect(annotation.content).toBe('Scanned paragraph');
    expect(annotation.target.textQuote.exact).toBe('Scanned paragraph');
    expect(annotation.target.textQuote.source).toBe('ocr-text-model');
    expect(annotation.target.rects).toHaveLength(1);
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
    pdfMockState.officialTextLayerEnabled = true;
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
      { text: 'Additional page context', left: lineLeft, top: lineTop + 34, width: 154, height: 22 },
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

    triggerPdfSelection('pane-left', {
      start: { x: selectedLeft + 1, y: lineTop + 11 },
      end: { x: selectedRight - 1, y: lineTop + 11 },
    });
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

    fireEvent.click(await screen.findByTestId('mock-pdf-link'));

    await waitFor(() => {
      expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe(selectedText);
      expect(screen.getByTestId('pdf-selection-phase-pane-left').textContent).toBe('frozen');
    });
    expect(navigateLinkMock).not.toHaveBeenCalled();
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

  it('keeps a below-threshold pointer gesture as an ordinary PDF link click', async () => {
    selectionMockState.linkLayer = {
      href: 'https://example.com/precise-click',
      left: 120,
      top: 180,
      width: 60,
      height: 24,
    };

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    const link = screen.getByTestId('mock-pdf-link');
    fireEvent.pointerDown(link, { pointerId: 8, clientX: 130, clientY: 190 });
    fireEvent.pointerMove(link, { pointerId: 8, clientX: 132, clientY: 190 });
    fireEvent.pointerUp(link, { pointerId: 8, clientX: 132, clientY: 190 });
    fireEvent.click(link);

    await waitFor(() => {
      expect(navigateLinkMock).toHaveBeenCalledWith(
        'https://example.com/precise-click',
        expect.objectContaining({ paneId: 'pane-left' }),
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

    const pdfLink = await screen.findByTestId('mock-pdf-link', {}, { timeout: 5_000 });
    fireEvent.click(pdfLink);

    expect(navigateLinkMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(viewerContainer.scrollTo).toHaveBeenCalled();
    });
  });

  it('resolves explicit PDF destination arrays used by citation links', async () => {
    selectionMockState.linkLayer = {
      href: '#',
      dest: [{ num: 2, gen: 0 }, { name: 'XYZ' }, 0, 0, null],
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

    fireEvent.click(await screen.findByTestId('mock-pdf-link'));

    expect(navigateLinkMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(mockPdfDocument.getPageIndex).toHaveBeenCalledWith({ num: 2, gen: 0 });
      expect(viewerContainer.scrollTo).toHaveBeenCalled();
    });
  });

  it('routes unsafeUrl paper links through the normal external link flow', async () => {
    selectionMockState.linkLayer = {
      href: '#',
      url: undefined,
      unsafeUrl: 'https://doi.org/10.1145/example',
      left: 120,
      top: 180,
      width: 60,
      height: 24,
    };

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    fireEvent.click(await screen.findByTestId('mock-pdf-link'));

    await waitFor(() => {
      expect(navigateLinkMock).toHaveBeenCalledWith(
        'https://doi.org/10.1145/example',
        expect.objectContaining({ externalUrlMode: 'internal' }),
      );
    });
  });

  it('opens bare paper URLs from the PDF text layer without requiring a link annotation', async () => {
    selectionMockState.fragments = [
      { text: 'Check for updates at ', left: 120, top: 180, width: 140, height: 24 },
      { text: 'https://doi.org/10.1145/example', left: 260, top: 180, width: 230, height: 24 },
    ];

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    const urlSpan = await waitFor(() => {
      const span = Array.from(document.querySelectorAll<HTMLElement>('.textLayer span'))
        .find((element) => element.textContent?.includes('https://doi.org/10.1145/example'));
      expect(span).toBeTruthy();
      return span as HTMLElement;
    });

    expect(urlSpan.dataset.pdfTextLink).toBe('https://doi.org/10.1145/example');
    expect(urlSpan.style.cursor).toBe('pointer');

    fireEvent.click(urlSpan);

    await waitFor(() => {
      expect(navigateLinkMock).toHaveBeenCalledWith(
        'https://doi.org/10.1145/example',
        expect.objectContaining({ externalUrlMode: 'internal' }),
      );
    });
  });

  it('opens DOI links that are split across adjacent PDF text spans', async () => {
    selectionMockState.fragments = [
      { text: 'Check for updates doi: 10.1145/', left: 120, top: 180, width: 220, height: 24 },
      { text: '1234567.8901234', left: 340, top: 180, width: 140, height: 24 },
    ];

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    const doiTailSpan = await waitFor(() => {
      const span = Array.from(document.querySelectorAll<HTMLElement>('.textLayer span'))
        .find((element) => element.textContent === '1234567.8901234');
      expect(span).toBeTruthy();
      return span as HTMLElement;
    });

    fireEvent.click(doiTailSpan);

    await waitFor(() => {
      expect(navigateLinkMock).toHaveBeenCalledWith(
        'https://doi.org/10.1145/1234567.8901234',
        expect.objectContaining({ externalUrlMode: 'internal' }),
      );
    });
  });

  it('keeps unbound PDF.js link sections clickable through enriched annotation metadata', async () => {
    selectionMockState.linkLayer = {
      id: 'check-update-link',
      href: 'https://publisher.example.com/check-update',
      rect: [120, 780, 360, 756],
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      renderUnboundSection: true,
    };

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    const section = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('[data-annotation-id="check-update-link"]');
      expect(element).toBeTruthy();
      expect(element?.dataset.pdfLinkTarget).toBe('https://publisher.example.com/check-update');
      return element as HTMLElement;
    });

    fireEvent.click(section);

    await waitFor(() => {
      expect(navigateLinkMock).toHaveBeenCalledWith(
        'https://publisher.example.com/check-update',
        expect.objectContaining({ paneId: 'pane-left' }),
      );
    });
  });

  it('creates a clickable hotspot for image-sized link annotations with only rect data', async () => {
    selectionMockState.linkLayer = {
      id: 'figure-link',
      href: 'https://example.com/figure-source',
      rect: [200, 500, 420, 360],
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    };

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    const hotspot = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('[data-annotation-id="figure-link"][data-lattice-generated="true"]');
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });
    expect(hotspot.style.width).not.toBe('0px');

    const anchor = hotspot.querySelector('a') as HTMLAnchorElement;
    fireEvent.click(anchor);

    await waitFor(() => {
      expect(navigateLinkMock).toHaveBeenCalledWith(
        'https://example.com/figure-source',
        expect.objectContaining({ paneId: 'pane-left' }),
      );
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

  it('renders a deep page after viewer scrolling even when IntersectionObserver does not notify', async () => {
    const originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0' });
    pdfMockState.numPages = 3;
    pdfMockState.viewerMetrics.height = 600;
    pdfMockState.viewerMetrics.scrollHeight = 3400;
    pdfMockState.pageMetrics[3] = { width: 640, height: 960, top: 2000, left: 0 };

    try {
      render(renderPdfPane({ paneId: 'pane-left', fileId: 'deep-scroll' }));
      const viewerContainer = await waitForMockPdfViewerContainer('pane-left');
      const pageThree = await waitFor(() => {
        const page = document.querySelector<HTMLElement>('[data-page-number="3"]');
        expect(page).toBeTruthy();
        return page as HTMLElement;
      });
      expect(pageThree.dataset.pdfPageVisible).toBe('false');
      Object.defineProperty(pageThree, 'getBoundingClientRect', {
        configurable: true,
        value: () => createMockRect(
          0,
          pdfMockState.pageMetrics[3]!.top - viewerContainer.scrollTop,
          pdfMockState.pageMetrics[3]!.width,
          pdfMockState.pageMetrics[3]!.height,
        ),
      });

      viewerContainer.scrollTop = 1900;
      fireEvent.scroll(viewerContainer);

      await waitFor(() => {
        const currentPageThree = document.querySelector<HTMLElement>('[data-page-number="3"]');
        expect(currentPageThree?.dataset.pdfPageVisible).toBe('true');
        expect(currentPageThree?.querySelector('.react-pdf__Page canvas')).toBeTruthy();
      });
    } finally {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalUserAgent });
    }
  });

  it('uses the widest measured page for fit-width zoom', async () => {
    pdfMockState.pageMetrics[2] = { width: 720, height: 960, top: 1000, left: 0 };
    pdfMockState.viewerMetrics.scrollWidth = 1600;

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(
      () => {
        expect(screen.getByTestId('mock-react-pdf-page-2').getAttribute('data-scale')).toBe('1.0666666666666667');
      },
      { timeout: 5_000 },
    );
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

  it('waits for a burst resize to settle before recomputing fit zoom', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    const page = await screen.findByTestId('mock-react-pdf-page-1');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    const initialScale = page.getAttribute('data-scale');
    pdfMockState.viewerMetrics.width = 500;
    pdfMockState.viewerMetrics.scrollWidth = 1600;
    Object.defineProperty(screen.getByTestId('pdf-viewer-container-pane-left'), 'clientWidth', {
      configurable: true,
      value: 500,
    });

    await act(async () => {
      triggerResizeObservers();
      triggerResizeObservers();
      triggerResizeObservers();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    expect(page.getAttribute('data-scale')).toBe(initialScale);
    await waitFor(() => {
      expect(page.getAttribute('data-scale')).not.toBe(initialScale);
    }, { timeout: 5_000 });
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
    const contextMenu = await screen.findByTestId('pdf-viewer-context-menu');
    expect(contextMenu).toBeTruthy();
    expect(contextMenu.className).toContain('max-h-[calc(100vh-1.5rem)]');
    expect(contextMenu.className).toContain('overflow-y-auto');
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

  it('routes PDF context menu actions on pointer down before layout can replace the menu node', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    const scrollContainer = await screen.findByTestId('pdf-scroll-container-pane-left');
    fireEvent.contextMenu(scrollContainer, { clientX: 420, clientY: 260 });

    fireEvent.pointerDown(await screen.findByTestId('pdf-context-menu-action-open-search'));

    await waitFor(() => {
      const searchAction = useWorkspaceStore
        .getState()
        .commandBarByPane['pane-left']
        ?.actions.find((item) => item.id === 'search');
      expect(searchAction?.active).toBe(true);
    });
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

  it.each(['highlight', 'underline'] as const)(
    'rebuilds %s geometry from authoritative PDF characters instead of persisting oversized DOM rows',
    async (styleType) => {
      const addAnnotation = vi.fn((_annotation: Omit<AnnotationItem, 'id' | 'createdAt'>) => `ann-authoritative-${styleType}`);
      const firstLine = 'Lead To reach favorable';
      const secondLine = 'conditions for loading the tweezers suffix';
      const exact = 'To reach favorable conditions for loading the tweezers';
      const lineLeft = 40;
      const firstTop = 300;
      const secondTop = 330;
      const charWidth = 5;
      const lineHeight = 24;
      const firstStart = firstLine.indexOf('To reach');
      const secondEnd = secondLine.indexOf(' suffix');
      const selectedLeft = lineLeft + (firstStart * charWidth);
      const selectedRight = lineLeft + (secondEnd * charWidth);

      selectionMockState.rawText = exact;
      selectionMockState.fragments = [
        { text: firstLine, left: lineLeft, top: firstTop, width: firstLine.length * charWidth, height: lineHeight },
        { text: secondLine, left: lineLeft, top: secondTop, width: secondLine.length * charWidth, height: lineHeight },
      ];
      selectionMockState.domSelection = {
        startFragment: firstLine,
        endFragment: secondLine,
        startOffset: firstStart,
        endOffset: secondEnd,
      };
      selectionMockState.position = {
        boundingRect: {
          x1: selectedLeft,
          y1: firstTop,
          x2: 390,
          y2: secondTop + lineHeight,
          width: 640,
          height: 960,
          pageNumber: 1,
        },
        rects: [
          { x1: selectedLeft, y1: firstTop, x2: 390, y2: firstTop + lineHeight, width: 640, height: 960, pageNumber: 1 },
          { x1: lineLeft, y1: secondTop, x2: 390, y2: secondTop + lineHeight, width: 640, height: 960, pageNumber: 1 },
        ],
        pageNumber: 1,
      };
      selectionMockState.clientRectsOverride = [
        { left: selectedLeft, right: 390, top: firstTop, bottom: firstTop + lineHeight },
        { left: lineLeft, right: 390, top: secondTop, bottom: secondTop + lineHeight },
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
      triggerPdfSelection('pane-left', {
        start: { x: selectedLeft + 1, y: firstTop + (lineHeight / 2) },
        end: { x: selectedRight - 1, y: secondTop + (lineHeight / 2) },
      });
      await waitFor(() => {
        expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe(exact);
      });

      const scrollContainer = await screen.findByTestId('pdf-scroll-container-pane-left');
      fireEvent.contextMenu(scrollContainer, { clientX: selectedRight, clientY: secondTop + lineHeight });
      fireEvent.click(await screen.findByTestId(`pdf-context-menu-action-${styleType}-selection`));

      await waitFor(() => {
        expect(addAnnotation).toHaveBeenCalledTimes(1);
      });
      const annotation = addAnnotation.mock.calls[0][0];
      expect(annotation.content).toBe(exact);
      expect(annotation.style.type).toBe(styleType);
      expect(annotation.target.type).toBe('pdf');
      if (annotation.target.type !== 'pdf') {
        throw new Error('Expected a PDF text-markup target');
      }
      expect(annotation.target.textQuote?.exact).toBe(exact);
      expect(annotation.target.rects).toHaveLength(2);
      expect(Math.max(...annotation.target.rects.map((rect: { x2: number }) => rect.x2))).toBeLessThan(0.45);
      const rowHeights = annotation.target.rects.map((rect: { y1: number; y2: number }) => rect.y2 - rect.y1);
      expect(Math.max(...rowHeights) - Math.min(...rowHeights)).toBeLessThan(0.005);
    },
  );

  it('keeps a native multi-line quote and left-column geometry consistent after a boundary round trip', async () => {
    useContentCacheStore.getState().saveEditorState('paper-left', {
      cursorPosition: 0, scrollTop: 0, scrollLeft: 0,
      viewState: { pdf: { scale: 1, zoomMode: 'manual', showSidebar: true } },
    });
    const first = 'Fig. 5, that tend to cause shifts in opposite direc-';
    const second = 'tions. Even so';
    const nativeFirst = first.slice(0, -1);
    const exact = 'Fig. 5, that tend to cause shifts in opposite directions.';
    selectionMockState.fragments = [
      { text: first, left: 40, top: 300, width: first.length * 4, height: 20 },
      { text: second, left: 40, top: 326, width: second.length * 4, height: 20 },
      { text: 'Unrelated right column', left: 360, top: 300, width: 180, height: 20 },
    ];
    selectionMockState.rawText = `${nativeFirst} tions.`;
    selectionMockState.domSelection = { startFragment: first, endFragment: second, endOffset: 6 };
    selectionMockState.position = {
      boundingRect: { x1: 40, y1: 300, x2: 240, y2: 346, width: 640, height: 960, pageNumber: 1 },
      rects: [
        { x1: 40, y1: 300, x2: 240, y2: 320, width: 640, height: 960, pageNumber: 1 },
        { x1: 40, y1: 326, x2: 64, y2: 346, width: 640, height: 960, pageNumber: 1 },
      ], pageNumber: 1,
    };
    nativeLayoutMockState.layout = {
      source: 'pdfium', pageNumber: 1, width: 640, height: 960, text: `${nativeFirst} ${second}`,
      chars: [
        ...Array.from(nativeFirst).map((text, index) => ({ charIndex: index, text, x1: 40 + index * 4, y1: 300, x2: 44 + index * 4, y2: 320, fontSize: 20 })),
        ...Array.from(second).map((text, index) => ({ charIndex: nativeFirst.length + 1 + index, text, x1: 40 + index * 4, y1: 326, x2: 44 + index * 4, y2: 346, fontSize: 20 })),
      ],
    };
    const addAnnotation = vi.fn((_: Omit<AnnotationItem, 'id' | 'createdAt'>) => 'ann-linebreak');
    const updateAnnotation = vi.fn();
    useAnnotationSystemMock.mockReturnValue({ annotations: [], error: null, addAnnotation, updateAnnotation, deleteAnnotation: vi.fn() });
    const rendered = render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();
    triggerPdfSelection('pane-left', { start: { x: 41, y: 310 }, end: { x: 63, y: 336 } });
    await waitFor(() => expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe(exact));
    expect(screen.getByTestId('pdf-copy-payload-pane-left').textContent).toBe(exact);
    const previewRects = Array.from(document.querySelectorAll<HTMLElement>('[data-pdf-transient-selection-segment="true"]')).map((element) => ({
      left: Number.parseFloat(element.style.left), top: Number.parseFloat(element.style.top),
      width: Number.parseFloat(element.style.width), height: Number.parseFloat(element.style.height),
    }));
    fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);
    await waitFor(() => expect(addAnnotation).toHaveBeenCalledTimes(1));
    const annotation = { ...addAnnotation.mock.calls[0][0], id: 'ann-linebreak', createdAt: 1 };
    if (annotation.target.type !== 'pdf') throw new Error('Expected PDF markup');
    expect(annotation.content).toBe(exact);
    expect(annotation.target.rects).toHaveLength(2);
    expect(Math.max(...annotation.target.rects.map((rect) => rect.x2))).toBeLessThan(0.5);
    const originalRects = annotation.target.rects;
    useAnnotationSystemMock.mockReturnValue({ annotations: [annotation], error: null, addAnnotation, updateAnnotation, deleteAnnotation: vi.fn() });
    rendered.rerender(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitFor(() => {
      const stored = Array.from(document.querySelectorAll<HTMLElement>('.pdf-stored-annotation-overlay-ann-linebreak [data-pdf-stored-annotation-segment="true"]'));
      expect(stored).toHaveLength(2);
      expect(previewRects).toHaveLength(2);
      stored.forEach((element, index) => {
        expect(Number.parseFloat(element.style.left) * 6.4).toBeCloseTo(previewRects[index].left, 3);
        expect(Number.parseFloat(element.style.top) * 9.6).toBeCloseTo(previewRects[index].top, 3);
        expect(Number.parseFloat(element.style.width) * 6.4).toBeCloseTo(previewRects[index].width, 3);
        expect(Number.parseFloat(element.style.height) * 9.6).toBeCloseTo(previewRects[index].height, 3);
      });
    });
    await waitFor(() => expect(pdfMockState.sidebarProps).toBeTruthy());
    await act(async () => { (pdfMockState.sidebarProps?.onSelect as (annotation: AnnotationItem) => void)(annotation); });
    const handle = await screen.findByTestId('pdf-annotation-adjust-end-ann-linebreak');
    fireEvent.pointerDown(handle, { button: 0, clientX: 64, clientY: 336, pointerId: 23 });
    fireEvent.pointerMove(document, { clientX: 52, clientY: 336, pointerId: 23 });
    fireEvent.pointerMove(document, { clientX: 64, clientY: 336, pointerId: 23 });
    fireEvent.pointerUp(document, { clientX: 64, clientY: 336, pointerId: 23 });
    await waitFor(() => expect(updateAnnotation).toHaveBeenCalled());
    expect(updateAnnotation.mock.calls.at(-1)?.[1]?.content).toBe(exact);
    expect(updateAnnotation.mock.calls.at(-1)?.[1]?.target?.rects).toEqual(originalRects);
  });

  it.each(['highlight', 'underline'] as const)(
    'keeps proportional-font %s geometry identical in preview, first render, and a boundary round trip',
    async (styleType) => {
      useContentCacheStore.getState().saveEditorState('paper-left', {
        cursorPosition: 0, scrollTop: 0, scrollLeft: 0,
        viewState: { pdf: { scale: 1, zoomMode: 'manual', showSidebar: true } },
      });
      const line = 'iii For small WWW suffix';
      const exact = 'For small';
      const characterWidths = [2, 2, 2, 3, 8, 5, 4, 3, 5, 9, 5, 2, 2, 3, 9, 9, 9, 3, 5, 5, 3, 3, 2, 5];
      selectionMockState.characterWidths[line] = characterWidths;
      selectionMockState.fragments = [{ text: line, left: 40, top: 300, width: 108, height: 24 }];
      selectionMockState.rawText = exact;
      selectionMockState.domSelection = { startFragment: line, endFragment: line, startOffset: 4, endOffset: 13 };
      selectionMockState.position = {
        boundingRect: { x1: 49, y1: 300, x2: 92, y2: 324, width: 640, height: 960, pageNumber: 1 },
        rects: [{ x1: 49, y1: 300, x2: 92, y2: 324, width: 640, height: 960, pageNumber: 1 }],
        pageNumber: 1,
      };
      const annotations: AnnotationItem[] = [];
      const addAnnotation = vi.fn((annotation: Omit<AnnotationItem, 'id' | 'createdAt'>) => {
        annotations.push({ ...annotation, id: 'ann-proportional', createdAt: 1 });
        return 'ann-proportional';
      });
      const updateAnnotation = vi.fn();
      useAnnotationSystemMock.mockReturnValue({
        annotations: [], error: null, addAnnotation, updateAnnotation, deleteAnnotation: vi.fn(),
      });
      const rendered = render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
      await waitForPdfTextModelPrefetch();
      applyMockTextLayerSelection();
      const range = window.getSelection()!.getRangeAt(0);
      const page = document.querySelector<HTMLElement>('[data-page-number="1"]')!;
      expect(range.toString()).toBe(exact);
      expect(range.getBoundingClientRect().left).toBe(49);
      expect(range.getBoundingClientRect().right).toBe(92);
      expect(page.getBoundingClientRect().width).toBe(640);
      const resolved = pdfSelectionReconciler.resolvePdfSelectionFromNativeRange({
        range, text: exact, pages: [{ pageNumber: 1, width: 640, height: 960, element: page }],
        clientRects: [{ left: 49, right: 92, top: 300, bottom: 324 }],
        dragStartPoint: { x: 50, y: 312 }, dragEndPoint: { x: 91, y: 312 }, trustDomText: true,
      });
      expect(resolved.ok && resolved.selection.textQuote.exact).toBe(exact);
      expect(resolved.ok && resolved.selection.startOffset).toBe(4);
      expect(resolved.ok && resolved.selection.endOffset).toBe(13);
      expect(resolved.ok && resolved.selection.pageRects[0].x1 * 640).toBeCloseTo(49, 3);
      expect(resolved.ok && resolved.selection.pageRects[0].x2 * 640).toBeCloseTo(92, 3);
      const container = screen.getByTestId('pdf-scroll-container-pane-left');
      fireEvent.pointerDown(container, { button: 0, clientX: 49, clientY: 312 });
      // jsdom has no browser drag-selection default action: supply the Range
      // after pointerdown clears the previous selection, as a real drag does.
      applyMockTextLayerSelection();
      fireEvent.pointerMove(container, { button: 0, clientX: 92, clientY: 312 });
      fireEvent.pointerUp(container, { button: 0, clientX: 92, clientY: 312 });
      await waitFor(() => expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe(exact));
      const preview = await screen.findByTestId('pdf-transient-selection-first-rect-pane-left');
      expect(Number.parseFloat(preview.style.left)).toBeCloseTo(49, 3);
      expect(Number.parseFloat(preview.style.width)).toBeCloseTo(43, 3);
      // The shared overlay painter centers an 86% high band in the glyph box.
      expect(Number.parseFloat(preview.style.top)).toBeCloseTo(301.68, 3);
      expect(Number.parseFloat(preview.style.height)).toBeCloseTo(20.64, 3);
      if (styleType === 'underline') {
        fireEvent.click(await screen.findByTestId('pdf-selection-draft-action-underline'));
      } else {
        fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);
      }
      await waitFor(() => expect(addAnnotation).toHaveBeenCalledTimes(1));
      const annotation = annotations[0];
      if (annotation.target.type !== 'pdf') throw new Error('Expected PDF markup');
      const expectedRect = { x1: 49 / 640, y1: 300 / 960, x2: 92 / 640, y2: 324 / 960 };
      expect(annotation.content).toBe(exact);
      expect(annotation.target.rects).toEqual([expectedRect]);
      expect(annotation.target.startCharIndex).toBe(4);
      expect(annotation.target.endCharIndex).toBe(13);
      useAnnotationSystemMock.mockReturnValue({
        annotations: [...annotations], error: null, addAnnotation, updateAnnotation, deleteAnnotation: vi.fn(),
      });
      rendered.rerender(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
      const segment = await waitFor(() => {
        const element = document.querySelector<HTMLElement>('.pdf-stored-annotation-overlay-ann-proportional [data-pdf-stored-annotation-segment="true"]');
        expect(element).toBeTruthy();
        return element!;
      });
      expect(Number.parseFloat(segment.style.left)).toBeCloseTo(expectedRect.x1 * 100, 3);
      expect(Number.parseFloat(segment.style.width)).toBeCloseTo((expectedRect.x2 - expectedRect.x1) * 100, 3);
      await waitFor(() => expect(pdfMockState.sidebarProps).toBeTruthy());
      await act(async () => {
        (pdfMockState.sidebarProps?.onSelect as (annotation: AnnotationItem) => void)(annotation);
      });
      const handle = await screen.findByTestId('pdf-annotation-adjust-end-ann-proportional');
      fireEvent.pointerDown(handle, { button: 0, clientX: 92, clientY: 312, pointerId: 19 });
      fireEvent.pointerMove(document, { clientX: 122, clientY: 312, pointerId: 19 });
      fireEvent.pointerMove(document, { clientX: 92, clientY: 312, pointerId: 19 });
      fireEvent.pointerUp(document, { clientX: 92, clientY: 312, pointerId: 19 });
      await waitFor(() => expect(updateAnnotation).toHaveBeenCalled());
      expect(updateAnnotation.mock.calls.at(-1)?.[1]?.content).toBe(exact);
      expect(updateAnnotation.mock.calls.at(-1)?.[1]?.target?.rects).toEqual([expectedRect]);
    },
  );

  it.each(['highlight', 'underline'] as const)(
    'keeps single-line %s geometry within the exact first, last, top, and bottom character bounds',
    async (styleType) => {
      // The mock glyph coordinates below are expressed at scale 1, so keep
      // the rendered page at that same scale instead of the fit-width default.
      useContentCacheStore.getState().saveEditorState('paper-left', {
        cursorPosition: 0, scrollTop: 0, scrollLeft: 0,
        viewState: { pdf: { scale: 1, zoomMode: 'manual', showSidebar: false } },
      });
      const addAnnotation = vi.fn((_annotation: Omit<AnnotationItem, 'id' | 'createdAt'>) => `ann-single-${styleType}`);
      const line = 'Lead To reach favorable suffix';
      const exact = 'To reach favorable';
      const lineLeft = 40;
      const lineTop = 300;
      const charWidth = 5;
      const lineHeight = 24;
      const startOffset = line.indexOf(exact);
      const endOffset = startOffset + exact.length;
      const expectedLeft = lineLeft + (startOffset * charWidth);
      const expectedRight = lineLeft + (endOffset * charWidth);
      const expectedCanonicalTop = lineTop + (lineHeight * 0.2);

      selectionMockState.rawText = exact;
      selectionMockState.fragments = [
        { text: line, left: lineLeft, top: lineTop, width: line.length * charWidth, height: lineHeight },
      ];
      selectionMockState.domSelection = {
        startFragment: line,
        endFragment: line,
        startOffset,
        endOffset,
      };
      selectionMockState.position = {
        boundingRect: {
          x1: expectedLeft,
          y1: lineTop,
          x2: 390,
          y2: lineTop + lineHeight,
          width: 640,
          height: 960,
          pageNumber: 1,
        },
        rects: [
          { x1: expectedLeft, y1: lineTop, x2: 390, y2: lineTop + lineHeight, width: 640, height: 960, pageNumber: 1 },
        ],
        pageNumber: 1,
      };
      selectionMockState.clientRectsOverride = [
        { left: expectedLeft, right: 390, top: lineTop, bottom: lineTop + lineHeight },
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
      triggerPdfSelection('pane-left', {
        start: { x: expectedLeft + 1, y: lineTop + (lineHeight / 2) },
        end: { x: expectedRight - 1, y: lineTop + (lineHeight / 2) },
      });
      await waitFor(() => {
        expect(screen.getByTestId('pdf-selection-preview-pane-left').textContent).toBe(exact);
      });
      const transientRect = await screen.findByTestId('pdf-transient-selection-first-rect-pane-left');
      const transientLeft = Number.parseFloat(transientRect.style.left);
      const transientTop = Number.parseFloat(transientRect.style.top);
      const transientWidth = Number.parseFloat(transientRect.style.width);
      const transientHeight = Number.parseFloat(transientRect.style.height);
      expect(transientLeft).toBeCloseTo(expectedLeft, 2);
      expect(transientWidth).toBeCloseTo(expectedRight - expectedLeft, 2);
      expect(transientTop).toBeGreaterThanOrEqual(expectedCanonicalTop);
      expect(transientTop + transientHeight).toBeLessThanOrEqual(expectedCanonicalTop + lineHeight);
      expect(transientHeight).toBeGreaterThanOrEqual(lineHeight * 0.72);

      if (styleType === 'underline') {
        fireEvent.click(await screen.findByTestId('pdf-selection-draft-action-underline'));
      } else {
        fireEvent.click(document.querySelector('.pdf-selection-color-picker button') as HTMLButtonElement);
      }

      await waitFor(() => {
        expect(addAnnotation).toHaveBeenCalledTimes(1);
      });
      const annotation = addAnnotation.mock.calls[0][0];
      expect(annotation.target.type).toBe('pdf');
      if (annotation.target.type !== 'pdf') {
        throw new Error('Expected a PDF text-markup target');
      }
      expect(annotation.content).toBe(exact);
      expect(annotation.target.rects).toHaveLength(1);
      const [rect] = annotation.target.rects;
      expect(rect.x1).toBeCloseTo(expectedLeft / 640, 3);
      expect(rect.x2).toBeCloseTo(expectedRight / 640, 3);
      expect(rect.y1).toBeCloseTo(expectedCanonicalTop / 960, 3);
      expect(rect.y2).toBeCloseTo((expectedCanonicalTop + lineHeight) / 960, 3);
      expect(rect.y1).toBeGreaterThan(lineTop / 960);
      expect(rect.y2).toBeLessThanOrEqual((expectedCanonicalTop + lineHeight) / 960);
    },
  );

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

  it('renders sketched rings for all PDF search matches and clears them when search closes', async () => {
    selectionMockState.fragments = [
      { text: 'PDF', left: 12, top: 24, width: 34, height: 24 },
      { text: 'content', left: 56, top: 24, width: 72, height: 24 },
      { text: 'PDF', left: 12, top: 58, width: 34, height: 24 },
    ];

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().commandBarByPane['pane-left']).toBeTruthy();
    });

    const searchAction = useWorkspaceStore
      .getState()
      .commandBarByPane['pane-left']
      ?.actions.find((item) => item.id === 'search');

    await act(async () => {
      searchAction?.onTrigger?.();
    });

    const overlay = await screen.findByTestId('pdf-search-overlay');
    const input = overlay.querySelector('input');
    expect(input).toBeTruthy();
    if (!input) {
      throw new Error('Missing PDF search input');
    }

    fireEvent.change(input, { target: { value: 'PDF' } });

    await waitFor(() => {
      expect(overlay.textContent).toMatch(/2\s*(results|处结果)/u);
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('pdf-search-sketched-ring-page-1')).toHaveLength(2);
    });
    const firstRing = screen.getAllByTestId('pdf-search-sketched-ring-page-1')[0];
    expect(firstRing.className).not.toContain('pdf-search-sketched-ring--active');
    expect(firstRing.querySelectorAll('path')).toHaveLength(3);
    expect(firstRing.querySelector('.pdf-search-sketched-ring__stroke--wash')).toBeTruthy();
    expect(firstRing.querySelector('.pdf-search-sketched-ring__stroke--main')).toBeTruthy();
    expect(firstRing.querySelector('.pdf-search-sketched-ring__stroke--dry')).toBeTruthy();
    expect((firstRing as HTMLElement).style.left).toContain('- 6px');

    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('pdf-search-overlay')).toBeNull();
      expect(screen.queryByTestId('pdf-search-sketched-ring-page-1')).toBeNull();
    });
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
    }, { timeout: 5_000 });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-restore-expected-page-pane-left').textContent).toBe('5');
      expect(screen.getByTestId('pdf-restore-actual-page-pane-left').textContent).toBe('5');
      expect(screen.getByTestId('pdf-restore-status-pane-left').textContent).toBe('restored');
    }, { timeout: 5_000 });

    const viewerContainer = await waitForMockPdfViewerContainer('pane-left');
    const preciseRestoreCall = viewerContainer.scrollTo.mock.calls.find(([options]) => (
      typeof options?.top === 'number' &&
      options.top > 3800 &&
      options.top < 4300
    ));
    expect(preciseRestoreCall).toBeTruthy();
  });

  it('lets an explicit citation supersede queued cached reading-position restoration', async () => {
    pdfMockState.viewerMetrics.scrollHeight = 2800;
    useContentCacheStore.getState().saveEditorState('paper-left', {
      cursorPosition: 0, scrollTop: 1800, scrollLeft: 0,
      viewState: { pdf: { scale: 1.2, zoomMode: 'manual', showSidebar: false,
        anchor: { pageNumber: 2, pageOffsetTopRatio: 0.7, pageOffsetLeftRatio: 0,
          viewportAnchorY: 0.35, viewportAnchorX: 0.5, captureRevision: 9 },
      } },
    });
    useLinkNavigationStore.getState().setPendingNavigation('pane-left', {
      requestId: 'citation-over-restoration', filePath: 'docs/paper-left.pdf',
      target: { type: 'pdf_page', path: 'docs/paper-left.pdf', page: 1,
        rects: [{ left: 0.1, top: 0.2, width: 0.2, height: 0.025 }],
      },
    });
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    const viewer = await waitForMockPdfViewerContainer('pane-left');
    await waitFor(() => expect(useLinkNavigationStore.getState().outcomesByRequestId['citation-over-restoration']?.status).toBe('success'));
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 350)); });
    expect(viewer.scrollTo.mock.calls.some(([options]) => (options?.top ?? 0) > 1200)).toBe(false);
    expect(viewer.scrollTop).toBeLessThan(900);
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

  it('retains a scanned area for OCR with exact geometry after the mouse gesture is committed', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitFor(() => expect(useWorkspaceStore.getState().commandBarByPane['pane-left']).toBeTruthy());
    await act(async () => useWorkspaceStore.getState().commandBarByPane['pane-left']?.actions.find(action => action.id === 'tool-area')?.onTrigger?.());
    const page = await screen.findByTestId('mock-react-pdf-page-2');
    page.querySelector('.textLayer')?.replaceChildren();
    const bounds = page.getBoundingClientRect();
    fireEvent.mouseDown(page, { button: 0, clientX: bounds.left + 64, clientY: bounds.top + 40 });
    fireEvent.mouseMove(document, { clientX: bounds.left + 164, clientY: bounds.top + 140 });
    fireEvent.mouseUp(document, { clientX: bounds.left + 164, clientY: bounds.top + 140 });
    const image = await getActivePdfSelectionImage();
    expect(image).not.toBeNull();
    expect(image?.pageNumber).toBe(2);
    expect(image?.bbox.x1).toBeCloseTo(64 / bounds.width);
    expect(image?.bbox.y2).toBeCloseTo(140 / bounds.height);
    expect(image?.imageBbox?.x1).toBeLessThan(image!.bbox.x1);
    expect(image?.width).toBeGreaterThan(200);
    expect(image?.document).toMatchObject({ filePath: 'docs/paper-left.pdf', paneId: 'pane-left' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await getActivePdfSelectionImage()).toBeNull();
  });

  it('rejects a scanned region from an older loaded PDF even when current disk metadata is stable', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left', sourceRevision: '3:1', diskRevision: 2, preloaded: true }));
    await waitForPdfTextModelPrefetch();
    await act(async () => useWorkspaceStore.getState().commandBarByPane['pane-left']?.actions.find(action => action.id === 'tool-area')?.onTrigger?.());
    const page = screen.getByTestId('mock-react-pdf-page-1'), bounds = page.getBoundingClientRect();
    fireEvent.mouseDown(page, { button: 0, clientX: bounds.left + 64, clientY: bounds.top + 40 });
    fireEvent.mouseMove(document, { clientX: bounds.left + 164, clientY: bounds.top + 140 });
    fireEvent.mouseUp(document, { clientX: bounds.left + 164, clientY: bounds.top + 140 });
    await expect(getActivePdfSelectionImage()).rejects.toThrow(/source changed|来源或选区已改变/);
  });
  it('binds a URL-loaded PDF to its load-time revision and rejects a later change before capture', async () => {
    let revision = 1;
    const getFile = vi.fn(async () => new File([new Uint8Array([1, 2, 3])], 'paper.pdf', { lastModified: revision }));
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left', desktopUrl: 'http://synthetic.local/paper.pdf', getFile }));
    await waitForPdfTextModelPrefetch();
    expect(getFile.mock.calls.length).toBeGreaterThanOrEqual(2);
    await act(async () => useWorkspaceStore.getState().commandBarByPane['pane-left']?.actions.find(action => action.id === 'tool-area')?.onTrigger?.());
    const page = screen.getByTestId('mock-react-pdf-page-1'), bounds = page.getBoundingClientRect();
    fireEvent.mouseDown(page, { button: 0, clientX: bounds.left + 64, clientY: bounds.top + 40 });
    fireEvent.mouseMove(document, { clientX: bounds.left + 164, clientY: bounds.top + 140 });
    fireEvent.mouseUp(document, { clientX: bounds.left + 164, clientY: bounds.top + 140 });
    expect((await getActivePdfSelectionImage())?.document?.revision).toBe('3:1');
    revision = 2;
    await expect(getActivePdfSelectionImage()).rejects.toThrow(/source changed|来源或选区已改变/);
  });
  it.each([false, true])('does not invent local revision proof for an unversioned preloaded PDF (no local handle: %s)', async noFileHandle => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left', sourceRevision: null, noFileHandle, preloaded: true }));
    await waitForPdfTextModelPrefetch();
    await act(async () => useWorkspaceStore.getState().commandBarByPane['pane-left']?.actions.find(action => action.id === 'tool-area')?.onTrigger?.());
    const page = screen.getByTestId('mock-react-pdf-page-1'), bounds = page.getBoundingClientRect();
    fireEvent.mouseDown(page, { button: 0, clientX: bounds.left + 64, clientY: bounds.top + 40 });
    fireEvent.mouseMove(document, { clientX: bounds.left + 164, clientY: bounds.top + 140 });
    fireEvent.mouseUp(document, { clientX: bounds.left + 164, clientY: bounds.top + 140 });
    if (noFileHandle) {
      const image = await getActivePdfSelectionImage();
      expect(image).not.toBeNull();
      expect(image?.document?.revision).toBeUndefined();
    } else await expect(getActivePdfSelectionImage()).rejects.toThrow(/source changed|来源或选区已改变/);
  });

  it('does not run annotation OCR on pixels from an older loaded PDF version', async () => {
    const annotation: AnnotationItem = { id: 'old-scan', target: { type: 'pdf', page: 1, rects: [{ x1: .1, y1: .2, x2: .5, y2: .3 }] }, style: { type: 'area', color: '#FFD400' }, author: 'user', createdAt: 1 };
    const persistAnnotationChanges = vi.fn(async () => true);
    useAnnotationSystemMock.mockReturnValue({ annotations: [annotation], error: null, addAnnotation: vi.fn(), updateAnnotation: vi.fn(), deleteAnnotation: vi.fn(), persistAnnotationChanges });
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left', sourceRevision: '3:1', diskRevision: 2 }));
    await waitForPdfTextModelPrefetch();
    await act(async () => useWorkspaceStore.getState().commandBarByPane['pane-left']?.actions.find(action => action.id === 'toggle-sidebar')?.onTrigger?.());
    await waitFor(() => expect(pdfMockState.sidebarProps?.onRecognizeFormula).toBeTypeOf('function'));
    vi.mocked(recognizeFormulaImageWithPix2tex).mockClear();
    await expect((pdfMockState.sidebarProps!.onRecognizeFormula as (id: string) => Promise<void>)('old-scan')).rejects.toThrow(/source changed|来源或选区已改变/);
    expect(recognizeFormulaImageWithPix2tex).not.toHaveBeenCalled();
    expect(persistAnnotationChanges).not.toHaveBeenCalled();
  });

  it('rejects an OCR area dragged across two pages instead of clipping an incomplete formula', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitFor(() => expect(useWorkspaceStore.getState().commandBarByPane['pane-left']).toBeTruthy());
    await act(async () => useWorkspaceStore.getState().commandBarByPane['pane-left']?.actions.find(action => action.id === 'tool-area')?.onTrigger?.());
    const page1 = await screen.findByTestId('mock-react-pdf-page-1'), page2 = await screen.findByTestId('mock-react-pdf-page-2');
    const first = page1.getBoundingClientRect(), second = page2.getBoundingClientRect();
    fireEvent.mouseDown(page1, { button: 0, clientX: first.left + 64, clientY: first.bottom - 30 });
    fireEvent.mouseMove(page2, { clientX: second.left + 164, clientY: second.top + 140 });
    fireEvent.mouseUp(page2, { clientX: second.left + 164, clientY: second.top + 140 });
    expect(await getActivePdfSelectionImage()).toBeNull();
  });

  it('recognizes an existing scanned area without fabricating text anchors', async () => {
    const target = { type: 'pdf' as const, page: 2, rects: [{ x1: .1, y1: .2, x2: .5, y2: .3 }] };
    const annotation: AnnotationItem = { id: 'scan-area', target, style: { type: 'area', color: '#FFD400' }, author: 'user', createdAt: 1 };
    const persistAnnotationChanges = vi.fn(async () => true);
    useAnnotationSystemMock.mockReturnValue({ annotations: [annotation], error: null, addAnnotation: vi.fn(), updateAnnotation: vi.fn(), deleteAnnotation: vi.fn(), persistAnnotationChanges });
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitFor(() => expect(useWorkspaceStore.getState().commandBarByPane['pane-left']).toBeTruthy());
    await act(async () => useWorkspaceStore.getState().commandBarByPane['pane-left']?.actions.find(action => action.id === 'toggle-sidebar')?.onTrigger?.());
    await waitFor(() => expect(pdfMockState.sidebarProps?.onRecognizeFormula).toBeTypeOf('function'));
    await act(async () => { await (pdfMockState.sidebarProps!.onRecognizeFormula as (id: string) => Promise<void>)('scan-area'); });
    expect(recognizeFormulaImageWithPix2tex).toHaveBeenCalledWith(expect.objectContaining({ imageDataUrl: 'data:image/png;base64,mock' }));
    expect(persistAnnotationChanges).toHaveBeenCalledWith([expect.objectContaining({ target: annotation.target,
      formula: expect.objectContaining({ source: 'ocr', status: 'needs-review', rawText: '', latex: '\\frac{a}{b}', originalRects: target.rects }),
      preview: expect.objectContaining({ width: expect.any(Number), dataUrl: 'data:image/png;base64,mock' }),
    })]);
  });

  it('updates the OCR region after resizing an area and cancels a pending raster of its old bounds', async () => {
    const annotation: AnnotationItem = { id: 'scan-resize', target: { type: 'pdf', page: 1, rects: [{ x1: .1, y1: .2, x2: .28, y2: .3 }] }, style: { type: 'area', color: '#FFD400' }, author: 'user', createdAt: 1 };
    useAnnotationSystemMock.mockReturnValue({ annotations: [annotation], error: null, addAnnotation: vi.fn(), updateAnnotation: vi.fn(), deleteAnnotation: vi.fn() });
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();
    await act(async () => useWorkspaceStore.getState().commandBarByPane['pane-left']?.actions.find(action => action.id === 'tool-area')?.onTrigger?.());
    const page = screen.getByTestId('mock-react-pdf-page-1'), bounds = page.getBoundingClientRect();
    fireEvent.mouseDown(page, { button: 0, clientX: bounds.left + .1 * bounds.width, clientY: bounds.top + .2 * bounds.height });
    fireEvent.mouseMove(document, { clientX: bounds.left + .28 * bounds.width, clientY: bounds.top + .3 * bounds.height });
    fireEvent.mouseUp(document, { clientX: bounds.left + .28 * bounds.width, clientY: bounds.top + .3 * bounds.height });
    expect((await getActivePdfSelectionImage())?.bbox.x2).toBeCloseTo(.28);

    const sourcePage = await mockPdfGetPage(1);
    let finish!: () => void;
    let reject!: (error: Error) => void;
    const cancel = vi.fn(() => reject(new DOMException('Cancelled', 'AbortError')));
    const renderOld = vi.fn(() => ({ promise: new Promise<void>((resolve, fail) => { finish = resolve; reject = fail; }), cancel }));
    mockPdfGetPage.mockResolvedValueOnce({ ...sourcePage, render: renderOld });
    const oldImage = getActivePdfSelectionImage().then(value => ({ value, error: null }), error => ({ value: null, error }));
    await waitFor(() => expect(renderOld).toHaveBeenCalledTimes(1));
    const handle = document.createElement('button');
    handle.dataset.pdfStoredAnnotationId = annotation.id;
    handle.dataset.pdfAnnotationAreaHandle = 'se';
    page.appendChild(handle);
    fireEvent.pointerDown(handle, { button: 0, pointerId: 41, clientX: bounds.left + .28 * bounds.width, clientY: bounds.top + .3 * bounds.height });
    fireEvent.pointerMove(document, { pointerId: 41, clientX: bounds.left + .36 * bounds.width, clientY: bounds.top + .38 * bounds.height });
    fireEvent.pointerUp(document, { pointerId: 41, clientX: bounds.left + .36 * bounds.width, clientY: bounds.top + .38 * bounds.height });
    finish();
    const stale = await oldImage;
    const image = await getActivePdfSelectionImage();
    expect(image?.bbox).toMatchObject({ x1: .1, y1: .2, x2: .36, y2: .38 });
    expect(image?.document).toMatchObject({ filePath: 'docs/paper-left.pdf', paneId: 'pane-left' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stale.value).toBeNull();
    expect(stale.error).toMatchObject({ name: 'AbortError' });
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
    // The helper can install geometry on a placeholder before the async page
    // renderer runs. Start this navigation scenario from an actually readable
    // source page, so a later mock render cannot replace its initial geometry.
    await waitForPdfTextModelPrefetch();
    await waitFor(() => {
      expect(screen.getByTestId('mock-react-pdf-canvas-1').dataset.pdfCanvasReady).toBe('true');
    });
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
    // Canvas and text now render concurrently. Wait only for the source page;
    // the destination remains unrendered until the first sidebar selection.
    await waitForPdfTextModelPrefetch();
    await waitFor(() => {
      expect(screen.getByTestId('mock-react-pdf-canvas-1').dataset.pdfCanvasReady).toBe('true');
    });
    expect(document.querySelector('[data-page-number="5"]')?.getAttribute('data-pdf-page-visible')).toBe('false');
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
      expect(useLinkNavigationStore.getState().pendingByPane['pane-left']?.requestId).toBeTruthy();
    });
    expect(viewerContainer.scrollTo).not.toHaveBeenCalled();

    loadedAnnotations = [annotation];
    rerender(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));

    await waitFor(() => {
      expect(document.querySelector('.pdf-stored-annotation-overlay-ann-delayed')).toBeTruthy();
      expect(pdfMockState.sidebarProps?.selectedId).toBe('ann-delayed');
      expect(useLinkNavigationStore.getState().pendingByPane['pane-left']).toBeUndefined();
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

  it('completes a PDF quote navigation with quote_not_found when page text has no match', async () => {
    useLinkNavigationStore.getState().setPendingNavigation('pane-left', {
      requestId: 'nav-quote-missing',
      filePath: 'docs/paper-left.pdf',
      target: {
        type: 'pdf_page',
        path: 'docs/paper-left.pdf',
        page: 1,
        snippet: 'This bounded quote does not occur in the page text.',
      },
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForMockPdfViewerContainer('pane-left');

    await waitFor(() => {
      expect(useLinkNavigationStore.getState().pendingByPane['pane-left']).toBeUndefined();
      expect(useLinkNavigationStore.getState().outcomesByRequestId['nav-quote-missing']).toMatchObject({
        status: 'quote_not_found',
      });
    });
    expect(document.querySelector('[data-testid="pdf-permanent-annotation"]')).toBeNull();
  });

  it('paints the PDF canvas while text extraction is still pending', async () => {
    const originalGetPage = mockPdfGetPage.getMockImplementation()!;
    const page = await originalGetPage(1);
    const text = await page.getTextContent();
    let releaseText!: (value: typeof text) => void;
    const slowText = new Promise<typeof text>(resolve => { releaseText = resolve; });
    page.getTextContent.mockImplementation(() => slowText);
    mockPdfGetPage.mockImplementation(pageNumber => pageNumber === 1 ? Promise.resolve(page) : originalGetPage(pageNumber));
    const view = render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    try {
      await waitFor(() => expect(page.render).toHaveBeenCalled(), { timeout: 1500 });
    } finally {
      await act(async () => { releaseText(text); await Promise.resolve(); });
      view.unmount();
      mockPdfGetPage.mockImplementation(originalGetPage);
    }
  });

  it('waits for exact quote geometry without scheduling a page-only preflight scroll', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    const viewer = await waitForMockPdfViewerContainer('pane-left');
    clearPdfPageTextCache(mockPdfDocument as never);
    const originalGetPage = mockPdfGetPage.getMockImplementation()!;
    const page = await originalGetPage(1);
    let resolveLookup: ((value: typeof page) => void) | undefined;
    const delayedPage = new Promise<typeof page>((resolve) => { resolveLookup = resolve; });
    mockPdfGetPage.mockImplementation((pageNumber) => pageNumber === 1 ? delayedPage : originalGetPage(pageNumber));
    try {
      viewer.scrollTo.mockClear();
      act(() => useLinkNavigationStore.getState().setPendingNavigation('pane-left', {
        requestId: 'nav-exact-no-preflight', filePath: 'docs/paper-left.pdf',
        target: { type: 'pdf_page', path: 'docs/paper-left.pdf', page: 1, snippet: 'Selected' },
      }));
      await waitFor(() => expect(resolveLookup).toBeTypeOf('function'));
      await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 150)); });
      expect(viewer.scrollTo).not.toHaveBeenCalled();
      await act(async () => { resolveLookup!(page); await Promise.resolve(); });
      await screen.findByTestId('pdf-reference-target-flash-page-1');
      expect(useLinkNavigationStore.getState().outcomesByRequestId['nav-exact-no-preflight']?.status).toBe('success');
    } finally {
      mockPdfGetPage.mockImplementation(originalGetPage);
    }
  });

  it.each([0, -1, 1.5, 3])('rejects an out-of-range PDF page %s without reporting navigation success', async (page) => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    const viewerContainer = await waitForMockPdfViewerContainer('pane-left');
    viewerContainer.scrollTo.mockClear();
    act(() => useLinkNavigationStore.getState().setPendingNavigation('pane-left', {
      requestId: 'nav-invalid-page', filePath: 'docs/paper-left.pdf',
      target: { type: 'pdf_page', path: 'docs/paper-left.pdf', page },
    }));
    await waitFor(() => expect(useLinkNavigationStore.getState().outcomesByRequestId['nav-invalid-page']?.status).toBe('unsupported_target'));
    expect(useLinkNavigationStore.getState().pendingByPane['pane-left']).toBeUndefined();
    expect(viewerContainer.scrollTo).not.toHaveBeenCalled();
  });

  it('ignores a slow quote lookup after a newer PDF navigation has completed', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForMockPdfViewerContainer('pane-left');
    clearPdfPageTextCache(mockPdfDocument as never);
    const originalGetPage = mockPdfGetPage.getMockImplementation()!;
    let rejectLookup: ((error: Error) => void) | undefined;
    mockPdfGetPage.mockImplementation(() => new Promise((_resolve, reject) => { rejectLookup = reject; }));
    try {
      act(() => useLinkNavigationStore.getState().setPendingNavigation('pane-left', {
        requestId: 'nav-old-slow', filePath: 'docs/paper-left.pdf',
        target: { type: 'pdf_page', path: 'docs/paper-left.pdf', page: 1, snippet: 'Slow quote' },
      }));
      await waitFor(() => expect(rejectLookup).toBeTypeOf('function'));
      act(() => useLinkNavigationStore.getState().setPendingNavigation('pane-left', {
        requestId: 'nav-new-fast', filePath: 'docs/paper-left.pdf',
        target: { type: 'pdf_page', path: 'docs/paper-left.pdf', page: 2 },
      }));
      await waitFor(() => expect(useLinkNavigationStore.getState().outcomesByRequestId['nav-new-fast']?.status).toBe('success'));
      await act(async () => { rejectLookup!(new Error('Late failure')); await Promise.resolve(); });
      expect(useLinkNavigationStore.getState().outcomesByRequestId['nav-old-slow']).toBeUndefined();
    } finally {
      mockPdfGetPage.mockImplementation(originalGetPage);
    }
  });

  it('keeps the newer evidence frame when an older quote lookup succeeds late', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForMockPdfViewerContainer('pane-left');
    clearPdfPageTextCache(mockPdfDocument as never);
    const originalGetPage = mockPdfGetPage.getMockImplementation()!;
    const oldPage = await originalGetPage(1);
    let resolveLookup: ((page: typeof oldPage) => void) | undefined;
    mockPdfGetPage.mockImplementation((pageNumber) => pageNumber === 1
      ? new Promise((resolve) => { resolveLookup = resolve; })
      : originalGetPage(pageNumber));
    try {
      act(() => useLinkNavigationStore.getState().setPendingNavigation('pane-left', {
        requestId: 'nav-old-success', filePath: 'docs/paper-left.pdf',
        target: { type: 'pdf_page', path: 'docs/paper-left.pdf', page: 1, snippet: 'Selected PDF text' },
      }));
      await waitFor(() => expect(resolveLookup).toBeTypeOf('function'));
      act(() => useLinkNavigationStore.getState().setPendingNavigation('pane-left', {
        requestId: 'nav-new-evidence', filePath: 'docs/paper-left.pdf',
        target: {
          type: 'pdf_page', path: 'docs/paper-left.pdf', page: 2,
          rects: [{ left: 0.2, top: 0.3, width: 0.25, height: 0.04 }],
        },
      }));
      await screen.findByTestId('pdf-reference-target-flash-page-2');
      await act(async () => { resolveLookup!(oldPage); await Promise.resolve(); });
      expect(screen.queryByTestId('pdf-reference-target-flash-page-1')).toBeNull();
      expect(screen.getByTestId('pdf-reference-target-flash-page-2')).toBeTruthy();
      expect(useLinkNavigationStore.getState().outcomesByRequestId['nav-old-success']).toBeUndefined();
      expect(useLinkNavigationStore.getState().outcomesByRequestId['nav-new-evidence']?.status).toBe('success');
    } finally {
      mockPdfGetPage.mockImplementation(originalGetPage);
    }
  });

  it('shows a red dashed transient evidence frame and clears it with the companion layer', async () => {
    useLinkNavigationStore.getState().setPendingNavigation('pane-left', {
      requestId: 'nav-transient-frame',
      filePath: 'docs/paper-left.pdf',
      target: {
        type: 'pdf_page',
        path: 'docs/paper-left.pdf',
        page: 1,
        rects: [{ left: 0.2, top: 0.3, width: 0.25, height: 0.04 }],
        snippet: 'Transient evidence frame',
      },
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForMockPdfViewerContainer('pane-left');

    const frame = await screen.findByTestId('pdf-reference-target-flash-page-1');
    expect(frame.getAttribute('data-pdf-reference-target-transient')).toBe('true');
    expect(frame.className).toContain('pdf-reference-target-flash');

    useAiPdfCompanionStore.getState().clear();
    await waitFor(() => {
      expect(screen.queryByTestId('pdf-reference-target-flash-page-1')).toBeNull();
    });
  });

  it('completes a PDF quote navigation with page_not_ready when page text cannot be loaded', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForMockPdfViewerContainer('pane-left');
    clearPdfPageTextCache(mockPdfDocument as never);

    const originalGetPage = mockPdfGetPage.getMockImplementation();
    mockPdfGetPage.mockRejectedValue(new Error('page text unavailable'));
    try {
      act(() => {
        useLinkNavigationStore.getState().setPendingNavigation('pane-left', {
          requestId: 'nav-page-not-ready',
          filePath: 'docs/paper-left.pdf',
          target: {
            type: 'pdf_page',
            path: 'docs/paper-left.pdf',
            page: 1,
            snippet: 'A quote that requires the page text model.',
          },
        });
      });

      await waitFor(() => {
        expect(useLinkNavigationStore.getState().pendingByPane['pane-left']).toBeUndefined();
        expect(useLinkNavigationStore.getState().outcomesByRequestId['nav-page-not-ready']).toMatchObject({
          status: 'page_not_ready',
        });
      });
    } finally {
      mockPdfGetPage.mockImplementation(originalGetPage!);
    }
  });

  it('completes an unresolved PDF annotation navigation with renderer_timeout', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForMockPdfViewerContainer('pane-left');

    vi.useFakeTimers();
    try {
      act(() => {
        useLinkNavigationStore.getState().setPendingNavigation('pane-left', {
          requestId: 'nav-renderer-timeout',
          filePath: 'docs/paper-left.pdf',
          target: {
            type: 'pdf_annotation',
            path: 'docs/paper-left.pdf',
            annotationId: 'annotation-that-never-loads',
          },
        });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5001);
      });

      expect(useLinkNavigationStore.getState().pendingByPane['pane-left']).toBeUndefined();
      expect(useLinkNavigationStore.getState().outcomesByRequestId['nav-renderer-timeout']).toMatchObject({
        status: 'renderer_timeout',
      });
    } finally {
      vi.useRealTimers();
    }
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

  it('starts area adjustment from the native capture path when the React handle callback is unavailable', async () => {
    const updateAnnotation = vi.fn();
    const annotation = {
      id: 'ann-area-native-capture',
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

    const page = screen.getByTestId('mock-react-pdf-page-1');
    const pageRect = page.getBoundingClientRect();
    const nativeHandle = document.createElement('button');
    nativeHandle.dataset.pdfStoredAnnotationId = annotation.id;
    nativeHandle.dataset.pdfAnnotationAreaHandle = 'se';
    page.appendChild(nativeHandle);

    fireEvent.pointerDown(nativeHandle, {
      button: 0,
      clientX: pageRect.left + (0.28 * pageRect.width),
      clientY: pageRect.top + (0.30 * pageRect.height),
      pointerId: 41,
    });
    fireEvent.pointerMove(document, {
      clientX: pageRect.left + (0.36 * pageRect.width),
      clientY: pageRect.top + (0.38 * pageRect.height),
      pointerId: 41,
    });
    fireEvent.pointerUp(document, {
      clientX: pageRect.left + (0.36 * pageRect.width),
      clientY: pageRect.top + (0.38 * pageRect.height),
      pointerId: 41,
    });

    await waitFor(() => {
      expect(updateAnnotation).toHaveBeenCalled();
    });
    expect(updateAnnotation.mock.calls.at(-1)?.[1]?.target?.rects?.[0]).toMatchObject({
      x1: 0.10,
      y1: 0.20,
      x2: 0.36,
      y2: 0.38,
    });
  });

  it('does not start a new area when a resize pointer emits compatibility mouse events', async () => {
    const addAnnotation = vi.fn();
    const updateAnnotation = vi.fn();
    const annotation = {
      id: 'ann-area-pointer-compat',
      target: { type: 'pdf' as const, page: 1, rects: [{ x1: 0.10, y1: 0.20, x2: 0.28, y2: 0.30 }] },
      style: { color: '#4CAF50', type: 'area' as const },
      content: 'area',
      author: 'user',
      createdAt: 1,
    };
    useAnnotationSystemMock.mockReturnValue({
      annotations: [annotation],
      error: null,
      addAnnotation,
      updateAnnotation,
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    const areaSegment = await waitFor(() => {
      const segment = document.querySelector<HTMLElement>(
        '.pdf-stored-annotation-overlay-ann-area-pointer-compat [data-pdf-stored-annotation-segment="true"]',
      );
      expect(segment).toBeTruthy();
      return segment as HTMLElement;
    });
    fireEvent.pointerDown(areaSegment, { button: 0, clientX: 128, clientY: 240, pointerId: 21 });
    fireEvent.click(areaSegment, { clientX: 128, clientY: 240 });

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

    const seHandle = await screen.findByLabelText('Adjust area se');
    const page = screen.getByTestId('mock-react-pdf-page-1');
    const pageRect = page.getBoundingClientRect();
    const start = {
      x: pageRect.left + (0.28 * pageRect.width),
      y: pageRect.top + (0.30 * pageRect.height),
    };
    const end = {
      x: pageRect.left + (0.36 * pageRect.width),
      y: pageRect.top + (0.38 * pageRect.height),
    };

    fireEvent.pointerDown(seHandle, {
      button: 0,
      clientX: start.x,
      clientY: start.y,
      pointerId: 22,
    });
    fireEvent.mouseDown(page, { button: 0, clientX: start.x, clientY: start.y });
    fireEvent.pointerMove(document, { clientX: end.x, clientY: end.y, pointerId: 22 });
    fireEvent.mouseMove(document, { clientX: end.x, clientY: end.y });
    fireEvent.pointerUp(document, { clientX: end.x, clientY: end.y, pointerId: 22 });
    fireEvent.mouseUp(document, { clientX: end.x, clientY: end.y });

    await waitFor(() => {
      expect(updateAnnotation).toHaveBeenCalled();
    });
    expect(addAnnotation).not.toHaveBeenCalled();
    expect(updateAnnotation.mock.calls.at(-1)?.[1]?.target?.rects?.[0]).toMatchObject({
      x1: 0.10,
      y1: 0.20,
      x2: 0.36,
      y2: 0.38,
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

  it('does not start a new area when a move pointer emits compatibility mouse events', async () => {
    const addAnnotation = vi.fn();
    const updateAnnotation = vi.fn();
    const annotation = {
      id: 'ann-area-move-pointer-compat',
      target: { type: 'pdf' as const, page: 1, rects: [{ x1: 0.10, y1: 0.20, x2: 0.30, y2: 0.35 }] },
      style: { color: '#4CAF50', type: 'area' as const },
      content: 'area',
      author: 'user',
      createdAt: 1,
    };
    useAnnotationSystemMock.mockReturnValue({
      annotations: [annotation],
      error: null,
      addAnnotation,
      updateAnnotation,
      deleteAnnotation: vi.fn(),
    });

    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();

    const areaSegment = await waitFor(() => {
      const segment = document.querySelector<HTMLElement>(
        '.pdf-stored-annotation-overlay-ann-area-move-pointer-compat [data-pdf-stored-annotation-segment="true"]',
      );
      expect(segment).toBeTruthy();
      return segment as HTMLElement;
    });
    fireEvent.pointerDown(areaSegment, { button: 0, clientX: 128, clientY: 240, pointerId: 31 });
    fireEvent.click(areaSegment, { clientX: 128, clientY: 240 });

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

    const moveHandle = await screen.findByLabelText('Move area');
    const page = screen.getByTestId('mock-react-pdf-page-1');
    const pageRect = page.getBoundingClientRect();
    const start = {
      x: pageRect.left + (0.20 * pageRect.width),
      y: pageRect.top + (0.275 * pageRect.height),
    };
    const end = {
      x: pageRect.left + (0.25 * pageRect.width),
      y: pageRect.top + (0.325 * pageRect.height),
    };

    fireEvent.pointerDown(moveHandle, {
      button: 0,
      clientX: start.x,
      clientY: start.y,
      pointerId: 32,
    });
    fireEvent.mouseDown(page, { button: 0, clientX: start.x, clientY: start.y });
    fireEvent.pointerMove(document, { clientX: end.x, clientY: end.y, pointerId: 32 });
    fireEvent.mouseMove(document, { clientX: end.x, clientY: end.y });
    fireEvent.pointerUp(document, { clientX: end.x, clientY: end.y, pointerId: 32 });
    fireEvent.mouseUp(document, { clientX: end.x, clientY: end.y });

    await waitFor(() => {
      expect(updateAnnotation).toHaveBeenCalled();
    });
    expect(addAnnotation).not.toHaveBeenCalled();
    const movedRect = updateAnnotation.mock.calls.at(-1)?.[1]?.target?.rects?.[0];
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

  it('rebuilds thin but incomplete stored highlight rows from exact text boundaries', async () => {
    const lines = [
      'For the 100s state the crossover length',
      'is close to Rc=9.5 um, and at this length scale the ratio of',
      'the Rydberg interaction to the ground-state interaction',
      'is approximately 10^12.',
    ];
    const left = 72;
    const top = 210;
    const height = 24;
    const widths = [500, 520, 490, 240];
    const exact = lines.join(' ');
    selectionMockState.fragments = lines.map((text, index) => ({
      text,
      left,
      top: top + (index * 34),
      width: widths[index],
      height,
    }));
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-incomplete-thin-rows',
          target: {
            type: 'pdf',
            page: 1,
            rects: [
              { x1: left / 640, y1: top / 960, x2: (left + widths[0]) / 640, y2: (top + height) / 960 },
              { x1: left / 640, y1: (top + 34) / 960, x2: (left + 180) / 640, y2: (top + 34 + height) / 960 },
              { x1: left / 640, y1: (top + 68) / 960, x2: (left + 210) / 640, y2: (top + 68 + height) / 960 },
              { x1: left / 640, y1: (top + 102) / 960, x2: (left + widths[3]) / 640, y2: (top + 102 + height) / 960 },
            ],
            textQuote: {
              exact,
              prefix: '',
              suffix: '',
              source: 'pdfjs-text-model',
              confidence: 'exact',
            },
            startCharIndex: 0,
            endCharIndex: exact.length,
            textSource: 'pdfjs-text-model',
          },
          style: { color: '#FFEB3B', type: 'highlight' },
          content: exact,
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

    const segments = await waitFor(() => {
      const resolved = Array.from(document.querySelectorAll<HTMLElement>(
        '.pdf-stored-annotation-overlay-ann-incomplete-thin-rows [data-pdf-stored-annotation-segment="true"]',
      ));
      expect(resolved).toHaveLength(4);
      return resolved;
    });
    const canonicalLeft = Number.parseFloat(segments[0].style.left);
    const canonicalWidthScale = Number.parseFloat(segments[0].style.width) / widths[0];
    segments.forEach((segment, index) => {
      expect(Number.parseFloat(segment.style.left)).toBeCloseTo(canonicalLeft, 2);
      expect(Number.parseFloat(segment.style.width)).toBeCloseTo(widths[index] * canonicalWidthScale, 1);
    });
  });

  it.each([
    { exact: 'For small', line: 'iii For small WWW suffix', widths: [2, 2, 2, 3, 8, 5, 4, 3, 5, 9, 5, 2, 2, 3, 9, 9, 9, 3, 5, 5, 3, 3, 2, 5], lineWidth: 108, storedLeft: 58, storedRight: 98.5, measuredWidth: 43 },
    { exact: 'F', line: 'iii F WWW suffix', widths: [2, 2, 2, 3, 8, 3, 9, 9, 9, 3, 5, 5, 3, 3, 2, 5], lineWidth: 73, storedLeft: 60, storedRight: 64.5, measuredWidth: 8 },
  ])('repairs stale stored quads and offsets for $exact before the first render', async ({ exact, line, widths, lineWidth, storedLeft, storedRight, measuredWidth }) => {
    useContentCacheStore.getState().saveEditorState('paper-left', {
      cursorPosition: 0, scrollTop: 0, scrollLeft: 0,
      viewState: { pdf: { scale: 1, zoomMode: 'manual', showSidebar: false } },
    });
    const rect = { x1: storedLeft / 640, y1: 304.8 / 960, x2: storedRight / 640, y2: 328.8 / 960 };
    selectionMockState.characterWidths[line] = widths;
    selectionMockState.fragments = [{ text: line, left: 40, top: 300, width: lineWidth, height: 24 }];
    const updateAnnotation = vi.fn();
    useAnnotationSystemMock.mockReturnValue({
      annotations: [{
        id: 'ann-stale-measured',
        target: {
          type: 'pdf', page: 1, rects: [rect],
          quads: [{ x1: rect.x1, y1: rect.y1, x2: rect.x2, y2: rect.y1, x3: rect.x2, y3: rect.y2, x4: rect.x1, y4: rect.y2 }],
          textQuote: { exact, prefix: 'iii ', suffix: ' WWW suffix', source: 'pdfium-native', confidence: 'validated-native' },
          textKernelVersion: 2, startCharIndex: 0, endCharIndex: exact.length, textSource: 'pdfium-native',
        },
        style: { color: '#FFD400', type: 'highlight' }, content: exact, author: 'user', createdAt: 1,
      }],
      error: null, addAnnotation: vi.fn(), updateAnnotation, deleteAnnotation: vi.fn(),
    });
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();
    await waitFor(() => {
      const segment = document.querySelector<HTMLElement>('.pdf-stored-annotation-overlay-ann-stale-measured [data-pdf-stored-annotation-segment="true"]');
      expect(segment).toBeTruthy();
      expect(Number.parseFloat(segment!.style.left)).toBeCloseTo(49 / 640 * 100, 3);
      expect(Number.parseFloat(segment!.style.width)).toBeCloseTo(measuredWidth / 640 * 100, 3);
      expect(Number.parseFloat(segment!.style.top)).toBeCloseTo(301.68 / 960 * 100, 3);
      expect(Number.parseFloat(segment!.style.height)).toBeCloseTo(20.64 / 960 * 100, 3);
    });
  });

  it('keeps complete canonical text-markup quads when rendered character geometry is unavailable', async () => {
    const firstLine = 'at 90 degrees and a 0.6 NA microscope objective. To reach favorable';
    const secondLine = 'conditions for loading the tweezers, the atoms are first';
    const pageText = `${firstLine} ${secondLine}`;
    const exact = 'To reach favorable conditions for loading the tweezers';
    const start = pageText.indexOf('To reach favorable');
    const end = pageText.indexOf('tweezers') + 'tweezers'.length;
    const storedRects = [
      { x1: 0.3653, y1: 0.2587, x2: 0.4854, y2: 0.2720 },
      { x1: 0.0850, y1: 0.2739, x2: 0.3352, y2: 0.2872 },
    ];
    selectionMockState.fragments = [
      { text: firstLine, left: 50, top: 250, width: 330, height: 24 },
      { text: secondLine, left: 50, top: 282, width: 330, height: 24 },
    ];
    // Some WebViews return a whole row even for a one-character Range.
    selectionMockState.clientRectsOverride = [
      { left: 50, top: 250, right: 380, bottom: 274 },
      { left: 50, top: 282, right: 380, bottom: 306 },
    ];
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-canonical-quads-authoritative',
          target: {
            type: 'pdf',
            page: 1,
            rects: storedRects,
            quads: storedRects.map((rect) => ({
              x1: rect.x1,
              y1: rect.y1,
              x2: rect.x2,
              y2: rect.y1,
              x3: rect.x2,
              y3: rect.y2,
              x4: rect.x1,
              y4: rect.y2,
            })),
            textQuote: {
              exact,
              prefix: 'microscope objective. ',
              suffix: ', the atoms are first',
              source: 'pdfjs-text-model',
              confidence: 'exact',
            },
            textKernelVersion: 2,
            startCharIndex: start,
            endCharIndex: end,
            textSource: 'pdfjs-text-model',
            textConfidence: 1,
          },
          style: { color: '#FFD400', type: 'highlight' },
          content: exact,
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

    const segments = await waitFor(() => {
      const resolved = Array.from(document.querySelectorAll<HTMLElement>(
        '.pdf-stored-annotation-overlay-ann-canonical-quads-authoritative [data-pdf-stored-annotation-segment="true"]',
      ));
      expect(resolved).toHaveLength(2);
      return resolved;
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    const rightEdges = segments.map((segment) => (
      Number.parseFloat(segment.style.left) + Number.parseFloat(segment.style.width)
    ));
    expect(rightEdges[0]).toBeCloseTo(storedRects[0].x2 * 100, 2);
    expect(rightEdges[1]).toBeCloseTo(storedRects[1].x2 * 100, 2);
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

  it('repairs legacy thin highlight rows that cross the visual gutter on a two-column page', async () => {
    const updateAnnotation = vi.fn();
    const leftLines = [
      'light using a pair of acousto-optic deflectors crossed',
      'at 90 degrees and a 0.6 NA microscope objective. To reach favorable',
      'conditions for loading the tweezers, the atoms are first',
      'captured in a 3D magneto-optical trap operating on',
      'the broad transition with linewidth 29 MHz and 399 nm light',
    ];
    const rightLines = [
      'III. NEAR-DETERMINISTIC LOADING',
      'Reliable assembly of large defect-free patterns of qubits',
      'is a major pursuit for the neutral-atom tweezer array',
      'platform. While the number of atoms loaded from the MOT',
      'often employs light-assisted collisions in the array',
    ];
    const pageText = [...leftLines, ...rightLines].join(' ');
    const start = pageText.indexOf('To reach favorable');
    const end = pageText.indexOf('399 nm light') + '399 nm light'.length;
    selectionMockState.fragments = [
      ...leftLines.map((text, index) => ({
        text,
        left: 50,
        top: 220 + (index * 32),
        width: index === 0 ? 250 : 248,
        height: 24,
      })),
      ...rightLines.map((text, index) => ({
        text,
        left: 350,
        top: 220 + (index * 32),
        width: 250,
        height: 24,
      })),
    ];
    useAnnotationSystemMock.mockReturnValue({
      annotations: [
        {
          id: 'ann-legacy-two-column-gutter',
          target: {
            type: 'pdf',
            page: 1,
            rects: [
              { x1: 0.391, y1: 0.262, x2: 0.575, y2: 0.282 },
              { x1: 0.078, y1: 0.295, x2: 0.575, y2: 0.315 },
              { x1: 0.078, y1: 0.328, x2: 0.575, y2: 0.348 },
              { x1: 0.078, y1: 0.361, x2: 0.575, y2: 0.381 },
            ],
            textQuote: {
              exact: 'ctive. To reach favorable conditions for loading the tweezers, the atoms are first captured in a 3D magneto-optical trap operating on III. NEAR-DETERMINISTIC LOADING the broad transition with linewidth 29 MHz and 399 nm light',
              prefix: 'acousto-optic deflectors crossed at 90 degrees and a 0.6 NA microscope obje',
              suffix: 'Reliable assembly of large defect-free patterns',
              source: 'pdfjs-text-model',
              confidence: 'exact',
            },
            textKernelVersion: 1,
            startCharIndex: Math.max(0, start - 5),
            endCharIndex: end,
            textSource: 'pdfjs-text-model',
            textConfidence: 1,
          },
          style: { color: '#E55DE7', type: 'highlight' },
          content: 'ctive. To reach favorable conditions for loading the tweezers, the atoms are first captured in a 3D magneto-optical trap operating on III. NEAR-DETERMINISTIC LOADING the broad transition with linewidth 29 MHz and 399 nm light',
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
      const segments = document.querySelectorAll<HTMLElement>('.pdf-stored-annotation-overlay-ann-legacy-two-column-gutter [data-pdf-stored-annotation-segment="true"]');
      expect(segments.length).toBeGreaterThan(1);
    });
    const storedSegments = Array.from(document.querySelectorAll<HTMLElement>('.pdf-stored-annotation-overlay-ann-legacy-two-column-gutter [data-pdf-stored-annotation-segment="true"]'));
    const renderedRightEdges = storedSegments.map((segment) => (
      Number.parseFloat(segment.style.left) + Number.parseFloat(segment.style.width)
    ));
    expect(Math.max(...renderedRightEdges)).toBeLessThan(50);
    expect(updateAnnotation).not.toHaveBeenCalled();
  });

  it('keeps a precise stored Fig. 5 anchor stable while restoring readable highlight height', async () => {
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
    expect(renderedHeight).toBeGreaterThan(2);
    expect(renderedHeight).toBeLessThan(2.5);
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

  it('lets desktop diagnostics return to the select annotation tool', async () => {
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();
    fireEvent.keyDown(window, { key: 'a' });

    const activateSelectTool = await waitFor(() => {
      const candidate = (window as Window & {
        __latticePdfDiagnostics?: Record<string, { activateSelectTool?: () => boolean }>;
      }).__latticePdfDiagnostics?.['pane-left']?.activateSelectTool;
      expect(typeof candidate).toBe('function');
      return candidate;
    });

    act(() => {
      expect(activateSelectTool?.()).toBe(true);
    });

    await waitFor(() => {
      const selectAction = useWorkspaceStore
        .getState()
        .commandBarByPane['pane-left']
        ?.actions.find((action) => action.id === 'tool-select');
      expect(selectAction?.active).toBe(true);
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

  it('applies AI quote proposals using actual PDF geometry and waits for storage acknowledgement', async () => {
    let acknowledge!: (success: boolean) => void;
    const persistAnnotationChanges = vi.fn((_items: AnnotationItem[]) => new Promise<boolean>((resolve) => { acknowledge = resolve; }));
    useAnnotationSystemMock.mockReturnValue({ annotations: [], isLoading: false, error: null, addAnnotation: vi.fn(), updateAnnotation: vi.fn(), deleteAnnotation: vi.fn(), persistAnnotationChanges });
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();
    act(() => {
      useAiPdfCompanionStore.getState().setTransientAnnotations([{ id: 'proposal-approved', documentPath: 'docs/paper-left.pdf', page: 1, quote: 'Selected PDF text', reason: '核心实验依据', rects: [], source: { kind: 'pdf_page', label: 'paper', locator: 'docs/paper-left.pdf#page=1' } }], 'message-1');
      useAiPdfCompanionStore.getState().requestInjection();
    });
    await waitFor(() => expect(persistAnnotationChanges).toHaveBeenCalledTimes(1));
    const saved = persistAnnotationChanges.mock.calls[0][0][0];
    expect(saved).toMatchObject({ id: 'ann-proposal-approved', content: 'Selected PDF text', comment: '核心实验依据', target: { type: 'pdf', page: 1, textQuote: { exact: 'Selected PDF text' } } });
    expect(saved.target.type === 'pdf' && saved.target.rects.length).toBeGreaterThan(0);
    expect(useAiPdfCompanionStore.getState().savedAnnotations).toEqual([]);
    expect(useAiPdfCompanionStore.getState().pendingInjection).not.toBeNull();
    await act(async () => { acknowledge(true); });
    await waitFor(() => expect(useAiPdfCompanionStore.getState().savedAnnotations).toHaveLength(1));
    expect(useAiPdfCompanionStore.getState().transientAnnotations).toEqual([]);
  });

  it('does not apply an AI proposal to a nested same-name PDF', async () => {
    const persistAnnotationChanges = vi.fn(async () => true);
    useAnnotationSystemMock.mockReturnValue({ annotations: [], isLoading: false, error: null, addAnnotation: vi.fn(), updateAnnotation: vi.fn(), deleteAnnotation: vi.fn(), persistAnnotationChanges });
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper', filePath: 'archive/paper.pdf' }));
    await waitForPdfTextModelPrefetch();
    await act(async () => {
      useAiPdfCompanionStore.getState().setTransientAnnotations([{ id: 'root-paper', documentPath: 'paper.pdf', page: 1, quote: 'Selected PDF text', rects: [], source: { kind: 'pdf_page', label: 'paper', locator: 'paper.pdf#page=1' } }]);
      useAiPdfCompanionStore.getState().requestInjection();
    });
    expect(persistAnnotationChanges).not.toHaveBeenCalled();
    expect(useAiPdfCompanionStore.getState().savedAnnotations).toEqual([]);
  });

  it('resolves an absolute Windows proposal using the actual workspace root', async () => {
    useWorkspaceStore.setState({ workspaceRootPath: 'C:\\Research\\Workspace' });
    const persistAnnotationChanges = vi.fn(async () => true);
    useAnnotationSystemMock.mockReturnValue({ annotations: [], isLoading: false, error: null, addAnnotation: vi.fn(), updateAnnotation: vi.fn(), deleteAnnotation: vi.fn(), persistAnnotationChanges });
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper', filePath: 'docs/paper.pdf' }));
    await waitForPdfTextModelPrefetch();
    act(() => {
      useAiPdfCompanionStore.getState().setTransientAnnotations([{ id: 'absolute-paper', documentPath: 'c:/Research/Workspace/docs/paper.pdf', page: 1, quote: 'Selected PDF text', rects: [], source: { kind: 'pdf_page', label: 'paper', locator: 'c:/Research/Workspace/docs/paper.pdf#page=1' } }]);
      useAiPdfCompanionStore.getState().requestInjection();
    });
    await waitFor(() => expect(useAiPdfCompanionStore.getState().savedAnnotations).toHaveLength(1));
    expect(persistAnnotationChanges).toHaveBeenCalledTimes(1);
  });

  it('applies one approved AI batch once when the same PDF is open in two panes', async () => {
    let acknowledge!: (success: boolean) => void;
    const persistAnnotationChanges = vi.fn(() => new Promise<boolean>((resolve) => { acknowledge = resolve; }));
    useAnnotationSystemMock.mockReturnValue({ annotations: [], isLoading: false, error: null, addAnnotation: vi.fn(), updateAnnotation: vi.fn(), deleteAnnotation: vi.fn(), persistAnnotationChanges });
    render(<>{renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left-view', filePath: 'docs/paper.pdf', preloaded: true })}{renderPdfPane({ paneId: 'pane-right', fileId: 'paper-right-view', filePath: 'docs/paper.pdf', preloaded: true })}</>);
    await waitForPdfTextModelPrefetch();
    await waitFor(() => expect(screen.getByTestId('pdf-num-pages-pane-right').textContent).toBe('2'));
    await act(async () => {
      useAiPdfCompanionStore.getState().setTransientAnnotations([{ id: 'two-pane-paper', documentPath: 'docs/paper.pdf', page: 1, quote: 'Selected PDF text', rects: [], source: { kind: 'pdf_page', label: 'paper', locator: 'docs/paper.pdf#page=1' } }]);
      useAiPdfCompanionStore.getState().requestInjection();
    });
    expect(persistAnnotationChanges).toHaveBeenCalledTimes(1);
    await act(async () => { acknowledge(true); });
    expect(useAiPdfCompanionStore.getState().savedAnnotations).toHaveLength(1);
  });

  it('does not replay a durable AI write when its owning viewer unmounts', async () => {
    let acknowledge!: (success: boolean) => void;
    const persistAnnotationChanges = vi.fn(() => new Promise<boolean>((resolve) => { acknowledge = resolve; }));
    useAnnotationSystemMock.mockReturnValue({ annotations: [], isLoading: false, error: null, addAnnotation: vi.fn(), updateAnnotation: vi.fn(), deleteAnnotation: vi.fn(), persistAnnotationChanges });
    const left = render(renderPdfPane({ paneId: 'pane-left', fileId: 'left-view', filePath: 'docs/paper.pdf', preloaded: true }));
    render(renderPdfPane({ paneId: 'pane-right', fileId: 'right-view', filePath: 'docs/paper.pdf', preloaded: true }));
    await waitForPdfTextModelPrefetch();
    await waitFor(() => expect(screen.getByTestId('pdf-num-pages-pane-right').textContent).toBe('2'));
    await act(async () => {
      useAiPdfCompanionStore.getState().setTransientAnnotations([{ id: 'unmount-paper', documentPath: 'docs/paper.pdf', page: 1, quote: 'Selected PDF text', rects: [], source: { kind: 'pdf_page', label: 'paper', locator: 'docs/paper.pdf#page=1' } }]);
      useAiPdfCompanionStore.getState().requestInjection();
    });
    expect(persistAnnotationChanges).toHaveBeenCalledTimes(1);
    left.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(persistAnnotationChanges).toHaveBeenCalledTimes(1);
    expect(useAiPdfCompanionStore.getState().operationClaim?.phase).toBe('persisting');
    await act(async () => { acknowledge(true); });
    expect(useAiPdfCompanionStore.getState().savedAnnotations).toHaveLength(1);
    expect(useAiPdfCompanionStore.getState().operationClaim).toBeNull();
  });

  it('undoes one approved AI batch once across two panes of the same PDF', async () => {
    const annotation: AnnotationItem = { id: 'ann-shared-undo', target: { type: 'pdf', page: 1, rects: [{ x1: .1, y1: .1, x2: .2, y2: .2 }] }, style: { type: 'highlight', color: '#FFD400' }, content: 'Selected PDF text', author: 'ai', createdAt: 1 };
    let acknowledge!: (success: boolean) => void;
    const persistAnnotationChanges = vi.fn((_items: AnnotationItem[], _ids: string[]) => new Promise<boolean>((resolve) => { acknowledge = resolve; }));
    useAnnotationSystemMock.mockReturnValue({ annotations: [annotation], isLoading: false, error: null, addAnnotation: vi.fn(), updateAnnotation: vi.fn(), deleteAnnotation: vi.fn(), persistAnnotationChanges });
    render(<>{renderPdfPane({ paneId: 'pane-left', fileId: 'left-view', filePath: 'docs/paper.pdf', preloaded: true })}{renderPdfPane({ paneId: 'pane-right', fileId: 'right-view', filePath: 'docs/paper.pdf', preloaded: true })}</>);
    await waitForPdfTextModelPrefetch();
    await waitFor(() => expect(screen.getByTestId('pdf-num-pages-pane-right').textContent).toBe('2'));
    await act(async () => {
      useAiPdfCompanionStore.setState({ savedAnnotations: [{ documentPath: 'docs/paper.pdf', annotation }] });
      useAiPdfCompanionStore.getState().requestUndo('docs/paper.pdf');
    });
    expect(persistAnnotationChanges).toHaveBeenCalledTimes(1);
    expect(persistAnnotationChanges).toHaveBeenCalledWith([], ['ann-shared-undo']);
    await act(async () => { acknowledge(true); });
    expect(useAiPdfCompanionStore.getState().savedAnnotations).toEqual([]);
  });

  it('keeps AI proposals reviewable when the exact PDF quote cannot be located', async () => {
    const persistAnnotationChanges = vi.fn(async () => true);
    useAnnotationSystemMock.mockReturnValue({ annotations: [], isLoading: false, error: null, addAnnotation: vi.fn(), updateAnnotation: vi.fn(), deleteAnnotation: vi.fn(), persistAnnotationChanges });
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();
    act(() => {
      useAiPdfCompanionStore.getState().setTransientAnnotations([{ id: 'proposal-missing', documentPath: 'docs/paper-left.pdf', page: 1, quote: 'This text does not exist in the PDF.', rects: [], source: { kind: 'pdf_page', label: 'paper', locator: 'docs/paper-left.pdf#page=1' } }]);
      useAiPdfCompanionStore.getState().requestInjection();
    });
    await waitFor(() => expect(useAiPdfCompanionStore.getState().error).toContain('无法唯一定位'));
    expect(persistAnnotationChanges).not.toHaveBeenCalled();
    expect(useAiPdfCompanionStore.getState().transientAnnotations).toHaveLength(1);
    expect(useAiPdfCompanionStore.getState().savedAnnotations).toEqual([]);
  });

  it('undoes only this AI batch and preserves annotations edited after approval', async () => {
    const original: AnnotationItem = { id: 'ann-batch-original', target: { type: 'pdf', page: 1, rects: [{ x1: .1, y1: .1, x2: .2, y2: .2 }], textQuote: { exact: 'Selected PDF text', prefix: '', suffix: '', source: 'pdfjs-text-model', confidence: 'exact' } }, style: { type: 'highlight', color: '#FFD400' }, content: 'Selected PDF text', author: 'ai', createdAt: 1 };
    const laterEdited = { ...original, id: 'ann-batch-edited', comment: 'User note to retain' };
    const unrelated = { ...original, id: 'ann-user', author: 'user' };
    const persistAnnotationChanges = vi.fn(async (_items: AnnotationItem[], _ids: string[]) => true);
    useAnnotationSystemMock.mockReturnValue({ annotations: [original, laterEdited, unrelated], isLoading: false, error: null, addAnnotation: vi.fn(), updateAnnotation: vi.fn(), deleteAnnotation: vi.fn(), persistAnnotationChanges });
    render(renderPdfPane({ paneId: 'pane-left', fileId: 'paper-left' }));
    await waitForPdfTextModelPrefetch();
    act(() => {
      useAiPdfCompanionStore.setState({ savedAnnotations: [
        { documentPath: 'docs/paper-left.pdf', annotation: original },
        { documentPath: 'docs/paper-left.pdf', annotation: { ...original, id: 'ann-batch-edited' } },
      ] });
      useAiPdfCompanionStore.getState().requestUndo('docs/paper-left.pdf');
    });
    await waitFor(() => expect(persistAnnotationChanges).toHaveBeenCalledWith([], ['ann-batch-original']));
    expect(useAiPdfCompanionStore.getState().error).toContain('已保留');
    expect(useAiPdfCompanionStore.getState().savedAnnotations.map((item) => item.annotation.id)).toEqual(['ann-batch-edited']);
  });

});
