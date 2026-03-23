"use client";

import {
  createEmptyNotebook,
  generateUniqueName,
  getParentPath,
  joinPath,
  resolveDirectoryHandle,
  sanitizeFileName,
} from "@/lib/file-operations";
import type { AnnotationItem } from "@/types/universal-annotation";

export const PDF_ITEMS_DIR = ".lattice/pdf-items";
const PDF_ITEM_MANIFEST_VERSION = 1;
const DEFAULT_ANNOTATIONS_NOTE_NAME = "_annotations.md";

export interface PdfItemManifest {
  version: 1;
  fileId: string;
  pdfPath: string;
  itemFolderPath: string;
  annotationNotePath: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PdfItemNoteSummary {
  path: string;
  fileName: string;
  type: "note" | "notebook" | "annotation-note";
}

function isPdfItemManifest(value: unknown): value is PdfItemManifest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === PDF_ITEM_MANIFEST_VERSION &&
    typeof candidate.fileId === "string" &&
    typeof candidate.pdfPath === "string" &&
    typeof candidate.itemFolderPath === "string" &&
    (typeof candidate.annotationNotePath === "string" || candidate.annotationNotePath === null) &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.updatedAt === "number"
  );
}

async function ensureNestedDirectory(
  rootHandle: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemDirectoryHandle> {
  const parts = path.split("/").filter(Boolean);
  let current = rootHandle;

  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }

  return current;
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

function getPdfBaseName(filePath: string) {
  const fileName = filePath.split("/").pop() ?? "PDF";
  return fileName.replace(/\.pdf$/i, "") || "PDF";
}

export function getDefaultPdfItemFolderPath(pdfPath: string): string {
  const parentPath = getParentPath(pdfPath);
  const rawBaseName = sanitizeFileName(getPdfBaseName(pdfPath)) || "PDF";
  return joinPath(parentPath, `${rawBaseName}.item`);
}

function getPdfItemManifestPath(fileId: string): string {
  return `${PDF_ITEMS_DIR}/${fileId}.json`;
}

function buildPdfItemManifest(fileId: string, pdfPath: string): PdfItemManifest {
  const now = Date.now();
  return {
    version: PDF_ITEM_MANIFEST_VERSION,
    fileId,
    pdfPath,
    itemFolderPath: getDefaultPdfItemFolderPath(pdfPath),
    annotationNotePath: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function loadPdfItemManifest(
  rootHandle: FileSystemDirectoryHandle,
  fileId: string,
  pdfPath: string,
): Promise<PdfItemManifest> {
  const manifestPath = getPdfItemManifestPath(fileId);
  const parentPath = getParentPath(manifestPath);
  const fileName = manifestPath.split("/").pop() ?? `${fileId}.json`;

  try {
    const dirHandle = await ensureNestedDirectory(rootHandle, parentPath);
    const fileHandle = await dirHandle.getFileHandle(fileName);
    const content = await (await fileHandle.getFile()).text();
    const parsed = JSON.parse(content);
    if (isPdfItemManifest(parsed)) {
      return {
        ...parsed,
        pdfPath,
        itemFolderPath: parsed.itemFolderPath || getDefaultPdfItemFolderPath(pdfPath),
      };
    }
  } catch {
    // Fall through to default manifest.
  }

  return buildPdfItemManifest(fileId, pdfPath);
}

export async function savePdfItemManifest(
  rootHandle: FileSystemDirectoryHandle,
  manifest: PdfItemManifest,
): Promise<void> {
  const manifestPath = getPdfItemManifestPath(manifest.fileId);
  const parentPath = getParentPath(manifestPath);
  const fileName = manifestPath.split("/").pop() ?? `${manifest.fileId}.json`;
  const dirHandle = await ensureNestedDirectory(rootHandle, parentPath);
  const payload = {
    ...manifest,
    updatedAt: Date.now(),
  } satisfies PdfItemManifest;

  await writeTextFile(dirHandle, fileName, JSON.stringify(payload, null, 2));
}

export async function ensurePdfItemFolder(
  rootHandle: FileSystemDirectoryHandle,
  manifest: PdfItemManifest,
): Promise<FileSystemDirectoryHandle> {
  return ensureNestedDirectory(rootHandle, manifest.itemFolderPath);
}

function buildPdfMarkdownTemplate(input: {
  pdfFileName: string;
  pdfPath: string;
  title: string;
}): string {
  return [
    "---",
    'type: "pdf-note"',
    `pdf: "${input.pdfPath}"`,
    `created: "${new Date().toISOString()}"`,
    "---",
    "",
    `# ${input.title}`,
    "",
    `Source PDF: [[${input.pdfFileName}]]`,
    "",
    "## Notes",
    "",
  ].join("\n");
}

function buildPdfNotebookTemplate(input: {
  pdfPath: string;
  title: string;
}): string {
  const notebook = createEmptyNotebook() as {
    cells: Array<Record<string, unknown>>;
    metadata: Record<string, unknown>;
  };

  notebook.cells = [
    {
      cell_type: "markdown",
      metadata: {},
      source: [
        `# ${input.title}\n`,
        `\n`,
        `Source PDF: \`${input.pdfPath}\`\n`,
        `\n`,
        `Add reading experiments, extraction code, or analysis here.\n`,
      ],
    },
    ...(notebook.cells ?? []),
  ];

  return JSON.stringify(notebook, null, 2);
}

export async function createPdfItemNote(
  rootHandle: FileSystemDirectoryHandle,
  manifest: PdfItemManifest,
  type: "note" | "notebook",
  baseName: string,
): Promise<{ handle: FileSystemFileHandle; path: string }> {
  const dirHandle = await ensurePdfItemFolder(rootHandle, manifest);
  const extension = type === "note" ? ".md" : ".ipynb";
  const title = sanitizeFileName(baseName) || (type === "note" ? "Reading Note" : "Notebook");
  const fileName = await generateUniqueName(dirHandle, title, extension);
  const content = type === "note"
    ? buildPdfMarkdownTemplate({
        pdfFileName: manifest.pdfPath.split("/").pop() ?? manifest.pdfPath,
        pdfPath: manifest.pdfPath,
        title,
      })
    : buildPdfNotebookTemplate({
        pdfPath: manifest.pdfPath,
        title,
      });

  const handle = await writeTextFile(dirHandle, fileName, content);
  return {
    handle,
    path: joinPath(manifest.itemFolderPath, fileName),
  };
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
  pdfPath: string;
  annotations: AnnotationItem[];
}): string {
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
    `pdf: "${input.pdfPath}"`,
    `updated: "${new Date().toISOString()}"`,
    "---",
    "",
    `# ${input.fileName} Annotations`,
    "",
    `Source PDF: [[${input.fileName}]]`,
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

    lines.push(`### ${index + 1}. ${getAnnotationTypeLabel(annotation)}`);
    lines.push(`- Locator: ${input.pdfPath}#page=${annotation.target.page}`);
    if (annotation.content?.trim()) {
      lines.push(`- Quote: ${annotation.content.trim()}`);
    }
    if (annotation.comment?.trim()) {
      lines.push(`- Comment: ${annotation.comment.trim()}`);
    }
    lines.push(`- Created: ${new Date(annotation.createdAt).toLocaleString("zh-CN")}`);
    lines.push("");
  });

  return lines.join("\n");
}

