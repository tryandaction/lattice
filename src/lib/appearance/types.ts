export const APPEARANCE_SCHEMA_VERSION = 1 as const;
export const MAX_CUSTOM_THEMES = 20;
export const MAX_THEME_JSON_BYTES = 64 * 1024;

export const THEME_COLOR_KEYS = [
  'background', 'foreground', 'surface', 'elevated', 'muted', 'mutedForeground',
  'border', 'controlBorder', 'primary', 'primaryForeground', 'focus', 'selected',
  'selectedForeground', 'success', 'warning', 'danger', 'info',
] as const;

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];
export type ThemeColors = Record<ThemeColorKey, string>;
export type ThemeMode = 'light' | 'dark';
export type ThemeDensity = 'comfortable' | 'standard' | 'compact';
export type ThemeRadius = 'sharp' | 'soft' | 'round';
export type ThemeShadow = 'none' | 'subtle' | 'soft';
export type ThemeMotion = 'none' | 'subtle' | 'standard';
export type ThemeFont = 'geist' | 'system' | 'serif' | 'mono';

export interface ThemeRules {
  uiFont: ThemeFont;
  readingFont: ThemeFont;
  codeFont: ThemeFont;
  density: ThemeDensity;
  radius: ThemeRadius;
  shadow: ThemeShadow;
  motion: ThemeMotion;
}

export interface ThemePackage {
  schemaVersion: typeof APPEARANCE_SCHEMA_VERSION;
  id: string;
  name: string;
  author: string;
  license: string;
  packageVersion: string;
  colors: Record<ThemeMode, ThemeColors>;
  rules: ThemeRules;
}

export interface AppearanceSettings {
  schemaVersion: typeof APPEARANCE_SCHEMA_VERSION;
  activeThemeId: string;
  customThemes: ThemePackage[];
}

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  schemaVersion: APPEARANCE_SCHEMA_VERSION,
  activeThemeId: 'lattice',
  customThemes: [],
};

export type ThemeValidationResult =
  | { ok: true; theme: ThemePackage }
  | { ok: false; error: string };

