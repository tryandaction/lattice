import { toMathLivePlaceholders, type FormulaInsertPayload } from "@/lib/unified-input-handler";
import {
  formatFormulaForClipboard,
  normalizeFormulaInput,
  wrapLatexForMarkdown,
  type FormulaSource,
} from "@/lib/formula-utils";
import type { FormulaTemplate, FormulaTemplateId } from "@/lib/formula-templates";

export type FormulaRecordSource = FormulaSource | "template";
export type FormulaClipboardFormat = "latex" | "markdown" | "inline-markdown" | "display-markdown";

export interface FormulaComposerPayload extends FormulaInsertPayload {
  markdown: string;
  previewLatex: string;
  source: FormulaRecordSource;
  templateId?: FormulaTemplateId;
}

export interface FormulaRecord {
  id: string;
  label: string;
  latex: string;
  markdown: string;
  mathLiveLatex: string;
  previewLatex: string;
  displayMode: boolean;
  source: FormulaRecordSource;
  templateId?: FormulaTemplateId;
  favorite?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface BuildFormulaRecordOptions {
  label?: string;
  displayMode?: boolean;
  source?: FormulaRecordSource;
  templateId?: FormulaTemplateId;
  now?: number;
}

function slugFormula(latex: string): string {
  const slug = latex
    .toLowerCase()
    .replace(/\\[a-z]+/gi, (command) => command.slice(1))
    .replace(/[\^_]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "formula";
}

function buildLabel(latex: string, label?: string): string {
  const trimmed = label?.trim();
  return trimmed || latex.trim() || "Formula";
}

export function buildFormulaInsertPayload(template: FormulaTemplate): FormulaComposerPayload {
  const displayMode = Boolean(template.displayMode);
  return {
    latex: template.latex,
    mathLiveLatex: template.mathLiveLatex,
    markdown: wrapLatexForMarkdown(template.latex, displayMode),
    displayMode,
    previewLatex: template.previewLatex,
    source: "template",
    templateId: template.id,
  };
}

export function buildFormulaRecord(rawFormula: string, options: BuildFormulaRecordOptions = {}): FormulaRecord {
  const normalized = normalizeFormulaInput(rawFormula, { preferDisplay: options.displayMode });
  const displayMode = options.displayMode ?? normalized.displayMode;
  const latex = normalized.latex;
  const now = options.now ?? Date.now();
  return {
    id: `formula:${slugFormula(latex)}`,
    label: buildLabel(latex, options.label),
    latex,
    markdown: wrapLatexForMarkdown(latex, displayMode),
    mathLiveLatex: toMathLivePlaceholders(latex),
    previewLatex: toMathLivePlaceholders(latex).replace(/\\placeholder\{\}/g, "\\square"),
    displayMode,
    source: options.source ?? normalized.source,
    templateId: options.templateId,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildFormulaClipboardText(
  record: Pick<FormulaRecord, "latex" | "displayMode">,
  format: FormulaClipboardFormat,
): string {
  if (format === "inline-markdown") {
    return wrapLatexForMarkdown(record.latex, false);
  }
  if (format === "display-markdown") {
    return wrapLatexForMarkdown(record.latex, true);
  }
  return formatFormulaForClipboard(record.latex, format, record.displayMode);
}

export function updateRecentFormulaRecords(
  records: FormulaRecord[],
  nextRecord: FormulaRecord,
  limit = 12,
): FormulaRecord[] {
  const existing = records.find((record) => record.id === nextRecord.id);
  const merged: FormulaRecord = existing
    ? {
        ...existing,
        ...nextRecord,
        createdAt: existing.createdAt,
        updatedAt: Math.max(existing.updatedAt, nextRecord.updatedAt),
      }
    : nextRecord;

  return [
    merged,
    ...records.filter((record) => record.id !== nextRecord.id),
  ].slice(0, Math.max(1, limit));
}

export function toggleFavoriteFormulaRecord(record: FormulaRecord, now = Date.now()): FormulaRecord {
  return {
    ...record,
    favorite: !record.favorite,
    updatedAt: now,
  };
}

export function renameFormulaRecord(record: FormulaRecord, nextLabel: string, now = Date.now()): FormulaRecord {
  return {
    ...record,
    label: buildLabel(record.latex, nextLabel),
    updatedAt: now,
  };
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function formulaSearchHaystack(record: FormulaRecord): string {
  return [
    record.label,
    record.latex,
    record.markdown,
    record.mathLiveLatex,
    record.source,
    record.templateId,
    record.favorite ? "favorite starred" : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function searchFormulaRecords(records: FormulaRecord[], query: string): FormulaRecord[] {
  const normalizedQuery = normalizeSearchText(query);
  const filtered = normalizedQuery
    ? records.filter((record) => formulaSearchHaystack(record).includes(normalizedQuery))
    : records;

  return [...filtered].sort((a, b) => {
    if (Boolean(a.favorite) !== Boolean(b.favorite)) {
      return a.favorite ? -1 : 1;
    }
    return b.updatedAt - a.updatedAt;
  });
}
