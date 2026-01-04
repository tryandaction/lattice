'use client';

import { Check, Sun, Moon, Monitor } from 'lucide-react';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import type { ThemeMode } from '@/types/settings';

interface ThemeSelectorProps {
  compact?: boolean;
}

const themeOptions: { value: ThemeMode; icon: typeof Sun; labelKey: 'settings.theme.light' | 'settings.theme.dark' | 'settings.theme.system' }[] = [
  { value: 'light', icon: Sun, labelKey: 'settings.theme.light' },
  { value: 'dark', icon: Moon, labelKey: 'settings.theme.dark' },
  { value: 'system', icon: Monitor, labelKey: 'settings.theme.system' },
];

export function ThemeSelector({ compact = false }: ThemeSelectorProps) {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();

  if (compact) {
    return (
      <div className="flex gap-2">
        {themeOptions.map(({ value, icon: Icon, labelKey }) => (
          <button
            key={value}
            onClick={() => setTheme(value)}
            className={`flex flex-col items-center gap-2 px-6 py-4 rounded-lg border transition-all ${
              theme === value
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:border-primary/50 hover:bg-muted'
            }`}
          >
            <Icon className="h-6 w-6" />
            <span className="text-sm font-medium">{t(labelKey)}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Sun className="h-4 w-4" />
        {t('settings.theme')}
      </div>
      <div className="space-y-1">
        {themeOptions.map(({ value, icon: Icon, labelKey }) => (
          <button
            key={value}
            onClick={() => setTheme(value)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
              theme === value
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-muted'
            }`}
          >
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4" />
              <span>{t(labelKey)}</span>
            </div>
            {theme === value && <Check className="h-4 w-4" />}
          </button>
        ))}
      </div>
    </div>
  );
}
