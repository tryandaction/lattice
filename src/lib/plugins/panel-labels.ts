import {t} from '@/lib/i18n';
import type {PluginPanel} from './types';

/** Localize only our fixed built-in metadata; user/third-party content is unchanged. */
export function localizePluginPanel(panel: PluginPanel): PluginPanel {
  if (panel.id !== 'formula-extractor.results') return panel;
  return {...panel,title:t('formula.panel.title'),schema:{...panel.schema,description:t('formula.panel.description')}};
}
