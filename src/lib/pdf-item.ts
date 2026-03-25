"use client";

import {
  createEmptyNotebook,
  generateUniqueName,
  getParentPath,
  joinPath,
  resolveDirectoryHandle,
  sanitizeFileName,
} from "@/lib/file-operations";
import {
  buildRelativeWorkspacePath,
  normalizeWorkspacePath,
} from "@/lib/link-router/path-utils";
import {
  deleteAnnotationsFromDisk,
  generateFileId,
  loadAnnotationsFromDisk,
  saveAnnotationsToDisk,
} from "@/lib/universal-annotation-storage";
import type { AnnotationBacklink } from "@/lib/annotation-backlinks";
import type { AnnotationItem, UniversalAnnotationFile } from "@/types/universal-annotation";

const PDF_ITEM_MANIFEST_VERSION = 3;
const PDF_ITEM_MANIFEST_NAME = "manifest.json";
const LEGACY_PDF_ITEMS_DIR = ".lattice/pdf-items";
const LEGACY_OVERVIEW_NOTE_NAME = "_overview.md";
const DEFAULT_ANNOTATIONS_NOTE_NAME = "_annotations.md";

interface LegacyPdfItemManifest {
  version: 1;
  fileId: string;
  pdfPath: string;
  itemFolderPath: string;
  annotationNotePath: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PdfItemManifest {
  version: 3;
  itemId: string;
  pdfPath: string;
  itemFolderPath: string;
  annotationIndexPath: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PdfItemNoteSummary {
  path: string;
  fileName: string;
  type: "note" | "notebook" | "annotation-note";
  handle?: FileSystemFileHandle;
}

function isLegacyPdfItemManifest(value: unknown): value is LegacyPdfItemManifest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    typeof candidate.fileId === "string" &&
    typeof candidate.pdfPath === "string" &&
    typeof candidate.itemFolderPath === "string" &&
    (typeof candidate.annotationNotePath === "string" || candidate.annotationNotePath === null) &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.updatedAt === "number"
  );
}

function isPdfItemManifest(value: unknown): value is PdfItemManifest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    (candidate.version === 2 || candidate.version === PDF_ITEM_MANIFEST_VERSION) &&
    typeof candidate.itemId === "string" &&
    typeof candidate.pdfPath === "string" &&
    typeof candidate.itemFolderPath === "string" &&
    (candidate.annotationIndexPath === null || typeof candidate.annotationIndexPath === "string") &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.updatedAt === "number"
  );
}

function getPdfFileName(pdfPath: string): string {
  const normalized = normalizeWorkspacePath(pdfPath);
  return normalized.split("/").pop() ?? "document.pdf";
}

function getPdfBaseName(pdfPath: string): string {
  const fileName = getPdfFileName(pdfPath);
  return fileName.replace(/\.pdf$/i, "") || "PDF";
}

export function getDefaultPdfItemFolderPath(pdfPath: string): string {
  const normalizedPdfPath = normalizeWorkspacePath(pdfPath);
  const parentPath = getParentPath(normalizedPdfPath);
  const rawBaseName = sanitizeFileName(getPdfBaseName(normalizedPdfPath)) || "PDF";
  return joinPath(parentPath, `.${rawBaseName}.lattice`);
}

export function getLegacyPdfItemFolderPath(pdfPath: string): string {
  const normalizedPdfPath = normalizeWorkspacePath(pdfPath);
  const parentPath = getParentPath(normalizedPdfPath);
  const rawBaseName = sanitizeFileName(getPdfBaseName(normalizedPdfPath)) || "PDF";
  return joinPath(parentPath, `${rawBaseName}.item`);
}

function getLegacyPdfItemManifestPath(fileId: string): string {
  return `${LEGACY_PDF_ITEMS_DIR}/${fileId}.json`;
}

function getPdfItemManifestPath(itemFolderPath: string): string {
  return joinPath(itemFolderPath, PDF_ITEM_MANIFEST_NAME);
}

function getPdfItemAnnotationIndexPath(itemFolderPath: string): string {
  return joinPath(itemFolderPath, DEFAULT_ANNOTATIONS_NOTE_NAME);
}

