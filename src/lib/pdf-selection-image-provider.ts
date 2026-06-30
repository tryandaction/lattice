import type { PluginPdfSelectionImage } from "@/lib/plugins/types";

type Provider = () => Promise<PluginPdfSelectionImage | null> | PluginPdfSelectionImage | null;

let activeProvider: Provider | null = null;

export function setPdfSelectionImageProvider(provider: Provider | null): () => void {
  activeProvider = provider;
  return () => {
    if (activeProvider === provider) {
      activeProvider = null;
    }
  };
}

export async function getActivePdfSelectionImage(): Promise<PluginPdfSelectionImage | null> {
  return await activeProvider?.() ?? null;
}
