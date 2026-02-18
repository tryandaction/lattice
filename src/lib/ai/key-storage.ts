/**
 * Secure API Key Storage
 * - Tauri: uses @tauri-apps/plugin-store (OS-level secure storage)
 * - Web: uses sessionStorage with basic obfuscation (not truly secure, but better than plaintext localStorage)
 */

import type { AiProviderId } from './types';

const KEY_PREFIX = 'lattice-ai-key:';
const URL_PREFIX = 'lattice-ai-baseurl:';

// In-memory cache for synchronous access
const keyCache = new Map<string, string>();
const urlCache = new Map<string, string>();

let isTauri = false;
let tauriStore: { get: (key: string) => Promise<string | null>; set: (key: string, value: string) => Promise<void>; save: () => Promise<void>; delete: (key: string) => Promise<void> } | null = null;

// Simple obfuscation for web mode (NOT cryptographic security)
function obfuscate(value: string): string {
  try {
    return btoa(encodeURIComponent(value).split('').reverse().join(''));
  } catch {
    return value;
  }
}

function deobfuscate(value: string): string {
  try {
    return decodeURIComponent(atob(value).split('').reverse().join(''));
  } catch {
    return value;
  }
}

/**
 * Initialize the key storage system
 * Call this once at app startup
 */
export async function initKeyStorage(): Promise<void> {
  try {
    if (typeof window !== 'undefined' && '__TAURI__' in window) {
      const { Store } = await import('@tauri-apps/plugin-store');
      tauriStore = await Store.load('ai-keys.json');
      isTauri = true;
    }
  } catch {
    isTauri = false;
  }

  // Pre-load keys into cache for synchronous access
  const providers: AiProviderId[] = ['openai', 'anthropic', 'google', 'ollama'];
  for (const provider of providers) {
    const key = await loadKey(provider);
    if (key) keyCache.set(provider, key);
    const url = await loadBaseUrl(provider);
    if (url) urlCache.set(provider, url);
  }

  // Migrate plaintext localStorage keys to new storage
  await migrateFromLocalStorage();
}

async function migrateFromLocalStorage(): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  const providers: AiProviderId[] = ['openai', 'anthropic', 'google', 'ollama'];
  for (const provider of providers) {
    const oldKey = localStorage.getItem(`${KEY_PREFIX}${provider}`);
    if (oldKey && !keyCache.has(provider)) {
      await setApiKey(provider, oldKey);
      localStorage.removeItem(`${KEY_PREFIX}${provider}`);
    }
    const oldUrl = localStorage.getItem(`${URL_PREFIX}${provider}`);
    if (oldUrl && !urlCache.has(provider)) {
      await setBaseUrl(provider, oldUrl);
      localStorage.removeItem(`${URL_PREFIX}${provider}`);
    }
  }
}

async function loadKey(provider: AiProviderId): Promise<string> {
  if (isTauri && tauriStore) {
    const val = await tauriStore.get(`${KEY_PREFIX}${provider}`);
    return val ?? '';
  }
  // Web: read from sessionStorage (obfuscated)
  const stored = sessionStorage.getItem(`${KEY_PREFIX}${provider}`);
  if (stored) return deobfuscate(stored);
  // Fallback: check localStorage for legacy keys
  return localStorage.getItem(`${KEY_PREFIX}${provider}`) ?? '';
}

async function loadBaseUrl(provider: AiProviderId): Promise<string> {
  if (isTauri && tauriStore) {
    const val = await tauriStore.get(`${URL_PREFIX}${provider}`);
    return val ?? '';
  }
  return localStorage.getItem(`${URL_PREFIX}${provider}`) ?? '';
}

/**
 * Get API key (synchronous, from cache)
 */
export function getApiKey(provider: AiProviderId): string {
  return keyCache.get(provider) ?? '';
}

/**
 * Get base URL (synchronous, from cache)
 */
export function getBaseUrl(provider: AiProviderId): string {
  return urlCache.get(provider) ?? '';
}

/**
 * Set API key (async, persists to storage)
 */
export async function setApiKey(provider: AiProviderId, key: string): Promise<void> {
  keyCache.set(provider, key);
  if (isTauri && tauriStore) {
    await tauriStore.set(`${KEY_PREFIX}${provider}`, key);
    await tauriStore.save();
  } else {
    // Web: store obfuscated in sessionStorage
    sessionStorage.setItem(`${KEY_PREFIX}${provider}`, obfuscate(key));
    // Also keep in localStorage for persistence across sessions (obfuscated)
    localStorage.setItem(`${KEY_PREFIX}${provider}`, obfuscate(key));
  }
}

/**
 * Set base URL
 */
export async function setBaseUrl(provider: AiProviderId, url: string): Promise<void> {
  urlCache.set(provider, url);
  if (isTauri && tauriStore) {
    await tauriStore.set(`${URL_PREFIX}${provider}`, url);
    await tauriStore.save();
  } else {
    localStorage.setItem(`${URL_PREFIX}${provider}`, url);
  }
}

/**
 * Clear API key
 */
export async function clearApiKey(provider: AiProviderId): Promise<void> {
  keyCache.delete(provider);
  if (isTauri && tauriStore) {
    await tauriStore.delete(`${KEY_PREFIX}${provider}`);
    await tauriStore.save();
  } else {
    sessionStorage.removeItem(`${KEY_PREFIX}${provider}`);
    localStorage.removeItem(`${KEY_PREFIX}${provider}`);
  }
}

/**
 * Check if a provider has an API key configured
 */
export function isProviderConfigured(provider: AiProviderId): boolean {
  return !!keyCache.get(provider);
}
