import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { buildMarkdownLinkToWikiReplacement } from "@/lib/markdown/link-maintenance";

export type MarkdownContextKind =
  | "blank"
  | "text"
  | "heading"
  | "quote"
  | "list"
  | "task"
  | "callout"
  | "properties"
  | "link"
  | "image"
  | "table"
  | "math"
  | "code";

export type MarkdownEditingCommandId =
  | "format.bold"
  | "format.italic"
  | "format.code"
  | "format.strike"
  | "format.quote"
  | "format.link"
  | "insert.heading"
  | "insert.properties"
  | "insert.table"
  | "insert.callout"
  | "insert.taskList"
  | "insert.footnote"
  | "insert.codeBlock"
  | "insert.mathBlock"
  | "insert.image"
  | "insert.wikiLink"
  | "insert.wikiAlias"
  | "insert.headingAnchorLink"
  | "insert.blockAnchorLink"
  | "insert.embed"
  | "insert.emoji"
  | "insert.gif"
  | "insert.text"
  | "link.convertMarkdownToWiki"
  | "image.setWidth"
  | "image.clearWidth"
  | "image.replacePath"
  | "image.setAlt"
  | "image.openSource"
  | "properties.set"
  | "properties.convertLine"
  | "callout.update"
  | "callout.selectionToBody"
  | "callout.extractBody"
  | "callout.splitAtBodyLine"
  | "callout.copyBody"
  | "callout.duplicate"
  | "selection.delete"
  | "selection.selectAll";

export interface MarkdownCommandPayload {
  text?: string;
  url?: string;
  alt?: string;
  width?: number;
  language?: string;
  calloutType?: string;
  calloutTitle?: string;
  propertyKey?: string;
  propertyValue?: string;
  headingLevel?: number;
  heading?: string;
  blockId?: string;
  target?: string;
  alias?: string;
  rows?: number;
  columns?: number;
}

export interface MarkdownTextRange {
  from: number;
  to: number;
  startLine: number;
  endLine: number;
}

export interface MarkdownEditorContext {
  kind: MarkdownContextKind;
  range: MarkdownTextRange;
  lineNumber: number;
  selectedText: string;
  blockText: string;
  linkTarget?: string;
  imageUrl?: string;
  imageAlt?: string;
  imageWidth?: number;
  imageSyntax?: "markdown" | "wiki";
  calloutType?: string;
  calloutTitle?: string;
  calloutFoldMarker?: "" | "+" | "-";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getLineRange(view: EditorView, lineNumber: number): MarkdownTextRange {
  const safeLine = clamp(lineNumber, 1, view.state.doc.lines);
  const line = view.state.doc.line(safeLine);
  return {
    from: line.from,
    to: line.to,
    startLine: safeLine,
    endLine: safeLine,
  };
}

function getRangeText(view: EditorView, range: MarkdownTextRange): string {
  return view.state.sliceDoc(range.from, range.to);
}

function isTableLine(text: string): boolean {
  const trimmed = text.trim();
  if (/^!?\[\[[^\]]+\]\]$/.test(trimmed)) return false;
  return trimmed.includes("|") && /^\|?.+\|.+\|?$/.test(trimmed);
}

function isTableSeparatorLine(text: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(text);
}

function findTableRange(view: EditorView, lineNumber: number): MarkdownTextRange | null {
  const doc = view.state.doc;
  const line = doc.line(lineNumber);
  if (!isTableLine(line.text) && !isTableSeparatorLine(line.text)) {
    return null;
  }

  let startLine = lineNumber;
  let endLine = lineNumber;

  while (startLine > 1) {
    const previous = doc.line(startLine - 1);
    if (!isTableLine(previous.text) && !isTableSeparatorLine(previous.text)) break;
    startLine -= 1;
  }

  while (endLine < doc.lines) {
    const next = doc.line(endLine + 1);
    if (!isTableLine(next.text) && !isTableSeparatorLine(next.text)) break;
    endLine += 1;
  }

  const start = doc.line(startLine);
  const end = doc.line(endLine);
  return {
    from: start.from,
    to: end.to,
    startLine,
    endLine,
  };
}

