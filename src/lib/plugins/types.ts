import type { LatticeAnnotation } from '@/types/annotation';

// ============================================================================
// Permissions
// ============================================================================

export type PluginPermission =
  | 'file:read'
  | 'file:write'
  | 'annotations:read'
  | 'annotations:write'
  | 'network'
  | 'ui:commands'
  | 'ui:panels'
  | 'ui:sidebar'
  | 'ui:toolbar'
  | 'ui:statusbar'
  | 'editor:extensions'
  | 'themes'
  | 'storage';

// ============================================================================
// Engine & Panel Schema
// ============================================================================

export interface PluginEngineInfo {
  lattice?: string;
  obsidian?: string;
  zotero?: string;
}

export interface PluginPanelSchema {
  type: 'form' | 'list' | 'table' | 'markdown' | 'custom';
  title?: string;
  description?: string;
  props?: Record<string, unknown>;
}

export interface PluginPanel {
  id: string;
  title: string;
  icon?: string;
  schema: PluginPanelSchema;
  actions?: Array<{
    id: string;
    title: string;
  }>;
}

// ============================================================================
// UI Extension Points
// ============================================================================

export interface PluginSidebarItem {
  id: string;
  title: string;
  icon: string;
  position?: 'top' | 'bottom';
  render: () => { type: string; props: Record<string, unknown> };
}

export interface PluginToolbarItem {
  id: string;
  title: string;
  icon: string;
  group?: string;
  run: () => void | Promise<void>;
}

export interface PluginStatusBarItem {
  id: string;
  text: string;
  tooltip?: string;
  position?: 'left' | 'right';
  onClick?: () => void;
}

// ============================================================================
// Workspace Events
// ============================================================================

export interface PluginWorkspaceEvents {
  onFileOpen: (callback: (filePath: string) => void) => () => void;
  onFileSave: (callback: (filePath: string) => void) => () => void;
  onFileClose: (callback: (filePath: string) => void) => () => void;
  onWorkspaceOpen: (callback: (rootPath: string) => void) => () => void;
  onActiveFileChange: (callback: (filePath: string | null) => void) => () => void;
}

// ============================================================================
// Plugin Settings
// ============================================================================

export interface PluginSettingField {
  id: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  label: string;
  description?: string;
  default?: unknown;
  options?: Array<{ label: string; value: string }>;
}

export interface PluginSettingsAPI {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => Promise<void>;
  onChange: (key: string, callback: (value: unknown) => void) => () => void;
}

// TYPES_CONTINUE_1

// ============================================================================
// Assets & Storage
// ============================================================================

export interface PluginAssetsAPI {
  getUrl: (path: string) => Promise<string>;
  readText: (path: string) => Promise<string>;
}

export interface PluginStorage {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

// ============================================================================
// Manifest
// ============================================================================

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  minAppVersion?: string;
  engines?: PluginEngineInfo;
  permissions?: PluginPermission[];
  main?: string;
  settings?: PluginSettingField[];
  dependencies?: Record<string, string>;
  ui?: {
    panels?: PluginPanel[];
  };
}

// ============================================================================
// Commands
// ============================================================================

export interface PluginCommand {
  id: string;
  title: string;
  shortcut?: string;
  run: (payload?: unknown) => void | Promise<void>;
}

// TYPES_CONTINUE_2

// ============================================================================
// Workspace & Obsidian Compat
// ============================================================================

export interface PluginWorkspaceAPI {
  listFiles: () => Promise<string[]>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
}

export interface ObsidianVaultCompat {
  getFiles: () => Promise<string[]>;
  getMarkdownFiles: () => Promise<string[]>;
  read: (path: string) => Promise<string>;
  modify: (path: string, content: string) => Promise<void>;
  create: (path: string, content: string) => Promise<void>;
  delete: (path: string) => Promise<void>;
  rename: (path: string, newPath: string) => Promise<void>;
  onChange: (callback: (path: string) => void) => () => void;
  onRename: (callback: (oldPath: string, newPath: string) => void) => () => void;
  onDelete: (callback: (path: string) => void) => () => void;
}

export interface ObsidianWorkspaceCompat {
  getActiveFile: () => Promise<string | null>;
  onActiveFileChange: (callback: (path: string | null) => void) => () => void;
}

export interface ObsidianCompat {
  app: {
    vault: ObsidianVaultCompat;
    workspace: ObsidianWorkspaceCompat;
  };
}

export interface PluginAnnotationsAPI {
  resolveFileId: (filePath: string) => Promise<string>;
  list: (options?: { fileId?: string; filePath?: string }) => Promise<LatticeAnnotation[]>;
  add: (annotation: LatticeAnnotation) => Promise<void>;
  update: (
    id: string,
    updates: Partial<Omit<LatticeAnnotation, 'id' | 'fileId'>>
  ) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

// TYPES_CONTINUE_3

// ============================================================================
// Plugin Context (extended)
// ============================================================================

export interface PluginContext {
  app: {
    platform: 'web' | 'desktop';
  };
  log: (...args: unknown[]) => void;
  obsidian?: ObsidianCompat;
  registerCommand: (command: PluginCommand) => void;
  commands: {
    register: (command: PluginCommand) => void;
  };
  panels: {
    register: (panel: PluginPanel) => void;
  };
  sidebar: {
    register: (item: PluginSidebarItem) => void;
  };
  toolbar: {
    register: (item: PluginToolbarItem) => void;
  };
  statusBar: {
    register: (item: PluginStatusBarItem) => void;
  };
  events: PluginWorkspaceEvents;
  settings: PluginSettingsAPI;
  assets: PluginAssetsAPI;
  storage: PluginStorage;
  workspace: PluginWorkspaceAPI;
  annotations: PluginAnnotationsAPI;
}

// ============================================================================
// Plugin Module
// ============================================================================

export interface PluginModule {
  manifest: PluginManifest;
  activate: (ctx: PluginContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}