function normalizePdfItemManifest(input: {
  itemId: string;
  pdfPath: string;
  itemFolderPath: string;
  annotationIndexPath?: string | null;
  createdAt?: number;
  updatedAt?: number;
}): PdfItemManifest {
  const normalizedPdfPath = normalizeWorkspacePath(input.pdfPath);
  const normalizedFolderPath = normalizeWorkspacePath(input.itemFolderPath);
  const createdAt = input.createdAt ?? Date.now();
  return {
    version: 3,
    itemId: input.itemId,
    pdfPath: normalizedPdfPath,
    itemFolderPath: normalizedFolderPath,
    annotationIndexPath: input.annotationIndexPath === undefined
      ? null
      : input.annotationIndexPath
        ? normalizeWorkspacePath(input.annotationIndexPath)
        : null,
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  };
}

function createDefaultPdfItemManifest(fileId: string, pdfPath: string): PdfItemManifest {
  return normalizePdfItemManifest({
    itemId: fileId,
    pdfPath,
    itemFolderPath: getDefaultPdfItemFolderPath(pdfPath),
  });
}

async function ensureNestedDirectory(
  rootHandle: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemDirectoryHandle> {
  const parts = normalizeWorkspacePath(path).split("/").filter(Boolean);
  let current = rootHandle;
  const startIndex = parts[0] === rootHandle.name ? 1 : 0;

  for (let index = startIndex; index < parts.length; index += 1) {
    current = await current.getDirectoryHandle(parts[index], { create: true });
  }

  return current;
}

async function getFileHandleForPath(
  rootHandle: FileSystemDirectoryHandle,
  filePath: string,
): Promise<FileSystemFileHandle | null> {
  const normalizedPath = normalizeWorkspacePath(filePath);
  const parentPath = getParentPath(normalizedPath);
  const fileName = normalizedPath.split("/").pop();
  if (!fileName) {
    return null;
  }

  const parentHandle = await resolveDirectoryHandle(rootHandle, parentPath);
  if (!parentHandle) {
    return null;
  }

  try {
    return await parentHandle.getFileHandle(fileName);
  } catch {
    return null;
  }
}

async function readTextFile(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile();
  return file.text();
}

async function readTextFileIfExists(
  rootHandle: FileSystemDirectoryHandle,
  filePath: string,
): Promise<string | null> {
  const handle = await getFileHandleForPath(rootHandle, filePath);
  if (!handle) {
    return null;
  }
  return readTextFile(handle);
}

async function writeTextFile(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
  content: string,
): Promise<FileSystemFileHandle> {
  const handle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
  return handle;
}

async function removeDirectoryIfExists(
  rootHandle: FileSystemDirectoryHandle,
  directoryPath: string,
): Promise<void> {
  const normalizedPath = normalizeWorkspacePath(directoryPath);
  const parentPath = getParentPath(normalizedPath);
  const directoryName = normalizedPath.split("/").pop();
  if (!directoryName) {
    return;
  }

  const parentHandle = await resolveDirectoryHandle(rootHandle, parentPath);
  if (!parentHandle) {
    return;
  }

  try {
    await parentHandle.removeEntry(directoryName, { recursive: true });
  } catch {
    // Ignore missing folders during migration/cleanup.
  }
}

async function removeFileIfExists(
  rootHandle: FileSystemDirectoryHandle,
  filePath: string,
): Promise<void> {
  const normalizedPath = normalizeWorkspacePath(filePath);
  const parentPath = getParentPath(normalizedPath);
  const fileName = normalizedPath.split("/").pop();
  if (!fileName) {
    return;
  }

  const parentHandle = await resolveDirectoryHandle(rootHandle, parentPath);
  if (!parentHandle) {
    return;
  }

  try {
    await parentHandle.removeEntry(fileName);
  } catch {
    // Ignore missing files during cleanup.
  }
}

async function copyDirectoryRecursively(
  sourceDir: FileSystemDirectoryHandle,
  targetDir: FileSystemDirectoryHandle,
): Promise<void> {
  for await (const entry of sourceDir.values()) {
    if (entry.kind === "file") {
      const fileHandle = entry as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      const targetFileHandle = await targetDir.getFileHandle(fileHandle.name, { create: true });
      const writable = await targetFileHandle.createWritable();
      await writable.write(file);
      await writable.close();
      continue;
    }

    const nestedTarget = await targetDir.getDirectoryHandle(entry.name, { create: true });
    await copyDirectoryRecursively(entry as FileSystemDirectoryHandle, nestedTarget);
  }
}

async function loadManifestFromItemFolder(
  rootHandle: FileSystemDirectoryHandle,
  itemFolderPath: string,
  fallbackPdfPath: string,
): Promise<PdfItemManifest | null> {
  const manifestPath = getPdfItemManifestPath(itemFolderPath);
  const content = await readTextFileIfExists(rootHandle, manifestPath);
  if (!content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content);
    if (isPdfItemManifest(parsed)) {
      return normalizePdfItemManifest({
        itemId: parsed.itemId,
        pdfPath: fallbackPdfPath,
        itemFolderPath: parsed.itemFolderPath || itemFolderPath,
        annotationIndexPath: parsed.annotationIndexPath ?? getPdfItemAnnotationIndexPath(itemFolderPath),
        createdAt: parsed.createdAt,
        updatedAt: parsed.updatedAt,
      });
    }
  } catch {
    // Ignore malformed manifests and continue falling back.
  }

  return null;
}

