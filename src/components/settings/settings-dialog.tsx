'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Settings, Palette, FolderOpen, Info, Keyboard, RotateCcw, Plug, Bot } from 'lucide-react';
import { useI18n } from '@/hooks/use-i18n';
import { useSettingsStore } from '@/stores/settings-store';
import { usePluginStore } from '@/stores/plugin-store';
import { LanguageSelector } from './language-selector';
import { ThemeSelector } from './theme-selector';
import { FolderSelector } from './folder-selector';
import { isTauri } from '@/lib/storage-adapter';
import { getAvailablePlugins } from '@/lib/plugins/registry';
import {
  getRegisteredCommands,
  subscribePluginRegistry,
  getPluginHealthSnapshot,
  subscribePluginHealth,
  getPluginAuditLog,
  subscribePluginAudit,
  clearPluginAuditLog,
} from '@/lib/plugins/runtime';
import { cn } from '@/lib/utils';
import type { TranslationKey } from '@/lib/i18n';
import type { PluginCommand, PluginManifest, PluginPermission, PluginSettingField } from '@/lib/plugins/types';
import type { PluginHealth, PluginAuditEvent } from '@/lib/plugins/runtime';

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

const PERMISSION_META: Record<PluginPermission, { titleKey: TranslationKey; descKey: TranslationKey }> = {
  'file:read': {
    titleKey: 'settings.plugins.permission.fileRead.title',
    descKey: 'settings.plugins.permission.fileRead.desc',
  },
  'file:write': {
    titleKey: 'settings.plugins.permission.fileWrite.title',
    descKey: 'settings.plugins.permission.fileWrite.desc',
  },
  'annotations:read': {
    titleKey: 'settings.plugins.permission.annotationsRead.title',
    descKey: 'settings.plugins.permission.annotationsRead.desc',
  },
  'annotations:write': {
    titleKey: 'settings.plugins.permission.annotationsWrite.title',
    descKey: 'settings.plugins.permission.annotationsWrite.desc',
  },
  network: {
    titleKey: 'settings.plugins.permission.network.title',
    descKey: 'settings.plugins.permission.network.desc',
  },
  'ui:commands': {
    titleKey: 'settings.plugins.permission.uiCommands.title',
    descKey: 'settings.plugins.permission.uiCommands.desc',
  },
  'ui:panels': {
    titleKey: 'settings.plugins.permission.uiPanels.title',
    descKey: 'settings.plugins.permission.uiPanels.desc',
  },
  'ui:sidebar': {
    titleKey: 'settings.plugins.permission.uiSidebar.title' as TranslationKey,
    descKey: 'settings.plugins.permission.uiSidebar.desc' as TranslationKey,
  },
  'ui:toolbar': {
    titleKey: 'settings.plugins.permission.uiToolbar.title' as TranslationKey,
    descKey: 'settings.plugins.permission.uiToolbar.desc' as TranslationKey,
  },
  'ui:statusbar': {
    titleKey: 'settings.plugins.permission.uiStatusbar.title' as TranslationKey,
    descKey: 'settings.plugins.permission.uiStatusbar.desc' as TranslationKey,
  },
  'editor:extensions': {
    titleKey: 'settings.plugins.permission.editorExtensions.title' as TranslationKey,
    descKey: 'settings.plugins.permission.editorExtensions.desc' as TranslationKey,
  },
  themes: {
    titleKey: 'settings.plugins.permission.themes.title' as TranslationKey,
    descKey: 'settings.plugins.permission.themes.desc' as TranslationKey,
  },
  storage: {
    titleKey: 'settings.plugins.permission.storage.title',
    descKey: 'settings.plugins.permission.storage.desc',
  },
};

