"use client";

import { getStorageAdapter } from "@/lib/storage-adapter";
import type { AnnotationLocationAlias, AnnotationRegistryEntry } from "@/types/annotation-registry";

const ANNOTATION_REGISTRY_STORAGE_KEY = "lattice-annotation-registry";

interface AnnotationRegistryState {
  entriesByFingerprint: Record<string, AnnotationRegistryEntry>;
}

function createEmptyRegistry(): AnnotationRegistryState {
  return {
    entriesByFingerprint: {},
  };
}

export async function loadAnnotationRegistry(): Promise<AnnotationRegistryState> {
  const storage = getStorageAdapter();
  const loaded = await storage.get<AnnotationRegistryState>(ANNOTATION_REGISTRY_STORAGE_KEY);
  if (!loaded || typeof loaded !== "object") {
    return createEmptyRegistry();
  }

  return {
    entriesByFingerprint: loaded.entriesByFingerprint ?? {},
  };
}

export async function saveAnnotationRegistry(state: AnnotationRegistryState): Promise<void> {
  const storage = getStorageAdapter();
  await storage.set(ANNOTATION_REGISTRY_STORAGE_KEY, state);
}

export async function registerAnnotationLocation(
  fileFingerprint: string | null,
  alias: AnnotationLocationAlias,
): Promise<void> {
  if (!fileFingerprint) {
    return;
  }

  const registry = await loadAnnotationRegistry();
  const current = registry.entriesByFingerprint[fileFingerprint] ?? {
    fileFingerprint,
    canonicalPaths: [],
    aliases: [],
    updatedAt: Date.now(),
  };

  const nextAliases = [
    alias,
    ...current.aliases.filter((item) => !(
      item.workspaceKey === alias.workspaceKey &&
      item.fileId === alias.fileId &&
      item.canonicalPath === alias.canonicalPath &&
      item.sourcePath === alias.sourcePath
    )),
  ].slice(0, 24);

  registry.entriesByFingerprint[fileFingerprint] = {
    fileFingerprint,
    canonicalPaths: Array.from(new Set([
      ...(alias.canonicalPath ? [alias.canonicalPath] : []),
      ...current.canonicalPaths,
    ])).slice(0, 24),
    aliases: nextAliases,
    updatedAt: Date.now(),
  };

  await saveAnnotationRegistry(registry);
}

export async function resolveAnnotationRegistryAliases(input: {
  fileFingerprint: string | null;
  canonicalPath: string | null;
}): Promise<AnnotationLocationAlias[]> {
  const registry = await loadAnnotationRegistry();
  const canonicalPath = input.canonicalPath;
  const fingerprintAliases = input.fileFingerprint
    ? registry.entriesByFingerprint[input.fileFingerprint]?.aliases ?? []
    : [];

  if (canonicalPath) {
    const pathAliases = Object.values(registry.entriesByFingerprint)
      .filter((entry) => entry.canonicalPaths.includes(canonicalPath))
      .flatMap((entry) => entry.aliases);
    return [...fingerprintAliases, ...pathAliases];
  }

  return fingerprintAliases;
}
