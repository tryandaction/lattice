"use client";

import { getStorageAdapter } from "@/lib/storage-adapter";
import type {
  AnnotationLocationAlias,
  AnnotationRegistryConflict,
  AnnotationRegistryEntry,
} from "@/types/annotation-registry";

const ANNOTATION_REGISTRY_STORAGE_KEY = "lattice-annotation-registry";

interface AnnotationRegistryState {
  entriesByDocumentId: Record<string, AnnotationRegistryEntry>;
  documentIdsByFingerprint: Record<string, string[]>;
  documentIdsByCanonicalPath: Record<string, string[]>;
  conflictsByCanonicalPath: Record<string, AnnotationRegistryConflict>;
}

interface LegacyAnnotationRegistryState {
  entriesByFingerprint?: Record<string, {
    fileFingerprint: string;
    versionFingerprints: string[];
    canonicalPaths: string[];
    aliases: Array<Omit<AnnotationLocationAlias, "documentId">>;
    updatedAt: number;
  }>;
  conflictsByCanonicalPath?: Record<string, AnnotationRegistryConflict>;
}

function createEmptyRegistry(): AnnotationRegistryState {
  return {
    entriesByDocumentId: {},
    documentIdsByFingerprint: {},
    documentIdsByCanonicalPath: {},
    conflictsByCanonicalPath: {},
  };
}

function uniqueStrings(values: Array<string | null | undefined>, limit: number): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).slice(0, limit);
}

function uniqueNullable(values: Array<string | null | undefined>, limit: number): Array<string | null> {
  const result: Array<string | null> = [];
  values.forEach((value) => {
    const normalized = value ?? null;
    if (!result.includes(normalized)) {
      result.push(normalized);
    }
  });
  return result.slice(0, limit);
}

function normalizeAlias(alias: AnnotationLocationAlias): AnnotationLocationAlias {
  return {
    documentId: alias.documentId,
    sourcePath: alias.sourcePath,
    canonicalPath: alias.canonicalPath ?? null,
    relativePathFromRoot: alias.relativePathFromRoot ?? null,
    fileId: alias.fileId,
    workspaceKey: alias.workspaceKey ?? null,
    fileFingerprint: alias.fileFingerprint ?? null,
    versionFingerprint: alias.versionFingerprint ?? null,
    updatedAt: typeof alias.updatedAt === "number" ? alias.updatedAt : Date.now(),
  };
}

function normalizeEntry(entry: AnnotationRegistryEntry): AnnotationRegistryEntry {
  return {
    documentId: entry.documentId,
    fileFingerprints: uniqueStrings(entry.fileFingerprints ?? [], 24),
    versionFingerprints: uniqueStrings(entry.versionFingerprints ?? [], 24),
    canonicalPaths: uniqueStrings(entry.canonicalPaths ?? [], 24),
    aliases: Array.isArray(entry.aliases) ? entry.aliases.map(normalizeAlias).slice(0, 24) : [],
    updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now(),
  };
}

function normalizeConflict(conflict: AnnotationRegistryConflict): AnnotationRegistryConflict {
  return {
    canonicalPath: conflict.canonicalPath,
    contenderDocumentIds: uniqueStrings(conflict.contenderDocumentIds ?? [], 12),
    contenderFingerprints: uniqueStrings(conflict.contenderFingerprints ?? [], 12),
    contenderVersionFingerprints: uniqueStrings(conflict.contenderVersionFingerprints ?? [], 12),
    workspaceKeys: uniqueNullable(conflict.workspaceKeys ?? [], 12),
    status: conflict.status === "resolved" ? "resolved" : "open",
    resolution: conflict.resolution ?? null,
    detectedAt: typeof conflict.detectedAt === "number" ? conflict.detectedAt : Date.now(),
    updatedAt: typeof conflict.updatedAt === "number" ? conflict.updatedAt : Date.now(),
  };
}

function collectAliasesForDocumentIds(
  entriesByDocumentId: Record<string, AnnotationRegistryEntry>,
  documentIds: string[],
): AnnotationLocationAlias[] {
  return documentIds.flatMap((documentId) => entriesByDocumentId[documentId]?.aliases ?? []);
}

