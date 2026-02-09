/**
 * Settings Store
 * 
 * Zustand store for managing application settings with persistence.
 */

import { create } from 'zustand';
import type { AppSettings, Locale, ThemeMode } from '@/types/settings';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '@/types/settings';
import { getStorageAdapter } from '@/lib/storage-adapter';

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

  if (raw.language === 'zh-CN' || raw.language === 'en-US') normalized.language = raw.language;
  if (raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'system') normalized.theme = raw.theme;
  normalized.defaultFolder = stringOrNull(raw.defaultFolder);
  normalized.lastOpenedFolder = stringOrNull(raw.lastOpenedFolder);
  if (typeof raw.rememberWindowState === 'boolean') normalized.rememberWindowState = raw.rememberWindowState;
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
  if (typeof raw.aiEnabled === 'boolean') normalized.aiEnabled = raw.aiEnabled;
  return normalized;
}
