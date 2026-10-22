import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/lib/storage-adapter', () => ({ isTauri: () => true, invokeTauriCommand: native.invoke }));
import { importDroppedEntries } from '../explorer-file-drop';
import { createDesktopDirectoryHandle } from '../desktop-file-system';

function source(name = 'paper.pdf', size = 4): FileSystemFileHandle {
  return { kind: 'file', name, getFile: async () => new File([new Uint8Array(size)], name) } as FileSystemFileHandle;
}

beforeEach(() => {
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command: string) => {
    if (command === 'desktop_begin_drop_import') return 'owned-token';
    if (command === 'desktop_commit_drop_import') return 'paper (1).pdf';
  });
});

describe('desktop external drop staging boundary', () => {
  it('uses the native final name and never exposes final create/write/remove calls', async () => {
    const report = await importDroppedEntries(createDesktopDirectoryHandle('C:/synthetic'), [source()]);
    expect(report).toEqual({ imported: [{ name: 'paper (1).pdf', kind: 'file' }], errors: [] });
    expect(native.invoke.mock.calls.map(call => call[0])).toEqual([
      'desktop_begin_drop_import', 'desktop_write_drop_import', 'desktop_commit_drop_import',
    ]);
    expect(native.invoke).toHaveBeenCalledWith('desktop_begin_drop_import', { target: 'C:/synthetic', kind: 'file' }, expect.anything());
    expect(native.invoke).toHaveBeenCalledWith('desktop_commit_drop_import', { token: 'owned-token', name: 'paper.pdf' }, expect.anything());
  });

  it('sends bounded chunks and does not commit a failed write', async () => {
    native.invoke.mockImplementation(async (command: string, args: { append?: boolean }) => {
      if (command === 'desktop_begin_drop_import') return 'owned-token';
      if (command === 'desktop_write_drop_import' && args.append) throw new Error('device failed');
    });
    const report = await importDroppedEntries(createDesktopDirectoryHandle('C:/synthetic'), [source('large.bin', 1024 * 1024 + 3)]);
    expect(report.imported).toEqual([]); expect(report.errors).toEqual(['large.bin: device failed']);
    const writes = native.invoke.mock.calls.filter(call => call[0] === 'desktop_write_drop_import');
    expect(writes.map(call => [call[1].data.length, call[1].append])).toEqual([[1024 * 1024, false], [3, true]]);
    expect(native.invoke.mock.calls.some(call => call[0] === 'desktop_commit_drop_import')).toBe(false);
    expect(native.invoke.mock.calls.at(-1)?.slice(0, 2)).toEqual(['desktop_abort_drop_import', { token: 'owned-token' }]);
  });

  it('cancels before commit and aborts only the opaque native stage', async () => {
    const controller = new AbortController();
    native.invoke.mockImplementation(async (command: string) => {
      if (command === 'desktop_begin_drop_import') return 'owned-token';
      if (command === 'desktop_write_drop_import') controller.abort();
    });
    await expect(importDroppedEntries(createDesktopDirectoryHandle('C:/synthetic'), [source()], controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(native.invoke.mock.calls.map(call => call[0])).toEqual([
      'desktop_begin_drop_import', 'desktop_write_drop_import', 'desktop_abort_drop_import',
    ]);
  });

  it('keeps a successful native commit when cancellation arrives after that commit', async () => {
    const controller = new AbortController();
    native.invoke.mockImplementation(async (command: string) => {
      if (command === 'desktop_begin_drop_import') return 'owned-token';
      if (command === 'desktop_commit_drop_import') { controller.abort(); return 'paper.pdf'; }
    });
    expect(await importDroppedEntries(createDesktopDirectoryHandle('C:/synthetic'), [source()], controller.signal))
      .toEqual({ imported: [{ name: 'paper.pdf', kind: 'file' }], errors: [] });
    expect(native.invoke.mock.calls.some(call => call[0] === 'desktop_abort_drop_import')).toBe(false);
  });
});
