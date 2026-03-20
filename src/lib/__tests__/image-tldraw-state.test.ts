import { describe, expect, it } from 'vitest';
import {
  buildImageAssetProps,
  getImageRegionCenter,
  hasBackgroundShape,
  shouldRestoreImageBackground,
  shouldUpdateImageAsset,
} from '../image-tldraw-state';

describe('image-tldraw-state helpers', () => {
  it('builds stable background asset props', () => {
    expect(buildImageAssetProps({
      fileName: 'figure.png',
      imageUrl: 'blob:image-1',
      imageSize: { width: 1200, height: 800 },
      mimeType: 'image/png',
    })).toEqual({
      name: 'figure.png',
      src: 'blob:image-1',
      w: 1200,
      h: 800,
      mimeType: 'image/png',
      isAnimated: false,
    });
  });

  it('detects when an existing image asset needs refresh after rerender', () => {
    const nextProps = buildImageAssetProps({
      fileName: 'figure.png',
      imageUrl: 'blob:image-2',
      imageSize: { width: 1200, height: 800 },
      mimeType: 'image/png',
    });

    expect(shouldUpdateImageAsset({
      type: 'image',
      props: {
        src: 'blob:image-1',
        w: 1200,
        h: 800,
        mimeType: 'image/png',
      },
    }, nextProps)).toBe(true);

    expect(shouldUpdateImageAsset({
      type: 'image',
      props: nextProps,
    }, nextProps)).toBe(false);
  });

  it('detects missing background asset or shape for auto-recovery', () => {
    expect(shouldRestoreImageBackground({
      backgroundShape: { id: 'shape:background' },
      backgroundAsset: { id: 'asset:background-image' },
    })).toBe(false);

    expect(shouldRestoreImageBackground({
      backgroundShape: null,
      backgroundAsset: { id: 'asset:background-image' },
    })).toBe(true);

    expect(shouldRestoreImageBackground({
      backgroundShape: { id: 'shape:background' },
      backgroundAsset: null,
    })).toBe(true);
  });

  it('tracks background shape existence and maps image region centers', () => {
    expect(hasBackgroundShape([
      { id: 'shape:other' },
      { id: 'shape:background' },
    ], 'shape:background')).toBe(true);

    expect(getImageRegionCenter(
      { x: 10, y: 20, width: 30, height: 40 },
      { width: 1000, height: 800 },
    )).toEqual({
      x: 250,
      y: 320,
    });
  });
});
