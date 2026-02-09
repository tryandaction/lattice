import { isTauri } from '@/lib/storage-adapter';
import { getPluginModule } from './registry';
import { loadStoredPlugin, loadStoredPluginResource, type StoredPlugin } from './repository';
import { PluginWorkerHost } from './worker-host';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useAnnotationStore } from '@/stores/annotation-store';
import { deriveFileId } from '@/lib/annotation-storage';
import { useSettingsStore } from '@/stores/settings-store';
import type {
  PluginCommand,
  PluginContext,
  PluginManifest,
  PluginModule,
  PluginPanel,
  PluginPermission,
} from './types';
import type { LatticeAnnotation } from '@/types/annotation';

type RegisteredCommand = { command: PluginCommand; pluginId: string };
type RegisteredPanel = { panel: PluginPanel; pluginId: string };

const activePlugins = new Map<string, PluginModule>();
const activeWorkers = new Map<string, PluginWorkerHost>();
const commands = new Map<string, RegisteredCommand>();
const panels = new Map<string, RegisteredPanel>();
const assetUrls = new Map<string, Set<string>>();
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
  return url;
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
  const defined = manifest.ui?.panels ?? [];
  for (const panel of defined) {
    registerPanel(manifest.id, panel);
  }
}
function unregisterPanelsFor(pluginId: string) {
  let changed = false;
  for (const [id, entry] of panels.entries()) {
    if (entry.pluginId === pluginId) {
      panels.delete(id);
      changed = true;
    }
  }
  if (changed) {
    emitRegistryChange();
  }
}

