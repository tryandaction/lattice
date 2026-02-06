import type { PluginManifest, PluginModule } from './types';
import { helloPlugin } from '@/plugins/core/hello-plugin';

const registry = new Map<string, PluginModule>([
  [helloPlugin.manifest.id, helloPlugin],
]);

export function getAvailablePlugins(): PluginManifest[] {
  return Array.from(registry.values()).map((plugin) => plugin.manifest);
}

export function getPluginModule(id: string): PluginModule | null {
  return registry.get(id) ?? null;
}
