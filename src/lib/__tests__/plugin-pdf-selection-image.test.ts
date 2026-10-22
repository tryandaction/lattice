import { afterEach, describe, expect, it, vi } from 'vitest';
import { __pluginRuntimeTest } from '../plugins/runtime';
import { setPdfSelectionImageProvider } from '../pdf-selection-image-provider';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { PluginPdfSelectionImage } from '../plugins/types';

const image: PluginPdfSelectionImage = { pageNumber: 2, width: 300, height: 90, dataUrl: 'data:image/png;base64,a', mimeType: 'image/png',
  bbox: { x1: .2, y1: .3, x2: .6, y2: .4 }, source: 'current-selection', document: { filePath: 'A.pdf', paneId: 'left', tabId: 'A', revision: '4:1' } };
function activate(path = 'A.pdf') {
  const getFile = vi.fn(async () => new File(['scan'], path, { lastModified: 1 }));
  const tab = { id: path[0], kind: 'file' as const, fileName: path, filePath: path, fileHandle: { getFile } as unknown as FileSystemFileHandle, isDirty: false, scrollPosition: 0 };
  useWorkspaceStore.setState({ layout: { activePaneId: 'left', root: { type: 'pane', id: 'left', tabs: [tab], activeTabIndex: 0 } } });
  return getFile;
}
afterEach(() => setPdfSelectionImageProvider(null));
describe('plugin PDF image host boundary', () => {
  it('binds source image pixels to the active file revision', async () => {
    activate(); setPdfSelectionImageProvider(() => image);
    expect(await __pluginRuntimeTest.capturePdfSelectionImage()).toMatchObject({ document: { filePath: 'A.pdf', tabId: 'A', paneId: 'left', revision: '4:1' } });
  });
  it('rejects pixels whose loaded PDF revision is older than the current file before capture starts', async () => {
    activate();
    setPdfSelectionImageProvider(() => ({ ...image, document: { ...image.document!, revision: '4:0' } }));
    await expect(__pluginRuntimeTest.capturePdfSelectionImage()).rejects.toThrow(/source changed|来源或选区已改变/);
  });
  it('does not label an image with the current file revision when its loaded version is unverified', async () => {
    activate(); setPdfSelectionImageProvider(() => ({ ...image, document: { ...image.document!, revision: undefined } }));
    await expect(__pluginRuntimeTest.capturePdfSelectionImage()).rejects.toThrow(/source changed|来源或选区已改变/);
  });
  it('rejects a tab switch during capture even before provider effects are refreshed', async () => {
    activate(); setPdfSelectionImageProvider(async () => { activate('B.pdf'); return image; });
    await expect(__pluginRuntimeTest.capturePdfSelectionImage()).rejects.toThrow(/source changed|来源或选区已改变/);
  });
  it('rejects stale file revisions before invoking the image provider', async () => {
    activate(); const provider = vi.fn(() => image); setPdfSelectionImageProvider(provider);
    await expect(__pluginRuntimeTest.capturePdfSelectionImage({ expectedDocument: { filePath: 'A.pdf', fileName: 'A.pdf', viewerType: 'pdf', paneId: 'left', tabId: 'A', revision: '4:0' } })).rejects.toThrow(/source changed|来源或选区已改变/);
    expect(provider).not.toHaveBeenCalled();
  });
  it('rejects a saved file revision that changes while pixels are being captured', async () => {
    const getFile = activate();
    setPdfSelectionImageProvider(async () => {
      getFile.mockResolvedValue(new File(['scan'], 'A.pdf', { lastModified: 2 }));
      return image;
    });
    await expect(__pluginRuntimeTest.capturePdfSelectionImage()).rejects.toThrow(/source changed|来源或选区已改变/);
  });
});
