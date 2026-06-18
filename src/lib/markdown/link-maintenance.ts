import { normalizeWorkspacePath } from "@/lib/link-router/path-utils";
import type { IndexedMarkdownLink } from "./link-index";
import type { MarkdownUnlinkedMention } from "./workspace-link-index";

export interface LinkUnlinkedMentionResult {
  content: string;
  changed: boolean;
}

export interface LinkUnlinkedMentionsResult {
  content: string;
  changed: boolean;
  linkedCount: number;
}

export interface RepairMarkdownLinkTargetResult {
  content: string;
  changed: boolean;
}

export interface MarkdownLinkToWikiResult {
  content: string;
  changed: boolean;
}

export interface MarkdownLinkToWikiReplacement {
  replacement: string;
  target: string;
  alias?: string;
  embedded: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildWikiTarget(fromFile: string, toFile: string): string {
  const fromParts = normalizeWorkspacePath(fromFile).split("/").filter(Boolean);
  const toParts = normalizeWorkspacePath(toFile).split("/").filter(Boolean);
  fromParts.pop();

  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common += 1;
  }

  const up = fromParts.slice(common).map(() => "..");
  const down = toParts.slice(common);
  return [...up, ...down].join("/") || toParts.join("/");
}

export function linkMentionInLine(line: string, mention: MarkdownUnlinkedMention): string {
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escapeRegExp(mention.mention)})($|[^\\p{L}\\p{N}_])`, "iu");
  const wikiTarget = buildWikiTarget(mention.sourceFile, mention.targetFile).replace(/\.(md|markdown)$/i, "");
  return line.replace(pattern, (_match, before: string, matched: string, after: string) => {
    return `${before}[[${wikiTarget}|${matched}]]${after}`;
  });
}

export function linkUnlinkedMentionInContent(
  content: string,
  mention: MarkdownUnlinkedMention,
): LinkUnlinkedMentionResult {
  const lines = content.split("\n");
  const lineIndex = mention.sourceLine - 1;
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return { content, changed: false };
  }

  const nextLine = linkMentionInLine(lines[lineIndex], mention);
  if (nextLine === lines[lineIndex]) {
    return { content, changed: false };
  }

  lines[lineIndex] = nextLine;
  return {
    content: lines.join("\n"),
    changed: true,
  };
}

export function linkUnlinkedMentionsInContent(
  content: string,
  mentions: MarkdownUnlinkedMention[],
): LinkUnlinkedMentionsResult {
  const relevantMentions = mentions
    .slice()
    .sort((left, right) => right.sourceLine - left.sourceLine);
  let nextContent = content;
  let linkedCount = 0;

  for (const mention of relevantMentions) {
    const result = linkUnlinkedMentionInContent(nextContent, mention);
    if (!result.changed) {
      continue;
    }
    nextContent = result.content;
    linkedCount += 1;
  }

  return {
    content: nextContent,
    changed: linkedCount > 0,
    linkedCount,
  };
}

function encodeMarkdownTarget(target: string): string {
  return target.replace(/[\s<>]/g, (char) => encodeURIComponent(char));
}

function stripMarkdownExtension(path: string): string {
  return normalizeWorkspacePath(path).replace(/\.(md|markdown)$/i, "");
}

function decodeMarkdownTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function normalizeMarkdownLinkTargetForWiki(rawTarget: string): string {
  const [pathPart, ...fragmentParts] = decodeMarkdownTarget(rawTarget).split("#");
  const normalizedPath = normalizeWorkspacePath(pathPart).replace(/\.(md|markdown)$/i, "");
  const fragment = fragmentParts.length > 0 ? `#${fragmentParts.join("#")}` : "";
  return `${normalizedPath}${fragment}`;
}

export function buildMarkdownLinkToWikiReplacement(
  markdownLinkSource: string,
): MarkdownLinkToWikiReplacement | null {
  const match = markdownLinkSource.match(/^(!?)\[([^\]]*?)\]\(([^)]+?)\)$/);
  if (!match) return null;

  const embedded = match[1] === "!";
  const label = match[2]?.trim() ?? "";
  const target = normalizeMarkdownLinkTargetForWiki(match[3].trim());
  if (!target) return null;

  const alias = label && label !== target ? label : undefined;
  const aliasSuffix = alias ? `|${alias}` : "";
  return {
    replacement: `${embedded ? "!" : ""}[[${target}${aliasSuffix}]]`,
    target,
    alias,
    embedded,
  };
}

function buildReplacementTarget(sourceFile: string, targetFile: string, preserveMarkdownExtension: boolean): string {
  const relative = buildWikiTarget(sourceFile, targetFile);
  return preserveMarkdownExtension ? relative : stripMarkdownExtension(relative);
}

function isTargetInsideWikiLink(content: string, targetStart: number): boolean {
  const lineStart = content.lastIndexOf("\n", targetStart - 1) + 1;
  const beforeTarget = content.slice(lineStart, targetStart);
  const lastWikiOpen = beforeTarget.lastIndexOf("[[");
  const lastMarkdownOpen = beforeTarget.lastIndexOf("](");
  return lastWikiOpen >= 0 && lastWikiOpen > lastMarkdownOpen;
}

export function repairMarkdownLinkTargetInContent(
  content: string,
  link: IndexedMarkdownLink,
  targetFile: string,
): RepairMarkdownLinkTargetResult {
  const start = link.range.start.offset;
  const end = link.range.end.offset;
  if (start < 0 || end <= start || end > content.length) {
    return { content, changed: false };
  }

  const original = content.slice(start, end);
  if (!original.includes(link.rawTarget)) {
    return { content, changed: false };
  }

  const isWikiLink = isTargetInsideWikiLink(content, start);
  const nextRawTarget = isWikiLink
    ? buildReplacementTarget(link.sourceFile, targetFile, false)
    : encodeMarkdownTarget(buildReplacementTarget(link.sourceFile, targetFile, true));
  const repaired = original.replace(link.rawTarget, nextRawTarget);
  if (repaired === original) {
    return { content, changed: false };
  }

  return {
    content: `${content.slice(0, start)}${repaired}${content.slice(end)}`,
    changed: true,
  };
}

export function convertMarkdownLinkToWikiInContent(
  content: string,
  link: IndexedMarkdownLink,
): MarkdownLinkToWikiResult {
  const start = link.range.start.offset;
  const end = link.range.end.offset;
  if (start < 0 || end <= start || end > content.length) {
    return { content, changed: false };
  }

  const original = content.slice(start, end);
  if (!original.includes(link.rawTarget) || isTargetInsideWikiLink(content, start)) {
    return { content, changed: false };
  }

  const replacement = buildMarkdownLinkToWikiReplacement(original);
  if (!replacement || replacement.replacement === original) {
    return { content, changed: false };
  }

  return {
    content: `${content.slice(0, start)}${replacement.replacement}${content.slice(end)}`,
    changed: true,
  };
}
