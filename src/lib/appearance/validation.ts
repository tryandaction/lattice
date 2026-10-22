import {
  APPEARANCE_SCHEMA_VERSION, MAX_THEME_JSON_BYTES, THEME_COLOR_KEYS,
  type ThemeColorKey, type ThemePackage, type ThemeRules, type ThemeValidationResult,
} from './types';

const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^(?:[a-z][a-z0-9-]{1,47}|user-[a-z][a-z0-9-]{1,43})$/;
const RULE_KEYS = ['uiFont', 'readingFont', 'codeFont', 'density', 'radius', 'shadow', 'motion'] as const;
const ROOT_KEYS = ['schemaVersion', 'id', 'name', 'author', 'license', 'packageVersion', 'colors', 'rules'] as const;
const MODE_KEYS = ['light', 'dark'] as const;
const FONT_VALUES = ['geist', 'system', 'serif', 'mono'] as const;
const DENSITY_VALUES = ['comfortable', 'standard', 'compact'] as const;
const RADIUS_VALUES = ['sharp', 'soft', 'round'] as const;
const SHADOW_VALUES = ['none', 'subtle', 'soft'] as const;
const MOTION_VALUES = ['none', 'subtle', 'standard'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

function srgb(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const rgb = [1, 3, 5].map((offset) => srgb(Number.parseInt(hex.slice(offset, offset + 2), 16)));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

export function contrastRatio(first: string, second: string): number {
  if (!isHex(first) || !isHex(second)) return 0;
  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (light + 0.05) / (dark + 0.05);
}

function validateRules(value: unknown): value is ThemeRules {
  if (!isRecord(value) || !hasOnlyKeys(value, RULE_KEYS)) return false;
  return FONT_VALUES.includes(value.uiFont as never)
    && FONT_VALUES.includes(value.readingFont as never)
    && ['mono', 'system'].includes(value.codeFont as string)
    && DENSITY_VALUES.includes(value.density as never)
    && RADIUS_VALUES.includes(value.radius as never)
    && SHADOW_VALUES.includes(value.shadow as never)
    && MOTION_VALUES.includes(value.motion as never);
}

function validateColors(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, THEME_COLOR_KEYS)) return false;
  if (!THEME_COLOR_KEYS.every((key) => isHex(value[key]))) return false;
  const colors = value as Record<ThemeColorKey, string>;
  const surfaces = [colors.background, colors.surface, colors.elevated, colors.muted];
  const textPairs: Array<[string, string]> = [
    ...[colors.foreground, colors.mutedForeground, colors.success, colors.warning, colors.danger, colors.info, colors.primary]
      .flatMap((text) => surfaces.map((surface): [string, string] => [text, surface])),
    [colors.primaryForeground, colors.primary], [colors.selectedForeground, colors.selected],
    [colors.foreground, colors.selected],
  ];
  const controlPairs = [colors.focus, colors.controlBorder]
    .flatMap((control) => surfaces.map((surface): [string, string] => [control, surface]));
  return textPairs.every(([text, surface]) => contrastRatio(text, surface) >= 4.5)
    && controlPairs.every(([control, surface]) => contrastRatio(control, surface) >= 3);
}

export function validateThemePackage(input: unknown, options?: { customOnly?: boolean }): ThemeValidationResult {
  if (!isRecord(input) || !hasOnlyKeys(input, ROOT_KEYS)) return { ok: false, error: 'Unknown theme field' };
  if (input.schemaVersion !== APPEARANCE_SCHEMA_VERSION) return { ok: false, error: 'Unsupported theme schema' };
  if (typeof input.id !== 'string' || !ID.test(input.id) || (options?.customOnly && !input.id.startsWith('user-'))) {
    return { ok: false, error: 'Invalid theme id' };
  }
  if (typeof input.name !== 'string' || input.name.trim().length === 0 || input.name.length > 80) return { ok: false, error: 'Invalid theme name' };
  for (const key of ['author', 'license', 'packageVersion'] as const) {
    if (typeof input[key] !== 'string' || input[key].length > 120 || /[\u0000-\u001f]/.test(input[key] as string)) return { ok: false, error: `Invalid ${key}` };
  }
  const colors = input.colors;
  if (!isRecord(colors) || !hasOnlyKeys(colors, MODE_KEYS) || !MODE_KEYS.every((mode) => validateColors(colors[mode]))) {
    return { ok: false, error: 'Invalid theme colors or contrast' };
  }
  if (!validateRules(input.rules)) return { ok: false, error: 'Invalid theme rules' };
  return { ok: true, theme: structuredClone(input) as unknown as ThemePackage };
}

export function parseThemeJSON(text: string): ThemeValidationResult {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_THEME_JSON_BYTES) return { ok: false, error: 'Theme JSON exceeds 64 KiB' };
  try {
    const value: unknown = JSON.parse(text);
    return validateThemePackage(value, { customOnly: true });
  } catch {
    return { ok: false, error: 'Theme JSON is malformed' };
  }
}

export function cloneTheme(theme: ThemePackage, name?: string): ThemePackage {
  const normalized = name?.trim() || `${theme.name} 自定义`;
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replaceAll('-', '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return { ...structuredClone(theme), id: `user-${randomId}`, name: normalized, author: 'User', license: 'User', packageVersion: '1.0.0' };
}

export function isThemeColorKey(value: string): value is ThemeColorKey {
  return THEME_COLOR_KEYS.includes(value as ThemeColorKey);
}
