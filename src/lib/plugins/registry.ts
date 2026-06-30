import type { PluginManifest, PluginModule } from './types';
import { formulaExtractorPlugin } from '@/plugins/formula-extractor';
import { DEFAULT_ENABLED_PLUGIN_IDS as DEFAULT_PLUGIN_IDS } from '@/lib/plugins/defaults';

const registry = new Map<string, PluginModule>([
  [formulaExtractorPlugin.manifest.id, formulaExtractorPlugin],
]);

export const DEFAULT_ENABLED_PLUGIN_IDS = DEFAULT_PLUGIN_IDS.filter((id) => (
  registry.get(id)?.manifest.defaultEnabled
));

export function getAvailablePlugins(): PluginManifest[] {
  return Array.from(registry.values()).map((plugin) => plugin.manifest);
}

export function getRecommendedPlugins(): PluginManifest[] {
  return Array.from(registry.values())
    .map((plugin) => plugin.manifest)
    .filter((manifest) => manifest.recommended);
}

export function getPluginModule(id: string): PluginModule | null {
  return registry.get(id) ?? null;
}
