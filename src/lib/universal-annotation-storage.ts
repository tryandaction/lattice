/**
 * Universal Annotation Storage Utilities
 * 
 * Handles file ID derivation, serialization, and file system operations
 * for storing universal annotations in sidecar JSON files.
 */

import type { 
  UniversalAnnotationFile, 
  AnnotationFileType 
} from '../types/universal-annotation';
import { 
  normalizeUniversalAnnotationFile,
  validateUniversalAnnotationFile 
} from '../types/universal-annotation';
import type { AnnotationLocationAlias, AnnotationSourceRecord } from '@/types/annotation-registry';
import type { FileIdentity } from '@/types/workspace-identity';
import { findAnnotationRegistryFingerprintAliases, registerAnnotationLocation, removeAnnotationDocumentAliases, resolveAnnotationRegistryMatch } from '@/lib/annotation-registry';
import { isIndependentStoredPdf, resolvePdfLocationFileHandle, resolveWorkspaceStorageRoot } from '@/lib/pdf-item-location-registry';

// ============================================================================
// Constants
// ============================================================================

/**
 * Directory name for storing annotation files
 */
export const ANNOTATIONS_DIR = '.lattice/annotations';

/**
 * Current annotation file version
 */
export const ANNOTATION_FILE_VERSION = 3;

// ============================================================================
// FileId Derivation
// ============================================================================

/**
 * Characters that are invalid in filenames across platforms
 */
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

/**
 * Derives a safe fileId from a file path
 * 
 * Converts a file path to a valid filename by:
 * - Replacing path separators with dashes
 * - Replacing spaces with underscores
 * - Removing invalid filename characters
 * 
 * @param filePath - Original file path
 * @returns Safe filename for use as fileId
 */
export function generateFileId(filePath: string): string {
  if (!filePath || filePath.trim().length === 0) {
    throw new Error('File path cannot be empty');
  }

  // Normalize path separators
  const fileId = filePath
    .replace(/\\/g, '/') // Convert Windows backslashes
    .replace(/^\/+/, '') // Remove leading slashes
    .replace(/\/+/g, '-') // Replace path separators with dashes
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(INVALID_FILENAME_CHARS, '') // Remove invalid chars
    .replace(/-+/g, '-') // Collapse multiple dashes
    .replace(/_+/g, '_') // Collapse multiple underscores
    .replace(/^[-_]+/, '') // Remove leading dashes/underscores
    .replace(/[-_]+$/, ''); // Remove trailing dashes/underscores

  // Ensure we have a valid result
  if (fileId.length === 0) {
    throw new Error('File path resulted in empty fileId');
  }

  return fileId;
}

