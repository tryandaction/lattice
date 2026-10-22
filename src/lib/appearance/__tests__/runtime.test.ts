import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_THEMES } from '../registry';
import { applyAppearance, createAppearancePreview, isAppearancePreviewActive, subscribeAppearance } from '../runtime';
import { useSettingsStore } from '@/stores/settings-store';
import { DEFAULT_SETTINGS } from '@/types/settings';

describe('appearance runtime preview ownership', () => {
  beforeEach(() => {
    useSettingsStore.setState({settings: structuredClone(DEFAULT_SETTINGS), isInitialized:false});
    document.documentElement.className = 'dark';
    document.documentElement.style.cssText = '--background: 0 0% 0%;';
    delete document.documentElement.dataset.appearanceTheme;
    delete document.documentElement.dataset.appearanceMode;
  });

  it('keeps system changes from overwriting preview and restores the latest mode', () => {
    let systemDark = false;
    const callbacks = new Set<() => void>();
    vi.spyOn(window,'matchMedia').mockImplementation(() => ({matches:systemDark,addEventListener:(_event:string, callback:()=>void)=>callbacks.add(callback), removeEventListener:(_event:string,callback:()=>void)=>callbacks.delete(callback)}) as unknown as MediaQueryList);
    useSettingsStore.setState({isInitialized:true});
    const stop = subscribeAppearance(() => {});
    const preview = createAppearancePreview();
    preview.preview(BUILTIN_THEMES[1],'light');
    systemDark=true; callbacks.forEach(callback=>callback());
    expect(document.documentElement.dataset.appearanceTheme).toBe('folio');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    preview.cancel();
    expect(document.documentElement.dataset.appearanceTheme).toBe('lattice');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    stop(); vi.restoreAllMocks();
  });

  it('restores all inline tokens and dark class on cancel', () => {
    const root = document.documentElement;
    const preview = createAppearancePreview(root);
    preview.preview(BUILTIN_THEMES[1], 'light');
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.dataset.appearanceTheme).toBe('folio');
    preview.cancel();
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.dataset.appearanceTheme).toBeUndefined();
    expect(root.style.getPropertyValue('--background')).toBe('0 0% 0%');
  });

  it('only the active preview owner can cancel or mutate the preview', () => {
    const first = createAppearancePreview();
    const second = createAppearancePreview();
    first.preview(BUILTIN_THEMES[1], 'light');
    expect(document.documentElement.dataset.appearanceTheme).toBe('folio');
    expect(isAppearancePreviewActive()).toBe(true);
    second.preview(BUILTIN_THEMES[2], 'dark');
    expect(document.documentElement.dataset.appearanceTheme).toBe('breeze');
    first.cancel();
    expect(isAppearancePreviewActive()).toBe(true);
    second.cancel();
    expect(isAppearancePreviewActive()).toBe(false);
  });

  it('applies destructive semantic tokens with the theme', () => {
    applyAppearance(BUILTIN_THEMES[0], 'light');
    expect(document.documentElement.style.getPropertyValue('--destructive')).not.toBe('');
    expect(document.documentElement.style.getPropertyValue('--destructive-foreground')).not.toBe('');
  });
});
