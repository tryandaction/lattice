import { normalizePdfReadableText } from "@/lib/pdf-readable-text";
import type { CanonicalPdfTextMarkupType } from "@/lib/pdf-annotation-sidecar-canonical";
import type { UnderlineStyleType } from "@/types/universal-annotation";

export const PDF_ANNOTATION_DRAFTS_BEGIN = "<!-- lattice-pdf-annotation-drafts:begin -->";
export const PDF_ANNOTATION_DRAFTS_END = "<!-- lattice-pdf-annotation-drafts:end -->";

export interface PdfAnnotationMarkdownDraft {
  id: string;
  page: number;
  exact: string;
  styleType: CanonicalPdfTextMarkupType;
  color: string;
  comment?: string;
  tags: string[];
  underlineStyle?: UnderlineStyleType;
  author?: string;
}

const DEFAULT_DRAFT_COLOR = "#FFD400";
const DEFAULT_DRAFT_AUTHOR = "lattice-ai";
const DEFAULT_AI_DRAFT_TAGS = ["AI", "AI批注", "pdf-text-markup"] as const;

function parseDraftAttributes(line: string): Record<string, string> | null {
  const match = line.match(/^<!--\s*lattice-pdf-annotation\s+([\s\S]*?)\s*-->\s*$/);
  if (!match) {
    return null;
  }

  const attrs: Record<string, string> = {};
  const attrPattern = /([a-zA-Z][\w-]*)="([^"]*)"/g;
  let attrMatch: RegExpExecArray | null;
  while ((attrMatch = attrPattern.exec(match[1])) !== null) {
    attrs[attrMatch[1]] = attrMatch[2];
  }
  return attrs;
}

function parseDraftField(line: string): { key: string; value: string } | null {
  const match = line.match(/^-\s*([A-Za-z][\w -]*):\s*([\s\S]*)$/);
  if (!match) {
    return null;
  }
  return {
    key: match[1].trim().toLowerCase().replace(/\s+/g, "-"),
    value: match[2].trim(),
  };
}

function normalizeStyleType(value: string | undefined): CanonicalPdfTextMarkupType {
  return value === "underline" ? "underline" : "highlight";
}

function normalizeUnderlineStyle(value: string | undefined): UnderlineStyleType | undefined {
  return value === "wavy" || value === "double" || value === "dashed" || value === "solid"
    ? value
    : undefined;
}

function normalizeDraftId(value: string | undefined, page: number, exact: string): string {
  const explicit = value?.trim();
  if (explicit) {
    return explicit.startsWith("ann-") ? explicit : `ann-${explicit}`;
  }

  const slug = normalizePdfReadableText(exact)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "pdf-quote";
  return `ann-md-${page}-${slug}`;
}

function normalizeDraftTags(value: string | undefined): string[] {
  const explicitTags = (value ?? "")
    .split(/[,\uff0c;]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_AI_DRAFT_TAGS, ...explicitTags]));
}

export function parsePdfAnnotationMarkdownDrafts(markdown: string): PdfAnnotationMarkdownDraft[] {
  const lines = markdown.split(/\r?\n/);
  const drafts: PdfAnnotationMarkdownDraft[] = [];
  let currentAttrs: Record<string, string> | null = null;
  let currentFields: Record<string, string> = {};
  let insideInstructionComment = false;

  const flush = () => {
    if (!currentAttrs) {
      return;
    }

    const page = Number.parseInt(currentAttrs.page ?? currentFields.page ?? "", 10);
    const exact = normalizePdfReadableText(currentFields.quote ?? currentFields.exact ?? currentAttrs.exact);
    if (!Number.isInteger(page) || page < 1 || !exact) {
      currentAttrs = null;
      currentFields = {};
      return;
    }

    drafts.push({
      id: normalizeDraftId(currentAttrs.id, page, exact),
      page,
      exact,
      styleType: normalizeStyleType(currentAttrs.type ?? currentFields.type),
      color: currentAttrs.color || currentFields.color || DEFAULT_DRAFT_COLOR,
      comment: currentFields.comment || currentFields.note || undefined,
      tags: normalizeDraftTags(currentFields.tags ?? currentAttrs.tags),
      underlineStyle: normalizeUnderlineStyle(currentAttrs.underlineStyle ?? currentFields.underlineStyle),
      author: currentAttrs.author || DEFAULT_DRAFT_AUTHOR,
    });
    currentAttrs = null;
    currentFields = {};
  };

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!currentAttrs && trimmedLine === "<!--") {
      insideInstructionComment = true;
      continue;
    }
    if (insideInstructionComment) {
      if (trimmedLine === "-->") {
        insideInstructionComment = false;
      }
      continue;
    }

    const attrs = parseDraftAttributes(line);
    if (attrs) {
      flush();
      currentAttrs = attrs;
      currentFields = {};
      continue;
    }

    if (!currentAttrs) {
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    const field = parseDraftField(line);
    if (field) {
      currentFields[field.key] = field.value;
    }
  }
  flush();

  const seen = new Set<string>();
  return drafts.filter((draft) => {
    if (seen.has(draft.id)) {
      return false;
    }
    seen.add(draft.id);
    return true;
  });
}

