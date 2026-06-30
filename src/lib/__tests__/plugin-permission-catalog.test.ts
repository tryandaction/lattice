import { describe, expect, it } from 'vitest';
import {
  getKnownPluginPermissions,
  getPluginPermissionMeta,
  getPluginPermissionRisk,
  groupPluginPermissions,
  normalizePluginPermissions,
} from '@/lib/plugins/permission-catalog';

describe('plugin permission catalog', () => {
  it('lists known permissions from a shared catalog', () => {
    expect(getKnownPluginPermissions()).toEqual(
      expect.arrayContaining([
        'file:read',
        'file:write',
        'annotations:read',
        'annotations:write',
        'network',
        'ui:commands',
        'ui:panels',
        'storage',
      ]),
    );
  });

  it('deduplicates permissions while preserving order', () => {
    expect(normalizePluginPermissions(['file:read', 'network', 'file:read'])).toEqual(['file:read', 'network']);
  });

  it('classifies permission risk for marketplace cards', () => {
    expect(getPluginPermissionRisk(['ui:commands', 'ui:panels'])).toBe('low');
    expect(getPluginPermissionRisk(['file:read', 'annotations:read'])).toBe('medium');
    expect(getPluginPermissionRisk(['file:write'])).toBe('high');
    expect(getPluginPermissionRisk(['network'])).toBe('high');
  });

  it('exposes labels and category grouping for settings UI', () => {
    expect(getPluginPermissionMeta('file:write')).toMatchObject({
      category: 'workspace',
      risk: 'high',
      titleKey: 'settings.plugins.permission.fileWrite.title',
    });
    expect(groupPluginPermissions(['file:read', 'ui:commands']).map((group) => group.category)).toEqual([
      'workspace',
      'interface',
    ]);
  });
});
