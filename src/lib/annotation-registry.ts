"use client";

import { getStorageAdapter } from "@/lib/storage-adapter";
import type {
  AnnotationLocationAlias,
  AnnotationRegistryConflict,
  AnnotationRegistryEntry,
} from "@/types/annotation-registry";

const ANNOTATION_REGISTRY_STORAGE_KEY = "lattice-annotation-registry";

interface AnnotationRegistryState {
  entriesByFingerprint: Record<string, AnnotationRegistryEntry>;
  conflictsByCanonicalPath: Record<string, AnnotationRegistryConflict>;
}

function createEmptyRegistry(): AnnotationRegistryState {
  return {
    entriesByFingerprint: {},
    conflictsByCanonicalPath: {},
  };
}

function normalizeEntry(entry: AnnotationRegistryEntry): AnnotationRegistryEntry {
  return {
    fileFingerprint: entry.fileFingerprint,
    versionFingerprints: Array.isArray(entry.versionFingerprints) ? entry.versionFingerprints.filter(Boolean).slice(0, 24) : [],
    canonicalPaths: Array.isArray(entry.canonicalPaths) ? entry.canonicalPaths.filter(Boolean).slice(0, 24) : [],
    aliases: Array.isArray(entry.aliases) ? entry.aliases.slice(0, 24) : [],
    updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now(),
  };
}

function normalizeConflict(conflict: AnnotationRegistryConflict): AnnotationRegistryConflict {
  return {
    canonicalPath: conflict.canonicalPath,
    contenderFingerprints: Array.isArray(conflict.contenderFingerprints) ? conflict.contenderFingerprints.filter(Boolean).slice(0, 12) : [],
    contenderVersionFingerprints: Array.isArray(conflict.contenderVersionFingerprints) ? conflict.contenderVersionFingerprints.filter(Boolean).slice(0, 12) : [],
    workspaceKeys: Array.isArray(conflict.workspaceKeys) ? conflict.workspaceKeys.slice(0, 12) : [],
    status: conflict.status === "resolved" ? "resolved" : "open",
    resolution: conflict.resolution ?? null,
    detectedAt: typeof conflict.detectedAt === "number" ? conflict.detectedAt : Date.now(),
    updatedAt: typeof conflict.updatedAt === "number" ? conflict.updatedAt : Date.now(),
  };
}

function uniqueStrings(values: Array<string | null | undefined>, limit: number): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).slice(0, limit);
}

export async function loadAnnotationRegistry(): Promise<AnnotationRegistryState> {
  const storage = getStorageAdapter();
  const loaded = await storage.get<AnnotationRegistryState>(ANNOTATION_REGISTRY_STORAGE_KEY);
  if (!loaded || typeof loaded !== "object") {
    return createEmptyRegistry();
  }

  return {
    entriesByFingerprint: Object.fromEntries(
      Object.entries(loaded.entriesByFingerprint ?? {}).map(([fingerprint, entry]) => [fingerprint, normalizeEntry(entry)]),
    ),
    conflictsByCanonicalPath: Object.fromEntries(
      Object.entries(loaded.conflictsByCanonicalPath ?? {}).map(([canonicalPath, conflict]) => [canonicalPath, normalizeConflict(conflict)]),
    ),
  };
}

export async function saveAnnotationRegistry(state: AnnotationRegistryState): Promise<void> {
  const storage = getStorageAdapter();
  await storage.set(ANNOTATION_REGISTRY_STORAGE_KEY, state);
}

function collectPathOwners(
  entriesByFingerprint: Record<string, AnnotationRegistryEntry>,
  canonicalPath: string,
): string[] {
  return Object.values(entriesByFingerprint)
    .filter((entry) => entry.canonicalPaths.includes(canonicalPath))
    .map((entry) => entry.fileFingerprint);
}

function collectAliasesForFingerprints(
  entriesByFingerprint: Record<string, AnnotationRegistryEntry>,
  fingerprints: string[],
): AnnotationLocationAlias[] {
  return fingerprints.flatMap((fingerprint) => entriesByFingerprint[fingerprint]?.aliases ?? []);
}

function buildConflictRecord(input: {
  existing: AnnotationRegistryConflict | undefined;
  canonicalPath: string;
  contenderFingerprints: string[];
  contenderVersionFingerprints: Array<string | null>;
  workspaceKeys: Array<string | null>;
}): AnnotationRegistryConflict {
  const now = Date.now();
  return {
    canonicalPath: input.canonicalPath,
    contenderFingerprints: uniqueStrings(input.contenderFingerprints, 12),
    contenderVersionFingerprints: uniqueStrings(input.contenderVersionFingerprints, 12),
    workspaceKeys: Array.from(new Set(input.workspaceKeys)).slice(0, 12),
    status: "open",
    resolution: input.existing?.resolution ?? "manual",
    detectedAt: input.existing?.detectedAt ?? now,
    updatedAt: now,
  };
}

