import type { PluginManifest } from './types';
import { validatePluginManifest } from './manifest';

const OPFS_ROOT = 'lattice-plugins';
const INDEX_KEY = 'lattice-plugins:index';

export interface StoredPlugin {
  manifest: PluginManifest;
  main: string;
  meta?: StoredPluginMeta;
}

export interface StoredPluginResource {
  path: string;
  data: string;
}

export interface StoredPluginResourceData {
  bytes: Uint8Array;
  mimeType: string;
}

export interface StoredPluginMeta {
  installedAt: number;
  updatedAt: number;
}

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof window === 'undefined') return null;
  try {
    const storage = (navigator as { storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> } }).storage;
    if (!storage?.getDirectory) return null;
    const root = await storage.getDirectory();
    return await root.getDirectoryHandle(OPFS_ROOT, { create: true });
  } catch (error) {
    console.warn('[plugins] OPFS unavailable, falling back to localStorage', error);
    return null;
  }
}

async function writeTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  content: string
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function readTextFile(
  dir: FileSystemDirectoryHandle,
  name: string
): Promise<string | null> {
  try {
    const handle = await dir.getFileHandle(name);
    const file = await handle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

async function removeDirectory(
  dir: FileSystemDirectoryHandle,
  name: string
): Promise<void> {
  await dir.removeEntry(name, { recursive: true });
}

async function removeDirectoryIfExists(
  dir: FileSystemDirectoryHandle,
  name: string
): Promise<void> {
  try {
    await dir.removeEntry(name, { recursive: true });
  } catch {
    // ignore
  }
}

function getLocalKey(pluginId: string, name: string) {
  return `lattice-plugin:${pluginId}:${name}`;
}

function normalizeResourcePath(path: string): string | null {
  if (typeof path !== 'string') return null;
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized) return null;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.some((part) => part === '..')) return null;
  if (parts[0] !== 'ui' && parts[0] !== 'assets') return null;
  return parts.join('/');
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function getMimeType(path: string): string {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  const ext = lower.slice(dot);
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

async function ensureDirectoryForResource(
  dir: FileSystemDirectoryHandle,
  path: string
): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const normalized = normalizeResourcePath(path);
  if (!normalized) {
    throw new Error('Invalid resource path');
  }
  const parts = normalized.split('/');
  let current = dir;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return { dir: current, name: parts[parts.length - 1] };
}

async function resolveDirectoryForResource(
  dir: FileSystemDirectoryHandle,
  path: string
): Promise<{ dir: FileSystemDirectoryHandle; name: string } | null> {
  const normalized = normalizeResourcePath(path);
  if (!normalized) return null;
  const parts = normalized.split('/');
  let current = dir;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    try {
      current = await current.getDirectoryHandle(part);
    } catch {
      return null;
    }
  }
  return { dir: current, name: parts[parts.length - 1] };
}

async function writeBinaryFile(
  dir: FileSystemDirectoryHandle,
  path: string,
  bytes: Uint8Array
): Promise<void> {
  const target = await ensureDirectoryForResource(dir, path);
  const handle = await target.dir.getFileHandle(target.name, { create: true });
  const writable = await handle.createWritable();
  const safeBuffer = new Uint8Array(bytes).buffer;
  await writable.write(new Blob([safeBuffer]));
  await writable.close();
}

async function readBinaryFile(
  dir: FileSystemDirectoryHandle,
  path: string
): Promise<Uint8Array | null> {
  const target = await resolveDirectoryForResource(dir, path);
  if (!target) return null;
  try {
    const handle = await target.dir.getFileHandle(target.name);
    const file = await handle.getFile();
    const buffer = await file.arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

function parseMeta(raw: string | null): StoredPluginMeta | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPluginMeta>;
    if (
      typeof parsed?.installedAt === 'number' &&
      typeof parsed?.updatedAt === 'number'
    ) {
      return { installedAt: parsed.installedAt, updatedAt: parsed.updatedAt };
    }
  } catch {
    // ignore
  }
  return null;
}

