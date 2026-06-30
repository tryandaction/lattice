import { buildWorkspaceCandidatePaths, isSameWorkspacePath, normalizeWorkspacePath } from "@/lib/link-router/path-utils";
import { parseLinkTarget } from "@/lib/link-router/parse-link-target";
import type { LinkTarget } from "@/lib/link-router/types";
import { extractMarkdownDocument } from "./extract";
import type { MarkdownLink, MarkdownRange } from "./model";

export interface MarkdownIndexNote {
  path: string;
  content: string;
}

export interface IndexedMarkdownLink {
  sourceFile: string;
  rawTarget: string;
  displayText?: string;
  embedded: boolean;
  range: MarkdownRange;
  parsedTarget: LinkTarget | null;
  resolvedPath?: string;
  resolution: MarkdownLinkResolution;
  broken: boolean;
}

export type MarkdownLinkResolutionKind =
  | "external"
  | "system"
  | "exact"
  | "extensionless"
  | "basename"
  | "unresolved";

export interface MarkdownLinkResolution {
  kind: MarkdownLinkResolutionKind;
  resolvedPath?: string;
  repairCandidates: string[];
}

export interface MarkdownBacklink {
  sourceFile: string;
  sourceLine: number;
  rawTarget: string;
  displayText?: string;
  embedded: boolean;
  context: string;
  parsedTarget: LinkTarget | null;
}

export interface MarkdownLinkIndex {
  outgoingByFile: Map<string, IndexedMarkdownLink[]>;
  backlinksByFile: Map<string, MarkdownBacklink[]>;
  brokenLinks: IndexedMarkdownLink[];
}

function createEmptyLinkIndex(): MarkdownLinkIndex {
  return {
    outgoingByFile: new Map(),
    backlinksByFile: new Map(),
    brokenLinks: [],
  };
}

function normalizeNotePath(path: string): string {
  return normalizeWorkspacePath(path);
}

function stripMarkdownExtension(path: string): string {
  return normalizeNotePath(path).replace(/\.(md|markdown)$/i, "");
}

function buildKnownFileSet(notes: MarkdownIndexNote[]): Set<string> {
  const known = new Set<string>();
  for (const note of notes) {
    const normalized = normalizeNotePath(note.path);
    known.add(normalized);
  }
  return known;
}

function findByExtensionlessPath(knownFiles: Set<string>, path: string): string | undefined {
  const extensionless = stripMarkdownExtension(path);
  return Array.from(knownFiles).find((known) => isSameWorkspacePath(stripMarkdownExtension(known), extensionless));
}

function findByBasename(knownFiles: Set<string>, path: string): string | undefined {
  const basename = stripMarkdownExtension(path).split("/").pop();
  if (!basename) return undefined;
  return Array.from(knownFiles).find((known) => stripMarkdownExtension(known).split("/").pop() === basename);
}

function findRepairCandidatesByLabel(knownFiles: Set<string>, label?: string): string[] {
  const trimmed = label?.trim();
  if (!trimmed) {
    return [];
  }

  const normalizedLabel = stripMarkdownExtension(trimmed).split("/").pop()?.toLowerCase();
  if (!normalizedLabel) {
    return [];
  }

  return Array.from(knownFiles)
    .filter((known) => stripMarkdownExtension(known).split("/").pop()?.toLowerCase() === normalizedLabel)
    .sort();
}

function createResolution(
  kind: MarkdownLinkResolutionKind,
  resolvedPath?: string,
  repairCandidates: string[] = [],
): MarkdownLinkResolution {
  return {
    kind,
    resolvedPath,
    repairCandidates: Array.from(new Set(repairCandidates)).sort(),
  };
}