function findFenceRange(view: EditorView, lineNumber: number): MarkdownTextRange | null {
  const doc = view.state.doc;
  let startLine: number | null = null;
  let fenceChar = "";
  let fenceLength = 0;

  for (let current = lineNumber; current >= 1; current -= 1) {
    const text = doc.line(current).text.trim();
    const open = text.match(/^(`{3,}|~{3,})/);
    if (!open) continue;
    startLine = current;
    fenceChar = open[1][0];
    fenceLength = open[1].length;
    break;
  }

  if (startLine === null) {
    return null;
  }

  const closePattern = new RegExp(`^${fenceChar}{${fenceLength},}\\s*$`);
  for (let current = startLine + 1; current <= doc.lines; current += 1) {
    if (!closePattern.test(doc.line(current).text.trim())) continue;
    if (lineNumber < startLine || lineNumber > current) return null;
    const start = doc.line(startLine);
    const end = doc.line(current);
    return {
      from: start.from,
      to: end.to,
      startLine,
      endLine: current,
    };
  }

  return null;
}

function findMathBlockRange(view: EditorView, lineNumber: number): MarkdownTextRange | null {
  const doc = view.state.doc;
  let startLine: number | null = null;

  for (let current = lineNumber; current >= 1; current -= 1) {
    if (doc.line(current).text.trim() === "$$") {
      startLine = current;
      break;
    }
  }

  if (startLine === null) return null;

  for (let current = startLine + 1; current <= doc.lines; current += 1) {
    if (doc.line(current).text.trim() !== "$$") continue;
    if (lineNumber < startLine || lineNumber > current) return null;
    const start = doc.line(startLine);
    const end = doc.line(current);
    return {
      from: start.from,
      to: end.to,
      startLine,
      endLine: current,
    };
  }

  return null;
}

interface CalloutRange extends MarkdownTextRange {
  type: string;
  title: string;
  foldMarker: "" | "+" | "-";
}

function parseCalloutHeader(text: string): { type: string; title: string; foldMarker: "" | "+" | "-" } | null {
  const match = text.match(/^\s*>\s*\[!([A-Za-z][\w-]*?)([+-])?\]\s*(.*)$/);
  if (!match) return null;
  return {
    type: match[1].toLowerCase(),
    foldMarker: (match[2] as "" | "+" | "-") || "",
    title: match[3]?.trim() ?? "",
  };
}

function findCalloutRange(view: EditorView, lineNumber: number): CalloutRange | null {
  const doc = view.state.doc;
  let startLine: number | null = null;
  let header: { type: string; title: string; foldMarker: "" | "+" | "-" } | null = null;

  for (let current = lineNumber; current >= 1; current -= 1) {
    const text = doc.line(current).text;
    const parsed = parseCalloutHeader(text);
    if (parsed) {
      startLine = current;
      header = parsed;
      break;
    }
    if (!/^\s*>/.test(text) && text.trim()) {
      break;
    }
  }

  if (startLine === null || !header) return null;

  let endLine = startLine;
  while (endLine < doc.lines) {
    const next = doc.line(endLine + 1).text;
    if (!/^\s*>/.test(next)) break;
    endLine += 1;
  }

  if (lineNumber < startLine || lineNumber > endLine) return null;

  const start = doc.line(startLine);
  const end = doc.line(endLine);
  return {
    from: start.from,
    to: end.to,
    startLine,
    endLine,
    type: header.type,
    title: header.title,
    foldMarker: header.foldMarker,
  };
}

function findFrontmatterRange(view: EditorView): MarkdownTextRange | null {
  const doc = view.state.doc;
  if (doc.lines < 2 || doc.line(1).text.trim() !== "---") {
    return null;
  }

  for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber += 1) {
    if (doc.line(lineNumber).text.trim() !== "---") continue;
    return {
      from: doc.line(1).from,
      to: doc.line(lineNumber).to,
      startLine: 1,
      endLine: lineNumber,
    };
  }

  return null;
}

export function getPropertiesYaml(view: EditorView): string | null {
  const range = findFrontmatterRange(view);
  return range ? view.state.sliceDoc(range.from, range.to) : null;
}

function matchAtOffset(
  text: string,
  offset: number,
  pattern: RegExp,
): RegExpExecArray | null {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset >= start && offset <= end) {
      return match;
    }
  }
  return null;
}

export function getMarkdownEditorContext(view: EditorView): MarkdownEditorContext {
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.head);
  const selectedText = view.state.sliceDoc(selection.from, selection.to);
  const cursorOffset = selection.head - line.from;

  const frontmatterRange = findFrontmatterRange(view);
  if (frontmatterRange && line.number >= frontmatterRange.startLine && line.number <= frontmatterRange.endLine) {
    return {
      kind: "properties",
      range: frontmatterRange,
      lineNumber: line.number,
      selectedText,
      blockText: getRangeText(view, frontmatterRange),
    };
  }

  const tableRange = findTableRange(view, line.number);
  if (tableRange) {
    return {
      kind: "table",
      range: tableRange,
      lineNumber: line.number,
      selectedText,
      blockText: getRangeText(view, tableRange),
    };
  }

  const codeRange = findFenceRange(view, line.number);
  if (codeRange) {
    return {
      kind: "code",
      range: codeRange,
      lineNumber: line.number,
      selectedText,
      blockText: getRangeText(view, codeRange),
    };
  }

  const mathRange = findMathBlockRange(view, line.number);
  if (mathRange || matchAtOffset(line.text, cursorOffset, /(?<!\\)\$[^$\n]+(?<!\\)\$/g)) {
    const range = mathRange ?? getLineRange(view, line.number);
    return {
      kind: "math",
      range,
      lineNumber: line.number,
      selectedText,
      blockText: getRangeText(view, range),
    };
  }

  const calloutRange = findCalloutRange(view, line.number);
  if (calloutRange) {
    return {
      kind: "callout",
      range: calloutRange,
      lineNumber: line.number,
      selectedText,
      blockText: getRangeText(view, calloutRange),
      calloutType: calloutRange.type,
      calloutTitle: calloutRange.title,
      calloutFoldMarker: calloutRange.foldMarker,
    };
  }

  const imageMatch = matchAtOffset(line.text, cursorOffset, /!\[([^\]]*?)\]\(([^)]+)\)/g);
  if (imageMatch) {
    const range = getLineRange(view, line.number);
    const image = findImageAtCursor(view);
    return {
      kind: "image",
      range,
      lineNumber: line.number,
      selectedText,
      blockText: getRangeText(view, range),
      imageUrl: image?.url ?? imageMatch[2],
      imageAlt: image?.alt ?? imageMatch[1],
      imageWidth: image?.width,
      imageSyntax: image?.syntax ?? "markdown",
    };
  }

  const wikiImageMatch = matchAtOffset(line.text, cursorOffset, /!\[\[([^\]]+?)\]\]/g);
  if (wikiImageMatch) {
    const image = findImageAtCursor(view);
    if (image) {
      const range = getLineRange(view, line.number);
      return {
        kind: "image",
        range,
        lineNumber: line.number,
        selectedText,
        blockText: getRangeText(view, range),
        imageUrl: image.url,
        imageAlt: image.alt,
        imageWidth: image.width,
        imageSyntax: image.syntax,
      };
    }
  }

  const linkMatch =
    matchAtOffset(line.text, cursorOffset, /\[([^\]]+?)\]\(([^)]+?)\)/g) ??
    matchAtOffset(line.text, cursorOffset, /\[\[([^\]]+?)\]\]/g);
  if (linkMatch) {
    const range = getLineRange(view, line.number);
    return {
      kind: "link",
      range,
      lineNumber: line.number,
      selectedText,
      blockText: getRangeText(view, range),
      linkTarget: linkMatch[2] ?? linkMatch[1],
    };
  }

  const trimmed = line.text.trim();
  let kind: MarkdownContextKind = "text";
  if (!trimmed) kind = "blank";
  else if (/^#{1,6}\s+/.test(line.text)) kind = "heading";
  else if (/^\s*>\s?/.test(line.text)) kind = "quote";
  else if (/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line.text)) kind = "task";
  else if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line.text)) kind = "list";

  const range = getLineRange(view, line.number);
  return {
    kind,
    range,
    lineNumber: line.number,
    selectedText,
    blockText: getRangeText(view, range),
  };
}

function replaceSelection(
  view: EditorView,
  build: (selectedText: string, rangeFrom: number) => { insert: string; anchor: number; head?: number },
): boolean {
  const changes = view.state.changeByRange((range) => {
    const selectedText = view.state.sliceDoc(range.from, range.to);
    const result = build(selectedText, range.from);
    return {
      changes: { from: range.from, to: range.to, insert: result.insert },
      range: result.head === undefined
        ? EditorSelection.cursor(result.anchor)
        : EditorSelection.range(result.anchor, result.head),
    };
  });
  view.dispatch(changes);
  return true;
}

function wrapSelection(view: EditorView, before: string, after: string, placeholder = ""): boolean {
  return replaceSelection(view, (selectedText, from) => {
    const content = selectedText || placeholder;
    const insert = `${before}${content}${after}`;
    const start = from + before.length;
    const end = start + content.length;
    return {
      insert,
      anchor: selectedText ? end : start,
      head: selectedText ? undefined : end,
    };
  });
}

function replaceCurrentLines(view: EditorView, transform: (text: string) => string): boolean {
  const selection = view.state.selection.main;
  const startLine = view.state.doc.lineAt(selection.from);
  const endLine = view.state.doc.lineAt(selection.to);
  const from = startLine.from;
  const to = endLine.to;
  const text = view.state.sliceDoc(from, to);
  const insert = transform(text);
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.cursor(from + insert.length),
  });
  return true;
}

function insertBlock(view: EditorView, markdown: string): boolean {
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.head);
  const needsPrefix = line.text.trim().length > 0 ? "\n\n" : "";
  const needsSuffix = markdown.endsWith("\n") ? "" : "\n";
  const insert = `${needsPrefix}${markdown}${needsSuffix}`;
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: EditorSelection.cursor(selection.from + insert.length),
  });
  return true;
}

function buildTable(rows = 3, columns = 3): string {
  const colCount = clamp(Math.floor(columns), 2, 8);
  const rowCount = clamp(Math.floor(rows), 2, 12);
  const headers = Array.from({ length: colCount }, (_, index) => `Column ${index + 1}`);
  const separator = Array.from({ length: colCount }, () => "---");
  const bodyRows = Array.from({ length: rowCount - 1 }, () =>
    Array.from({ length: colCount }, () => ""),
  );
  return [
    `| ${headers.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...bodyRows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function buildCallout(selectedText: string, payload?: MarkdownCommandPayload): string {
  const type = payload?.calloutType?.trim() || "note";
  const title = payload?.calloutTitle?.trim();
  const body = selectedText.trim() || "Write note here.";
  const lines = body.split(/\r?\n/).map((line) => `> ${line}`);
  return [`> [!${type}]${title ? ` ${title}` : ""}`, ...lines].join("\n");
}

function stripBlockquotePrefix(line: string): string {
  return line.replace(/^\s*>\s?/, "");
}

function buildFootnote(view: EditorView): string {
  const content = view.state.doc.toString();
  let index = 1;
  while (content.includes(`[^${index}]`)) {
    index += 1;
  }
  return `[^${index}]\n\n[^${index}]: Footnote text`;
}

function normalizePropertyKey(key: string | undefined): string {
  const normalized = (key || "status").trim().replace(/\s+/g, "-");
  return normalized || "status";
}

function normalizePropertyValue(value: string | undefined): string {
  const normalized = (value ?? "").trim();
  if (!normalized) return '""';
  if (/^(true|false|null|[-+]?\d+(?:\.\d+)?)$/i.test(normalized)) return normalized;
  if (/^\[.*\]$/.test(normalized)) return normalized;
  if (/^".*"$/.test(normalized) || /^'.*'$/.test(normalized)) return normalized;
  return JSON.stringify(normalized);
}

function normalizeWikiTarget(value: string | undefined, fallback = "Untitled"): string {
  const normalized = (value ?? "").trim().replace(/^\[\[|\]\]$/g, "");
  return normalized || fallback;
}

function buildWikiLinkMarkdown(target: string, alias?: string): string {
  const normalizedTarget = normalizeWikiTarget(target);
  const normalizedAlias = alias?.trim();
  return `[[${normalizedTarget}${normalizedAlias && normalizedAlias !== normalizedTarget ? `|${normalizedAlias}` : ""}]]`;
}

function buildWikiAnchorTarget(payload: MarkdownCommandPayload, kind: "heading" | "block"): string {
  const baseTarget = payload.target?.trim() ?? "";
  if (kind === "heading") {
    const heading = payload.heading?.trim() || payload.text?.trim() || "Heading";
    return `${baseTarget}#${heading}`;
  }
  const blockId = (payload.blockId?.trim() || payload.text?.trim() || "block-id").replace(/^(\^|#\^)/, "");
  return `${baseTarget}#^${blockId}`;
}

function findMarkdownLinkAtCursor(view: EditorView): { from: number; to: number; source: string } | null {
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.head);
  const selectionFrom = selection.from - line.from;
  const selectionTo = selection.to - line.from;
  const cursorOffset = selection.head - line.from;
  const pattern = /(!?)\[([^\]]*?)\]\(([^)]+?)\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line.text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const cursorInside = cursorOffset >= start && cursorOffset <= end;
    const selectionMatches = !selection.empty && selectionFrom >= start && selectionTo <= end;
    if (!cursorInside && !selectionMatches) continue;
    return {
      from: line.from + start,
      to: line.from + end,
      source: match[0],
    };
  }

  return null;
}

function convertMarkdownLinkAtCursorToWiki(view: EditorView): boolean {
  const link = findMarkdownLinkAtCursor(view);
  if (!link) return false;

  const replacement = buildMarkdownLinkToWikiReplacement(link.source);
  if (!replacement) return false;

  view.dispatch({
    changes: { from: link.from, to: link.to, insert: replacement.replacement },
    selection: EditorSelection.cursor(link.from + replacement.replacement.length),
  });
  return true;
}

interface ImageSourceMatch {
  from: number;
  to: number;
  source: string;
  syntax: "markdown" | "wiki";
  alt: string;
  url: string;
  width?: number;
}

export function buildMarkdownImageSource(input: {
  syntax: "markdown" | "wiki";
  alt?: string;
  url: string;
  width?: number;
}): string {
  const width = input.width && Number.isFinite(input.width) && input.width > 0
    ? Math.round(input.width)
    : undefined;
  if (input.syntax === "wiki") {
    const meta = width ? String(width) : input.alt?.trim();
    return `![[${[input.url.trim(), meta].filter(Boolean).join("|")}]]`;
  }

  const alt = input.alt?.trim() ?? "";
  return `![${alt}${width ? `|${width}` : ""}](${input.url.trim()})`;
}

function parseWikiImageTarget(rawTarget: string): { url: string; alt: string; width?: number } {
  const [targetPart = "", ...metaParts] = rawTarget.split("|");
  const meta = metaParts.join("|").trim();
  const width = /^\d+$/.test(meta) ? Number(meta) : undefined;
  return {
    url: targetPart.trim(),
    alt: width ? "" : meta,
    width,
  };
}

function findImageAtCursor(view: EditorView): ImageSourceMatch | null {
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.head);
  const selectionFrom = selection.from - line.from;
  const selectionTo = selection.to - line.from;
  const cursorOffset = selection.head - line.from;
  const patterns: Array<{ syntax: "markdown" | "wiki"; pattern: RegExp }> = [
    { syntax: "markdown", pattern: /!\[([^\]]*?)(?:\|(\d+))?\]\(([^)]+?)\)/g },
    { syntax: "wiki", pattern: /!\[\[([^\]]+?)\]\]/g },
  ];

  for (const { syntax, pattern } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line.text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const cursorInside = cursorOffset >= start && cursorOffset <= end;
      const selectionMatches = !selection.empty && selectionFrom >= start && selectionTo <= end;
      if (!cursorInside && !selectionMatches) continue;

      if (syntax === "wiki") {
        const parsed = parseWikiImageTarget(match[1]);
        return {
          from: line.from + start,
          to: line.from + end,
          source: match[0],
          syntax,
          alt: parsed.alt,
          url: parsed.url,
          width: parsed.width,
        };
      }

      return {
        from: line.from + start,
        to: line.from + end,
        source: match[0],
        syntax,
        alt: match[1] ?? "",
        url: match[3] ?? "",
        width: match[2] ? Number(match[2]) : undefined,
      };
    }
  }

  return null;
}

