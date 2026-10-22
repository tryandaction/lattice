'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { useSettingsStore } from '@/stores/settings-store';
import { subscribeAppearance, getResolvedAppearanceMode } from '@/lib/appearance/runtime';

export function useTheme() {
  const theme = useSettingsStore((state) => state.settings.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const resolvedTheme = useSyncExternalStore(subscribeAppearance, getResolvedAppearanceMode, () => 'light' as const);
  const toggleTheme = useCallback(() => { void setTheme(getResolvedAppearanceMode() === 'dark' ? 'light' : 'dark'); }, [setTheme]);
  return { theme, setTheme, toggleTheme, resolvedTheme, isDark: resolvedTheme === 'dark' };
}