export function resolveAnnotationFileCandidates(
  fileHandleName: string,
  filePath?: string,
  preferredFileId?: string | null,
  rootName?: string,
): string[] {
  const normalizedPath = (filePath && filePath.trim()) ? filePath.replace(/\\/g, "/") : fileHandleName;
  const pathParts = normalizedPath.split("/").filter(Boolean);
  // A suffix is only meaningful inside its own workspace root. In a larger
  // root, paper.pdf may belong to a different document than papers/paper.pdf.
  const suffixCandidates = rootName
    ? [normalizedPath, ...(pathParts[0] === rootName ? [pathParts.slice(1).join("/")] : [])].filter(Boolean)
    : pathParts.map((_, index) => pathParts.slice(index).join("/"));
  const candidates = [
    preferredFileId ?? null,
    ...suffixCandidates.map((candidate) => generateFileId(candidate)),
    ...(rootName ? [] : [generateFileId(fileHandleName)]),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return Array.from(new Set(candidates));
}

/**
 * Gets the annotation file path for a given fileId
 * 
 * @param fileId - The derived file ID
 * @returns Path to the annotation JSON file
 */
export function getAnnotationFilePath(fileId: string): string {
  return `${ANNOTATIONS_DIR}/${fileId}.json`;
}

// ============================================================================
// File Type Detection
// ============================================================================

/**
 * Detects the annotation file type from a file extension
 * 
 * @param filePath - File path or name
 * @returns Detected file type
 */
export function detectFileType(filePath: string): AnnotationFileType {
  const ext = filePath.toLowerCase().split('.').pop() || '';
  
  switch (ext) {
    case 'pdf':
      return 'pdf';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
    case 'bmp':
      return 'image';
    case 'pptx':
    case 'ppt':
      return 'pptx';
    case 'html':
    case 'htm':
      return 'html';
    case 'js':
    case 'ts':
    case 'jsx':
    case 'tsx':
    case 'py':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
    case 'hpp':
    case 'cs':
    case 'go':
    case 'rs':
    case 'rb':
    case 'php':
    case 'swift':
    case 'kt':
    case 'scala':
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'sql':
    case 'json':
    case 'yaml':
    case 'yml':
    case 'xml':
    case 'css':
    case 'scss':
    case 'less':
    case 'md':
    case 'markdown':
      return 'code';
    default:
      return 'unknown';
  }
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serializes a UniversalAnnotationFile to JSON string
 * 
 * @param file - UniversalAnnotationFile to serialize
 * @returns JSON string
 */
export function serializeAnnotationFile(file: UniversalAnnotationFile): string {
  return JSON.stringify(file, null, 2);
}

/**
 * Deserializes a JSON string to UniversalAnnotationFile
 * Returns null for invalid or corrupted data
 * 
 * @param json - JSON string to parse
 * @returns UniversalAnnotationFile or null if invalid
 */
export function deserializeAnnotationFile(json: string): UniversalAnnotationFile | null {
  try {
    const parsed = JSON.parse(json);
    return normalizeUniversalAnnotationFile(parsed);
  } catch {
    return null;
  }
}

/**
 * Safely deserializes with detailed validation
 * Returns validation result with errors if invalid
 * 
 * @param json - JSON string to parse
 * @returns Object with file (or null) and validation errors
 */
export function deserializeAnnotationFileWithValidation(json: string): {
  file: UniversalAnnotationFile | null;
  errors: string[];
} {
  try {
    const parsed = JSON.parse(json);
    const normalized = normalizeUniversalAnnotationFile(parsed);
    const validation = validateUniversalAnnotationFile(normalized);
    
    if (!validation.valid || !normalized) {
      return { file: null, errors: validation.errors };
    }
    
    return { file: normalized, errors: [] };
  } catch (error) {
    return {
      file: null,
      errors: [`JSON parse error: ${error instanceof Error ? error.message : 'Unknown error'}`],
    };
  }
}

// ============================================================================
// File Creation Utilities
// ============================================================================

/**
 * Creates an empty UniversalAnnotationFile
 * 
 * @param fileId - File identifier
 * @param fileType - Type of file being annotated
 * @returns New empty annotation file
 */
export function createUniversalAnnotationFile(
  fileId: string,
  fileType: AnnotationFileType = 'unknown',
  documentId: string = fileId,
): UniversalAnnotationFile {
  return {
    version: 3,
    documentId,
    fileId,
    fileType,
    annotations: [],
    lastModified: Date.now(),
  };
}

// ============================================================================
// File System Operations
// ============================================================================

/**
 * Ensures the annotations directory exists
 * Creates .lattice/annotations/ if it doesn't exist
 * 
 * @param rootHandle - Root directory handle
 * @returns Directory handle for annotations folder
 */
export async function ensureAnnotationsDirectory(
  rootHandle: FileSystemDirectoryHandle
): Promise<FileSystemDirectoryHandle> {
  // Create .lattice directory if needed
  const latticeDir = await rootHandle.getDirectoryHandle('.lattice', { create: true });
  
  // Create annotations subdirectory if needed
  const annotationsDir = await latticeDir.getDirectoryHandle('annotations', { create: true });
  
  return annotationsDir;
}

function normalizeLoadedAnnotationFile(input: {
  annotationFile: UniversalAnnotationFile;
  canonicalFileId: string;
  fileType: AnnotationFileType;
  fallbackDocumentId?: string | null;
}): UniversalAnnotationFile {
  const documentId = (
    input.annotationFile.documentId ||
    input.fallbackDocumentId ||
    input.annotationFile.fileId ||
    input.canonicalFileId
  );

  return {
    ...input.annotationFile,
    version: ANNOTATION_FILE_VERSION,
    documentId,
    fileId: input.canonicalFileId,
    fileType: input.fileType,
  };
}

async function mirrorAnnotationFileToCurrentRoot(input: {
  annotationFile: UniversalAnnotationFile;
  rootHandle: FileSystemDirectoryHandle;
  currentFileId: string;
}): Promise<void> {
  if (input.annotationFile.fileId === input.currentFileId) {
    await saveAnnotationsToDisk(input.annotationFile, input.rootHandle);
    return;
  }

  await saveAnnotationsToDisk({
    ...input.annotationFile,
    fileId: input.currentFileId,
  }, input.rootHandle);
}

function buildAnnotationSourceRecord(input: {
  documentId: string;
  workspaceKey: string | null;
  sourcePath: string;
  sourceKind: AnnotationSourceRecord["sourceKind"];
  fileId: string;
  canonicalPath: string | null;
  relativePathFromRoot: string | null;
  fileFingerprint: string | null;
  versionFingerprint?: string | null;
  updatedAt?: number;
}): AnnotationSourceRecord {
  return {
    documentId: input.documentId,
    workspaceKey: input.workspaceKey,
    sourcePath: input.sourcePath,
    sourceKind: input.sourceKind,
    fileId: input.fileId,
    canonicalPath: input.canonicalPath,
    relativePathFromRoot: input.relativePathFromRoot,
    fileFingerprint: input.fileFingerprint,
    versionFingerprint: input.versionFingerprint ?? null,
    updatedAt: input.updatedAt ?? Date.now(),
  };
}

async function registerCurrentRootAnnotationLocation(input: {
  documentId: string;
  fileIdentity: FileIdentity;
  workspaceKey: string | null;
  fileId: string;
  sourcePath?: string;
}): Promise<void> {
  await registerAnnotationLocation({
    documentId: input.documentId,
    alias: {
      sourcePath: input.sourcePath ?? `${ANNOTATIONS_DIR}/${input.fileId}.json`,
      canonicalPath: input.fileIdentity.canonicalPath,
      relativePathFromRoot: input.fileIdentity.relativePathFromRoot,
      fileId: input.fileId,
      workspaceKey: input.workspaceKey,
      fileFingerprint: input.fileIdentity.fileFingerprint,
      versionFingerprint: input.fileIdentity.versionFingerprint,
      updatedAt: Date.now(),
    },
    fileFingerprint: input.fileIdentity.fileFingerprint,
    versionFingerprint: input.fileIdentity.versionFingerprint,
  });
}

interface NestedAnnotationMatch {
  fileHandle: FileSystemFileHandle;
  source: Omit<AnnotationSourceRecord, "documentId">;
}

function isMissingAnnotationEntry(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

function throwIfRestorationCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Annotation restoration cancelled', 'AbortError');
}

async function loadAnnotationFileHandleFromDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  candidates: string[],
): Promise<{ fileHandle: FileSystemFileHandle; fileId: string } | null> {
  for (const candidate of candidates) {
    try {
      const fileHandle = await directoryHandle.getFileHandle(`${candidate}.json`);
      return { fileHandle, fileId: candidate };
    } catch (error) {
      if (!isMissingAnnotationEntry(error)) throw error;
    }
  }

  return null;
}

async function findNestedAnnotationMatch(
  rootHandle: FileSystemDirectoryHandle,
  workspaceKey: string | null,
  relativeFilePath: string | null,
): Promise<NestedAnnotationMatch | null> {
  // Only ancestors of this file can be former workspace roots. Searching all
  // siblings was both expensive and liable to attach another paper.pdf's notes.
  const parts = (relativeFilePath ?? '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts[0] === rootHandle.name) parts.shift();
  const directories = parts.slice(0, -1);
  if (directories.some((part) => part === '..' || part === '.')) return null;
  let current = rootHandle;
  let sourcePath = rootHandle.name;
  for (const [index, directory] of directories.entries()) {
    try {
      current = await current.getDirectoryHandle(directory);
    } catch (error) {
      if (isMissingAnnotationEntry(error)) return null;
      throw error;
    }
    sourcePath += `/${directory}`;
    try {
      const lattice = await current.getDirectoryHandle('.lattice');
      const annotations = await lattice.getDirectoryHandle('annotations');
      const candidates = resolveAnnotationFileCandidates(
        parts[parts.length - 1],
        parts.slice(index).join('/'),
        null,
        current.name,
      );
      const matched = await loadAnnotationFileHandleFromDirectory(annotations, candidates);
      if (matched) return {
        fileHandle: matched.fileHandle,
        source: {
          workspaceKey,
          sourcePath: `${sourcePath}/${ANNOTATIONS_DIR}/${matched.fileId}.json`,
          sourceKind: 'nested-lattice',
          fileId: matched.fileId,
          canonicalPath: null,
          relativePathFromRoot: null,
          fileFingerprint: null,
          versionFingerprint: null,
          updatedAt: Date.now(),
        },
      };
    } catch (error) {
      if (!isMissingAnnotationEntry(error)) throw error;
    }
  }
  return null;
}

async function tryResolveRegistryAnnotationMatch(
  rootHandle: FileSystemDirectoryHandle,
  aliases: AnnotationLocationAlias[],
  signal?: AbortSignal,
  workspaceKey?: string | null,
  fileIdentity?: FileIdentity,
  requirePhysicalIdentity = false,
): Promise<(NestedAnnotationMatch & { annotationFile: UniversalAnnotationFile; rootHandle: FileSystemDirectoryHandle }) | null> {
  const resolvedRoots = new Map<string | null, FileSystemDirectoryHandle | null>();
  const independentDocuments = new Set<string>();
  for (const alias of aliases) {
    throwIfRestorationCancelled(signal);
    if (!resolvedRoots.has(alias.workspaceKey)) resolvedRoots.set(alias.workspaceKey,
      !alias.workspaceKey || alias.workspaceKey === workspaceKey ? rootHandle : await resolveWorkspaceStorageRoot(alias.workspaceKey));
    const aliasRoot = resolvedRoots.get(alias.workspaceKey);
    if (aliasRoot && fileIdentity && await isIndependentStoredPdf(aliasRoot, alias.relativePathFromRoot, rootHandle, fileIdentity.relativePathFromRoot)) {
      independentDocuments.add(alias.documentId);
    }
  }
  for (const alias of aliases) {
    throwIfRestorationCancelled(signal);
    if (independentDocuments.has(alias.documentId)) continue;
    const normalizedSourcePath = alias.sourcePath;
    if (!normalizedSourcePath) {
      continue;
    }

    const parts = normalizedSourcePath.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length < 2) {
      continue;
    }

    const aliasRoot = resolvedRoots.get(alias.workspaceKey);
    throwIfRestorationCancelled(signal);
    if (!aliasRoot) continue;
    if (requirePhysicalIdentity) {
      const previous = await resolvePdfLocationFileHandle(aliasRoot, alias.relativePathFromRoot);
      const current = await resolvePdfLocationFileHandle(rootHandle, fileIdentity?.relativePathFromRoot ?? null);
      if (!previous || !current || (previous !== current && !(current.isSameEntry && await current.isSameEntry(previous)))) continue;
    }
    if (fileIdentity && await isIndependentStoredPdf(aliasRoot, alias.relativePathFromRoot, rootHandle, fileIdentity.relativePathFromRoot)) continue;
    const relativeParts = parts[0] === aliasRoot.name ? parts.slice(1) : parts;
    if (relativeParts.some(part => part === '..' || part === '.' || part.includes(':'))) continue;
    if (relativeParts.length === 0) {
      continue;
    }

    try {
      let current = aliasRoot;
      for (let index = 0; index < relativeParts.length - 1; index += 1) {
        current = await current.getDirectoryHandle(relativeParts[index]);
      }
      const fileHandle = await current.getFileHandle(relativeParts[relativeParts.length - 1]);
      throwIfRestorationCancelled(signal);
      const file = await fileHandle.getFile();
      throwIfRestorationCancelled(signal);
      const annotationFile = deserializeAnnotationFile(await file.text());
      throwIfRestorationCancelled(signal);
      if (!annotationFile) throw new Error(`Invalid annotation sidecar: ${alias.fileId}.json`);
      // Relative aliases can resolve in a different workspace. The sidecar's
      // stable identity must agree before it can be mirrored into this root.
      if (annotationFile.documentId !== alias.documentId) continue;
      return {
        rootHandle: aliasRoot,
        fileHandle,
        annotationFile,
        source: {
          workspaceKey: alias.workspaceKey,
          sourcePath: normalizedSourcePath,
          sourceKind: "registry",
          fileId: alias.fileId,
          canonicalPath: alias.canonicalPath,
          relativePathFromRoot: alias.relativePathFromRoot,
          fileFingerprint: alias.fileFingerprint ?? null,
          versionFingerprint: alias.versionFingerprint ?? null,
          updatedAt: alias.updatedAt,
        },
      };
    } catch (error) {
      // Alias not available from this root; try next alias.
      if (!isMissingAnnotationEntry(error)) throw error;
    }
  }

  return null;
}

export async function loadAnnotationsForFileIdentity(input: {
  rootHandle: FileSystemDirectoryHandle;
  fileIdentity: FileIdentity;
  workspaceKey: string | null;
  fileType?: AnnotationFileType;
  preferredDocumentId?: string | null;
  preserveSourceRoot?: boolean;
  signal?: AbortSignal;
}): Promise<{
  annotationFile: UniversalAnnotationFile;
  source: AnnotationSourceRecord | null;
  storageRootHandle?: FileSystemDirectoryHandle;
}> {
  throwIfRestorationCancelled(input.signal);
  const fileType = input.fileType ?? 'unknown';
  const fileIdCandidates = Array.from(new Set([
    input.preferredDocumentId,
    input.fileIdentity.primaryFileId,
    ...resolveAnnotationFileCandidates(
      input.fileIdentity.fileName,
      input.fileIdentity.relativePathFromRoot ?? undefined,
      null,
      input.rootHandle.name,
    ),
  ].filter((candidate): candidate is string => Boolean(candidate))));

  try {
    const annotationsDir = await ensureAnnotationsDirectory(input.rootHandle);
    throwIfRestorationCancelled(input.signal);
    const currentMatch = await loadAnnotationFileHandleFromDirectory(annotationsDir, fileIdCandidates);
    throwIfRestorationCancelled(input.signal);
    if (currentMatch) {
      const file = await currentMatch.fileHandle.getFile();
      throwIfRestorationCancelled(input.signal);
      const content = await file.text();
      throwIfRestorationCancelled(input.signal);
      const parsed = deserializeAnnotationFile(content);
      if (!parsed) throw new Error(`Invalid annotation sidecar: ${currentMatch.fileId}.json`);
      if (parsed) {
        // Recover a legacy empty cross-root record only when its document id
        // differs from the established owner. A deliberately cleared document
        // must not have its old annotations resurrected.
        if (input.preserveSourceRoot && parsed.annotations.length === 0) {
          const aliases = input.fileIdentity.fileFingerprint ? await findAnnotationRegistryFingerprintAliases(input.fileIdentity.fileFingerprint) : [];
          throwIfRestorationCancelled(input.signal);
          const recoveries = new Map<string, NonNullable<Awaited<ReturnType<typeof tryResolveRegistryAnnotationMatch>>>>();
          for (const alias of aliases.filter(alias => alias.documentId !== parsed.documentId)) {
            const candidate = await tryResolveRegistryAnnotationMatch(input.rootHandle, [alias], input.signal, input.workspaceKey, input.fileIdentity, true);
            if (candidate?.annotationFile.annotations.length) recoveries.set(candidate.annotationFile.documentId, candidate);
          }
          if (recoveries.size === 1) {
            const recovered = [...recoveries.values()][0];
            await removeAnnotationDocumentAliases({ documentId: parsed.documentId,
              canonicalPath: input.fileIdentity.canonicalPath, workspaceKey: input.workspaceKey });
            throwIfRestorationCancelled(input.signal);
            return { annotationFile: recovered.annotationFile, storageRootHandle: recovered.rootHandle,
              source: buildAnnotationSourceRecord({ documentId: recovered.annotationFile.documentId, ...recovered.source }) };
          }
        }
        const normalized = normalizeLoadedAnnotationFile({
          annotationFile: parsed,
          canonicalFileId: input.fileIdentity.primaryFileId,
          fileType,
        });
        if (
          currentMatch.fileId !== input.fileIdentity.primaryFileId ||
          parsed.fileId !== input.fileIdentity.primaryFileId ||
          parsed.version !== ANNOTATION_FILE_VERSION
        ) {
          await mirrorAnnotationFileToCurrentRoot({
            annotationFile: normalized,
            rootHandle: input.rootHandle,
            currentFileId: input.fileIdentity.primaryFileId,
          });
          throwIfRestorationCancelled(input.signal);
        }
        await registerCurrentRootAnnotationLocation({
          documentId: normalized.documentId,
          fileIdentity: input.fileIdentity,
          workspaceKey: input.workspaceKey,
          fileId: input.fileIdentity.primaryFileId,
        });
        throwIfRestorationCancelled(input.signal);
        return {
          annotationFile: normalized,
          source: buildAnnotationSourceRecord({
            documentId: normalized.documentId,
            workspaceKey: input.workspaceKey,
            sourcePath: `${ANNOTATIONS_DIR}/${input.fileIdentity.primaryFileId}.json`,
            sourceKind: "current-root",
            fileId: input.fileIdentity.primaryFileId,
            canonicalPath: input.fileIdentity.canonicalPath,
            relativePathFromRoot: input.fileIdentity.relativePathFromRoot,
            fileFingerprint: input.fileIdentity.fileFingerprint,
            versionFingerprint: input.fileIdentity.versionFingerprint,
          }),
        };
      }
    }
  } catch (error) {
    // Fall through to registry / nested recovery.
    if (!isMissingAnnotationEntry(error)) throw error;
  }

  const registryMatchCandidate = await resolveAnnotationRegistryMatch({
    fileFingerprint: input.fileIdentity.fileFingerprint,
    versionFingerprint: input.fileIdentity.versionFingerprint,
    canonicalPath: input.fileIdentity.canonicalPath,
  });
  throwIfRestorationCancelled(input.signal);
  let registryMatch = await tryResolveRegistryAnnotationMatch(input.rootHandle, registryMatchCandidate.aliases, input.signal, input.workspaceKey, input.fileIdentity);
  if (!registryMatch && input.preserveSourceRoot && input.fileIdentity.fileFingerprint) {
    // Independent identical copies make the fingerprint index ambiguous. Keep
    // only physically compatible document groups; never choose between two
    // missing owners merely because their bytes match.
    const aliases = await findAnnotationRegistryFingerprintAliases(input.fileIdentity.fileFingerprint);
    const compatible = new Map<string, NonNullable<Awaited<ReturnType<typeof tryResolveRegistryAnnotationMatch>>>>();
    for (const documentId of new Set(aliases.map(alias => alias.documentId))) {
      const matched = await tryResolveRegistryAnnotationMatch(input.rootHandle,
        aliases.filter(alias => alias.documentId === documentId), input.signal, input.workspaceKey, input.fileIdentity);
      if (matched) compatible.set(documentId, matched);
    }
    if (compatible.size === 1) registryMatch = compatible.values().next().value ?? null;
  }
  throwIfRestorationCancelled(input.signal);
  if (registryMatch) {
    try {
      const parsed = registryMatch.annotationFile;
      if (parsed) {
        if (input.preserveSourceRoot) {
          return { annotationFile: parsed, storageRootHandle: registryMatch.rootHandle,
            source: buildAnnotationSourceRecord({ documentId: parsed.documentId, ...registryMatch.source }) };
        }
        const normalized = normalizeLoadedAnnotationFile({
          annotationFile: parsed,
          canonicalFileId: input.fileIdentity.primaryFileId,
          fileType,
          fallbackDocumentId: registryMatchCandidate.documentId,
        });
        await mirrorAnnotationFileToCurrentRoot({
          annotationFile: normalized,
          rootHandle: input.rootHandle,
          currentFileId: input.fileIdentity.primaryFileId,
        });
        throwIfRestorationCancelled(input.signal);
        await registerCurrentRootAnnotationLocation({
          documentId: normalized.documentId,
          fileIdentity: input.fileIdentity,
          workspaceKey: input.workspaceKey,
          fileId: input.fileIdentity.primaryFileId,
        });
        throwIfRestorationCancelled(input.signal);
        return {
          annotationFile: normalized,
          source: buildAnnotationSourceRecord({
            documentId: normalized.documentId,
            ...registryMatch.source,
          }),
        };
      }
    } catch (error) {
      // Ignore stale registry alias.
      if (!isMissingAnnotationEntry(error)) throw error;
    }
  }

  const nestedMatch = await findNestedAnnotationMatch(
    input.rootHandle,
    input.workspaceKey,
    input.fileIdentity.relativePathFromRoot,
  );
  throwIfRestorationCancelled(input.signal);
  if (nestedMatch) {
    try {
      const file = await nestedMatch.fileHandle.getFile();
      throwIfRestorationCancelled(input.signal);
      const parsed = deserializeAnnotationFile(await file.text());
      throwIfRestorationCancelled(input.signal);
      if (!parsed) throw new Error(`Invalid annotation sidecar: ${nestedMatch.source.fileId}.json`);
      if (parsed) {
        const normalized = normalizeLoadedAnnotationFile({
          annotationFile: parsed,
          canonicalFileId: input.fileIdentity.primaryFileId,
          fileType,
        });
        await mirrorAnnotationFileToCurrentRoot({
          annotationFile: normalized,
          rootHandle: input.rootHandle,
          currentFileId: input.fileIdentity.primaryFileId,
        });
        throwIfRestorationCancelled(input.signal);
        await registerCurrentRootAnnotationLocation({
          documentId: normalized.documentId,
          fileIdentity: input.fileIdentity,
          workspaceKey: input.workspaceKey,
          fileId: input.fileIdentity.primaryFileId,
        });
        throwIfRestorationCancelled(input.signal);
        return {
          annotationFile: normalized,
          source: buildAnnotationSourceRecord({
            documentId: normalized.documentId,
            ...nestedMatch.source,
          }),
        };
      }
    } catch (error) {
      // Ignore nested source failure.
      if (!isMissingAnnotationEntry(error)) throw error;
    }
  }

  return {
    annotationFile: createUniversalAnnotationFile(
      input.fileIdentity.primaryFileId,
      fileType,
      input.preferredDocumentId ?? input.fileIdentity.primaryFileId,
    ),
    source: null,
  };
}

/**
 * Loads annotations for a file from disk
 * Returns an empty file only when the sidecar does not exist.
 * Read and validation failures propagate so callers cannot overwrite lost data.
 * 
 * @param fileId - The file ID to load annotations for
 * @param rootHandle - Root directory handle
 * @param fileType - Type of file being annotated
 * @returns UniversalAnnotationFile (empty if not found)
 */
export async function loadAnnotationsFromDisk(
  fileId: string,
  rootHandle: FileSystemDirectoryHandle,
  fileType: AnnotationFileType = 'unknown'
): Promise<UniversalAnnotationFile> {
  try {
    const annotationsDir = await ensureAnnotationsDirectory(rootHandle);
    const fileName = `${fileId}.json`;
    
    try {
      const fileHandle = await annotationsDir.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const content = await file.text();
      
      const annotationFile = deserializeAnnotationFile(content);
      
      if (annotationFile) {
        return annotationFile;
      }
      
      throw new Error(`Invalid annotation sidecar: ${fileName}`);
    } catch (error) {
      // File doesn't exist - return empty
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return createUniversalAnnotationFile(fileId, fileType);
      }
      throw error;
    }
  } catch (error) {
    if (isMissingAnnotationEntry(error)) return createUniversalAnnotationFile(fileId, fileType);
    throw error;
  }
}

