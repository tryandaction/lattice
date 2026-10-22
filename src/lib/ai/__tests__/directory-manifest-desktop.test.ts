import { describe, expect, it, vi } from 'vitest';
import { DesktopDirectoryHandle } from '@/lib/desktop-file-system';
import { discoverDirectoryManifest } from '../directory-manifest';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/lib/storage-adapter', () => ({ isTauri: () => true, invokeTauriCommand: (...args: unknown[]) => native.invoke(...args) }));

describe('native metadata directory manifest', () => {
  it('rechecks native directory cache on resume without transferring PDF bytes or following symlinks', async () => {
    const rootPath = `C:/synthetic-${crypto.randomUUID()}`, root = new DesktopDirectoryHandle('study', rootPath);
    let names = ['large.pdf'];
    native.invoke.mockImplementation(async (command: string, args: { path: string }) => {
      if (command === 'desktop_read_dir' && args.path === rootPath) return [
        ...names.map(name => ({ name, isFile: true, isDirectory: false, isSymlink: false })),
        { name: 'linked', isFile: false, isDirectory: true, isSymlink: true },
      ];
      if (command === 'desktop_file_metadata') return { size: 50_000_000, modifiedMs: 1234 };
      throw new Error(`Unexpected private content access ${command}`);
    });
    const options = { rootHandle: root, workspaceKey: rootPath, selections: [{ kind: 'folder' as const, path: '.' }], onCheckpoint: async () => {} };
    const first = await discoverDirectoryManifest(options);
    expect(first.files.map(file => file.path)).toEqual(['large.pdf']);
    names = ['last.pdf'];
    const next = await discoverDirectoryManifest({ ...options, checkpoint: first });
    expect(next.files).toEqual([expect.objectContaining({ path: 'last.pdf', size: 50_000_000, lastModified: 1234 })]);
    expect(next.removedPaths).toEqual(['large.pdf']);
    expect(next.changedPaths).toEqual(['last.pdf']);
    expect(native.invoke.mock.calls.filter(([command]) => command === 'desktop_read_dir')).toHaveLength(2);
    expect(native.invoke.mock.calls.some(([command]) => String(command).includes('read_file'))).toBe(false);
    expect(native.invoke.mock.calls.some(([, args]) => (args as { path: string }).path.includes('/linked'))).toBe(false);
  });
});
