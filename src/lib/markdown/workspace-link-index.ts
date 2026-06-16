import { getExtension, isIgnoredDirectory } from "@/lib/constants";
import { buildRelativeWorkspacePath, normalizeWorkspacePath, safeDecodeLinkTarget } from "@/lib/link-router/path-utils";
import {
  buildMarkdownLinkIndex,
  getMarkdownBacklinks,
  getMarkdownOutgoingLinks,
  type IndexedMarkdownLink,
  type MarkdownBacklink,
  type MarkdownIndexNote,
  type MarkdownLinkIndex,
} from "./link-index";
import {
  buildLocalMarkdownGraph,
  buildMarkdownGraph,
  type BuildMarkdownGraphOptions,
  type MarkdownGraph,
} from "./graph";

export interface WorkspaceMarkdownLinkIndexSnapshot {
  index: MarkdownLinkIndex;
  lastScan: number;
  noteCount: number;
  isScanning: boolean;
}

export interface MarkdownUnlinkedMention {
  targetFile: string;
  sourceFile: string;
  sourceLine: number;
  context: string;
  mention: string;
}

export interface MarkdownRenameLinkUpdate {
  sourceFile: string;
  content: string;
}

const UNLINKED_MENTION_IGNORE_STORAGE_KEY = "lattice-markdown-unlinked-mention-ignore";
const listeners = new Set<() => void>();
const notesByPath = new Map<string, MarkdownIndexNote>();
const ignoredUnlinkedMentionKeys = new Set<string>();

let snapshot: WorkspaceMarkdownLinkIndexSnapshot = {
  index: buildMarkdownLinkIndex([]),
  lastScan: 0,
  noteCount: 0,
  isScanning: false,
};

function emitChange(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Subscribers should not break index updates.
    }
  }
}

function isMarkdownPath(path: string): boolean {
  const extension = getExtension(path);
  return extension === "md" || extension === "markdown";
}

function rebuildSnapshotFromNotes(options?: { isScanning?: boolean }): WorkspaceMarkdownLinkIndexSnapshot {
  const notes = Array.from(notesByPath.values());
  snapshot = {
    index: buildMarkdownLinkIndex(notes),
    lastScan: Date.now(),
    noteCount: notes.length,
    isScanning: options?.isScanning ?? false,
  };
  emitChange();
  return snapshot;
}

function stripMarkdownExtension(path: string): string {
  return normalizeWorkspacePath(path).replace(/\.(md|markdown)$/i, "");
}

function splitTargetFragment(target: string): { path: string; fragment: string } {
  const hashIndex = target.indexOf("#");
  if (hashIndex < 0) {
    return { path: target, fragment: "" };
  }
  return {
    path: target.slice(0, hashIndex),
    fragment: target.slice(hashIndex),
  };
}

function encodeMarkdownTarget(target: string): string {
  return target.replace(/[\s<>]/g, (char) => encodeURIComponent(char));
}

function pathsMatchForRename(sourceFile: string, rawTarget: string, oldPath: string): boolean {
  const decodedTarget = safeDecodeLinkTarget(rawTarget.trim());
  const { path } = splitTargetFragment(decodedTarget);
  const normalizedOldPath = normalizeWorkspacePath(oldPath);
  const normalizedTarget = normalizeWorkspacePath(path);
  const relativeTarget = normalizeWorkspacePath(buildRelativeWorkspacePath(sourceFile, normalizedOldPath));

  return (
    normalizedTarget === normalizedOldPath ||
    stripMarkdownExtension(normalizedTarget) === stripMarkdownExtension(normalizedOldPath) ||
    normalizedTarget === relativeTarget ||
    stripMarkdownExtension(normalizedTarget) === stripMarkdownExtension(relativeTarget)
  );
}

function buildRenamedTarget(sourceFile: string, rawTarget: string, newPath: string): string {
  const decodedTarget = safeDecodeLinkTarget(rawTarget.trim());
  const { fragment } = splitTargetFragment(decodedTarget);
  return `${buildRelativeWorkspacePath(sourceFile, newPath)}${fragment}`;
}