/**
 * Saves annotations to disk
 * 
 * @param annotationFile - UniversalAnnotationFile to save
 * @param rootHandle - Root directory handle
 */
export async function saveAnnotationsToDisk(
  annotationFile: UniversalAnnotationFile,
  rootHandle: FileSystemDirectoryHandle
): Promise<void> {
  const annotationsDir = await ensureAnnotationsDirectory(rootHandle);
  const fileName = `${annotationFile.fileId}.json`;
  
  // Update lastModified timestamp
  const fileToSave: UniversalAnnotationFile = {
    ...annotationFile,
    version: ANNOTATION_FILE_VERSION,
    documentId: annotationFile.documentId || annotationFile.fileId,
    lastModified: Date.now(),
  };
  
  const fileHandle = await annotationsDir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  
  try {
    await writable.write(serializeAnnotationFile(fileToSave));
    await writable.close();
  } catch (error) {
    await writable.abort();
    throw error;
  }
}

/**
 * Deletes annotation file from disk
 * 
 * @param fileId - The file ID to delete annotations for
 * @param rootHandle - Root directory handle
 * @returns True if deleted, false if not found
 */
export async function deleteAnnotationsFromDisk(
  fileId: string,
  rootHandle: FileSystemDirectoryHandle
): Promise<boolean> {
  try {
    const annotationsDir = await ensureAnnotationsDirectory(rootHandle);
    const fileName = `${fileId}.json`;
    
    await annotationsDir.removeEntry(fileName);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      return false;
    }
    throw error;
  }
}

