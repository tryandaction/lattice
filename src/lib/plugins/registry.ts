import type { PluginManifest, PluginModule } from './types';
import { helloPlugin } from '@/plugins/core/hello-plugin';
import { panelDemoPlugin } from '@/plugins/core/panel-demo';
import { wordCountPlugin } from '@/plugins/core/word-count';
import { tableOfContentsPlugin } from '@/plugins/core/table-of-contents';
import { markdownLinterPlugin } from '@/plugins/core/markdown-linter';
import { codeFormatterPlugin } from '@/plugins/core/code-formatter';
import { templateLibraryPlugin } from '@/plugins/core/template-library';
import { citationManagerPlugin } from '@/plugins/core/citation-manager';

const registry = new Map<string, PluginModule>([
  [helloPlugin.manifest.id, helloPlugin],
  [panelDemoPlugin.manifest.id, panelDemoPlugin],
  [wordCountPlugin.manifest.id, wordCountPlugin],
  [tableOfContentsPlugin.manifest.id, tableOfContentsPlugin],
  [markdownLinterPlugin.manifest.id, markdownLinterPlugin],
  [codeFormatterPlugin.manifest.id, codeFormatterPlugin],
  [templateLibraryPlugin.manifest.id, templateLibraryPlugin],
  [citationManagerPlugin.manifest.id, citationManagerPlugin],
]);

export function getAvailablePlugins(): PluginManifest[] {
  return Array.from(registry.values()).map((plugin) => plugin.manifest);
}

export function getPluginModule(id: string): PluginModule | null {
  return registry.get(id) ?? null;
}
