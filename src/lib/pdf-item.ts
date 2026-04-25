"use client";

import {
  createEmptyNotebook,
  generateUniqueName,
  getParentPath,
  joinPath,
  resolveDirectoryHandle,
  sanitizeFileName,
} from "@/lib/file-operations";
import { getExtension, isIgnoredDirectory } from "@/lib/constants";
import {
  buildRelativeWorkspacePath,
  normalizeWorkspacePath,
} from "@/lib/link-router/path-utils";
import {
  deserializeAnnotationFile,
  deleteAnnotationsFromDisk,
  ensureAnnotationsDirectory,
  generateFileId,
  loadAnnotationsFromDisk,
  resolveAnnotationFileCandidates,
  saveAnnotationsToDisk,
} from "@/lib/universal-annotation-storage";
import { removeAnnotationDocumentAliases } from "@/lib/annotation-registry";
import type { AnnotationBacklink } from "@/lib/annotation-backlinks";
import { getCanonicalPdfAnnotationText, type AnnotationItem, type UniversalAnnotationFile } from "@/types/universal-annotation";
import type { ResolvedPdfDocumentBinding } from "@/lib/pdf-document-binding";
import { getLocale, t as translate } from "@/lib/i18n";

const PDF_ITEM_MANIFEST_VERSION = 4;
const PDF_ITEM_MANIFEST_NAME = "manifest.json";
const PDF_ITEMS_DIR = ".lattice/items";
const LEGACY_PDF_ITEMS_DIR = ".lattice/pdf-items";
const LEGACY_OVERVIEW_NOTE_NAME = "_overview.md";
const DEFAULT_ANNOTATIONS_NOTE_NAME = "_annotations.md";

export interface PdfItemManifestIndex {
  byDocumentId: Map<string, PdfItemManifest>;
  byKnownPdfPath: Map<string, PdfItemManifest>;
  byCurrentItemFolder: Map<string, PdfItemManifest>;
}

const pdfItemManifestIndexCache = new WeakMap<FileSystemDirectoryHandle, PdfItemManifestIndex>();
const pdfItemManifestIndexPromiseCache = new WeakMap<FileSystemDirectoryHandle, Promise<PdfItemManifestIndex>>();

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
  version: 4;
  itemId: string;                // Stable documentId
  pdfPath: string;
  itemFolderPath: string;
  annotationIndexPath: string | null;
  fileFingerprint: string | null;
  versionFingerprint: string | null;
  knownPdfPaths: string[];
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
    (candidate.version === 2 || candidate.version === 3 || candidate.version === PDF_ITEM_MANIFEST_VERSION) &&
    typeof candidate.itemId === "string" &&
    typeof candidate.pdfPath === "string" &&
    typeof candidate.itemFolderPath === "string" &&
    (candidate.annotationIndexPath === null || typeof candidate.annotationIndexPath === "string") &&
    (candidate.fileFingerprint === null || candidate.fileFingerprint === undefined || typeof candidate.fileFingerprint === "string") &&
    (candidate.versionFingerprint === null || candidate.versionFingerprint === undefined || typeof candidate.versionFingerprint === "string") &&
    (candidate.knownPdfPaths === undefined || Array.isArray(candidate.knownPdfPaths)) &&
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
  const rawItemId = sanitizeFileName(generateFileId(normalizedPdfPath)) || "pdf-item";
  return joinPath(PDF_ITEMS_DIR, rawItemId);
}

