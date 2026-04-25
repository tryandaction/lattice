import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPdfEditorState,
  calculatePdfFitScale,
  clearScopedPdfPaneId,
  captureRelativeScrollPosition,
  clampPdfScale,
  getScopedPdfPaneId,
  getPdfWheelZoomDelta,
  isPdfInteractionActive,
  readCachedPdfViewState,
  restoreRelativeScrollPosition,
  setScopedPdfPaneId,
  type ScrollContainerLike,
} from '../pdf-view-state';

describe('pdf-view-state helpers', () => {
  beforeEach(() => {
    clearScopedPdfPaneId();
  });

  it('reads valid cached pdf view state', () => {
    expect(readCachedPdfViewState({
      viewState: {
        pdf: {
          scale: 1.5,
          zoomMode: 'fit-width',
          showSidebar: true,
        },
      },
    })).toEqual({
      scale: 1.5,
      zoomMode: 'fit-width',
      showSidebar: true,
    });
  });

  it('rejects invalid cached pdf view state payloads', () => {
    expect(readCachedPdfViewState(undefined)).toBeNull();
    expect(readCachedPdfViewState({
      viewState: {
        pdf: {
          scale: 'bad',
          zoomMode: 'fit-width',
          showSidebar: true,
        },
      },
    })).toBeNull();
    expect(readCachedPdfViewState({
      viewState: {
        pdf: {
          scale: 1.2,
          zoomMode: 'page-width',
          showSidebar: true,
        },
      },
    })).toBeNull();
  });

  it('builds persistable editor state for pdf view restoration', () => {
    expect(buildPdfEditorState({
      scale: 1.8,
      zoomMode: 'fit-page',
      showSidebar: false,
      scrollTop: 320,
      scrollLeft: 44,
    })).toEqual({
      cursorPosition: 0,
      scrollTop: 320,
      scrollLeft: 44,
      viewState: {
        pdf: {
          scale: 1.8,
          zoomMode: 'fit-page',
          showSidebar: false,
        },
      },
    });
  });

  it('captures and restores relative scroll position', () => {
    const scrollTo = vi.fn();
    const before = {
      scrollTop: 400,
      scrollLeft: 120,
      scrollHeight: 2000,
      clientHeight: 500,
      scrollWidth: 1200,
      clientWidth: 300,
    };
    const relative = captureRelativeScrollPosition(before);
    const after: ScrollContainerLike = {
      ...before,
      scrollHeight: 3200,
      clientHeight: 800,
      scrollWidth: 2000,
      clientWidth: 500,
      scrollTo,
    };

    restoreRelativeScrollPosition(after, relative);

    expect(scrollTo).toHaveBeenCalledWith({
      top: (400 / 1500) * 2400,
      left: (120 / 900) * 1500,
      behavior: 'auto',
    });
  });

  it('evaluates pane interaction scope and zoom delta helpers', () => {
    expect(isPdfInteractionActive({ paneId: 'pane-left', isPaneActive: false })).toBe(false);
    expect(isPdfInteractionActive({ paneId: 'pane-left', isPaneActive: true })).toBe(true);

    setScopedPdfPaneId('pane-right');
    expect(getScopedPdfPaneId()).toBe('pane-right');
    expect(isPdfInteractionActive({ paneId: 'pane-left', isPaneActive: true })).toBe(false);
    expect(isPdfInteractionActive({ paneId: 'pane-right', isPaneActive: false })).toBe(true);

    clearScopedPdfPaneId('pane-left');
    expect(getScopedPdfPaneId()).toBe('pane-right');
    clearScopedPdfPaneId('pane-right');
    expect(getScopedPdfPaneId()).toBeNull();

    expect(clampPdfScale(5, 0.25, 4)).toBe(4);
    expect(clampPdfScale(0.1, 0.25, 4)).toBe(0.25);
    expect(clampPdfScale(1.5, 0.25, 4)).toBe(1.5);

    expect(getPdfWheelZoomDelta(-100, 0.25)).toBe(0.25);
    expect(getPdfWheelZoomDelta(100, 0.25)).toBe(-0.25);
  });

  it('calculates fit-width scale from the widest measured page', () => {
    expect(calculatePdfFitScale({
      zoomMode: 'fit-width',
      containerWidth: 800,
      containerHeight: 600,
      pageDimensions: [
        { pageNumber: 1, width: 600, height: 900 },
        { pageNumber: 2, width: 720, height: 900 },
      ],
      minScale: 0.5,
      maxScale: 3,
    })).toBeCloseTo((800 - 32) / 720, 4);
  });

  it('calculates fit-page scale from the requested target page', () => {
    expect(calculatePdfFitScale({
      zoomMode: 'fit-page',
      containerWidth: 800,
      containerHeight: 600,
      pageDimensions: [
        { pageNumber: 1, width: 600, height: 900 },
        { pageNumber: 2, width: 500, height: 400 },
      ],
      targetPageNumber: 2,
      minScale: 0.5,
      maxScale: 3,
    })).toBeCloseTo(Math.min((800 - 32) / 500, (600 - 32) / 400), 4);
  });

  it('returns null for fit scale when container or page data is unavailable', () => {
    expect(calculatePdfFitScale({
      zoomMode: 'fit-width',
      containerWidth: 0,
      containerHeight: 600,
      pageDimensions: [{ pageNumber: 1, width: 600, height: 900 }],
      minScale: 0.5,
      maxScale: 3,
    })).toBeNull();

    expect(calculatePdfFitScale({
      zoomMode: 'fit-page',
      containerWidth: 800,
      containerHeight: 600,
      pageDimensions: [],
      minScale: 0.5,
      maxScale: 3,
    })).toBeNull();
  });
});
