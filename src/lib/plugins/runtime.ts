import { isTauri } from '@/lib/storage-adapter';
import {t} from '@/lib/i18n';
import { getPluginModule } from './registry';
import { loadStoredPlugin, loadStoredPluginResource, type StoredPlugin } from './repository';
import { PluginWorkerHost } from './worker-host';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useAnnotationStore } from '@/stores/annotation-store';
import { deriveFileId } from '@/lib/annotation-storage';
import { useSettingsStore } from '@/stores/settings-store';
import { extractMarkdownDocument } from '@/lib/markdown/extract';
import { getPdfPageTextModel } from '@/lib/pdf-page-text-cache';
import { buildPluginPdfTextPage, readPaintedFormulaRules, selectPluginPdfRegion } from './pdf-geometry';
import { getActivePdfSelectionImage } from '@/lib/pdf-selection-image-provider';
import { loadPdfJsDocument } from '@/lib/pdf-js-document-loader';
import { isFileTabState } from '@/types/layout';
import { readFileSourceRevision } from '@/lib/file-source-revision';
import { withTimeout } from '@/lib/async-task-guard';
import type {
  PluginCommand,
  PluginContext,
  PluginManifest,
  PluginModule,
  PluginPanel,
  PluginDocumentRevealTarget,
  PluginPdfTextPage,
  PluginPdfTextOptions,
  PluginPdfSelectionImageOptions,
  PluginActiveDocumentInfo,
  PluginPermission,
  PluginViewerType,
  CachedFileMetadata,
  CachedHeading,
  CachedLink,
  CachedTag,
} from './types';
import type { LatticeAnnotation } from '@/types/annotation';

type RegisteredCommand = { command: PluginCommand; pluginId: string };
type RegisteredPanel = { panel: PluginPanel; pluginId: string };

const activePlugins = new Map<string, PluginModule>();
const activeWorkers = new Map<string, PluginWorkerHost>();
const pluginDisposers = new Map<string, Set<() => void>>();
const pluginControllers = new Map<string, AbortController>();

function trackPluginDisposer(pluginId:string,dispose:()=>void):()=>void {
  const entries=pluginDisposers.get(pluginId)??new Set<()=>void>();
  let active=true;
  const cleanup=()=>{if(!active)return;active=false;entries.delete(cleanup);dispose();};
  entries.add(cleanup);pluginDisposers.set(pluginId,entries);
  return cleanup;
}

function cleanupPluginResources(pluginId:string) {
  pluginControllers.get(pluginId)?.abort();pluginControllers.delete(pluginId);
  for(const dispose of pluginDisposers.get(pluginId)??[]) {try{dispose();}catch(error){recordPluginAudit({pluginId,level:'warn',action:'cleanup',message:String(error)});}}
  pluginDisposers.delete(pluginId);
  const prefix=`${pluginId}:`;
  for(const key of editorExtensions.keys())if(key.startsWith(prefix))editorExtensions.delete(key);
  for(const [key,style] of themeStyles)if(key.startsWith(prefix)){style.remove();themeStyles.delete(key);if(activeThemeId===key)activeThemeId=null;}
  for(const listener of editorExtensionListeners){try{listener();}catch{/* isolated */}}
  for(const listener of themeChangeListeners){try{listener();}catch{/* isolated */}}
  revokeAssetUrls(pluginId);unregisterCommandsFor(pluginId);unregisterPanelsFor(pluginId);unregisterUIItemsFor(pluginId);
}
const commands = new Map<string, RegisteredCommand>();
const panels = new Map<string, RegisteredPanel>();
// Live panel props — updated by plugins via ctx.panels.update()
const panelProps = new Map<string, Record<string, unknown>>();
const EMPTY_PANEL_PROPS: Record<string, unknown> = {};

const panelPropsListeners = new Set<() => void>();
const assetUrls = new Map<string, Set<string>>();
const assetImageUrls = new Map<string, Set<string>>();
const registryListeners = new Set<() => void>();
let registryEmitScheduled = false;
const healthListeners = new Set<() => void>();
const pluginHealth = new Map<string, PluginHealth>();
const auditListeners = new Set<() => void>();
const auditLog: PluginAuditEvent[] = [];
const MAX_AUDIT_ENTRIES = 200;
let auditSeq = 0;
const vaultChangeListeners = new Set<(path: string) => void>();
const vaultRenameListeners = new Set<(oldPath: string, newPath: string) => void>();
const vaultDeleteListeners = new Set<(path: string) => void>();

// Workspace event listeners (new extension points)
const fileOpenListeners = new Set<(path: string) => void>();
const fileSaveListeners = new Set<(path: string) => void>();
const fileCloseListeners = new Set<(path: string) => void>();
const workspaceOpenListeners = new Set<(rootPath: string) => void>();
const activeFileChangeListeners = new Set<(path: string | null) => void>();

// UI extension registries
const sidebarItems = new Map<string, import('./types').PluginSidebarItem>();
const toolbarItems = new Map<string, import('./types').PluginToolbarItem>();
const statusBarItems = new Map<string, import('./types').PluginStatusBarItem>();
const sidebarChangeListeners = new Set<() => void>();
const toolbarChangeListeners = new Set<() => void>();
const statusBarChangeListeners = new Set<() => void>();
let sidebarItemsSnapshot: import('./types').PluginSidebarItem[] = [];
let toolbarItemsSnapshot: import('./types').PluginToolbarItem[] = [];
let statusBarItemsSnapshot: import('./types').PluginStatusBarItem[] = [];

function areSnapshotsEqual<T>(
  prev: T[],
  next: T[],
  isSame: (a: T, b: T) => boolean
): boolean {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (a === b) continue;
    if (!isSame(a, b)) return false;
  }
  return true;
}

function isSameSidebarItem(
  a: import('./types').PluginSidebarItem,
  b: import('./types').PluginSidebarItem
): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.icon === b.icon &&
    a.position === b.position &&
    a.render === b.render
  );
}

function isSameToolbarItem(
  a: import('./types').PluginToolbarItem,
  b: import('./types').PluginToolbarItem
): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.icon === b.icon &&
    a.group === b.group &&
    a.run === b.run
  );
}

function isSameStatusBarItem(
  a: import('./types').PluginStatusBarItem,
  b: import('./types').PluginStatusBarItem
): boolean {
  return (
    a.id === b.id &&
    a.text === b.text &&
    a.tooltip === b.tooltip &&
    a.position === b.position &&
    a.onClick === b.onClick
  );
}

function refreshSidebarSnapshot() {
  const next = Array.from(sidebarItems.values());
  if (areSnapshotsEqual(sidebarItemsSnapshot, next, isSameSidebarItem)) return;
  sidebarItemsSnapshot = next;
}

function refreshToolbarSnapshot() {
  const next = Array.from(toolbarItems.values());
  if (areSnapshotsEqual(toolbarItemsSnapshot, next, isSameToolbarItem)) return;
  toolbarItemsSnapshot = next;
}

function refreshStatusBarSnapshot() {
  const next = Array.from(statusBarItems.values());
  if (areSnapshotsEqual(statusBarItemsSnapshot, next, isSameStatusBarItem)) return;
  statusBarItemsSnapshot = next;
}

// Plugin settings change listeners
const settingsChangeListeners = new Map<string, Set<(value: unknown) => void>>();

// Plugin KV storage — Tauri uses plugin-store, web uses localStorage
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pluginKvStore: any = null;
let pluginKvStoreLoaded = false;

async function getPluginKvStore() {
  if (pluginKvStoreLoaded) return pluginKvStore;
  pluginKvStoreLoaded = true;
  if (isTauri()) {
    try {
      const { Store } = await import('@tauri-apps/plugin-store');
      pluginKvStore = await Store.load('plugin-settings.json');
    } catch { /* fallback to localStorage */ }
  }
  return pluginKvStore;
}

function pluginKvGet(key: string): unknown {
  const raw = localStorage.getItem(key);
  if (raw === null) return undefined;
  try { return JSON.parse(raw); } catch { return raw; }
}

async function pluginKvSet(key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  localStorage.setItem(key, json);
  const store = await getPluginKvStore();
  if (store) {
    try {
      await store.set(key, json);
      await store.save();
    } catch { /* fallback already in localStorage */ }
  }
}

// Editor extension registry (for plugins to inject CodeMirror extensions)
const editorExtensions = new Map<string, unknown>();
const editorExtensionListeners = new Set<() => void>();

// Theme registry
const themeStyles = new Map<string, HTMLStyleElement>();
let activeThemeId: string | null = null;
const themeChangeListeners = new Set<() => void>();

// Modal state (simple global modal queue)
let modalHandler: ((opts: { title: string; content: string | HTMLElement; buttons?: Array<{ label: string; action: () => void; variant?: 'default' | 'destructive' }> }) => void) | null = null;

export type PluginHealth = {
  status: 'inactive' | 'active' | 'error';
  lastError?: string;
  lastErrorAt?: number;
};

export type PluginAuditEvent = {
  id: string;
  pluginId: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  action: string;
  message: string;
  data?: Record<string, unknown>;
};

