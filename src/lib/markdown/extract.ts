import matter from "gray-matter";
import type {
  MarkdownCallout,
  MarkdownCodeBlock,
  MarkdownDocumentModel,
  MarkdownEmbed,
  MarkdownHeading,
  MarkdownLink,
  MarkdownPosition,
  MarkdownRange,
  MarkdownTag,
  MarkdownTask,
} from "./model";

interface LineInfo {
  text: string;
  line: number;
  offset: number;
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

function parseFrontmatter(content: string): { body: string; frontmatter?: Record<string, unknown> } {
  try {
    const parsed = matter(content);
    return {
      body: normalizeLineEndings(parsed.content),
      frontmatter: Object.keys(parsed.data).length > 0 ? parsed.data : undefined,
    };
  } catch {
    return { body: normalizeLineEndings(content) };
  }
}

function linesWithOffsets(content: string): LineInfo[] {
  const lines = content.split("\n");
  let offset = 0;
  return lines.map((text, index) => {
    const lineInfo = { text, line: index, offset };
    offset += text.length + 1;
    return lineInfo;
  });
}

function position(line: LineInfo, col: number): MarkdownPosition {
  return {
    line: line.line,
    col,
    offset: line.offset + col,
  };
}

function range(line: LineInfo, startCol: number, endCol: number): MarkdownRange {
  return {
    start: position(line, startCol),
    end: position(line, endCol),
  };
}

function isInsideCodeFence(line: string, inFence: boolean): boolean {
  const trimmed = line.trim();
  if (!/^(`{3,}|~{3,})/.test(trimmed)) {
    return inFence;
  }
  return !inFence;
}

function extractHeadings(lineInfos: LineInfo[]): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  let inFence = false;
  for (const lineInfo of lineInfos) {
    const nextFence = isInsideCodeFence(lineInfo.text, inFence);
    if (nextFence !== inFence) {
      inFence = nextFence;
      continue;
    }
    if (inFence) continue;
    const match = lineInfo.text.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (!match) continue;
    headings.push({
      text: match[2].trim(),
      level: match[1].length,
      range: range(lineInfo, 0, lineInfo.text.length),
    });
  }
  return headings;
}

function extractLinksAndEmbeds(lineInfos: LineInfo[]): { links: MarkdownLink[]; embeds: MarkdownEmbed[] } {
  const links: MarkdownLink[] = [];
  const embeds: MarkdownEmbed[] = [];
  let inFence = false;

  for (const lineInfo of lineInfos) {
    const nextFence = isInsideCodeFence(lineInfo.text, inFence);
    if (nextFence !== inFence) {
      inFence = nextFence;
      continue;
    }
    if (inFence) continue;

    for (const match of lineInfo.text.matchAll(/(!?)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
      const embedded = match[1] === "!";
      const target = match[2].trim();
      const label = match[3]?.trim();
      const itemRange = range(lineInfo, match.index ?? 0, (match.index ?? 0) + match[0].length);
      links.push({
        kind: "wiki",
        target,
        label,
        embedded,
        range: itemRange,
      });
      if (embedded) {
        embeds.push({
          target,
          label,
          kind: "wiki",
          range: itemRange,
        });
      }
    }

    for (const match of lineInfo.text.matchAll(/(!?)\[([^\]]*)\]\(([^)]+)\)/g)) {
      const embedded = match[1] === "!";
      const label = match[2].trim();
      const target = match[3].trim();
      const itemRange = range(lineInfo, match.index ?? 0, (match.index ?? 0) + match[0].length);
      links.push({
        kind: "markdown",
        target,
        label: label || undefined,
        embedded,
        range: itemRange,
      });
      if (embedded) {
        embeds.push({
          target,
          label: label || undefined,
          kind: "image",
          range: itemRange,
        });
      }
    }
  }

  return { links, embeds };
}

function extractTags(lineInfos: LineInfo[]): MarkdownTag[] {
  const tags: MarkdownTag[] = [];
  let inFence = false;
  for (const lineInfo of lineInfos) {
    const nextFence = isInsideCodeFence(lineInfo.text, inFence);
    if (nextFence !== inFence) {
      inFence = nextFence;
      continue;
    }
    if (inFence) continue;
    for (const match of lineInfo.text.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) {
      const start = (match.index ?? 0) + match[0].indexOf("#") + 1;
      tags.push({
        tag: match[1],
        range: range(lineInfo, start, start + match[1].length),
      });
    }
  }
  return tags;
}

function extractTasks(lineInfos: LineInfo[]): MarkdownTask[] {
  const tasks: MarkdownTask[] = [];
  let inFence = false;
  for (const lineInfo of lineInfos) {
    const nextFence = isInsideCodeFence(lineInfo.text, inFence);
    if (nextFence !== inFence) {
      inFence = nextFence;
      continue;
    }
    if (inFence) continue;
    const match = lineInfo.text.match(/^(\s*[-*+]\s+\[([ xX])\]\s+)(.*)$/);
    if (!match) continue;
    tasks.push({
      checked: match[2].toLowerCase() === "x",
      text: match[3],
      range: range(lineInfo, 0, lineInfo.text.length),
    });
  }
  return tasks;
}

function extractCallouts(lineInfos: LineInfo[]): MarkdownCallout[] {
  const callouts: MarkdownCallout[] = [];
  let inFence = false;
  for (const lineInfo of lineInfos) {
    const nextFence = isInsideCodeFence(lineInfo.text, inFence);
    if (nextFence !== inFence) {
      inFence = nextFence;
      continue;
    }
    if (inFence) continue;
    const match = lineInfo.text.match(/^>\s*\[!([A-Za-z][\w-]*)\]([+-])?\s*(.*)$/);
    if (!match) continue;
    callouts.push({
      type: match[1].toLowerCase(),
      fold: match[2] as "+" | "-" | undefined,
      title: match[3]?.trim() || undefined,
      range: range(lineInfo, 0, lineInfo.text.length),
    });
  }
  return callouts;
}

function extractCodeBlocks(lineInfos: LineInfo[]): MarkdownCodeBlock[] {
  const blocks: MarkdownCodeBlock[] = [];
  let start: LineInfo | null = null;
  let language: string | undefined;
  let codeLines: string[] = [];

  for (const lineInfo of lineInfos) {
    const fenceMatch = lineInfo.text.trim().match(/^(`{3,}|~{3,})(.*)$/);
    if (!fenceMatch) {
      if (start) codeLines.push(lineInfo.text);
      continue;
    }

    if (!start) {
      start = lineInfo;
      language = fenceMatch[2]?.trim() || undefined;
      codeLines = [];
      continue;
    }

    blocks.push({
      language,
      code: codeLines.join("\n"),
      range: {
        start: position(start, 0),
        end: position(lineInfo, lineInfo.text.length),
      },
    });
    start = null;
    language = undefined;
    codeLines = [];
  }

  return blocks;
}

export function extractMarkdownDocument(content: string): MarkdownDocumentModel {
  const raw = normalizeLineEndings(content);
  const { body, frontmatter } = parseFrontmatter(raw);
  const lineInfos = linesWithOffsets(body);
  const { links, embeds } = extractLinksAndEmbeds(lineInfos);

  return {
    raw,
    body,
    frontmatter,
    headings: extractHeadings(lineInfos),
    links,
    tags: extractTags(lineInfos),
    tasks: extractTasks(lineInfos),
    callouts: extractCallouts(lineInfos),
    embeds,
    codeBlocks: extractCodeBlocks(lineInfos),
  };
}