function updateImageAtCursor(
  view: EditorView,
  update: (image: ImageSourceMatch) => ImageSourceMatch | null,
  revealSource = false,
): boolean {
  const image = findImageAtCursor(view);
  if (!image) return false;

  const next = update(image);
  if (!next) return false;
  const insert = buildMarkdownImageSource(next);
  view.dispatch({
    changes: { from: image.from, to: image.to, insert },
    selection: revealSource
      ? EditorSelection.range(image.from, image.from + insert.length)
      : EditorSelection.cursor(image.from + insert.length),
  });
  return true;
}

function insertPropertiesBlock(view: EditorView, payload: MarkdownCommandPayload): boolean {
  const existing = findFrontmatterRange(view);
  const key = normalizePropertyKey(payload.propertyKey);
  const value = normalizePropertyValue(payload.propertyValue || payload.text || "draft");

  if (existing) {
    return setProperty(view, payload);
  }

  const insert = `---\n${key}: ${value}\n---\n\n`;
  view.dispatch({
    changes: { from: 0, insert },
    selection: EditorSelection.cursor(insert.length),
  });
  return true;
}

function buildUpdatedFrontmatterSource(source: string, key: string, value: string): string {
  const lines = source.split(/\r?\n/);
  const propertyPattern = new RegExp(`^(${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:)`);
  const propertyIndex = lines.findIndex((line, index) => index > 0 && index < lines.length - 1 && propertyPattern.test(line));
  if (propertyIndex >= 0) {
    lines[propertyIndex] = `${key}: ${value}`;
  } else {
    lines.splice(Math.max(1, lines.length - 1), 0, `${key}: ${value}`);
  }
  return lines.join("\n");
}