function buildConflictRecord(input: {
  existing: AnnotationRegistryConflict | undefined;
  canonicalPath: string;
  contenderDocumentIds: string[];
  contenderFingerprints: Array<string | null>;
  contenderVersionFingerprints: Array<string | null>;
  workspaceKeys: Array<string | null>;
}): AnnotationRegistryConflict {
  const now = Date.now();
  return {
    canonicalPath: input.canonicalPath,
    contenderDocumentIds: uniqueStrings(input.contenderDocumentIds, 12),
    contenderFingerprints: uniqueStrings(input.contenderFingerprints, 12),
    contenderVersionFingerprints: uniqueStrings(input.contenderVersionFingerprints, 12),
    workspaceKeys: uniqueNullable(input.workspaceKeys, 12),
    status: "open",
    resolution: input.existing?.resolution ?? "manual",
    detectedAt: input.existing?.detectedAt ?? now,
    updatedAt: now,
  };
}

function indexDocumentIdsByKey(
  entriesByDocumentId: Record<string, AnnotationRegistryEntry>,
  keySelector: (entry: AnnotationRegistryEntry) => string[],
): Record<string, string[]> {
  const index: Record<string, string[]> = {};
  Object.values(entriesByDocumentId).forEach((entry) => {
    keySelector(entry).forEach((key) => {
      if (!index[key]) {
        index[key] = [];
      }
      if (!index[key].includes(entry.documentId)) {
        index[key].push(entry.documentId);
      }
    });
  });
  return index;
}

function normalizeRegistryState(state: AnnotationRegistryState): AnnotationRegistryState {
  const entriesByDocumentId = Object.fromEntries(
    Object.entries(state.entriesByDocumentId ?? {}).map(([documentId, entry]) => [documentId, normalizeEntry(entry)]),
  );

  return {
    entriesByDocumentId,
    documentIdsByFingerprint: indexDocumentIdsByKey(entriesByDocumentId, (entry) => entry.fileFingerprints),
    documentIdsByCanonicalPath: indexDocumentIdsByKey(entriesByDocumentId, (entry) => entry.canonicalPaths),
    conflictsByCanonicalPath: Object.fromEntries(
      Object.entries(state.conflictsByCanonicalPath ?? {}).map(([canonicalPath, conflict]) => [canonicalPath, normalizeConflict(conflict)]),
    ),
  };
}

function migrateLegacyRegistryState(legacy: LegacyAnnotationRegistryState): AnnotationRegistryState {
  const entriesByDocumentId: Record<string, AnnotationRegistryEntry> = {};

  Object.entries(legacy.entriesByFingerprint ?? {}).forEach(([fileFingerprint, entry]) => {
    const fallbackDocumentId = entry.aliases?.[0]?.fileId || fileFingerprint;
    const aliases = (entry.aliases ?? []).map((alias) => normalizeAlias({
      ...alias,
      documentId: fallbackDocumentId,
      fileFingerprint,
    }));
    entriesByDocumentId[fallbackDocumentId] = normalizeEntry({
      documentId: fallbackDocumentId,
      fileFingerprints: [fileFingerprint],
      versionFingerprints: entry.versionFingerprints ?? [],
      canonicalPaths: entry.canonicalPaths ?? [],
      aliases,
      updatedAt: entry.updatedAt,
    });
  });

  return normalizeRegistryState({
    entriesByDocumentId,
    documentIdsByFingerprint: {},
    documentIdsByCanonicalPath: {},
    conflictsByCanonicalPath: legacy.conflictsByCanonicalPath ?? {},
  });
}

export async function loadAnnotationRegistry(): Promise<AnnotationRegistryState> {
  const storage = getStorageAdapter();
  const loaded = await storage.get<AnnotationRegistryState | LegacyAnnotationRegistryState>(ANNOTATION_REGISTRY_STORAGE_KEY);
  if (!loaded || typeof loaded !== "object") {
    return createEmptyRegistry();
  }

  if ("entriesByDocumentId" in loaded) {
    return normalizeRegistryState(loaded as AnnotationRegistryState);
  }

  return migrateLegacyRegistryState(loaded as LegacyAnnotationRegistryState);
}

