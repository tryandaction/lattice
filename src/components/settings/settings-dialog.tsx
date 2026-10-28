'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Settings, Palette, FolderOpen, Info, Keyboard, RotateCcw, Cable, Bot, Import, RefreshCw } from 'lucide-react';
import { useI18n } from '@/hooks/use-i18n';
import type { TranslationKey } from '@/lib/i18n';
import { useSettingsStore } from '@/stores/settings-store';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { usePluginStore } from '@/stores/plugin-store';
import { LanguageSelector } from './language-selector';
import { ThemeSelector } from './theme-selector';
import { PluginsPanel } from './plugins-panel';
import { FolderSelector } from './folder-selector';
import { isTauri, isTauriHost } from '@/lib/storage-adapter';
import { getAvailablePlugins } from '@/lib/plugins/registry';
import { readVSCodeConfigFromDetectedProfiles } from '@/lib/vscode-compat/auto-discovery';
import { getRunnableVSCodeExtensions } from '@/lib/vscode-compat/extensions';
import { summarizeVSCodeCompat } from '@/lib/vscode-compat/status';
import { useVSCodeCompatStore } from '@/stores/vscode-compat-store';
import { useVSCodeExtensionHostStore } from '@/stores/vscode-extension-host-store';
import { useCodeIntelligenceStore } from '@/stores/code-intelligence-store';
import { useFileSystem } from '@/hooks/use-file-system';
import { useWorkspaceStore } from '@/stores/workspace-store';
import {
  getPluginHealthSnapshot,
  subscribePluginHealth,
  getPluginAuditLog,
  subscribePluginAudit,
} from '@/lib/plugins/runtime';
import { cn } from '@/lib/utils';
import { UI_MODAL_OVERLAY_CLASS, UI_MODAL_OVERLAY_STYLE, UI_MODAL_PANEL_CLASS } from '@/lib/ui-layers';
import type { PluginHealth, PluginAuditEvent } from '@/lib/plugins/runtime';
import {
  buildPluginMarketplaceCatalog,
} from '@/lib/plugins/marketplace';
import { FORMULA_EXTRACTOR_PLUGIN_ID } from '@/lib/plugins/defaults';
import packageJson from '../../../package.json';
import { AiProviderProfilesPanel } from './ai-provider-profiles-panel';
import { useAiProviderProfileStore } from '@/stores/ai-provider-profile-store';
import { createProfiledProvider } from '@/lib/ai/profiled-provider';
import { McpServersPanel } from './mcp-servers-panel';
import { normalizeMcpServerConfig, type McpServerConfig } from '@/lib/ai/mcp-config';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
}

type SettingsTab = 'general' | 'appearance' | 'files' | 'extensions' | 'ai' | 'shortcuts' | 'about';

const tabs: { id: SettingsTab; icon: typeof Settings; labelKey: 'settings.general' | 'settings.appearance' | 'settings.files' | 'settings.extensions' | 'settings.ai' | 'settings.shortcuts' | 'settings.about' }[] = [
  { id: 'general', icon: Settings, labelKey: 'settings.general' },
  { id: 'appearance', icon: Palette, labelKey: 'settings.appearance' },
  { id: 'files', icon: FolderOpen, labelKey: 'settings.files' },
  { id: 'extensions', icon: Cable, labelKey: 'settings.extensions' },
  { id: 'ai', icon: Bot, labelKey: 'settings.ai' },
  { id: 'shortcuts', icon: Keyboard, labelKey: 'settings.shortcuts' },
  { id: 'about', icon: Info, labelKey: 'settings.about' },
];

const APP_VERSION = packageJson.version;