export async function syncPdfAnnotationsMarkdown(
  rootHandle: FileSystemDirectoryHandle,
  manifest: PdfItemManifest,
  fileName: string,
  annotations: AnnotationItem[],
): Promise<{ handle: FileSystemFileHandle; path: string; manifest: PdfItemManifest }> {
  const dirHandle = await ensurePdfItemFolder(rootHandle, manifest);
  const notePath = manifest.annotationNotePath ?? joinPath(manifest.itemFolderPath, DEFAULT_ANNOTATIONS_NOTE_NAME);
  const noteFileName = notePath.split("/").pop() ?? DEFAULT_ANNOTATIONS_NOTE_NAME;
  const markdown = buildPdfAnnotationsMarkdown({
    fileName,
    pdfPath: manifest.pdfPath,
    annotations,
  });

  const handle = await writeTextFile(dirHandle, noteFileName, markdown);
  const nextManifest: PdfItemManifest = {
    ...manifest,
    annotationNotePath: joinPath(manifest.itemFolderPath, noteFileName),
    updatedAt: Date.now(),
  };
  await savePdfItemManifest(rootHandle, nextManifest);

  return {
    handle,
    path: nextManifest.annotationNotePath ?? notePath,
    manifest: nextManifest,
  };
}

export async function listPdfItemNotes(
  rootHandle: FileSystemDirectoryHandle,
  manifest: PdfItemManifest,
): Promise<PdfItemNoteSummary[]> {
  const dirHandle = await resolveDirectoryHandle(rootHandle, manifest.itemFolderPath);
  if (!dirHandle) {
    return manifest.annotationNotePath
      ? [{
          path: manifest.annotationNotePath,
          fileName: manifest.annotationNotePath.split("/").pop() ?? DEFAULT_ANNOTATIONS_NOTE_NAME,
          type: "annotation-note",
        }]
      : [];
  }

  const notes: PdfItemNoteSummary[] = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind !== "file") {
      continue;
    }

    const fileName = entry.name;
    if (fileName.toLowerCase().endsWith(".md")) {
      const path = joinPath(manifest.itemFolderPath, fileName);
      notes.push({
        path,
        fileName,
        type: manifest.annotationNotePath === path ? "annotation-note" : "note",
      });
      continue;
    }

    if (fileName.toLowerCase().endsWith(".ipynb")) {
      notes.push({
        path: joinPath(manifest.itemFolderPath, fileName),
        fileName,
        type: "notebook",
      });
    }
  }

  return notes.sort((left, right) => {
    const weight = (note: PdfItemNoteSummary) => note.type === "annotation-note" ? 0 : note.type === "note" ? 1 : 2;
    return weight(left) - weight(right) || left.fileName.localeCompare(right.fileName);
  });
}
