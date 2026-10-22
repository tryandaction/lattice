import { useSettingsStore } from '@/stores/settings-store';
import { applyThemePackage, themeToCSS } from './css';
import { getTheme, BUILTIN_THEMES } from './registry';
import type { ThemeMode, ThemePackage } from './types';

const listeners = new Set<() => void>();
let stopRuntime: (() => void) | null = null;
let resolved: ThemeMode = 'light';
let activeOwner: symbol | null = null;
const cssKeys = Object.keys(themeToCSS(BUILTIN_THEMES[0], 'light'));

export function resolveAppearanceMode(mode: 'light' | 'dark' | 'system'): ThemeMode {
  return mode === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode;
}
export function applyAppearance(theme: ThemePackage, mode: ThemeMode, root: HTMLElement = document.documentElement): void {
  applyThemePackage(theme, mode, root);
  root.classList.toggle('dark', mode === 'dark');
  root.style.colorScheme = mode;
}

/** Always resolves the latest durable settings, including changes during preview. */
function synchronize(): void {
  const state = useSettingsStore.getState();
  const next = resolveAppearanceMode(state.settings.theme);
  if (resolved !== next) { resolved = next; listeners.forEach((notify) => notify()); }
  if (!activeOwner && state.isInitialized) {
    const appearance = state.settings.appearance;
    applyAppearance(getTheme(appearance.activeThemeId, appearance.customThemes), next);
  }
}
function startRuntime(): void {
  if (stopRuntime || typeof window === 'undefined') return;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const unsubscribe = useSettingsStore.subscribe((state, previous) => {
    if (state.settings.theme !== previous.settings.theme || state.settings.appearance !== previous.settings.appearance || state.isInitialized !== previous.isInitialized) synchronize();
  });
  media.addEventListener('change', synchronize);
  stopRuntime = () => { unsubscribe(); media.removeEventListener('change', synchronize); stopRuntime = null; };
  synchronize();
}
export function subscribeAppearance(notify: () => void): () => void {
  listeners.add(notify); startRuntime();
  return () => { listeners.delete(notify); if (!listeners.size) stopRuntime?.(); };
}
export function getResolvedAppearanceMode(): ThemeMode { return resolved; }
export function isAppearancePreviewActive(): boolean { return activeOwner !== null; }

export function createAppearancePreview(root: HTMLElement = document.documentElement) {
  const owner = Symbol('appearance-preview');
  let previous: { values: Array<[string, string]>; dark: boolean; scheme: string; theme?: string; mode?: string; density?: string } | null = null;
  const cancel = () => {
    if (activeOwner !== owner || !previous) return;
    activeOwner = null;
    const state = useSettingsStore.getState();
    if (root === document.documentElement && state.isInitialized) {
      synchronize();
    } else {
      for (const [key, value] of previous.values) { if (value) root.style.setProperty(key, value); else root.style.removeProperty(key); }
      root.classList.toggle('dark', previous.dark); root.style.colorScheme = previous.scheme;
      for (const [key, value] of Object.entries({ appearanceTheme: previous.theme, appearanceMode: previous.mode, appearanceDensity: previous.density })) { if (value) root.dataset[key] = value; else delete root.dataset[key]; }
    }
    previous = null;
  };
  return {
    preview: (theme: ThemePackage, mode: ThemeMode) => {
      if (!previous) previous = { values: cssKeys.map((key) => [key, root.style.getPropertyValue(key)]), dark: root.classList.contains('dark'), scheme: root.style.colorScheme, theme: root.dataset.appearanceTheme, mode: root.dataset.appearanceMode, density: root.dataset.appearanceDensity };
      activeOwner = owner; applyAppearance(theme, mode, root);
    },
    cancel, dispose: cancel,
  };
}
