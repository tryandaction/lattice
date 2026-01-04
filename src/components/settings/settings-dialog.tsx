'use client';

import { useState } from 'react';
import { X, Settings, Palette, Globe, FolderOpen, Info, Keyboard, RotateCcw } from 'lucide-react';
import { useI18n } from '@/hooks/use-i18n';
import { useSettingsStore } from '@/stores/settings-store';
import { LanguageSelector } from './language-selector';
import { ThemeSelector } from './theme-selector';
import { FolderSelector } from './folder-selector';
import { isTauri } from '@/lib/storage-adapter';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = 'general' | 'appearance' | 'files' | 'shortcuts' | 'about';

const tabs: { id: SettingsTab; icon: typeof Settings; labelKey: 'settings.general' | 'settings.appearance' | 'settings.files' | 'settings.shortcuts' | 'settings.about' }[] = [
  { id: 'general', icon: Settings, labelKey: 'settings.general' },
  { id: 'appearance', icon: Palette, labelKey: 'settings.appearance' },
  { id: 'files', icon: FolderOpen, labelKey: 'settings.files' },
  { id: 'shortcuts', icon: Keyboard, labelKey: 'settings.shortcuts' },
  { id: 'about', icon: Info, labelKey: 'settings.about' },
];

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const updateSetting = useSettingsStore((state) => state.updateSetting);

  if (!isOpen) return null;

  const handleRestartOnboarding = async () => {
    await updateSetting('onboardingCompleted', false);
    onClose();
    // Reload to trigger onboarding
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl mx-4 bg-background rounded-xl shadow-2xl border border-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">{t('settings.title')}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex h-[480px]">
          {/* Sidebar */}
          <div className="w-48 border-r border-border p-2 space-y-1">
            {tabs.map(({ id, icon: Icon, labelKey }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                  activeTab === id
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                {t(labelKey)}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 p-6 overflow-y-auto">
            {activeTab === 'general' && (
              <div className="space-y-6">
                <LanguageSelector />
                
                <div className="pt-4 border-t border-border">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
                    <RotateCcw className="h-4 w-4" />
                    {t('settings.restartOnboarding')}
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    {t('settings.restartOnboarding.description')}
                  </p>
                  <button
                    onClick={handleRestartOnboarding}
                    className="px-3 py-2 text-sm bg-muted hover:bg-muted/80 rounded-lg transition-colors"
                  >
                    {t('settings.restartOnboarding')}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'appearance' && (
              <div className="space-y-6">
                <ThemeSelector />
              </div>
            )}

            {activeTab === 'files' && (
              <div className="space-y-6">
                <FolderSelector showNotFoundWarning />
              </div>
            )}

            {activeTab === 'shortcuts' && (
              <div className="space-y-4">
                <div className="text-sm font-medium text-muted-foreground mb-4">
                  {t('settings.shortcuts')}
                </div>
                <div className="space-y-2">
                  <ShortcutItem
                    label={t('settings.shortcuts.toggleSidebar')}
                    shortcut={isTauri() ? 'Ctrl+B' : 'Ctrl+B'}
                  />
                  <ShortcutItem
                    label={t('settings.shortcuts.openSettings')}
                    shortcut="Ctrl+,"
                  />
                  <ShortcutItem
                    label={t('settings.shortcuts.toggleTheme')}
                    shortcut="Ctrl+Shift+T"
                  />
                </div>
              </div>
            )}

            {activeTab === 'about' && (
              <div className="space-y-4">
                <div className="text-center py-8">
                  <h3 className="text-2xl font-bold mb-2">{t('app.name')}</h3>
                  <p className="text-muted-foreground mb-4">{t('app.tagline')}</p>
                  <div className="text-sm text-muted-foreground">
                    {t('settings.version')}: 0.1.0
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ShortcutItem({ label, shortcut }: { label: string; shortcut: string }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded-lg">
      <span className="text-sm">{label}</span>
      <kbd className="px-2 py-1 text-xs bg-background border border-border rounded">
        {shortcut}
      </kbd>
    </div>
  );
}
