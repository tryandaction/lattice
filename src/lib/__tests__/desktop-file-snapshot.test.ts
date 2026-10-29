import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { DesktopDirectoryHandle, DesktopFileHandle } from '../desktop-file-system';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/lib/storage-adapter', () => ({ isTauri: () => true, invokeTauriCommand: (...args: unknown[]) => native.invoke(...args) }));

describe('desktop file snapshots use verified OS modification times', () => {
  beforeEach(() => { native.invoke.mockReset(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(50_000); });
  afterEach(() => vi.useRealTimers());
  function fixture() {
    const state = { bytes: new TextEncoder().encode('old text'), modifiedMs: 12345 as number | null, duringRead: () => {} };
    native.invoke.mockImplementation(async (command: string) => {
      if (command === 'desktop_file_metadata') return { size: state.bytes.byteLength, modifiedMs: state.modifiedMs };
      if (command === 'desktop_read_file_bytes_raw') { const bytes = state.bytes.slice(); state.duringRead(); return bytes; }
      throw new Error(`Unexpected command: ${command}`);
    });
    return { state, handle: new DesktopFileHandle('paper.pdf', 'C:/synthetic/paper.pdf') };
  }
  it('returns the same real lastModified across different reading times', async () => {
    const { handle } = fixture();
    const first = await handle.getFile();
    vi.setSystemTime(90_000);
    const second = await handle.getFile();
    expect([first.lastModified, second.lastModified]).toEqual([12345, 12345]);
    expect(first.size).toBe(8);
  });
  it('observes an actual same-size file update without caching its old modification time', async () => {
    const { state, handle } = fixture();
    const first = await handle.getFile();
    state.bytes = new TextEncoder().encode('new text'); state.modifiedMs = 12346;
    const second = await handle.getFile();
    expect([first.lastModified, second.lastModified]).toEqual([12345, 12346]);
    expect(await second.text()).toBe('new text');
  });
  it('rejects a file that changes during byte reading instead of labeling old bytes with a new revision', async () => {
    const { state, handle } = fixture();
    state.duringRead = () => { state.bytes = new TextEncoder().encode('new text'); state.modifiedMs = 12346; };
    await expect(handle.getFile()).rejects.toMatchObject({ name: 'NotReadableError' });
  });
  it('rejects truncated byte transfers even when metadata did not change', async () => {
    const { handle } = fixture();
    const original = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation((command: string) => command === 'desktop_read_file_bytes_raw' ? Promise.resolve(new Uint8Array([1])) : original(command));
    await expect(handle.getFile()).rejects.toMatchObject({ name: 'NotReadableError' });
  });
  it('reports unavailable OS timestamps rather than inventing one from the clock', async () => {
    const { state, handle } = fixture(); state.modifiedMs = null;
    await expect(handle.getFile()).rejects.toMatchObject({ name: 'NotReadableError' });
    expect(native.invoke.mock.calls.some(([command]) => command === 'desktop_read_file_bytes_raw')).toBe(false);
  });
  it('preserves the actual epoch timestamp instead of treating zero as missing', async () => {
    const { state, handle } = fixture(); state.modifiedMs = 0;
    expect((await handle.getFile()).lastModified).toBe(0);
  });
});

describe('desktop file system API compatibility', () => {
  it('rejects unsupported synchronous access handles explicitly', async () => {
    native.invoke.mockReset();
    const handle = new DesktopFileHandle('paper.pdf', 'C:/synthetic/paper.pdf');
    expectTypeOf(handle).toExtend<FileSystemFileHandle>();
    expectTypeOf(handle.createSyncAccessHandle).returns.toEqualTypeOf<Promise<never>>();
    await expect(handle.createSyncAccessHandle()).rejects.toMatchObject({ name: 'NotSupportedError' });
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('exposes async directory iterators through the platform iterator contract', () => {
    const handle = new DesktopDirectoryHandle('root', 'C:/synthetic');
    const iterator = handle.entries();
    expect(typeof iterator[Symbol.asyncIterator]).toBe('function');
    expectTypeOf(handle).toExtend<FileSystemDirectoryHandle>();
    expectTypeOf(iterator).toExtend<AsyncGenerator<[string, FileSystemDirectoryHandle | FileSystemFileHandle], void, unknown>>();
  });

  it('enumerates native directory handles through every iterator and closes an early return', async () => {
    native.invoke.mockReset();
    const root = `C:/synthetic-iterators-${crypto.randomUUID()}`;
    native.invoke.mockImplementation(async (command: string, args: { path: string }) => {
      if (command === 'desktop_read_dir' && args.path === root) return [
        { name: 'paper.pdf', isFile: true, isDirectory: false, isSymlink: false },
        { name: 'notes', isFile: false, isDirectory: true, isSymlink: false },
        { name: 'outside', isFile: false, isDirectory: true, isSymlink: true },
      ];
      throw new Error(`Unexpected native directory read: ${command}`);
    });
    const handle: FileSystemDirectoryHandle = new DesktopDirectoryHandle('root', root);
    const keys: string[] = [];
    for await (const name of handle.keys()) keys.push(name);
    expect(keys).toEqual(['paper.pdf', 'notes']);
    const values: FileSystemHandle[] = [];
    for await (const entry of handle.values()) values.push(entry);
    expect(values[0]).toBeInstanceOf(DesktopFileHandle);
    expect(values[1]).toBeInstanceOf(DesktopDirectoryHandle);
    const entries: Array<[string, string]> = [];
    for await (const [name, entry] of handle) entries.push([name, entry.kind]);
    expect(entries).toEqual([['paper.pdf', 'file'], ['notes', 'directory']]);
    const iterator = handle.entries();
    expect(await iterator.next()).toMatchObject({ done: false, value: ['paper.pdf', expect.any(DesktopFileHandle)] });
    expect(await iterator.return?.()).toMatchObject({ done: true });
    expect(await iterator.next()).toMatchObject({ done: true });
  });
});