async function loadLegacyManifest(
  rootHandle: FileSystemDirectoryHandle,
  fileId: string,
): Promise<LegacyPdfItemManifest | null> {
  const content = await readTextFileIfExists(rootHandle, getLegacyPdfItemManifestPath(fileId));
  if (!content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content);
    return isLegacyPdfItemManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildRelativePdfLink(currentFilePath: string, pdfPath: string): string {
  return buildRelativeWorkspacePath(currentFilePath, pdfPath);
}

function buildSourcePdfLine(currentFilePath: string, pdfPath: string): string {
  const pdfFileName = getPdfFileName(pdfPath);
  return `Source PDF: [${pdfFileName}](${buildRelativePdfLink(currentFilePath, pdfPath)})`;
}

function replaceOrInsertLine(content: string, prefix: string, nextLine: string): string {
  const pattern = new RegExp(`^${prefix}.*$`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, nextLine);
  }

  const headingMatch = content.match(/^# .+$/m);
  if (headingMatch && typeof headingMatch.index === "number") {
    const insertAt = headingMatch.index + headingMatch[0].length;
    return `${content.slice(0, insertAt)}\n\n${nextLine}${content.slice(insertAt)}`;
  }

  return `${nextLine}\n\n${content}`;
}

function buildPdfMarkdownTemplate(input: {
  title: string;
}): string {
  return [
    `# ${input.title}`,
    "",
    "",
  ].join("\n");
}

function buildPdfNotebookTemplate(input: {
  manifest: PdfItemManifest;
  title: string;
  notebookPath: string;
}): string {
  const notebook = createEmptyNotebook() as {
    cells: Array<Record<string, unknown>>;
    metadata: Record<string, unknown>;
  };
  const relativePdfLink = buildRelativePdfLink(input.notebookPath, input.manifest.pdfPath);
  const pdfFileName = getPdfFileName(input.manifest.pdfPath);

  notebook.cells = [
    {
      cell_type: "markdown",
      metadata: {},
      source: [
        `# ${input.title}\n`,
        "\n",
        `Source PDF: [${pdfFileName}](${relativePdfLink})\n`,
        "\n",
        "Use this notebook for extraction code, experiments, and reading diagnostics.\n",
      ],
    },
    ...(notebook.cells ?? []),
  ];
  notebook.metadata = {
    ...(notebook.metadata ?? {}),
    latticePdfItem: {
      itemId: input.manifest.itemId,
      pdf: relativePdfLink,
    },
  };

  return JSON.stringify(notebook, null, 2);
}

function syncPdfNotebookContent(
  content: string,
  manifest: PdfItemManifest,
  notebookPath: string,
): string {
  try {
    const notebook = JSON.parse(content) as {
      cells?: Array<{
        cell_type?: string;
        source?: string[] | string;
        metadata?: Record<string, unknown>;
      }>;
      metadata?: Record<string, unknown>;
    };

    const relativePdfLink = buildRelativePdfLink(notebookPath, manifest.pdfPath);
    const pdfFileName = getPdfFileName(manifest.pdfPath);
    notebook.metadata = {
      ...(notebook.metadata ?? {}),
      latticePdfItem: {
        itemId: manifest.itemId,
        pdf: relativePdfLink,
      },
    };

    if (Array.isArray(notebook.cells)) {
      const firstMarkdownCell = notebook.cells.find((cell) => cell?.cell_type === "markdown");
      if (firstMarkdownCell) {
        const sourceText = Array.isArray(firstMarkdownCell.source)
          ? firstMarkdownCell.source.join("")
          : firstMarkdownCell.source ?? "";
        const nextSource = replaceOrInsertLine(
          sourceText,
          "Source PDF:",
          `Source PDF: [${pdfFileName}](${relativePdfLink})`,
        );
        firstMarkdownCell.source = nextSource.split("\n").map((line, index, all) => (
          index < all.length - 1 ? `${line}\n` : line
        ));
      }
    }

    return JSON.stringify(notebook, null, 2);
  } catch {
    return content;
  }
}

async function syncPdfManagedFiles(
  rootHandle: FileSystemDirectoryHandle,
  manifest: PdfItemManifest,
): Promise<void> {
  const dirHandle = await resolveDirectoryHandle(rootHandle, manifest.itemFolderPath);
  if (!dirHandle) {
    return;
  }

  for await (const entry of dirHandle.values()) {
    if (entry.kind !== "file") {
      continue;
    }

    const fileHandle = entry as FileSystemFileHandle;
    const fileName = fileHandle.name;
    if (
      fileName === LEGACY_OVERVIEW_NOTE_NAME ||
      fileName === DEFAULT_ANNOTATIONS_NOTE_NAME ||
      fileName === PDF_ITEM_MANIFEST_NAME
    ) {
      continue;
    }

    const filePath = joinPath(manifest.itemFolderPath, fileName);
    const lowerName = fileName.toLowerCase();
    const content = await readTextFile(fileHandle);
    let nextContent = content;

    if (lowerName.endsWith(".ipynb")) {
      nextContent = syncPdfNotebookContent(content, manifest, filePath);
    }

    if (nextContent !== content) {
      await writeTextFile(dirHandle, fileName, nextContent);
    }
  }
}

function getAnnotationTypeLabel(annotation: AnnotationItem): string {
  switch (annotation.style.type) {
    case "highlight":
      return "高亮";
    case "underline":
      return "下划线";
    case "area":
      return "区域";
    case "ink":
      return "手绘";
    case "text":
      return "文字";
    default:
      return "批注";
  }
}

export function buildPdfAnnotationsMarkdown(input: {
  fileName: string;
  manifest: PdfItemManifest;
  annotations: AnnotationItem[];
  backlinksByAnnotation?: Record<string, AnnotationBacklink[]>;
}): string {
  const currentFilePath = input.manifest.annotationIndexPath ?? getPdfItemAnnotationIndexPath(input.manifest.itemFolderPath);
  const relativePdfPath = buildRelativePdfLink(currentFilePath, input.manifest.pdfPath);
  const pdfAnnotations = input.annotations
    .filter((annotation) => annotation.target.type === "pdf")
    .sort((left, right) => {
      const leftPage = left.target.type === "pdf" ? left.target.page : 0;
      const rightPage = right.target.type === "pdf" ? right.target.page : 0;
      if (leftPage !== rightPage) {
        return leftPage - rightPage;
      }
      return left.createdAt - right.createdAt;
    });

  const lines: string[] = [
    "---",
    'type: "pdf-annotations"',
    `itemId: "${input.manifest.itemId}"`,
    `pdf: "${relativePdfPath}"`,
    `updated: "${new Date().toISOString()}"`,
    "---",
    "",
    `# ${input.fileName} Annotations`,
    "",
    buildSourcePdfLine(currentFilePath, input.manifest.pdfPath),
    "",
    `Total annotations: ${pdfAnnotations.length}`,
    "",
  ];

  if (pdfAnnotations.length === 0) {
    lines.push("_No annotations yet._");
    return lines.join("\n");
  }

  let currentPage = -1;
  pdfAnnotations.forEach((annotation, index) => {
    if (annotation.target.type !== "pdf") {
      return;
    }

    if (annotation.target.page !== currentPage) {
      currentPage = annotation.target.page;
      lines.push(`## Page ${currentPage}`);
      lines.push("");
    }

    const backlinks = input.backlinksByAnnotation?.[annotation.id] ?? [];
    lines.push(`### ${index + 1}. ${getAnnotationTypeLabel(annotation)}`);
    lines.push(`- Page Link: [Page ${annotation.target.page}](${relativePdfPath}#page=${annotation.target.page})`);
    lines.push(`- Annotation Link: [${annotation.id}](${relativePdfPath}#annotation=${annotation.id})`);
    if (annotation.content?.trim()) {
      lines.push(`- Quote: ${annotation.content.trim()}`);
    }
    if (annotation.comment?.trim()) {
      lines.push(`- Comment: ${annotation.comment.trim()}`);
    }
    lines.push(`- Created: ${new Date(annotation.createdAt).toLocaleString("zh-CN")}`);
    if (backlinks.length > 0) {
      lines.push(`- Backlinks: ${backlinks.length}`);
      backlinks.forEach((backlink) => {
        const backlinkTarget = `${buildRelativeWorkspacePath(currentFilePath, backlink.sourceFile)}#line=${backlink.lineNumber}`;
        const label = backlink.displayText?.trim() || `${backlink.sourceFile}:${backlink.lineNumber}`;
        lines.push(`  - [${label}](${backlinkTarget})`);
      });
    }
    lines.push("");
  });

  return lines.join("\n");
}

export async function loadPdfItemManifest(
  rootHandle: FileSystemDirectoryHandle,
  fileId: string,
  pdfPath: string,
): Promise<PdfItemManifest> {
  const normalizedPdfPath = normalizeWorkspacePath(pdfPath);
  const targetFolderPath = getDefaultPdfItemFolderPath(normalizedPdfPath);

  const hiddenManifest = await loadManifestFromItemFolder(rootHandle, targetFolderPath, normalizedPdfPath);
  if (hiddenManifest) {
    return hiddenManifest;
  }

  const hiddenFolder = await resolveDirectoryHandle(rootHandle, targetFolderPath);
  if (hiddenFolder) {
    return normalizePdfItemManifest({
      itemId: fileId,
      pdfPath: normalizedPdfPath,
      itemFolderPath: targetFolderPath,
    });
  }

  const legacyManifest = await loadLegacyManifest(rootHandle, fileId);
  if (legacyManifest) {
    const legacyFolderPath = normalizeWorkspacePath(
      legacyManifest.itemFolderPath || getLegacyPdfItemFolderPath(normalizedPdfPath),
    );
    const legacyFolder = await resolveDirectoryHandle(rootHandle, legacyFolderPath);
    if (legacyFolder) {
      return normalizePdfItemManifest({
        itemId: legacyManifest.fileId || fileId,
        pdfPath: normalizedPdfPath,
        itemFolderPath: legacyFolderPath,
        createdAt: legacyManifest.createdAt,
        updatedAt: legacyManifest.updatedAt,
      });
    }
  }

  const legacyFolderPath = getLegacyPdfItemFolderPath(normalizedPdfPath);
  const legacyFolder = await resolveDirectoryHandle(rootHandle, legacyFolderPath);
  if (legacyFolder) {
    return normalizePdfItemManifest({
      itemId: fileId,
      pdfPath: normalizedPdfPath,
      itemFolderPath: legacyFolderPath,
    });
  }

  return createDefaultPdfItemManifest(fileId, normalizedPdfPath);
}

export async function savePdfItemManifest(
  rootHandle: FileSystemDirectoryHandle,
  manifest: PdfItemManifest,
): Promise<PdfItemManifest> {
  const normalizedManifest = normalizePdfItemManifest({
    itemId: manifest.itemId,
    pdfPath: manifest.pdfPath,
    itemFolderPath: manifest.itemFolderPath,
    annotationIndexPath: manifest.annotationIndexPath,
    createdAt: manifest.createdAt,
    updatedAt: Date.now(),
  });
  const dirHandle = await ensureNestedDirectory(rootHandle, normalizedManifest.itemFolderPath);
  await writeTextFile(dirHandle, PDF_ITEM_MANIFEST_NAME, JSON.stringify(normalizedManifest, null, 2));
  return normalizedManifest;
}

export async function ensurePdfItemFolder(
  rootHandle: FileSystemDirectoryHandle,
  manifest: PdfItemManifest,
): Promise<FileSystemDirectoryHandle> {
  return ensureNestedDirectory(rootHandle, manifest.itemFolderPath);
}

export async function ensurePdfItemWorkspace(
  rootHandle: FileSystemDirectoryHandle,
  fileId: string,
  pdfPath: string,
): Promise<PdfItemManifest> {
  const normalizedPdfPath = normalizeWorkspacePath(pdfPath);
  const loadedManifest = await loadPdfItemManifest(rootHandle, fileId, normalizedPdfPath);
  const targetFolderPath = getDefaultPdfItemFolderPath(normalizedPdfPath);
  const nextManifest = normalizePdfItemManifest({
    itemId: loadedManifest.itemId,
    pdfPath: normalizedPdfPath,
    itemFolderPath: targetFolderPath,
    createdAt: loadedManifest.createdAt,
    updatedAt: loadedManifest.updatedAt,
  });

  const sourceFolderPath = normalizeWorkspacePath(loadedManifest.itemFolderPath);
  if (sourceFolderPath !== targetFolderPath) {
    const sourceDir = await resolveDirectoryHandle(rootHandle, sourceFolderPath);
    if (sourceDir) {
      const targetDir = await ensureNestedDirectory(rootHandle, targetFolderPath);
      await copyDirectoryRecursively(sourceDir, targetDir);
      await removeDirectoryIfExists(rootHandle, sourceFolderPath);
    }
  } else {
    await ensureNestedDirectory(rootHandle, targetFolderPath);
  }

  const persistedManifest = await savePdfItemManifest(rootHandle, nextManifest);
  await syncPdfManagedFiles(rootHandle, persistedManifest);
  await removeFileIfExists(rootHandle, getLegacyPdfItemManifestPath(fileId));
  return persistedManifest;
}

export async function createPdfItemNote(
  rootHandle: FileSystemDirectoryHandle,
  manifest: PdfItemManifest,
  type: "note" | "notebook",
  baseName: string,
): Promise<{ handle: FileSystemFileHandle; path: string }> {
  const dirHandle = await ensurePdfItemFolder(rootHandle, manifest);
  const extension = type === "note" ? ".md" : ".ipynb";
  const title = sanitizeFileName(baseName) || (type === "note" ? "Untitled" : "Lab Notebook");
  const fileName = await generateUniqueName(dirHandle, title, extension);
  const notePath = joinPath(manifest.itemFolderPath, fileName);
  const content = type === "note"
    ? buildPdfMarkdownTemplate({
        title,
      })
    : buildPdfNotebookTemplate({
        manifest,
        title,
        notebookPath: notePath,
      });

  const handle = await writeTextFile(dirHandle, fileName, content);
  return {
    handle,
    path: notePath,
  };
}

export async function syncPdfAnnotationsMarkdown(
  rootHandle: FileSystemDirectoryHandle,
  manifest: PdfItemManifest,
  fileName: string,
  annotations: AnnotationItem[],
  backlinksByAnnotation?: Record<string, AnnotationBacklink[]>,
): Promise<{ handle: FileSystemFileHandle | null; path: string | null; manifest: PdfItemManifest }> {
  const pdfAnnotations = annotations.filter((annotation) => annotation.target.type === "pdf");
  const annotationPath = manifest.annotationIndexPath ?? getPdfItemAnnotationIndexPath(manifest.itemFolderPath);

  if (pdfAnnotations.length === 0) {
    await removeFileIfExists(rootHandle, annotationPath);
    const nextManifest = await savePdfItemManifest(rootHandle, {
      ...manifest,
      annotationIndexPath: null,
    });
    return {
      handle: null,
      path: null,
      manifest: nextManifest,
    };
  }

  const dirHandle = await ensurePdfItemFolder(rootHandle, manifest);
  const markdown = buildPdfAnnotationsMarkdown({
    fileName,
    manifest: {
      ...manifest,
      annotationIndexPath: annotationPath,
    },
    annotations: pdfAnnotations,
    backlinksByAnnotation,
  });
  const handle = await writeTextFile(dirHandle, DEFAULT_ANNOTATIONS_NOTE_NAME, markdown);
  const nextManifest = await savePdfItemManifest(rootHandle, {
    ...manifest,
    annotationIndexPath: annotationPath,
  });

  return {
    handle,
    path: nextManifest.annotationIndexPath,
    manifest: nextManifest,
  };
}

export async function listPdfItemNotes(
  rootHandle: FileSystemDirectoryHandle,
  manifest: PdfItemManifest,
): Promise<PdfItemNoteSummary[]> {
  const dirHandle = await resolveDirectoryHandle(rootHandle, manifest.itemFolderPath);
  if (!dirHandle) {
    return [];
  }

  const notes: PdfItemNoteSummary[] = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind !== "file") {
      continue;
    }

    const fileName = entry.name;
    const lowerName = fileName.toLowerCase();
    if (!lowerName.endsWith(".md") && !lowerName.endsWith(".ipynb")) {
      continue;
    }

    const path = joinPath(manifest.itemFolderPath, fileName);
    if (fileName === LEGACY_OVERVIEW_NOTE_NAME) {
      continue;
    }

    if (fileName === DEFAULT_ANNOTATIONS_NOTE_NAME) {
      notes.push({ path, fileName, type: "annotation-note", handle: entry as FileSystemFileHandle });
      continue;
    }

    if (lowerName.endsWith(".ipynb")) {
      notes.push({ path, fileName, type: "notebook", handle: entry as FileSystemFileHandle });
      continue;
    }

    notes.push({ path, fileName, type: "note", handle: entry as FileSystemFileHandle });
  }

  return notes.sort((left, right) => {
    const weight = (note: PdfItemNoteSummary) => {
      switch (note.type) {
        case "note":
          return 0;
        case "notebook":
          return 1;
        case "annotation-note":
          return 2;
        default:
          return 9;
      }
    };
    return weight(left) - weight(right) || left.fileName.localeCompare(right.fileName);
  });
}

