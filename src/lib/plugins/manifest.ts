import type { PluginManifest, PluginPermission } from './types';

const REQUIRED_FIELDS = ['id', 'name', 'version'] as const;
const ID_PATTERN = /^[a-z0-9._-]+$/;

const KNOWN_PERMISSIONS: PluginPermission[] = [
  'file:read',
  'file:write',
  'annotations:read',
  'annotations:write',
  'network',
  'ui:commands',
  'ui:panels',
  'ui:sidebar',
  'ui:toolbar',
  'ui:statusbar',
  'editor:extensions',
  'themes',
  'storage',
];

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  manifest?: PluginManifest;
}

export function validatePluginManifest(raw: unknown): ManifestValidationResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Manifest must be an object'] };
  }

  const manifest = raw as PluginManifest;
  for (const field of REQUIRED_FIELDS) {
    if (!manifest[field] || typeof manifest[field] !== 'string') {
      errors.push(`Missing or invalid ${field}`);
    }
  }

  if (manifest.id && !ID_PATTERN.test(manifest.id)) {
    errors.push('Plugin id must match /^[a-z0-9._-]+$/');
  }

  if (manifest.permissions) {
    const invalid = manifest.permissions.filter((p) => !KNOWN_PERMISSIONS.includes(p));
    if (invalid.length > 0) {
      errors.push(`Unknown permissions: ${invalid.join(', ')}`);
    }
  }

  if (manifest.ui?.panels) {
    for (const panel of manifest.ui.panels) {
      if (!panel.id || !panel.title) {
        errors.push('Panel requires id and title');
      }
      if (!panel.schema || !panel.schema.type) {
        errors.push(`Panel ${panel.id || 'unknown'} requires schema.type`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    manifest: errors.length === 0 ? manifest : undefined,
  };
}