export function rewriteMarkdownLinksForRenamedTarget(content: string, sourceFile: string, oldPath: string, newPath: string): string {
  const rewriteTarget = (rawTarget: string) => {
    if (!pathsMatchForRename(sourceFile, rawTarget, oldPath)) {
      return rawTarget;
    }
    return buildRenamedTarget(sourceFile, rawTarget, newPath);
  };

  const withWikiLinks = content.replace(/(!?)\[\[([^\]|]+(?:#[^\]|]+)?)(\|[^\]]+)?\]\]/g, (match, embedPrefix: string, rawTarget: string, alias = "") => {
    const nextTarget = rewriteTarget(rawTarget);
    if (nextTarget === rawTarget) return match;
    return `${embedPrefix}[[${nextTarget}${alias}]]`;
  });

  return withWikiLinks.replace(/(!?)\[([^\]]*)\]\(([^)]+)\)/g, (match, embedPrefix: string, label: string, rawTarget: string) => {
    const nextTarget = rewriteTarget(rawTarget);
    if (nextTarget === rawTarget) return match;
    return `${embedPrefix}[${label}](${encodeMarkdownTarget(nextTarget)})`;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getMentionCandidates(filePath: string): string[] {
  const extensionless = stripMarkdownExtension(filePath);
  const basename = extensionless.split("/").pop();
  if (!basename) return [];

  const readable = basename.replace(/[-_]+/g, " ").trim();
  return Array.from(new Set([basename, readable].filter((candidate) => candidate.length >= 2)));
}

function stripInlineLinkSyntax(line: string): string {
  return line
    .replace(/!?\[\[[^\]]+\]\]/g, " ")
    .replace(/!?\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/`[^`]*`/g, " ");
}

function lineMentionsCandidate(line: string, candidate: string): boolean {
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(candidate)}($|[^\\p{L}\\p{N}_])`, "iu");
  return pattern.test(stripInlineLinkSyntax(line));
}

function getUnlinkedMentionKey(input: Pick<MarkdownUnlinkedMention, "targetFile" | "sourceFile" | "sourceLine" | "mention">): string {
  return [
    normalizeWorkspacePath(input.targetFile),
    normalizeWorkspacePath(input.sourceFile),
    input.sourceLine,
    input.mention.toLowerCase(),
  ].join("::");
}

function loadIgnoredUnlinkedMentionKeys(): void {
  if (ignoredUnlinkedMentionKeys.size > 0 || typeof window === "undefined") {
    return;
  }
  try {
    const raw = window.localStorage.getItem(UNLINKED_MENTION_IGNORE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      for (const key of parsed) {
        if (typeof key === "string") {
          ignoredUnlinkedMentionKeys.add(key);
        }
      }
    }
  } catch {
    ignoredUnlinkedMentionKeys.clear();
  }
}

function saveIgnoredUnlinkedMentionKeys(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      UNLINKED_MENTION_IGNORE_STORAGE_KEY,
      JSON.stringify(Array.from(ignoredUnlinkedMentionKeys).sort()),
    );
  } catch {
    // Ignore persistence failures for local UI preferences.
  }
}