function createContext(manifest: PluginManifest): PluginContext {
  const pluginId = manifest.id;
  const permissions = manifest.permissions ?? [];
  const canRegisterCommands = permissions.includes('ui:commands');
  const canRegisterPanels = permissions.includes('ui:panels');
  const canReadFiles = permissions.includes('file:read');
  const canWriteFiles = permissions.includes('file:write');
  const workspaceListeners = new Set<(path: string | null) => void>();
  let subscription: { dispose: () => void } | null = null;
  return {
    app: {
      platform: isTauri() ? 'desktop' : 'web',
    },
    log: (...args: unknown[]) => {
      console.log(`[plugin:${pluginId}]`, ...args);
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
            return subscribeVaultChange(callback);
          },
          onRename: (callback) => {
            if (!canReadFiles) return () => {};
            return subscribeVaultRename(callback);
          },
          onDelete: (callback) => {
            if (!canReadFiles) return () => {};
            return subscribeVaultDelete(callback);
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
            return () => {
              workspaceListeners.delete(callback);
              if (workspaceListeners.size === 0 && subscription) {
                subscription.dispose();
                subscription = null;
              }
            };
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
        registerCommand(pluginId, command);
      },
    },
    panels: {
      register: (panel) => {
        if (!canRegisterPanels) return;
        registerPanel(pluginId, panel);
      },
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
        const raw = localStorage.getItem(`lattice-plugin-kv:${pluginId}:${key}`);
        return raw ?? null;
      },
      set: async (key, value) => {
        if (!permissions.includes('storage')) {
          throw new Error('Permission denied');
        }
        localStorage.setItem(`lattice-plugin-kv:${pluginId}:${key}`, value);
      },
      remove: async (key) => {
        if (!permissions.includes('storage')) {
          throw new Error('Permission denied');
        }
        localStorage.removeItem(`lattice-plugin-kv:${pluginId}:${key}`);
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
        if (!permissions.includes('file:read')) return [];
        const tree = useWorkspaceStore.getState().fileTree.root;
        if (!tree) return [];
        const paths: string[] = [];
        collectFilePaths(tree, paths);
        return paths;
      },
      readFile: async (path) => {
        if (!permissions.includes('file:read')) {
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
  if (plugin.deactivate) {
    await plugin.deactivate();
  }
  revokeAssetUrls(plugin.manifest.id);
  activePlugins.delete(plugin.manifest.id);
  unregisterCommandsFor(plugin.manifest.id);
  unregisterPanelsFor(plugin.manifest.id);
  setPluginHealth(plugin.manifest.id, { status: 'inactive' });
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
      console.log(`[plugin:${manifest.id}]`, ...args);
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
        if (!permissions.includes('annotations:read')) {
          throw new Error('Permission denied');
        }
        const { filePath } = payload as { filePath?: string };
        if (!filePath) {
          throw new Error('filePath is required');
        }
        return deriveFileId(filePath);
      }
      if (action === 'annotations.list') {
        if (!permissions.includes('annotations:read')) {
          throw new Error('Permission denied');
        }
        const fileId = resolveAnnotationFileId(payload as { fileId?: string; filePath?: string });
        if (!fileId) return [];
        return useAnnotationStore.getState().getAnnotationsForFile(fileId);
      }
      if (action === 'annotations.add') {
        if (!permissions.includes('annotations:write')) {
          throw new Error('Permission denied');
        }
        const annotation = (payload as { annotation?: LatticeAnnotation })?.annotation;
        if (!annotation?.fileId) {
          throw new Error('Annotation fileId is required');
        }
        useAnnotationStore.getState().addAnnotation(annotation);
        return true;
      }
      if (action === 'annotations.update') {
        if (!permissions.includes('annotations:write')) {
          throw new Error('Permission denied');
        }
        const { id, updates } = payload as {
          id: string;
          updates: Partial<Omit<LatticeAnnotation, 'id' | 'fileId'>>;
        };
        useAnnotationStore.getState().updateAnnotation(id, updates);
        return true;
      }
      if (action === 'annotations.remove') {
        if (!permissions.includes('annotations:write')) {
          throw new Error('Permission denied');
        }
        const { id } = payload as { id: string };
        useAnnotationStore.getState().deleteAnnotation(id);
        return true;
      }
      if (action === 'storage.get') {
        if (!permissions.includes('storage')) {
          throw new Error('Permission denied');
        }
        const key = (payload as { key?: string })?.key ?? '';
        return localStorage.getItem(`lattice-plugin-kv:${manifest.id}:${key}`);
      }
      if (action === 'storage.set') {
        if (!permissions.includes('storage')) {
          throw new Error('Permission denied');
        }
        const { key, value } = payload as { key: string; value: string };
        localStorage.setItem(`lattice-plugin-kv:${manifest.id}:${key}`, value);
        return true;
      }
      if (action === 'storage.remove') {
        if (!permissions.includes('storage')) {
          throw new Error('Permission denied');
        }
        const key = (payload as { key?: string })?.key ?? '';
        localStorage.removeItem(`lattice-plugin-kv:${manifest.id}:${key}`);
        return true;
      }

      if (action === 'assets.getUrl') {
        const { path } = payload as { path?: string };
        if (!path) {
          throw new Error('path is required');
        }
        return await getPluginAssetUrl(manifest.id, path);
      }

      if (action === 'assets.readText') {
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
        if (!permissions.includes('file:read')) {
          throw new Error('Permission denied');
        }
        const tree = useWorkspaceStore.getState().fileTree.root;
        if (!tree) return [];
        const paths: string[] = [];
        collectFilePaths(tree, paths);
        return paths;
      }
      if (action === 'workspace.activeFile') {
        if (!permissions.includes('file:read')) {
          throw new Error('Permission denied');
        }
        return getActiveFilePath();
      }
      if (action === 'workspace.createFile') {
        if (!permissions.includes('file:write')) {
          throw new Error('Permission denied');
        }
        const { path, content } = payload as { path: string; content?: string };
        await createWorkspaceFile(path, content ?? '', true);
        return true;
      }
      if (action === 'workspace.deleteFile') {
        if (!permissions.includes('file:write')) {
          throw new Error('Permission denied');
        }
        const { path } = payload as { path: string };
        await deleteWorkspaceFile(path, true);
        return true;
      }
      if (action === 'workspace.renameFile') {
        if (!permissions.includes('file:write')) {
          throw new Error('Permission denied');
        }
        const { path, newPath } = payload as { path: string; newPath: string };
        await renameWorkspaceFile(path, newPath, true);
        return true;
      }
      if (action === 'workspace.readFile') {
        if (!permissions.includes('file:read')) {
          throw new Error('Permission denied');
        }
        const { path } = payload as { path: string };
        const handle = await resolveFileHandle(rootHandle, path);
        const file = await handle.getFile();
        return await file.text();
      }
      if (action === 'workspace.writeFile') {
        if (!permissions.includes('file:write')) {
          throw new Error('Permission denied');
        }
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
  registerManifestPanels(manifest, permissions);
  await host.start();
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
  await host.stop();
  revokeAssetUrls(pluginId);
  activeWorkers.delete(pluginId);
  unregisterCommandsFor(pluginId);
  unregisterPanelsFor(pluginId);
  setPluginHealth(pluginId, { status: 'inactive' });
  recordPluginAudit({
    pluginId,
    level: 'info',
    action: 'deactivate',
    message: 'Plugin deactivated',
  });
}

export async function syncPlugins(options: {
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
    const stored = await loadStoredPlugin(id);
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

  for (const [id, entry] of desiredModes.entries()) {
    if (entry.mode === 'worker') {
      if (!activeWorkers.has(id)) {
        await activateWorkerPlugin(entry.stored.manifest, entry.stored.main);
      }
      continue;
    }
    if (!activePlugins.has(id)) {
      await activatePlugin(entry.plugin);
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
    console.warn(`Command not found: ${commandId}`);
    return;
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
  }
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
