/**
 * Settings Store
 * 
 * Zustand store for managing application settings with persistence.
 */

import { create } from 'zustand';
import type { AppSettings, ExecutionDockLayout, Locale, ThemeMode } from '@/types/settings';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '@/types/settings';
import { BUILTIN_PLUGIN_DEFAULTS_VERSION, QUANTUM_KEYBOARD_PLUGIN_ID } from '@/lib/plugins/defaults';
import { getStorageAdapter } from '@/lib/storage-adapter';
import { DEFAULT_APPEARANCE_SETTINGS, MAX_CUSTOM_THEMES, type AppearanceSettings, type ThemePackage } from '@/lib/appearance/types';
import { isBuiltinTheme } from '@/lib/appearance/registry';
import { validateThemePackage } from '@/lib/appearance/validation';
import { writeAppearanceCache } from '@/lib/appearance/bootstrap';
import { setLocale } from '@/lib/i18n';

const MAX_RECENT_WORKSPACES = 12;
let settingsWriteQueue = Promise.resolve();
let hydrationTask: Promise<void> | null = null;
let persistedSettings: Partial<AppSettings> | null = null;
let settingsRevision = 0;
const settingRevisions = new Map<keyof AppSettings, number>();

function persistSettings(snapshot: AppSettings, updates: Partial<AppSettings> = snapshot): Promise<void> {
  settingsWriteQueue = settingsWriteQueue.catch(() => undefined).then(async () => {
    const storage = getStorageAdapter();
    // Keep fields and theme formats from newer builds until the user explicitly edits them.
    const saved = { ...snapshot, ...persistedSettings, ...updates };
    await (storage.setStrict ? storage.setStrict(SETTINGS_STORAGE_KEY, saved) : storage.set(SETTINGS_STORAGE_KEY, saved));
    persistedSettings = saved;
    writeAppearanceCache(normalizeAppearance(saved.appearance), saved.theme);
  });
  return settingsWriteQueue;
}

function normalizeAppearance(raw: unknown): AppearanceSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_APPEARANCE_SETTINGS;
  const candidate = raw as Partial<AppearanceSettings>;
  if (candidate.schemaVersion !== 1) return structuredClone(DEFAULT_APPEARANCE_SETTINGS);
  const customThemes = Array.isArray(candidate.customThemes)
    ? candidate.customThemes
      .map((theme) => validateThemePackage(theme, { customOnly: true }))
      .filter((result): result is { ok: true; theme: ThemePackage } => result.ok)
      .map((result) => result.theme)
      .filter((theme, index, themes) => themes.findIndex((item) => item.id === theme.id) === index)
      .slice(0, MAX_CUSTOM_THEMES)
    : [];
  const activeThemeId = typeof candidate.activeThemeId === 'string' &&
    (isBuiltinTheme(candidate.activeThemeId) || customThemes.some((theme) => theme.id === candidate.activeThemeId))
    ? candidate.activeThemeId
    : DEFAULT_APPEARANCE_SETTINGS.activeThemeId;
  return { ...DEFAULT_APPEARANCE_SETTINGS, activeThemeId, customThemes };
}

function normalizeWorkspacePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

interface SettingsState {
  settings: AppSettings;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
}

interface SettingsActions {
  loadSettings: () => Promise<void>;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<boolean>;
  updateSettings: (updates: Partial<AppSettings>) => Promise<boolean>;
  resetSettings: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  setLanguage: (language: Locale) => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
  setAppearanceTheme: (themeId: string) => Promise<void>;
  saveCustomTheme: (theme: ThemePackage) => Promise<void>;
  deleteCustomTheme: (themeId: string) => Promise<void>;
  resetAppearance: () => Promise<void>;
  setDefaultFolder: (folder: string | null) => Promise<void>;
  rememberWorkspace: (input: { workspaceKey: string; displayPath: string }) => Promise<void>;
  removeRecentWorkspacePath: (path: string) => Promise<void>;
}

