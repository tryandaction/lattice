import { afterEach, describe, expect, it } from 'vitest';
import { getActivePdfSelectionImage, setPdfSelectionImageProvider } from '../pdf-selection-image-provider';

const image = { pageNumber: 1, dataUrl: 'data:image/png;base64,a', mimeType: 'image/png' as const, width: 300, height: 90,
  bbox: { x1: .1, y1: .2, x2: .4, y2: .3 }, source: 'current-selection' as const,
  document: { filePath: 'A.pdf', paneId: 'pane-A', tabId: 'tab-A' } };
afterEach(() => setPdfSelectionImageProvider(null));
describe('PDF selection image provider identity', () => {
  it('rejects pixels from a provider replaced during an asynchronous capture', async () => {
    let finish!: (value: typeof image) => void;
    setPdfSelectionImageProvider(() => new Promise(resolve => { finish = resolve; }));
    const pending = getActivePdfSelectionImage();
    setPdfSelectionImageProvider(() => null);
    finish(image);
    await expect(pending).rejects.toThrow(/changed|expired|改变|失效/i);
  });
  it('rejects a captured region belonging to a different requested document', async () => {
    setPdfSelectionImageProvider(() => image);
    await expect(getActivePdfSelectionImage({ expectedDocument: { filePath: 'B.pdf', fileName: 'B.pdf', viewerType: 'pdf', paneId: 'pane-B', tabId: 'tab-B' } })).rejects.toThrow(/changed|expired|改变|失效/i);
  });
});
