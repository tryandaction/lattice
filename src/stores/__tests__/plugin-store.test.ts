/** @vitest-environment jsdom */

import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadStoredPlugin, storePluginPackage } from '@/lib/plugins/repository';
import { usePluginStore } from '@/stores/plugin-store';
import type { PluginManifest } from '@/lib/plugins/types';

const fixtures = vi.hoisted(() => {
  const settings = {
    pluginsEnabled: true,
    enabledPlugins: [] as string[],
    trustedPlugins: [] as string[],
    pluginNetworkAllowlist: [] as string[],
  };
  const updateSettings = vi.fn(async (updates: Partial<typeof settings>) => {
    Object.assign(settings, updates);
    return true;
  });
  return { settings, updateSettings, deactivate: vi.fn(async () => undefined) };
});

vi.mock('@/lib/plugins/runtime', () => ({
  deactivatePluginById: fixtures.deactivate,
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({ settings: fixtures.settings, updateSettings: fixtures.updateSettings }),
  },
}));

function manifest(version: string): PluginManifest {
  return {
    id: 'formula-extractor',
    name: 'Formula Extractor Replacement',
    version,
    main: 'main.js',
    permissions: ['ui:commands'],
  };
}

async function zipPackage(version: string): Promise<File> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest(version)));
  zip.file('main.js', 'export function activate() {}');
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new File([buffer], `formula-extractor-${version}.zip`, { type: 'application/zip' });
}

function directoryPackage(version: string): FileSystemDirectoryHandle {
  const files = new Map<string, File>([
    ['manifest.json', new File([JSON.stringify(manifest(version))], 'manifest.json')],
    ['main.js', new File(['export function activate() {}'], 'main.js')],
  ]);
  return {
    kind: 'directory',
    name: 'formula-extractor',
    getFileHandle: vi.fn(async (name: string) => ({
      kind: 'file',
      name,
      getFile: async () => files.get(name)!,
    })),
    getDirectoryHandle: vi.fn(async () => { throw new Error('missing directory'); }),
  } as unknown as FileSystemDirectoryHandle;
}

describe('plugin store replacement transactions', () => {
  beforeEach(async () => {
    localStorage.clear();
    fixtures.settings.enabledPlugins = ['formula-extractor', 'other.plugin'];
    fixtures.settings.trustedPlugins = ['formula-extractor', 'other.plugin'];
    fixtures.updateSettings.mockClear().mockImplementation(async (updates: Partial<typeof fixtures.settings>) => {
      Object.assign(fixtures.settings, updates);
      return true;
    });
    fixtures.deactivate.mockClear();
    usePluginStore.setState({ plugins: [], isLoading: false, error: null });
    await storePluginPackage('formula-extractor', manifest('0.9.0'), 'export function activate() {}');
  });

  it('revokes only the replaced ID, stops it, and stores a real ZIP package disabled', async () => {
    await usePluginStore.getState().installFromZip(await zipPackage('1.2.0'));

    expect(fixtures.deactivate).toHaveBeenCalledWith('formula-extractor');
    expect(fixtures.settings.enabledPlugins).toEqual(['other.plugin']);
    expect(fixtures.settings.trustedPlugins).toEqual(['other.plugin']);
    expect(fixtures.updateSettings).toHaveBeenCalledWith({
      enabledPlugins: ['other.plugin'],
      trustedPlugins: ['other.plugin'],
    });
    expect((await loadStoredPlugin('formula-extractor'))?.manifest.version).toBe('1.2.0');
  });

  it('uses the same replacement transaction for directory packages', async () => {
    await usePluginStore.getState().installFromDirectory(directoryPackage('1.3.0'));

    expect(fixtures.deactivate).toHaveBeenCalledWith('formula-extractor');
    expect((await loadStoredPlugin('formula-extractor'))?.manifest.version).toBe('1.3.0');
    expect(fixtures.settings.enabledPlugins).toEqual(['other.plugin']);
    expect(fixtures.settings.trustedPlugins).toEqual(['other.plugin']);
  });

  it('does not stop or overwrite the old package when authorization persistence returns false', async () => {
    fixtures.updateSettings.mockReset().mockResolvedValueOnce(false);

    await expect(usePluginStore.getState().installFromZip(await zipPackage('2.0.0'))).rejects.toThrow();

    expect(fixtures.deactivate).not.toHaveBeenCalled();
    expect((await loadStoredPlugin('formula-extractor'))?.manifest.version).toBe('0.9.0');
    expect(fixtures.settings.enabledPlugins).toEqual(['formula-extractor', 'other.plugin']);
    expect(fixtures.settings.trustedPlugins).toEqual(['formula-extractor', 'other.plugin']);
  });

  it('keeps the old package and leaves the ID disabled when main-file commit fails', async () => {
    let failOnce = true;
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(this: Storage, key: string, value: string) {
      if (failOnce && key === 'lattice-plugin:formula-extractor:main') {
        failOnce = false;
        throw new Error('simulated main write failure');
      }
      return originalSetItem.call(this, key, value);
    });

    await expect(usePluginStore.getState().installFromZip(await zipPackage('2.1.0'))).rejects.toThrow('simulated main write failure');

    expect(fixtures.deactivate).toHaveBeenCalledWith('formula-extractor');
    expect(fixtures.settings.enabledPlugins).toEqual(['other.plugin']);
    expect(fixtures.settings.trustedPlugins).toEqual(['other.plugin']);
    expect((await loadStoredPlugin('formula-extractor'))?.manifest.version).toBe('0.9.0');
  });
});