async function cloneAnnotationFileWithNewId(
  sourceItemId: string,
  targetItemId: string,
  rootHandle: FileSystemDirectoryHandle,
): Promise<UniversalAnnotationFile> {
  const sourceAnnotationFile = await loadAnnotationsFromDisk(sourceItemId, rootHandle, "pdf");
  const clonedAnnotationFile: UniversalAnnotationFile = {
    ...sourceAnnotationFile,
    fileId: targetItemId,
    lastModified: Date.now(),
  };
  await saveAnnotationsToDisk(clonedAnnotationFile, rootHandle);
  return clonedAnnotationFile;
}

export async function movePdfItemWorkspace(
  rootHandle: FileSystemDirectoryHandle,
  sourcePdfPath: string,
  targetPdfPath: string,
): Promise<PdfItemManifest | null> {
  const sourcePath = normalizeWorkspacePath(sourcePdfPath);
  const targetPath = normalizeWorkspacePath(targetPdfPath);
  const sourceManifest = await loadPdfItemManifest(rootHandle, generateFileId(sourcePath), sourcePath);
  const sourceDir = await resolveDirectoryHandle(rootHandle, sourceManifest.itemFolderPath);
  if (!sourceDir) {
    return null;
  }

  const targetFolderPath = getDefaultPdfItemFolderPath(targetPath);
  if (normalizeWorkspacePath(sourceManifest.itemFolderPath) !== targetFolderPath) {
    const targetDir = await ensureNestedDirectory(rootHandle, targetFolderPath);
    await copyDirectoryRecursively(sourceDir, targetDir);
    await removeDirectoryIfExists(rootHandle, sourceManifest.itemFolderPath);
  }

  let nextManifest = normalizePdfItemManifest({
    itemId: sourceManifest.itemId,
    pdfPath: targetPath,
    itemFolderPath: targetFolderPath,
    annotationIndexPath: sourceManifest.annotationIndexPath
      ? getPdfItemAnnotationIndexPath(targetFolderPath)
      : null,
    createdAt: sourceManifest.createdAt,
    updatedAt: Date.now(),
  });
  nextManifest = await savePdfItemManifest(rootHandle, nextManifest);
  await syncPdfManagedFiles(rootHandle, nextManifest);

  const annotationFile = await loadAnnotationsFromDisk(nextManifest.itemId, rootHandle, "pdf");
  const annotationsResult = await syncPdfAnnotationsMarkdown(
    rootHandle,
    nextManifest,
    getPdfFileName(targetPath),
    annotationFile.annotations,
  );
  return annotationsResult.manifest;
}

