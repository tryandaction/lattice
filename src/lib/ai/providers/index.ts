import type { AiProvider, AiProviderId } from '../types';
import { openaiProvider } from './openai';
import { anthropicProvider } from './anthropic';
import { googleProvider } from './google';
import { ollamaProvider } from './ollama';
import { deepseekProvider } from './deepseek';
import { moonshotProvider } from './moonshot';
import { zhipuProvider } from './zhipu';
import { customProvider } from './custom';
import { createOpenAiCompatibleProvider } from './openai-compatible';
import { useSettingsStore } from '@/stores/settings-store';
import { useAiProviderProfileStore } from '@/stores/ai-provider-profile-store';
import { createProfiledProvider } from '../profiled-provider';

const providers = new Map<AiProviderId, AiProvider>([
  ['openai', openaiProvider],
  ['anthropic', anthropicProvider],
  ['google', googleProvider],
  ['ollama', ollamaProvider],
  ['deepseek', deepseekProvider],
  ['moonshot', moonshotProvider],
  ['zhipu', zhipuProvider],
  ['custom', customProvider],
  ['openrouter', createOpenAiCompatibleProvider({ id: 'openrouter', name: 'OpenRouter', defaultBaseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4.1-mini', models: [] })],
  ['groq', createOpenAiCompatibleProvider({ id: 'groq', name: 'Groq', defaultBaseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', models: [] })],
  ['together', createOpenAiCompatibleProvider({ id: 'together', name: 'Together AI', defaultBaseUrl: 'https://api.together.xyz/v1', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', models: [] })],
  ['fireworks', createOpenAiCompatibleProvider({ id: 'fireworks', name: 'Fireworks AI', defaultBaseUrl: 'https://api.fireworks.ai/inference/v1', defaultModel: 'accounts/fireworks/models/llama-v3p1-70b-instruct', models: [] })],
  ['siliconflow', createOpenAiCompatibleProvider({ id: 'siliconflow', name: 'SiliconFlow', defaultBaseUrl: 'https://api.siliconflow.cn/v1', defaultModel: 'Qwen/Qwen2.5-72B-Instruct', models: [] })],
  ['azure-openai', createOpenAiCompatibleProvider({ id: 'azure-openai', name: 'Azure OpenAI', defaultBaseUrl: 'https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT', defaultModel: 'YOUR_DEPLOYMENT', models: [] })],
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

export function getProfileProvider(profileId: string): AiProvider | null {
  const profile = useAiProviderProfileStore.getState().profiles.find((candidate) => candidate.id === profileId);
  return profile ? createProfiledProvider(profile) : null;
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
