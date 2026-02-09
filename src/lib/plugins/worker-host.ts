import type { PluginCommand, PluginManifest, PluginPanel, PluginPermission } from './types';
import { useWorkspaceStore } from '@/stores/workspace-store';

export interface PluginWorkerHostOptions {
  pluginId: string;
  manifest: PluginManifest;
  mainCode: string;
  permissions: PluginPermission[];
  networkAllowlist: string[];
  platform: 'web' | 'desktop';
  onRegisterCommand: (command: PluginCommand) => void;
  onRegisterPanel: (panel: PluginPanel) => void;
  onLog: (...args: unknown[]) => void;
  onError: (error: unknown) => void;
  onAudit: (event: PluginAuditEvent) => void;
  onRequest: (action: string, payload: unknown) => Promise<unknown>;
}

export type PluginAuditEvent = {
  level: 'info' | 'warn' | 'error';
  action: string;
  message: string;
  data?: Record<string, unknown>;
};

type WorkerRequestMessage = {
  type: 'request';
  id: string;
  action: string;
  payload?: unknown;
};

type WorkerResponseMessage = {
  type: 'response';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

const WORKER_CODE = `
let pluginModule = null;
let active = false;
const commandRegistry = new Map();
const pending = new Map();
let networkEnabled = false;
let networkAllowlist = [];
let activeFileListeners = new Map();
let activeFileListenerId = 0;
let vaultChangeListeners = new Map();
let vaultRenameListeners = new Map();
let vaultDeleteListeners = new Map();
let vaultListenerId = 0;

function postMessageSafe(message) {
  self.postMessage(message);
}

function postAudit(event) {
  postMessageSafe({ type: 'audit', event });
}

function createRequest(action, payload) {
  const id = Math.random().toString(36).slice(2);
  postMessageSafe({ type: 'request', id, action, payload });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

function createContext(pluginId, platform, permissions) {
  const can = (perm) => permissions.includes(perm);
  const listFiles = () => createRequest('workspace.listFiles', {});
  const readFile = (path) => createRequest('workspace.readFile', { path });
  const writeFile = (path, content) => createRequest('workspace.writeFile', { path, content });
  const createFile = (path, content) => createRequest('workspace.createFile', { path, content });
  const deleteFile = (path) => createRequest('workspace.deleteFile', { path });
  const renameFile = (path, newPath) => createRequest('workspace.renameFile', { path, newPath });
  const onActiveFileChange = (callback) => {
    if (!can('file:read')) return () => {};
    const id = 'active-' + (++activeFileListenerId);
    activeFileListeners.set(id, callback);
    return () => {
      activeFileListeners.delete(id);
    };
  };
  const onVaultChange = (callback) => {
    if (!can('file:read')) return () => {};
    const id = 'vault-change-' + (++vaultListenerId);
    vaultChangeListeners.set(id, callback);
    return () => {
      vaultChangeListeners.delete(id);
    };
  };
  const onVaultRename = (callback) => {
    if (!can('file:read')) return () => {};
    const id = 'vault-rename-' + (++vaultListenerId);
    vaultRenameListeners.set(id, callback);
    return () => {
      vaultRenameListeners.delete(id);
    };
  };
  const onVaultDelete = (callback) => {
    if (!can('file:read')) return () => {};
    const id = 'vault-delete-' + (++vaultListenerId);
    vaultDeleteListeners.set(id, callback);
    return () => {
      vaultDeleteListeners.delete(id);
    };
  };
  const registerCommand = (command) => {
    if (!can('ui:commands')) return;
    if (!command?.id) return;
    if (typeof command.run === 'function') {
      commandRegistry.set(command.id, command.run);
    }
    postMessageSafe({
      type: 'registerCommand',
      command: {
        id: command.id,
        title: command.title,
        shortcut: command.shortcut,
      },
    });
  };
  return {
    app: { platform },
    log: (...args) => postMessageSafe({ type: 'log', args }),
    obsidian: {
      app: {
        vault: {
          getFiles: () => listFiles(),
          getMarkdownFiles: async () => {
            const files = await listFiles();
            return (files || []).filter((path) => String(path).toLowerCase().endsWith('.md'));
          },
          read: (path) => readFile(path),
          modify: (path, content) => writeFile(path, content),
          create: (path, content) => createFile(path, content),
          delete: (path) => deleteFile(path),
          rename: (path, newPath) => renameFile(path, newPath),
          onChange: onVaultChange,
          onRename: onVaultRename,
          onDelete: onVaultDelete,
        },
        workspace: {
          getActiveFile: () => createRequest('workspace.activeFile', {}),
          onActiveFileChange,
        },
      },
    },
    registerCommand,
    commands: {
      register: registerCommand,
    },
    panels: {
      register: (panel) => {
        if (!can('ui:panels')) return;
        postMessageSafe({ type: 'registerPanel', panel });
      },
    },
    assets: {
      getUrl: (path) => createRequest('assets.getUrl', { path }),
      readText: (path) => createRequest('assets.readText', { path }),
    },
    annotations: {
      resolveFileId: (filePath) => createRequest('annotations.resolveFileId', { filePath }),
      list: (options = {}) => createRequest('annotations.list', options),
      add: (annotation) => createRequest('annotations.add', { annotation }),
      update: (id, updates) => createRequest('annotations.update', { id, updates }),
      remove: (id) => createRequest('annotations.remove', { id }),
    },
    storage: {
      get: (key) => createRequest('storage.get', { key }),
      set: (key, value) => createRequest('storage.set', { key, value }),
      remove: (key) => createRequest('storage.remove', { key }),
    },
    workspace: {
      listFiles,
      readFile,
      writeFile,
    },
  };
}

function isAllowedHost(hostname) {
  if (!networkAllowlist || networkAllowlist.length === 0) return true;
  const host = hostname.toLowerCase();
  return networkAllowlist.some((entry) => {
    const rule = String(entry || '').toLowerCase();
    if (!rule) return false;
    if (rule.startsWith('*.')) {
      const suffix = rule.slice(1);
      return host === rule.slice(2) || host.endsWith(suffix);
    }
    return host === rule;
  });
}

const originalFetch = typeof fetch === 'function' ? fetch.bind(self) : null;
if (originalFetch) {
  self.fetch = async (input, init) => {
    if (!networkEnabled) {
      postAudit({
        level: 'warn',
        action: 'network-blocked',
        message: 'Network permission denied',
        data: { url: typeof input === 'string' ? input : input?.url },
      });
      throw new Error('Network permission denied');
    }
    const rawUrl = typeof input === 'string' ? input : input?.url;
    if (!rawUrl) {
      throw new Error('Invalid URL');
    }
    const base = self.location?.origin || 'http://localhost';
    let resolved;
    try {
      resolved = new URL(rawUrl, base);
    } catch {
      throw new Error('Invalid URL');
    }
    if (!isAllowedHost(resolved.hostname)) {
      postAudit({
        level: 'warn',
        action: 'network-blocked',
        message: 'Network allowlist blocked',
        data: { url: resolved.href },
      });
      throw new Error('Network allowlist blocked');
    }
    postAudit({
      level: 'info',
      action: 'network-request',
      message: 'Network request',
      data: { url: resolved.href, method: init?.method || 'GET' },
    });
    return originalFetch(input, init);
  };
}

self.onmessage = async (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  if (message.type === 'response') {
    const pendingRequest = pending.get(message.id);
    if (!pendingRequest) return;
    pending.delete(message.id);
    if (message.ok) {
      pendingRequest.resolve(message.result);
    } else {
      pendingRequest.reject(new Error(message.error || 'Request failed'));
    }
    return;
  }

  if (message.type === 'load') {
    try {
      const blob = new Blob([message.code], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      pluginModule = await import(url);
      URL.revokeObjectURL(url);
      postMessageSafe({ type: 'loaded' });
    } catch (error) {
      postMessageSafe({ type: 'error', error: error?.message || String(error) });
    }
    return;
  }

  if (message.type === 'activate') {
    if (!pluginModule?.activate) {
      postMessageSafe({ type: 'error', error: 'Plugin missing activate()' });
      return;
    }
    try {
      networkEnabled = Array.isArray(message.permissions) && message.permissions.includes('network');
      networkAllowlist = Array.isArray(message.networkAllowlist) ? message.networkAllowlist : [];
      const ctx = createContext(message.pluginId, message.platform, message.permissions || []);
      await pluginModule.activate(ctx);
      active = true;
      postMessageSafe({ type: 'activated' });
    } catch (error) {
      postMessageSafe({ type: 'error', error: error?.message || String(error) });
    }
    return;
  }

  if (message.type === 'deactivate') {
    if (!pluginModule?.deactivate) {
      postMessageSafe({ type: 'deactivated' });
      return;
    }
    try {
      await pluginModule.deactivate();
    } catch (error) {
      postMessageSafe({ type: 'error', error: error?.message || String(error) });
      return;
    }
    active = false;
    postMessageSafe({ type: 'deactivated' });
    return;
  }

  if (message.type === 'runCommand') {
    const commandId = message.commandId;
    const runner = commandRegistry.get(commandId);
    if (!runner) {
      postMessageSafe({ type: 'error', error: 'Command not found' });
      return;
    }
    try {
      const result = runner(message.payload);
      if (result && typeof result.then === 'function') {
        await result;
      }
    } catch (error) {
      postMessageSafe({ type: 'error', error: error?.message || String(error) });
    }
  }

  if (message.type === 'updateNetworkAllowlist') {
    networkAllowlist = Array.isArray(message.allowlist) ? message.allowlist : [];
    return;
  }

  if (message.type === 'event' && message.event === 'active-file-change') {
    const path = message.path ?? null;
    for (const callback of activeFileListeners.values()) {
      try {
        callback(path);
      } catch (error) {
        postAudit({
          level: 'warn',
          action: 'active-file-change',
          message: 'Listener failed',
          data: { error: error?.message || String(error) },
        });
      }
    }
    return;
  }

  if (message.type === 'event' && message.event === 'vault-change') {
    const path = message.path ?? '';
    for (const callback of vaultChangeListeners.values()) {
      try {
        callback(path);
      } catch (error) {
        postAudit({
          level: 'warn',
          action: 'vault-change',
          message: 'Listener failed',
          data: { error: error?.message || String(error) },
        });
      }
    }
    return;
  }

  if (message.type === 'event' && message.event === 'vault-rename') {
    const path = message.path ?? '';
    const newPath = message.newPath ?? '';
    for (const callback of vaultRenameListeners.values()) {
      try {
        callback(path, newPath);
      } catch (error) {
        postAudit({
          level: 'warn',
          action: 'vault-rename',
          message: 'Listener failed',
          data: { error: error?.message || String(error) },
        });
      }
    }
    return;
  }

  if (message.type === 'event' && message.event === 'vault-delete') {
    const path = message.path ?? '';
    for (const callback of vaultDeleteListeners.values()) {
      try {
        callback(path);
      } catch (error) {
        postAudit({
          level: 'warn',
          action: 'vault-delete',
          message: 'Listener failed',
          data: { error: error?.message || String(error) },
        });
      }
    }
    return;
  }
};
`;

export class PluginWorkerHost {
  private worker: Worker | null = null;
  private readonly options: PluginWorkerHostOptions;
  private unsubscribeActiveFile: (() => void) | null = null;
  private lastActiveFile: string | null = null;

  constructor(options: PluginWorkerHostOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.worker) return;
    const url = URL.createObjectURL(new Blob([WORKER_CODE], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    this.worker = worker;
    this.startActiveFileListener();

    worker.onmessage = async (event: MessageEvent) => {
      const message = event.data;
      if (!message || typeof message !== 'object') return;

      if (message.type === 'registerCommand') {
        this.options.onRegisterCommand(message.command);
        return;
      }
      if (message.type === 'registerPanel') {
        this.options.onRegisterPanel(message.panel);
        return;
      }
      if (message.type === 'log') {
        this.options.onLog(...(message.args || []));
        return;
      }
      if (message.type === 'error') {
        this.options.onError(message.error ?? 'Worker error');
        return;
      }
      if (message.type === 'audit') {
        this.options.onAudit(message.event);
        return;
      }
      if (message.type === 'request') {
        const request = message as WorkerRequestMessage;
        try {
          const result = await this.options.onRequest(request.action, request.payload);
          const response: WorkerResponseMessage = { type: 'response', id: request.id, ok: true, result };
          worker.postMessage(response);
        } catch (error) {
          const response: WorkerResponseMessage = {
            type: 'response',
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : 'Request failed',
          };
          worker.postMessage(response);
        }
      }
    };

    worker.postMessage({
      type: 'load',
      code: this.options.mainCode,
    });

    worker.postMessage({
      type: 'activate',
      pluginId: this.options.pluginId,
      platform: this.options.platform,
      permissions: this.options.permissions,
      networkAllowlist: this.options.networkAllowlist,
    });
  }

  async runCommand(commandId: string, payload?: unknown): Promise<void> {
    if (!this.worker) return;
    this.worker.postMessage({ type: 'runCommand', commandId, payload });
  }

  updateNetworkAllowlist(allowlist: string[]): void {
    if (!this.worker) return;
    this.worker.postMessage({ type: 'updateNetworkAllowlist', allowlist });
  }

  emitEvent(payload: { type: string; path?: string | null; newPath?: string | null }): void {
    if (!this.worker) return;
    this.worker.postMessage({
      type: 'event',
      event: payload.type,
      path: payload.path ?? null,
      newPath: payload.newPath ?? null,
    });
  }

  async stop(): Promise<void> {
    if (!this.worker) return;
    this.worker.postMessage({ type: 'deactivate' });
    if (this.unsubscribeActiveFile) {
      this.unsubscribeActiveFile();
      this.unsubscribeActiveFile = null;
    }
    this.worker.terminate();
    this.worker = null;
  }

  private startActiveFileListener(): void {
    if (!this.worker) return;
    if (!this.options.permissions.includes('file:read')) return;
    const store = useWorkspaceStore;
    this.lastActiveFile = getActiveFilePath();
    this.worker.postMessage({
      type: 'event',
      event: 'active-file-change',
      path: this.lastActiveFile ?? null,
    });
    this.unsubscribeActiveFile = store.subscribe((state) => {
      const nextPath = state.getActiveTab()?.filePath ?? null;
      if (nextPath === this.lastActiveFile) return;
      this.lastActiveFile = nextPath;
      this.worker?.postMessage({ type: 'event', event: 'active-file-change', path: nextPath });
    });
  }
}

function getActiveFilePath(): string | null {
  const state = useWorkspaceStore.getState();
  const active = state.getActiveTab();
  return active?.filePath ?? null;
}
