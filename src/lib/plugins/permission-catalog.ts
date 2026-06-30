import type { TranslationKey } from '@/lib/i18n';
import type { PluginPermission } from './types';

export type PluginPermissionRisk = 'none' | 'low' | 'medium' | 'high';
export type PluginPermissionCategory =
  | 'workspace'
  | 'annotations'
  | 'interface'
  | 'automation'
  | 'network'
  | 'storage'
  | 'appearance';

export interface PluginPermissionMeta {
  permission: PluginPermission;
  category: PluginPermissionCategory;
  risk: Exclude<PluginPermissionRisk, 'none'>;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  legacyAlias?: boolean;
}

export interface PluginPermissionGroup {
  category: PluginPermissionCategory;
  risk: PluginPermissionRisk;
  permissions: PluginPermissionMeta[];
}

const PERMISSION_CATALOG: Record<PluginPermission, PluginPermissionMeta> = {
  'read-current-document': {
    permission: 'read-current-document',
    category: 'workspace',
    risk: 'medium',
    titleKey: 'settings.plugins.permission.currentDocument.title' as TranslationKey,
    descKey: 'settings.plugins.permission.currentDocument.desc' as TranslationKey,
    legacyAlias: true,
  },
  'read-workspace-file': {
    permission: 'read-workspace-file',
    category: 'workspace',
    risk: 'medium',
    titleKey: 'settings.plugins.permission.fileRead.title',
    descKey: 'settings.plugins.permission.fileRead.desc',
    legacyAlias: true,
  },
  'clipboard-write': {
    permission: 'clipboard-write',
    category: 'automation',
    risk: 'low',
    titleKey: 'settings.plugins.permission.clipboardWrite.title' as TranslationKey,
    descKey: 'settings.plugins.permission.clipboardWrite.desc' as TranslationKey,
  },
  'export-file': {
    permission: 'export-file',
    category: 'workspace',
    risk: 'medium',
    titleKey: 'settings.plugins.permission.exportFile.title' as TranslationKey,
    descKey: 'settings.plugins.permission.exportFile.desc' as TranslationKey,
  },
  'use-ocr': {
    permission: 'use-ocr',
    category: 'automation',
    risk: 'medium',
    titleKey: 'settings.plugins.permission.ocr.title' as TranslationKey,
    descKey: 'settings.plugins.permission.ocr.desc' as TranslationKey,
  },
  'use-ai': {
    permission: 'use-ai',
    category: 'automation',
    risk: 'high',
    titleKey: 'settings.plugins.permission.ai.title' as TranslationKey,
    descKey: 'settings.plugins.permission.ai.desc' as TranslationKey,
  },
  'file:read': {
    permission: 'file:read',
    category: 'workspace',
    risk: 'medium',
    titleKey: 'settings.plugins.permission.fileRead.title',
    descKey: 'settings.plugins.permission.fileRead.desc',
  },
  'file:write': {
    permission: 'file:write',
    category: 'workspace',
    risk: 'high',
    titleKey: 'settings.plugins.permission.fileWrite.title',
    descKey: 'settings.plugins.permission.fileWrite.desc',
  },
  'annotations:read': {
    permission: 'annotations:read',
    category: 'annotations',
    risk: 'medium',
    titleKey: 'settings.plugins.permission.annotationsRead.title',
    descKey: 'settings.plugins.permission.annotationsRead.desc',
  },
  'annotations:write': {
    permission: 'annotations:write',
    category: 'annotations',
    risk: 'high',
    titleKey: 'settings.plugins.permission.annotationsWrite.title',
    descKey: 'settings.plugins.permission.annotationsWrite.desc',
  },
  network: {
    permission: 'network',
    category: 'network',
    risk: 'high',
    titleKey: 'settings.plugins.permission.network.title',
    descKey: 'settings.plugins.permission.network.desc',
  },
  'ui:commands': {
    permission: 'ui:commands',
    category: 'interface',
    risk: 'low',
    titleKey: 'settings.plugins.permission.uiCommands.title',
    descKey: 'settings.plugins.permission.uiCommands.desc',
  },
  'ui:panels': {
    permission: 'ui:panels',
    category: 'interface',
    risk: 'low',
    titleKey: 'settings.plugins.permission.uiPanels.title',
    descKey: 'settings.plugins.permission.uiPanels.desc',
  },
  'ui:sidebar': {
    permission: 'ui:sidebar',
    category: 'interface',
    risk: 'low',
    titleKey: 'settings.plugins.permission.uiSidebar.title' as TranslationKey,
    descKey: 'settings.plugins.permission.uiSidebar.desc' as TranslationKey,
  },
  'ui:toolbar': {
    permission: 'ui:toolbar',
    category: 'interface',
    risk: 'low',
    titleKey: 'settings.plugins.permission.uiToolbar.title' as TranslationKey,
    descKey: 'settings.plugins.permission.uiToolbar.desc' as TranslationKey,
  },
  'ui:statusbar': {
    permission: 'ui:statusbar',
    category: 'interface',
    risk: 'low',
    titleKey: 'settings.plugins.permission.uiStatusbar.title' as TranslationKey,
    descKey: 'settings.plugins.permission.uiStatusbar.desc' as TranslationKey,
  },
  'editor:extensions': {
    permission: 'editor:extensions',
    category: 'interface',
    risk: 'medium',
    titleKey: 'settings.plugins.permission.editorExtensions.title' as TranslationKey,
    descKey: 'settings.plugins.permission.editorExtensions.desc' as TranslationKey,
  },
  themes: {
    permission: 'themes',
    category: 'appearance',
    risk: 'low',
    titleKey: 'settings.plugins.permission.themes.title' as TranslationKey,
    descKey: 'settings.plugins.permission.themes.desc' as TranslationKey,
  },
  storage: {
    permission: 'storage',
    category: 'storage',
    risk: 'low',
    titleKey: 'settings.plugins.permission.storage.title',
    descKey: 'settings.plugins.permission.storage.desc',
  },
};