function loadLocalIndex(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveLocalIndex(ids: string[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(INDEX_KEY, JSON.stringify(Array.from(new Set(ids))));
}

export async function listStoredPluginIds(): Promise<string[]> {
  try {
    const opfsRoot = await getOpfsRoot();
    if (!opfsRoot) {
      return loadLocalIndex();
    }

    const ids: string[] = [];
    for await (const entry of opfsRoot.values()) {
      if (entry.kind === 'directory') {
        ids.push(entry.name);
      }
    }
    return ids;
  } catch (error) {
    console.warn('[plugins] Failed to list OPFS plugins, falling back', error);
    return loadLocalIndex();
  }
}

export async function loadStoredPlugin(pluginId: string): Promise<StoredPlugin | null> {
  try {
    const opfsRoot = await getOpfsRoot();
    if (!opfsRoot) {
      if (typeof window === 'undefined') return null;
      const manifestRaw = localStorage.getItem(getLocalKey(pluginId, 'manifest'));
      const main = localStorage.getItem(getLocalKey(pluginId, 'main'));
      const meta = parseMeta(localStorage.getItem(getLocalKey(pluginId, 'meta')));
      if (!manifestRaw || !main) return null;
      const manifestParsed = JSON.parse(manifestRaw);
      const validation = validatePluginManifest(manifestParsed);
      if (!validation.valid || !validation.manifest) return null;
      return { manifest: validation.manifest, main, meta: meta ?? undefined };
    }

    const pluginDir = await opfsRoot.getDirectoryHandle(pluginId, { create: false });
    const manifestRaw = await readTextFile(pluginDir, 'manifest.json');
    const main = await readTextFile(pluginDir, 'main.js');
    const metaRaw = await readTextFile(pluginDir, 'meta.json');
    if (!manifestRaw || !main) return null;

    const validation = validatePluginManifest(JSON.parse(manifestRaw));
    if (!validation.valid || !validation.manifest) return null;
    return { manifest: validation.manifest, main, meta: parseMeta(metaRaw) ?? undefined };
  } catch (error) {
    console.warn('[plugins] Failed to load plugin from OPFS, falling back', error);
    return null;
  }
}

export async function storePluginPackage(
  pluginId: string,
  manifest: PluginManifest,
  main: string,
  resources: Record<string, string> = {}
): Promise<void> {
  const existing = await loadStoredPluginMeta(pluginId);
  const now = Date.now();
  const nextMeta: StoredPluginMeta = {
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
  };
  const normalizedResources: Record<string, string> = {};
  for (const [path, data] of Object.entries(resources)) {
    const normalized = normalizeResourcePath(path);
    if (!normalized) continue;
    normalizedResources[normalized] = data;
  }
  const opfsRoot = await getOpfsRoot();
  if (!opfsRoot) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(getLocalKey(pluginId, 'manifest'), JSON.stringify(manifest));
    localStorage.setItem(getLocalKey(pluginId, 'main'), main);
    localStorage.setItem(getLocalKey(pluginId, 'meta'), JSON.stringify(nextMeta));
    localStorage.setItem(getLocalKey(pluginId, 'resources'), JSON.stringify(normalizedResources));
    const next = loadLocalIndex();
    next.push(pluginId);
    saveLocalIndex(next);
    return;
  }

  try {
    const pluginDir = await opfsRoot.getDirectoryHandle(pluginId, { create: true });
    await writeTextFile(pluginDir, 'manifest.json', JSON.stringify(manifest, null, 2));
    await writeTextFile(pluginDir, 'main.js', main);
    await writeTextFile(pluginDir, 'meta.json', JSON.stringify(nextMeta, null, 2));
    await removeDirectoryIfExists(pluginDir, 'ui');
    await removeDirectoryIfExists(pluginDir, 'assets');
    for (const [path, data] of Object.entries(normalizedResources)) {
      const bytes = decodeBase64ToBytes(data);
      await writeBinaryFile(pluginDir, path, bytes);
    }
  } catch (error) {
    console.warn('[plugins] Failed to write OPFS plugin, falling back', error);
    if (typeof window === 'undefined') return;
    localStorage.setItem(getLocalKey(pluginId, 'manifest'), JSON.stringify(manifest));
    localStorage.setItem(getLocalKey(pluginId, 'main'), main);
    localStorage.setItem(getLocalKey(pluginId, 'meta'), JSON.stringify(nextMeta));
    localStorage.setItem(getLocalKey(pluginId, 'resources'), JSON.stringify(normalizedResources));
    const next = loadLocalIndex();
    next.push(pluginId);
    saveLocalIndex(next);
  }
}

export async function loadStoredPluginResource(
  pluginId: string,
  path: string
): Promise<StoredPluginResourceData | null> {
  const normalized = normalizeResourcePath(path);
  if (!normalized) return null;
  const mimeType = getMimeType(normalized);
  try {
    const opfsRoot = await getOpfsRoot();
    if (!opfsRoot) {
      if (typeof window === 'undefined') return null;
      const raw = localStorage.getItem(getLocalKey(pluginId, 'resources'));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Record<string, string>;
      const data = parsed?.[normalized];
      if (!data) return null;
      return { bytes: decodeBase64ToBytes(data), mimeType };
    }
    const pluginDir = await opfsRoot.getDirectoryHandle(pluginId, { create: false });
    const bytes = await readBinaryFile(pluginDir, normalized);
    if (!bytes) return null;
    return { bytes, mimeType };
  } catch (error) {
    console.warn('[plugins] Failed to load plugin resource, falling back', error);
    return null;
  }
}

export async function removeStoredPlugin(pluginId: string): Promise<void> {
  const opfsRoot = await getOpfsRoot();
  if (!opfsRoot) {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(getLocalKey(pluginId, 'manifest'));
    localStorage.removeItem(getLocalKey(pluginId, 'main'));
    localStorage.removeItem(getLocalKey(pluginId, 'meta'));
    localStorage.removeItem(getLocalKey(pluginId, 'resources'));
    const next = loadLocalIndex().filter((id) => id !== pluginId);
    saveLocalIndex(next);
    return;
  }

  try {
    await removeDirectory(opfsRoot, pluginId);
  } catch (error) {
    console.warn('[plugins] Failed to remove OPFS plugin, falling back', error);
    if (typeof window === 'undefined') return;
    localStorage.removeItem(getLocalKey(pluginId, 'manifest'));
    localStorage.removeItem(getLocalKey(pluginId, 'main'));
    localStorage.removeItem(getLocalKey(pluginId, 'meta'));
    localStorage.removeItem(getLocalKey(pluginId, 'resources'));
    const next = loadLocalIndex().filter((id) => id !== pluginId);
    saveLocalIndex(next);
  }
}

async function loadStoredPluginMeta(pluginId: string): Promise<StoredPluginMeta | null> {
  try {
    const opfsRoot = await getOpfsRoot();
    if (!opfsRoot) {
      if (typeof window === 'undefined') return null;
      return parseMeta(localStorage.getItem(getLocalKey(pluginId, 'meta')));
    }
    const pluginDir = await opfsRoot.getDirectoryHandle(pluginId, { create: false });
    const metaRaw = await readTextFile(pluginDir, 'meta.json');
    return parseMeta(metaRaw);
  } catch {
    return null;
  }
}