export function getLegacyHiddenPdfItemFolderPath(pdfPath: string): string {
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
  fileFingerprint?: string | null;
  versionFingerprint?: string | null;
  knownPdfPaths?: string[];
  createdAt?: number;
  updatedAt?: number;
}): PdfItemManifest {
  const normalizedPdfPath = normalizeWorkspacePath(input.pdfPath);
  const normalizedFolderPath = normalizeWorkspacePath(input.itemFolderPath);
  const createdAt = input.createdAt ?? Date.now();
  const knownPdfPaths = Array.from(new Set([
    normalizedPdfPath,
    ...(input.knownPdfPaths ?? []).map((path) => normalizeWorkspacePath(path)),
  ]));
  return {
    version: 4,
    itemId: input.itemId,
    pdfPath: normalizedPdfPath,
    itemFolderPath: normalizedFolderPath,
    annotationIndexPath: input.annotationIndexPath === undefined
      ? null
      : input.annotationIndexPath
        ? normalizeWorkspacePath(input.annotationIndexPath)
        : null,
    fileFingerprint: input.fileFingerprint ?? null,
    versionFingerprint: input.versionFingerprint ?? null,
    knownPdfPaths,
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

async function collectWorkspacePdfPaths(
  handle: FileSystemDirectoryHandle,
  parentPath = "",
): Promise<string[]> {
  const currentPath = parentPath ? `${parentPath}/${handle.name}` : handle.name;
  const results: string[] = [];

  for await (const entry of handle.values()) {
    if (entry.kind === "directory") {
      if (isIgnoredDirectory(entry.name)) {
        continue;
      }

      results.push(...await collectWorkspacePdfPaths(entry as FileSystemDirectoryHandle, currentPath));
      continue;
    }

    if (getExtension(entry.name) === "pdf") {
      results.push(`${currentPath}/${entry.name}`);
    }
  }

  return results;
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
        pdfPath: parsed.pdfPath || fallbackPdfPath,
        itemFolderPath: parsed.itemFolderPath || itemFolderPath,
        annotationIndexPath: parsed.annotationIndexPath ?? getPdfItemAnnotationIndexPath(itemFolderPath),
        fileFingerprint: typeof parsed.fileFingerprint === "string" ? parsed.fileFingerprint : null,
        versionFingerprint: typeof parsed.versionFingerprint === "string" ? parsed.versionFingerprint : null,
        knownPdfPaths: Array.isArray(parsed.knownPdfPaths) ? parsed.knownPdfPaths.filter((path): path is string => typeof path === "string") : [fallbackPdfPath],
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

async function collectCurrentPdfItemManifests(
  rootHandle: FileSystemDirectoryHandle,
): Promise<PdfItemManifest[]> {
  const itemsRoot = await resolveDirectoryHandle(rootHandle, PDF_ITEMS_DIR);
  if (!itemsRoot) {
    return [];
  }

  const manifests: PdfItemManifest[] = [];
  for await (const entry of itemsRoot.values()) {
    if (entry.kind !== "directory") {
      continue;
    }

    const candidate = await loadManifestFromItemFolder(
      rootHandle,
      joinPath(PDF_ITEMS_DIR, entry.name),
      joinPath(PDF_ITEMS_DIR, entry.name),
    );
    if (candidate) {
      manifests.push(candidate);
    }
  }

  return manifests;
}

function buildPdfItemManifestIndex(manifests: PdfItemManifest[]): PdfItemManifestIndex {
  const byDocumentId = new Map<string, PdfItemManifest>();
  const byKnownPdfPath = new Map<string, PdfItemManifest>();
  const byCurrentItemFolder = new Map<string, PdfItemManifest>();

  manifests.forEach((manifest) => {
    byDocumentId.set(manifest.itemId, manifest);
    byCurrentItemFolder.set(normalizeWorkspacePath(manifest.itemFolderPath), manifest);
    manifest.knownPdfPaths.forEach((path) => {
      byKnownPdfPath.set(normalizeWorkspacePath(path), manifest);
    });
    byKnownPdfPath.set(normalizeWorkspacePath(manifest.pdfPath), manifest);
  });

  return {
    byDocumentId,
    byKnownPdfPath,
    byCurrentItemFolder,
  };
}

export function invalidatePdfItemManifestIndex(rootHandle: FileSystemDirectoryHandle): void {
  pdfItemManifestIndexCache.delete(rootHandle);
  pdfItemManifestIndexPromiseCache.delete(rootHandle);
}

export async function getPdfItemManifestIndex(
  rootHandle: FileSystemDirectoryHandle,
): Promise<PdfItemManifestIndex> {
  const cached = pdfItemManifestIndexCache.get(rootHandle);
  if (cached) {
    return cached;
  }

  const pending = pdfItemManifestIndexPromiseCache.get(rootHandle);
  if (pending) {
    return pending;
  }

  const nextPromise = collectCurrentPdfItemManifests(rootHandle)
    .then((manifests) => {
      const index = buildPdfItemManifestIndex(manifests);
      pdfItemManifestIndexCache.set(rootHandle, index);
      pdfItemManifestIndexPromiseCache.delete(rootHandle);
      return index;
    })
    .catch((error) => {
      pdfItemManifestIndexPromiseCache.delete(rootHandle);
      throw error;
    });

  pdfItemManifestIndexPromiseCache.set(rootHandle, nextPromise);
  return nextPromise;
}

async function hasLegacyPdfItemWorkspace(
  rootHandle: FileSystemDirectoryHandle,
  fileId: string,
  pdfPath: string,
): Promise<boolean> {
  const legacyManifest = await loadLegacyManifest(rootHandle, fileId);
  if (legacyManifest) {
    return true;
  }

  if (await resolveDirectoryHandle(rootHandle, getLegacyHiddenPdfItemFolderPath(pdfPath))) {
    return true;
  }

  return Boolean(await resolveDirectoryHandle(rootHandle, getLegacyPdfItemFolderPath(pdfPath)));
}

function buildRelativePdfLink(currentFilePath: string, pdfPath: string): string {
  return buildRelativeWorkspacePath(currentFilePath, pdfPath);
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

function stripLegacyPdfNoteFrontmatter(content: string, fallbackTitle: string): string {
  const frontmatterMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!frontmatterMatch) {
    return content;
  }

  const frontmatter = frontmatterMatch[1];
  if (!/^\s*type:\s*"?pdf-note"?\s*$/m.test(frontmatter)) {
    return content;
  }

  const remainder = content.slice(frontmatterMatch[0].length).trimStart();
  if (remainder.length > 0) {
    return remainder;
  }

  return buildPdfMarkdownTemplate({ title: fallbackTitle });
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

export async function syncPdfManagedFiles(
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
    } else if (lowerName.endsWith(".md")) {
      nextContent = stripLegacyPdfNoteFrontmatter(
        content,
        fileName.replace(/\.md$/i, "") || "Reading Note",
      );
    }

    if (nextContent !== content) {
      await writeTextFile(dirHandle, fileName, nextContent);
    }
  }
}

const PDF_ANNOTATIONS_MARKDOWN_LABELS = {
  "zh-CN": {
    annotationsTitle: "批注",
    sourcePdf: "源 PDF",
    pageLink: "页面链接",
    annotationLink: "批注链接",
    quote: "引用",
    comment: "评论",
    screenshot: "截图",
    screenshotDetails: "截图：第 {page} 页，{width}x{height}px",
    created: "创建时间",
    backlinks: "反向链接",
    noAnnotations: "暂无批注。",
  },
  "en-US": {
    annotationsTitle: "Annotations",
    sourcePdf: "Source PDF",
    pageLink: "Page Link",
    annotationLink: "Annotation Link",
    quote: "Quote",
    comment: "Comment",
    screenshot: "Screenshot",
    screenshotDetails: "Screenshot: page {page}, {width}x{height}px",
    created: "Created",
    backlinks: "Backlinks",
    noAnnotations: "No annotations yet.",
  },
} as const;

function getPdfAnnotationsMarkdownLabels() {
  return PDF_ANNOTATIONS_MARKDOWN_LABELS[getLocale()] ?? PDF_ANNOTATIONS_MARKDOWN_LABELS["zh-CN"];
}

function formatPdfAnnotationMarkdownLabel(
  template: string,
  params: Record<string, string | number>,
): string {
  return Object.entries(params).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, String(value)),
    template,
  );
}