function setProperty(view: EditorView, payload: MarkdownCommandPayload): boolean {
  const key = normalizePropertyKey(payload.propertyKey);
  const value = normalizePropertyValue(payload.propertyValue ?? payload.text);
  const existing = findFrontmatterRange(view);

  if (!existing) {
    return insertPropertiesBlock(view, { ...payload, propertyKey: key, propertyValue: value });
  }

  const source = view.state.sliceDoc(existing.from, existing.to);
  const insert = buildUpdatedFrontmatterSource(source, key, value);
  view.dispatch({
    changes: { from: existing.from, to: existing.to, insert },
    selection: EditorSelection.cursor(existing.from + insert.length),
  });
  return true;
}

function parsePropertyCandidate(text: string): { key: string; value: string } | null {
  const normalized = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "")
    .trim();

  if (!normalized) return null;

  const colonMatch = normalized.match(/^([^:]{1,80}):\s*(.*)$/);
  if (colonMatch) {
    return {
      key: normalizePropertyKey(colonMatch[1]),
      value: colonMatch[2]?.trim() || "true",
    };
  }

  const [first, ...rest] = normalized.split(/\s+/);
  if (!first) return null;
  return {
    key: normalizePropertyKey(first),
    value: rest.join(" ").trim() || "true",
  };
}

