import { validatePluginManifest, type ManifestValidationResult } from './manifest';
import {
  getPluginPermissionRisk,
  groupPluginPermissions,
  normalizePluginPermissions,
  type PluginPermissionGroup,
  type PluginPermissionRisk,
} from './permission-catalog';
import type { PluginManifest } from './types';

export type PluginMarketplaceSource = 'built-in' | 'installed' | 'override';

export interface InstalledPluginCatalogInput {
  manifest: PluginManifest;
  installedAt: number;
  updatedAt: number;
}

export interface PluginMarketplaceCatalogInput {
  builtInPlugins: PluginManifest[];
  installedPlugins: InstalledPluginCatalogInput[];
  enabledPluginIds: string[];
  trustedPluginIds: string[];
}

export interface PluginMarketplaceEntry {
  id: string;
  manifest: PluginManifest;
  name: string;
  version: string;
  description?: string;
  author?: string;
  category?: string;
  source: PluginMarketplaceSource;
  official: boolean;
  recommended: boolean;
  installed: boolean;
  enabled: boolean;
  trusted: boolean;
  risk: PluginPermissionRisk;
  permissionGroups: PluginPermissionGroup[];
  validation: ManifestValidationResult;
  installedAt?: number;
  updatedAt?: number;
  hasBuiltInFallback: boolean;
  builtInVersion?: string;
}

function buildEntry(input: {
  manifest: PluginManifest;
  source: PluginMarketplaceSource;
  enabledSet: Set<string>;
  trustedSet: Set<string>;
  installedAt?: number;
  updatedAt?: number;
  builtInVersion?: string;
}): PluginMarketplaceEntry {
  const permissions = normalizePluginPermissions(input.manifest.permissions ?? []);
  const manifest = { ...input.manifest, permissions };
  const validation = validatePluginManifest(manifest);
  return {
    id: manifest.id,
    manifest,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    category: manifest.category,
    source: input.source,
    official: input.source === 'built-in',
    recommended: Boolean(manifest.recommended),
    installed: input.source === 'installed' || input.source === 'override',
    enabled: input.enabledSet.has(manifest.id),
    trusted: input.trustedSet.has(manifest.id),
    risk: getPluginPermissionRisk(permissions),
    permissionGroups: groupPluginPermissions(permissions),
    validation,
    installedAt: input.installedAt,
    updatedAt: input.updatedAt,
    hasBuiltInFallback: input.source === 'override',
    builtInVersion: input.builtInVersion,
  };
}

export function buildPluginMarketplaceCatalog(input: PluginMarketplaceCatalogInput): PluginMarketplaceEntry[] {
  const builtInById = new Map(input.builtInPlugins.map((manifest) => [manifest.id, manifest]));
  const installedById = new Map(input.installedPlugins.map((plugin) => [plugin.manifest.id, plugin]));
  const enabledSet = new Set(input.enabledPluginIds);
  const trustedSet = new Set(input.trustedPluginIds);
  const ids = Array.from(new Set([
    ...input.builtInPlugins.map((manifest) => manifest.id),
    ...input.installedPlugins.map((plugin) => plugin.manifest.id),
  ])).sort((left, right) => {
    const leftRecommended = Boolean((installedById.get(left)?.manifest ?? builtInById.get(left))?.recommended);
    const rightRecommended = Boolean((installedById.get(right)?.manifest ?? builtInById.get(right))?.recommended);
    if (leftRecommended !== rightRecommended) return leftRecommended ? -1 : 1;
    return left.localeCompare(right);
  });

  return ids.map((id) => {
    const installed = installedById.get(id);
    const builtIn = builtInById.get(id);
    if (installed) {
      return buildEntry({
        manifest: installed.manifest,
        source: builtIn ? 'override' : 'installed',
        enabledSet,
        trustedSet,
        installedAt: installed.installedAt,
        updatedAt: installed.updatedAt,
        builtInVersion: builtIn?.version,
      });
    }
    if (!builtIn) {
      throw new Error(`Plugin catalog entry missing manifest: ${id}`);
    }
    return buildEntry({
      manifest: builtIn,
      source: 'built-in',
      enabledSet,
      trustedSet,
    });
  });
}
