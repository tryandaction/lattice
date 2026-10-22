"use client";

import { createDesktopDirectoryHandle } from "@/lib/desktop-file-system";
import { getDesktopHandlePath } from "@/lib/desktop-file-system";
import { isExistingDesktopDirectory } from "@/lib/desktop-folder";
import { getStorageAdapter, isTauri, type StorageAdapter } from "@/lib/storage-adapter";
import { findWorkspaceHandleRegistration, loadWorkspaceHandleRegistration } from "@/lib/workspace-identity";
import { withStorageMutation } from "@/lib/storage-mutation-queue";

const PDF_ITEM_LOCATION_STORAGE_KEY = "lattice-pdf-item-locations";

export interface PdfItemLocation {
  documentId: string;
  fileFingerprint: string | null;
  workspaceKey: string | null;
  desktopRootPath: string | null;
  pdfPath: string;
  itemFolderPath: string;
  updatedAt: number;
}

interface PdfItemLocationRegistryState {
  version: 1;
  locationsByDocumentId: Record<string, PdfItemLocation>;
  previousLocationsByDocumentId?: Record<string, PdfItemLocation[]>;
}

function createEmptyRegistry(): PdfItemLocationRegistryState {
  return {
    version: 1,
    locationsByDocumentId: {},
    previousLocationsByDocumentId: {},
  };
}

function normalizeLocation(location: PdfItemLocation): PdfItemLocation {
  return {
    documentId: location.documentId,
    fileFingerprint: location.fileFingerprint || null,
    workspaceKey: location.workspaceKey || null,
    desktopRootPath: location.desktopRootPath?.replace(/\\/g, "/").replace(/\/+$/, "") || null,
    pdfPath: location.pdfPath?.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") || "",
    itemFolderPath: location.itemFolderPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""),
    updatedAt: Number.isFinite(location.updatedAt) ? location.updatedAt : Date.now(),
  };
}

async function loadRegistry(storage: StorageAdapter): Promise<PdfItemLocationRegistryState> {
  const loaded = storage.getStrict ? await storage.getStrict<PdfItemLocationRegistryState>(PDF_ITEM_LOCATION_STORAGE_KEY)
    : await storage.get<PdfItemLocationRegistryState>(PDF_ITEM_LOCATION_STORAGE_KEY);
  if (!loaded || loaded.version !== 1 || !loaded.locationsByDocumentId) {
    return createEmptyRegistry();
  }

  return {
    version: 1,
    locationsByDocumentId: Object.fromEntries(
      Object.entries(loaded.locationsByDocumentId)
        .filter(([documentId, location]) => Boolean(documentId && location?.itemFolderPath))
        .map(([documentId, location]) => [documentId, normalizeLocation({ ...location, documentId })]),
    ),
    previousLocationsByDocumentId: Object.fromEntries(Object.entries(loaded.previousLocationsByDocumentId ?? {}).map(([id, locations]) =>
      [id, (Array.isArray(locations) ? locations : []).filter(location => location?.itemFolderPath).map(normalizeLocation).slice(0, 24)])),
  };
}

export async function registerPdfItemLocation(
  input: Omit<PdfItemLocation, "updatedAt"> & { updatedAt?: number },
  options: { storage?: StorageAdapter } = {},
): Promise<PdfItemLocation> {
  const storage = options.storage ?? getStorageAdapter();
  return withStorageMutation(storage, PDF_ITEM_LOCATION_STORAGE_KEY, async () => {
  const registry = await loadRegistry(storage);
  const location = normalizeLocation({
    ...input,
    updatedAt: input.updatedAt ?? Date.now(),
  });
  const previous = registry.locationsByDocumentId[location.documentId];
  const locationKey = (entry: PdfItemLocation) => `${entry.workspaceKey ?? entry.desktopRootPath}\n${entry.itemFolderPath}`;
  registry.previousLocationsByDocumentId ??= {};
  registry.previousLocationsByDocumentId[location.documentId] = [
    ...(previous ? [previous] : []), ...(registry.previousLocationsByDocumentId[location.documentId] ?? []),
  ].filter((entry, index, entries) => locationKey(entry) !== locationKey(location)
    && entries.findIndex(candidate => locationKey(candidate) === locationKey(entry)) === index).slice(0, 24);
  registry.locationsByDocumentId[location.documentId] = location;
  if (storage.setStrict) await storage.setStrict(PDF_ITEM_LOCATION_STORAGE_KEY, registry);
  else await storage.set(PDF_ITEM_LOCATION_STORAGE_KEY, registry);
  return location;
  });
}

export async function registerPdfItemLocationForRoot(
  rootHandle: FileSystemDirectoryHandle,
  manifest: {
    itemId: string;
    fileFingerprint: string | null;
    pdfPath: string;
    itemFolderPath: string;
  },
  options: { workspaceKey?: string | null } = {},
): Promise<PdfItemLocation> {
  const registeredWorkspace = options.workspaceKey
    ? null
    : await findWorkspaceHandleRegistration(rootHandle);
  return registerPdfItemLocation({
    documentId: manifest.itemId,
    fileFingerprint: manifest.fileFingerprint,
    workspaceKey: options.workspaceKey ?? registeredWorkspace?.workspaceKey ?? null,
    desktopRootPath: getDesktopHandlePath(rootHandle),
    pdfPath: manifest.pdfPath,
    itemFolderPath: manifest.itemFolderPath,
  });
}