export async function saveAnnotationRegistry(state: AnnotationRegistryState): Promise<void> {
  const storage = getStorageAdapter();
  await storage.set(ANNOTATION_REGISTRY_STORAGE_KEY, normalizeRegistryState(state));
}

function updateCanonicalConflictState(
  registry: AnnotationRegistryState,
  canonicalPath: string,
): void {
  const documentIds = registry.documentIdsByCanonicalPath[canonicalPath] ?? [];
  if (documentIds.length <= 1) {
    const existingConflict = registry.conflictsByCanonicalPath[canonicalPath];
    if (!existingConflict) {
      return;
    }

    const aliases = collectAliasesForDocumentIds(registry.entriesByDocumentId, documentIds);
    registry.conflictsByCanonicalPath[canonicalPath] = {
      ...existingConflict,
      contenderDocumentIds: documentIds,
      contenderFingerprints: uniqueStrings(aliases.map((alias) => alias.fileFingerprint ?? null), 12),
      contenderVersionFingerprints: uniqueStrings(aliases.map((alias) => alias.versionFingerprint ?? null), 12),
      workspaceKeys: uniqueNullable(aliases.map((alias) => alias.workspaceKey), 12),
      status: "resolved",
      resolution: existingConflict.resolution ?? "keep-current",
      updatedAt: Date.now(),
    };
    return;
  }

  const aliases = collectAliasesForDocumentIds(registry.entriesByDocumentId, documentIds);
  registry.conflictsByCanonicalPath[canonicalPath] = buildConflictRecord({
    existing: registry.conflictsByCanonicalPath[canonicalPath],
    canonicalPath,
    contenderDocumentIds: documentIds,
    contenderFingerprints: aliases.map((alias) => alias.fileFingerprint ?? null),
    contenderVersionFingerprints: aliases.map((alias) => alias.versionFingerprint ?? null),
    workspaceKeys: aliases.map((alias) => alias.workspaceKey),
  });
}

export async function registerAnnotationLocation(input: {
  documentId: string;
  alias: Omit<AnnotationLocationAlias, "documentId">;
  fileFingerprint?: string | null;
  versionFingerprint?: string | null;
}): Promise<void> {
  const registry = await loadAnnotationRegistry();
  const current = registry.entriesByDocumentId[input.documentId] ?? {
    documentId: input.documentId,
    fileFingerprints: [],
    versionFingerprints: [],
    canonicalPaths: [],
    aliases: [],
    updatedAt: Date.now(),
  };

  const normalizedAlias = normalizeAlias({
    ...input.alias,
    documentId: input.documentId,
    fileFingerprint: input.alias.fileFingerprint ?? input.fileFingerprint ?? null,
    versionFingerprint: input.alias.versionFingerprint ?? input.versionFingerprint ?? null,
  });

  const nextAliases = [
    normalizedAlias,
    ...current.aliases.filter((item) => !(
      item.documentId === normalizedAlias.documentId &&
      item.workspaceKey === normalizedAlias.workspaceKey &&
      item.fileId === normalizedAlias.fileId &&
      item.canonicalPath === normalizedAlias.canonicalPath &&
      item.sourcePath === normalizedAlias.sourcePath
    )),
  ].slice(0, 24);

  registry.entriesByDocumentId[input.documentId] = normalizeEntry({
    documentId: input.documentId,
    fileFingerprints: uniqueStrings([
      input.fileFingerprint,
      normalizedAlias.fileFingerprint,
      ...current.fileFingerprints,
    ], 24),
    versionFingerprints: uniqueStrings([
      input.versionFingerprint,
      normalizedAlias.versionFingerprint,
      ...current.versionFingerprints,
    ], 24),
    canonicalPaths: uniqueStrings([
      normalizedAlias.canonicalPath,
      ...current.canonicalPaths,
    ], 24),
    aliases: nextAliases,
    updatedAt: Date.now(),
  });

  registry.documentIdsByFingerprint = indexDocumentIdsByKey(registry.entriesByDocumentId, (entry) => entry.fileFingerprints);
  registry.documentIdsByCanonicalPath = indexDocumentIdsByKey(registry.entriesByDocumentId, (entry) => entry.canonicalPaths);

  if (normalizedAlias.canonicalPath) {
    updateCanonicalConflictState(registry, normalizedAlias.canonicalPath);
  }

  await saveAnnotationRegistry(registry);
}

