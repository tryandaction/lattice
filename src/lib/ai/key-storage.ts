/**
 * Persistent API credentials. Desktop values live in the Tauri app store;
 * browser obfuscation is compatibility encoding, not encryption or a keychain.
 */
import type { Store } from '@tauri-apps/plugin-store';
import type { AiProviderId } from './types';
import { isTauriHost } from '@/lib/storage-adapter';

const KEY_PREFIX = 'lattice-ai-key:';
const URL_PREFIX = 'lattice-ai-baseurl:';
const PROFILE_KEY_PREFIX = 'lattice-ai-profile-key:';
const keyCache = new Map<string, string>();
const urlCache = new Map<string, string>();
let tauriStore: Store | null = null;
let initialization: Promise<void> | null = null;
let writes: Promise<void> = Promise.resolve();

function obfuscate(value: string): string {
  try { return btoa(encodeURIComponent(value).split('').reverse().join('')); }
  catch { return value; }
}
function deobfuscate(value: string): string {
  try { return decodeURIComponent(atob(value).split('').reverse().join('')); }
  catch { return value; }
}
function isCredentialEntry(key: string): boolean {
  return key.startsWith(KEY_PREFIX) || key.startsWith(PROFILE_KEY_PREFIX) || key.startsWith(URL_PREFIX);
}
function publish(key: string, value: string | null) {
  const cache = key.startsWith(URL_PREFIX) ? urlCache : keyCache;
  const cacheKey = key.startsWith(URL_PREFIX) ? key.slice(URL_PREFIX.length)
    : key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : key;
  if (value === null) cache.delete(cacheKey);
  else cache.set(cacheKey, value);
}
function browserEntries(): Map<string, string> {
  const entries = new Map<string, string>();
  // Durable values take precedence over another window's stale session copy.
  for (const storage of [sessionStorage, localStorage]) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !isCredentialEntry(key)) continue;
      const value = storage.getItem(key);
      if (value !== null) entries.set(key, value);
    }
  }
  return entries;
}
function decodeBrowserValue(key: string, value: string): string {
  return key.startsWith(URL_PREFIX) ? value : deobfuscate(value);
}
function removeBrowserCopy(key: string) {
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
}

async function initialize() {
  const legacy = browserEntries();
  const entries = new Map<string, string>();
  if (isTauriHost()) {
    const { Store } = await import('@tauri-apps/plugin-store');
    const store = await Store.load('ai-keys.json', { defaults: {}, autoSave: false });
    const existing = new Map(await store.entries<unknown>());
    const migrated: string[] = [];
    try {
      for (const [key, encoded] of legacy) {
        if (existing.has(key)) continue;
        const value = decodeBrowserValue(key, encoded);
        if (!value) continue;
        await store.set(key, value);
        migrated.push(key);
      }
      // Remove old browser copies only after the desktop store is durable.
      if (legacy.size > 0) await store.save();
    } catch {
      for (const key of migrated) await store.delete(key).catch(() => {});
      throw new Error('API 凭据迁移尚未保存，原配置仍保留，请重试。');
    }
    for (const [key, value] of await store.entries<unknown>()) {
      if (isCredentialEntry(key) && typeof value === 'string') entries.set(key, value);
    }
    tauriStore = store;
    for (const key of legacy.keys()) {
      try { removeBrowserCopy(key); } catch { /* Durable desktop copy already exists. */ }
    }
  } else {
    for (const [key, encoded] of legacy) {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, encoded);
      entries.set(key, decodeBrowserValue(key, encoded));
    }
  }
  keyCache.clear(); urlCache.clear();
  entries.forEach((value, key) => publish(key, value));
}

/** Shared by startup, settings and requests; failed initialization may be retried. */
export function initKeyStorage(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (!initialization) {
    initialization = initialize().catch(() => {
      tauriStore = null;
      initialization = null;
      throw new Error('API 凭据存储暂不可用，配置未清除，请稍后重试。');
    });
  }
  return initialization;
}

async function persist(key: string, value: string | null): Promise<void> {
  await initKeyStorage();
  const pending = writes.catch(() => {}).then(async () => {
    if (tauriStore) {
      const previous = await tauriStore.get<unknown>(key);
      try {
        if (value === null) await tauriStore.delete(key);
        else await tauriStore.set(key, value);
        await tauriStore.save();
      } catch {
        // Keep the last committed credential usable; do not publish a failed edit.
        if (previous === undefined || previous === null) await tauriStore.delete(key).catch(() => {});
        else await tauriStore.set(key, previous).catch(() => {});
        throw new Error('API 凭据未能保存，原配置仍保留，请重试。');
      }
      try { removeBrowserCopy(key); } catch { /* Desktop persistence is authoritative. */ }
    } else {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, key.startsWith(URL_PREFIX) ? value : obfuscate(value));
      } catch {
        throw new Error('API 凭据未能持久保存，请检查本地存储后重试。');
      }
      try {
        if (value === null) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, key.startsWith(URL_PREFIX) ? value : obfuscate(value));
      } catch { /* A session mirror is optional after the durable write succeeds. */ }
    }
    publish(key, value);
  });
  writes = pending;
  await pending;
}

export function getApiKey(provider: AiProviderId): string { return keyCache.get(provider) ?? ''; }
export function getBaseUrl(provider: AiProviderId): string { return urlCache.get(provider) ?? ''; }
export function getProfileApiKey(profileId: string): string { return keyCache.get(PROFILE_KEY_PREFIX + profileId) ?? ''; }
export function isProviderConfigured(provider: AiProviderId): boolean { return Boolean(getApiKey(provider)); }
export function setApiKey(provider: AiProviderId, key: string): Promise<void> { return persist(KEY_PREFIX + provider, key); }
export function setBaseUrl(provider: AiProviderId, url: string): Promise<void> { return persist(URL_PREFIX + provider, url); }
export function clearApiKey(provider: AiProviderId): Promise<void> { return persist(KEY_PREFIX + provider, null); }
export async function setProfileApiKey(profileId: string, key: string): Promise<void> {
  if (profileId.trim()) await persist(PROFILE_KEY_PREFIX + profileId, key);
}
export async function clearProfileApiKey(profileId: string): Promise<void> {
  if (profileId.trim()) await persist(PROFILE_KEY_PREFIX + profileId, null);
}
export async function loadProfileApiKey(profileId: string): Promise<string> {
  await initKeyStorage();
  await writes.catch(() => {});
  const key = PROFILE_KEY_PREFIX + profileId;
  let value: string;
  if (tauriStore) {
    const stored = await tauriStore.get<unknown>(key);
    value = typeof stored === 'string' ? stored : '';
  } else {
    const stored = localStorage.getItem(key) ?? sessionStorage.getItem(key);
    value = stored === null ? '' : deobfuscate(stored);
  }
  publish(key, value);
  return value;
}
