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
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'zh-CN',
  theme: 'system',
  defaultFolder: null,
  lastOpenedFolder: null,
  rememberWindowState: true,
  onboardingCompleted: false,
  windowState: undefined,
};

export const SETTINGS_STORAGE_KEY = 'lattice-settings';