function getAnnotationTypeLabel(annotation: AnnotationItem): string {
  switch (annotation.style.type) {
    case "highlight":
      return translate("pdf.command.highlight");
    case "underline":
      return translate("pdf.command.underline");
    case "area":
      return translate("pdf.command.area");
    case "ink":
      return translate("pdf.sidebar.filter.type.ink");
    case "text":
      return translate("pdf.command.text");
    default:
      return translate("workbench.annotations.panelTitle");
  }
}

function buildAnnotationPreviewMarkdown(annotation: AnnotationItem): string | null {
  if (
    annotation.target.type !== "pdf" ||
    (annotation.style.type !== "area" && annotation.style.type !== "ink") ||
    annotation.preview?.type !== "image" ||
    !annotation.preview.dataUrl
  ) {
    return null;
  }

  const labels = getPdfAnnotationsMarkdownLabels();
  const page = annotation.target.page;
  const width = Math.round(annotation.preview.width);
  const height = Math.round(annotation.preview.height);
  const alt = `${getAnnotationTypeLabel(annotation)} ${labels.screenshot} ${annotation.id} ${translate("pdf.sidebar.page", { page })}`;
  const details = formatPdfAnnotationMarkdownLabel(labels.screenshotDetails, { page, width, height });
  return `![${alt}](${annotation.preview.dataUrl})\n\n  _${details}_`;
}

