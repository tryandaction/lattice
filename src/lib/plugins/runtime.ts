import { isTauri } from '@/lib/storage-adapter';
import { getPluginModule } from './registry';
import type { PluginCommand, PluginContext, PluginModule } from './types';

const activePlugins = new Map<string, PluginModule>();
const commands = new Map<string, PluginCommand>();

function createContext(pluginId: string): PluginContext {
  return {
    app: {
      platform: isTauri() ? 'desktop' : 'web',
    },
    log: (...args: unknown[]) => {
      // eslint-disable-next-line no-console
      console.log(`[plugin:${pluginId}]`, ...args);
    },
    registerCommand: (command) => {
      if (!command?.id) return;
      commands.set(command.id, command);
    },
  };
}

async function activatePlugin(plugin: PluginModule): Promise<void> {
  if (activePlugins.has(plugin.manifest.id)) return;
  const ctx = createContext(plugin.manifest.id);
  await plugin.activate(ctx);
  activePlugins.set(plugin.manifest.id, plugin);
}

async function deactivatePlugin(plugin: PluginModule): Promise<void> {
  if (!activePlugins.has(plugin.manifest.id)) return;
  if (plugin.deactivate) {
    await plugin.deactivate();
  }
  activePlugins.delete(plugin.manifest.id);
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
    commands.clear();
    return;
  }

  const targetIds = new Set(options.enabledPluginIds);
  const toDeactivate = Array.from(activePlugins.keys()).filter((id) => !targetIds.has(id));
  for (const id of toDeactivate) {
    const plugin = activePlugins.get(id);
    if (plugin) {
      await deactivatePlugin(plugin);
    }
  }

  for (const id of targetIds) {
    const plugin = getPluginModule(id);
    if (!plugin) continue;
    await activatePlugin(plugin);
  }
}

export function getRegisteredCommands(): PluginCommand[] {
  return Array.from(commands.values());
}
