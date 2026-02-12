/**
 * Application Settings Type Definitions
 * 
 * Defines the structure for all user preferences and application state
 * that needs to be persisted across sessions.
 */

export type Locale = 'zh-CN' | 'en-US';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface WindowState {
  width: number;
  height: number;
  x: number;
  y: number;
  isMaximized: boolean;
}

export interface AppSettings {
  // General
  language: Locale;
  theme: ThemeMode;
  
  // Files
  defaultFolder: string | null;
  lastOpenedFolder: string | null;
  rememberWindowState: boolean;
  
  // Onboarding
  onboardingCompleted: boolean;
  
  // Window (desktop only)
  windowState?: WindowState;

  // Plugins
  pluginsEnabled: boolean;
  enabledPlugins: string[];
  trustedPlugins: string[];
  pluginNetworkAllowlist: string[];
  pluginPanelDockSize: number;
  pluginPanelDockOpen: boolean;
  pluginPanelLastActiveId: string | null;
  pluginPanelRecentIds: string[];

  // AI
  aiEnabled: boolean;
  aiProvider: string | null;
  aiModel: string | null;
  aiOllamaUrl: string;
  aiCustomEndpoint: string | null;
  aiTemperature: number;
  aiMaxTokens: number;
  aiStreamingEnabled: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'zh-CN',
  theme: 'system',
  defaultFolder: null,
  lastOpenedFolder: null,
  rememberWindowState: true,
  onboardingCompleted: false,
  windowState: undefined,
  pluginsEnabled: false,
  enabledPlugins: [],
  trustedPlugins: [],
  pluginNetworkAllowlist: [],
  pluginPanelDockSize: 22,
  pluginPanelDockOpen: false,
  pluginPanelLastActiveId: null,
  pluginPanelRecentIds: [],
  aiEnabled: false,
  aiProvider: null,
  aiModel: null,
  aiOllamaUrl: 'http://localhost:11434',
  aiCustomEndpoint: null,
  aiTemperature: 0.7,
  aiMaxTokens: 4096,
  aiStreamingEnabled: true,
};

export const SETTINGS_STORAGE_KEY = 'lattice-settings';
