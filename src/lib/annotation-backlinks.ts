import { getExtension, isIgnoredDirectory } from "@/lib/constants";
import { parseLinkTarget } from "@/lib/link-router/parse-link-target";
import { normalizeWorkspacePath } from "@/lib/link-router/path-utils";

export interface AnnotationBacklink {
  sourceFile: string;
  lineNumber: number;
  context: string;
  annotationId: string;
  pdfFile: string;
  displayText?: string;
}

export interface BacklinkIndex {
  byAnnotation: Map<string, AnnotationBacklink[]>;
  byPdfFile: Map<string, Set<string>>;
  lastScan: number;
}

const WIKI_LINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const MARKDOWN_LINK_PATTERN = /\[([^\]]*)\]\(([^)]+)\)/g;

let backlinkIndex: BacklinkIndex = {
  byAnnotation: new Map(),
  byPdfFile: new Map(),
  lastScan: 0,
};

function createEmptyBacklinkIndex(): BacklinkIndex {
  return {
    byAnnotation: new Map(),
    byPdfFile: new Map(),
    lastScan: Date.now(),
  };
}

function buildContextSnippet(line: string, start: number, end: number): string {
  const contextStart = Math.max(0, start - 30);
  const contextEnd = Math.min(line.length, end + 30);
  let context = line.slice(contextStart, contextEnd);
  if (contextStart > 0) context = `...${context}`;
  if (contextEnd < line.length) context = `${context}...`;
  return context;
}

function pushBacklink(index: BacklinkIndex, backlink: AnnotationBacklink): void {
  if (!index.byAnnotation.has(backlink.annotationId)) {
    index.byAnnotation.set(backlink.annotationId, []);
  }

  const existing = index.byAnnotation.get(backlink.annotationId)!;
  const isDuplicate = existing.some(
    (candidate) =>
      candidate.sourceFile === backlink.sourceFile &&
      candidate.lineNumber === backlink.lineNumber &&
      candidate.annotationId === backlink.annotationId,
  );

  if (!isDuplicate) {
    existing.push(backlink);
  }

  if (!index.byPdfFile.has(backlink.pdfFile)) {
    index.byPdfFile.set(backlink.pdfFile, new Set());
  }
  index.byPdfFile.get(backlink.pdfFile)!.add(backlink.annotationId);
}

function extractLinkReference(
  rawTarget: string,
  sourceFile: string,
  line: string,
  lineNumber: number,
  displayText: string | undefined,
  startIndex: number,
  endIndex: number,
): AnnotationBacklink | null {
  const parsed = parseLinkTarget(rawTarget, { currentFilePath: sourceFile });
  if (!parsed.target || parsed.target.type !== "pdf_annotation") {
    return null;
  }

  return {
    sourceFile: normalizeWorkspacePath(sourceFile),
    lineNumber,
    context: buildContextSnippet(line, startIndex, endIndex),
    annotationId: parsed.target.annotationId,
    pdfFile: normalizeWorkspacePath(parsed.target.path),
    displayText: displayText?.trim() || undefined,
  };
}

export function getBacklinkIndex(): BacklinkIndex {
  return backlinkIndex;
}

export function clearBacklinkIndex(): void {
  backlinkIndex = createEmptyBacklinkIndex();
}

export function extractAnnotationReferences(
  content: string,
  sourceFile: string,
): AnnotationBacklink[] {
  const backlinks: AnnotationBacklink[] = [];
  const normalizedSourceFile = normalizeWorkspacePath(sourceFile);
  const lines = content.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    WIKI_LINK_PATTERN.lastIndex = 0;
    MARKDOWN_LINK_PATTERN.lastIndex = 0;

    let wikiMatch: RegExpExecArray | null;
    while ((wikiMatch = WIKI_LINK_PATTERN.exec(line)) !== null) {
      const backlink = extractLinkReference(
        wikiMatch[1],
        normalizedSourceFile,
        line,
        index + 1,
        wikiMatch[2],
        wikiMatch.index,
        wikiMatch.index + wikiMatch[0].length,
      );
      if (backlink) {
        backlinks.push(backlink);
      }
    }

    let markdownMatch: RegExpExecArray | null;
    while ((markdownMatch = MARKDOWN_LINK_PATTERN.exec(line)) !== null) {
      const backlink = extractLinkReference(
        markdownMatch[2],
        normalizedSourceFile,
        line,
        index + 1,
        markdownMatch[1],
        markdownMatch.index,
        markdownMatch.index + markdownMatch[0].length,
      );
      if (backlink) {
        backlinks.push(backlink);
      }
    }
  }

  return backlinks;
}

