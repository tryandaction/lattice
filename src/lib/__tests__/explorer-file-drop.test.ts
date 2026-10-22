import { describe, expect, it, vi } from 'vitest';
import { captureExternalDrop, importDroppedEntries, hasExternalFileDrop, hasInternalEntryDrop } from '../explorer-file-drop';

function directory(name = 'target'): FileSystemDirectoryHandle & { entries: Map<string, unknown> } {
  const entries = new Map<string, unknown>();
  const handle = { name, kind: 'directory', entries,
    isSameEntry: async (other: unknown) => other === handle,
    getFileHandle: vi.fn(async (fileName: string, options?: { create: boolean }) => {
      if (entries.has(fileName)) {
        const item = entries.get(fileName) as { kind: string };
        if (item.kind !== 'file') throw new DOMException('Directory exists', 'TypeMismatchError');
        return item;
      }
      if (!options?.create) throw new DOMException('Missing', 'NotFoundError');
      let data: Blob = new Blob();
      let modified = 1;
      const file = { name: fileName, kind: 'file', getFile: async () => new File([data], fileName, { lastModified: modified }),
        createWritable: async () => { let pending = data; return { write: async (blob: Blob) => { pending = blob; },
          close: async () => { data = pending; modified++; }, abort: async () => {} }; } };
      entries.set(fileName, file); return file;
    }),
    getDirectoryHandle: vi.fn(async (childName: string, options?: { create: boolean }) => {
      if (entries.has(childName)) {
        const item = entries.get(childName) as { kind: string };
        if (item.kind !== 'directory') throw new DOMException('File exists', 'TypeMismatchError');
        return item;
      }
      if (!options?.create) throw new DOMException('Missing', 'NotFoundError');
      const child = directory(childName); entries.set(childName, child); return child;
    }),
    values: async function* () { yield* entries.values(); },
    removeEntry: vi.fn(async (entryName: string) => { entries.delete(entryName); }),
  };
  return handle as unknown as FileSystemDirectoryHandle & { entries: Map<string, unknown> };
}

