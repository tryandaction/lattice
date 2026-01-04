/**
 * i18n Hook
 * 
 * React hook for using translations with automatic re-rendering on locale change.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  t, 
  getLocale, 
  setLocale, 
  subscribeToLocaleChanges,
  getLocaleDisplayName,
  getAvailableLocales,
  formatDate,
  formatNumber,
  formatFileSize,
  formatRelativeTime,
  type TranslationKey,
} from '@/lib/i18n';
import type { Locale } from '@/types/settings';

export function useI18n() {
  const [locale, setLocaleState] = useState<Locale>(getLocale);

  useEffect(() => {
    // Subscribe to locale changes
    const unsubscribe = subscribeToLocaleChanges((newLocale) => {
      setLocaleState(newLocale);
    });
    return unsubscribe;
  }, []);

  const changeLocale = useCallback((newLocale: Locale) => {
    setLocale(newLocale);
  }, []);

  const translate = useCallback((key: TranslationKey, params?: Record<string, string | number>) => {
    return t(key, params);
  }, [locale]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wrap format functions to trigger re-render on locale change
  const formatDateLocalized = useCallback((date: Date | number | string, options?: Intl.DateTimeFormatOptions) => {
    return formatDate(date, options);
  }, [locale]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatNumberLocalized = useCallback((num: number, options?: Intl.NumberFormatOptions) => {
    return formatNumber(num, options);
  }, [locale]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatFileSizeLocalized = useCallback((bytes: number) => {
    return formatFileSize(bytes);
  }, [locale]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatRelativeTimeLocalized = useCallback((date: Date | number | string) => {
    return formatRelativeTime(date);
  }, [locale]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    locale,
    setLocale: changeLocale,
    t: translate,
    getLocaleDisplayName,
    availableLocales: getAvailableLocales(),
    // Formatting functions
    formatDate: formatDateLocalized,
    formatNumber: formatNumberLocalized,
    formatFileSize: formatFileSizeLocalized,
    formatRelativeTime: formatRelativeTimeLocalized,
  };
}
