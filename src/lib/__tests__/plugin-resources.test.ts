/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadStoredPlugin, loadStoredPluginResource, storePluginPackage } from '@/lib/plugins/repository';

function toBase64(input: string): string {
  if (typeof btoa === 'function') {
    return btoa(input);
  }
  return Buffer.from(input, 'utf8').toString('base64');
}

function decodeBytes(bytes: Uint8Array): string {
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}

describe('plugin resources', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores and loads text resources from localStorage fallback', async () => {
    await storePluginPackage(
      'demo.plugin',
      { id: 'demo.plugin', name: 'Demo', version: '1.0.0' },
      'export function activate() {}',
      {
        'assets/hello.txt': toBase64('hello'),
        'ui/panel.md': toBase64('# Panel'),
      }
    );

    const asset = await loadStoredPluginResource('demo.plugin', 'assets/hello.txt');
    expect(asset).not.toBeNull();
    expect(asset?.mimeType).toBe('text/plain; charset=utf-8');
    expect(decodeBytes(asset!.bytes)).toBe('hello');

    const panel = await loadStoredPluginResource('demo.plugin', 'ui/panel.md');
    expect(panel).not.toBeNull();
    expect(panel?.mimeType).toBe('text/markdown; charset=utf-8');
    expect(decodeBytes(panel!.bytes)).toBe('# Panel');
  });

  it('normalizes resource paths and ignores invalid paths', async () => {
    await storePluginPackage(
      'demo.plugin',
      { id: 'demo.plugin', name: 'Demo', version: '1.0.0' },
      'export function activate() {}',
      {
        'assets\\icon.svg': toBase64('<svg></svg>'),
        'images/logo.png': toBase64('nope'),
      }
    );

    const normalized = await loadStoredPluginResource('demo.plugin', 'assets/icon.svg');
    expect(normalized).not.toBeNull();
    expect(normalized?.mimeType).toBe('image/svg+xml');
    expect(decodeBytes(normalized!.bytes)).toBe('<svg></svg>');

    const invalid = await loadStoredPluginResource('demo.plugin', 'images/logo.png');
    expect(invalid).toBeNull();
  });

  it('restores the complete OPFS resource tree on an asset-stage failure', async () => {
    const root = new MemoryDirectory();
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { getDirectory: async () => root } });

    await storePluginPackage('opfs.plugin', { id: 'opfs.plugin', name: 'OPFS', version: '1.0.0' }, 'old-main', {
      'assets/old.txt': toBase64('old asset'),
    });
    root.failName = 'new.txt';

    await expect(storePluginPackage('opfs.plugin', { id: 'opfs.plugin', name: 'OPFS', version: '2.0.0' }, 'new-main', {
      'assets/new.txt': toBase64('new asset'),
    })).rejects.toThrow('asset write failed');

    expect((await loadStoredPlugin('opfs.plugin'))?.manifest.version).toBe('1.0.0');
    const oldAsset = await loadStoredPluginResource('opfs.plugin', 'assets/old.txt');
    expect(oldAsset && decodeBytes(oldAsset.bytes)).toBe('old asset');
    expect(await loadStoredPluginResource('opfs.plugin', 'assets/new.txt')).toBeNull();
  });

  it('rejects OPFS resources when the commit marker is absent', async () => {
    const root = new MemoryDirectory();
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { getDirectory: async () => root } });
    const plugin = await root.getDirectoryHandle('lattice-plugins', { create: true });
    const dir = await plugin.getDirectoryHandle('partial.plugin', { create: true });
    await dir.getFileHandle('manifest.json', { create: true });
    expect(await loadStoredPluginResource('partial.plugin', 'assets/missing.txt')).toBeNull();
    expect(await loadStoredPlugin('partial.plugin')).toBeNull();
  });

  it('migrates a complete legacy OPFS package without a commit marker', async () => {
    const root = new MemoryDirectory();
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { getDirectory: async () => root } });
    await storePluginPackage('legacy.plugin', { id: 'legacy.plugin', name: 'Legacy', version: '1.0.0' }, 'legacy-main', {
      'assets/legacy.txt': toBase64('legacy asset'),
    });
    const pluginsRoot = await root.getDirectoryHandle('lattice-plugins');
    const legacyDir = await pluginsRoot.getDirectoryHandle('legacy.plugin');
    await legacyDir.removeEntry('commit.json');

    expect((await loadStoredPlugin('legacy.plugin'))?.manifest.version).toBe('1.0.0');
    expect(await loadStoredPluginResource('legacy.plugin', 'assets/legacy.txt')).not.toBeNull();
  });

  it('rejects a pending OPFS package even when manifest and main are present', async () => {
    const root = new MemoryDirectory();
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { getDirectory: async () => root } });
    await storePluginPackage('pending.plugin', { id: 'pending.plugin', name: 'Pending', version: '1.0.0' }, 'old-main');
    const pluginsRoot = await root.getDirectoryHandle('lattice-plugins');
    const pendingDir = await pluginsRoot.getDirectoryHandle('pending.plugin');
    await pendingDir.removeEntry('commit.json');
    const pending = await pendingDir.getFileHandle('pending.json', { create: true });
    const writable = await pending.createWritable();
    await writable.write('{"id":"pending.plugin","version":"2.0.0"}');
    await writable.close();

    expect(await loadStoredPlugin('pending.plugin')).toBeNull();
    expect(await loadStoredPluginResource('pending.plugin', 'assets/anything.txt')).toBeNull();
  });
});

class MemoryFile {
  kind = 'file' as const;
  constructor(public name: string, public content: string | Blob = '') {}
  async getFile() {
    const blob = this.content instanceof Blob ? this.content : new Blob([this.content]);
    return { text: () => blob.text(), arrayBuffer: () => blob.arrayBuffer() };
  }
  async createWritable() {
    return {
      write: async (value: string | Blob) => { this.content = value; },
      close: async () => undefined,
    };
  }
}

class MemoryDirectory {
  kind = 'directory' as const;
  name = 'root';
  entries = new Map<string, MemoryDirectory | MemoryFile>();
  failName: string | null = null;
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const current = this.entries.get(name);
    if (current instanceof MemoryDirectory) {
      current.failName = this.failName;
      return current;
    }
    if (options?.create) {
      const next = new MemoryDirectory();
      next.name = name;
      next.failName = this.failName;
      this.entries.set(name, next);
      return next;
    }
    throw new Error('directory missing');
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (this.failName === name) {
      this.failName = null;
      throw new Error('asset write failed');
    }
    const current = this.entries.get(name);
    if (current instanceof MemoryFile) return current;
    if (options?.create) {
      const next = new MemoryFile(name);
      this.entries.set(name, next);
      return next;
    }
    throw new Error('file missing');
  }
  async removeEntry(name: string) {
    this.entries.delete(name);
  }
  async *values() {
    for (const entry of this.entries.values()) yield entry;
  }
}