export function subscribeWorkspaceMarkdownLinkIndex(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWorkspaceMarkdownLinkIndex(): WorkspaceMarkdownLinkIndexSnapshot {
  return snapshot;
}

export function clearWorkspaceMarkdownLinkIndex(): void {
  notesByPath.clear();
  ignoredUnlinkedMentionKeys.clear();
  snapshot = {
    index: buildMarkdownLinkIndex([]),
    lastScan: 0,
    noteCount: 0,
    isScanning: false,
  };
  emitChange();
}

async function collectMarkdownNotes(
  directoryHandle: FileSystemDirectoryHandle,
  currentPath: string,
  notes: MarkdownIndexNote[],
): Promise<void> {
  for await (const entry of directoryHandle.values()) {
    const entryPath = normalizeWorkspacePath(currentPath ? `${currentPath}/${entry.name}` : entry.name);
    if (entry.kind === "directory") {
      if (isIgnoredDirectory(entry.name)) {
        continue;
      }
      await collectMarkdownNotes(entry as FileSystemDirectoryHandle, entryPath, notes);
      continue;
    }

    if (!isMarkdownPath(entry.name)) {
      continue;
    }

    const file = await (entry as FileSystemFileHandle).getFile();
    notes.push({
      path: entryPath,
      content: await file.text(),
    });
  }
}

export async function scanWorkspaceMarkdownLinkIndex(
  rootHandle: FileSystemDirectoryHandle,
): Promise<WorkspaceMarkdownLinkIndexSnapshot> {
  if (snapshot.isScanning) {
    return snapshot;
  }

  snapshot = { ...snapshot, isScanning: true };
  emitChange();

  try {
    const notes: MarkdownIndexNote[] = [];
    await collectMarkdownNotes(rootHandle, "", notes);
    notesByPath.clear();
    for (const note of notes) {
      notesByPath.set(normalizeWorkspacePath(note.path), {
        path: normalizeWorkspacePath(note.path),
        content: note.content,
      });
    }
    return rebuildSnapshotFromNotes();
  } catch (error) {
    snapshot = { ...snapshot, isScanning: false };
    emitChange();
    throw error;
  }
}

export function upsertWorkspaceMarkdownFile(filePath: string, content: string): WorkspaceMarkdownLinkIndexSnapshot {
  const normalized = normalizeWorkspacePath(filePath);
  if (!isMarkdownPath(normalized)) {
    return snapshot;
  }

  notesByPath.set(normalized, { path: normalized, content });
  return rebuildSnapshotFromNotes();
}

export function removeWorkspaceMarkdownFile(filePath: string): WorkspaceMarkdownLinkIndexSnapshot {
  const normalized = normalizeWorkspacePath(filePath);
  if (!notesByPath.delete(normalized)) {
    return snapshot;
  }

  return rebuildSnapshotFromNotes();
}

export function renameWorkspaceMarkdownFile(
  oldPath: string,
  newPath: string,
  options: { rewriteReferences?: boolean } = {},
): WorkspaceMarkdownLinkIndexSnapshot {
  const normalizedOldPath = normalizeWorkspacePath(oldPath);
  const normalizedNewPath = normalizeWorkspacePath(newPath);
  const existing = notesByPath.get(normalizedOldPath);
  const shouldRewriteReferences = options.rewriteReferences ?? true;

  if (shouldRewriteReferences) {
    for (const [path, note] of notesByPath) {
      if (path === normalizedOldPath) continue;
      const rewrittenContent = rewriteMarkdownLinksForRenamedTarget(
        note.content,
        path,
        normalizedOldPath,
        normalizedNewPath,
      );
      if (rewrittenContent !== note.content) {
        notesByPath.set(path, { ...note, content: rewrittenContent });
      }
    }
  }

  if (existing) {
    notesByPath.delete(normalizedOldPath);
  }

  if (existing && isMarkdownPath(normalizedNewPath)) {
    notesByPath.set(normalizedNewPath, {
      path: normalizedNewPath,
      content: existing.content,
    });
  }

  if (!existing && !isMarkdownPath(normalizedOldPath) && !isMarkdownPath(normalizedNewPath)) {
    return snapshot;
  }

  return rebuildSnapshotFromNotes();
}

export function getWorkspaceMarkdownBacklinks(filePath: string): MarkdownBacklink[] {
  return getMarkdownBacklinks(snapshot.index, normalizeWorkspacePath(filePath));
}

export function getWorkspaceMarkdownOutgoingLinks(filePath: string): IndexedMarkdownLink[] {
  return getMarkdownOutgoingLinks(snapshot.index, normalizeWorkspacePath(filePath));
}

export function getWorkspaceMarkdownBrokenLinks(): IndexedMarkdownLink[] {
  return snapshot.index.brokenLinks;
}

export function getWorkspaceMarkdownFiles(): string[] {
  return Array.from(notesByPath.keys()).sort((left, right) => left.localeCompare(right));
}

export function getWorkspaceMarkdownRenameLinkUpdates(oldPath: string, newPath: string): MarkdownRenameLinkUpdate[] {
  const normalizedOldPath = normalizeWorkspacePath(oldPath);
  const normalizedNewPath = normalizeWorkspacePath(newPath);
  const updates: MarkdownRenameLinkUpdate[] = [];

  for (const [path, note] of notesByPath) {
    if (path === normalizedOldPath) {
      continue;
    }
    const content = rewriteMarkdownLinksForRenamedTarget(note.content, path, normalizedOldPath, normalizedNewPath);
    if (content !== note.content) {
      updates.push({
        sourceFile: path,
        content,
      });
    }
  }

  return updates.sort((left, right) => left.sourceFile.localeCompare(right.sourceFile));
}

export function ignoreWorkspaceMarkdownUnlinkedMention(mention: MarkdownUnlinkedMention): void {
  loadIgnoredUnlinkedMentionKeys();
  ignoredUnlinkedMentionKeys.add(getUnlinkedMentionKey(mention));
  saveIgnoredUnlinkedMentionKeys();
  emitChange();
}

export function clearWorkspaceMarkdownUnlinkedMentionIgnores(): void {
  ignoredUnlinkedMentionKeys.clear();
  saveIgnoredUnlinkedMentionKeys();
  emitChange();
}

export function getWorkspaceMarkdownGraph(options?: BuildMarkdownGraphOptions): MarkdownGraph {
  return buildMarkdownGraph(snapshot.index, options);
}

export function getWorkspaceMarkdownLocalGraph(filePath: string, depth = 1): MarkdownGraph {
  return buildLocalMarkdownGraph(getWorkspaceMarkdownGraph(), normalizeWorkspacePath(filePath), depth);
}

export function getWorkspaceMarkdownUnlinkedMentions(filePath: string): MarkdownUnlinkedMention[] {
  loadIgnoredUnlinkedMentionKeys();
  const normalized = normalizeWorkspacePath(filePath);
  const candidates = getMentionCandidates(normalized);
  if (candidates.length === 0) return [];

  const linkedSourceFiles = new Set(getWorkspaceMarkdownBacklinks(normalized).map((backlink) => backlink.sourceFile));
  const mentions: MarkdownUnlinkedMention[] = [];

  for (const [sourceFile, note] of notesByPath) {
    if (sourceFile === normalized || linkedSourceFiles.has(sourceFile)) {
      continue;
    }

    const lines = note.content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const mention = candidates.find((candidate) => lineMentionsCandidate(line, candidate));
      if (!mention) continue;

      const nextMention = {
        targetFile: normalized,
        sourceFile,
        sourceLine: index + 1,
        context: line.trim(),
        mention,
      };
      if (!ignoredUnlinkedMentionKeys.has(getUnlinkedMentionKey(nextMention))) {
        mentions.push(nextMention);
      }
    }
  }

  return mentions;
}
