import type { PluginPdfSelectionImage, PluginPdfSelectionImageOptions } from "@/lib/plugins/types";
import {t} from '@/lib/i18n';

type Provider = (options: PluginPdfSelectionImageOptions) => Promise<PluginPdfSelectionImage | null> | PluginPdfSelectionImage | null;

let activeProvider: Provider | null = null;
let activeLifetime = new AbortController();

export function setPdfSelectionImageProvider(provider: Provider | null): () => void {
  activeLifetime.abort(new DOMException(t('formula.region.sourceChanged'), 'AbortError'));
  activeLifetime = new AbortController();
  activeProvider = provider;
  return () => {
    if (activeProvider === provider) {
      activeLifetime.abort(new DOMException(t('formula.region.sourceExpired'), 'AbortError'));
      activeProvider = null;
    }
  };
}

export async function getActivePdfSelectionImage(options: PluginPdfSelectionImageOptions = {}): Promise<PluginPdfSelectionImage | null> {
  const provider = activeProvider;
  const signal = AbortSignal.any([activeLifetime.signal, ...(options.signal ? [options.signal] : [])]);
  signal.throwIfAborted();
  const image = await provider?.({ ...options, signal }) ?? null;
  signal.throwIfAborted();
  if (provider !== activeProvider) throw new Error(t('formula.region.sourceChanged'));
  const expected = options.expectedDocument;
  if (image && expected && (!image.document || image.document.filePath !== expected.filePath
    || expected.paneId && image.document.paneId !== expected.paneId
    || expected.tabId && image.document.tabId !== expected.tabId
    || expected.revision && image.document.revision !== expected.revision)) {
    throw new Error(t('formula.region.sourceChanged'));
  }
  return image;
}
