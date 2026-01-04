/**
 * Theme Hook
 * 
 * React hook for managing application theme with system preference detection.
 */

'use client';

import { useEffect, useCallback, useState } from 'react';
import { useSettingsStore } from '@/stores/settings-store';
import type { ThemeMode } from '@/types/settings';

export function useTheme() {
  const theme = useSettingsStore((state) => state.settings.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  // Apply theme to document
  const applyTheme = useCallback((mode: ThemeMode) => {
    if (typeof window === 'undefined') return;
    
    const root = document.documentElement;
    let isDark = false;
    
    if (mode === 'system') {
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } else {
      isDark = mode === 'dark';
    }
    
    root.classList.toggle('dark', isDark);
    setResolvedTheme(isDark ? 'dark' : 'light');
  }, []);

  // Apply theme on mount and when theme changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme, applyTheme]);

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => applyTheme('system');
    
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme, applyTheme]);

  // Toggle between light and dark (skip system)
  const toggleTheme = useCallback(() => {
    if (typeof window === 'undefined') return;
    
    const root = document.documentElement;
    const isDark = root.classList.contains('dark');
    setTheme(isDark ? 'light' : 'dark');
  }, [setTheme]);

  return {
    theme,
    setTheme,
    toggleTheme,
    resolvedTheme,
    isDark: resolvedTheme === 'dark',
  };
}