function resolveAnnotationFileId(options?: { fileId?: string; filePath?: string }): string | null {
  if (!options) return null;
  if (typeof options.fileId === 'string' && options.fileId.length > 0) return options.fileId;
  if (typeof options.filePath === 'string' && options.filePath.length > 0) {
    return deriveFileId(options.filePath);
  }
  return null;
}

function emitRegistryChange() {
  if (registryEmitScheduled) return;
  registryEmitScheduled = true;
  const flush = () => {
    registryEmitScheduled = false;
    for (const listener of registryListeners) {
      try {
        listener();
      } catch (error) {
        console.warn('Plugin registry listener failed:', error);
      }
    }
  };
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(flush);
  } else {
    Promise.resolve().then(flush);
  }
}

function emitHealthChange() {
  for (const listener of healthListeners) {
    try {
      listener();
    } catch (error) {
      console.warn('Plugin health listener failed:', error);
    }
  }
}

function emitAuditChange() {
  for (const listener of auditListeners) {
    try {
      listener();
    } catch (error) {
      console.warn('Plugin audit listener failed:', error);
    }
  }
}

function recordPluginAudit(event: Omit<PluginAuditEvent, 'id' | 'timestamp'> & { timestamp?: number }) {
  const timestamp = event.timestamp ?? Date.now();
  const entry: PluginAuditEvent = {
    ...event,
    timestamp,
    id: `${timestamp}-${auditSeq++}`,
  };
  auditLog.unshift(entry);
  if (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.length = MAX_AUDIT_ENTRIES;
  }
  emitAuditChange();
}

function trackAssetUrl(pluginId: string, url: string) {
  const bucket = assetUrls.get(pluginId) ?? new Set<string>();
  bucket.add(url);
  assetUrls.set(pluginId, bucket);
}

function revokeAssetUrls(pluginId: string) {
  const urls = assetUrls.get(pluginId);
  if (!urls) return;
  for (const url of urls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }
  assetUrls.delete(pluginId);
  assetImageUrls.delete(pluginId);
}

async function getPluginAssetUrl(pluginId: string, path: string): Promise<string> {
  const resource = await loadStoredPluginResource(pluginId, path);
  if (!resource) {
    throw new Error('Plugin asset not found');
  }
  const safeBuffer = new Uint8Array(resource.bytes).buffer;
  const blob = new Blob([safeBuffer], { type: resource.mimeType });
  const url = URL.createObjectURL(blob);
  trackAssetUrl(pluginId, url);
  if (resource.mimeType.startsWith('image/')) {
    const images = assetImageUrls.get(pluginId) ?? new Set<string>();
    images.add(url);
    assetImageUrls.set(pluginId, images);
  }
  return url;
}

/** Only live image resources belonging to this registered panel's plugin. */
export function isPanelAssetImageUrlAllowed(panelId: string, url: string): boolean {
  const owner = panels.get(panelId)?.pluginId;
  return Boolean(owner && assetImageUrls.get(owner)?.has(url));
}

async function readPluginAssetText(pluginId: string, path: string): Promise<string> {
  const resource = await loadStoredPluginResource(pluginId, path);
  if (!resource) {
    throw new Error('Plugin asset not found');
  }
  const decoder = new TextDecoder();
  return decoder.decode(resource.bytes);
}

function setPluginHealth(pluginId: string, next: Partial<PluginHealth>) {
  const prev = pluginHealth.get(pluginId) ?? { status: 'inactive' };
  pluginHealth.set(pluginId, { ...prev, ...next });
  emitHealthChange();
}

export function subscribePluginHealth(listener: () => void) {
  healthListeners.add(listener);
  return () => {
    healthListeners.delete(listener);
  };
}

export function getPluginHealthSnapshot(): Record<string, PluginHealth> {
  return Object.fromEntries(pluginHealth.entries());
}

export function subscribePluginAudit(listener: () => void) {
  auditListeners.add(listener);
  return () => {
    auditListeners.delete(listener);
  };
}

export function getPluginAuditLog(): PluginAuditEvent[] {
  return auditLog.slice();
}

export function getPluginSetting(pluginId: string, key: string): unknown {
  return pluginKvGet(`lattice-plugin-kv:${pluginId}:setting:${key}`);
}

export async function setPluginSetting(pluginId: string, key: string, value: unknown): Promise<void> {
  await pluginKvSet(`lattice-plugin-kv:${pluginId}:setting:${key}`, value);
  const listeners = settingsChangeListeners.get(`${pluginId}:${key}`);
  for (const listener of listeners ?? []) {
    try { listener(value); } catch { /* plugin setting listeners are isolated */ }
  }
}

export function subscribePluginSetting(pluginId: string, key: string, listener: (value: unknown) => void): () => void {
  const fullKey = `${pluginId}:${key}`;
  const listeners = settingsChangeListeners.get(fullKey) ?? new Set<(value: unknown) => void>();
  listeners.add(listener);
  settingsChangeListeners.set(fullKey, listeners);
  return () => {listeners.delete(listener);if(!listeners.size)settingsChangeListeners.delete(fullKey);};
}

export function clearPluginAuditLog(): void {
  auditLog.length = 0;
  emitAuditChange();
}