function rangesOverlap(firstFrom: number, firstTo: number, secondFrom: number, secondTo: number): boolean {
  return firstFrom < secondTo && secondFrom < firstTo;
}

function convertLineToProperty(view: EditorView): boolean {
  const selection = view.state.selection.main;
  const hasSelection = !selection.empty && view.state.sliceDoc(selection.from, selection.to).trim().length > 0;
  const line = view.state.doc.lineAt(selection.head);
  const sourceFrom = hasSelection ? selection.from : line.from;
  const sourceTo = hasSelection ? selection.to : line.to;
  const candidateText = view.state.sliceDoc(sourceFrom, sourceTo);
  const parsed = parsePropertyCandidate(candidateText);
  if (!parsed) return false;

  const key = parsed.key;
  const value = normalizePropertyValue(parsed.value);
  const existing = findFrontmatterRange(view);

  if (existing && rangesOverlap(sourceFrom, sourceTo, existing.from, existing.to)) {
    return setProperty(view, { propertyKey: key, propertyValue: parsed.value });
  }

  let deleteFrom = sourceFrom;
  let deleteTo = sourceTo;
  if (!hasSelection) {
    if (deleteTo < view.state.doc.length) {
      deleteTo += 1;
    } else if (deleteFrom > 0 && view.state.sliceDoc(deleteFrom - 1, deleteFrom) === "\n") {
      deleteFrom -= 1;
    }
  }

  if (existing) {
    const source = view.state.sliceDoc(existing.from, existing.to);
    const insert = buildUpdatedFrontmatterSource(source, key, value);
    view.dispatch({
      changes: [
        { from: existing.from, to: existing.to, insert },
        { from: deleteFrom, to: deleteTo, insert: "" },
      ],
      selection: EditorSelection.cursor(existing.from + insert.length),
    });
    return true;
  }

  const insert = `---\n${key}: ${value}\n---\n\n`;
  view.dispatch({
    changes: deleteFrom === 0
      ? { from: 0, to: deleteTo, insert }
      : [
        { from: 0, insert },
        { from: deleteFrom, to: deleteTo, insert: "" },
      ],
    selection: EditorSelection.cursor(insert.length),
  });
  return true;
}

