import type { ThemePackage } from './types';

const sharedRules = {
  uiFont: 'geist' as const,
  readingFont: 'system' as const,
  codeFont: 'mono' as const,
};

export const BUILTIN_THEMES: readonly ThemePackage[] = [
  {
    schemaVersion: 1, id: 'lattice', name: '格致', author: 'Lattice', license: 'Built-in', packageVersion: '1.0.0',
    colors: {
      light: { background: '#f8fafc', foreground: '#20242b', surface: '#ffffff', elevated: '#ffffff', muted: '#eef2f6', mutedForeground: '#52606d', border: '#cbd5e1', controlBorder: '#64748b', primary: '#243b53', primaryForeground: '#ffffff', focus: '#1d4ed8', selected: '#dbeafe', selectedForeground: '#172554', success: '#166534', warning: '#92400e', danger: '#b91c1c', info: '#1e40af' },
      dark: { background: '#10141c', foreground: '#f3f5f7', surface: '#151922', elevated: '#1d2430', muted: '#252d3a', mutedForeground: '#b1bdcb', border: '#3d4a5b', controlBorder: '#9aaabd', primary: '#d9e5f2', primaryForeground: '#18212b', focus: '#7dd3fc', selected: '#1e3a5f', selectedForeground: '#e0f2fe', success: '#86efac', warning: '#fcd34d', danger: '#fca5a5', info: '#93c5fd' },
    }, rules: { ...sharedRules, density: 'standard', radius: 'soft', shadow: 'subtle', motion: 'subtle' },
  },
  {
    schemaVersion: 1, id: 'folio', name: '书页', author: 'Lattice', license: 'Built-in', packageVersion: '1.0.0',
    colors: {
      light: { background: '#f7f1e7', foreground: '#3d3028', surface: '#fffaf0', elevated: '#fffdf8', muted: '#eee5d8', mutedForeground: '#6d5b4f', border: '#cdbdaa', controlBorder: '#806b59', primary: '#6f452c', primaryForeground: '#fffaf0', focus: '#8b5e34', selected: '#ead8bb', selectedForeground: '#3d281b', success: '#336b4a', warning: '#8a4b22', danger: '#a63d2d', info: '#3d5e7a' },
      dark: { background: '#171310', foreground: '#f6eee4', surface: '#211b17', elevated: '#2b231d', muted: '#3a2e25', mutedForeground: '#c8b8a7', border: '#665344', controlBorder: '#bfa58c', primary: '#e8c49a', primaryForeground: '#302117', focus: '#f0bb78', selected: '#5a3d28', selectedForeground: '#fff1dc', success: '#9fddb4', warning: '#f3c878', danger: '#ffb4a8', info: '#a9c9e9' },
    }, rules: { ...sharedRules, uiFont: 'system', readingFont: 'serif', density: 'comfortable', radius: 'sharp', shadow: 'subtle', motion: 'subtle' },
  },
  {
    schemaVersion: 1, id: 'breeze', name: '微风', author: 'Lattice', license: 'Built-in', packageVersion: '1.0.0',
    colors: {
      light: { background: '#edf7f1', foreground: '#183128', surface: '#f8fcf9', elevated: '#ffffff', muted: '#dcefe4', mutedForeground: '#48675a', border: '#b4d2c1', controlBorder: '#4b806a', primary: '#176b52', primaryForeground: '#ffffff', focus: '#047857', selected: '#c7e9d5', selectedForeground: '#0e3b2d', success: '#166534', warning: '#8a4b08', danger: '#b42318', info: '#155e75' },
      dark: { background: '#0d1c18', foreground: '#e3f5ec', surface: '#12231e', elevated: '#1a3029', muted: '#234136', mutedForeground: '#adcfbe', border: '#3a6352', controlBorder: '#8bc7a9', primary: '#7dd3a9', primaryForeground: '#10271e', focus: '#6ee7b7', selected: '#20533e', selectedForeground: '#dcfce7', success: '#86efac', warning: '#fcd34d', danger: '#fca5a5', info: '#7dd3fc' },
    }, rules: { ...sharedRules, uiFont: 'system', density: 'comfortable', radius: 'round', shadow: 'soft', motion: 'standard' },
  },
  {
    schemaVersion: 1, id: 'atelier', name: '工坊', author: 'Lattice', license: 'Built-in', packageVersion: '1.0.0',
    colors: {
      light: { background: '#eceff3', foreground: '#1f252d', surface: '#f7f8fa', elevated: '#ffffff', muted: '#dfe4ea', mutedForeground: '#4b5563', border: '#aab4c0', controlBorder: '#596675', primary: '#263342', primaryForeground: '#ffffff', focus: '#9f1239', selected: '#e5e7eb', selectedForeground: '#111827', success: '#166534', warning: '#92400e', danger: '#be123c', info: '#075985' },
      dark: { background: '#111418', foreground: '#eef2f4', surface: '#171a1f', elevated: '#20262d', muted: '#2a323a', mutedForeground: '#b4bec8', border: '#4c5864', controlBorder: '#a9b5c2', primary: '#d4dde6', primaryForeground: '#1d252d', focus: '#fda4af', selected: '#343e49', selectedForeground: '#f8fafc', success: '#86efac', warning: '#fcd34d', danger: '#fda4af', info: '#93c5fd' },
    }, rules: { ...sharedRules, uiFont: 'system', codeFont: 'system', density: 'compact', radius: 'sharp', shadow: 'none', motion: 'none' },
  },
  {
    schemaVersion: 1, id: 'nocturne', name: '夜航', author: 'Lattice', license: 'Built-in', packageVersion: '1.0.0',
    colors: {
      light: { background: '#edf2ff', foreground: '#18233b', surface: '#f8faff', elevated: '#ffffff', muted: '#e0e8ff', mutedForeground: '#4d5f82', border: '#b9c7e7', controlBorder: '#536a9b', primary: '#3451b2', primaryForeground: '#ffffff', focus: '#3451b2', selected: '#d7e1ff', selectedForeground: '#172554', success: '#166534', warning: '#92400e', danger: '#b91c1c', info: '#075985' },
      dark: { background: '#0a1020', foreground: '#e7efff', surface: '#0f172b', elevated: '#182341', muted: '#202e50', mutedForeground: '#afbddb', border: '#3c4f78', controlBorder: '#8ba7df', primary: '#a8bfff', primaryForeground: '#111b38', focus: '#8ab4ff', selected: '#263d72', selectedForeground: '#e0e7ff', success: '#86efac', warning: '#fcd34d', danger: '#fca5a5', info: '#93c5fd' },
    }, rules: { ...sharedRules, density: 'standard', radius: 'soft', shadow: 'subtle', motion: 'standard' },
  },
] as const;

export function getTheme(themeId: string, customThemes: readonly ThemePackage[] = []): ThemePackage {
  return customThemes.find((theme) => theme.id === themeId) ?? BUILTIN_THEMES.find((theme) => theme.id === themeId) ?? BUILTIN_THEMES[0];
}

export function isBuiltinTheme(themeId: string): boolean {
  return BUILTIN_THEMES.some((theme) => theme.id === themeId);
}
