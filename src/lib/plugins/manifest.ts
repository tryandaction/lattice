import type { PluginManifest, PluginPermission } from './types';
import {
  getKnownPluginPermissions,
  isKnownPluginPermission,
  normalizePluginPermissions,
} from './permission-catalog';

const REQUIRED_FIELDS = ['id', 'name', 'version'] as const;
const ID_PATTERN = /^[a-z0-9._-]+$/;

const KNOWN_PERMISSIONS: PluginPermission[] = getKnownPluginPermissions();

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest?: PluginManifest;
}

function isSafeMainPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized.endsWith('.js')) return false;
  if (!normalized || normalized.includes('\0')) return false;
  return normalized.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
}

function collectDuplicateIds(items: Array<{ id?: string }>, label: string, errors: string[]) {
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.id) continue;
    if (seen.has(item.id)) {
      errors.push(`Duplicate ${label} id: ${item.id}`);
      continue;
    }
    seen.add(item.id);
  }
}

export function validatePluginManifest(raw: unknown): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Manifest must be an object'], warnings };
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
    const invalid = manifest.permissions.filter((p) => !isKnownPluginPermission(p));
    if (invalid.length > 0) {
      errors.push(`Unknown permissions: ${invalid.join(', ')}`);
    }
    const normalized = normalizePluginPermissions(manifest.permissions.filter((p) => KNOWN_PERMISSIONS.includes(p)));
    if (normalized.length !== manifest.permissions.filter((p) => KNOWN_PERMISSIONS.includes(p)).length) {
      const duplicatePermissions = manifest.permissions.filter((permission, index) => (
        manifest.permissions?.indexOf(permission) !== index && KNOWN_PERMISSIONS.includes(permission)
      ));
      warnings.push(`Duplicate permissions were removed: ${normalizePluginPermissions(duplicatePermissions).join(', ')}`);
    }
    manifest.permissions = normalized;
  }

  const mainPath = manifest.main || manifest.entry;
  if (mainPath && (!isSafeMainPath(mainPath))) {
    errors.push('Main entry must be a relative .js file path inside the plugin package');
  }

  const panels = [
    ...(manifest.ui?.panels ?? []),
    ...(manifest.contributes?.panels ?? []),
  ];
  if (panels.length > 0) {
    for (const panel of panels) {
      if (!panel.id || !panel.title) {
        errors.push('Panel requires id and title');
      }
      if (!panel.schema || !panel.schema.type) {
        errors.push(`Panel ${panel.id || 'unknown'} requires schema.type`);
      }
    }
  }
  collectDuplicateIds(manifest.contributes?.commands ?? [], 'command', errors);
  collectDuplicateIds(panels, 'panel', errors);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    manifest: errors.length === 0 ? manifest : undefined,
  };
}
