'use client';

import { Check, Globe } from 'lucide-react';
import { useI18n } from '@/hooks/use-i18n';
import { useSettingsStore } from '@/stores/settings-store';
import type { Locale } from '@/types/settings';

interface LanguageSelectorProps {
  compact?: boolean;
}

export function LanguageSelector({ compact = false }: LanguageSelectorProps) {
  const { locale, t, getLocaleDisplayName, availableLocales } = useI18n();
  const updateSetting = useSettingsStore((state) => state.setLanguage);
  const error = useSettingsStore((state) => state.error);

  const handleSelect = async (newLocale: Locale) => {
    await updateSetting(newLocale);
  };

  if (compact) {
    return (
      <div><div className="flex gap-2">
        {availableLocales.map((loc) => (
          <button
            key={loc}
            aria-pressed={locale === loc}
            onClick={() => handleSelect(loc)}
            className={`px-4 py-2 rounded-lg border transition-all ${
              locale === loc
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:border-primary/50 hover:bg-muted'
            }`}
          >
            <span className="font-medium">{getLocaleDisplayName(loc)}</span>
          </button>
        ))}
      </div>{error && <p role="alert" className="mt-2 text-xs text-destructive">{t('main.toast.saveFailed.title')}: {error}</p>}</div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Globe className="h-4 w-4" />
        {t('settings.language')}
      </div>
      <div className="space-y-1">
        {availableLocales.map((loc) => (
          <button
            key={loc}
            aria-pressed={locale === loc}
            onClick={() => handleSelect(loc)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
              locale === loc
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-muted'
            }`}
          >
            <span>{getLocaleDisplayName(loc)}</span>
            {locale === loc && <Check className="h-4 w-4" />}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{t('main.toast.saveFailed.title')}: {error}</p>}
    </div>
  );
}
