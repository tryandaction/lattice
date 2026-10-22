import { create } from 'zustand';
import type { PluginManifest } from '@/lib/plugins/types';
import { installPluginFromDirectory, installPluginFromZip } from '@/lib/plugins/installer';
import { listStoredPluginIds, loadStoredPlugin, removeStoredPlugin } from '@/lib/plugins/repository';
import { useSettingsStore } from '@/stores/settings-store';
import { withTimeout } from '@/lib/async-task-guard';
import { deactivatePluginById } from '@/lib/plugins/runtime';

export interface InstalledPlugin {
  manifest: PluginManifest;
  installedAt: number;
  updatedAt: number;
}

interface PluginStoreState {
  plugins: InstalledPlugin[];
  isLoading: boolean;
  error: string | null;

  loadPlugins: () => Promise<void>;
  installFromZip: (file: File) => Promise<void>;
  installFromDirectory: (handle: FileSystemDirectoryHandle) => Promise<void>;
  removePlugin: (pluginId: string) => Promise<void>;
}

async function persistPluginAuthorization(
  updates: Parameters<ReturnType<typeof useSettingsStore.getState>['updateSettings']>[0],
): Promise<void> {
  const settings = useSettingsStore.getState();
  const persisted = await settings.updateSettings(updates);
  if (persisted === false) {
    throw new Error(useSettingsStore.getState().error ?? 'Failed to persist plugin authorization');
  }
}

async function revokePluginAuthorization(pluginId: string): Promise<{
  enabled: boolean;
  trusted: boolean;
}> {
  const before = useSettingsStore.getState().settings;
  const enabled = before.enabledPlugins.includes(pluginId);
  const trusted = before.trustedPlugins.includes(pluginId);
  if (enabled || trusted) {
    await persistPluginAuthorization({
      enabledPlugins: before.enabledPlugins.filter((id) => id !== pluginId),
      trustedPlugins: before.trustedPlugins.filter((id) => id !== pluginId),
    });
  }
  return { enabled, trusted };
}

async function restorePluginAuthorization(pluginId: string, previous: { enabled: boolean; trusted: boolean }) {
  const current = useSettingsStore.getState().settings;
  await persistPluginAuthorization({
    enabledPlugins: previous.enabled
      ? Array.from(new Set([...current.enabledPlugins, pluginId]))
      : current.enabledPlugins.filter((id) => id !== pluginId),
    trustedPlugins: previous.trusted
      ? Array.from(new Set([...current.trustedPlugins, pluginId]))
      : current.trustedPlugins.filter((id) => id !== pluginId),
  });
}

async function preparePluginReplacement(pluginId: string): Promise<{
  enabled: boolean;
  trusted: boolean;
}> {
  const previous = await revokePluginAuthorization(pluginId);
  try {
    await deactivatePluginById(pluginId);
    return previous;
  } catch (error) {
    try {
      await restorePluginAuthorization(pluginId, previous);
    } catch {
      // Keep the original error; settings-store retains its own error for
      // recovery and the package is not written below.
    }
    throw error;
  }
}

export const usePluginStore = create<PluginStoreState>((set, _get) => ({
  plugins: [],
  isLoading: false,
  error: null,

  loadPlugins: async () => {
    if (usePluginStore.getState().isLoading) return;
    set({ isLoading: true, error: null });
    try {
      const ids = await withTimeout(listStoredPluginIds(),8000,'Plugin refresh');
      const loaded: InstalledPlugin[] = [];
      for (const id of ids) {
        const stored = await withTimeout(loadStoredPlugin(id),4000,`Plugin ${id} metadata load`);
        if (!stored) continue;
        loaded.push({
          manifest: stored.manifest,
          installedAt: stored.meta?.installedAt ?? Date.now(),
          updatedAt: stored.meta?.updatedAt ?? Date.now(),
        });
      }
      set({ plugins: loaded, isLoading: false, error: null });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load plugins',
        isLoading: false,
      });
    }
  },

  installFromZip: async (file) => {
    let previousAuthorization: { enabled: boolean; trusted: boolean } | null = null;
    let pluginId: string | null = null;
    let writeStarted = false;
    try {
      set({ error: null });
      // The installer validates the manifest before writing, so parse/install
      // is the first point where the ID is known. The runtime authorization is
      // revoked immediately before the package write to avoid old trust being
      // inherited by a replacement package.
      const result = await installPluginFromZip(file, {
        beforeStore: async (id) => {
          pluginId = id;
          previousAuthorization = await preparePluginReplacement(id);
        },
        onStoreStart: () => { writeStarted = true; },
      });
      set((state) => {
        const existing = state.plugins.filter((p) => p.manifest.id !== result.manifest.id);
        return {
          plugins: [
            ...existing,
            { manifest: result.manifest, installedAt: Date.now(), updatedAt: Date.now() },
          ],
        };
      });
    } catch (error) {
      if (!writeStarted && pluginId && previousAuthorization) {
        try { await restorePluginAuthorization(pluginId, previousAuthorization); } catch { /* preserve original failure */ }
      }
      set({ error: error instanceof Error ? error.message : 'Failed to install plugin' });
      throw error;
    }
  },

  installFromDirectory: async (handle) => {
    let previousAuthorization: { enabled: boolean; trusted: boolean } | null = null;
    let pluginId: string | null = null;
    let writeStarted = false;
    try {
      set({ error: null });
      const result = await installPluginFromDirectory(handle, {
        beforeStore: async (id) => {
          pluginId = id;
          previousAuthorization = await preparePluginReplacement(id);
        },
        onStoreStart: () => { writeStarted = true; },
      });
      set((state) => {
        const existing = state.plugins.filter((p) => p.manifest.id !== result.manifest.id);
        return {
          plugins: [
            ...existing,
            { manifest: result.manifest, installedAt: Date.now(), updatedAt: Date.now() },
          ],
        };
      });
    } catch (error) {
      if (!writeStarted && pluginId && previousAuthorization) {
        try { await restorePluginAuthorization(pluginId, previousAuthorization); } catch { /* preserve original failure */ }
      }
      set({ error: error instanceof Error ? error.message : 'Failed to install plugin' });
      throw error;
    }
  },

  removePlugin: async (pluginId) => {
    const previousAuthorization = await revokePluginAuthorization(pluginId);
    try {
      await deactivatePluginById(pluginId);
      await removeStoredPlugin(pluginId);
      set((state) => ({
        plugins: state.plugins.filter((p) => p.manifest.id !== pluginId),
      }));
    } catch (error) {
      try { await restorePluginAuthorization(pluginId, previousAuthorization); } catch { /* preserve original failure */ }
      throw error;
    }
  },
}));
