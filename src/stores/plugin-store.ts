import { create } from 'zustand';
import type { PluginManifest } from '@/lib/plugins/types';
import { installPluginFromDirectory, installPluginFromZip } from '@/lib/plugins/installer';
import { listStoredPluginIds, loadStoredPlugin, removeStoredPlugin } from '@/lib/plugins/repository';
import { useSettingsStore } from '@/stores/settings-store';

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

export const usePluginStore = create<PluginStoreState>((set, _get) => ({
  plugins: [],
  isLoading: false,
  error: null,

  loadPlugins: async () => {
    try {
      set({ isLoading: true, error: null });
      const ids = await listStoredPluginIds();
      const loaded: InstalledPlugin[] = [];
      for (const id of ids) {
        const stored = await loadStoredPlugin(id);
        if (!stored) continue;
        loaded.push({
          manifest: stored.manifest,
          installedAt: stored.meta?.installedAt ?? Date.now(),
          updatedAt: stored.meta?.updatedAt ?? Date.now(),
        });
      }
      set({ plugins: loaded, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load plugins',
        isLoading: false,
      });
    }
  },

  installFromZip: async (file) => {
    try {
      set({ error: null });
      const result = await installPluginFromZip(file);
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
      set({ error: error instanceof Error ? error.message : 'Failed to install plugin' });
      throw error;
    }
  },

  installFromDirectory: async (handle) => {
    try {
      set({ error: null });
      const result = await installPluginFromDirectory(handle);
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
      set({ error: error instanceof Error ? error.message : 'Failed to install plugin' });
      throw error;
    }
  },

  removePlugin: async (pluginId) => {
    await removeStoredPlugin(pluginId);
    set((state) => ({
      plugins: state.plugins.filter((p) => p.manifest.id !== pluginId),
    }));

    const settings = useSettingsStore.getState();
    const enabled = settings.settings.enabledPlugins.filter((id) => id !== pluginId);
    const trusted = settings.settings.trustedPlugins.filter((id) => id !== pluginId);
    await settings.updateSettings({ enabledPlugins: enabled, trustedPlugins: trusted });
  },
}));
