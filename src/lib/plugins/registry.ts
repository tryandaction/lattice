import type { PluginManifest, PluginModule } from './types';
import { helloPlugin } from '@/plugins/core/hello-plugin';
import { panelDemoPlugin } from '@/plugins/core/panel-demo';

const registry = new Map<string, PluginModule>([
  [helloPlugin.manifest.id, helloPlugin],
  [panelDemoPlugin.manifest.id, panelDemoPlugin],
]);

export function getAvailablePlugins(): PluginManifest[] {
  return Array.from(registry.values()).map((plugin) => plugin.manifest);
}

export function getPluginModule(id: string): PluginModule | null {
  return registry.get(id) ?? null;
}
