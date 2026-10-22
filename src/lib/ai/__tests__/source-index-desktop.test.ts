import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopDirectoryHandle } from '@/lib/desktop-file-system';
import { createAuthorizedSourceIndex } from '../source-index';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/lib/storage-adapter', () => ({ isTauri: () => true, invokeTauriCommand: (...args: unknown[]) => native.invoke(...args) }));

describe('desktop source index avoids transferring document bytes for metadata', () => {
  beforeEach(() => { native.invoke.mockReset(); });
  function fixture() {
    const root = new DesktopDirectoryHandle('study', `C:/synthetic-${crypto.randomUUID()}`);
    native.invoke.mockImplementation(async (command: string, args: { path: string }) => {
      if (command === 'desktop_read_dir') return [
        { name: 'large.pdf', isFile: true, isDirectory: false, isSymlink: false },
        { name: 'note.txt', isFile: true, isDirectory: false, isSymlink: false },
      ];
      if (command === 'desktop_file_metadata') return { size: args.path.endsWith('.pdf') ? 100_000_000 : 5, modifiedMs: 12345 };
      if (command === 'desktop_read_file_bytes_raw' && args.path.endsWith('note.txt')) return new TextEncoder().encode('hello');
      throw new Error(`Unexpected content transfer: ${command}`);
    });
    return createAuthorizedSourceIndex({ rootHandle: root, workspaceKey: root.fullPath, selections: [{ kind: 'folder', path: '.' }] });
  }
  it('lists exact sizes and timestamps without reading either document body', async () => {
    const index = fixture();
    const page = await index.list({ limit: 10 });
    expect(page.entries).toEqual([
      expect.objectContaining({ path: 'large.pdf', size: 100_000_000, lastModified: 12345 }),
      expect.objectContaining({ path: 'note.txt', size: 5, lastModified: 12345 }),
    ]);
    expect(native.invoke.mock.calls.filter(([command]) => command === 'desktop_read_file_bytes_raw')).toHaveLength(0);
  });
  it('rejects an oversized source before transferring its bytes', async () => {
    const index = fixture();
    await expect(index.read({ path: 'large.pdf', maxSourceBytes: 32_000_000 })).rejects.toThrow(/extraction byte budget/);
    expect(native.invoke.mock.calls.filter(([command]) => command === 'desktop_read_file_bytes_raw')).toHaveLength(0);
  });
  it('still reads and hashes the actual selected content', async () => {
    const index = fixture();
    const result = await index.read({ path: 'note.txt' });
    expect(result.chunks[0].text).toBe('hello');
    expect(result.snapshot.version).toContain('note.txt|5|');
    expect(native.invoke.mock.calls.filter(([command]) => command === 'desktop_read_file_bytes_raw')).toHaveLength(1);
  });
  it('does not fall back to a full read when metadata access fails', async () => {
    const index = fixture();
    const original = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (...args: unknown[]) => { if (args[0] === 'desktop_file_metadata') throw new Error('File access denied'); return original(...args); });
    await expect(index.list()).rejects.toThrow('File access denied');
    expect(native.invoke.mock.calls.filter(([command]) => command === 'desktop_read_file_bytes_raw')).toHaveLength(0);
  });

  it('never discovers or reads a symlinked directory outside the selected workspace root', async () => {
    const rootPath = `C:/synthetic-${crypto.randomUUID()}`;
    const root = new DesktopDirectoryHandle('study', rootPath);
    native.invoke.mockImplementation(async (command: string, args: { path: string }) => {
      if (command === 'desktop_read_dir' && args.path === rootPath) return [
        { name: 'papers', isFile: false, isDirectory: true, isSymlink: false },
        { name: 'linked-lab', isFile: false, isDirectory: true, isSymlink: true },
      ];
      if (command === 'desktop_read_dir' && args.path === `${rootPath}/papers`) return [
        { name: 'paper.md', isFile: true, isDirectory: false, isSymlink: false },
      ];
      if (command === 'desktop_file_metadata' && args.path === `${rootPath}/papers/paper.md`) return { size: 5, modifiedMs: 12345 };
      throw new Error(`Symlink target metadata/content must not be requested: ${command} ${args.path}`);
    });
    const index = createAuthorizedSourceIndex({ rootHandle: root, workspaceKey: rootPath, selections: [{ kind: 'folder', path: '.' }] });

    await expect(index.read({ path: 'linked-lab/private.md' })).rejects.toThrow(/not found|outside/i);
    expect((await index.list({ limit: 20 })).entries.map(entry => entry.path)).toEqual(['papers/paper.md']);
    expect(native.invoke.mock.calls.some(([command, args]) =>
      command === 'desktop_read_dir' && (args as { path: string }).path.startsWith(`${rootPath}/linked-lab`))).toBe(false);
    expect(native.invoke.mock.calls.some(([command]) => command === 'desktop_read_file_bytes_raw')).toBe(false);
  });
});