export async function registerAnnotationLocation(
  fileFingerprint: string | null,
  alias: AnnotationLocationAlias,
  options?: { versionFingerprint?: string | null },
): Promise<void> {
  if (!fileFingerprint) {
    return;
  }

  const registry = await loadAnnotationRegistry();
  const current = registry.entriesByFingerprint[fileFingerprint] ?? {
    fileFingerprint,
    versionFingerprints: [],
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
    versionFingerprints: uniqueStrings([
      options?.versionFingerprint,
      alias.versionFingerprint,
      ...current.versionFingerprints,
    ], 24),
    canonicalPaths: uniqueStrings([
      alias.canonicalPath,
      ...current.canonicalPaths,
    ], 24),
    aliases: nextAliases,
    updatedAt: Date.now(),
  };

  if (alias.canonicalPath) {
    const owners = collectPathOwners(registry.entriesByFingerprint, alias.canonicalPath);
    if (owners.length > 1) {
      const ownerAliases = collectAliasesForFingerprints(registry.entriesByFingerprint, owners);
      registry.conflictsByCanonicalPath[alias.canonicalPath] = buildConflictRecord({
        existing: registry.conflictsByCanonicalPath[alias.canonicalPath],
        canonicalPath: alias.canonicalPath,
        contenderFingerprints: owners,
        contenderVersionFingerprints: ownerAliases.map((item) => item.versionFingerprint ?? null),
        workspaceKeys: ownerAliases.map((item) => item.workspaceKey),
      });
    } else {
      const existingConflict = registry.conflictsByCanonicalPath[alias.canonicalPath];
      if (existingConflict) {
        registry.conflictsByCanonicalPath[alias.canonicalPath] = {
          ...existingConflict,
          contenderFingerprints: owners,
          contenderVersionFingerprints: uniqueStrings(
            collectAliasesForFingerprints(registry.entriesByFingerprint, owners).map((item) => item.versionFingerprint ?? null),
            12,
          ),
          workspaceKeys: Array.from(new Set(
            collectAliasesForFingerprints(registry.entriesByFingerprint, owners).map((item) => item.workspaceKey),
          )).slice(0, 12),
          status: "resolved",
          resolution: existingConflict.resolution ?? "keep-current",
          updatedAt: Date.now(),
        };
      }
    }
  }

  await saveAnnotationRegistry(registry);
}

export async function resolveAnnotationRegistryMatch(input: {
  fileFingerprint: string | null;
  versionFingerprint?: string | null;
  canonicalPath: string | null;
}): Promise<{
  aliases: AnnotationLocationAlias[];
  conflict: AnnotationRegistryConflict | null;
  strategy: "fingerprint" | "canonical-path" | "none";
}> {
  const registry = await loadAnnotationRegistry();
  const canonicalPath = input.canonicalPath;

  if (input.fileFingerprint) {
    const fingerprintAliases = registry.entriesByFingerprint[input.fileFingerprint]?.aliases ?? [];
    if (fingerprintAliases.length > 0) {
      return {
        aliases: fingerprintAliases,
        conflict: canonicalPath ? registry.conflictsByCanonicalPath[canonicalPath] ?? null : null,
        strategy: "fingerprint",
      };
    }
  }

  if (!canonicalPath) {
    return {
      aliases: [],
      conflict: null,
      strategy: "none",
    };
  }

  const owners = collectPathOwners(registry.entriesByFingerprint, canonicalPath);
  const conflict = registry.conflictsByCanonicalPath[canonicalPath] ?? null;
  if (owners.length !== 1) {
    return {
      aliases: [],
      conflict,
      strategy: "none",
    };
  }

  const ownerEntry = registry.entriesByFingerprint[owners[0]];
  if (!ownerEntry) {
    return {
      aliases: [],
      conflict,
      strategy: "none",
    };
  }

  const matchedAliases = ownerEntry.aliases.filter((alias) => alias.canonicalPath === canonicalPath || alias.canonicalPath == null);
  if (input.versionFingerprint) {
    const versionMatch = matchedAliases.filter((alias) => alias.versionFingerprint === input.versionFingerprint);
    if (versionMatch.length > 0) {
      return {
        aliases: versionMatch,
        conflict,
        strategy: "canonical-path",
      };
    }
  }

  return {
    aliases: matchedAliases,
    conflict,
    strategy: matchedAliases.length > 0 ? "canonical-path" : "none",
  };
}

export async function resolveAnnotationRegistryAliases(input: {
  fileFingerprint: string | null;
  versionFingerprint?: string | null;
  canonicalPath: string | null;
}): Promise<AnnotationLocationAlias[]> {
  const match = await resolveAnnotationRegistryMatch(input);
  return match.aliases;
}