export function subscribePluginRegistry(listener: () => void) {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

export function getPanelProps(panelId: string): Record<string, unknown> {
  return panelProps.get(panelId) ?? EMPTY_PANEL_PROPS;
}

export function subscribePanelProps(listener: () => void): () => void {
  panelPropsListeners.add(listener);
  return () => panelPropsListeners.delete(listener);
}

function updatePanelProps(panelId: string, props: Record<string, unknown>) {
  panelProps.set(panelId, { ...(panelProps.get(panelId) ?? {}), ...props });
  for (const l of panelPropsListeners) { try { l(); } catch { /* */ } }
}

export function subscribeVaultChange(listener: (path: string) => void) {
  vaultChangeListeners.add(listener);
  return () => {
    vaultChangeListeners.delete(listener);
  };
}

export function subscribeVaultRename(listener: (oldPath: string, newPath: string) => void) {
  vaultRenameListeners.add(listener);
  return () => {
    vaultRenameListeners.delete(listener);
  };
}

export function subscribeVaultDelete(listener: (path: string) => void) {
  vaultDeleteListeners.add(listener);
  return () => {
    vaultDeleteListeners.delete(listener);
  };
}

export function emitVaultChange(path: string) {
  for (const listener of vaultChangeListeners) {
    try {
      listener(path);
    } catch (error) {
      console.warn('Vault change listener failed:', error);
    }
  }
  for (const host of activeWorkers.values()) {
    host.emitEvent({ type: 'vault-change', path });
  }
}

export function emitVaultRename(oldPath: string, newPath: string) {
  for (const listener of vaultRenameListeners) {
    try {
      listener(oldPath, newPath);
    } catch (error) {
      console.warn('Vault rename listener failed:', error);
    }
  }
  for (const host of activeWorkers.values()) {
    host.emitEvent({ type: 'vault-rename', path: oldPath, newPath });
  }
}

export function emitVaultDelete(path: string) {
  for (const listener of vaultDeleteListeners) {
    try {
      listener(path);
    } catch (error) {
      console.warn('Vault delete listener failed:', error);
    }
  }
  for (const host of activeWorkers.values()) {
    host.emitEvent({ type: 'vault-delete', path });
  }
}

// ============================================================================
// Workspace Event Emitters (new)
// ============================================================================

export function emitFileOpen(path: string) {
  for (const listener of fileOpenListeners) {
    try { listener(path); } catch { /* ignore */ }
  }
}

export function emitFileSave(path: string) {
  for (const listener of fileSaveListeners) {
    try { listener(path); } catch { /* ignore */ }
  }
}

export function emitFileClose(path: string) {
  for (const listener of fileCloseListeners) {
    try { listener(path); } catch { /* ignore */ }
  }
}

export function emitWorkspaceOpen(rootPath: string) {
  for (const listener of workspaceOpenListeners) {
    try { listener(rootPath); } catch { /* ignore */ }
  }
}

export function emitActiveFileChange(path: string | null) {
  for (const listener of activeFileChangeListeners) {
    try { listener(path); } catch { /* ignore */ }
  }
}

// ============================================================================
// UI Extension Getters (for slot components)
// ============================================================================

export function getSidebarItems(): import('./types').PluginSidebarItem[] {
  return sidebarItemsSnapshot;
}

export function getToolbarItems(): import('./types').PluginToolbarItem[] {
  return toolbarItemsSnapshot;
}

export function getStatusBarItems(): import('./types').PluginStatusBarItem[] {
  return statusBarItemsSnapshot;
}

export function onSidebarChange(listener: () => void): () => void {
  sidebarChangeListeners.add(listener);
  return () => sidebarChangeListeners.delete(listener);
}

export function onToolbarChange(listener: () => void): () => void {
  toolbarChangeListeners.add(listener);
  return () => toolbarChangeListeners.delete(listener);
}

export function onStatusBarChange(listener: () => void): () => void {
  statusBarChangeListeners.add(listener);
  return () => statusBarChangeListeners.delete(listener);
}

function registerCommand(
  pluginId: string,
  command: PluginCommand,
  runner?: (payload?: unknown) => void | Promise<void>
) {
  if (!command?.id) return;
  const run = runner ?? command.run ?? (() => {});
  commands.set(command.id, { command: { ...command, run }, pluginId });
  emitRegistryChange();
}

function unregisterCommandsFor(pluginId: string) {
  let changed = false;
  for (const [id, entry] of commands.entries()) {
    if (entry.pluginId === pluginId) {
      commands.delete(id);
      changed = true;
    }
  }
  if (changed) {
    emitRegistryChange();
  }
}

function registerPanel(pluginId: string, panel: PluginPanel) {
  if (!panel?.id) return;
  panels.set(panel.id, { panel, pluginId });
  emitRegistryChange();
}

function registerManifestPanels(manifest: PluginManifest, permissions: PluginPermission[]) {
  if (!permissions.includes('ui:panels')) return;
  const defined = [
    ...(manifest.ui?.panels ?? []),
    ...(manifest.contributes?.panels ?? []),
  ];
  for (const panel of defined) {
    registerPanel(manifest.id, panel);
  }
}
function unregisterPanelsFor(pluginId: string) {
  let changed = false;
  for (const [id, entry] of panels.entries()) {
    if (entry.pluginId === pluginId) {
      panels.delete(id);
      panelProps.delete(id);
      changed = true;
    }
  }
  if (changed) {
    emitRegistryChange();
  }
}

function unregisterUIItemsFor(pluginId: string) {
  const prefix = `${pluginId}:`;
  let sidebarChanged = false;
  let toolbarChanged = false;
  let statusBarChanged = false;
  for (const key of sidebarItems.keys()) {
    if (key.startsWith(prefix)) { sidebarItems.delete(key); sidebarChanged = true; }
  }
  for (const key of toolbarItems.keys()) {
    if (key.startsWith(prefix)) { toolbarItems.delete(key); toolbarChanged = true; }
  }
  for (const key of statusBarItems.keys()) {
    if (key.startsWith(prefix)) { statusBarItems.delete(key); statusBarChanged = true; }
  }
  if (sidebarChanged) {
    refreshSidebarSnapshot();
    for (const l of sidebarChangeListeners) { try { l(); } catch { /* */ } }
  }
  if (toolbarChanged) {
    refreshToolbarSnapshot();
    for (const l of toolbarChangeListeners) { try { l(); } catch { /* */ } }
  }
  if (statusBarChanged) {
    refreshStatusBarSnapshot();
    for (const l of statusBarChangeListeners) { try { l(); } catch { /* */ } }
  }
  // Clean up settings change listeners for this plugin
  for (const key of settingsChangeListeners.keys()) {
    if (key.startsWith(prefix) && !settingsChangeListeners.get(key)?.size) settingsChangeListeners.delete(key);
  }
}

function hasPermission(permissions: PluginPermission[], permission: PluginPermission): boolean {
  return permissions.includes(permission);
}

function canReadCurrentDocument(permissions: PluginPermission[]): boolean {
  return hasPermission(permissions, 'read-current-document') || hasPermission(permissions, 'file:read');
}

function canReadWorkspaceFile(permissions: PluginPermission[]): boolean {
  return hasPermission(permissions, 'read-workspace-file') || hasPermission(permissions, 'file:read');
}

function canWriteClipboard(permissions: PluginPermission[]): boolean {
  return hasPermission(permissions, 'clipboard-write');
}

function canExportFile(permissions: PluginPermission[]): boolean {
  return hasPermission(permissions, 'export-file') || hasPermission(permissions, 'file:write');
}

function denyPluginPermission(pluginId: string, permission: PluginPermission, action: string): never {
  recordPluginAudit({
    pluginId,
    level: 'warn',
    action: 'permission-denied',
    message: `Permission denied: ${permission}`,
    data: { permission, request: action },
  });
  throw new Error(`Permission denied: ${permission}`);
}

function assertPluginPermission(
  pluginId: string,
  permissions: PluginPermission[],
  permission: PluginPermission,
  action: string,
): void {
  if (!permissions.includes(permission)) {
    denyPluginPermission(pluginId, permission, action);
  }
}

export const __pluginRuntimeTest = {
  assertPluginPermission,
  exportPluginFile: (options: { suggestedName: string; content: string; mimeType?: string }, permissions: PluginPermission[]) => exportPluginFile(options, permissions),
  findPdfPageElement: (pageNumber: number, paneId: string | null) => findPdfPageElement(pageNumber, paneId),
  findPluginPaneRoot: (paneId: string | null) => findPluginPaneRoot(paneId),
  capturePdfSelectionImage: (options?: PluginPdfSelectionImageOptions) => capturePdfSelectionImage(options),
};

function getViewerTypeFromPath(path: string | null | undefined, fallbackName?: string | null): PluginViewerType {
  const lower = `${path ?? ''} ${fallbackName ?? ''}`.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'docx';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'md';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  return 'unknown';
}

function getActiveDocumentInfo() {
  const state = useWorkspaceStore.getState();
  const pane = state.getActivePane();
  const tab = state.getActiveTab();
  return {
    filePath: tab?.filePath ?? null,
    fileName: tab?.fileName ?? null,
    viewerType: getViewerTypeFromPath(tab?.filePath, tab?.fileName),
    paneId: pane?.id ?? null,
    tabId: tab?.id ?? null,
  };
}

function samePdfDocument(left: PluginActiveDocumentInfo, right: PluginActiveDocumentInfo): boolean {
  return left.viewerType === 'pdf' && right.viewerType === 'pdf' && left.filePath === right.filePath
    && left.paneId === right.paneId && left.tabId === right.tabId
    && (!left.revision || !right.revision || left.revision === right.revision);
}

async function capturePdfSelectionImage(options: PluginPdfSelectionImageOptions = {}) {
  options.signal?.throwIfAborted();
  const active = getActiveDocumentInfo();
  const tab = useWorkspaceStore.getState().getActiveTab();
  if (active.viewerType !== 'pdf' || options.expectedDocument && !samePdfDocument(options.expectedDocument, active)) {
    throw new Error(t('formula.region.sourceChanged'));
  }
  const readRevision = async () => {
    if (!tab || !isFileTabState(tab)) return undefined;
    return readFileSourceRevision(tab.fileHandle, options.signal);
  };
  const revision = await readRevision();
  const captured = { ...active, revision };
  const check = () => {
    options.signal?.throwIfAborted();
    if (useWorkspaceStore.getState().getActiveTab() !== tab || !samePdfDocument(captured, getActiveDocumentInfo())) {
      throw new Error(t('formula.region.sourceChanged'));
    }
  };
  check();
  if (options.expectedDocument && !samePdfDocument(options.expectedDocument, captured)) throw new Error(t('formula.region.sourceChanged'));
  const image = await getActivePdfSelectionImage({ signal: options.signal, expectedDocument: captured });
  check();
  if (await readRevision() !== revision) throw new Error(t('formula.region.sourceChanged'));
  check();
  return image;
}

function getCurrentSelectionText(): string {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') {
    return '';
  }
  return window.getSelection()?.toString().trim() ?? '';
}

async function readCurrentDocumentContent(permissions: PluginPermission[]) {
  if (!canReadCurrentDocument(permissions)) {
    throw new Error('Permission denied');
  }
  const tab = useWorkspaceStore.getState().getActiveTab();
  const info = getActiveDocumentInfo();
  if (!tab || !isFileTabState(tab)) {
    return { info };
  }
  const file = await tab.fileHandle.getFile();
  const viewerType = info.viewerType;
  if (viewerType === 'docx' || viewerType === 'pdf') {
    return {
      info,
      arrayBuffer: await file.arrayBuffer(),
    };
  }
  return {
    info,
    text: await file.text(),
  };
}

function getRenderedPdfPageElements() {
  if (typeof document === 'undefined') return [];
  const active = getActiveDocumentInfo();
  const containers = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="pdf-viewer-container-"]'));
  const container = containers.find(element => element.dataset.filePath === active.filePath || element.dataset.tabId === active.tabId)
    ?? containers.find(element => element.getBoundingClientRect().width > 0) ?? document;
  return Array.from(container.querySelectorAll<HTMLElement>('[data-page-number]')).filter(element => element.querySelector('.textLayer'));
}

function getCurrentPdfPageNumber() {
  const elements = getRenderedPdfPageElements();
  const visible = elements.filter(element => element.dataset.pdfPageVisible === 'true' || element.dataset.pdfPageVisible === '1');
  const anchor = typeof window === 'undefined' ? 0 : window.innerHeight * .35;
  const element = (visible.length ? visible : elements).sort((a,b) => Math.abs(a.getBoundingClientRect().top-anchor)-Math.abs(b.getBoundingClientRect().top-anchor))[0];
  return Number(element?.dataset.pageNumber) || 1;
}