export async function removeAnnotationDocumentAliases(input: {
  documentId: string;
  canonicalPath?: string | null;
  workspaceKey?: string | null;
}): Promise<void> {
  const registry = await loadAnnotationRegistry();
  const current = registry.entriesByDocumentId[input.documentId];
  if (!current) {
    return;
  }

  const nextAliases = current.aliases.filter((alias) => {
    if (input.canonicalPath && alias.canonicalPath !== input.canonicalPath) {
      return true;
    }
    if (input.workspaceKey && alias.workspaceKey !== input.workspaceKey) {
      return true;
    }
    return false;
  });

  registry.entriesByDocumentId[input.documentId] = normalizeEntry({
    ...current,
    aliases: nextAliases,
    canonicalPaths: uniqueStrings(nextAliases.map((alias) => alias.canonicalPath), 24),
    fileFingerprints: uniqueStrings(nextAliases.map((alias) => alias.fileFingerprint ?? null).concat(current.fileFingerprints), 24),
  });

  registry.documentIdsByFingerprint = indexDocumentIdsByKey(registry.entriesByDocumentId, (entry) => entry.fileFingerprints);
  registry.documentIdsByCanonicalPath = indexDocumentIdsByKey(registry.entriesByDocumentId, (entry) => entry.canonicalPaths);

  if (input.canonicalPath) {
    updateCanonicalConflictState(registry, input.canonicalPath);
  }

  await saveAnnotationRegistry(registry);
}

export async function resolveAnnotationRegistryMatch(input: {
  fileFingerprint: string | null;
  versionFingerprint?: string | null;
  canonicalPath: string | null;
}): Promise<{
  documentId: string | null;
  aliases: AnnotationLocationAlias[];
  conflict: AnnotationRegistryConflict | null;
  strategy: "fingerprint" | "canonical-path" | "none";
}> {
  const registry = await loadAnnotationRegistry();
  const canonicalPath = input.canonicalPath;
  const conflict = canonicalPath ? registry.conflictsByCanonicalPath[canonicalPath] ?? null : null;

  if (canonicalPath) {
    const canonicalDocumentIds = registry.documentIdsByCanonicalPath[canonicalPath] ?? [];
    if (canonicalDocumentIds.length === 1) {
      const entry = registry.entriesByDocumentId[canonicalDocumentIds[0]];
      const aliases = (entry?.aliases ?? []).filter((alias) => alias.canonicalPath === canonicalPath || alias.canonicalPath == null);
      if (input.versionFingerprint) {
        const versionExact = aliases.filter((alias) => alias.versionFingerprint === input.versionFingerprint);
        if (versionExact.length > 0) {
          return {
            documentId: entry?.documentId ?? null,
            aliases: versionExact,
            conflict,
            strategy: "canonical-path",
          };
        }
      }
      if (aliases.length > 0) {
        return {
          documentId: entry?.documentId ?? null,
          aliases,
          conflict,
          strategy: "canonical-path",
        };
      }
    }
  }

  if (input.fileFingerprint) {
    const fingerprintDocumentIds = registry.documentIdsByFingerprint[input.fileFingerprint] ?? [];
    if (fingerprintDocumentIds.length === 1) {
      const entry = registry.entriesByDocumentId[fingerprintDocumentIds[0]];
      if (entry) {
        return {
          documentId: entry.documentId,
          aliases: entry.aliases,
          conflict,
          strategy: "fingerprint",
        };
      }
    }
  }

  return {
    documentId: null,
    aliases: [],
    conflict,
    strategy: "none",
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
