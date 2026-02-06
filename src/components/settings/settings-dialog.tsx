'use client';

import { useEffect, useState } from 'react';
import { X, Settings, Palette, FolderOpen, Info, Keyboard, RotateCcw, Plug, Bot } from 'lucide-react';
import { useI18n } from '@/hooks/use-i18n';
import { useSettingsStore } from '@/stores/settings-store';
import { LanguageSelector } from './language-selector';
import { ThemeSelector } from './theme-selector';
import { FolderSelector } from './folder-selector';
import { isTauri } from '@/lib/storage-adapter';
import { getAvailablePlugins } from '@/lib/plugins/registry';
import { getRegisteredCommands } from '@/lib/plugins/runtime';
import type { PluginCommand } from '@/lib/plugins/types';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = 'general' | 'appearance' | 'files' | 'extensions' | 'ai' | 'shortcuts' | 'about';

const tabs: { id: SettingsTab; icon: typeof Settings; labelKey: 'settings.general' | 'settings.appearance' | 'settings.files' | 'settings.extensions' | 'settings.ai' | 'settings.shortcuts' | 'settings.about' }[] = [
  { id: 'general', icon: Settings, labelKey: 'settings.general' },
  { id: 'appearance', icon: Palette, labelKey: 'settings.appearance' },
  { id: 'files', icon: FolderOpen, labelKey: 'settings.files' },
  { id: 'extensions', icon: Plug, labelKey: 'settings.extensions' },
  { id: 'ai', icon: Bot, labelKey: 'settings.ai' },
  { id: 'shortcuts', icon: Keyboard, labelKey: 'settings.shortcuts' },
  { id: 'about', icon: Info, labelKey: 'settings.about' },
];

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const settings = useSettingsStore((state) => state.settings);
  const availablePlugins = getAvailablePlugins();
  const [registeredCommands, setRegisteredCommands] = useState<PluginCommand[]>([]);

  if (!isOpen) return null;

  const handleRestartOnboarding = async () => {
    await updateSetting('onboardingCompleted', false);
    onClose();
    // Reload to trigger onboarding
    window.location.reload();
  };

  useEffect(() => {
    if (!isOpen || activeTab !== 'extensions') return;
    const timeout = setTimeout(() => {
      setRegisteredCommands(getRegisteredCommands());
    }, 50);
    return () => clearTimeout(timeout);
  }, [isOpen, activeTab, settings.pluginsEnabled, settings.enabledPlugins]);

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
                    label={t('settings.shortcuts.openCommandCenter')}
                    shortcut="Ctrl+K"
                  />
                  <ShortcutItem
                    label={t('settings.shortcuts.toggleTheme')}
                    shortcut="Ctrl+Shift+T"
                  />
                </div>
              </div>
            )}

            {activeTab === 'extensions' && (
              <div className="space-y-6">
                <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 p-3">
                  <div>
                    <div className="text-sm font-medium">{t('settings.plugins.enable')}</div>
                  </div>
                  <input
                    id="settings-plugins-enabled"
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    checked={settings.pluginsEnabled}
                    onChange={(event) => updateSetting('pluginsEnabled', event.target.checked)}
                  />
                </div>

                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-2">
                    {t('settings.plugins.available')}
                  </div>
                  {availablePlugins.length === 0 ? (
                    <div className="text-xs text-muted-foreground">{t('settings.plugins.none')}</div>
                  ) : (
                    <div className="space-y-2">
                      {availablePlugins.map((plugin) => {
                        const isEnabled = settings.enabledPlugins.includes(plugin.id);
                        const isTrusted = settings.trustedPlugins.includes(plugin.id);
                        const checkboxId = `settings-plugin-${plugin.id}`;
                        const trustId = `settings-plugin-trust-${plugin.id}`;
                        const permissions = plugin.permissions ?? [];
                        return (
                          <div
                            key={plugin.id}
                            className={`flex items-start justify-between gap-3 rounded-lg border border-border p-3 transition-colors ${
                              settings.pluginsEnabled
                                ? 'bg-background hover:bg-muted/40'
                                : 'bg-muted/30 text-muted-foreground'
                            }`}
                          >
                            <div className="flex items-start gap-3 flex-1">
                              <input
                                id={checkboxId}
                                type="checkbox"
                                className="mt-1 h-4 w-4 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                checked={isEnabled}
                                disabled={!settings.pluginsEnabled || !isTrusted}
                                onChange={(event) => {
                                  const nextEnabled = event.target.checked
                                    ? Array.from(new Set([...settings.enabledPlugins, plugin.id]))
                                    : settings.enabledPlugins.filter((id) => id !== plugin.id);
                                  updateSetting('enabledPlugins', nextEnabled);
                                }}
                              />
                              <label htmlFor={checkboxId} className="flex-1 cursor-pointer">
                                <div className="text-sm font-medium text-foreground">{plugin.name}</div>
                                {plugin.description && (
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {plugin.description}
                                  </div>
                                )}
                                <div className="text-xs text-muted-foreground mt-1">
                                  v{plugin.version}
                                  {plugin.author ? ` · ${plugin.author}` : ''}
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                  {t('settings.plugins.id')}: {plugin.id}
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                  {t('settings.plugins.permissions')}: {permissions.length > 0 ? permissions.join(', ') : t('settings.plugins.permissions.none')}
                                </div>
                                {!isTrusted && settings.pluginsEnabled && (
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {t('settings.plugins.trust.required')}
                                  </div>
                                )}
                              </label>
                            </div>
                            <label htmlFor={trustId} className="flex items-center gap-2 text-xs text-muted-foreground">
                              <input
                                id={trustId}
                                type="checkbox"
                                className="h-4 w-4 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                checked={isTrusted}
                                onChange={(event) => {
                                  const nextTrusted = event.target.checked
                                    ? Array.from(new Set([...settings.trustedPlugins, plugin.id]))
                                    : settings.trustedPlugins.filter((id) => id !== plugin.id);
                                  const nextEnabled = event.target.checked
                                    ? settings.enabledPlugins
                                    : settings.enabledPlugins.filter((id) => id !== plugin.id);
                                  updateSettings({
                                    trustedPlugins: nextTrusted,
                                    enabledPlugins: nextEnabled,
                                  });
                                }}
                              />
                              {t('settings.plugins.trust')}
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="text-sm font-medium text-muted-foreground">
                      {t('settings.plugins.commands')}
                    </div>
                    <button
                      type="button"
                      onClick={() => setRegisteredCommands(getRegisteredCommands())}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      disabled={!settings.pluginsEnabled}
                    >
                      {t('settings.plugins.commands.refresh')}
                    </button>
                  </div>
                  {!settings.pluginsEnabled ? (
                    <div className="text-xs text-muted-foreground">
                      {t('settings.plugins.commands.disabled')}
                    </div>
                  ) : registeredCommands.length === 0 ? (
                    <div className="text-xs text-muted-foreground">
                      {t('settings.plugins.commands.empty')}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {registeredCommands.map((command) => (
                        <div
                          key={command.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                        >
                          <div>
                            <div className="text-sm font-medium text-foreground">{command.title}</div>
                            <div className="text-xs text-muted-foreground">{command.id}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void command.run()}
                            className="px-2 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            {t('settings.plugins.commands.run')}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'ai' && (
              <div className="space-y-6">
                <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 p-3">
                  <div>
                    <div className="text-sm font-medium">{t('settings.ai.enable')}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('settings.ai.description')}
                    </p>
                  </div>
                  <input
                    id="settings-ai-enabled"
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    checked={settings.aiEnabled}
                    onChange={(event) => updateSetting('aiEnabled', event.target.checked)}
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
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <div className="text-sm font-medium text-muted-foreground mb-3">
                    {t('settings.about.status')}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <StatusItem
                      label={t('settings.about.platform')}
                      value={isTauri() ? t('settings.about.platform.desktop') : t('settings.about.platform.web')}
                    />
                    <StatusItem
                      label={t('settings.about.ai')}
                      value={settings.aiEnabled ? t('common.enabled') : t('common.disabled')}
                    />
                    <StatusItem
                      label={t('settings.about.plugins.enabled')}
                      value={settings.pluginsEnabled ? t('common.enabled') : t('common.disabled')}
                    />
                    <StatusItem
                      label={t('settings.about.plugins.trusted')}
                      value={String(settings.trustedPlugins.length)}
                    />
                    <StatusItem
                      label={t('settings.about.plugins.active')}
                      value={String(settings.enabledPlugins.length)}
                    />
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

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground/80">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
