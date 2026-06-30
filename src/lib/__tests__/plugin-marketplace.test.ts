import { describe, expect, it } from 'vitest';
import { buildPluginMarketplaceCatalog } from '@/lib/plugins/marketplace';
import type { PluginManifest } from '@/lib/plugins/types';

const builtIn: PluginManifest = {
  id: 'formula-extractor',
  name: 'Formula Extractor',
  version: '1.0.0',
  recommended: true,
  defaultEnabled: true,
  permissions: ['ui:commands', 'ui:panels', 'file:read', 'use-ocr'],
};

const installed: PluginManifest = {
  id: 'demo.writer',
  name: 'Demo Writer',
  version: '0.1.0',
  permissions: ['file:write', 'network'],
};

describe('buildPluginMarketplaceCatalog', () => {
  it('builds source, trust, enable, and risk state for plugin cards', () => {
    const catalog = buildPluginMarketplaceCatalog({
      builtInPlugins: [builtIn],
      installedPlugins: [{ manifest: installed, installedAt: 10, updatedAt: 20 }],
      enabledPluginIds: ['formula-extractor'],
      trustedPluginIds: ['formula-extractor'],
    });

    expect(catalog.map((entry) => entry.id)).toEqual(['formula-extractor', 'demo.writer']);
    expect(catalog[0]).toMatchObject({
      id: 'formula-extractor',
      source: 'built-in',
      official: true,
      recommended: true,
      enabled: true,
      trusted: true,
      risk: 'medium',
    });
    expect(catalog[1]).toMatchObject({
      id: 'demo.writer',
      source: 'installed',
      official: false,
      installed: true,
      enabled: false,
      trusted: false,
      risk: 'high',
      installedAt: 10,
      updatedAt: 20,
    });
  });

  it('marks installed plugins that override a built-in plugin', () => {
    const catalog = buildPluginMarketplaceCatalog({
      builtInPlugins: [builtIn],
      installedPlugins: [{
        manifest: { ...builtIn, version: '2.0.0', permissions: ['file:write'] },
        installedAt: 1,
        updatedAt: 2,
      }],
      enabledPluginIds: [],
      trustedPluginIds: [],
    });

    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      id: 'formula-extractor',
      source: 'override',
      official: false,
      hasBuiltInFallback: true,
      builtInVersion: '1.0.0',
      version: '2.0.0',
      risk: 'high',
    });
  });
});