const compareSemver = (left: string, right: string) => {
  const parse = (value: string) => {
    const cleaned = value.split('+')[0];
    const [core, prereleaseRaw] = cleaned.split('-');
    const coreParts = core.split('.').map((part) => {
      const parsed = Number(part);
      return Number.isFinite(parsed) ? parsed : 0;
    });
    const prerelease = prereleaseRaw ? prereleaseRaw.split('.') : [];
    return { coreParts, prerelease };
  };

  const compareIdentifiers = (a: string, b: string) => {
    const aNum = Number(a);
    const bNum = Number(b);
    const aIsNum = Number.isFinite(aNum) && String(aNum) === a;
    const bIsNum = Number.isFinite(bNum) && String(bNum) === b;
    if (aIsNum && bIsNum) return aNum - bNum;
    if (aIsNum && !bIsNum) return -1;
    if (!aIsNum && bIsNum) return 1;
    if (a === b) return 0;
    return a < b ? -1 : 1;
  };

  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.coreParts.length, b.coreParts.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a.coreParts[i] ?? 0) - (b.coreParts[i] ?? 0);
    if (diff !== 0) return diff;
  }

  const aPre = a.prerelease;
  const bPre = b.prerelease;
  if (aPre.length === 0 && bPre.length === 0) return 0;
  if (aPre.length === 0) return 1;
  if (bPre.length === 0) return -1;

  const preLength = Math.max(aPre.length, bPre.length);
  for (let i = 0; i < preLength; i += 1) {
    const aId = aPre[i];
    const bId = bPre[i];
    if (aId === undefined) return -1;
    if (bId === undefined) return 1;
    const diff = compareIdentifiers(aId, bId);
    if (diff !== 0) return diff;
  }
  return 0;
};

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const settings = useSettingsStore((state) => state.settings);
  const installedPlugins = usePluginStore((state) => state.plugins);
  const loadPlugins = usePluginStore((state) => state.loadPlugins);
  const installFromZip = usePluginStore((state) => state.installFromZip);
  const installFromDirectory = usePluginStore((state) => state.installFromDirectory);
  const removePlugin = usePluginStore((state) => state.removePlugin);
  const pluginError = usePluginStore((state) => state.error);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [registeredCommands, setRegisteredCommands] = useState<PluginCommand[]>([]);
  const [trustDialogPlugin, setTrustDialogPlugin] = useState<PluginManifest | null>(null);
  const [networkInput, setNetworkInput] = useState('');
  const [pluginQuery, setPluginQuery] = useState('');
  const [pluginHealthMap, setPluginHealthMap] = useState<Record<string, PluginHealth>>({});
  const [pluginAuditLog, setPluginAuditLog] = useState<PluginAuditEvent[]>([]);
  const supportsDirectoryInstall =
    typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  const builtInPlugins = useMemo(() => {
    try {
      return getAvailablePlugins();
    } catch (err) {
      console.error('Failed to get available plugins:', err);
      return [];
    }
  }, []);
  const builtInById = useMemo(() => {
    return new Map(builtInPlugins.map((plugin) => [plugin.id, plugin]));
  }, [builtInPlugins]);
  const installedPluginIds = useMemo(
    () => new Set(installedPlugins.map((plugin) => plugin.manifest.id)),
    [installedPlugins]
  );
  const installedMetaById = useMemo(() => {
    return new Map(
      installedPlugins.map((plugin) => [
        plugin.manifest.id,
        { installedAt: plugin.installedAt, updatedAt: plugin.updatedAt },
      ])
    );
  }, [installedPlugins]);
  const availablePlugins = useMemo(() => {
    const combined = new Map<string, (typeof installedPlugins)[number]['manifest']>();
    for (const plugin of builtInPlugins) {
      combined.set(plugin.id, plugin);
    }
    for (const plugin of installedPlugins) {
      combined.set(plugin.manifest.id, plugin.manifest);
    }
    return Array.from(combined.values());
  }, [builtInPlugins, installedPlugins]);

  const normalizedPluginQuery = pluginQuery.trim().toLowerCase();
  const filteredPlugins = useMemo(() => {
    if (!normalizedPluginQuery) return availablePlugins;
    return availablePlugins.filter((plugin) => {
      const haystack = [plugin.name, plugin.id, plugin.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedPluginQuery);
    });
  }, [availablePlugins, normalizedPluginQuery]);

  const pluginNameById = useMemo(
    () => new Map(availablePlugins.map((plugin) => [plugin.id, plugin.name])),
    [availablePlugins]
  );

  const networkAllowlist = useMemo(
    () => (Array.isArray(settings.pluginNetworkAllowlist) ? settings.pluginNetworkAllowlist : []),
    [settings.pluginNetworkAllowlist]
  );

  const updateCount = useMemo(() => {
    let count = 0;
    for (const plugin of availablePlugins) {
      const builtIn = builtInById.get(plugin.id);
      const isInstalled = installedPluginIds.has(plugin.id);
      if (!builtIn || !isInstalled) continue;
      if (compareSemver(builtIn.version, plugin.version) > 0) {
        count += 1;
      }
    }
    return count;
  }, [availablePlugins, builtInById, installedPluginIds]);

  const formatTimestamp = (value?: number) => {
    if (!value) return '';
    try {
      return new Date(value).toLocaleString();
    } catch {
      return String(value);
    }
  };

  const handleRestartOnboarding = async () => {
    await updateSetting('onboardingCompleted', false);
    onClose();
    // Reload to trigger onboarding
    window.location.reload();
  };

  const handleConfirmTrust = async () => {
    if (!trustDialogPlugin) return;
    const nextTrusted = Array.from(new Set([...settings.trustedPlugins, trustDialogPlugin.id]));
    await updateSettings({ trustedPlugins: nextTrusted });
    setTrustDialogPlugin(null);
  };

  const handleCancelTrust = () => {
    setTrustDialogPlugin(null);
  };

  const handleAddNetworkAllowlist = async () => {
    const normalized = normalizeAllowlistEntry(networkInput);
    if (!normalized) return;
    const next = Array.from(new Set([...networkAllowlist, normalized]));
    await updateSetting('pluginNetworkAllowlist', next);
    setNetworkInput('');
  };

  const handleRemoveNetworkAllowlist = async (entry: string) => {
    const next = networkAllowlist.filter((item) => item !== entry);
    await updateSetting('pluginNetworkAllowlist', next);
  };

  const handleInstallFromFolder = async () => {
    const picker = (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> })
      .showDirectoryPicker;
    if (!picker) return;
    try {
      const handle = await picker();
      await installFromDirectory(handle);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('Failed to install plugin from folder:', error);
    }
  };

  useEffect(() => {
    if (!isOpen || activeTab !== 'extensions') return;
    const updateCommands = () => {
      try {
        setRegisteredCommands(getRegisteredCommands());
      } catch (err) {
        console.error('Failed to get registered commands:', err);
      }
    };
    updateCommands();
    const unsubscribe = subscribePluginRegistry(updateCommands);
    return () => unsubscribe();
  }, [isOpen, activeTab]);

  useEffect(() => {
    if (!isOpen) return;
    const updateHealth = () => {
      try {
        setPluginHealthMap(getPluginHealthSnapshot());
      } catch (err) {
        console.error('Failed to get plugin health:', err);
      }
    };
    updateHealth();
    const unsubscribe = subscribePluginHealth(updateHealth);
    return () => unsubscribe();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const updateAudit = () => {
      try {
        setPluginAuditLog(getPluginAuditLog());
      } catch (err) {
        console.error('Failed to get plugin audit log:', err);
      }
    };
    updateAudit();
    const unsubscribe = subscribePluginAudit(updateAudit);
    return () => unsubscribe();
  }, [isOpen]);

  if (!isOpen) return null;

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
              <div className="space-y-6">
                {/* App shortcuts */}
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                    应用操作
                  </div>
                  <div className="space-y-1">
                    <ShortcutItem label={t('settings.shortcuts.toggleSidebar')} shortcut="Ctrl+B" />
                    <ShortcutItem label={t('settings.shortcuts.openSettings')} shortcut="Ctrl+," />
                    <ShortcutItem label={t('settings.shortcuts.openCommandCenter')} shortcut="Ctrl+K" />
                    <ShortcutItem label={t('settings.shortcuts.openPanels')} shortcut="Ctrl+Shift+P" />
                    <ShortcutItem label={t('settings.shortcuts.toggleTheme')} shortcut="Ctrl+Shift+T" />
                  </div>
                </div>

                {/* Text formatting */}
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                    文本格式
                  </div>
                  <div className="space-y-1">
                    <ShortcutItem label="粗体" shortcut="Ctrl+B" />
                    <ShortcutItem label="斜体" shortcut="Ctrl+I" />
                    <ShortcutItem label="行内代码" shortcut="Ctrl+`" />
                    <ShortcutItem label="删除线" shortcut="Ctrl+Shift+S" />
                    <ShortcutItem label="高亮" shortcut="Ctrl+Shift+H" />
                    <ShortcutItem label="插入链接" shortcut="Ctrl+K" />
                    <ShortcutItem label="插入代码块" shortcut="Ctrl+Shift+`" />
                    <ShortcutItem label="切换注释" shortcut="Ctrl+/" />
                  </div>
                </div>

                {/* Math shortcuts */}
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                    公式编辑
                  </div>
                  <div className="space-y-1">
                    <ShortcutItem label="行内公式 $…$（选中文字则包裹）" shortcut="Ctrl+Shift+M" />
                    <ShortcutItem label="块级公式 $$…$$" shortcut="Ctrl+Alt+M" />
                    <ShortcutItem label="分数 \frac{}" shortcut="Ctrl+Shift+F" />
                    <ShortcutItem label="根号 \sqrt{}" shortcut="Ctrl+Shift+R" />
                    <ShortcutItem label="积分 \int_{a}^{b}" shortcut="Ctrl+Shift+I" />
                    <ShortcutItem label="求和 \sum_{i=1}^{n}" shortcut="Ctrl+Shift+U" />
                    <ShortcutItem label="极限 \lim_{x \to }" shortcut="Ctrl+Shift+L" />
                    <ShortcutItem label="矩阵 pmatrix 2×2" shortcut="Ctrl+Shift+X" />
                    <ShortcutItem label="向量 \vec{}" shortcut="Ctrl+Shift+V" />
                    <ShortcutItem label="偏导 \frac{\partial }{\partial x}" shortcut="Ctrl+Shift+P" />
                    <ShortcutItem label="上标 ^{}" shortcut="Ctrl+↑" />
                    <ShortcutItem label="下标 _{}" shortcut="Ctrl+↓" />
                  </div>
                </div>

                {/* Quantum keyboard */}
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                    量子键盘（公式输入时）
                  </div>
                  <div className="space-y-1">
                    <ShortcutItem label="Tab — 切换行内 / 块级模式" shortcut="Tab" />
                    <ShortcutItem label="Shift+Tab — 切换 Markdown / LaTeX 插入格式" shortcut="Shift+Tab" />
                    <ShortcutItem label="Shift+符号键 — 插入变体符号" shortcut="Shift+符号" />
                    <ShortcutItem label="关闭量子键盘" shortcut="Esc" />
                  </div>
                </div>

                {/* Line operations */}
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                    行操作
                  </div>
                  <div className="space-y-1">
                    <ShortcutItem label="上移行" shortcut="Alt+↑" />
                    <ShortcutItem label="下移行" shortcut="Alt+↓" />
                    <ShortcutItem label="复制行" shortcut="Ctrl+D" />
                    <ShortcutItem label="在下方插入新行" shortcut="Ctrl+Enter" />
                    <ShortcutItem label="增加缩进" shortcut="Ctrl+]" />
                    <ShortcutItem label="减少缩进" shortcut="Ctrl+[" />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'extensions' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-muted-foreground">
                    {t('settings.plugins.available')}
                    {updateCount > 0 && (
                      <span className="ml-2 text-xs text-amber-600">
                        {t('settings.plugins.update.availableCount', { count: updateCount })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void loadPlugins()}
                      className="px-3 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      {t('settings.plugins.update.check')}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".zip"
                      className="hidden"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        try {
                          await installFromZip(file);
                        } catch (error) {
                          console.error('Failed to install plugin:', error);
                        }
                        event.currentTarget.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      {t('settings.plugins.install')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleInstallFromFolder()}
                      className="px-3 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!supportsDirectoryInstall}
                      title={
                        supportsDirectoryInstall
                          ? undefined
                          : t('settings.plugins.installFolder.unsupported')
                      }
                    >
                      {t('settings.plugins.installFolder')}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={pluginQuery}
                    onChange={(event) => setPluginQuery(event.target.value)}
                    placeholder={t('settings.plugins.search.placeholder')}
                    className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs"
                  />
                  {pluginQuery.trim().length > 0 && (
                    <button
                      type="button"
                      onClick={() => setPluginQuery('')}
                      className="px-3 py-2 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      {t('common.clear')}
                    </button>
                  )}
                </div>

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

                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="text-sm font-medium">{t('settings.plugins.networkAllowlist')}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('settings.plugins.networkAllowlist.description')}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="text"
                      value={networkInput}
                      onChange={(event) => setNetworkInput(event.target.value)}
                      placeholder={t('settings.plugins.networkAllowlist.placeholder')}
                      className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs"
                      disabled={!settings.pluginsEnabled}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void handleAddNetworkAllowlist();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void handleAddNetworkAllowlist()}
                      className="px-3 py-2 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      disabled={!settings.pluginsEnabled}
                    >
                      {t('settings.plugins.networkAllowlist.add')}
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {networkAllowlist.length === 0 ? (
                      <div className="text-xs text-muted-foreground">
                        {t('settings.plugins.networkAllowlist.empty')}
                      </div>
                    ) : (
                      networkAllowlist.map((entry) => (
                        <div
                          key={entry}
                          className="flex items-center gap-1 rounded-full border border-border bg-background px-2 py-1 text-xs"
                        >
                          <span>{entry}</span>
                          <button
                            type="button"
                            onClick={() => void handleRemoveNetworkAllowlist(entry)}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={t('settings.plugins.networkAllowlist.remove')}
                          >
                            ×
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  {availablePlugins.length === 0 ? (
                    <div className="text-xs text-muted-foreground">{t('settings.plugins.none')}</div>
                  ) : filteredPlugins.length === 0 ? (
                    <div className="text-xs text-muted-foreground">{t('settings.plugins.search.empty')}</div>
                  ) : (
                    <div className="space-y-2">
                      {filteredPlugins.map((plugin) => {
                        const isEnabled = settings.enabledPlugins.includes(plugin.id);
                        const isTrusted = settings.trustedPlugins.includes(plugin.id);
                        const builtIn = builtInById.get(plugin.id);
                        const isBuiltIn = Boolean(builtIn);
                        const isInstalled = installedPluginIds.has(plugin.id);
                        const meta = installedMetaById.get(plugin.id);
                        const updateAvailable =
                          isInstalled &&
                          isBuiltIn &&
                          builtIn?.version &&
                          compareSemver(builtIn.version, plugin.version) > 0;
                        const sourceLabelKey = isInstalled && isBuiltIn
                          ? 'settings.plugins.source.override'
                          : isInstalled
                            ? 'settings.plugins.source.installed'
                            : 'settings.plugins.source.builtIn';
                        const health = pluginHealthMap[plugin.id];
                        const isActive = settings.pluginsEnabled && isEnabled;
                        const status = !isActive ? 'inactive' : health?.status ?? 'active';
                        const statusLabelKey =
                          status === 'error'
                            ? 'settings.plugins.status.error'
                            : status === 'active'
                              ? 'settings.plugins.status.active'
                              : 'settings.plugins.status.inactive';
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
                                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                  <span>{plugin.name}</span>
                                  <span
                                    className={cn(
                                      "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
                                      status === 'error'
                                        ? "border-destructive/40 text-destructive"
                                        : status === 'active'
                                          ? "border-primary/30 text-primary"
                                          : "border-border text-muted-foreground"
                                    )}
                                  >
                                    {t(statusLabelKey as TranslationKey)}
                                  </span>
                                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                                    {t(sourceLabelKey as TranslationKey)}
                                  </span>
                                </div>
                                {plugin.description && (
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {plugin.description}
                                  </div>
                                )}
                                <div className="text-xs text-muted-foreground mt-1">
                                  v{plugin.version}
                                  {plugin.author ? ` · ${plugin.author}` : ''}
                                </div>
                                {isInstalled && meta && (
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {t('settings.plugins.installedAt')}: {formatTimestamp(meta.installedAt)}
                                    {meta.updatedAt
                                      ? ` · ${t('settings.plugins.updatedAt')}: ${formatTimestamp(meta.updatedAt)}`
                                      : ''}
                                  </div>
                                )}
                                {updateAvailable && (
                                  <div className="text-xs text-amber-600 mt-1">
                                    {t('settings.plugins.update.available')}
                                    {builtIn?.version
                                      ? ` · ${t('settings.plugins.update.builtInVersion')}: v${builtIn.version}`
                                      : ''}
                                  </div>
                                )}
                                <div className="text-xs text-muted-foreground mt-1">
                                  {t('settings.plugins.id')}: {plugin.id}
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                  {t('settings.plugins.permissions')}: {permissions.length > 0 ? permissions.join(', ') : t('settings.plugins.permissions.none')}
                                </div>
                                {plugin.settings && plugin.settings.length > 0 && isEnabled && settings.pluginsEnabled && (
                                  <PluginSettingsFields pluginId={plugin.id} fields={plugin.settings} />
                                )}
                                {status === 'error' && health?.lastError && (
                                  <div className="mt-2 text-xs text-destructive">
                                    {t('settings.plugins.status.errorDetail')}: {health.lastError}
                                  </div>
                                )}
                                {status === 'error' && health?.lastErrorAt && (
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {t('settings.plugins.status.errorAt')}: {formatTimestamp(health.lastErrorAt)}
                                  </div>
                                )}
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
                                  if (event.target.checked) {
                                    setTrustDialogPlugin(plugin);
                                    return;
                                  }
                                  const nextTrusted = settings.trustedPlugins.filter((id) => id !== plugin.id);
                                  const nextEnabled = settings.enabledPlugins.filter((id) => id !== plugin.id);
                                  updateSettings({ trustedPlugins: nextTrusted, enabledPlugins: nextEnabled });
                                }}
                              />
                              {t('settings.plugins.trust')}
                            </label>
                            {isInstalled && (
                              <button
                                type="button"
                                onClick={() => void removePlugin(plugin.id)}
                                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                              >
                                {t('settings.plugins.uninstall')}
                              </button>
                            )}
                            {updateAvailable && (
                              <button
                                type="button"
                                onClick={() => void removePlugin(plugin.id)}
                                className="text-xs text-amber-600 hover:text-amber-700 transition-colors"
                              >
                                {t('settings.plugins.update.useBuiltIn')}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {pluginError && (
                  <div className="text-xs text-destructive">
                    {pluginError}
                  </div>
                )}

                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-muted-foreground">
                      {t('settings.plugins.audit.title')}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        clearPluginAuditLog();
                        setPluginAuditLog([]);
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t('settings.plugins.audit.clear')}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('settings.plugins.audit.description')}
                  </p>
                  <div className="mt-3 max-h-56 overflow-y-auto space-y-2">
                    {pluginAuditLog.length === 0 ? (
                      <div className="text-xs text-muted-foreground">
                        {t('settings.plugins.audit.empty')}
                      </div>
                    ) : (
                      pluginAuditLog.map((event) => {
                        const label = pluginNameById.get(event.pluginId) ?? event.pluginId;
                        const timeLabel = new Date(event.timestamp).toLocaleTimeString();
                        return (
                          <div
                            key={event.id}
                            className="rounded-md border border-border bg-background px-3 py-2 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-foreground">{label}</span>
                                <span
                                  className={cn(
                                    "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
                                    event.level === 'error'
                                      ? "border-destructive/40 text-destructive"
                                      : event.level === 'warn'
                                        ? "border-amber-400/40 text-amber-600"
                                        : "border-border text-muted-foreground"
                                  )}
                                >
                                  {event.level}
                                </span>
                              </div>
                              <span className="text-[10px] text-muted-foreground">{timeLabel}</span>
                            </div>
                            <div className="mt-1 text-muted-foreground">
                              {event.message}
                            </div>
                            {event.data && (
                              <div className="mt-1 text-[10px] text-muted-foreground/80">
                                {JSON.stringify(event.data)}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
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
                {/* AI Enable Toggle */}
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

                {settings.aiEnabled && (
                  <>
                    {/* Provider Selection */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">AI Provider</label>
                      <select
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        value={settings.aiProvider ?? ''}
                        onChange={(e) => updateSetting('aiProvider', e.target.value || null)}
                      >
                        <option value="">Select a provider...</option>
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="google">Google Gemini</option>
                        <option value="ollama">Ollama (Local)</option>
                      </select>
                    </div>

                    {/* API Key Input */}
                    {settings.aiProvider && settings.aiProvider !== 'ollama' && (
                      <AiApiKeyInput provider={settings.aiProvider} />
                    )}

                    {/* Ollama URL */}
                    {settings.aiProvider === 'ollama' && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Ollama URL</label>
                        <input
                          type="text"
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                          value={settings.aiOllamaUrl}
                          onChange={(e) => updateSetting('aiOllamaUrl', e.target.value)}
                          placeholder="http://localhost:11434"
                        />
                        {!isTauri() && (
                          <div className="rounded-lg border border-amber-400/50 bg-amber-50/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                            <div className="font-semibold mb-1">⚠️ Web 版本需要配置 CORS</div>
                            <p className="mb-1">从网页版访问本地 Ollama 时，浏览器会阻止跨域请求。请使用以下命令启动 Ollama：</p>
                            <code className="block bg-black/10 dark:bg-white/10 rounded px-2 py-1 font-mono text-[11px] break-all">
                              OLLAMA_ORIGINS=* ollama serve
                            </code>
                            <p className="mt-1 text-muted-foreground">或指定具体来源：<code className="font-mono">OLLAMA_ORIGINS=https://lattice-apq.pages.dev ollama serve</code></p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Model Selection */}
                    {settings.aiProvider && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Model</label>
                        <AiModelSelector provider={settings.aiProvider} currentModel={settings.aiModel} onSelect={(m) => updateSetting('aiModel', m)} />
                      </div>
                    )}

                    {/* Temperature */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Temperature: {settings.aiTemperature.toFixed(1)}</label>
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.1"
                        className="w-full"
                        value={settings.aiTemperature}
                        onChange={(e) => updateSetting('aiTemperature', parseFloat(e.target.value))}
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Precise</span>
                        <span>Creative</span>
                      </div>
                    </div>

                    {/* Max Tokens */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Max Tokens</label>
                      <input
                        type="number"
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        value={settings.aiMaxTokens}
                        onChange={(e) => updateSetting('aiMaxTokens', parseInt(e.target.value) || 4096)}
                        min={256}
                        max={128000}
                        step={256}
                      />
                    </div>

                    {/* System Prompt */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">System Prompt</label>
                      <textarea
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[80px] resize-y"
                        value={settings.aiSystemPrompt ?? ''}
                        onChange={(e) => updateSetting('aiSystemPrompt', e.target.value)}
                        placeholder="You are a helpful research assistant..."
                        rows={3}
                      />
                      <p className="text-xs text-muted-foreground">Custom system prompt for AI interactions. Leave empty for default.</p>
                    </div>

                    {/* Streaming Toggle */}
                    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
                      <div>
                        <div className="text-sm font-medium">Streaming</div>
                        <p className="text-xs text-muted-foreground mt-1">Stream responses token by token</p>
                      </div>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border text-primary"
                        checked={settings.aiStreamingEnabled}
                        onChange={(e) => updateSetting('aiStreamingEnabled', e.target.checked)}
                      />
                    </div>
                  </>
                )}
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
      {trustDialogPlugin && (
        <PluginTrustDialog
          plugin={trustDialogPlugin}
          onConfirm={handleConfirmTrust}
          onCancel={handleCancelTrust}
          t={t}
        />
      )}
    </div>
  );
}

function ShortcutItem({ label, shortcut }: { label: string; shortcut: string }) {
  const parts = shortcut.split('+');
  return (
    <div className="flex items-center justify-between py-1.5 px-3 rounded-lg hover:bg-muted/50 transition-colors">
      <span className="text-sm text-foreground/80">{label}</span>
      <span className="flex items-center gap-0.5 shrink-0 ml-4">
        {parts.map((part, i) => (
          <span key={i} className="flex items-center gap-0.5">
            <kbd className="px-1.5 py-0.5 text-[11px] font-mono bg-muted border border-border/70 rounded shadow-sm">
              {part}
            </kbd>
            {i < parts.length - 1 && (
              <span className="text-muted-foreground/50 text-[10px] mx-0.5">+</span>
            )}
          </span>
        ))}
      </span>
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

function normalizeAllowlistEntry(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const url = new URL(trimmed);
      return url.hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  const withoutPath = trimmed.split('/')[0];
  if (!withoutPath) return null;
  if (withoutPath.startsWith('*.')) {
    return withoutPath;
  }
  return withoutPath.split(':')[0] || null;
}

function PluginTrustDialog({
  plugin,
  onConfirm,
  onCancel,
  t,
}: {
  plugin: PluginManifest;
  onConfirm: () => void;
  onCancel: () => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  const permissions = Array.from(new Set(plugin.permissions ?? []));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-background p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        <h3 className="text-lg font-semibold">{t('settings.plugins.trust.dialog.title')}</h3>
        <p className="mt-2 text-xs text-muted-foreground">
          {t('settings.plugins.trust.dialog.description')}
        </p>

        <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-xs">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-foreground">{plugin.name}</div>
            <div className="text-muted-foreground">v{plugin.version}</div>
          </div>
          <div className="mt-2 text-muted-foreground">
            {t('settings.plugins.id')}: {plugin.id}
          </div>
          {plugin.author && (
            <div className="mt-1 text-muted-foreground">
              {plugin.author}
            </div>
          )}
        </div>

        <div className="mt-4 space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            {t('settings.plugins.trust.dialog.permissions')}
          </div>
          {permissions.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              {t('settings.plugins.trust.dialog.none')}
            </div>
          ) : (
            <div className="space-y-2">
              {permissions.map((permission) => {
                const meta = PERMISSION_META[permission];
                const title = meta ? t(meta.titleKey) : permission;
                const description = meta ? t(meta.descKey) : permission;
                return (
                  <div
                    key={permission}
                    className="rounded-lg border border-border bg-background p-3"
                  >
                    <div className="text-sm font-medium text-foreground">{title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{description}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {permission}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {t('settings.plugins.trust.dialog.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

function PluginSettingsFields({ pluginId, fields }: { pluginId: string; fields: PluginSettingField[] }) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = localStorage.getItem(`lattice-plugin-kv:${pluginId}:setting:${field.id}`);
      initial[field.id] = raw !== null ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : field.default;
    }
    return initial;
  });

  const handleChange = (fieldId: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
    localStorage.setItem(`lattice-plugin-kv:${pluginId}:setting:${fieldId}`, JSON.stringify(value));
  };

  return (
    <div className="mt-2 space-y-2 border-t border-border pt-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Settings</div>
      {fields.map((field) => (
        <div key={field.id} className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs text-foreground">{field.label}</div>
            {field.description && <div className="text-[10px] text-muted-foreground">{field.description}</div>}
          </div>
          {field.type === 'boolean' && (
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-border"
              checked={Boolean(values[field.id])}
              onChange={(e) => handleChange(field.id, e.target.checked)}
            />
          )}
          {field.type === 'string' && (
            <input
              type="text"
              className="w-32 rounded border border-border bg-background px-2 py-1 text-xs"
              value={String(values[field.id] ?? '')}
              onChange={(e) => handleChange(field.id, e.target.value)}
            />
          )}
          {field.type === 'number' && (
            <input
              type="number"
              className="w-20 rounded border border-border bg-background px-2 py-1 text-xs"
              value={Number(values[field.id] ?? 0)}
              onChange={(e) => handleChange(field.id, Number(e.target.value))}
            />
          )}
          {field.type === 'select' && (
            <select
              className="w-32 rounded border border-border bg-background px-2 py-1 text-xs"
              value={String(values[field.id] ?? '')}
              onChange={(e) => handleChange(field.id, e.target.value)}
            >
              {field.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}
        </div>
      ))}
    </div>
  );
}

function AiApiKeyInput({ provider }: { provider: string }) {
  const [key, setKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null);

  // Load key from secure storage on mount
  useEffect(() => {
    import('@/lib/ai/key-storage').then(({ getApiKey }) => {
      setKey(getApiKey(provider as import('@/lib/ai/types').AiProviderId));
    }).catch(() => {});
  }, [provider]);

  const save = (value: string) => {
    setKey(value);
    setTestResult(null);
    import('@/lib/ai/key-storage').then(({ setApiKey, clearApiKey }) => {
      if (value) {
        setApiKey(provider as import('@/lib/ai/types').AiProviderId, value);
      } else {
        clearApiKey(provider as import('@/lib/ai/types').AiProviderId);
      }
    }).catch(() => {});
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { getProvider } = await import('@/lib/ai/providers');
      const p = getProvider(provider as import('@/lib/ai/types').AiProviderId);
      if (p) {
        const ok = await p.testConnection();
        setTestResult(ok ? 'success' : 'fail');
      } else {
        setTestResult('fail');
      }
    } catch {
      setTestResult('fail');
    }
    setTesting(false);
  };

  const providerNames: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google',
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{providerNames[provider] ?? provider} API Key</label>
      <div className="flex gap-2">
        <input
          type="password"
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
          value={key}
          onChange={(e) => save(e.target.value)}
          placeholder="sk-..."
        />
        <button
          onClick={test}
          disabled={!key || testing}
          className="rounded-md border border-border px-3 py-2 text-xs hover:bg-accent disabled:opacity-50 transition-colors"
        >
          {testing ? 'Testing...' : 'Test'}
        </button>
      </div>
      {testResult === 'success' && <p className="text-xs text-green-600">Connection successful</p>}
      {testResult === 'fail' && <p className="text-xs text-destructive">Connection failed — check your key</p>}
    </div>
  );
}

function AiModelSelector({ provider, currentModel, onSelect }: { provider: string; currentModel: string | null; onSelect: (model: string) => void }) {
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    import('@/lib/ai/providers').then(async ({ getProvider }) => {
      const p = getProvider(provider as import('@/lib/ai/types').AiProviderId);
      if (p && !cancelled) {
        try {
          const available = await p.getAvailableModels();
          if (!cancelled) setModels(available.map((m) => ({ id: m.id, name: m.name })));
        } catch {
          if (!cancelled) setModels([]);
        }
      }
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [provider]);

  if (loading) return <p className="text-xs text-muted-foreground">Loading models...</p>;

  return (
    <select
      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      value={currentModel ?? ''}
      onChange={(e) => onSelect(e.target.value)}
    >
      <option value="">Auto (default)</option>
      {models.map((m) => (
        <option key={m.id} value={m.id}>{m.name}</option>
      ))}
    </select>
  );
}
