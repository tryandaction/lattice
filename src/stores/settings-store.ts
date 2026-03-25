/**
 * Settings Store
 * 
 * Zustand store for managing application settings with persistence.
 */

import { create } from 'zustand';
import type { AppSettings, ExecutionDockLayout, Locale, ThemeMode } from '@/types/settings';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '@/types/settings';
import { getStorageAdapter } from '@/lib/storage-adapter';

const MAX_RECENT_WORKSPACES = 12;

interface SettingsState {
  settings: AppSettings;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
}

interface SettingsActions {
  loadSettings: () => Promise<void>;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  resetSettings: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  setLanguage: (language: Locale) => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
  setDefaultFolder: (folder: string | null) => Promise<void>;
  rememberWorkspacePath: (path: string) => Promise<void>;
  removeRecentWorkspacePath: (path: string) => Promise<void>;
}

export type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoading: true,
  isInitialized: false,
  error: null,

  loadSettings: async () => {
    try {
      set({ isLoading: true, error: null });
      const storage = getStorageAdapter();
      const saved = await storage.get<AppSettings>(SETTINGS_STORAGE_KEY);
      
      if (saved) {
        // Merge with defaults to handle new settings
        const normalized = normalizeSettings(saved);
        const merged = { ...DEFAULT_SETTINGS, ...normalized };
        set({
          settings: merged,
          isLoading: false,
          isInitialized: true,
        });
        await storage.set(SETTINGS_STORAGE_KEY, merged);
      } else {
        // Detect system language for first launch
        const systemLang = detectSystemLanguage();
        const initialSettings = { ...DEFAULT_SETTINGS, language: systemLang };
        await storage.set(SETTINGS_STORAGE_KEY, initialSettings);
        set({ 
          settings: initialSettings,
          isLoading: false,
          isInitialized: true,
        });
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      set({ 
        error: error instanceof Error ? error.message : 'Failed to load settings',
        isLoading: false,
        isInitialized: true,
      });
    }
  },

  updateSetting: async (key, value) => {
    try {
      const { settings } = get();
      const newSettings = { ...settings, [key]: value };
      set({ settings: newSettings });
      
      const storage = getStorageAdapter();
      await storage.set(SETTINGS_STORAGE_KEY, newSettings);
    } catch (error) {
      console.error(`Failed to update setting ${key}:`, error);
      set({ error: error instanceof Error ? error.message : 'Failed to update setting' });
    }
  },

  updateSettings: async (updates) => {
    try {
      const { settings } = get();
      const newSettings = { ...settings, ...updates };
      set({ settings: newSettings });
      
      const storage = getStorageAdapter();
      await storage.set(SETTINGS_STORAGE_KEY, newSettings);
    } catch (error) {
      console.error('Failed to update settings:', error);
      set({ error: error instanceof Error ? error.message : 'Failed to update settings' });
    }
  },

  resetSettings: async () => {
    try {
      set({ settings: DEFAULT_SETTINGS });
      const storage = getStorageAdapter();
      await storage.set(SETTINGS_STORAGE_KEY, DEFAULT_SETTINGS);
    } catch (error) {
      console.error('Failed to reset settings:', error);
      set({ error: error instanceof Error ? error.message : 'Failed to reset settings' });
    }
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

  setDefaultFolder: async (folder) => {
    await get().updateSetting('defaultFolder', folder);
  },

  rememberWorkspacePath: async (path) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    const { settings, updateSettings } = get();
    const recentWorkspacePaths = [
      trimmed,
      ...settings.recentWorkspacePaths.filter((item) => item !== trimmed),
    ].slice(0, MAX_RECENT_WORKSPACES);
    await updateSettings({
      lastWorkspacePath: trimmed,
      lastOpenedFolder: trimmed,
      recentWorkspacePaths,
    });
  },

  removeRecentWorkspacePath: async (path) => {
    const trimmed = path.trim();
    const { settings, updateSettings } = get();
    const recentWorkspacePaths = settings.recentWorkspacePaths.filter((item) => item !== trimmed);
    const nextLastWorkspacePath = settings.lastWorkspacePath === trimmed
      ? recentWorkspacePaths[0] ?? null
      : settings.lastWorkspacePath;
    const nextLastOpenedFolder = settings.lastOpenedFolder === trimmed
      ? recentWorkspacePaths[0] ?? null
      : settings.lastOpenedFolder;
    await updateSettings({
      recentWorkspacePaths,
      lastWorkspacePath: nextLastWorkspacePath,
      lastOpenedFolder: nextLastOpenedFolder,
    });
  },
}));

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
  const stringOrNull = (value: unknown) => (typeof value === 'string' ? value : value === null ? null : undefined);
  const stringArray = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
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
  normalized.defaultFolder = stringOrNull(raw.defaultFolder);
  normalized.lastOpenedFolder = stringOrNull(raw.lastOpenedFolder);
  normalized.lastWorkspacePath = stringOrNull(raw.lastWorkspacePath);
  normalized.recentWorkspacePaths = stringArray(raw.recentWorkspacePaths)?.slice(0, MAX_RECENT_WORKSPACES);
  if (typeof raw.rememberWindowState === 'boolean') normalized.rememberWindowState = raw.rememberWindowState;
  if (raw.activityView === 'files' || raw.activityView === 'annotations' || raw.activityView === 'search') {
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
  normalized.enabledPlugins = stringArray(raw.enabledPlugins);
  normalized.trustedPlugins = stringArray(raw.trustedPlugins);
  normalized.pluginNetworkAllowlist = stringArray(raw.pluginNetworkAllowlist);
  if (typeof raw.pluginPanelDockSize === 'number') normalized.pluginPanelDockSize = raw.pluginPanelDockSize;
  if (typeof raw.pluginPanelDockOpen === 'boolean') normalized.pluginPanelDockOpen = raw.pluginPanelDockOpen;
  normalized.pluginPanelLastActiveId = stringOrNull(raw.pluginPanelLastActiveId);
  normalized.pluginPanelRecentIds = stringArray(raw.pluginPanelRecentIds);
  const executionDockLayouts = normalizeExecutionDockLayouts(raw.executionDockLayouts);
  if (executionDockLayouts) normalized.executionDockLayouts = executionDockLayouts;
  if (typeof raw.aiEnabled === 'boolean') normalized.aiEnabled = raw.aiEnabled;
  normalized.aiProvider = stringOrNull(raw.aiProvider);
  normalized.aiModel = stringOrNull(raw.aiModel);
  if (typeof raw.aiTemperature === 'number') normalized.aiTemperature = raw.aiTemperature;
  if (typeof raw.aiMaxTokens === 'number') normalized.aiMaxTokens = raw.aiMaxTokens;
  if (typeof raw.aiStreamingEnabled === 'boolean') normalized.aiStreamingEnabled = raw.aiStreamingEnabled;
  return normalized;
}