export type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoading: true,
  isInitialized: false,
  error: null,

  loadSettings: () => {
    if (hydrationTask) return hydrationTask;
    if (get().isInitialized) return Promise.resolve();
    set({ isLoading: true, error: null });
    hydrationTask = (async () => { try {
      const storage = getStorageAdapter();
      const saved = await (storage.getStrict ? storage.getStrict<AppSettings>(SETTINGS_STORAGE_KEY) : storage.get<AppSettings>(SETTINGS_STORAGE_KEY));
      const normalized = normalizeSettings(saved ? saved : {});
      const storedPluginDefaultsVersion = typeof saved?.builtinPluginDefaultsVersion === 'number'
        ? saved.builtinPluginDefaultsVersion
        : 0;
      const shouldOfferNewBuiltins = storedPluginDefaultsVersion < BUILTIN_PLUGIN_DEFAULTS_VERSION;
      const resolved: AppSettings = {
        ...DEFAULT_SETTINGS,
        ...(saved ? normalized : { language: detectSystemLanguage() }),
        appearance: normalizeAppearance(saved?.appearance),
      };
      if (shouldOfferNewBuiltins) {
        resolved.enabledPlugins = Array.from(new Set([...resolved.enabledPlugins, QUANTUM_KEYBOARD_PLUGIN_ID]));
        resolved.trustedPlugins = Array.from(new Set([...resolved.trustedPlugins, QUANTUM_KEYBOARD_PLUGIN_ID]));
        resolved.builtinPluginDefaultsVersion = BUILTIN_PLUGIN_DEFAULTS_VERSION;
      }
      persistedSettings = { ...resolved, ...saved, builtinPluginDefaultsVersion: resolved.builtinPluginDefaultsVersion };
      set({ settings: resolved, isLoading: false, isInitialized: true });
      writeAppearanceCache(resolved.appearance, resolved.theme);
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to load settings',
        isLoading: false,
        isInitialized: false,
      });
    } finally { hydrationTask = null; } })();
    return hydrationTask;
  },

  updateSetting: async (key, value) => {
    return get().updateSettings({ [key]: value } as Partial<AppSettings>);
  },

  updateSettings: async (updates) => {
    if (hydrationTask || !get().isInitialized) {
      await get().loadSettings();
      if (!get().isInitialized) return false;
    }
    const previous = get().settings;
    const newSettings = { ...previous, ...updates };
    const revision = ++settingsRevision;
    const changedKeys = Object.keys(updates) as Array<keyof AppSettings>;
    for (const key of changedKeys) settingRevisions.set(key, revision);
    set({ settings: newSettings, error: null });
    try {
      await persistSettings(newSettings, updates);
      if (revision === settingsRevision) set({ error: null });
      return true;
    } catch (error) {
      const current = get().settings;
      const durable = persistedSettings ? {
        ...DEFAULT_SETTINGS,
        ...normalizeSettings(persistedSettings),
        appearance: normalizeAppearance(persistedSettings.appearance),
      } : previous;
      const restored = { ...current };
      let ownsCurrentValue = false;
      for (const key of changedKeys) {
        if (settingRevisions.get(key) !== revision) continue;
        restored[key] = durable[key] as never;
        ownsCurrentValue = true;
      }
      if (ownsCurrentValue) set({ settings: restored, error: error instanceof Error ? error.message : 'Failed to update settings' });
      return false;
    }
  },

  resetSettings: async () => {
    await get().updateSettings(structuredClone(DEFAULT_SETTINGS));
  },

  completeOnboarding: async () => {
    await get().updateSetting('onboardingCompleted', true);
  },

  setLanguage: async (language) => {
    await get().updateSetting('language', language);
  },

  setTheme: async (theme) => {
    await get().updateSetting('theme', theme);
  },

  setAppearanceTheme: async (themeId) => {
    await ensureSettingsLoaded();
    const { settings } = get();
    const appearance = normalizeAppearance({ ...settings.appearance, activeThemeId: themeId });
    if (!await get().updateSetting('appearance', appearance)) throw new Error(get().error ?? 'Appearance save failed');
  },

  saveCustomTheme: async (theme) => {
    const result = validateThemePackage(theme, { customOnly: true });
    if (!result.ok) throw new Error(result.error);
    await ensureSettingsLoaded();
    const { settings } = get();
    if (settings.appearance.customThemes.length >= MAX_CUSTOM_THEMES && !settings.appearance.customThemes.some((item) => item.id === theme.id)) throw new Error('最多保存 20 套自定义皮肤，请先删除一套再保存。');
    const customThemes = [
      ...settings.appearance.customThemes.filter((item) => item.id !== theme.id),
      result.theme,
    ];
    if (!await get().updateSetting('appearance', { ...settings.appearance, activeThemeId: theme.id, customThemes })) throw new Error(get().error ?? 'Appearance save failed');
  },

  deleteCustomTheme: async (themeId) => {
    if (isBuiltinTheme(themeId)) return;
    await ensureSettingsLoaded();
    const { settings } = get();
    const customThemes = settings.appearance.customThemes.filter((theme) => theme.id !== themeId);
    const activeThemeId = settings.appearance.activeThemeId === themeId ? DEFAULT_APPEARANCE_SETTINGS.activeThemeId : settings.appearance.activeThemeId;
    if (!await get().updateSetting('appearance', { ...settings.appearance, activeThemeId, customThemes })) throw new Error(get().error ?? 'Appearance delete failed');
  },

  resetAppearance: async () => {
    await ensureSettingsLoaded();
    if (!await get().updateSettings({ appearance: { ...get().settings.appearance, activeThemeId: 'lattice' }, theme: 'system' })) throw new Error(get().error ?? 'Appearance reset failed');
  },

  setDefaultFolder: async (folder) => {
    await get().updateSetting('defaultFolder', folder ? normalizeWorkspacePath(folder) : null);
  },

  rememberWorkspace: async ({ workspaceKey, displayPath }) => {
    const trimmed = normalizeWorkspacePath(displayPath);
    const normalizedWorkspaceKey = workspaceKey.trim();
    if (!normalizedWorkspaceKey) return;
    if (!trimmed) return;
    const { settings, updateSettings } = get();
    const currentRecentWorkspacePaths = Array.isArray(settings.recentWorkspacePaths)
      ? settings.recentWorkspacePaths
      : [];
    const currentRecentWorkspaceKeys = Array.isArray(settings.recentWorkspaceKeys)
      ? settings.recentWorkspaceKeys
      : [];
    const recentWorkspacePaths = [
      trimmed,
      ...currentRecentWorkspacePaths
        .map((item) => normalizeWorkspacePath(item))
        .filter((item) => item !== trimmed),
    ].slice(0, MAX_RECENT_WORKSPACES);
    const recentWorkspaceKeys = [
      normalizedWorkspaceKey,
      ...currentRecentWorkspaceKeys.filter((item) => item !== normalizedWorkspaceKey),
    ].slice(0, MAX_RECENT_WORKSPACES);
    await updateSettings({
      lastWorkspacePath: trimmed,
      lastWorkspaceKey: normalizedWorkspaceKey,
      lastOpenedFolder: trimmed,
      recentWorkspacePaths,
      recentWorkspaceKeys,
      workspaceDisplayPaths: {
        ...(settings.workspaceDisplayPaths ?? {}),
        [normalizedWorkspaceKey]: trimmed,
      },
    });
  },

  removeRecentWorkspacePath: async (path) => {
    const trimmed = normalizeWorkspacePath(path);
    const { settings, updateSettings } = get();
    const currentRecentWorkspacePaths = Array.isArray(settings.recentWorkspacePaths)
      ? settings.recentWorkspacePaths
      : [];
    const recentWorkspacePaths = currentRecentWorkspacePaths
      .map((item) => normalizeWorkspacePath(item))
      .filter((item) => item !== trimmed);
    const nextLastWorkspacePath = normalizeWorkspacePath(settings.lastWorkspacePath ?? '') === trimmed
      ? recentWorkspacePaths[0] ?? null
      : settings.lastWorkspacePath;
    const nextLastOpenedFolder = normalizeWorkspacePath(settings.lastOpenedFolder ?? '') === trimmed
      ? recentWorkspacePaths[0] ?? null
      : settings.lastOpenedFolder;
    await updateSettings({
      recentWorkspacePaths,
      lastWorkspacePath: nextLastWorkspacePath,
      lastOpenedFolder: nextLastOpenedFolder,
      recentWorkspaceKeys: Array.isArray(settings.recentWorkspaceKeys)
        ? settings.recentWorkspaceKeys.filter((key) => (settings.workspaceDisplayPaths?.[key] ?? "") !== trimmed)
        : [],
      workspaceDisplayPaths: Object.fromEntries(
        Object.entries(settings.workspaceDisplayPaths ?? {}).filter(([, value]) => normalizeWorkspacePath(value) !== trimmed)
      ),
      lastWorkspaceKey: normalizeWorkspacePath(settings.lastWorkspacePath ?? '') === trimmed
        ? (Array.isArray(settings.recentWorkspaceKeys)
            ? settings.recentWorkspaceKeys.find((key) => normalizeWorkspacePath((settings.workspaceDisplayPaths ?? {})[key] ?? "") !== trimmed) ?? null
            : null)
        : settings.lastWorkspaceKey ?? null,
    });
  },
}));

