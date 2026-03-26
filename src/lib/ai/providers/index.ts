import type { AiProvider, AiProviderId } from '../types';
import { openaiProvider } from './openai';
import { anthropicProvider } from './anthropic';
import { googleProvider } from './google';
import { ollamaProvider } from './ollama';
import { deepseekProvider } from './deepseek';
import { moonshotProvider } from './moonshot';
import { zhipuProvider } from './zhipu';
import { customProvider } from './custom';
import { useSettingsStore } from '@/stores/settings-store';

const providers = new Map<AiProviderId, AiProvider>([
  ['openai', openaiProvider],
  ['anthropic', anthropicProvider],
  ['google', googleProvider],
  ['ollama', ollamaProvider],
  ['deepseek', deepseekProvider],
  ['moonshot', moonshotProvider],
  ['zhipu', zhipuProvider],
  ['custom', customProvider],
]);

const providerOverrides = new Map<AiProviderId, AiProvider>();

function getResolvedProviderMap(): Map<AiProviderId, AiProvider> {
  const resolved = new Map(providers);
  providerOverrides.forEach((provider, id) => {
    resolved.set(id, provider);
  });
  return resolved;
}

export function getProvider(id: AiProviderId): AiProvider | null {
  return getResolvedProviderMap().get(id) ?? null;
}

export function getAllProviders(): AiProvider[] {
  return Array.from(getResolvedProviderMap().values());
}

export function getConfiguredProviders(): AiProvider[] {
  return Array.from(getResolvedProviderMap().values()).filter((p) => p.isConfigured());
}

export function getDefaultProvider(): AiProvider | null {
  const resolved = getResolvedProviderMap();
  const preferred = useSettingsStore.getState().settings.aiProvider as AiProviderId | null;
  if (preferred) {
    const p = resolved.get(preferred);
    if (p?.isConfigured()) return p;
  }
  // Legacy fallback for older sessions that stored the preference in localStorage.
  const legacyPreferred = typeof localStorage !== 'undefined'
    ? localStorage.getItem('lattice-ai-provider') as AiProviderId | null
    : null;
  if (legacyPreferred) {
    const p = resolved.get(legacyPreferred);
    if (p?.isConfigured()) return p;
  }
  // Fall back to first configured provider
  for (const p of resolved.values()) {
    if (p.isConfigured()) return p;
  }
  return null;
}

export function setProviderOverride(id: AiProviderId, provider: AiProvider | null): void {
  if (provider) {
    providerOverrides.set(id, provider);
    return;
  }
  providerOverrides.delete(id);
}

export function clearProviderOverrides(): void {
  providerOverrides.clear();
}