export function buildPdfAnnotationsMarkdown(input: {
  fileName: string;
  manifest: PdfItemManifest;
  annotations: AnnotationItem[];
  backlinksByAnnotation?: Record<string, AnnotationBacklink[]>;
}): string {
  const locale = getLocale();
  const labels = getPdfAnnotationsMarkdownLabels();
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
    `# ${input.fileName} ${labels.annotationsTitle}`,
    "",
    `${labels.sourcePdf}: [${getPdfFileName(input.manifest.pdfPath)}](${relativePdfPath})`,
    "",
    translate("pdf.sidebar.export.count", { count: pdfAnnotations.length }),
    "",
  ];

  if (pdfAnnotations.length === 0) {
    lines.push(`_${labels.noAnnotations}_`);
    return lines.join("\n");
  }

  let currentPage = -1;
  pdfAnnotations.forEach((annotation, index) => {
    if (annotation.target.type !== "pdf") {
      return;
    }

    if (annotation.target.page !== currentPage) {
      currentPage = annotation.target.page;
      lines.push(`## ${translate("pdf.sidebar.page", { page: currentPage })}`);
      lines.push("");
    }

    const backlinks = input.backlinksByAnnotation?.[annotation.id] ?? [];
    lines.push(`### ${index + 1}. ${getAnnotationTypeLabel(annotation)}`);
    lines.push(`- ${labels.pageLink}: [${translate("pdf.sidebar.page", { page: annotation.target.page })}](${relativePdfPath}#page=${annotation.target.page})`);
    lines.push(`- ${labels.annotationLink}: [${annotation.id}](${relativePdfPath}#annotation=${annotation.id})`);
    const quoteText = getCanonicalPdfAnnotationText(annotation);
    if (quoteText) {
      lines.push(`- ${labels.quote}: ${quoteText}`);
    }
    if (annotation.comment?.trim()) {
      lines.push(`- ${labels.comment}: ${annotation.comment.trim()}`);
    }
    const previewMarkdown = buildAnnotationPreviewMarkdown(annotation);
    if (previewMarkdown) {
      lines.push(`- ${labels.screenshot}:`);
      lines.push(`  ${previewMarkdown.replace(/\n/g, "\n  ")}`);
    }
    lines.push(`- ${labels.created}: ${new Date(annotation.createdAt).toLocaleString(locale)}`);
    if (backlinks.length > 0) {
      lines.push(`- ${labels.backlinks}: ${backlinks.length}`);
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
  options?: {
    documentId?: string | null;
    knownPdfPaths?: string[];
    fileFingerprint?: string | null;
    versionFingerprint?: string | null;
  },
): Promise<PdfItemManifest> {
  const normalizedPdfPath = normalizeWorkspacePath(pdfPath);
  const targetFolderPath = getDefaultPdfItemFolderPath(normalizedPdfPath);
  const documentId = options?.documentId ?? fileId;
  const knownPdfPaths = Array.from(new Set([
    normalizedPdfPath,
    ...(options?.knownPdfPaths ?? []).map((path) => normalizeWorkspacePath(path)),
  ]));

  const hiddenManifest = await loadManifestFromItemFolder(rootHandle, targetFolderPath, normalizedPdfPath);
  if (hiddenManifest) {
    return normalizePdfItemManifest({
      ...hiddenManifest,
      itemId: hiddenManifest.itemId || documentId,
      pdfPath: normalizedPdfPath,
      itemFolderPath: hiddenManifest.itemFolderPath,
      annotationIndexPath: hiddenManifest.annotationIndexPath,
      fileFingerprint: options?.fileFingerprint ?? hiddenManifest.fileFingerprint,
      versionFingerprint: options?.versionFingerprint ?? hiddenManifest.versionFingerprint,
      knownPdfPaths: [...hiddenManifest.knownPdfPaths, ...knownPdfPaths],
      createdAt: hiddenManifest.createdAt,
      updatedAt: hiddenManifest.updatedAt,
    });
  }

  const hiddenFolder = await resolveDirectoryHandle(rootHandle, targetFolderPath);
  if (hiddenFolder) {
    return normalizePdfItemManifest({
      itemId: documentId,
      pdfPath: normalizedPdfPath,
      itemFolderPath: targetFolderPath,
      fileFingerprint: options?.fileFingerprint ?? null,
      versionFingerprint: options?.versionFingerprint ?? null,
      knownPdfPaths,
    });
  }

  const manifestIndex = await getPdfItemManifestIndex(rootHandle);
  const exactDocumentMatch = manifestIndex.byDocumentId.get(documentId) ?? null;
  if (exactDocumentMatch) {
    return normalizePdfItemManifest({
      ...exactDocumentMatch,
      pdfPath: normalizedPdfPath,
      itemFolderPath: exactDocumentMatch.itemFolderPath,
      annotationIndexPath: exactDocumentMatch.annotationIndexPath,
      fileFingerprint: options?.fileFingerprint ?? exactDocumentMatch.fileFingerprint,
      versionFingerprint: options?.versionFingerprint ?? exactDocumentMatch.versionFingerprint,
      knownPdfPaths: [...exactDocumentMatch.knownPdfPaths, ...knownPdfPaths],
      createdAt: exactDocumentMatch.createdAt,
      updatedAt: exactDocumentMatch.updatedAt,
    });
  }

  const knownPathMatch = knownPdfPaths
    .map((path) => manifestIndex.byKnownPdfPath.get(path))
    .find((manifest): manifest is PdfItemManifest => Boolean(manifest))
    ?? manifestIndex.byCurrentItemFolder.get(targetFolderPath)
    ?? null;
  if (knownPathMatch) {
    return normalizePdfItemManifest({
      ...knownPathMatch,
      pdfPath: normalizedPdfPath,
      itemFolderPath: knownPathMatch.itemFolderPath,
      annotationIndexPath: knownPathMatch.annotationIndexPath,
      fileFingerprint: options?.fileFingerprint ?? knownPathMatch.fileFingerprint,
      versionFingerprint: options?.versionFingerprint ?? knownPathMatch.versionFingerprint,
      knownPdfPaths: [...knownPathMatch.knownPdfPaths, ...knownPdfPaths],
      createdAt: knownPathMatch.createdAt,
      updatedAt: knownPathMatch.updatedAt,
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
        itemId: legacyManifest.fileId || documentId,
        pdfPath: normalizedPdfPath,
        itemFolderPath: legacyFolderPath,
        fileFingerprint: options?.fileFingerprint ?? null,
        versionFingerprint: options?.versionFingerprint ?? null,
        knownPdfPaths,
        createdAt: legacyManifest.createdAt,
        updatedAt: legacyManifest.updatedAt,
      });
    }
  }

  const legacyHiddenFolderPath = getLegacyHiddenPdfItemFolderPath(normalizedPdfPath);
  const legacyHiddenFolder = await resolveDirectoryHandle(rootHandle, legacyHiddenFolderPath);
  if (legacyHiddenFolder) {
    return normalizePdfItemManifest({
      itemId: documentId,
      pdfPath: normalizedPdfPath,
      itemFolderPath: legacyHiddenFolderPath,
      fileFingerprint: options?.fileFingerprint ?? null,
      versionFingerprint: options?.versionFingerprint ?? null,
      knownPdfPaths,
    });
  }

  const legacyFolderPath = getLegacyPdfItemFolderPath(normalizedPdfPath);
  const legacyFolder = await resolveDirectoryHandle(rootHandle, legacyFolderPath);
  if (legacyFolder) {
    return normalizePdfItemManifest({
      itemId: documentId,
      pdfPath: normalizedPdfPath,
      itemFolderPath: legacyFolderPath,
      fileFingerprint: options?.fileFingerprint ?? null,
      versionFingerprint: options?.versionFingerprint ?? null,
      knownPdfPaths,
    });
  }

  return createDefaultPdfItemManifest(documentId, normalizedPdfPath);
}

export async function loadPdfItemManifestForBinding(
  rootHandle: FileSystemDirectoryHandle,
  binding: Pick<ResolvedPdfDocumentBinding, "documentId" | "fileIdentity">,
): Promise<PdfItemManifest> {
  return loadPdfItemManifest(
    rootHandle,
    binding.fileIdentity.primaryFileId,
    binding.fileIdentity.relativePathFromRoot,
    {
      documentId: binding.documentId,
      knownPdfPaths: [
        binding.fileIdentity.relativePathFromRoot,
      ],
      fileFingerprint: binding.fileIdentity.fileFingerprint,
      versionFingerprint: binding.fileIdentity.versionFingerprint,
    },
  );
}

export async function hasPersistedPdfAnnotations(
  rootHandle: FileSystemDirectoryHandle,
  fileId: string,
  pdfPath: string,
  fileName: string,
): Promise<boolean> {
  try {
    const manifest = await loadPdfItemManifest(rootHandle, fileId, pdfPath);
    if (manifest.annotationIndexPath) {
      return true;
    }
  } catch {
    // Fall through to sidecar checks.
  }

  try {
    const annotationsDir = await ensureAnnotationsDirectory(rootHandle);
    const candidates = resolveAnnotationFileCandidates(fileName, pdfPath, fileId);

    for (const candidate of candidates) {
      try {
        const fileHandle = await annotationsDir.getFileHandle(`${candidate}.json`);
        const file = await fileHandle.getFile();
        const parsed = deserializeAnnotationFile(await file.text());
        if (parsed?.annotations.some((annotation) => annotation.target.type === "pdf")) {
          return true;
        }
      } catch {
        // Try the next candidate id.
      }
    }
  } catch {
    // Annotation storage unavailable; treat as no persisted annotations.
  }

  return false;
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
    fileFingerprint: manifest.fileFingerprint,
    versionFingerprint: manifest.versionFingerprint,
    knownPdfPaths: manifest.knownPdfPaths,
    createdAt: manifest.createdAt,
    updatedAt: Date.now(),
  });
  const dirHandle = await ensureNestedDirectory(rootHandle, normalizedManifest.itemFolderPath);
  await writeTextFile(dirHandle, PDF_ITEM_MANIFEST_NAME, JSON.stringify(normalizedManifest, null, 2));
  invalidatePdfItemManifestIndex(rootHandle);
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
  options?: {
    documentId?: string | null;
    knownPdfPaths?: string[];
    fileFingerprint?: string | null;
    versionFingerprint?: string | null;
  },
): Promise<PdfItemManifest> {
  const normalizedPdfPath = normalizeWorkspacePath(pdfPath);
  const loadedManifest = await loadPdfItemManifest(rootHandle, fileId, normalizedPdfPath, options);
  const targetFolderPath = getDefaultPdfItemFolderPath(normalizedPdfPath);
  const nextManifest = normalizePdfItemManifest({
    itemId: loadedManifest.itemId,
    pdfPath: normalizedPdfPath,
    itemFolderPath: targetFolderPath,
    annotationIndexPath: loadedManifest.annotationIndexPath,
    fileFingerprint: options?.fileFingerprint ?? loadedManifest.fileFingerprint,
    versionFingerprint: options?.versionFingerprint ?? loadedManifest.versionFingerprint,
    knownPdfPaths: [...loadedManifest.knownPdfPaths, ...(options?.knownPdfPaths ?? []), normalizedPdfPath],
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
  await removeDirectoryIfExists(rootHandle, getLegacyHiddenPdfItemFolderPath(normalizedPdfPath));
  return persistedManifest;
}

export async function ensurePdfItemWorkspaceForBinding(
  rootHandle: FileSystemDirectoryHandle,
  binding: Pick<ResolvedPdfDocumentBinding, "documentId" | "fileIdentity">,
): Promise<PdfItemManifest> {
  return ensurePdfItemWorkspace(
    rootHandle,
    binding.fileIdentity.primaryFileId,
    binding.fileIdentity.relativePathFromRoot,
    {
      documentId: binding.documentId,
      knownPdfPaths: [binding.fileIdentity.relativePathFromRoot],
      fileFingerprint: binding.fileIdentity.fileFingerprint,
      versionFingerprint: binding.fileIdentity.versionFingerprint,
    },
  );
}

export async function migrateLegacyPdfItemWorkspaces(
  rootHandle: FileSystemDirectoryHandle,
): Promise<number> {
  const pdfPaths = await collectWorkspacePdfPaths(rootHandle);
  let migrated = 0;

  for (const pdfPath of pdfPaths) {
    const fileId = generateFileId(pdfPath);
    if (!(await hasLegacyPdfItemWorkspace(rootHandle, fileId, pdfPath))) {
      continue;
    }

    await ensurePdfItemWorkspace(rootHandle, fileId, pdfPath);
    migrated += 1;
  }

  return migrated;
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
    documentId: targetItemId,
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
    fileFingerprint: sourceManifest.fileFingerprint,
    versionFingerprint: sourceManifest.versionFingerprint,
    knownPdfPaths: [...sourceManifest.knownPdfPaths, targetPath],
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
    fileFingerprint: sourceManifest.fileFingerprint,
    versionFingerprint: sourceManifest.versionFingerprint,
    knownPdfPaths: [targetPath],
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
  await removeAnnotationDocumentAliases({ documentId: manifest.itemId });
  await removeFileIfExists(rootHandle, getLegacyPdfItemManifestPath(fallbackFileId));
  await removeDirectoryIfExists(rootHandle, getLegacyHiddenPdfItemFolderPath(normalizedPdfPath));
  await removeDirectoryIfExists(rootHandle, getLegacyPdfItemFolderPath(normalizedPdfPath));
  invalidatePdfItemManifestIndex(rootHandle);
}