async function ensureSettingsLoaded(): Promise<void> {
  if (hydrationTask || !useSettingsStore.getState().isInitialized) await useSettingsStore.getState().loadSettings();
  if (!useSettingsStore.getState().isInitialized) throw new Error(useSettingsStore.getState().error ?? 'Settings are not loaded');
}

// Settings are the durable locale source; every surface observes the same optimistic change or rollback.
useSettingsStore.subscribe((state, previous) => {
  if (state.isInitialized && (state.settings.language !== previous.settings.language || !previous.isInitialized)) setLocale(state.settings.language);
});

/**
 * Detect system language and return appropriate locale
 */
function detectSystemLanguage(): Locale {
  if (typeof navigator === 'undefined') return 'zh-CN';
  
  const lang = navigator.language || (navigator as { userLanguage?: string }).userLanguage || 'zh-CN';
  
  if (lang.startsWith('zh')) {
    return 'zh-CN';
  }
  return 'en-US';
}

function normalizeSettings(raw: Partial<AppSettings>): Partial<AppSettings> {
  const normalized: Partial<AppSettings> = {};
  const assignIfDefined = <K extends keyof AppSettings>(key: K, value: AppSettings[K] | undefined) => {
    if (value !== undefined) {
      normalized[key] = value;
    }
  };
  const stringOrNull = (value: unknown) =>
    typeof value === 'string'
      ? normalizeWorkspacePath(value)
      : value === null
        ? null
        : undefined;
  const stringArray = (value: unknown) =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => normalizeWorkspacePath(item))
      : undefined;
  const rawStringArray = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : undefined;
  const stringRecord = (value: unknown) => {
    if (!value || typeof value !== "object") return undefined;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => typeof item === "string")
        .map(([key, item]) => [key, normalizeWorkspacePath(item as string)])
    );
  };
  const normalizeExecutionDockLayouts = (value: unknown): Record<string, ExecutionDockLayout> | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const entries = Object.entries(value as Record<string, unknown>).flatMap<[string, ExecutionDockLayout]>(([key, layout]) => {
      if (!layout || typeof layout !== "object") return [];
      const candidate = layout as Record<string, unknown>;
      const size = typeof candidate.size === "number" ? candidate.size : undefined;
      const open = typeof candidate.open === "boolean" ? candidate.open : undefined;
      const activeTab: ExecutionDockLayout["activeTab"] =
        candidate.activeTab === "run" || candidate.activeTab === "problems"
          ? candidate.activeTab
          : undefined;
      if (size === undefined || open === undefined) return [];
      return [[key, { size, open, ...(activeTab ? { activeTab } : {}) }]];
    });
    return Object.fromEntries(entries);
  };

  if (raw.language === 'zh-CN' || raw.language === 'en-US') normalized.language = raw.language;
  if (raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'system') normalized.theme = raw.theme;
  assignIfDefined('defaultFolder', stringOrNull(raw.defaultFolder));
  assignIfDefined('lastOpenedFolder', stringOrNull(raw.lastOpenedFolder));
  assignIfDefined('lastWorkspacePath', stringOrNull(raw.lastWorkspacePath));
  assignIfDefined('lastWorkspaceKey', typeof raw.lastWorkspaceKey === 'string' ? raw.lastWorkspaceKey : raw.lastWorkspaceKey === null ? null : undefined);
  assignIfDefined('recentWorkspacePaths', stringArray(raw.recentWorkspacePaths)?.slice(0, MAX_RECENT_WORKSPACES));
  assignIfDefined('recentWorkspaceKeys', rawStringArray(raw.recentWorkspaceKeys)?.slice(0, MAX_RECENT_WORKSPACES));
  assignIfDefined('workspaceDisplayPaths', stringRecord(raw.workspaceDisplayPaths));
  if (typeof raw.rememberWindowState === 'boolean') normalized.rememberWindowState = raw.rememberWindowState;
  if (raw.pdfExternalLinkOpenMode === 'internal' || raw.pdfExternalLinkOpenMode === 'browser') {
    normalized.pdfExternalLinkOpenMode = raw.pdfExternalLinkOpenMode;
  }
  if (raw.workbenchSurface === 'local' || raw.workbenchSurface === 'cloud') normalized.workbenchSurface = raw.workbenchSurface;
  if (raw.activityView === 'files' || raw.activityView === 'annotations' || raw.activityView === 'search' || raw.activityView === 'vscode') {
    normalized.activityView = raw.activityView;
  }
  if (typeof raw.sidePanelWidth === 'number') normalized.sidePanelWidth = raw.sidePanelWidth;
  if (typeof raw.sidePanelCollapsed === 'boolean') normalized.sidePanelCollapsed = raw.sidePanelCollapsed;
  if (raw.searchPanelScope === 'all' || raw.searchPanelScope === 'current') normalized.searchPanelScope = raw.searchPanelScope;
  if (raw.searchPanelMode === 'name_and_content' || raw.searchPanelMode === 'file_name_only') normalized.searchPanelMode = raw.searchPanelMode;
  if (raw.searchPanelSort === 'relevance' || raw.searchPanelSort === 'name') normalized.searchPanelSort = raw.searchPanelSort;
  if (raw.annotationsPanelScope === 'all' || raw.annotationsPanelScope === 'current') normalized.annotationsPanelScope = raw.annotationsPanelScope;
  if (raw.annotationsPanelSort === 'latest' || raw.annotationsPanelSort === 'count' || raw.annotationsPanelSort === 'name') {
    normalized.annotationsPanelSort = raw.annotationsPanelSort;
  }
  if (typeof raw.onboardingCompleted === 'boolean') normalized.onboardingCompleted = raw.onboardingCompleted;
  if (raw.windowState && typeof raw.windowState === 'object') normalized.windowState = raw.windowState;
  if (typeof raw.pluginsEnabled === 'boolean') normalized.pluginsEnabled = raw.pluginsEnabled;
  assignIfDefined('enabledPlugins', stringArray(raw.enabledPlugins));
  assignIfDefined('trustedPlugins', stringArray(raw.trustedPlugins));
  if (typeof raw.builtinPluginDefaultsVersion === 'number' && Number.isFinite(raw.builtinPluginDefaultsVersion)) {
    normalized.builtinPluginDefaultsVersion = raw.builtinPluginDefaultsVersion;
  }
  assignIfDefined('pluginNetworkAllowlist', stringArray(raw.pluginNetworkAllowlist));
  if (typeof raw.pluginPanelDockSize === 'number') normalized.pluginPanelDockSize = raw.pluginPanelDockSize;
  if (typeof raw.pluginPanelDockOpen === 'boolean') normalized.pluginPanelDockOpen = raw.pluginPanelDockOpen;
  assignIfDefined('pluginPanelLastActiveId', stringOrNull(raw.pluginPanelLastActiveId));
  assignIfDefined('pluginPanelRecentIds', stringArray(raw.pluginPanelRecentIds));
  const executionDockLayouts = normalizeExecutionDockLayouts(raw.executionDockLayouts);
  if (executionDockLayouts) normalized.executionDockLayouts = executionDockLayouts;
  if (typeof raw.aiEnabled === 'boolean') normalized.aiEnabled = raw.aiEnabled;
  if (typeof raw.aiInlineCompletionEnabled === 'boolean') {
    normalized.aiInlineCompletionEnabled = raw.aiInlineCompletionEnabled;
  }
  if (typeof raw.aiAgentOmittedSummaryEnabled === 'boolean') {
    normalized.aiAgentOmittedSummaryEnabled = raw.aiAgentOmittedSummaryEnabled;
  }
  assignIfDefined('aiProvider', stringOrNull(raw.aiProvider));
  assignIfDefined('aiModel', stringOrNull(raw.aiModel));
  if (typeof raw.aiTemperature === 'number') normalized.aiTemperature = raw.aiTemperature;
  if (typeof raw.aiMaxTokens === 'number') normalized.aiMaxTokens = raw.aiMaxTokens;
  if (typeof raw.aiStreamingEnabled === 'boolean') normalized.aiStreamingEnabled = raw.aiStreamingEnabled;
  if (typeof raw.aiSystemPrompt === 'string') normalized.aiSystemPrompt = raw.aiSystemPrompt;
  assignIfDefined('aiChatSystemPrompt', stringOrNull(raw.aiChatSystemPrompt));
  assignIfDefined('aiAgentSystemPrompt', stringOrNull(raw.aiAgentSystemPrompt));
  if (typeof raw.aiPanelOpen === 'boolean') normalized.aiPanelOpen = raw.aiPanelOpen;
  if (typeof raw.aiPanelWidth === 'number') normalized.aiPanelWidth = raw.aiPanelWidth;
  if (typeof raw.vscodeCompatEnabled === 'boolean') normalized.vscodeCompatEnabled = raw.vscodeCompatEnabled;
  return normalized;
}