async function loadAnnotationFileFromCurrentRootCandidates(
  rootHandle: FileSystemDirectoryHandle,
  candidates: string[],
): Promise<UniversalAnnotationFile | null> {
  const annotationsDir = await ensureAnnotationsDirectory(rootHandle);
  const matched = await loadAnnotationFileHandleFromDirectory(annotationsDir, candidates);
  if (!matched) {
    return null;
  }

  const file = await matched.fileHandle.getFile();
  const parsed = deserializeAnnotationFile(await file.text());
  return parsed ? { ...parsed, fileId: matched.fileId } : null;
}

async function deleteAnnotationCandidatesFromCurrentRoot(
  rootHandle: FileSystemDirectoryHandle,
  candidates: string[],
): Promise<void> {
  for (const candidate of candidates) {
    try {
      await deleteAnnotationsFromDisk(candidate, rootHandle);
    } catch {
      // Ignore missing legacy aliases.
    }
  }
}

export async function moveAnnotationSidecar(
  rootHandle: FileSystemDirectoryHandle,
  oldPath: string,
  newPath: string,
  fileType: AnnotationFileType = "unknown",
): Promise<void> {
  const oldCandidates = resolveAnnotationFileCandidates(oldPath.split("/").pop() ?? oldPath, oldPath, null, rootHandle.name);
  const current = await loadAnnotationFileFromCurrentRootCandidates(rootHandle, oldCandidates);
  if (!current) {
    return;
  }

  const nextFileId = resolveAnnotationFileCandidates(newPath.split("/").pop() ?? newPath, newPath)[0];
  await saveAnnotationsToDisk({
    ...current,
    fileId: nextFileId,
    fileType: current.fileType || fileType,
  }, rootHandle);
  // Remove only the matched old file, never every historical suffix candidate.
  if (current.fileId !== nextFileId) await deleteAnnotationsFromDisk(current.fileId, rootHandle);
}