function resolveKnownWorkspacePath(
  target: LinkTarget | null,
  knownFiles: Set<string>,
  displayText?: string,
): MarkdownLinkResolution {
  if (target?.type === "external_url") {
    return createResolution("external");
  }
  if (target?.type === "system_path") {
    return createResolution("system");
  }
  if (!target || !("path" in target)) {
    return createResolution("unresolved", undefined, findRepairCandidatesByLabel(knownFiles, displayText));
  }

  const candidates = buildWorkspaceCandidatePaths(target.path);
  for (const [index, candidate] of candidates.entries()) {
    const normalized = normalizeNotePath(candidate);
    if (knownFiles.has(normalized)) {
      return createResolution(index === 0 ? "exact" : "extensionless", normalized, index === 0 ? [] : [normalized]);
    }
    const extensionlessMatch = findByExtensionlessPath(knownFiles, normalized);
    if (extensionlessMatch) {
      return createResolution("extensionless", extensionlessMatch, [extensionlessMatch]);
    }
  }

  const basenameMatch = findByBasename(knownFiles, target.path);
  if (basenameMatch) {
    return createResolution("basename", basenameMatch, [basenameMatch]);
  }

  return createResolution("unresolved", undefined, findRepairCandidatesByLabel(knownFiles, displayText));
}

function isWorkspaceTarget(target: LinkTarget | null): boolean {
  return Boolean(target && "path" in target && target.type !== "system_path");
}

function isBrokenLink(target: LinkTarget | null, resolvedPath: string | undefined): boolean {
  if (!target) return true;
  if (target.type === "external_url" || target.type === "system_path") return false;
  return isWorkspaceTarget(target) && !resolvedPath;
}

function getLineContext(content: string, lineNumber: number): string {
  return content.split("\n")[lineNumber - 1]?.trim() ?? "";
}

function toIndexedLink(
  sourceFile: string,
  markdownLink: MarkdownLink,
  knownFiles: Set<string>,
): IndexedMarkdownLink {
  const parsed = parseLinkTarget(markdownLink.target, { currentFilePath: sourceFile });
  const resolution = resolveKnownWorkspacePath(parsed.target, knownFiles, markdownLink.label);
  const resolvedPath = resolution.resolvedPath;
  return {
    sourceFile,
    rawTarget: markdownLink.target,
    displayText: markdownLink.label,
    embedded: markdownLink.embedded,
    range: markdownLink.range,
    parsedTarget: parsed.target,
    resolvedPath,
    resolution,
    broken: isBrokenLink(parsed.target, resolvedPath),
  };
}

function toBacklink(link: IndexedMarkdownLink, content: string): MarkdownBacklink {
  const sourceLine = link.range.start.line + 1;
  return {
    sourceFile: link.sourceFile,
    sourceLine,
    rawTarget: link.rawTarget,
    displayText: link.displayText,
    embedded: link.embedded,
    context: getLineContext(content, sourceLine),
    parsedTarget: link.parsedTarget,
  };
}

export function buildMarkdownLinkIndex(notes: MarkdownIndexNote[]): MarkdownLinkIndex {
  const index = createEmptyLinkIndex();
  const knownFiles = buildKnownFileSet(notes);
  const contentByPath = new Map<string, string>();

  for (const note of notes) {
    const sourceFile = normalizeNotePath(note.path);
    contentByPath.set(sourceFile, note.content);
    const document = extractMarkdownDocument(note.content);
    const outgoing = document.links.map((link) => toIndexedLink(sourceFile, link, knownFiles));
    index.outgoingByFile.set(sourceFile, outgoing);
    outgoing.filter((link) => link.broken).forEach((link) => index.brokenLinks.push(link));
  }

  for (const [sourceFile, links] of index.outgoingByFile) {
    const content = contentByPath.get(sourceFile) ?? "";
    for (const link of links) {
      if (!link.resolvedPath) continue;
      const backlink = toBacklink(link, content);
      const bucket = index.backlinksByFile.get(link.resolvedPath) ?? [];
      bucket.push(backlink);
      index.backlinksByFile.set(link.resolvedPath, bucket);
    }
  }

  return index;
}

export function getMarkdownBacklinks(index: MarkdownLinkIndex, filePath: string): MarkdownBacklink[] {
  const normalized = normalizeNotePath(filePath);
  return index.backlinksByFile.get(normalized) ?? index.backlinksByFile.get(stripMarkdownExtension(normalized)) ?? [];
}

export function getMarkdownOutgoingLinks(index: MarkdownLinkIndex, filePath: string): IndexedMarkdownLink[] {
  return index.outgoingByFile.get(normalizeNotePath(filePath)) ?? [];
}
