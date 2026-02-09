/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadStoredPluginResource, storePluginPackage } from '@/lib/plugins/repository';

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
});
