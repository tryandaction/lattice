/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImageViewer } from '../image-viewer';

vi.mock('@/hooks/use-annotation-navigation', () => ({
  useAnnotationNavigation: () => {},
}));

const exportEditedBlobFromSourceBlob = vi.fn();
const saveImageCopyToWorkspace = vi.fn();
const exportFile = vi.fn();

vi.mock('@/lib/image-editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/image-editor')>()),
  exportEditedBlobFromSourceBlob: (...args: unknown[]) => exportEditedBlobFromSourceBlob(...args),
  saveImageCopyToWorkspace: (...args: unknown[]) => saveImageCopyToWorkspace(...args),
}));

vi.mock('@/lib/export-adapter', () => ({
  exportFile: (...args: unknown[]) => exportFile(...args),
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
    exportEditedBlobFromSourceBlob.mockResolvedValue(new Blob([new Uint8Array([7, 8, 9])], { type: 'image/png' }));
    saveImageCopyToWorkspace.mockResolvedValue({ fileName: 'sample-edited.png', filePath: 'figures/sample-edited.png' });
    exportFile.mockResolvedValue({ success: true, filePath: 'sample-edited.png' });
    createObjectURL
      .mockReturnValueOnce('blob:image-1')
      .mockReturnValueOnce('blob:image-2')
      .mockReturnValue('blob:edited-image');
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = revokeObjectURL;
    globalThis.ResizeObserver = MockResizeObserver as typeof ResizeObserver;
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('opens a compact edit tray and previews transform edits', async () => {
    render(
      <ImageViewer
        source={{ kind: 'buffer', data: new Uint8Array([1, 2, 3]).buffer }}
        fileName="editable.png"
        mimeType="image/png"
      />,
    );

    const image = await screen.findByRole('img', { name: 'editable.png' });

    fireEvent.click(screen.getByTestId('image-edit-toggle'));
    expect(screen.getByTestId('image-edit-tray')).toBeTruthy();

    fireEvent.click(screen.getByTestId('image-edit-rotate'));
    fireEvent.click(screen.getByTestId('image-edit-flip-horizontal'));
    fireEvent.click(screen.getByTestId('image-edit-crop-toggle'));
    fireEvent.change(screen.getByTestId('image-edit-crop-left'), { target: { value: '12' } });
    fireEvent.change(screen.getByTestId('image-edit-crop-top'), { target: { value: '8' } });
    fireEvent.change(screen.getByTestId('image-edit-brightness'), { target: { value: '0.25' } });

    expect(image.style.transform).toContain('rotate(90deg)');
    expect(image.style.transform).toContain('scale(-1, 1)');
    expect(image.style.filter).toContain('brightness(1.25)');
    expect(image.style.clipPath).toBe('inset(8% 0% 0% 12%)');
    expect(screen.getByTestId('image-edit-count').textContent).toContain('4');

    fireEvent.click(screen.getByTestId('image-edit-compare'));
    expect(image.style.transform).toContain('rotate(0deg)');
    expect(image.style.transform).toContain('scale(1, 1)');
    expect(image.style.filter).toContain('brightness(1)');
    expect(image.style.clipPath).toBe('none');

    fireEvent.click(screen.getByTestId('image-edit-compare'));
    expect(image.style.transform).toContain('rotate(90deg)');
    expect(image.style.transform).toContain('scale(-1, 1)');
    expect(image.style.filter).toContain('brightness(1.25)');
    expect(image.style.clipPath).toBe('inset(8% 0% 0% 12%)');

    fireEvent.click(screen.getByTestId('image-edit-reset'));
    expect(image.style.transform).toContain('rotate(0deg)');
    expect(image.style.filter).toContain('brightness(1)');
    expect(image.style.clipPath).toBe('none');
    expect(screen.queryByTestId('image-edit-count')).toBeNull();
  });

  it('exports edited copies without replacing the original image url', async () => {
    const content = new Uint8Array([1, 2, 3]).buffer;

    render(
      <ImageViewer
        source={{ kind: 'buffer', data: content }}
        fileName="sample.png"
        mimeType="image/png"
      />,
    );

    const image = await screen.findByRole('img', { name: 'sample.png' });
    const originalImageUrl = image.getAttribute('src');
    expect(originalImageUrl).toMatch(/^blob:image-/);

    fireEvent.click(screen.getByTestId('image-edit-toggle'));
    fireEvent.click(screen.getByTestId('image-edit-crop-toggle'));
    fireEvent.change(screen.getByTestId('image-edit-crop-left'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('image-edit-rotate'));
    fireEvent.change(screen.getByTestId('image-edit-contrast'), { target: { value: '0.4' } });
    fireEvent.click(screen.getByTestId('image-edit-export'));

    await waitFor(() => {
      expect(exportEditedBlobFromSourceBlob).toHaveBeenCalledTimes(1);
    });

    expect(exportEditedBlobFromSourceBlob).toHaveBeenCalledWith(expect.objectContaining({
      sourceBlob: expect.any(Blob),
      mimeType: 'image/png',
      operations: [
        { type: 'crop', rect: { x: 10, y: 0, width: 90, height: 100 } },
        { type: 'rotate', degrees: 90 },
        { type: 'adjust', brightness: 0, contrast: 0.4 },
      ],
    }));
    expect(exportFile).toHaveBeenCalledWith(expect.any(Blob), {
      defaultFileName: 'sample-edited.png',
      filters: [{ name: 'PNG image', extensions: ['png'], mimeType: 'image/png' }],
    });
    expect(screen.getByTestId('image-edit-export-success').textContent).toContain('sample-edited.png');
    expect(image.getAttribute('src')).toBe(originalImageUrl);
  });

  it('saves edited copies to the workspace before falling back to export', async () => {
    const rootHandle = {} as FileSystemDirectoryHandle;

    render(
      <ImageViewer
        source={{ kind: 'buffer', data: new Uint8Array([1, 2, 3]).buffer }}
        fileName="sample.png"
        mimeType="image/png"
        rootHandle={rootHandle}
        filePath="figures/sample.png"
      />,
    );

    await screen.findByRole('img', { name: 'sample.png' });
    fireEvent.click(screen.getByTestId('image-edit-toggle'));
    fireEvent.click(screen.getByTestId('image-edit-rotate'));
    fireEvent.click(screen.getByTestId('image-edit-export'));

    await waitFor(() => {
      expect(saveImageCopyToWorkspace).toHaveBeenCalledTimes(1);
    });

    expect(saveImageCopyToWorkspace).toHaveBeenCalledWith({
      rootHandle,
      sourceFilePath: 'figures/sample.png',
      defaultFileName: 'sample-edited.png',
      blob: expect.any(Blob),
    });
    expect(exportFile).not.toHaveBeenCalled();
    expect(screen.getByTestId('image-edit-export-success').textContent).toContain('figures/sample-edited.png');
  });

  it('falls back to the export adapter when workspace image copy saving fails', async () => {
    saveImageCopyToWorkspace.mockRejectedValueOnce(new Error('workspace unavailable'));

    render(
      <ImageViewer
        source={{ kind: 'buffer', data: new Uint8Array([1, 2, 3]).buffer }}
        fileName="sample.png"
        mimeType="image/png"
        rootHandle={{} as FileSystemDirectoryHandle}
        filePath="figures/sample.png"
      />,
    );

    await screen.findByRole('img', { name: 'sample.png' });
    fireEvent.click(screen.getByTestId('image-edit-toggle'));
    fireEvent.click(screen.getByTestId('image-edit-rotate'));
    fireEvent.click(screen.getByTestId('image-edit-export'));

    await waitFor(() => {
      expect(exportFile).toHaveBeenCalledTimes(1);
    });

    expect(saveImageCopyToWorkspace).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('image-edit-export-success').textContent).toContain('sample-edited.png');
  });

  it('leaves the edit tray unchanged when export is cancelled', async () => {
    exportFile.mockResolvedValueOnce({ success: false, cancelled: true });

    render(
      <ImageViewer
        source={{ kind: 'buffer', data: new Uint8Array([1, 2, 3]).buffer }}
        fileName="sample.png"
        mimeType="image/png"
      />,
    );

    await screen.findByRole('img', { name: 'sample.png' });
    fireEvent.click(screen.getByTestId('image-edit-toggle'));
    fireEvent.click(screen.getByTestId('image-edit-rotate'));
    fireEvent.click(screen.getByTestId('image-edit-export'));

    await waitFor(() => {
      expect(exportFile).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByTestId('image-edit-export-success')).toBeNull();
    expect(screen.queryByTestId('image-edit-error')).toBeNull();
    expect(screen.getByTestId('image-edit-count').textContent).toContain('1');
  });
});