export async function copyPdfItemWorkspace(
  rootHandle: FileSystemDirectoryHandle,
  sourcePdfPath: string,
  targetPdfPath: string,
): Promise<PdfItemManifest | null> {
  const sourcePath = normalizeWorkspacePath(sourcePdfPath);
  const targetPath = normalizeWorkspacePath(targetPdfPath);
  const sourceManifest = await loadPdfItemManifest(rootHandle, generateFileId(sourcePath), sourcePath);
  const sourceDir = await resolveDirectoryHandle(rootHandle, sourceManifest.itemFolderPath);
  if (!sourceDir) {
    return null;
  }

  const targetItemId = generateFileId(targetPath);
  const targetFolderPath = getDefaultPdfItemFolderPath(targetPath);
  const targetDir = await ensureNestedDirectory(rootHandle, targetFolderPath);
  await copyDirectoryRecursively(sourceDir, targetDir);

  const clonedAnnotationFile = await cloneAnnotationFileWithNewId(sourceManifest.itemId, targetItemId, rootHandle);
  let nextManifest = normalizePdfItemManifest({
    itemId: targetItemId,
    pdfPath: targetPath,
    itemFolderPath: targetFolderPath,
    annotationIndexPath: clonedAnnotationFile.annotations.some((annotation) => annotation.target.type === "pdf")
      ? getPdfItemAnnotationIndexPath(targetFolderPath)
      : null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  nextManifest = await savePdfItemManifest(rootHandle, nextManifest);
  await syncPdfManagedFiles(rootHandle, nextManifest);
  const annotationsResult = await syncPdfAnnotationsMarkdown(
    rootHandle,
    nextManifest,
    getPdfFileName(targetPath),
    clonedAnnotationFile.annotations,
  );
  return annotationsResult.manifest;
}

export async function deletePdfItemWorkspace(
  rootHandle: FileSystemDirectoryHandle,
  pdfPath: string,
): Promise<void> {
  const normalizedPdfPath = normalizeWorkspacePath(pdfPath);
  const fallbackFileId = generateFileId(normalizedPdfPath);
  const manifest = await loadPdfItemManifest(rootHandle, fallbackFileId, normalizedPdfPath);
  await removeDirectoryIfExists(rootHandle, manifest.itemFolderPath);
  await deleteAnnotationsFromDisk(manifest.itemId, rootHandle);
  if (manifest.itemId !== fallbackFileId) {
    await deleteAnnotationsFromDisk(fallbackFileId, rootHandle);
  }
  await removeFileIfExists(rootHandle, getLegacyPdfItemManifestPath(fallbackFileId));
  await removeDirectoryIfExists(rootHandle, getLegacyPdfItemFolderPath(normalizedPdfPath));
}