export function removeResolvedPdfAnnotationMarkdownDrafts(
  markdown: string,
  resolvedIds: Iterable<string>,
): string {
  const resolved = new Set(Array.from(resolvedIds).map((id) => id.trim()).filter(Boolean));
  if (resolved.size === 0) {
    return markdown;
  }

  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let insideDraftSection = false;
  let insideInstructionComment = false;
  let currentAttrs: Record<string, string> | null = null;
  let currentFields: Record<string, string> = {};
  let currentBlock: string[] = [];

  const flushBlock = () => {
    if (!currentAttrs) {
      return;
    }

    const page = Number.parseInt(currentAttrs.page ?? currentFields.page ?? "", 10);
    const exact = normalizePdfReadableText(currentFields.quote ?? currentFields.exact ?? currentAttrs.exact);
    const id = Number.isInteger(page) && page >= 1 && exact
      ? normalizeDraftId(currentAttrs.id, page, exact)
      : currentAttrs.id;
    if (!id || !resolved.has(id)) {
      output.push(...currentBlock);
    }
    currentAttrs = null;
    currentFields = {};
    currentBlock = [];
  };

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine === PDF_ANNOTATION_DRAFTS_BEGIN) {
      flushBlock();
      insideDraftSection = true;
      output.push(line);
      continue;
    }
    if (trimmedLine === PDF_ANNOTATION_DRAFTS_END) {
      flushBlock();
      insideDraftSection = false;
      insideInstructionComment = false;
      output.push(line);
      continue;
    }

    if (!insideDraftSection) {
      output.push(line);
      continue;
    }

    if (!currentAttrs && trimmedLine === "<!--") {
      insideInstructionComment = true;
      output.push(line);
      continue;
    }
    if (insideInstructionComment) {
      output.push(line);
      if (trimmedLine === "-->") {
        insideInstructionComment = false;
      }
      continue;
    }

    const attrs = parseDraftAttributes(line);
    if (attrs) {
      flushBlock();
      currentAttrs = attrs;
      currentFields = {};
      currentBlock = [line];
      continue;
    }

    if (currentAttrs) {
      currentBlock.push(line);
      const field = parseDraftField(line);
      if (field) {
        currentFields[field.key] = field.value;
      }
      if (!trimmedLine) {
        flushBlock();
      }
      continue;
    }

    output.push(line);
  }

  flushBlock();
  return markdown.endsWith("\n") ? `${output.join("\n")}\n` : output.join("\n");
}

export function extractPdfAnnotationDraftsSection(markdown: string | null | undefined): string | null {
  const content = markdown ?? "";
  const begin = content.indexOf(PDF_ANNOTATION_DRAFTS_BEGIN);
  const end = content.indexOf(PDF_ANNOTATION_DRAFTS_END);
  if (begin < 0 || end < 0 || end <= begin) {
    return null;
  }
  return content.slice(begin, end + PDF_ANNOTATION_DRAFTS_END.length).trim();
}

export function buildEmptyPdfAnnotationDraftsSection(): string {
  return [
    PDF_ANNOTATION_DRAFTS_BEGIN,
    "",
    "<!--",
    "Lattice AI and users can append exact-quote PDF text markup drafts here.",
    'Example:',
    '<!-- lattice-pdf-annotation id="ann-ai-example" page="7" type="highlight" color="#FFD400" -->',
    '- Quote: exact PDF text to highlight',
    '- Comment: optional note',
    '- Tags: AI, AI批注, key-claim',
    "",
    "When the PDF opens, Lattice resolves each Quote through the PDF text model and writes precise sidecar rects/quads.",
    "Do not write PDF coordinates here; exact Quote text is the only trusted anchor.",
    "-->",
    "",
    PDF_ANNOTATION_DRAFTS_END,
  ].join("\n");
}

export function mergePdfAnnotationDraftsSection(markdown: string, previousMarkdown?: string | null): string {
  const existing = extractPdfAnnotationDraftsSection(previousMarkdown);
  const section = existing ?? buildEmptyPdfAnnotationDraftsSection();
  return `${markdown.trimEnd()}\n\n${section}\n`;
}
