/**
 * Internationalization (i18n) System
 * 
 * Provides translation support for multiple languages.
 */

import { zhCN, type TranslationKey } from './zh-CN';
import { enUS } from './en-US';
import type { Locale } from '@/types/settings';

// Translation dictionaries
const translations: Record<Locale, Record<TranslationKey, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

// Current locale state
let currentLocale: Locale = 'zh-CN';

// Locale change listeners
type LocaleChangeListener = (locale: Locale) => void;
const listeners: Set<LocaleChangeListener> = new Set();

/**
 * Get the current locale
 */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Set the current locale
 */
export function setLocale(locale: Locale): void {
  if (currentLocale !== locale) {
    currentLocale = locale;
    // Notify all listeners
    listeners.forEach(listener => listener(locale));
  }
}

/**
 * Subscribe to locale changes
 */
export function subscribeToLocaleChanges(listener: LocaleChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Translate a key to the current locale
 * 
 * @param key - Translation key
 * @param params - Optional parameters for interpolation
 * @returns Translated string
 */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const dict = translations[currentLocale] || translations['zh-CN'];
  let text = dict[key] || key;
  
  // Handle parameter interpolation
  if (params) {
    Object.entries(params).forEach(([param, value]) => {
      text = text.replace(`{${param}}`, String(value));
    });
  }
  
  return text;
}

/**
 * Detect system language and return appropriate locale
 */
export function detectSystemLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh-CN';
  
  const lang = navigator.language || (navigator as { userLanguage?: string }).userLanguage || 'zh-CN';
  
  if (lang.startsWith('zh')) {
    return 'zh-CN';
  }
  return 'en-US';
}

/**
 * Get display name for a locale
 */
export function getLocaleDisplayName(locale: Locale): string {
  const names: Record<Locale, string> = {
    'zh-CN': '简体中文',
    'en-US': 'English',
  };
  return names[locale];
}

/**
 * Get all available locales
 */
export function getAvailableLocales(): Locale[] {
  return ['zh-CN', 'en-US'];
}

/**
 * Format a date according to the current locale
 * 
 * @param date - Date to format
 * @param options - Intl.DateTimeFormat options
 * @returns Formatted date string
 */
export function formatDate(
  date: Date | number | string,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = date instanceof Date ? date : new Date(date);
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...options,
  };
  
  try {
    return new Intl.DateTimeFormat(currentLocale, defaultOptions).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

/**
 * Format a number according to the current locale
 * 
 * @param num - Number to format
 * @param options - Intl.NumberFormat options
 * @returns Formatted number string
 */
export function formatNumber(
  num: number,
  options?: Intl.NumberFormatOptions
): string {
  try {
    return new Intl.NumberFormat(currentLocale, options).format(num);
  } catch {
    return num.toString();
  }
}

/**
 * Format a file size in human-readable format
 * 
 * @param bytes - Size in bytes
 * @returns Formatted size string (e.g., "1.5 MB")
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${formatNumber(size, { maximumFractionDigits: 1 })} ${units[unitIndex]}`;
}

/**
 * Format a relative time (e.g., "2 hours ago")
 * 
 * @param date - Date to format relative to now
 * @returns Formatted relative time string
 */
export function formatRelativeTime(date: Date | number | string): string {
  const d = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  
  try {
    const rtf = new Intl.RelativeTimeFormat(currentLocale, { numeric: 'auto' });
    
    if (diffDay > 0) {
      return rtf.format(-diffDay, 'day');
    } else if (diffHour > 0) {
      return rtf.format(-diffHour, 'hour');
    } else if (diffMin > 0) {
      return rtf.format(-diffMin, 'minute');
    } else {
      return rtf.format(-diffSec, 'second');
    }
  } catch {
    // Fallback for browsers without RelativeTimeFormat
    if (diffDay > 0) {
      return currentLocale === 'zh-CN' ? `${diffDay}天前` : `${diffDay} days ago`;
    } else if (diffHour > 0) {
      return currentLocale === 'zh-CN' ? `${diffHour}小时前` : `${diffHour} hours ago`;
    } else if (diffMin > 0) {
      return currentLocale === 'zh-CN' ? `${diffMin}分钟前` : `${diffMin} minutes ago`;
    } else {
      return currentLocale === 'zh-CN' ? '刚刚' : 'just now';
    }
  }
}

// Re-export types
export type { TranslationKey };