function setHeading(view: EditorView, level: number): boolean {
  const headingLevel = clamp(Math.floor(level), 1, 6);
  return replaceCurrentLines(view, (text) =>
    text
      .split(/\r?\n/)
      .map((line) => {
        const body = line.replace(/^\s*#{1,6}\s+/, "").trim() || "Heading";
        return `${"#".repeat(headingLevel)} ${body}`;
      })
      .join("\n"),
  );
}

function updateCallout(view: EditorView, payload: MarkdownCommandPayload): boolean {
  const context = getMarkdownEditorContext(view);
  if (context.kind !== "callout") {
    return runMarkdownEditingCommand(view, "insert.callout", payload);
  }

  const range = context.range;
  const source = view.state.sliceDoc(range.from, range.to);
  const lines = source.split(/\r?\n/);
  const type = payload.calloutType?.trim() || context.calloutType || "note";
  const title = payload.calloutTitle?.trim() ?? context.calloutTitle ?? "";
  const foldMarker = context.calloutFoldMarker ?? "";
  lines[0] = `> [!${type}${foldMarker}]${title ? ` ${title}` : ""}`;
  const insert = lines.join("\n");
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.cursor(range.from + lines[0].length),
  });
  return true;
}

function getCalloutBodyMarkdown(source: string): string {
  return source
    .split(/\r?\n/)
    .slice(1)
    .map((line) => stripBlockquotePrefix(line))
    .join("\n")
    .trim();
}

function selectionToCalloutBody(view: EditorView, payload: MarkdownCommandPayload): boolean {
  return replaceSelection(view, (selectedText, from) => {
    const insert = buildCallout(selectedText, payload);
    return { insert, anchor: from + insert.length };
  });
}

function buildPlainQuoteFromCallout(source: string, fallback: string): string {
  const bodyLines = source
    .split(/\r?\n/)
    .slice(1)
    .map((line) => stripBlockquotePrefix(line));

  const contentLines = bodyLines.length > 0 && bodyLines.some((line) => line.trim())
    ? bodyLines
    : [fallback];

  return contentLines
    .map((line) => (line.trim() ? `> ${line}` : ">"))
    .join("\n");
}

function extractCalloutBody(view: EditorView): boolean {
  const context = getMarkdownEditorContext(view);
  if (context.kind !== "callout") return false;

  const fallback = context.calloutTitle || context.calloutType || "Callout";
  const insert = buildPlainQuoteFromCallout(context.blockText, fallback);
  view.dispatch({
    changes: { from: context.range.from, to: context.range.to, insert },
    selection: EditorSelection.cursor(context.range.from + insert.length),
  });
  return true;
}

function splitCalloutAtBodyLine(view: EditorView): boolean {
  const context = getMarkdownEditorContext(view);
  if (context.kind !== "callout") return false;

  const bodyLineOffset = context.lineNumber - context.range.startLine;
  if (bodyLineOffset <= 1) return false;

  const lines = context.blockText.split(/\r?\n/);
  if (bodyLineOffset >= lines.length) return false;

  const header = lines[0];
  const before = lines.slice(1, bodyLineOffset);
  const after = lines.slice(bodyLineOffset);
  if (before.length === 0 || after.length === 0) return false;

  const firstBlock = [header, ...before].join("\n");
  const secondBlock = [header, ...after].join("\n");
  const insert = `${firstBlock}\n\n${secondBlock}`;
  view.dispatch({
    changes: { from: context.range.from, to: context.range.to, insert },
    selection: EditorSelection.cursor(context.range.from + firstBlock.length + 2),
  });
  return true;
}

