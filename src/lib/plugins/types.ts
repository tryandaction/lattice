import type { LatticeAnnotation } from '@/types/annotation';

// ============================================================================
// Permissions
// ============================================================================

export type PluginPermission =
  | 'read-current-document'
  | 'read-workspace-file'
  | 'clipboard-write'
  | 'export-file'
  | 'use-ocr'
  | 'use-ai'
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
// MetadataCache (Obsidian-compatible)
// ============================================================================

export interface CachedHeading {
  heading: string;
  level: number;
  position: { start: { line: number; col: number }; end: { line: number; col: number } };
}

export interface CachedLink {
  link: string;
  displayText?: string;
  position: { start: { line: number; col: number }; end: { line: number; col: number } };
}

export interface CachedTag {
  tag: string;
  position: { start: { line: number; col: number }; end: { line: number; col: number } };
}

export interface CachedFileMetadata {
  headings?: CachedHeading[];
  links?: CachedLink[];
  tags?: CachedTag[];
  frontmatter?: Record<string, unknown>;
}

export interface MetadataCacheAPI {
  getFileCache: (path: string) => Promise<CachedFileMetadata | null>;
}

// ============================================================================
// Notice / Modal / Setting APIs (Obsidian-compatible)
// ============================================================================

export interface NoticeAPI {
  show: (message: string, duration?: number) => void;
}

export interface ModalAPI {
  open: (options: {
    title: string;
    content: string | HTMLElement;
    buttons?: Array<{ label: string; action: () => void; variant?: 'default' | 'destructive' }>;
  }) => void;
}

export interface SettingBuilderAPI {
  addText: (opts: { name: string; desc?: string; value: string; onChange: (v: string) => void }) => SettingBuilderAPI;
  addToggle: (opts: { name: string; desc?: string; value: boolean; onChange: (v: boolean) => void }) => SettingBuilderAPI;
  addDropdown: (opts: { name: string; desc?: string; value: string; options: Record<string, string>; onChange: (v: string) => void }) => SettingBuilderAPI;
}

// ============================================================================
// Editor Extension API
// ============================================================================

export interface EditorExtensionAPI {
  registerExtension: (id: string, extension: unknown) => void;
  unregisterExtension: (id: string) => void;
}

// ============================================================================
// Theme API
// ============================================================================

export interface ThemeAPI {
  register: (id: string, css: string) => void;
  unregister: (id: string) => void;
  setActive: (id: string | null) => void;
}

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
  category?: string;
  entry?: string;
  minAppVersion?: string;
  engines?: PluginEngineInfo;
  permissions?: PluginPermission[];
  activationEvents?: string[];
  contributes?: {
    commands?: Array<Omit<PluginCommand, 'run'>>;
    panels?: PluginPanel[];
    sidebar?: Array<Omit<PluginSidebarItem, 'render'>>;
    toolbar?: Array<Omit<PluginToolbarItem, 'run'>>;
    fileActions?: Array<Omit<PluginCommand, 'run'>>;
    selectionActions?: Array<Omit<PluginCommand, 'run'>>;
    rendererContextActions?: Array<Omit<PluginCommand, 'run'>>;
    workspaceTools?: Array<Omit<PluginCommand, 'run'>>;
    settings?: PluginSettingField[];
  };
  recommended?: boolean;
  defaultEnabled?: boolean;
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

export type PluginViewerType = 'pdf' | 'docx' | 'md' | 'html' | 'unknown';

export interface PluginActiveDocumentInfo {
  filePath: string | null;
  fileName: string | null;
  viewerType: PluginViewerType;
  paneId?: string | null;
  tabId?: string | null;
}

export interface PluginDocumentContent {
  info: PluginActiveDocumentInfo;
  text?: string;
  arrayBuffer?: ArrayBuffer;
}

export interface PluginPdfTextPage {
  pageNumber: number;
  text: string;
  visible: boolean;
  source: 'pdfjs-text-model' | 'rendered-text-layer' | 'unknown';
  items?: Array<{
    text: string;
    normalizedText: string;
    bbox?: { x1: number; y1: number; x2: number; y2: number };
    lineIndex?: number;
    blockIndex?: number;
  }>;
}

export interface PluginDocumentAPI {
  getActive: () => Promise<PluginActiveDocumentInfo>;
  getViewerType: () => Promise<PluginViewerType>;
  getSelectionText: () => Promise<string>;
  readCurrent: () => Promise<PluginDocumentContent>;
  getPdfTextPages: (options?: { scope?: 'visible' | 'current-page' | 'all' }) => Promise<PluginPdfTextPage[]>;
}

export interface PluginUiAPI {
  openPanel: (panelId?: string) => Promise<void>;
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
    update: (panelId: string, props: Record<string, unknown>) => void;
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
  document: PluginDocumentAPI;
  ui: PluginUiAPI;
  clipboard: {
    writeText: (text: string) => Promise<void>;
  };
  exportFile: (options: { suggestedName: string; content: string; mimeType?: string }) => Promise<boolean>;
  settings: PluginSettingsAPI;
  assets: PluginAssetsAPI;
  storage: PluginStorage;
  workspace: PluginWorkspaceAPI;
  annotations: PluginAnnotationsAPI;
  metadataCache: MetadataCacheAPI;
  notice: NoticeAPI;
  modal: ModalAPI;
  editor: EditorExtensionAPI;
  themes: ThemeAPI;
}

// ============================================================================
// Plugin Module
// ============================================================================

export interface PluginModule {
  manifest: PluginManifest;
  activate: (ctx: PluginContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}
