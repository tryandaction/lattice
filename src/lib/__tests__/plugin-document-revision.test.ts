import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginContext, PluginModule, PluginPdfSelectionImage } from '../plugins/types';
import { DesktopFileHandle } from '../desktop-file-system';
import { syncPlugins } from '../plugins/runtime';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { setPdfSelectionImageProvider } from '../pdf-selection-image-provider';

const fixtures = vi.hoisted(() => ({ invoke: vi.fn(), plugin: null as PluginModule | null }));
vi.mock('@/lib/storage-adapter', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/storage-adapter')>(), isTauri: () => true, invokeTauriCommand: (...args: unknown[]) => fixtures.invoke(...args) }));
vi.mock('@/lib/plugins/registry', () => ({ getPluginModule: () => fixtures.plugin }));
vi.mock('@/lib/plugins/repository', () => ({ loadStoredPlugin: vi.fn(async () => null), loadStoredPluginResource: vi.fn() }));

const image: PluginPdfSelectionImage = { pageNumber: 1, width: 300, height: 90, dataUrl: 'data:image/png;base64,fixture', mimeType: 'image/png',
  bbox: { x1: .1, y1: .1, x2: .5, y2: .2 }, source: 'current-selection', document: { filePath: 'paper.pdf', paneId: 'left', tabId: 'paper', revision: '4:12345' } };
describe('plugin document revision through real desktop handles', () => {
  let ctx: PluginContext;
  let modifiedMs: number | null;
  beforeEach(async () => {
    fixtures.invoke.mockReset(); modifiedMs = 12345;
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(50_000);
    fixtures.invoke.mockImplementation(async (command: string) => {
      vi.setSystemTime(Date.now() + 10);
      if (command === 'desktop_file_metadata') return { size: 4, modifiedMs };
      if (command === 'desktop_read_file_bytes_raw') return new TextEncoder().encode('scan');
      throw new Error(`Unexpected command: ${command}`);
    });
    const handle = new DesktopFileHandle('paper.pdf', 'C:/synthetic/paper.pdf');
    const tab = { id: 'paper', kind: 'file' as const, fileName: 'paper.pdf', filePath: 'paper.pdf', fileHandle: handle, isDirty: false, scrollPosition: 0 };
    useWorkspaceStore.setState({ layout: { activePaneId: 'left', root: { type: 'pane', id: 'left', tabs: [tab], activeTabIndex: 0 } } });
    fixtures.plugin = { manifest: { id: 'revision-fixture', name: 'Revision fixture', version: '1.0.0', permissions: ['read-current-document'] }, activate: context => { ctx = context; } };
    await syncPlugins({ pluginsEnabled: true, enabledPluginIds: ['revision-fixture'] });
  });
  afterEach(async () => { setPdfSelectionImageProvider(null); await syncPlugins({ pluginsEnabled: false, enabledPluginIds: [] }); vi.useRealTimers(); });
  it('uses stable OS metadata across getActive and selection capture without reading the entire PDF', async () => {
    setPdfSelectionImageProvider(() => image);
    const active = await ctx.document.getActive();
    const captured = await ctx.document.getPdfSelectionImage({ expectedDocument: active });
    expect(active.revision).toBe('4:12345');
    expect(captured?.document?.revision).toBe(active.revision);
    expect((await ctx.document.getActive()).revision).toBe(active.revision);
    expect(fixtures.invoke.mock.calls.some(([command]) => command === 'desktop_read_file_bytes_raw')).toBe(false);
  });
  it('returns an empty selection to the workflow rather than a false source-change error', async () => {
    setPdfSelectionImageProvider(() => null);
    const active = await ctx.document.getActive();
    await expect(ctx.document.getPdfSelectionImage({ expectedDocument: active })).resolves.toBeNull();
  });
  it('still rejects a real modification while rendering and reads the next revision freshly', async () => {
    const active = await ctx.document.getActive();
    setPdfSelectionImageProvider(() => { modifiedMs = 12346; return image; });
    await expect(ctx.document.getPdfSelectionImage({ expectedDocument: active })).rejects.toThrow(/source changed|来源或选区已改变/);
    expect((await ctx.document.getActive()).revision).toBe('4:12346');
  });
  it('preserves the browser handle File.lastModified contract', async () => {
    const tab = useWorkspaceStore.getState().getActiveTab()!;
    const getFile = vi.fn(async () => new File(['scan'], 'paper.pdf', { lastModified: 6789 }));
    useWorkspaceStore.setState({ layout: { activePaneId: 'left', root: { type: 'pane', id: 'left', tabs: [{ ...tab, kind: 'file', fileHandle: { getFile } as unknown as FileSystemFileHandle }], activeTabIndex: 0 } } });
    setPdfSelectionImageProvider(() => ({ ...image, document: { ...image.document!, revision: '4:6789' } }));
    const active = await ctx.document.getActive();
    expect(active.revision).toBe('4:6789');
    await expect(ctx.document.getPdfSelectionImage({ expectedDocument: active })).resolves.toMatchObject({ document: { revision: '4:6789' } });
    expect(fixtures.invoke).not.toHaveBeenCalled();
  });
  it('rejects missing desktop modification metadata without falling back to document bytes', async () => {
    modifiedMs = null;
    await expect(ctx.document.getActive()).rejects.toMatchObject({ name: 'NotReadableError' });
    expect(fixtures.invoke.mock.calls.some(([command]) => command === 'desktop_read_file_bytes_raw')).toBe(false);
  });
  it('does not attach a revision to an old tab identity if the active tab changes during metadata lookup', async () => {
    const original = fixtures.invoke.getMockImplementation()!;
    fixtures.invoke.mockImplementation(async (...args: unknown[]) => {
      const value = await original(...args);
      const tab = useWorkspaceStore.getState().getActiveTab()!;
      useWorkspaceStore.setState({ layout: { activePaneId: 'left', root: { type: 'pane', id: 'left', tabs: [{ ...tab, id: 'other', filePath: 'other.pdf', fileName: 'other.pdf' }], activeTabIndex: 0 } } });
      return value;
    });
    await expect(ctx.document.getActive()).rejects.toThrow(/source changed|来源或选区已改变/);
  });
});