export function SettingsDialog({ isOpen, onClose, initialTab = 'general' }: SettingsDialogProps) {
  const { t, locale } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const settings = useSettingsStore((state) => state.settings);
  const [systemPromptDraft, setSystemPromptDraft] = useState({
    global: DEFAULT_SETTINGS.aiSystemPrompt,
    chat: DEFAULT_SETTINGS.aiChatSystemPrompt ?? '',
    agent: DEFAULT_SETTINGS.aiAgentSystemPrompt ?? '',
  });
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const installedPlugins = usePluginStore((state) => state.plugins);
  const importVSCodeConfig = useVSCodeCompatStore((state) => state.importFromJson);
  const resetVSCodeCompat = useVSCodeCompatStore((state) => state.reset);
  const vscodeCompatWorkbenchSettings = useVSCodeCompatStore((state) => state.settings);
  const vscodeCompatKeybindings = useVSCodeCompatStore((state) => state.keybindings);
  const vscodeCompatSnippets = useVSCodeCompatStore((state) => state.snippets);
  const vscodeCompatTasks = useVSCodeCompatStore((state) => state.tasks);
  const vscodeCompatLaunches = useVSCodeCompatStore((state) => state.launches);
  const vscodeCompatExtensions = useVSCodeCompatStore((state) => state.extensions);
  const vscodeCompatImportedAt = useVSCodeCompatStore((state) => state.importedAt);
  const vscodeCompatSourceLabel = useVSCodeCompatStore((state) => state.sourceLabel);
  const vscodeCompatWarnings = useVSCodeCompatStore((state) => state.warnings);
  const vscodeHostSnapshot = useVSCodeExtensionHostStore((state) => state.snapshot);
  const syncVSCodeHost = useVSCodeExtensionHostStore((state) => state.syncWithCompat);
  const codeIntelligenceProviders = useCodeIntelligenceStore((state) => state.providers);
  const refreshCodeIntelligence = useCodeIntelligenceStore((state) => state.refresh);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const aiProfiles = useAiProviderProfileStore((state) => state.profiles);
  const activeAiProfileId = useAiProviderProfileStore((state) => state.activeProfileId);
  const aiProfilePersistenceError = useAiProviderProfileStore((state) => state.error);
  const retryAiProfilePersistence = useAiProviderProfileStore((state) => state.retryPersistence);
  const hydrateAiProfiles = useAiProviderProfileStore((state) => state.hydrate);
  const createAiProfile = useAiProviderProfileStore((state) => state.createProfile);
  const setActiveAiProfile = useAiProviderProfileStore((state) => state.setActiveProfile);
  const setDefaultAiProfile = useAiProviderProfileStore((state) => state.setDefaultProfile);
  const updateAiProfile = useAiProviderProfileStore((state) => state.updateProfile);
  const removeAiModel = useAiProviderProfileStore((state) => state.removeModel);
  const reconcileAiRemoteModels = useAiProviderProfileStore((state) => state.reconcileRemoteModels);
  const setAiModelProvider = useAiProviderProfileStore((state) => state.setModelProvider);
  const removeAiProfile = useAiProviderProfileStore((state) => state.removeProfile);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const dialogs = document.querySelectorAll('[aria-modal="true"]:is([role="dialog"], [role="alertdialog"])');
      if (dialogs.item(dialogs.length - 1) !== dialogRef.current) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) void hydrateAiProfiles();
  }, [hydrateAiProfiles, isOpen]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    try {
      const raw = JSON.parse(window.localStorage.getItem('lattice-mcp-servers-v1') ?? '[]') as unknown;
      const values = Array.isArray(raw) ? raw.map((entry) => normalizeMcpServerConfig(entry as Partial<McpServerConfig>)).filter((entry): entry is McpServerConfig => Boolean(entry)) : [];
      setMcpServers(values);
    } catch {
      setMcpServers([]);
    }
  }, [isOpen]);

  const handleMcpServersChange = (servers: McpServerConfig[]) => {
    setMcpServers(servers);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('lattice-mcp-servers-v1', JSON.stringify(servers));
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setSystemPromptDraft({
      global: settings.aiSystemPrompt,
      chat: settings.aiChatSystemPrompt ?? '',
      agent: settings.aiAgentSystemPrompt ?? '',
    });
  }, [isOpen, settings.aiAgentSystemPrompt, settings.aiChatSystemPrompt, settings.aiSystemPrompt]);
  const { refreshDirectory } = useFileSystem();
  const [vscodeImportMessage, setVSCodeImportMessage] = useState<{ key: TranslationKey; params?: Record<string, string | number> } | null>(null);
  const [isVSCodeImporting, setIsVSCodeImporting] = useState(false);
  const [pluginHealthMap, setPluginHealthMap] = useState<Record<string, PluginHealth>>({});
  const [pluginAuditLog, setPluginAuditLog] = useState<PluginAuditEvent[]>([]);
  const builtInPlugins = useMemo(() => {
    try {
      return getAvailablePlugins();
    } catch (err) {
      console.error('Failed to get available plugins:', err);
      return [];
    }
  }, []);
  const pluginCatalog = useMemo(() => buildPluginMarketplaceCatalog({
    builtInPlugins,
    installedPlugins,
    enabledPluginIds: settings.enabledPlugins,
    trustedPluginIds: settings.trustedPlugins,
  }), [builtInPlugins, installedPlugins, settings.enabledPlugins, settings.trustedPlugins]);

  const networkAllowlist = useMemo(
    () => (Array.isArray(settings.pluginNetworkAllowlist) ? settings.pluginNetworkAllowlist : []),
    [settings.pluginNetworkAllowlist]
  );

  const aboutPluginStatus = useMemo(() => {
    const formulaExtractor = pluginCatalog.find((entry) => entry.id === FORMULA_EXTRACTOR_PLUGIN_ID);
    return {
      marketplaceCount: pluginCatalog.length,
      officialCount: pluginCatalog.filter((entry) => entry.official).length,
      installedCount: pluginCatalog.filter((entry) => entry.source === 'installed' || entry.source === 'override').length,
      highRiskCount: pluginCatalog.filter((entry) => entry.risk === 'high').length,
      activeCount: settings.pluginsEnabled
        ? pluginCatalog.filter((entry) => entry.enabled && entry.trusted && pluginHealthMap[entry.id]?.status === 'active').length
        : 0,
      formulaExtractorReady: Boolean(
        settings.pluginsEnabled && formulaExtractor?.enabled && formulaExtractor.trusted &&
        pluginHealthMap[FORMULA_EXTRACTOR_PLUGIN_ID]?.status === 'active'
      ),
    };
  }, [pluginCatalog, pluginHealthMap, settings.pluginsEnabled]);
  const vscodeCompatSummary = useMemo(
    () => summarizeVSCodeCompat({
      settings: vscodeCompatWorkbenchSettings,
      keybindings: vscodeCompatKeybindings,
      snippets: vscodeCompatSnippets,
      tasks: vscodeCompatTasks,
      launches: vscodeCompatLaunches,
      extensions: vscodeCompatExtensions,
      importedAt: vscodeCompatImportedAt,
      sourceLabel: vscodeCompatSourceLabel,
      warnings: vscodeCompatWarnings,
    }),
    [
      vscodeCompatExtensions,
      vscodeCompatImportedAt,
      vscodeCompatKeybindings,
      vscodeCompatSnippets,
      vscodeCompatSourceLabel,
      vscodeCompatTasks,
      vscodeCompatLaunches,
      vscodeCompatWarnings,
      vscodeCompatWorkbenchSettings,
    ],
  );
  const runnableVSCodeExtensions = useMemo(
    () => getRunnableVSCodeExtensions(vscodeCompatExtensions),
    [vscodeCompatExtensions],
  );
  const readyCodeIntelligenceCount = useMemo(
    () => codeIntelligenceProviders.filter((provider) => provider.status === "ready").length,
    [codeIntelligenceProviders],
  );
  const codeIntelligenceStatusLabel = useMemo(() => {
    if (codeIntelligenceProviders.length === 0) {
      return t('settings.compat.notDetected');
    }
    return t('settings.compat.readyCount', { ready: readyCodeIntelligenceCount, total: codeIntelligenceProviders.length });
  }, [codeIntelligenceProviders, readyCodeIntelligenceCount, t]);

  const compactCompatSource = (value: string | null | undefined) => {
    if (!value) return "VS Code";
    if (value.length <= 72) return value;
    return `${value.slice(0, 28)}…${value.slice(-28)}`;
  };

  const handleRestartOnboarding = async () => {
    await updateSetting('onboardingCompleted', false);
    onClose();
    // Reload to trigger onboarding
    window.location.reload();
  };

  const handleImportVSCodeAuto = async () => {
    if (!isTauriHost()) {
      setVSCodeImportMessage({ key: 'settings.compat.desktopRequired' });
      return;
    }

    setIsVSCodeImporting(true);
    setVSCodeImportMessage({ key: 'settings.compat.scanning' });
    try {
      const imported = await readVSCodeConfigFromDetectedProfiles();
      const extensionCount = imported.config.extensions?.length ?? 0;
      if (imported.discoveredFiles.length === 0 && extensionCount === 0) {
        setVSCodeImportMessage({ key: 'settings.compat.notFound' });
        return;
      }

      await importVSCodeConfig(imported.config, imported.sourceLabel, imported.warnings);
      await updateSetting('vscodeCompatEnabled', true);
      await refreshDirectory({ silent: true });
      setVSCodeImportMessage({ key: 'settings.compat.imported', params: { files: imported.discoveredFiles.length, extensions: extensionCount } });
      setActiveTab("files");
      if (imported.warnings.length > 0) {
        console.warn("VS Code import warnings:", imported.warnings);
      }
    } catch (error) {
      console.error("Failed to auto import VS Code config:", error);
      setVSCodeImportMessage({ key: 'settings.compat.failed' });
    } finally {
      setIsVSCodeImporting(false);
    }
  };

  const handleResetVSCodeCompat = async () => {
    await resetVSCodeCompat();
    await updateSetting('vscodeCompatEnabled', false);
    await refreshDirectory({ silent: true });
    setVSCodeImportMessage({ key: 'settings.compat.resetDone' });
  };

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
    <div
      className={cn(UI_MODAL_OVERLAY_CLASS, "flex items-start justify-center px-4 pb-4 pt-6 md:pt-20")}
      style={UI_MODAL_OVERLAY_STYLE}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        className={cn("flex w-full max-w-5xl flex-col overflow-hidden rounded-xl max-h-[calc(100vh-2rem)] md:max-h-[calc(100vh-6rem)]", UI_MODAL_PANEL_CLASS)}
      >
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

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Sidebar */}
          <nav aria-label={t('settings.title')} className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 md:block md:w-48 md:space-y-1 md:overflow-y-auto md:border-b-0 md:border-r">
            {tabs.map(({ id, icon: Icon, labelKey }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                aria-pressed={activeTab === id}
                className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors md:w-full ${
                  activeTab === id
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                {t(labelKey)}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
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
                <div className="rounded border border-border bg-background p-3">
                  <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground">{t('settings.compat.title')}</div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('settings.compat.description')}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
                      <button
                        type="button"
                        onClick={() => void handleImportVSCodeAuto()}
                        disabled={isVSCodeImporting}
                        className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-60"
                      >
                        {isVSCodeImporting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Import className="h-3.5 w-3.5" />}
                        {t(isVSCodeImporting ? 'settings.compat.importing' : 'settings.compat.import')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleResetVSCodeCompat()}
                        className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        {t('settings.compat.reset')}
                      </button>
                    </div>
                  </div>
                  {vscodeImportMessage && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {t(vscodeImportMessage.key, vscodeImportMessage.params)}
                    </div>
                  )}
                  {vscodeCompatSummary.isImported && (
                    <div className="mt-3 space-y-3 border-t border-border pt-3">
                      <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
                        <StatusItem
                          label={t('settings.compat.profile')}
                          value={compactCompatSource(vscodeCompatSummary.sourceLabel)}
                        />
                        <StatusItem
                          label={t('settings.compat.importedAt')}
                          value={vscodeCompatSummary.importedAtLabel ?? t('settings.about.status.ready')}
                        />
                        <StatusItem
                          label={t('settings.compat.host')}
                          value={
                            vscodeHostSnapshot.status === "unavailable" && vscodeHostSnapshot.lastError
                              ? `${t('settings.compat.unavailable')}: ${vscodeHostSnapshot.lastError}`
                              : `${compatStatusLabel(vscodeHostSnapshot.status, t)} / ${vscodeHostSnapshot.runtime}`
                          }
                        />
                        <StatusItem
                          label={t('settings.compat.intelligence')}
                          value={codeIntelligenceStatusLabel}
                        />
                        <StatusItem
                          label={t('settings.compat.runnable')}
                          value={String(runnableVSCodeExtensions.length)}
                        />
                        <StatusItem
                          label={t('settings.compat.commands')}
                          value={String(vscodeHostSnapshot.commandCount)}
                        />
                        <StatusItem
                          label={t('settings.compat.tasks')}
                          value={String(vscodeCompatSummary.counts.tasks)}
                        />
                        <StatusItem
                          label={t('settings.compat.launch')}
                          value={String(vscodeCompatSummary.counts.launches)}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void syncVSCodeHost({
                            enabled: settings.vscodeCompatEnabled,
                            workspaceRootPath,
                            extensions: vscodeCompatExtensions,
                            settings: vscodeCompatWorkbenchSettings,
                          })}
                          className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-accent"
                        >
                          <RefreshCw className="h-3 w-3" />
                          {t('settings.compat.restartHost')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void refreshCodeIntelligence(workspaceRootPath)}
                          className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-accent"
                        >
                          <RefreshCw className="h-3 w-3" />
                          {t('settings.compat.refresh')}
                        </button>
                      </div>
                      <details className="rounded-md border border-border bg-muted/20 p-2">
                        <summary className="cursor-pointer text-xs font-medium text-foreground">
                          {t('settings.compat.details')}
                        </summary>
                        <div className="mt-3 space-y-3">
                          <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
                            <StatusItem
                              label={t('settings.compat.theme')}
                              value={vscodeCompatSummary.theme.current ?? t('settings.compat.default')}
                            />
                            <StatusItem
                              label={t('settings.compat.snippets')}
                              value={String(vscodeCompatSummary.counts.snippets)}
                            />
                            <StatusItem
                              label={t('settings.compat.associations')}
                              value={String(vscodeCompatSummary.counts.fileAssociations)}
                            />
                          </div>
                          {codeIntelligenceProviders.length > 0 ? (
                            <div className="grid gap-2 md:grid-cols-3">
                              {codeIntelligenceProviders.map((provider) => (
                                <div key={provider.id} className="rounded border border-border bg-background px-2 py-1.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium text-foreground">{provider.label}</span>
                                    <span className={cn(
                                      "rounded px-1.5 py-0.5 text-[10px]",
                                      provider.status === "ready"
                                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                        : provider.status === "error"
                                          ? "bg-red-500/10 text-red-700 dark:text-red-300"
                                          : "bg-muted text-muted-foreground",
                                    )}>
                                      {compatStatusLabel(provider.status, t)}
                                    </span>
                                  </div>
                                  <div className="mt-1 break-all text-[10px] text-muted-foreground">{provider.detail}</div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {runnableVSCodeExtensions.length > 0 ? (
                            <div className="grid gap-2 md:grid-cols-2">
                              {runnableVSCodeExtensions.slice(0, 8).map((extension) => (
                                <div key={extension.id} className="min-w-0 rounded border border-border bg-background px-2 py-1.5">
                                  <div className="truncate text-xs font-medium text-foreground">{extension.displayName ?? extension.id}</div>
                                  <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{extension.id}</div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {vscodeCompatSummary.warnings.length > 0 ? (
                            <div className="rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300">
                              {vscodeCompatSummary.warnings[0]}
                            </div>
                          ) : null}
                        </div>
                      </details>
                    </div>
                  )}
                </div>
                <label className="flex items-start gap-3 rounded border border-border bg-background p-3">
                  <input
                    type="checkbox"
                    checked={settings.markdownUpdateLinksOnRename}
                    onChange={(event) => updateSetting('markdownUpdateLinksOnRename', event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-border"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      {t('settings.markdown.updateLinksOnRename')}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {t('settings.markdown.updateLinksOnRename.description')}
                    </span>
                  </span>
                </label>
                <div className="rounded border border-border bg-background p-3">
                  <div className="text-sm font-medium text-foreground">
                    {t('settings.pdf.externalLinks')}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {t('settings.pdf.externalLinks.description')}
                  </p>
                  <div className="mt-3 inline-flex rounded-lg border border-border bg-muted/40 p-1">
                    {(['internal', 'browser'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => updateSetting('pdfExternalLinkOpenMode', mode)}
                        className={cn(
                          'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                          settings.pdfExternalLinkOpenMode === mode
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {t(mode === 'internal' ? 'settings.pdf.externalLinks.internal' : 'settings.pdf.externalLinks.browser')}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'shortcuts' && (
              <div className="space-y-6">
                <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
                  {t('settings.shortcuts.contextNote')}
                </p>
                {/* App shortcuts */}
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                    {t('settings.shortcuts.section.app')}
                  </div>
                  <div className="space-y-1">
                    <ShortcutItem label={t('settings.shortcuts.toggleSidebar')} shortcut="Ctrl+B" />
                    <ShortcutItem label={t('settings.shortcuts.openSettings')} shortcut="Ctrl+," />
                    <ShortcutItem label={t('settings.shortcuts.openCommandCenter')} shortcut="Ctrl+K" />
                    <ShortcutItem label={t('settings.shortcuts.openPanels')} shortcut="Ctrl+Shift+P" />
                    <ShortcutItem label={t('settings.shortcuts.toggleTheme')} shortcut="Ctrl+Shift+T" />
                    <ShortcutItem label={t('settings.shortcuts.openGuide')} shortcut="Ctrl+Shift+/" />
                  </div>
                </div>

                {/* Text formatting */}
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                    {t('settings.shortcuts.section.text')}
                  </div>
                  <div className="space-y-1">
                    <ShortcutItem label={t('settings.shortcuts.bold')} shortcut="Ctrl+B" />
                    <ShortcutItem label={t('settings.shortcuts.italic')} shortcut="Ctrl+I" />
                    <ShortcutItem label={t('settings.shortcuts.inlineCode')} shortcut="Ctrl+`" />
                    <ShortcutItem label={t('settings.shortcuts.strikethrough')} shortcut="Ctrl+Shift+S" />
                    <ShortcutItem label={t('settings.shortcuts.highlight')} shortcut="Ctrl+Shift+H" />
                    <ShortcutItem label={t('settings.shortcuts.insertLink')} shortcut="Ctrl+K" />
                    <ShortcutItem label={t('settings.shortcuts.insertCodeBlock')} shortcut="Ctrl+Shift+`" />
                    <ShortcutItem label={t('settings.shortcuts.toggleComment')} shortcut="Ctrl+/" />
                  </div>
                </div>

                {/* Math shortcuts */}
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                    {t('settings.shortcuts.section.math')}
                  </div>
                  <div className="space-y-1">
                    <ShortcutItem label={t('settings.shortcuts.inlineMath')} shortcut="Ctrl+Shift+M" />
                    <ShortcutItem label={t('settings.shortcuts.blockMath')} shortcut="Ctrl+Alt+M" />
                  </div>
                </div>

                {/* Quantum keyboard */}
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                    {t('settings.shortcuts.section.quantum')}
                  </div>
                  <div className="space-y-1">
                    <ShortcutItem label={t('settings.shortcuts.quantumOpen')} shortcut="Tab Tab" />
                    <ShortcutItem label={t('settings.shortcuts.quantumTab')} shortcut="Tab / Shift+Tab" />
                    <ShortcutItem label={t('settings.shortcuts.quantumClose')} shortcut="Esc" />
                  </div>
                </div>

                <p className="px-1 text-xs leading-5 text-muted-foreground">{locale === 'en-US' ? 'Quantum Keyboard is an official Lattice plugin. Enable it in Plugins, then browse, search or configure key mappings in its panel.' : '量子键盘已作为 Lattice 官方插件提供。请在插件中启用；打开面板后可浏览公式、搜索或配置键位。'}</p>

                {/* Line operations */}
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                    {t('settings.shortcuts.section.line')}
                  </div>
                  <div className="space-y-1">
                    <ShortcutItem label={t('settings.shortcuts.moveLineUp')} shortcut="Alt+↑" />
                    <ShortcutItem label={t('settings.shortcuts.moveLineDown')} shortcut="Alt+↓" />
                    <ShortcutItem label={t('settings.shortcuts.duplicateLine')} shortcut="Ctrl+D" />
                    <ShortcutItem label={t('settings.shortcuts.insertLineBelow')} shortcut="Ctrl+Enter" />
                    <ShortcutItem label={t('settings.shortcuts.indentMore')} shortcut="Ctrl+]" />
                    <ShortcutItem label={t('settings.shortcuts.indentLess')} shortcut="Ctrl+[" />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'extensions' && (
              <PluginsPanel
                onOpenGuide={() => {
                  onClose();
                  window.dispatchEvent(new Event('lattice:open-guide'));
                }}
                onOpenResult={onClose}
                onPluginsChanged={async () => { await refreshDirectory({ silent: true }); }}
              />
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
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      void updateSettings({
                        aiEnabled: enabled,
                        aiInlineCompletionEnabled: enabled ? settings.aiInlineCompletionEnabled : false,
                        aiAgentOmittedSummaryEnabled: enabled ? settings.aiAgentOmittedSummaryEnabled : false,
                      });
                    }}
                  />
                </div>

                {settings.aiEnabled && (
                  <>
                    <AiProviderProfilesPanel
                      persistenceError={aiProfilePersistenceError}
                      retryPersistence={retryAiProfilePersistence}
                      profiles={aiProfiles}
                      activeProfileId={activeAiProfileId}
                      createProfile={(presetId) => createAiProfile(presetId)}
                      setActiveProfile={(profileId) => {
                        setActiveAiProfile(profileId);
                        const profile = aiProfiles.find((candidate) => candidate.id === profileId);
                        if (profile) {
                          void updateSettings({ aiProvider: profile.provider, aiModel: profile.model });
                        }
                      }}
                      setDefaultProfile={setDefaultAiProfile}
                      updateProfile={updateAiProfile}
                      removeModel={removeAiModel}
                      reconcileRemoteModels={reconcileAiRemoteModels}
                      setModelProvider={setAiModelProvider}
                      removeProfile={removeAiProfile}
                      testProfile={async (profile) => createProfiledProvider(profile).testConnection()}
                      refreshModels={async (profile) => createProfiledProvider(profile).getAvailableModels()}
                    />
                    <McpServersPanel servers={mcpServers} onChange={handleMcpServersChange} />

                    <div className="rounded-lg border border-amber-400/50 bg-amber-50/60 p-3 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-medium">{t('settings.ai.inlineCompletion.enable')}</div>
                          <p className="mt-1 text-xs leading-relaxed">
                            {t('settings.ai.inlineCompletion.description')}
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-border text-primary"
                          checked={settings.aiInlineCompletionEnabled}
                          onChange={(e) => updateSetting('aiInlineCompletionEnabled', e.target.checked)}
                        />
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                        {t('settings.ai.inlineCompletion.costHint')}
                      </p>
                    </div>

                    <div className="rounded-lg border border-amber-400/50 bg-amber-50/60 p-3 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-medium">{t('settings.ai.agentOmittedSummary.enable')}</div>
                          <p className="mt-1 text-xs leading-relaxed">
                            {t('settings.ai.agentOmittedSummary.description')}
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-border text-primary"
                          checked={settings.aiAgentOmittedSummaryEnabled}
                          onChange={(e) => updateSetting('aiAgentOmittedSummaryEnabled', e.target.checked)}
                        />
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                        {t('settings.ai.agentOmittedSummary.costHint')}
                      </p>
                    </div>

                    {/* Temperature */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('settings.ai.temperature')}: {settings.aiTemperature.toFixed(1)}</label>
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
                        <span>{t('settings.ai.precise')}</span>
                        <span>{t('settings.ai.creative')}</span>
                      </div>
                    </div>

                    {/* Max Tokens */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('settings.ai.maxTokens')}</label>
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
                      <label className="text-sm font-medium">{t('settings.ai.systemPrompt.globalLabel')}</label>
                      <textarea
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[80px] resize-y"
                        value={systemPromptDraft.global}
                        onChange={(e) => setSystemPromptDraft((draft) => ({ ...draft, global: e.target.value }))}
                        placeholder={t('settings.ai.systemPromptPlaceholder')}
                        rows={3}
                      />
                      <p className="text-xs text-muted-foreground">{t('settings.ai.systemPrompt.globalHint')}</p>
                      <label className="text-sm font-medium">{t('settings.ai.systemPrompt.chatLabel')}</label>
                      <textarea
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[64px] resize-y"
                        value={systemPromptDraft.chat}
                        onChange={(e) => setSystemPromptDraft((draft) => ({ ...draft, chat: e.target.value }))}
                        placeholder={t('settings.ai.systemPrompt.chatPlaceholder')}
                        rows={2}
                      />
                      <label className="text-sm font-medium">{t('settings.ai.systemPrompt.agentLabel')}</label>
                      <textarea
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[64px] resize-y"
                        value={systemPromptDraft.agent}
                        onChange={(e) => setSystemPromptDraft((draft) => ({ ...draft, agent: e.target.value }))}
                        placeholder={t('settings.ai.systemPrompt.agentPlaceholder')}
                        rows={2}
                      />
                      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                          onClick={() => setSystemPromptDraft({
                            global: DEFAULT_SETTINGS.aiSystemPrompt,
                            chat: '',
                            agent: '',
                          })}
                        >
                          {t('settings.ai.systemPrompt.restoreDefaults')}
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                          onClick={() => setSystemPromptDraft({
                            global: settings.aiSystemPrompt,
                            chat: settings.aiChatSystemPrompt ?? '',
                            agent: settings.aiAgentSystemPrompt ?? '',
                          })}
                        >
                          {t('settings.ai.systemPrompt.cancel')}
                        </button>
                        <button
                          type="button"
                          className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90"
                          onClick={() => void updateSettings({
                            aiSystemPrompt: systemPromptDraft.global.trim() || DEFAULT_SETTINGS.aiSystemPrompt,
                            aiChatSystemPrompt: systemPromptDraft.chat.trim() || null,
                            aiAgentSystemPrompt: systemPromptDraft.agent.trim() || null,
                          })}
                        >
                          {t('settings.ai.systemPrompt.save')}
                        </button>
                      </div>
                    </div>

                    {/* Streaming Toggle */}
                    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
                      <div>
                        <div className="text-sm font-medium">{t('settings.ai.streaming')}</div>
                        <p className="text-xs text-muted-foreground mt-1">{t('settings.ai.streaming.description')}</p>
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
                    {t('settings.version')}: {APP_VERSION}
                  </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg border border-border bg-muted/30 p-4">
                    <div className="text-sm font-medium text-muted-foreground mb-3">
                      {t('settings.about.status')}
                    </div>
                    <div className="grid gap-2 text-xs text-muted-foreground xl:grid-cols-2">
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
                        value={String(aboutPluginStatus.activeCount)}
                      />
                      <StatusItem
                        label={t('settings.about.plugins.audit')}
                        value={pluginAuditLog.length > 0 ? String(pluginAuditLog.length) : t('settings.about.status.ready')}
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-muted/30 p-4">
                    <div className="text-sm font-medium text-muted-foreground mb-3">
                      {t('settings.about.capabilities')}
                    </div>
                    <div className="grid gap-2 text-xs text-muted-foreground xl:grid-cols-2">
                      <StatusItem
                        label={t('settings.about.plugins.marketplace')}
                        value={String(aboutPluginStatus.marketplaceCount)}
                      />
                      <StatusItem
                        label={t('settings.about.plugins.official')}
                        value={String(aboutPluginStatus.officialCount)}
                      />
                      <StatusItem
                        label={t('settings.about.plugins.installed')}
                        value={String(aboutPluginStatus.installedCount)}
                      />
                      <StatusItem
                        label={t('settings.about.plugins.highRisk')}
                        value={String(aboutPluginStatus.highRiskCount)}
                      />
                      <StatusItem
                        label={t('settings.about.formulaExtractor')}
                        value={aboutPluginStatus.formulaExtractorReady ? t('settings.about.status.ready') : t('common.disabled')}
                      />
                      <StatusItem
                        label={t('settings.about.plugins.networkRules')}
                        value={networkAllowlist.length > 0 ? String(networkAllowlist.length) : t('settings.plugins.networkAllowlist.empty')}
                      />
                    </div>
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
function compatStatusLabel(status: string, translate: (key: TranslationKey) => string): string {
  const labels: Record<string, TranslationKey> = {
    ready: 'settings.about.status.ready', idle: 'settings.compat.idle', starting: 'settings.compat.starting',
    error: 'settings.compat.error', unavailable: 'settings.compat.unavailable', stopped: 'settings.compat.stopped',
    disabled: 'common.disabled', unsupported: 'settings.compat.unavailable', missing: 'settings.compat.notDetected',
  };
  return labels[status] ? translate(labels[status]) : status;
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
    <div className="flex min-w-0 items-start justify-between gap-3 rounded-md bg-background/45 px-3 py-2">
      <span className="min-w-0 break-words text-muted-foreground/80">{label}</span>
      <span className="min-w-0 max-w-[55%] break-words text-right font-medium text-foreground">{value}</span>
    </div>
  );
}
