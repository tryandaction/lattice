import type { AiProvider, AiProviderId } from '../types';
import { openaiProvider } from './openai';
import { anthropicProvider } from './anthropic';
import { googleProvider } from './google';
import { ollamaProvider } from './ollama';

const providers = new Map<AiProviderId, AiProvider>([
  ['openai', openaiProvider],
  ['anthropic', anthropicProvider],
  ['google', googleProvider],
  ['ollama', ollamaProvider],
]);

export function getProvider(id: AiProviderId): AiProvider | null {
  return providers.get(id) ?? null;
}

export function getAllProviders(): AiProvider[] {
  return Array.from(providers.values());
}

export function getConfiguredProviders(): AiProvider[] {
  return Array.from(providers.values()).filter((p) => p.isConfigured());
}

export function getDefaultProvider(): AiProvider | null {
  // Check stored preference
  const preferred = localStorage.getItem('lattice-ai-provider') as AiProviderId | null;
  if (preferred) {
    const p = providers.get(preferred);
    if (p?.isConfigured()) return p;
  }
  // Fall back to first configured provider
  for (const p of providers.values()) {
    if (p.isConfigured()) return p;
  }
  return null;
}
