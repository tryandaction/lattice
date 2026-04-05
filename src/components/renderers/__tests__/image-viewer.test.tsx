/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ImageViewer } from '../image-viewer';

vi.mock('@/hooks/use-annotation-navigation', () => ({
  useAnnotationNavigation: () => {},
}));

const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();

class MockResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

describe('ImageViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createObjectURL
      .mockReturnValueOnce('blob:image-1')
      .mockReturnValueOnce('blob:image-2');
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = revokeObjectURL;
    globalThis.ResizeObserver = MockResizeObserver as typeof ResizeObserver;
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps the rendered image visible across re-renders and only revokes old urls on replacement/unmount', async () => {
    const firstContent = new Uint8Array([1, 2, 3]).buffer;
    const secondContent = new Uint8Array([4, 5, 6]).buffer;

    const { rerender, unmount } = render(
      <ImageViewer
        source={{ kind: 'buffer', data: firstContent }}
        fileName="sample.png"
        mimeType="image/png"
      />,
    );

    await waitFor(() => {
      const image = screen.getByRole('img', { name: 'sample.png' });
      expect(image.getAttribute('src')).toBe('blob:image-1');
    });

    expect(revokeObjectURL).not.toHaveBeenCalled();

    rerender(
      <ImageViewer
        source={{ kind: 'buffer', data: secondContent }}
        fileName="sample.png"
        mimeType="image/png"
      />,
    );

    await waitFor(() => {
      const image = screen.getByRole('img', { name: 'sample.png' });
      expect(image.getAttribute('src')).toBe('blob:image-2');
    });

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:image-1');

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:image-2');
  });

  it('keeps the same image visible across time and same-content rerenders', async () => {
    const content = new Uint8Array([9, 8, 7]).buffer;
    createObjectURL.mockReset();
    createObjectURL.mockReturnValue('blob:image-stable');

    const { rerender } = render(
      <ImageViewer
        source={{ kind: 'buffer', data: content }}
        fileName="stable.png"
        mimeType="image/png"
      />,
    );

    await waitFor(() => {
      const image = screen.getByRole('img', { name: 'stable.png' });
      expect(image.getAttribute('src')).toBe('blob:image-stable');
    });

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(10000);

    rerender(
      <ImageViewer
        source={{ kind: 'buffer', data: content }}
        fileName="stable.png"
        mimeType="image/png"
      />,
    );

    const image = screen.getByRole('img', { name: 'stable.png' });
    expect(image.getAttribute('src')).toBe('blob:image-stable');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('uses desktop preview urls without creating blob urls', async () => {
    render(
      <ImageViewer
        source={{ kind: 'desktop-url', url: 'http://lattice-preview.localhost/images/sample.png', mimeType: 'image/png' }}
        fileName="desktop.png"
        mimeType="image/png"
      />,
    );

    const image = await screen.findByRole('img', { name: 'desktop.png' });
    expect(image.getAttribute('src')).toBe('http://lattice-preview.localhost/images/sample.png');

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });
});