function copyCalloutBody(view: EditorView): boolean {
  const context = getMarkdownEditorContext(view);
  if (context.kind !== "callout") return false;
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard?.writeText) return false;
  void clipboard.writeText(getCalloutBodyMarkdown(context.blockText));
  return true;
}

function duplicateCallout(view: EditorView): boolean {
  const context = getMarkdownEditorContext(view);
  if (context.kind !== "callout") return false;
  const insert = `\n\n${context.blockText}`;
  view.dispatch({
    changes: { from: context.range.to, insert },
    selection: EditorSelection.cursor(context.range.to + insert.length),
  });
  return true;
}

export function runMarkdownEditingCommand(
  view: EditorView,
  commandId: MarkdownEditingCommandId,
  payload: MarkdownCommandPayload = {},
): boolean {
  switch (commandId) {
    case "format.bold":
      return wrapSelection(view, "**", "**", "bold");
    case "format.italic":
      return wrapSelection(view, "*", "*", "italic");
    case "format.code":
      return wrapSelection(view, "`", "`", "code");
    case "format.strike":
      return wrapSelection(view, "~~", "~~", "text");
    case "format.quote":
      return replaceCurrentLines(view, (text) =>
        text
          .split(/\r?\n/)
          .map((line) => (line.trim().startsWith(">") ? line.replace(/^\s*>\s?/, "") : `> ${line}`))
          .join("\n"),
      );
    case "format.link": {
      const url = payload.url?.trim() || "https://";
      return replaceSelection(view, (selectedText, from) => {
        const label = selectedText || "link text";
        const insert = `[${label}](${url})`;
        const urlStart = from + label.length + 3;
        return {
          insert,
          anchor: payload.url ? from + insert.length : urlStart,
          head: payload.url ? undefined : urlStart + url.length,
        };
      });
    }
    case "insert.heading":
      return setHeading(view, payload.headingLevel ?? 2);
    case "insert.properties":
      return insertPropertiesBlock(view, payload);
    case "insert.table":
      return insertBlock(view, buildTable(payload.rows, payload.columns));
    case "insert.callout":
      return replaceSelection(view, (selectedText, from) => {
        const insert = buildCallout(selectedText, payload);
        return { insert, anchor: from + insert.length };
      });
    case "insert.taskList":
      return insertBlock(view, "- [ ] Task\n- [ ] Follow up");
    case "insert.footnote":
      return replaceSelection(view, (_selectedText, from) => {
        const insert = buildFootnote(view);
        return { insert, anchor: from + insert.length };
      });
    case "insert.codeBlock": {
      const language = payload.language?.trim() ?? "";
      return replaceSelection(view, (selectedText, from) => {
        const content = selectedText || "";
        const insert = `\`\`\`${language}\n${content}\n\`\`\``;
        return {
          insert,
          anchor: selectedText ? from + insert.length : from + 4 + language.length,
        };
      });
    }
    case "insert.mathBlock":
      return replaceSelection(view, (selectedText, from) => {
        const content = selectedText || "";
        const insert = `$$\n${content}\n$$`;
        return {
          insert,
          anchor: selectedText ? from + insert.length : from + 3,
        };
      });
    case "insert.image": {
      const alt = payload.alt?.trim() || "image";
      const url = payload.url?.trim() || "path/to/image.png";
      return replaceSelection(view, (_selectedText, from) => {
        const insert = `![${alt}](${url})`;
        const urlStart = from + alt.length + 4;
        return {
          insert,
          anchor: payload.url ? from + insert.length : urlStart,
          head: payload.url ? undefined : urlStart + url.length,
        };
      });
    }
    case "insert.wikiLink": {
      const target = normalizeWikiTarget(payload.target || payload.text);
      const alias = payload.alias?.trim();
      return replaceSelection(view, (selectedText, from) => {
        const label = alias || selectedText.trim();
        const insert = buildWikiLinkMarkdown(target, label);
        return { insert, anchor: from + insert.length };
      });
    }
    case "insert.wikiAlias": {
      const target = normalizeWikiTarget(payload.target || payload.text);
      return replaceSelection(view, (selectedText, from) => {
        const alias = payload.alias?.trim() || selectedText.trim() || target;
        const insert = buildWikiLinkMarkdown(target, alias);
        return { insert, anchor: from + insert.length };
      });
    }
    case "insert.headingAnchorLink": {
      const target = buildWikiAnchorTarget(payload, "heading");
      const alias = payload.alias?.trim();
      return replaceSelection(view, (selectedText, from) => {
        const insert = buildWikiLinkMarkdown(target, alias || selectedText.trim());
        return { insert, anchor: from + insert.length };
      });
    }
    case "insert.blockAnchorLink": {
      const target = buildWikiAnchorTarget(payload, "block");
      const alias = payload.alias?.trim();
      return replaceSelection(view, (selectedText, from) => {
        const insert = buildWikiLinkMarkdown(target, alias || selectedText.trim());
        return { insert, anchor: from + insert.length };
      });
    }
    case "insert.embed": {
      const target = payload.target?.trim() || payload.url?.trim() || payload.text?.trim() || "Attachment";
      return replaceSelection(view, (_selectedText, from) => {
        const insert = `![[${target}]]`;
        return { insert, anchor: from + insert.length };
      });
    }
    case "insert.emoji":
      return replaceSelection(view, (_selectedText, from) => {
        const text = payload.text || "\u{1F642}";
        return { insert: text, anchor: from + text.length };
      });
    case "insert.gif": {
      const alt = payload.alt?.trim() || "gif";
      const url = payload.url?.trim() || "https://example.com/animation.gif";
      return replaceSelection(view, (_selectedText, from) => {
        const insert = `![${alt}](${url})`;
        const urlStart = from + alt.length + 4;
        return {
          insert,
          anchor: payload.url ? from + insert.length : urlStart,
          head: payload.url ? undefined : urlStart + url.length,
        };
      });
    }
    case "insert.text":
      return replaceSelection(view, (_selectedText, from) => {
        const text = payload.text ?? "";
        return { insert: text, anchor: from + text.length };
      });
    case "link.convertMarkdownToWiki":
      return convertMarkdownLinkAtCursorToWiki(view);
    case "image.setWidth":
      return updateImageAtCursor(view, (image) => ({
        ...image,
        width: payload.width ?? Number(payload.text),
      }));
    case "image.clearWidth":
      return updateImageAtCursor(view, (image) => ({
        ...image,
        width: undefined,
      }));
    case "image.replacePath":
      return updateImageAtCursor(view, (image) => ({
        ...image,
        url: payload.url?.trim() || payload.target?.trim() || image.url,
      }));
    case "image.setAlt":
      return updateImageAtCursor(view, (image) => ({
        ...image,
        alt: payload.alt ?? payload.text ?? image.alt,
      }));
    case "image.openSource":
      return updateImageAtCursor(view, (image) => image, true);
    case "properties.set":
      return setProperty(view, payload);
    case "properties.convertLine":
      return convertLineToProperty(view);
    case "callout.update":
      return updateCallout(view, payload);
    case "callout.selectionToBody":
      return selectionToCalloutBody(view, payload);
    case "callout.extractBody":
      return extractCalloutBody(view);
    case "callout.splitAtBodyLine":
      return splitCalloutAtBodyLine(view);
    case "callout.copyBody":
      return copyCalloutBody(view);
    case "callout.duplicate":
      return duplicateCallout(view);
    case "selection.delete":
      return replaceSelection(view, () => ({ insert: "", anchor: view.state.selection.main.from }));
    case "selection.selectAll":
      view.dispatch({
        selection: EditorSelection.range(0, view.state.doc.length),
      });
      return true;
    default:
      return false;
  }
}

