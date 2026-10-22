/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DragEvent } from 'react';
import { useExplorerFileDrop } from '../use-explorer-file-drop';

const fixture = vi.hoisted(() => {
  const root = { name: 'vault', kind: 'directory' } as FileSystemDirectoryHandle;
  return { state: { rootHandle: root, fileTree: { root: { path: 'vault' } },
    updateTabFile: vi.fn(), updateTabPath: vi.fn(), updateTabPathPrefix: vi.fn() },
    refresh: vi.fn(), expand: vi.fn(), resolve: vi.fn(), import: vi.fn(), copy: vi.fn(), move: vi.fn(),
    success: vi.fn(), error: vi.fn() };
});
vi.mock('@/stores/workspace-store', () => ({ useWorkspaceStore: Object.assign(
  (selector: (state: typeof fixture.state) => unknown) => selector(fixture.state), { getState: () => fixture.state }) }));
vi.mock('@/hooks/use-file-system', () => ({ useFileSystem: () => ({ refreshDirectory: fixture.refresh,
  ensureDirectoryExpanded: fixture.expand, copyEntry: fixture.copy, moveEntry: fixture.move }) }));
vi.mock('@/hooks/use-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/file-operations', () => ({ resolveDirectoryHandle: fixture.resolve }));
vi.mock('@/lib/explorer-file-drop', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/explorer-file-drop')>(), importDroppedEntries: fixture.import,
}));
vi.mock('sonner', () => ({ toast: { success: fixture.success, error: fixture.error } }));

function drag(target: Element, dataTransfer: object, ctrlKey = false) {
  return { target, currentTarget: target, dataTransfer, ctrlKey, metaKey: false,
    preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as DragEvent<HTMLElement>;
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.state.rootHandle = { name: 'vault', kind: 'directory' } as FileSystemDirectoryHandle;
  fixture.resolve.mockResolvedValue(fixture.state.rootHandle);
  fixture.import.mockResolvedValue({ imported: [{ name: 'new.txt', kind: 'file' }], errors: [] });
  fixture.move.mockResolvedValue({ success: true, path: 'vault/note.md', handle: { kind: 'file' } });
  fixture.copy.mockResolvedValue({ success: true, path: 'vault/note (1).md', handle: { kind: 'file' } });
});
describe('Explorer drop boundary', () => {
  it('imports at the hovered folder and expands it after writing', async () => {
    const { result } = renderHook(useExplorerFileDrop);
    const row = document.createElement('div'); row.dataset.explorerDropDirectory = 'vault/figures';
    const label = row.appendChild(document.createElement('span'));
    const event = drag(label, { types: ['Files'], items: [], files: [new File(['image'], 'new.txt')] as unknown as FileList });
    act(() => result.current.onDropCapture(event));
    await waitFor(() => expect(fixture.expand).toHaveBeenCalledWith('vault/figures'));
    expect(fixture.resolve).toHaveBeenCalledWith(fixture.state.rootHandle, 'vault/figures');
    expect(fixture.import.mock.calls[0][1][0].name).toBe('new.txt');
    expect(fixture.refresh).toHaveBeenCalledWith({ silent: true });
    expect(result.current.busy).toBe(false);
  });
  it('shows and expands the actual isolated browser import directory', async () => {
    fixture.import.mockResolvedValueOnce({ imported: [{ name: 'paper.pdf', kind: 'file' }], errors: [], containerName: 'Lattice Import uuid' });
    const { result } = renderHook(useExplorerFileDrop);
    act(() => result.current.onDropCapture(drag(document.createElement('div'), {
      types: ['Files'], items: [], files: [new File(['x'], 'paper.pdf')],
    })));
    await waitFor(() => expect(fixture.expand).toHaveBeenCalledWith('vault/Lattice Import uuid'));
    expect(fixture.success).toHaveBeenCalledWith('explorer.drop.imported', { description: 'explorer.drop.browserIsolated' });
  });
  it('cancels an in-flight import on root switch without refreshing the new root', async () => {
    let complete!: (value: unknown) => void;
    fixture.import.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const { result, rerender } = renderHook(useExplorerFileDrop);
    act(() => result.current.onDropCapture(drag(document.createElement('div'), {
      types: ['Files'], items: [], files: [new File(['x'], 'new.txt')] as unknown as FileList,
    })));
    await waitFor(() => expect(fixture.import).toHaveBeenCalledOnce());
    const signal = fixture.import.mock.calls[0][2] as AbortSignal;
    fixture.state.rootHandle = { name: 'other', kind: 'directory' } as FileSystemDirectoryHandle;
    rerender();
    expect(signal.aborted).toBe(true);
    await act(async () => complete({ imported: [{ name: 'new.txt' }], errors: [] }));
    expect(fixture.refresh).not.toHaveBeenCalled();
    expect(fixture.success).not.toHaveBeenCalled();
  });
  it('moves into blank root space and keeps the open tab bound to its new handle', async () => {
    const { result } = renderHook(useExplorerFileDrop);
    const event = drag(document.createElement('div'), { types: ['application/x-lattice-explorer-entry'],
      getData: () => JSON.stringify({ kind: 'file', path: 'vault/old/note.md' }) });
    act(() => result.current.onDrop(event));
    await waitFor(() => expect(fixture.move).toHaveBeenCalledWith('vault/old/note.md', 'vault'));
    expect(fixture.state.updateTabFile).toHaveBeenCalledWith('vault/old/note.md', 'vault/note.md', expect.anything());
    expect(fixture.copy).not.toHaveBeenCalled();
  });
  it('Ctrl-drop copies without rebinding or moving the source tab', async () => {
    const { result } = renderHook(useExplorerFileDrop);
    act(() => result.current.onDrop(drag(document.createElement('div'), {
      types: ['application/x-lattice-explorer-entry'], getData: () => JSON.stringify({ kind: 'file', path: 'vault/old/note.md' }),
    }, true)));
    await waitFor(() => expect(fixture.copy).toHaveBeenCalledWith('vault/old/note.md', 'vault'));
    expect(fixture.move).not.toHaveBeenCalled();
    expect(fixture.state.updateTabFile).not.toHaveBeenCalled();
  });
});