export async function copyAnnotationSidecar(
  rootHandle: FileSystemDirectoryHandle,
  sourcePath: string,
  targetPath: string,
  fileType: AnnotationFileType = "unknown",
): Promise<void> {
  const sourceCandidates = resolveAnnotationFileCandidates(sourcePath.split("/").pop() ?? sourcePath, sourcePath, null, rootHandle.name);
  const current = await loadAnnotationFileFromCurrentRootCandidates(rootHandle, sourceCandidates);
  if (!current) {
    return;
  }

  const nextFileId = resolveAnnotationFileCandidates(targetPath.split("/").pop() ?? targetPath, targetPath)[0];
  await saveAnnotationsToDisk({
    ...current,
    documentId: nextFileId,
    fileId: nextFileId,
    fileType: current.fileType || fileType,
  }, rootHandle);
}

export async function deleteAnnotationSidecarsForPath(
  rootHandle: FileSystemDirectoryHandle,
  filePath: string,
): Promise<void> {
  const candidates = resolveAnnotationFileCandidates(filePath.split("/").pop() ?? filePath, filePath, null, rootHandle.name);
  await deleteAnnotationCandidatesFromCurrentRoot(rootHandle, candidates);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Creates a debounced save function
 * 
 * @param delay - Debounce delay in milliseconds
 * @returns Debounced save function
 */
export function createDebouncedSave(delay: number = 1000) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let pendingPromise: Promise<void> | null = null;
  let pendingResolve: (() => void) | null = null;
  let pendingReject: ((error: Error) => void) | null = null;

  return async function debouncedSave(
    annotationFile: UniversalAnnotationFile,
    rootHandle: FileSystemDirectoryHandle
  ): Promise<void> {
    // Clear existing timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // Create new promise if none pending
    if (!pendingPromise) {
      pendingPromise = new Promise((resolve, reject) => {
        pendingResolve = resolve;
        pendingReject = reject;
      });
    }

    // Set new timeout
    timeoutId = setTimeout(async () => {
      try {
        await saveAnnotationsToDisk(annotationFile, rootHandle);
        pendingResolve?.();
      } catch (error) {
        pendingReject?.(error instanceof Error ? error : new Error('Save failed'));
      } finally {
        pendingPromise = null;
        pendingResolve = null;
        pendingReject = null;
        timeoutId = null;
      }
    }, delay);

    return pendingPromise;
  };
}

/**
 * Saves with retry logic and exponential backoff
 * 
 * @param annotationFile - UniversalAnnotationFile to save
 * @param rootHandle - Root directory handle
 * @param maxRetries - Maximum number of retry attempts
 * @returns True if saved successfully
 */
export async function saveWithRetry(
  annotationFile: UniversalAnnotationFile,
  rootHandle: FileSystemDirectoryHandle,
  maxRetries: number = 3
): Promise<boolean> {
  let delay = 200; // Initial delay in ms

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await saveAnnotationsToDisk(annotationFile, rootHandle);
      return true;
    } catch (error) {
      console.warn(`Save attempt ${attempt + 1} failed:`, error);
      
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      }
    }
  }

  return false;
}