async function getPdfTextPagesFromDocumentModel(options: PluginPdfTextOptions = {}): Promise<PluginPdfTextPage[]> {
  options.signal?.throwIfAborted();
  const scope = options.scope ?? 'current-page';
  const selectedPage = options.selection?.pageNumber ?? getCurrentPdfPageNumber();
  const content = await readCurrentDocumentContent(['read-current-document']);
  if (!content.arrayBuffer) throw new Error('Open a PDF document before scanning.');
  const pdf = await loadPdfJsDocument({ data: content.arrayBuffer, label: 'formula-extractor-pdf-text', timeoutMs: 45000 });
  const cancel = () => { void pdf.destroy(); };
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const pageNumbers = scope === 'all' ? Array.from({length:pdf.numPages},(_,i)=>i+1)
      : scope === 'visible' ? getRenderedPdfPageElements().filter(element=>element.dataset.pdfPageVisible==='true').map(element=>Number(element.dataset.pageNumber)) : [selectedPage];
    if (!pageNumbers.length) pageNumbers.push(selectedPage);
    const pages: PluginPdfTextPage[] = [];
    for (const [index, number] of pageNumbers.entries()) {
      options.signal?.throwIfAborted();
      const model = await getPdfPageTextModel(pdf, number);
      const page = await pdf.getPage(number);
      let rules: import('@/lib/pdf-formula-structure').PdfFormulaGlyph[] = [];
      const warnings: string[] = [];
      try { rules = await readPaintedFormulaRules(page, model, options.signal); }
      catch(error) { options.signal?.throwIfAborted(); warnings.push('painted-rules-unavailable'); recordPluginAudit({pluginId:'formula-extractor',level:'warn',action:'pdf-rules',message:String(error)}); }
      let data:PluginPdfTextPage={ ...buildPluginPdfTextPage(model, rules), warnings, visible: number === selectedPage };
      if (scope === 'selection') {
        if (!options.selection) throw new Error('The PDF selection has expired. Select the formula region again.');
        data=selectPluginPdfRegion(data,options.selection.bbox);
      }
      pages.push(data);
      options.onProgress?.({ completed: index+1, total: pageNumbers.length });
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    options.signal?.throwIfAborted();
    return pages;
  } finally {
    options.signal?.removeEventListener('abort', cancel);
    await pdf.destroy();
  }
}