describe('Explorer external drops', () => {
  it('recognizes protected drag-over types without attempting to read payloads', () => {
    expect(hasExternalFileDrop({ types: ['Files'], items: [], files: [] } as unknown as DataTransfer)).toBe(true);
    expect(hasInternalEntryDrop({ types: ['application/x-lattice-explorer-entry'] })).toBe(true);
    expect(hasExternalFileDrop({ types: ['text/plain'], items: [], files: [] } as unknown as DataTransfer)).toBe(false);
  });
  it('captures browser file handles synchronously before the drop event ends', async () => {
    const source = { kind: 'file', name: 'paper.pdf', getFile: async () => new File(['pdf'], 'paper.pdf') };
    const getAsFileSystemHandle = vi.fn(async () => source);
    const result = captureExternalDrop({ items: [{ kind: 'file', getAsFileSystemHandle }], files: [] } as unknown as DataTransfer);
    expect(getAsFileSystemHandle).toHaveBeenCalledOnce();
    expect(await result).toEqual([source]);
  });
  it('imports an OS directory when its native identity methods reject the desktop adapter', async () => {
    const source = directory('external');
    const file = await source.getFileHandle('nested.txt', { create: true });
    const writer = await file.createWritable(); await writer.write(new Blob(['nested'])); await writer.close();
    source.isSameEntry = async () => { throw new TypeError('Not a native FileSystemHandle'); };
    source.resolve = async () => { throw new TypeError('Not a native FileSystemHandle'); };
    const target = directory();
    const report = await importDroppedEntries(target, [source]);
    expect(report.errors).toEqual([]);
    const imported = await (await target.getDirectoryHandle(report.containerName!)).getDirectoryHandle('external');
    expect(await (await (await imported.getFileHandle('nested.txt')).getFile()).text()).toBe('nested');
  });
  it('copies files and nested folders, preserving existing content and different-kind names', async () => {
    const target = directory();
    const original = await target.getFileHandle('note.md', { create: true });
    const writer = await original.createWritable(); await writer.write(new Blob(['original'])); await writer.close();
    await target.getDirectoryHandle('image.png', { create: true });
    const nested = directory('assets');
    const nestedFile = await nested.getFileHandle('plot.png', { create: true });
    const nestedWriter = await nestedFile.createWritable(); await nestedWriter.write(new Blob(['image'])); await nestedWriter.close();
    const entries = await captureExternalDrop({ items: [], files: [new File(['new'], 'note.md'), new File(['pixels'], 'image.png')] } as unknown as DataTransfer);
    const report = await importDroppedEntries(target as unknown as FileSystemDirectoryHandle, [...entries, nested as unknown as FileSystemDirectoryHandle]);
    expect(report.errors).toEqual([]); expect(report.imported).toHaveLength(3);
    expect(await (await original.getFile()).text()).toBe('original');
    const names = report.imported.map(item => item.name);
    expect(names).toEqual(['note.md', 'image.png', 'assets']);
    const copied = await (await target.getDirectoryHandle(report.containerName!)).getDirectoryHandle('assets');
    expect(await (await (await copied.getFileHandle('plot.png')).getFile()).text()).toBe('image');
  });
  it('never starts writing after a workspace switch cancels the drop', async () => {
    const target = directory(); const signal = new AbortController(); signal.abort();
    await expect(importDroppedEntries(target as unknown as FileSystemDirectoryHandle, [], signal.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(target.getFileHandle).not.toHaveBeenCalled();
  });
  it('selects a free name after reading the source when an external file appeared meanwhile', async () => {
    const target = directory();
    let external!: FileSystemFileHandle;
    const source = { kind: 'file', name: 'note.md', getFile: async () => {
      external = await target.getFileHandle('note.md', { create: true });
      const writer = await external.createWritable(); await writer.write(new Blob(['external data'])); await writer.close();
      return new File(['import'], 'note.md');
    } } as FileSystemFileHandle;
    const report = await importDroppedEntries(target, [source]);
    expect(await (await external.getFile()).text()).toBe('external data');
    expect(report.imported).toEqual([{ name: 'note.md', kind: 'file' }]);
    expect(report.containerName).toMatch(/^Lattice Import [0-9a-f-]{36}$/);
    expect(target.removeEntry).not.toHaveBeenCalled();
  });
  it('keeps an external original file written after the last version check but before browser close', async () => {
    const target = directory();
    const source = { kind: 'file', name: 'note.md', getFile: async () => new File(['import'], 'note.md') } as FileSystemFileHandle;
    const createFile = vi.mocked(target.getFileHandle).getMockImplementation()!;
    let external = 'original';
    vi.mocked(target.getFileHandle).mockImplementation(async (name, options) => {
      if (name === 'note.md' && options?.create) {
        const handle = { name, kind: 'file', getFile: async () => new File([], name, { lastModified: 1 }),
          createWritable: async () => ({ write: async () => {}, abort: async () => {},
            close: async () => { external = 'external at final check'; external = 'import'; } }) };
        target.entries.set(name, handle);
        return handle as unknown as FileSystemFileHandle;
      }
      return createFile(name, options);
    });
    await importDroppedEntries(target, [source]);
    expect(external).toBe('original');
    expect(target.getFileHandle).not.toHaveBeenCalledWith('note.md', { create: true });
  });
  it('never writes or removes an external file returned by a raced browser create', async () => {
    const target = directory();
    const external = { name: 'note.md', kind: 'file', getFile: async () => new File(['external data'], 'note.md'),
      createWritable: vi.fn(async () => { throw new Error('External writer must not be opened'); }) };
    const createFile = vi.mocked(target.getFileHandle).getMockImplementation()!;
    vi.mocked(target.getFileHandle).mockImplementation(async (name, options) => {
      if (options?.create) { target.entries.set(name, external); return external as unknown as FileSystemFileHandle; }
      return createFile(name, options);
    });
    const sources = await captureExternalDrop({ items: [], files: [new File(['new'], 'note.md')] } as unknown as DataTransfer);
    const isolated = directory('isolated');
    target.getDirectoryHandle = vi.fn(async (name: string, options?: { create?: boolean }) => {
      if (options?.create) { target.entries.set(name, isolated); return isolated; }
      throw new DOMException('Missing', 'NotFoundError');
    });
    isolated.getFileHandle = target.getFileHandle;
    const report = await importDroppedEntries(target, sources);
    expect(report.imported).toEqual([]);
    expect(report.errors).toHaveLength(1);
    expect(external.createWritable).not.toHaveBeenCalled();
    expect(target.entries.get('note.md')).toBe(external);
    expect(target.removeEntry).not.toHaveBeenCalled();
  });
  it('keeps an external directory and its files when the browser create races with another process', async () => {
    const target = directory(), source = directory('assets'), external = directory('assets');
    const precious = await external.getFileHandle('existing.txt', { create: true });
    const writer = await precious.createWritable(); await writer.write(new Blob(['external data'])); await writer.close();
    source.entries.set('broken.txt', { name: 'broken.txt', kind: 'file', getFile: async () => new File(['source'], 'broken.txt') });
    const createDirectory = vi.mocked(target.getDirectoryHandle).getMockImplementation()!;
    vi.mocked(target.getDirectoryHandle).mockImplementation(async (name, options) => {
      if (options?.create) { target.entries.set(name, external); return external; }
      return createDirectory(name, options);
    });
    const report = await importDroppedEntries(target, [source]);
    expect(report.imported).toEqual([]);
    expect([...target.entries.values()]).toContain(external);
    expect(await (await precious.getFile()).text()).toBe('external data');
    expect(target.removeEntry).not.toHaveBeenCalled();
  });
  it('retains external directory data when a late source failure follows a name-check race', async () => {
    const target = directory(), source = directory('assets'), external = directory('assets');
    const precious = await external.getFileHandle('precious.txt', { create: true });
    const writer = await precious.createWritable(); await writer.write(new Blob(['external bytes'])); await writer.close();
    source.entries.set('broken.txt', { kind: 'file', name: 'broken.txt', getFile: async () => {
      target.entries.set('assets', external); throw new Error('Source unavailable');
    } });
    const createDirectory = vi.mocked(target.getDirectoryHandle).getMockImplementation()!;
    vi.mocked(target.getDirectoryHandle).mockImplementation(async (name, options) => {
      if (options?.create) { target.entries.set(name, external); return external; }
      return createDirectory(name, options);
    });
    const report = await importDroppedEntries(target, [source]);
    expect(report.imported).toEqual([]);
    expect(report.errors).toEqual(['assets: Source unavailable']);
    expect(target.entries.get('assets')).toBe(external);
    expect(await (await precious.getFile()).text()).toBe('external bytes');
    expect(target.removeEntry).not.toHaveBeenCalled();
  });
  it('keeps an unproven browser target when opening its writer fails', async () => {
    const target = directory();
    const original = await target.getFileHandle('note.md', { create: true });
    const writer = await original.createWritable(); await writer.write(new Blob(['original'])); await writer.close();
    const isolated = directory('isolated');
    const createFile = vi.mocked(isolated.getFileHandle).getMockImplementation()!;
    vi.mocked(isolated.getFileHandle).mockImplementation(async (name, options) => {
      const handle = await createFile(name, options);
      if (options?.create) handle.createWritable = async () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
      return handle;
    });
    const createDirectory = vi.mocked(target.getDirectoryHandle).getMockImplementation()!;
    vi.mocked(target.getDirectoryHandle).mockImplementation(async (name, options) => {
      if (options?.create) { target.entries.set(name, isolated); return isolated; }
      return createDirectory(name, options);
    });
    const sources = await captureExternalDrop({ items: [], files: [new File(['new'], 'note.md')] } as unknown as DataTransfer);
    const report = await importDroppedEntries(target, sources);
    expect(report.imported).toEqual([]);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain('Quota exceeded');
    expect([...isolated.entries.keys()]).toEqual(['note.md']);
    expect(target.removeEntry).not.toHaveBeenCalled();
    expect(await (await original.getFile()).text()).toBe('original');
  });
  it('reads the entire source snapshot before a browser directory import creates any destination', async () => {
    const target = directory(), source = directory('assets');
    await source.getFileHandle('complete.txt', { create: true });
    source.entries.set('broken.txt', { name: 'broken.txt', kind: 'file', getFile: async () => { throw new Error('Source unavailable'); } });
    const report = await importDroppedEntries(target, [source]);
    expect(report.imported).toEqual([]);
    expect(report.errors).toEqual(['assets: Source unavailable']);
    expect([...target.entries.keys()]).toEqual([]);
  });
  it('aborts pending browser bytes without deleting an unproven target on cancellation', async () => {
    const target = directory(), controller = new AbortController();
    const isolated = directory('isolated');
    const createFile = vi.mocked(isolated.getFileHandle).getMockImplementation()!;
    vi.mocked(isolated.getFileHandle).mockImplementation(async (name, options) => {
      const handle = await createFile(name, options);
      if (options?.create) {
        const createWritable = handle.createWritable.bind(handle);
        handle.createWritable = async (...args) => {
          const writer = await createWritable(...args);
          const write = writer.write.bind(writer);
          writer.write = async value => { await write(value); controller.abort(); };
          return writer;
        };
      }
      return handle;
    });
    const createDirectory = vi.mocked(target.getDirectoryHandle).getMockImplementation()!;
    vi.mocked(target.getDirectoryHandle).mockImplementation(async (name, options) => {
      if (options?.create) { target.entries.set(name, isolated); return isolated; }
      return createDirectory(name, options);
    });
    const sources = await captureExternalDrop({ items: [], files: [new File(['new'], 'note.md')] } as unknown as DataTransfer);
    await expect(importDroppedEntries(target, sources, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect([...isolated.entries.keys()]).toEqual(['note.md']);
    expect(await (await (await isolated.getFileHandle('note.md')).getFile()).text()).toBe('');
    expect(target.removeEntry).not.toHaveBeenCalled();
  });
  it('rejects dropping a folder into its own descendant without copying recursively', async () => {
    const target = directory(), source = directory('source');
    const resolve = vi.fn(async () => ['inside']);
    Object.assign(source, { resolve });
    const result = await importDroppedEntries(target as unknown as FileSystemDirectoryHandle, [source as unknown as FileSystemDirectoryHandle]);
    expect(result.imported).toEqual([]); expect(result.errors).toHaveLength(1);
    expect(target.getDirectoryHandle).not.toHaveBeenCalled();
  });
});
