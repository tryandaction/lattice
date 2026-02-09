import JSZip from 'jszip';
import type { PluginManifest } from './types';
import { validatePluginManifest } from './manifest';
import { storePluginPackage } from './repository';

export interface PluginInstallResult {
  manifest: PluginManifest;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...Array.from(slice));
  }
  return btoa(binary);
}

async function readZipFile(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  if (!file) return null;
  return await file.async('text');
}

async function collectZipResources(
  zip: JSZip,
  prefix: 'ui' | 'assets'
): Promise<Record<string, string>> {
  const resources: Record<string, string> = {};
  const files = zip.file(new RegExp(`^${prefix}/`));
  for (const file of files) {
    if (file.dir) continue;
    const data = await file.async('base64');
    resources[file.name] = data;
  }
  return resources;
}

async function collectDirectoryResources(
  handle: FileSystemDirectoryHandle,
  prefix: 'ui' | 'assets'
): Promise<Record<string, string>> {
  const resources: Record<string, string> = {};
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await handle.getDirectoryHandle(prefix);
  } catch {
    return resources;
  }
  const walk = async (current: FileSystemDirectoryHandle, currentPath: string) => {
    for await (const entry of current.values()) {
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        const data = arrayBufferToBase64(await file.arrayBuffer());
        resources[`${currentPath}/${entry.name}`] = data;
      } else if (entry.kind === 'directory') {
        await walk(entry, `${currentPath}/${entry.name}`);
      }
    }
  };
  await walk(dir, prefix);
  return resources;
}

export async function installPluginFromZip(file: File): Promise<PluginInstallResult> {
  const zip = await JSZip.loadAsync(file);
  const manifestRaw = await readZipFile(zip, 'manifest.json');
  if (!manifestRaw) {
    throw new Error('manifest.json not found in plugin package');
  }

  const validation = validatePluginManifest(JSON.parse(manifestRaw));
  if (!validation.valid || !validation.manifest) {
    throw new Error(`Invalid manifest: ${validation.errors.join('; ')}`);
  }

  const manifest = validation.manifest;
  const mainPath = manifest.main || 'main.js';
  const mainCode = await readZipFile(zip, mainPath);
  if (!mainCode) {
    throw new Error(`Main entry not found: ${mainPath}`);
  }

  const resources = {
    ...(await collectZipResources(zip, 'ui')),
    ...(await collectZipResources(zip, 'assets')),
  };

  await storePluginPackage(manifest.id, manifest, mainCode, resources);
  return { manifest };
}

export async function installPluginFromDirectory(
  handle: FileSystemDirectoryHandle
): Promise<PluginInstallResult> {
  const manifestHandle = await handle.getFileHandle('manifest.json');
  const manifestText = await (await manifestHandle.getFile()).text();
  const validation = validatePluginManifest(JSON.parse(manifestText));
  if (!validation.valid || !validation.manifest) {
    throw new Error(`Invalid manifest: ${validation.errors.join('; ')}`);
  }

  const manifest = validation.manifest;
  const mainPath = manifest.main || 'main.js';
  const mainHandle = await handle.getFileHandle(mainPath);
  const mainCode = await (await mainHandle.getFile()).text();

  const resources = {
    ...(await collectDirectoryResources(handle, 'ui')),
    ...(await collectDirectoryResources(handle, 'assets')),
  };

  await storePluginPackage(manifest.id, manifest, mainCode, resources);
  return { manifest };
}