export function getCurrentMarkdownBlock(view: EditorView): string {
  const context = getMarkdownEditorContext(view);
  return context.blockText;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderTableMarkdownToHtml(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/).filter((line) => isTableLine(line));
  if (lines.length < 2 || !isTableSeparatorLine(lines[1])) return null;

  const parseCells = (line: string) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => escapeHtml(cell.trim()));

  const header = parseCells(lines[0]);
  const body = lines.slice(2).map(parseCells);
  return [
    "<table>",
    "<thead><tr>",
    ...header.map((cell) => `<th>${cell}</th>`),
    "</tr></thead>",
    "<tbody>",
    ...body.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`),
    "</tbody>",
    "</table>",
  ].join("");
}

export function markdownBlockToHtml(markdown: string): string {
  const tableHtml = renderTableMarkdownToHtml(markdown);
  if (tableHtml) return tableHtml;

  const codeMatch = markdown.match(/^```([^\n]*)\n([\s\S]*?)\n```$/);
  if (codeMatch) {
    const language = escapeHtml(codeMatch[1].trim());
    return `<pre><code class="language-${language}">${escapeHtml(codeMatch[2])}</code></pre>`;
  }

  const heading = markdown.match(/^(#{1,6})\s+(.+)$/);
  if (heading) {
    const level = heading[1].length;
    return `<h${level}>${escapeHtml(heading[2])}</h${level}>`;
  }

  if (/^\s*>\s?/m.test(markdown)) {
    const text = markdown
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*>\s?/, ""))
      .join("\n");
    return `<blockquote>${escapeHtml(text)}</blockquote>`;
  }

  return `<p>${escapeHtml(markdown)}</p>`;
}