export function indexNoteBacklinks(
  content: string,
  sourceFile: string,
): void {
  const backlinks = extractAnnotationReferences(content, sourceFile);
  backlinks.forEach((backlink) => pushBacklink(backlinkIndex, backlink));
  backlinkIndex.lastScan = Date.now();
}

export function removeNoteBacklinks(sourceFile: string): void {
  const normalizedSourceFile = normalizeWorkspacePath(sourceFile);

  for (const [annotationId, backlinks] of backlinkIndex.byAnnotation) {
    const filtered = backlinks.filter((backlink) => backlink.sourceFile !== normalizedSourceFile);
    if (filtered.length === 0) {
      backlinkIndex.byAnnotation.delete(annotationId);
    } else {
      backlinkIndex.byAnnotation.set(annotationId, filtered);
    }
  }

  backlinkIndex.byPdfFile.clear();
  for (const [annotationId, backlinks] of backlinkIndex.byAnnotation) {
    backlinks.forEach((backlink) => {
      if (!backlinkIndex.byPdfFile.has(backlink.pdfFile)) {
        backlinkIndex.byPdfFile.set(backlink.pdfFile, new Set());
      }
      backlinkIndex.byPdfFile.get(backlink.pdfFile)!.add(annotationId);
    });
  }
}

export function getBacklinksForAnnotation(annotationId: string): AnnotationBacklink[] {
  return backlinkIndex.byAnnotation.get(annotationId) || [];
}

export function getAnnotationsWithBacklinks(pdfFile: string): string[] {
  const annotationIds = backlinkIndex.byPdfFile.get(normalizeWorkspacePath(pdfFile));
  return annotationIds ? Array.from(annotationIds) : [];
}

export function hasBacklinks(annotationId: string): boolean {
  const backlinks = backlinkIndex.byAnnotation.get(annotationId);
  return Boolean(backlinks && backlinks.length > 0);
}

export function getBacklinkCount(annotationId: string): number {
  return backlinkIndex.byAnnotation.get(annotationId)?.length || 0;
}

export function scanNotesForBacklinks(
  notes: Array<{ path: string; content: string }>,
): void {
  clearBacklinkIndex();
  notes.forEach((note) => indexNoteBacklinks(note.content, note.path));
}

export async function scanWorkspaceMarkdownBacklinks(
  rootHandle: FileSystemDirectoryHandle,
): Promise<BacklinkIndex> {
  const collectedNotes: Array<{ path: string; content: string }> = [];

  const visitDirectory = async (
    directoryHandle: FileSystemDirectoryHandle,
    currentPath: string,
  ): Promise<void> => {
    for await (const entry of directoryHandle.values()) {
      const entryPath = `${currentPath}/${entry.name}`;
      if (entry.kind === "directory") {
        if (isIgnoredDirectory(entry.name)) {
          continue;
        }
        await visitDirectory(entry as FileSystemDirectoryHandle, entryPath);
        continue;
      }

      const extension = getExtension(entry.name);
      if (extension !== "md" && extension !== "markdown") {
        continue;
      }
      if (entry.name === "_annotations.md") {
        continue;
      }

      const content = await (await (entry as FileSystemFileHandle).getFile()).text();
      collectedNotes.push({
        path: normalizeWorkspacePath(entryPath),
        content,
      });
    }
  };

  await visitDirectory(rootHandle, normalizeWorkspacePath(rootHandle.name));
  scanNotesForBacklinks(collectedNotes);
  return backlinkIndex;
}

export function generateAnnotationReference(
  pdfFile: string,
  annotationId: string,
  displayText?: string,
): string {
  if (displayText) {
    return `[[${pdfFile}#${annotationId}|${displayText}]]`;
  }
  return `[[${pdfFile}#${annotationId}]]`;
}

export function buildBacklinkNavigationTarget(backlink: AnnotationBacklink): string {
  return `${backlink.sourceFile}#line=${backlink.lineNumber}`;
}
