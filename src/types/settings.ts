/**
 * Application Settings Type Definitions
 * 
 * Defines the structure for all user preferences and application state
 * that needs to be persisted across sessions.
 */

import { DEFAULT_ENABLED_PLUGIN_IDS } from "@/lib/plugins/defaults";
import type { AppearanceSettings } from "@/lib/appearance/types";
import { DEFAULT_APPEARANCE_SETTINGS } from "@/lib/appearance/types";

export type Locale = 'zh-CN' | 'en-US';
export type ThemeMode = 'light' | 'dark' | 'system';
export type ActivityView = 'files' | 'annotations' | 'search' | 'vscode';
export type WorkbenchPanelScope = 'all' | 'current';
export type AnnotationPanelSort = 'latest' | 'count' | 'name';
export type SearchPanelMode = 'name_and_content' | 'file_name_only';
export type SearchPanelSort = 'relevance' | 'name';
export type PdfExternalLinkOpenMode = 'internal' | 'browser';

export interface WindowState {
  width: number;
  height: number;
  x: number;
  y: number;
  isMaximized: boolean;
}

export interface ExecutionDockLayout {
  size: number;
  open: boolean;
  activeTab?: "run" | "problems" | "references";
}

export interface AppSettings {
  // General
  language: Locale;
  theme: ThemeMode;
  appearance: AppearanceSettings;
  
  // Files
  defaultFolder: string | null;
  lastOpenedFolder: string | null;
  lastWorkspacePath: string | null;
  lastWorkspaceKey: string | null;
  recentWorkspacePaths: string[];
  recentWorkspaceKeys: string[];
  workspaceDisplayPaths: Record<string, string>;
  rememberWindowState: boolean;
  markdownUpdateLinksOnRename: boolean;
  pdfExternalLinkOpenMode: PdfExternalLinkOpenMode;

  // Workbench
  workbenchSurface: 'local' | 'cloud';
  activityView: ActivityView;
  sidePanelWidth: number;
  sidePanelCollapsed: boolean;
  searchPanelScope: WorkbenchPanelScope;
  searchPanelMode: SearchPanelMode;
  searchPanelSort: SearchPanelSort;
  annotationsPanelScope: WorkbenchPanelScope;
  annotationsPanelSort: AnnotationPanelSort;
  
  // Onboarding
  onboardingCompleted: boolean;
  
  // Window (desktop only)
  windowState?: WindowState;

  // Plugins
  pluginsEnabled: boolean;
  enabledPlugins: string[];
  trustedPlugins: string[];
  builtinPluginDefaultsVersion: number;
  pluginNetworkAllowlist: string[];
  pluginPanelDockSize: number;
  pluginPanelDockOpen: boolean;
  pluginPanelLastActiveId: string | null;
  pluginPanelRecentIds: string[];
  executionDockLayouts: Record<string, ExecutionDockLayout>;

  // AI
  aiEnabled: boolean;
  aiInlineCompletionEnabled: boolean;
  aiAgentOmittedSummaryEnabled: boolean;
  aiProvider: string | null;
  aiModel: string | null;
  aiTemperature: number;
  aiMaxTokens: number;
  aiStreamingEnabled: boolean;
  aiSystemPrompt: string;
  aiChatSystemPrompt: string | null;
  aiAgentSystemPrompt: string | null;
  aiPanelOpen: boolean;
  aiPanelWidth: number;
  vscodeCompatEnabled: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'zh-CN',
  theme: 'system',
  appearance: DEFAULT_APPEARANCE_SETTINGS,
  defaultFolder: null,
  lastOpenedFolder: null,
  lastWorkspacePath: null,
  lastWorkspaceKey: null,
  recentWorkspacePaths: [],
  recentWorkspaceKeys: [],
  workspaceDisplayPaths: {},
  rememberWindowState: true,
  markdownUpdateLinksOnRename: false,
  pdfExternalLinkOpenMode: 'internal',
  workbenchSurface: 'local',
  activityView: 'files',
  sidePanelWidth: 22,
  sidePanelCollapsed: false,
  searchPanelScope: 'all',
  searchPanelMode: 'name_and_content',
  searchPanelSort: 'relevance',
  annotationsPanelScope: 'all',
  annotationsPanelSort: 'latest',
  onboardingCompleted: false,
  windowState: undefined,
  pluginsEnabled: true,
  enabledPlugins: DEFAULT_ENABLED_PLUGIN_IDS,
  trustedPlugins: DEFAULT_ENABLED_PLUGIN_IDS,
  builtinPluginDefaultsVersion: 1,
  pluginNetworkAllowlist: [],
  pluginPanelDockSize: 22,
  pluginPanelDockOpen: false,
  pluginPanelLastActiveId: null,
  pluginPanelRecentIds: [],
  executionDockLayouts: {},
  aiEnabled: false,
  aiInlineCompletionEnabled: false,
  aiAgentOmittedSummaryEnabled: false,
  aiProvider: null,
  aiModel: null,
  aiTemperature: 0.7,
  aiMaxTokens: 4096,
  aiStreamingEnabled: true,
  aiSystemPrompt: 'You are a helpful research assistant in Lattice, a scientific workbench. Be concise and precise.',
  aiChatSystemPrompt: null,
  aiAgentSystemPrompt: null,
  aiPanelOpen: false,
  aiPanelWidth: 28,
  vscodeCompatEnabled: false,
};

export const SETTINGS_STORAGE_KEY = 'lattice-settings';