export async function removePdfItemLocation(
  documentId: string,
  options: { storage?: StorageAdapter } = {},
): Promise<void> {
  const storage = options.storage ?? getStorageAdapter();
  return withStorageMutation(storage, PDF_ITEM_LOCATION_STORAGE_KEY, async () => {
  const registry = await loadRegistry(storage);
  if (!(documentId in registry.locationsByDocumentId)) return;
  delete registry.locationsByDocumentId[documentId];
  delete registry.previousLocationsByDocumentId?.[documentId];
  if (storage.setStrict) await storage.setStrict(PDF_ITEM_LOCATION_STORAGE_KEY, registry);
  else await storage.set(PDF_ITEM_LOCATION_STORAGE_KEY, registry);
  });
}

export async function resolvePdfItemLocation(
  input: { documentId?: string | null; fileFingerprint?: string | null },
  options: { storage?: StorageAdapter } = {},
): Promise<PdfItemLocation | null> {
  const storage = options.storage ?? getStorageAdapter();
  const registry = await loadRegistry(storage);
  if (input.documentId) {
    return registry.locationsByDocumentId[input.documentId] ?? null;
  }
  if (!input.fileFingerprint) {
    return null;
  }

  const matches = Object.values(registry.locationsByDocumentId)
    .filter((location) => location.fileFingerprint === input.fileFingerprint);
  return matches.length === 1 ? matches[0] : null;
}

/** Candidates only. Callers must establish the physical PDF identity before combining children. */
export async function resolvePdfItemLocationCandidates(
  input: { documentId?: string | null; fileFingerprint?: string | null },
  options: { storage?: StorageAdapter } = {},
): Promise<PdfItemLocation[]> {
  const registry = await loadRegistry(options.storage ?? getStorageAdapter());
  const candidates = [...Object.values(registry.locationsByDocumentId), ...Object.values(registry.previousLocationsByDocumentId ?? {}).flat()]
    .filter(location => Boolean(input.documentId && location.documentId === input.documentId)
      || Boolean(input.fileFingerprint && location.fileFingerprint === input.fileFingerprint));
  return candidates.filter((location, index) => candidates.findIndex(other => other.workspaceKey === location.workspaceKey
    && other.desktopRootPath === location.desktopRootPath && other.itemFolderPath === location.itemFolderPath) === index);
}

/** Fingerprints locate moved files, but must not merge two still-existing independent PDFs. */
export async function resolvePdfLocationFileHandle(root: FileSystemDirectoryHandle, path: string | null): Promise<FileSystemFileHandle | null> {
    const parts = (path ?? '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (!parts.length || parts.some(part => part === '..' || part === '.' || part.includes(':'))) return null;
    const candidates = parts[0] === root.name ? [parts, parts.slice(1)] : [parts];
    for (const candidate of candidates) {
      if (!candidate.length) continue;
      try {
        let directory = root;
        for (const part of candidate.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
        return await directory.getFileHandle(candidate.at(-1)!);
      } catch (error) {
        if (error instanceof Error && error.name !== 'NotFoundError') throw error;
      }
    }
    return null;
}

export async function isIndependentStoredPdf(
  storedRoot: FileSystemDirectoryHandle, storedPath: string | null,
  currentRoot: FileSystemDirectoryHandle, currentPath: string,
  currentHandle?: FileSystemFileHandle | null,
): Promise<boolean> {
  const previous = await resolvePdfLocationFileHandle(storedRoot, storedPath);
  const current = currentHandle ?? await resolvePdfLocationFileHandle(currentRoot, currentPath);
  if (!previous || !current) return false;
  if (previous === current) return false;
  if (typeof current.isSameEntry === 'function') return !await current.isSameEntry(previous);
  if (typeof previous.isSameEntry === 'function') return !await previous.isSameEntry(current);
  return true;
}

export async function resolvePdfItemLocationRoot(
  location: PdfItemLocation,
  options: {
    loadWorkspaceRegistration?: typeof loadWorkspaceHandleRegistration;
    requestPermission?: boolean;
  } = {},
): Promise<FileSystemDirectoryHandle | null> {
  return resolveWorkspaceStorageRoot(location.workspaceKey, { ...options, desktopRootPath: location.desktopRootPath });
}

/** Resolve a storage path against the workspace that recorded it, never the active workspace. */
export async function resolveWorkspaceStorageRoot(
  workspaceKey: string | null,
  options: {
    desktopRootPath?: string | null;
    loadWorkspaceRegistration?: typeof loadWorkspaceHandleRegistration;
    requestPermission?: boolean;
  } = {},
): Promise<FileSystemDirectoryHandle | null> {
  const desktopRootPath = options.desktopRootPath ?? (workspaceKey?.startsWith('desktop:') ? workspaceKey.slice('desktop:'.length) : null);
  if (desktopRootPath && isTauri()) {
    try {
      if (await isExistingDesktopDirectory(desktopRootPath)) {
        return createDesktopDirectoryHandle(desktopRootPath);
      }
    } catch {
      // Fall through to a registered browser handle when available.
    }
  }

  const loadRegistration = options.loadWorkspaceRegistration ?? loadWorkspaceHandleRegistration;
  const registered = await loadRegistration(workspaceKey);
  if (!registered) {
    return null;
  }

  try {
    let permission = await registered.handle.queryPermission?.({ mode: "readwrite" });
    if (permission === "prompt" && options.requestPermission) {
      permission = await registered.handle.requestPermission?.({ mode: "readwrite" });
    }
    if (permission && permission !== "granted") {
      return null;
    }
  } catch {
    return null;
  }
  return registered.handle;
}