function escapeSelectorValue(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function findPluginPaneRoot(paneId: string | null): HTMLElement | Document {
  if (typeof document === 'undefined' || !paneId) return document;
  const escaped = escapeSelectorValue(paneId);
  return document.querySelector<HTMLElement>(`[data-testid="pdf-viewer-container-${escaped}"]`)
    ?? document.querySelector<HTMLElement>(`[data-pane-id="${escaped}"]`)
    ?? document.querySelector<HTMLElement>(`[data-testid="pane-wrapper-${escaped}"]`)
    ?? document;
}

function findPdfPageElement(pageNumber: number, paneId: string | null): HTMLElement | null {
  return findPluginPaneRoot(paneId).querySelector<HTMLElement>(`[data-page-number="${pageNumber}"]`);
}

function revealPdfTarget(target: PluginDocumentRevealTarget): boolean {
  if (typeof document === 'undefined') return false;
  const pageNumber = target.page;
  if (!Number.isInteger(pageNumber) || !pageNumber || pageNumber < 1) return false;

  const active = getActiveDocumentInfo();
  const paneId = active.paneId ?? active.tabId ?? null;
  const pageElement = findPdfPageElement(pageNumber, paneId);
  if (!pageElement) return false;

  const scrollContainer = pageElement.closest<HTMLElement>('[data-testid^="pdf-viewer-container-"]')
    ?? pageElement.parentElement?.closest<HTMLElement>('.overflow-auto')
    ?? null;

  pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

  if (target.bbox) {
    pageElement.querySelectorAll<HTMLElement>('[data-plugin-reveal-highlight="true"]').forEach((element) => element.remove());
    const pageBox = pageElement.getBoundingClientRect();
    const highlight = document.createElement('div');
    const x1 = Math.max(0, Math.min(1, target.bbox.x1));
    const y1 = Math.max(0, Math.min(1, target.bbox.y1));
    const x2 = Math.max(x1, Math.min(1, target.bbox.x2));
    const y2 = Math.max(y1, Math.min(1, target.bbox.y2));
    highlight.dataset.pluginRevealHighlight = 'true';
    highlight.setAttribute('aria-hidden', 'true');
    highlight.style.position = 'absolute';
    highlight.style.pointerEvents = 'none';
    highlight.style.left = `${x1 * pageBox.width}px`;
    highlight.style.top = `${y1 * pageBox.height}px`;
    highlight.style.width = `${Math.max(8, (x2 - x1) * pageBox.width)}px`;
    highlight.style.height = `${Math.max(8, (y2 - y1) * pageBox.height)}px`;
    highlight.style.border = '2px solid rgba(14, 165, 233, 0.95)';
    highlight.style.background = 'rgba(14, 165, 233, 0.16)';
    highlight.style.borderRadius = '4px';
    highlight.style.boxShadow = '0 0 0 3px rgba(14, 165, 233, 0.12)';
    highlight.style.zIndex = '40';
    const previousPosition = pageElement.style.position;
    if (!previousPosition) {
      pageElement.style.position = 'relative';
    }
    pageElement.appendChild(highlight);
    window.setTimeout(() => {
      highlight.remove();
      if (!previousPosition && pageElement.isConnected) {
        pageElement.style.position = '';
      }
    }, 2600);
  }

  if (scrollContainer) {
    scrollContainer.dispatchEvent(new Event('scroll'));
  }
  return true;
}

function revealTextQuote(quote: string): boolean {
  if (typeof document === 'undefined') return false;
  const needle = quote.trim();
  if (!needle) return false;
  const active = getActiveDocumentInfo();
  const paneId = active.paneId ?? active.tabId ?? null;
  const scopedRoot = findPluginPaneRoot(paneId);
  const walker = document.createTreeWalker(scopedRoot === document ? document.body : scopedRoot, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const text = current.textContent ?? '';
    const element = current.parentElement;
    if (!element?.closest('[data-plugin-panel], [data-plugin-result], [role="dialog"]') && text.includes(needle)) {
      current.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    }
    current = walker.nextNode();
  }
  return false;
}

async function revealDocumentTarget(target: PluginDocumentRevealTarget, permissions: PluginPermission[]): Promise<boolean> {
  if (!canReadCurrentDocument(permissions)) {
    throw new Error('Permission denied');
  }
  const viewerType = target.viewerType ?? getActiveDocumentInfo().viewerType;
  if (viewerType === 'pdf' || target.page) {
    return revealPdfTarget(target);
  }
  if (target.quote) {
    return revealTextQuote(target.quote);
  }
  return false;
}

async function writeClipboardText(text: string, permissions: PluginPermission[]): Promise<void> {
  if (!canWriteClipboard(permissions)) {
    throw new Error('Permission denied');
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error('Clipboard API unavailable');
}

async function exportPluginFile(
  options: { suggestedName: string; content: string; mimeType?: string },
  permissions: PluginPermission[],
): Promise<boolean> {
  if (!canExportFile(permissions)) {
    throw new Error('Permission denied');
  }
  if (typeof window === 'undefined') return false;
  const picker = (window as Window & {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<FileSystemFileHandle>;
  }).showSaveFilePicker;
  const mimeType = options.mimeType ?? 'text/plain;charset=utf-8';
  const pickerMimeType = mimeType.split(';', 1)[0].trim() || 'text/plain';
  const extension = options.suggestedName.slice(options.suggestedName.lastIndexOf('.') || 0) || '.txt';
  if (picker) {
    const handle = await picker({
      suggestedName: options.suggestedName,
      types: [{ description: 'Export file', accept: { [pickerMimeType]: [extension] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(new Blob([options.content], { type: mimeType }));
    await writable.close();
    return true;
  }
  const blob = new Blob([options.content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = options.suggestedName;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}

function createContext(manifest: PluginManifest): PluginContext {
  const pluginId = manifest.id;
  const permissions = manifest.permissions ?? [];
  const canRegisterCommands = permissions.includes('ui:commands');
  const canRegisterPanels = permissions.includes('ui:panels');
  const canReadFiles = canReadWorkspaceFile(permissions);
  const canWriteFiles = permissions.includes('file:write');
  const workspaceListeners = new Set<(path: string | null) => void>();
  let subscription: { dispose: () => void } | null = null;
  const controller=new AbortController();pluginControllers.set(pluginId,controller);
  const track=(dispose:()=>void)=>trackPluginDisposer(pluginId,dispose);
  return {
    lifecycle:{signal:controller.signal,registerCleanup:track},
    app: {
      platform: isTauri() ? 'desktop' : 'web',
    },
    log: (...args: unknown[]) => {
      recordPluginAudit({
        pluginId,
        level: 'info',
        action: 'log',
        message: args.map((arg) => String(arg)).join(' '),
      });
    },
    obsidian: {
      app: {
        vault: {
          getFiles: async () => {
            if (!canReadFiles) return [];
            return await createContextFileList();
          },
          getMarkdownFiles: async () => {
            if (!canReadFiles) return [];
            const files = await createContextFileList();
            return files.filter((path) => path.toLowerCase().endsWith('.md'));
          },
          read: async (path) => {
            return await getWorkspaceReadFile(path, canReadFiles);
          },
          modify: async (path, content) => {
            await getWorkspaceWriteFile(path, content, canWriteFiles);
          },
          create: async (path, content) => {
            await createWorkspaceFile(path, content, canWriteFiles);
          },
          delete: async (path) => {
            await deleteWorkspaceFile(path, canWriteFiles);
          },
          rename: async (path, newPath) => {
            await renameWorkspaceFile(path, newPath, canWriteFiles);
          },
          onChange: (callback) => {
            if (!canReadFiles) return () => {};
            return track(subscribeVaultChange(callback));
          },
          onRename: (callback) => {
            if (!canReadFiles) return () => {};
            return track(subscribeVaultRename(callback));
          },
          onDelete: (callback) => {
            if (!canReadFiles) return () => {};
            return track(subscribeVaultDelete(callback));
          },
        },
        workspace: {
          getActiveFile: async () => {
            if (!canReadFiles) return null;
            return getActiveFilePath();
          },
          onActiveFileChange: (callback) => {
            if (!canReadFiles) return () => {};
            workspaceListeners.add(callback);
            if (!subscription) {
              subscription = createActiveFileSubscription(workspaceListeners);
            }
            const current = getActiveFilePath();
            callback(current ?? null);
            return track(() => {
              workspaceListeners.delete(callback);
              if (workspaceListeners.size === 0 && subscription) {
                subscription.dispose();
                subscription = null;
              }
            });
          },
        },
      },
    },
    registerCommand: (command) => {
      if (!canRegisterCommands) return;
      registerCommand(pluginId, command);
    },
    commands: {
      register: (command) => {
        if (!canRegisterCommands) return;
        controller.signal.throwIfAborted();
        registerCommand(pluginId, command);
      },
    },
    panels: {
      register: (panel) => {
        if (!canRegisterPanels) return;
        controller.signal.throwIfAborted();
        registerPanel(pluginId, panel);
      },
      update: (panelId, props) => {
        if (!canRegisterPanels) return;
        if(controller.signal.aborted)return;
        if(panels.get(panelId)?.pluginId!==pluginId)throw new Error('Cannot update another plugin panel');
        updatePanelProps(panelId, props);
      },
    },
    sidebar: {
      register: (item) => {
        if (!permissions.includes('ui:sidebar')) return;
        sidebarItems.set(`${pluginId}:${item.id}`, item);
        refreshSidebarSnapshot();
        for (const l of sidebarChangeListeners) { try { l(); } catch { /* */ } }
      },
    },
    toolbar: {
      register: (item) => {
        if (!permissions.includes('ui:toolbar')) return;
        toolbarItems.set(`${pluginId}:${item.id}`, item);
        refreshToolbarSnapshot();
        for (const l of toolbarChangeListeners) { try { l(); } catch { /* */ } }
      },
    },
    statusBar: {
      register: (item) => {
        if (!permissions.includes('ui:statusbar')) return;
        statusBarItems.set(`${pluginId}:${item.id}`, item);
        refreshStatusBarSnapshot();
        for (const l of statusBarChangeListeners) { try { l(); } catch { /* */ } }
      },
    },
    events: {
      onFileOpen: (cb) => {
        fileOpenListeners.add(cb);
        return track(() => {fileOpenListeners.delete(cb);});
      },
      onFileSave: (cb) => {
        fileSaveListeners.add(cb);
        return track(() => {fileSaveListeners.delete(cb);});
      },
      onFileClose: (cb) => {
        fileCloseListeners.add(cb);
        return track(() => {fileCloseListeners.delete(cb);});
      },
      onWorkspaceOpen: (cb) => {
        workspaceOpenListeners.add(cb);
        return track(() => {workspaceOpenListeners.delete(cb);});
      },
      onActiveFileChange: (cb) => {
        activeFileChangeListeners.add(cb);
        return track(() => {activeFileChangeListeners.delete(cb);});
      },
    },
    document: {
      getActive: async () => {
        const info=getActiveDocumentInfo();
        const tab=useWorkspaceStore.getState().getActiveTab();
        if (!tab || !isFileTabState(tab)) return info;
        const revision = await readFileSourceRevision(tab.fileHandle, controller.signal);
        const current = getActiveDocumentInfo();
        if (useWorkspaceStore.getState().getActiveTab() !== tab || current.paneId !== info.paneId || current.filePath !== info.filePath) {
          throw new Error(t('formula.region.sourceChanged'));
        }
        return { ...info, revision };
      },
      getViewerType: async () => getActiveDocumentInfo().viewerType,
      getSelectionText: async () => getCurrentSelectionText(),
      readCurrent: async () => readCurrentDocumentContent(permissions),
      getPdfTextPages: async (options) => {
        if (!canReadCurrentDocument(permissions)) {
          throw new Error('Permission denied');
        }
        return getPdfTextPagesFromDocumentModel(options);
      },
      getPdfSelectionImage: async (options) => {
        if (!canReadCurrentDocument(permissions)) {
          throw new Error('Permission denied');
        }
        return capturePdfSelectionImage({ ...options, signal: AbortSignal.any([controller.signal, ...(options?.signal ? [options.signal] : [])]) });
      },
      reveal: async (target) => revealDocumentTarget(target, permissions),
    },
    ui: {
      openPanel: async (panelId) => {
        assertPluginPermission(pluginId,permissions,'ui:panels','ui.openPanel');
        controller.signal.throwIfAborted();
        if(panelId && panels.get(panelId)?.pluginId!==pluginId)throw new Error('Plugin panel is not registered by this plugin');
        const settingsStore = useSettingsStore.getState();
        const persisted = await settingsStore.updateSettings({
          pluginPanelDockOpen: true,
          ...(panelId ? { pluginPanelLastActiveId: panelId } : {}),
        });
        if (persisted === false) throw new Error(settingsStore.error ?? 'Could not persist plugin panel state.');
        controller.signal.throwIfAborted();
        if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('lattice:open-plugin-panel',{detail:{panelId}}));
      },
    },
    clipboard: {
      writeText: async (text) => writeClipboardText(text, permissions),
    },
    exportFile: async (options) => exportPluginFile(options, permissions),
    settings: {
      get: key=>getPluginSetting(pluginId,key),
      set: (key,value)=>setPluginSetting(pluginId,key,value),
      onChange: (key,cb)=>track(subscribePluginSetting(pluginId,key,cb)),
    },
    assets: {
      getUrl: async (path) => await getPluginAssetUrl(pluginId, path),
      readText: async (path) => await readPluginAssetText(pluginId, path),
    },
    storage: {
      get: async (key) => {
        if (!permissions.includes('storage')) {
          throw new Error('Permission denied');
        }
        const storeKey = `lattice-plugin-kv:${pluginId}:${key}`;
        const store = await getPluginKvStore();
        if (store) {
          try {
            const val = await store.get(storeKey);
            if (val !== undefined && val !== null) return String(val);
          } catch { /* fallback */ }
        }
        const raw = localStorage.getItem(storeKey);
        return raw ?? null;
      },
      set: async (key, value) => {
        if (!permissions.includes('storage')) {
          throw new Error('Permission denied');
        }
        await pluginKvSet(`lattice-plugin-kv:${pluginId}:${key}`, value);
      },
      remove: async (key) => {
        if (!permissions.includes('storage')) {
          throw new Error('Permission denied');
        }
        const storeKey = `lattice-plugin-kv:${pluginId}:${key}`;
        localStorage.removeItem(storeKey);
        const store = await getPluginKvStore();
        if (store) {
          try { await store.delete(storeKey); await store.save(); } catch { /* */ }
        }
      },
    },
    annotations: {
      resolveFileId: async (filePath) => {
        if (!permissions.includes('annotations:read')) {
          throw new Error('Permission denied');
        }
        return deriveFileId(filePath);
      },
      list: async (options) => {
        if (!permissions.includes('annotations:read')) {
          throw new Error('Permission denied');
        }
        const fileId = resolveAnnotationFileId(options);
        if (!fileId) return [];
        return useAnnotationStore.getState().getAnnotationsForFile(fileId);
      },
      add: async (annotation) => {
        if (!permissions.includes('annotations:write')) {
          throw new Error('Permission denied');
        }
        const payload = annotation as LatticeAnnotation;
        if (!payload?.fileId) {
          throw new Error('Annotation fileId is required');
        }
        useAnnotationStore.getState().addAnnotation(payload);
      },
      update: async (id, updates) => {
        if (!permissions.includes('annotations:write')) {
          throw new Error('Permission denied');
        }
        useAnnotationStore.getState().updateAnnotation(id, updates);
      },
      remove: async (id) => {
        if (!permissions.includes('annotations:write')) {
          throw new Error('Permission denied');
        }
        useAnnotationStore.getState().deleteAnnotation(id);
      },
    },
    workspace: {
      listFiles: async () => {
        if (!canReadWorkspaceFile(permissions)) return [];
        const tree = useWorkspaceStore.getState().fileTree.root;
        if (!tree) return [];
        const paths: string[] = [];
        collectFilePaths(tree, paths);
        return paths;
      },
      readFile: async (path) => {
        if (!canReadWorkspaceFile(permissions)) {
          throw new Error('Permission denied');
        }
        const rootHandle = getWorkspaceRootHandle();
        if (!rootHandle) {
          throw new Error('Workspace not available');
        }
        const handle = await resolveFileHandle(rootHandle, path);
        const file = await handle.getFile();
        return await file.text();
      },
      writeFile: async (path, content) => {
        if (!permissions.includes('file:write')) {
          throw new Error('Permission denied');
        }
        const rootHandle = getWorkspaceRootHandle();
        if (!rootHandle) {
          throw new Error('Workspace not available');
        }
        const handle = await resolveFileHandle(rootHandle, path);
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        void import('@/lib/markdown/workspace-link-index')
          .then(({ upsertWorkspaceMarkdownFile }) => {
            upsertWorkspaceMarkdownFile(path, content);
          })
          .catch(() => {});
        emitFileSave(path);
      },
    },
    metadataCache: {
      getFileCache: async (path) => {
        if (!canReadFiles) return null;
        return parseFileMetadata(path, canReadFiles);
      },
    },
    notice: {
      show: (message, duration = 4000) => {
        // Use sonner toast if available, fallback to console
        void import('sonner')
          .then(({ toast }) => {
            toast(message, { duration });
          })
          .catch(() => {
            recordPluginAudit({
              pluginId,
              level: 'info',
              action: 'notice',
              message,
            });
          });
      },
    },
    modal: {
      open: (opts) => {
        if (modalHandler) {
          modalHandler(opts);
        } else {
          console.warn('[Modal] No modal handler registered. Title:', opts.title);
        }
      },
    },
    editor: {
      registerExtension: (id, extension) => {
        if (!permissions.includes('editor:extensions')) return;
        editorExtensions.set(`${pluginId}:${id}`, extension);
        for (const l of editorExtensionListeners) { try { l(); } catch { /* */ } }
      },
      unregisterExtension: (id) => {
        editorExtensions.delete(`${pluginId}:${id}`);
        for (const l of editorExtensionListeners) { try { l(); } catch { /* */ } }
      },
    },
    themes: {
      register: (id, css) => {
        if (!permissions.includes('themes')) return;
        const fullId = `${pluginId}:${id}`;
        // Remove old style if exists
        themeStyles.get(fullId)?.remove();
        const style = document.createElement('style');
        style.setAttribute('data-theme-id', fullId);
        style.textContent = css;
        themeStyles.set(fullId, style);
        for (const l of themeChangeListeners) { try { l(); } catch { /* */ } }
      },
      unregister: (id) => {
        const fullId = `${pluginId}:${id}`;
        const style = themeStyles.get(fullId);
        if (style) {
          style.remove();
          themeStyles.delete(fullId);
        }
        if (activeThemeId === fullId) activeThemeId = null;
        for (const l of themeChangeListeners) { try { l(); } catch { /* */ } }
      },
      setActive: (id) => {
        // Deactivate current
        if (activeThemeId) {
          themeStyles.get(activeThemeId)?.remove();
        }
        if (id) {
          const fullId = `${pluginId}:${id}`;
          const style = themeStyles.get(fullId);
          if (style) {
            document.head.appendChild(style);
            activeThemeId = fullId;
          }
        } else {
          activeThemeId = null;
        }
        for (const l of themeChangeListeners) { try { l(); } catch { /* */ } }
      },
    },
  };
}

async function activatePlugin(plugin: PluginModule): Promise<void> {
  if (activePlugins.has(plugin.manifest.id)) return;
  const ctx = createContext(plugin.manifest);
  try {
    await plugin.activate(ctx);
    registerManifestPanels(plugin.manifest, plugin.manifest.permissions ?? []);
    activePlugins.set(plugin.manifest.id, plugin);
    setPluginHealth(plugin.manifest.id, { status: 'active', lastError: undefined, lastErrorAt: undefined });
    recordPluginAudit({
      pluginId: plugin.manifest.id,
      level: 'info',
      action: 'activate',
      message: 'Plugin activated',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Plugin activation failed';
    // Activation may have registered resources before throwing. Treat the
    // plugin as inactive and remove every registry entry before reporting the
    // failure, so a retry cannot accumulate duplicate commands or panels.
    revokeAssetUrls(plugin.manifest.id);
    unregisterCommandsFor(plugin.manifest.id);
    unregisterPanelsFor(plugin.manifest.id);
    unregisterUIItemsFor(plugin.manifest.id);
    activePlugins.delete(plugin.manifest.id);
    try{await plugin.deactivate?.();}catch{/* partial plugin teardown may fail */}
    cleanupPluginResources(plugin.manifest.id);
    setPluginHealth(plugin.manifest.id, { status: 'error', lastError: message, lastErrorAt: Date.now() });
    recordPluginAudit({
      pluginId: plugin.manifest.id,
      level: 'error',
      action: 'activate',
      message,
    });
    console.error(`Plugin ${plugin.manifest.id} activation failed:`, error);
  }
}

async function deactivatePlugin(plugin: PluginModule): Promise<void> {
  if (!activePlugins.has(plugin.manifest.id)) return;
  try {
    if (plugin.deactivate) await plugin.deactivate();
  } catch(error) {
    recordPluginAudit({pluginId:plugin.manifest.id,level:'warn',action:'deactivate',message:String(error)});
  } finally {
    // Cleanup is guaranteed even when a plugin's own deactivate hook throws.
    revokeAssetUrls(plugin.manifest.id);
    activePlugins.delete(plugin.manifest.id);
    unregisterCommandsFor(plugin.manifest.id);
    unregisterPanelsFor(plugin.manifest.id);
    unregisterUIItemsFor(plugin.manifest.id);
    setPluginHealth(plugin.manifest.id, { status: 'inactive' });
    cleanupPluginResources(plugin.manifest.id);
  }
  recordPluginAudit({
    pluginId: plugin.manifest.id,
    level: 'info',
    action: 'deactivate',
    message: 'Plugin deactivated',
  });
}

function getWorkspaceRootHandle() {
  const state = useWorkspaceStore.getState();
  return state.rootHandle;
}

// --- MetadataCache: parse MD file for headings/links/tags/frontmatter ---
async function parseFileMetadata(path: string, canRead: boolean): Promise<CachedFileMetadata | null> {
  try {
    const content = await getWorkspaceReadFile(path, canRead);
    if (!content) return null;
    const document = extractMarkdownDocument(content);
    return {
      headings: document.headings.map((heading): CachedHeading => ({
        heading: heading.text,
        level: heading.level,
        position: {
          start: { line: heading.range.start.line, col: heading.range.start.col },
          end: { line: heading.range.end.line, col: heading.range.end.col },
        },
      })),
      links: document.links.map((link): CachedLink => ({
        link: link.target,
        displayText: link.label,
        position: {
          start: { line: link.range.start.line, col: link.range.start.col },
          end: { line: link.range.end.line, col: link.range.end.col },
        },
      })),
      tags: document.tags.map((tag): CachedTag => ({
        tag: tag.tag,
        position: {
          start: { line: tag.range.start.line, col: tag.range.start.col },
          end: { line: tag.range.end.line, col: tag.range.end.col },
        },
      })),
      frontmatter: document.frontmatter,
    };
  } catch {
    return null;
  }
}

// --- Editor Extension exports ---
export function getPluginEditorExtensions(): Map<string, unknown> {
  return editorExtensions;
}

export function subscribeEditorExtensions(cb: () => void): () => void {
  editorExtensionListeners.add(cb);
  return () => editorExtensionListeners.delete(cb);
}

// --- Theme exports ---
export function setModalHandler(handler: typeof modalHandler): void {
  modalHandler = handler;
}

export function subscribeThemeChanges(cb: () => void): () => void {
  themeChangeListeners.add(cb);
  return () => themeChangeListeners.delete(cb);
}

function getActiveFilePath(): string | null {
  const state = useWorkspaceStore.getState();
  const active = state.getActiveTab();
  return active?.filePath ?? null;
}

function createActiveFileSubscription(
  listeners: Set<(path: string | null) => void>
): { dispose: () => void } | null {
  let lastPath = getActiveFilePath();
  const unsubscribe = useWorkspaceStore.subscribe((state) => {
    const nextPath = state.getActiveTab()?.filePath ?? null;
    if (nextPath === lastPath) return;
    lastPath = nextPath;
    for (const listener of listeners) {
      try {
        listener(nextPath);
      } catch (error) {
        console.warn('Active file listener failed:', error);
      }
    }
  });
  return { dispose: () => unsubscribe() };
}

async function createContextFileList(): Promise<string[]> {
  const tree = useWorkspaceStore.getState().fileTree.root;
  if (!tree) return [];
  const paths: string[] = [];
  collectFilePaths(tree, paths);
  return paths;
}

async function getWorkspaceReadFile(path: string, canRead: boolean): Promise<string> {
  if (!canRead) {
    throw new Error('Permission denied');
  }
  const rootHandle = getWorkspaceRootHandle();
  if (!rootHandle) {
    throw new Error('Workspace not available');
  }
  const handle = await resolveFileHandle(rootHandle, path);
  const file = await handle.getFile();
  return await file.text();
}

async function getWorkspaceWriteFile(
  path: string,
  content: string,
  canWrite: boolean
): Promise<void> {
  if (!canWrite) {
    throw new Error('Permission denied');
  }
  const rootHandle = getWorkspaceRootHandle();
  if (!rootHandle) {
    throw new Error('Workspace not available');
  }
  const handle = await resolveFileHandle(rootHandle, path);
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
  emitVaultChange(path);
}

async function createWorkspaceFile(
  path: string,
  content: string,
  canWrite: boolean
): Promise<void> {
  if (!canWrite) {
    throw new Error('Permission denied');
  }
  const rootHandle = getWorkspaceRootHandle();
  if (!rootHandle) {
    throw new Error('Workspace not available');
  }
  const handle = await ensureFileHandle(rootHandle, path);
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
  emitVaultChange(path);
}

async function deleteWorkspaceFile(path: string, canWrite: boolean): Promise<void> {
  if (!canWrite) {
    throw new Error('Permission denied');
  }
  const rootHandle = getWorkspaceRootHandle();
  if (!rootHandle) {
    throw new Error('Workspace not available');
  }
  await removeFileHandle(rootHandle, path);
  emitVaultDelete(path);
}

async function renameWorkspaceFile(
  path: string,
  newPath: string,
  canWrite: boolean
): Promise<void> {
  if (!canWrite) {
    throw new Error('Permission denied');
  }
  const rootHandle = getWorkspaceRootHandle();
  if (!rootHandle) {
    throw new Error('Workspace not available');
  }
  const sourceHandle = await resolveFileHandle(rootHandle, path);
  const file = await sourceHandle.getFile();
  const content = await file.text();
  await createWorkspaceFile(newPath, content, true);
  await removeFileHandle(rootHandle, path);
  emitVaultRename(path, newPath);
}

async function ensureFileHandle(
  root: FileSystemDirectoryHandle,
  filePath: string
): Promise<FileSystemFileHandle> {
  const parts = filePath.split('/').filter(Boolean);
  let current: FileSystemDirectoryHandle = root;
  const startIndex = parts[0] === root.name ? 1 : 0;
  for (let i = startIndex; i < parts.length - 1; i++) {
    const part = parts[i];
    current = await current.getDirectoryHandle(part, { create: true });
  }
  const name = parts[parts.length - 1];
  return await current.getFileHandle(name, { create: true });
}

async function removeFileHandle(
  root: FileSystemDirectoryHandle,
  filePath: string
): Promise<void> {
  const parts = filePath.split('/').filter(Boolean);
  let current: FileSystemDirectoryHandle = root;
  const startIndex = parts[0] === root.name ? 1 : 0;
  for (let i = startIndex; i < parts.length - 1; i++) {
    const part = parts[i];
    current = await current.getDirectoryHandle(part);
  }
  const name = parts[parts.length - 1];
  await current.removeEntry(name);
}

function collectFilePaths(node: import('@/types/file-system').TreeNode, paths: string[]) {
  if (node.kind === 'file') {
    paths.push(node.path);
    return;
  }
  for (const child of node.children) {
    collectFilePaths(child, paths);
  }
}

async function resolveFileHandle(root: FileSystemDirectoryHandle, filePath: string): Promise<FileSystemFileHandle> {
  const parts = filePath.split('/').filter(Boolean);
  let current: FileSystemDirectoryHandle | FileSystemFileHandle = root;
  const startIndex = parts[0] === root.name ? 1 : 0;
  for (let i = startIndex; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;
    if (isLast) {
      current = await (current as FileSystemDirectoryHandle).getFileHandle(part);
    } else {
      current = await (current as FileSystemDirectoryHandle).getDirectoryHandle(part);
    }
  }
  return current as FileSystemFileHandle;
}

function createWorkerHost(
  manifest: PluginManifest,
  permissions: PluginPermission[],
  main: string
): PluginWorkerHost {
  const networkAllowlist =
    useSettingsStore.getState().settings.pluginNetworkAllowlist ?? [];
  const host = new PluginWorkerHost({
    pluginId: manifest.id,
    manifest,
    mainCode: main,
    permissions,
    networkAllowlist,
    platform: isTauri() ? 'desktop' : 'web',
    onRegisterCommand: (command) =>
      registerCommand(manifest.id, command, (payload) => host.runCommand(command.id, payload)),
    onRegisterPanel: (panel) => registerPanel(manifest.id, panel),
    onLog: (...args) => {
      recordPluginAudit({
        pluginId: manifest.id,
        level: 'info',
        action: 'worker-log',
        message: args.map((arg) => String(arg)).join(' '),
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      setPluginHealth(manifest.id, { status: 'error', lastError: message, lastErrorAt: Date.now() });
      recordPluginAudit({
        pluginId: manifest.id,
        level: 'error',
        action: 'worker-error',
        message,
      });
    },
    onAudit: (event) => {
      recordPluginAudit({
        pluginId: manifest.id,
        level: event.level,
        action: event.action,
        message: event.message,
        data: event.data,
      });
    },
    onRequest: async (action, payload) => {
      const rootHandle = getWorkspaceRootHandle();
      if (action === 'annotations.resolveFileId') {
        assertPluginPermission(manifest.id, permissions, 'annotations:read', action);
        const { filePath } = payload as { filePath?: string };
        if (!filePath) {
          throw new Error('filePath is required');
        }
        return deriveFileId(filePath);
      }
      if (action === 'annotations.list') {
        assertPluginPermission(manifest.id, permissions, 'annotations:read', action);
        const fileId = resolveAnnotationFileId(payload as { fileId?: string; filePath?: string });
        if (!fileId) return [];
        return useAnnotationStore.getState().getAnnotationsForFile(fileId);
      }
      if (action === 'annotations.add') {
        assertPluginPermission(manifest.id, permissions, 'annotations:write', action);
        const annotation = (payload as { annotation?: LatticeAnnotation })?.annotation;
        if (!annotation?.fileId) {
          throw new Error('Annotation fileId is required');
        }
        useAnnotationStore.getState().addAnnotation(annotation);
        return true;
      }
      if (action === 'annotations.update') {
        assertPluginPermission(manifest.id, permissions, 'annotations:write', action);
        const { id, updates } = payload as {
          id: string;
          updates: Partial<Omit<LatticeAnnotation, 'id' | 'fileId'>>;
        };
        useAnnotationStore.getState().updateAnnotation(id, updates);
        return true;
      }
      if (action === 'annotations.remove') {
        assertPluginPermission(manifest.id, permissions, 'annotations:write', action);
        const { id } = payload as { id: string };
        useAnnotationStore.getState().deleteAnnotation(id);
        return true;
      }
      if (action === 'storage.get') {
        assertPluginPermission(manifest.id, permissions, 'storage', action);
        const key = (payload as { key?: string })?.key ?? '';
        return localStorage.getItem(`lattice-plugin-kv:${manifest.id}:${key}`);
      }
      if (action === 'storage.set') {
        assertPluginPermission(manifest.id, permissions, 'storage', action);
        const { key, value } = payload as { key: string; value: string };
        localStorage.setItem(`lattice-plugin-kv:${manifest.id}:${key}`, value);
        return true;
      }
      if (action === 'storage.remove') {
        assertPluginPermission(manifest.id, permissions, 'storage', action);
        const key = (payload as { key?: string })?.key ?? '';
        localStorage.removeItem(`lattice-plugin-kv:${manifest.id}:${key}`);
        return true;
      }

      if (action === 'assets.getUrl') {
        recordPluginAudit({
          pluginId: manifest.id,
          level: 'info',
          action: 'asset-read',
          message: 'Plugin asset URL requested',
          data: { request: action },
        });
        const { path } = payload as { path?: string };
        if (!path) {
          throw new Error('path is required');
        }
        return await getPluginAssetUrl(manifest.id, path);
      }

      if (action === 'assets.readText') {
        recordPluginAudit({
          pluginId: manifest.id,
          level: 'info',
          action: 'asset-read',
          message: 'Plugin asset text requested',
          data: { request: action },
        });
        const { path } = payload as { path?: string };
        if (!path) {
          throw new Error('path is required');
        }
        return await readPluginAssetText(manifest.id, path);
      }

      if (!rootHandle) {
        throw new Error('Workspace not available');
      }

      if (action === 'workspace.listFiles') {
        if (!canReadWorkspaceFile(permissions)) {
          denyPluginPermission(manifest.id, 'file:read', action);
        }
        const tree = useWorkspaceStore.getState().fileTree.root;
        if (!tree) return [];
        const paths: string[] = [];
        collectFilePaths(tree, paths);
        return paths;
      }
      if (action === 'workspace.activeFile') {
        if (!canReadCurrentDocument(permissions)) {
          denyPluginPermission(manifest.id, 'read-current-document', action);
        }
        return getActiveFilePath();
      }
      if (action === 'workspace.createFile') {
        assertPluginPermission(manifest.id, permissions, 'file:write', action);
        const { path, content } = payload as { path: string; content?: string };
        await createWorkspaceFile(path, content ?? '', true);
        return true;
      }
      if (action === 'workspace.deleteFile') {
        assertPluginPermission(manifest.id, permissions, 'file:write', action);
        const { path } = payload as { path: string };
        await deleteWorkspaceFile(path, true);
        return true;
      }
      if (action === 'workspace.renameFile') {
        assertPluginPermission(manifest.id, permissions, 'file:write', action);
        const { path, newPath } = payload as { path: string; newPath: string };
        await renameWorkspaceFile(path, newPath, true);
        return true;
      }
      if (action === 'workspace.readFile') {
        if (!canReadWorkspaceFile(permissions)) {
          denyPluginPermission(manifest.id, 'file:read', action);
        }
        const { path } = payload as { path: string };
        const handle = await resolveFileHandle(rootHandle, path);
        const file = await handle.getFile();
        return await file.text();
      }
      if (action === 'workspace.writeFile') {
        assertPluginPermission(manifest.id, permissions, 'file:write', action);
        const { path, content } = payload as { path: string; content: string };
        const handle = await resolveFileHandle(rootHandle, path);
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        return true;
      }

      throw new Error(`Unknown action: ${action}`);
    },
  });
  return host;
}

async function activateWorkerPlugin(manifest: PluginManifest, main: string): Promise<void> {
  if (activeWorkers.has(manifest.id)) return;
  const permissions = manifest.permissions ?? [];
  const host = createWorkerHost(manifest, permissions, main);
  try {
    await host.start();
    registerManifestPanels(manifest, permissions);
  } catch(error) {
    await host.stop();cleanupPluginResources(manifest.id);throw error;
  }
  activeWorkers.set(manifest.id, host);
  setPluginHealth(manifest.id, { status: 'active', lastError: undefined, lastErrorAt: undefined });
  recordPluginAudit({
    pluginId: manifest.id,
    level: 'info',
    action: 'activate',
    message: 'Plugin activated',
  });
}

async function deactivateWorkerPlugin(pluginId: string): Promise<void> {
  const host = activeWorkers.get(pluginId);
  if (!host) return;
  try {await host.stop();}finally{cleanupPluginResources(pluginId);}
  revokeAssetUrls(pluginId);
  activeWorkers.delete(pluginId);
  unregisterCommandsFor(pluginId);
  unregisterPanelsFor(pluginId);
  unregisterUIItemsFor(pluginId);
  setPluginHealth(pluginId, { status: 'inactive' });
  recordPluginAudit({
    pluginId,
    level: 'info',
    action: 'deactivate',
    message: 'Plugin deactivated',
  });
}

/**
 * Topological sort for plugin dependency resolution.
 * Returns plugin IDs in activation order, or throws on circular dependencies.
 */
export function resolveDependencyOrder(
  manifests: Map<string, PluginManifest>
): string[] {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Circular plugin dependency detected: ${id}`);
    }
    visiting.add(id);
    const manifest = manifests.get(id);
    if (manifest?.dependencies) {
      for (const depId of Object.keys(manifest.dependencies)) {
        if (manifests.has(depId)) {
          visit(depId);
        }
      }
    }
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  }

  for (const id of manifests.keys()) {
    visit(id);
  }
  return order;
}

let pluginSyncQueue:Promise<void>=Promise.resolve();
export function syncPlugins(options:{pluginsEnabled:boolean;enabledPluginIds:string[]}):Promise<void> {
  const request={...options,enabledPluginIds:[...options.enabledPluginIds]};
  const next=pluginSyncQueue.catch(()=>{}).then(()=>syncPluginsNow(request));
  pluginSyncQueue=next;return next;
}

/**
 * Stop one plugin before replacing its stored package. The operation is
 * intentionally idempotent so installers can safely call it for a newly
 * installed ID as well as an existing active plugin.
 */
export async function deactivatePluginById(pluginId: string): Promise<void> {
  const plugin = activePlugins.get(pluginId);
  if (plugin) await deactivatePlugin(plugin);
  if (activeWorkers.has(pluginId)) await deactivateWorkerPlugin(pluginId);
}

async function syncPluginsNow(options: {
  pluginsEnabled: boolean;
  enabledPluginIds: string[];
}): Promise<void> {
  if (!options.pluginsEnabled) {
    const active = Array.from(activePlugins.values());
    for (const plugin of active) {
      await deactivatePlugin(plugin);
    }
    const workerIds = Array.from(activeWorkers.keys());
    for (const id of workerIds) {
      await deactivateWorkerPlugin(id);
    }
    commands.clear();
    panels.clear();
    emitRegistryChange();
    return;
  }

  const targetIds = new Set(options.enabledPluginIds);
  const desiredModes = new Map<
    string,
    { mode: 'builtin'; plugin: PluginModule } | { mode: 'worker'; stored: StoredPlugin }
  >();

  for (const id of targetIds) {
    const stored = await withTimeout(loadStoredPlugin(id),4000,`Plugin ${id} package load`).catch(error=>{
      recordPluginAudit({pluginId:id,level:'warn',action:'package-load',message:String(error)});return null;
    });
    if (stored) {
      desiredModes.set(id, { mode: 'worker', stored });
      continue;
    }
    const plugin = getPluginModule(id);
    if (plugin) {
      desiredModes.set(id, { mode: 'builtin', plugin });
    }
  }

  for (const [id, plugin] of activePlugins.entries()) {
    if (desiredModes.get(id)?.mode !== 'builtin') {
      await deactivatePlugin(plugin);
    }
  }

  for (const id of activeWorkers.keys()) {
    if (desiredModes.get(id)?.mode !== 'worker') {
      await deactivateWorkerPlugin(id);
    }
  }

  // Resolve activation order via dependency graph
  const manifestMap = new Map<string, PluginManifest>();
  for (const [id, entry] of desiredModes.entries()) {
    const manifest = entry.mode === 'worker' ? entry.stored.manifest : entry.plugin.manifest;
    manifestMap.set(id, manifest);
  }

  let activationOrder: string[];
  try {
    activationOrder = resolveDependencyOrder(manifestMap);
  } catch (error) {
    console.error('Plugin dependency resolution failed:', error);
    activationOrder = Array.from(desiredModes.keys());
  }

  for (const id of activationOrder) {
    const entry = desiredModes.get(id);
    if (!entry) continue;
    try {
      if (entry.mode === 'worker') {
        if (!activeWorkers.has(id)) {
          await activateWorkerPlugin(entry.stored.manifest, entry.stored.main);
        }
        continue;
      }
      if (!activePlugins.has(id)) {
        await activatePlugin(entry.plugin);
      }
    } catch (error) {
      // One broken plugin must not prevent the remaining enabled plugins from
      // reaching a usable state. The per-plugin health record contains the
      // actionable error and keeps the requested state visible to the UI.
      const message = error instanceof Error ? error.message : 'Plugin activation failed';
      setPluginHealth(id, { status: 'error', lastError: message, lastErrorAt: Date.now() });
      console.error(`Plugin ${id} sync failed:`, error);
    }
  }
}

export function getRegisteredCommands(): PluginCommand[] {
  return Array.from(commands.values()).map((entry) => entry.command);
}

export function getRegisteredPanels(): PluginPanel[] {
  return Array.from(panels.values()).map((entry) => entry.panel);
}

export async function runPluginCommand(commandId: string, payload?: unknown): Promise<void> {
  const entry = commands.get(commandId);
  if (!entry?.command?.run) {
    const message = `Command not found: ${commandId}`;
    recordPluginAudit({
      pluginId: 'system',
      level: 'warn',
      action: 'command',
      message,
      data: { commandId },
    });
    console.warn(message);
    throw new Error(message);
  }
  try {
    await entry.command.run(payload);
    recordPluginAudit({
      pluginId: entry.pluginId,
      level: 'info',
      action: 'command',
      message: `Command executed: ${commandId}`,
      data: { commandId },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Command failed';
    setPluginHealth(entry.pluginId, { status: 'error', lastError: message, lastErrorAt: Date.now() });
    recordPluginAudit({
      pluginId: entry.pluginId,
      level: 'error',
      action: 'command',
      message,
      data: { commandId },
    });
    console.error(`Plugin command ${commandId} failed:`, error);
    throw error;
  }
}

export function getCommandsForPlugin(pluginId:string):PluginCommand[] {
  return Array.from(commands.values()).filter(entry=>entry.pluginId===pluginId).map(entry=>entry.command);
}

export function updatePluginNetworkAllowlist(allowlist: string[]) {
  const normalized = Array.isArray(allowlist) ? allowlist : [];
  for (const host of activeWorkers.values()) {
    host.updateNetworkAllowlist(normalized);
  }
  recordPluginAudit({
    pluginId: 'system',
    level: 'info',
    action: 'allowlist-update',
    message: 'Plugin network allowlist updated',
    data: { count: normalized.length },
  });
}
