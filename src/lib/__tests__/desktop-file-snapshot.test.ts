import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopFileHandle } from '../desktop-file-system';

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
