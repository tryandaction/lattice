/**
 * Internationalization (i18n) System
 *
 * Provides translation support for multiple languages.
 */

import { zhCN, type TranslationKey } from './zh-CN';
import { enUS } from './en-US';
import type { Locale } from '@/types/settings';

const translations: Record<Locale, Record<TranslationKey, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

let currentLocale: Locale = 'zh-CN';

type LocaleChangeListener = (locale: Locale) => void;
const listeners: Set<LocaleChangeListener> = new Set();

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  if (currentLocale === locale) {
    return;
  }

  currentLocale = locale;
  listeners.forEach((listener) => listener(locale));
}

export function subscribeToLocaleChanges(listener: LocaleChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const dict = translations[currentLocale] || translations['zh-CN'];
  let text = dict[key] || key;

  if (params) {
    Object.entries(params).forEach(([param, value]) => {
      text = text.replace(`{${param}}`, String(value));
    });
  }

  return text;
}

export function detectSystemLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh-CN';

  const lang = navigator.language || (navigator as { userLanguage?: string }).userLanguage || 'zh-CN';
  return lang.startsWith('zh') ? 'zh-CN' : 'en-US';
}

export function getLocaleDisplayName(locale: Locale): string {
  const names: Record<Locale, string> = {
    'zh-CN': '简体中文',
    'en-US': 'English',
  };
  return names[locale];
}

export function getAvailableLocales(): Locale[] {
  return ['zh-CN', 'en-US'];
}

export function formatDate(
  date: Date | number | string,
  options?: Intl.DateTimeFormatOptions,
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

export function formatNumber(
  num: number,
  options?: Intl.NumberFormatOptions,
): string {
  try {
    return new Intl.NumberFormat(currentLocale, options).format(num);
  } catch {
    return num.toString();
  }
}

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
    }
    return rtf.format(-diffSec, 'second');
  } catch {
    if (diffDay > 0) {
      return currentLocale === 'zh-CN' ? `${diffDay}天前` : `${diffDay} days ago`;
    } else if (diffHour > 0) {
      return currentLocale === 'zh-CN' ? `${diffHour}小时前` : `${diffHour} hours ago`;
    } else if (diffMin > 0) {
      return currentLocale === 'zh-CN' ? `${diffMin}分钟前` : `${diffMin} minutes ago`;
    }
    return currentLocale === 'zh-CN' ? '刚刚' : 'just now';
  }
}

export type { TranslationKey };