const RISK_WEIGHT: Record<PluginPermissionRisk, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export function getKnownPluginPermissions(): PluginPermission[] {
  return Object.keys(PERMISSION_CATALOG) as PluginPermission[];
}

export function isKnownPluginPermission(permission: string): permission is PluginPermission {
  return Object.prototype.hasOwnProperty.call(PERMISSION_CATALOG, permission);
}

export function getPluginPermissionMeta(permission: PluginPermission): PluginPermissionMeta {
  return PERMISSION_CATALOG[permission];
}

export function normalizePluginPermissions(permissions: readonly PluginPermission[] = []): PluginPermission[] {
  const seen = new Set<PluginPermission>();
  const normalized: PluginPermission[] = [];
  for (const permission of permissions) {
    if (seen.has(permission)) continue;
    seen.add(permission);
    normalized.push(permission);
  }
  return normalized;
}

export function getPluginPermissionRisk(permissions: readonly PluginPermission[] = []): PluginPermissionRisk {
  let risk: PluginPermissionRisk = 'none';
  for (const permission of permissions) {
    const meta = PERMISSION_CATALOG[permission];
    if (!meta) continue;
    if (RISK_WEIGHT[meta.risk] > RISK_WEIGHT[risk]) {
      risk = meta.risk;
    }
  }
  return risk;
}

export function combinePluginPermissionRisk(
  left: PluginPermissionRisk,
  right: PluginPermissionRisk,
): PluginPermissionRisk {
  return RISK_WEIGHT[right] > RISK_WEIGHT[left] ? right : left;
}

export function groupPluginPermissions(permissions: readonly PluginPermission[] = []): PluginPermissionGroup[] {
  const groups = new Map<PluginPermissionCategory, PluginPermissionMeta[]>();
  for (const permission of normalizePluginPermissions(permissions)) {
    const meta = PERMISSION_CATALOG[permission];
    if (!meta) continue;
    const bucket = groups.get(meta.category) ?? [];
    bucket.push(meta);
    groups.set(meta.category, bucket);
  }

  return Array.from(groups.entries()).map(([category, metas]) => ({
    category,
    permissions: metas,
    risk: getPluginPermissionRisk(metas.map((meta) => meta.permission)),
  }));
}
