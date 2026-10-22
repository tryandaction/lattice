import { getPdfPageSearchText } from "@/lib/pdf-page-text-cache";
import { loadPdfJsDocument } from "@/lib/pdf-js-document-loader";
import { extractSearchableTextForFile, isSearchableTextExtension } from '@/lib/searchable-text';

export type AgentDocumentKind = "pdf" | "markdown" | "text" | "notebook";
export type AgentDocumentUnitLabel = "page" | "section" | "lines" | "cell";

export interface AgentDocumentUnitResult {
  text: string;
  /** Local-only validation corpus; never automatically included in a model prompt. */
  validationText?: string;
  status: "text" | "empty" | "unreadable";
  reason?: string;
  /** A navigation target for exactly this unit, never a preview citation. */
  locator?: string;
}

export interface AgentDocumentSource {
  readonly path: string;
  readonly kind: AgentDocumentKind;
  /** Stable for the lifetime of the source and changes when the supplied file changes. */
  readonly version: string;
  readonly totalUnits: number;
  readonly unitLabel: AgentDocumentUnitLabel;
  readonly cloudIdentity?: import('./types').EvidenceRef['cloudIdentity'];
  readonly providerScope?: string;
  readUnit(unit: number, signal?: AbortSignal): Promise<AgentDocumentUnitResult>;
  close(): Promise<void>;
}

interface MarkdownRange {
  start: number;
  end: number;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The document read was aborted.", "AbortError");
  }
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/");
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fallbackDigest(bytes: Uint8Array): string {
  // A deterministic fallback keeps the source usable in restricted WebViews
  // where SubtleCrypto is unavailable. It is a version guard, not a security
  // boundary; the path and file metadata remain part of the version string.
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function digest(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      return bytesToHex(await subtle.digest("SHA-256", bytes));
    } catch {
      // Continue with the deterministic fallback below.
    }
  }
  return fallbackDigest(new Uint8Array(bytes));
}

async function buildVersion(path: string, file: File, bytes: ArrayBuffer): Promise<string> {
  const hash = await digest(bytes);
  // Desktop wrappers recreate File objects with a fresh timestamp. Content identity,
  // rather than wrapper creation time, determines whether a checkpoint is reusable.
  return `${path}|${file.size}|${hash}`;
}

export async function getAgentDocumentVersion(file: File, identity: string, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const version = await buildVersion(identity, file, await file.arrayBuffer());
  throwIfAborted(signal);
  return version;
}

export function isAgentDocumentPath(path: string): boolean {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? '';
  return /^(?:pdf|mdx|markdown|txt)$/i.test(extension) || isSearchableTextExtension(extension);
}

/** Workspace instructions are readable on explicit request, never implicit research material. */
export function isWorkspaceInstructionPath(path: string): boolean {
  return /^(?:agents|claude|gemini|copilot-instructions)\.md$/iu.test(path.replace(/\\/g, '/').split('/').at(-1) ?? '');
}

function lineRanges(text: string): Array<{ start: number; end: number; blank: boolean; heading: boolean }> {
  const lines: Array<{ start: number; end: number; blank: boolean; heading: boolean }> = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline < 0 ? text.length : newline + 1;
    const line = text.slice(start, newline < 0 ? text.length : newline).replace(/\r$/, "");
    lines.push({
      start,
      end,
      blank: /^\s*$/.test(line),
      heading: /^\s{0,3}#{1,6}\s+\S/.test(line),
    });
    start = end;
  }
  if (text.length === 0) {
    lines.push({ start: 0, end: 0, blank: true, heading: false });
  }
  return lines;
}

function buildMarkdownRanges(text: string): MarkdownRange[] {
  if (text.length === 0) {
    return [{ start: 0, end: 0 }];
  }

  const lines = lineRanges(text);
  const starts = new Set<number>([0]);
  let previousBlank = false;
  for (const line of lines) {
    // A heading starts a new semantic section. A non-heading line starts a
    // new paragraph only after a blank separator. Keeping separators in the
    // preceding unit makes concatenating all units lossless.
    if (line.heading && line.start > 0) {
      starts.add(line.start);
    } else if (!line.blank && previousBlank && line.start > 0) {
      starts.add(line.start);
    }
    previousBlank = line.blank;
  }

  const ordered = [...starts].sort((left, right) => left - right);
  return ordered.map((start, index) => ({
    start,
    end: ordered[index + 1] ?? text.length,
  }));
}

function unreadable(reason: string): AgentDocumentUnitResult {
  return { text: "", status: "unreadable", reason };
}

function emptyOrText(text: string): AgentDocumentUnitResult {
  return text.length > 0 ? { text, status: "text" } : { text: "", status: "empty" };
}

class MarkdownDocumentSource implements AgentDocumentSource {
  readonly kind = "markdown" as const;
  readonly unitLabel = "section" as const;
  readonly totalUnits: number;

  private closed = false;

  constructor(
    readonly path: string,
    readonly version: string,
    private readonly content: string,
    private readonly ranges: MarkdownRange[],
  ) {
    this.totalUnits = ranges.length;
  }

  async readUnit(unit: number, signal?: AbortSignal): Promise<AgentDocumentUnitResult> {
    if (this.closed) return unreadable("source_closed");
    if (signal?.aborted) return unreadable("aborted");
    const range = this.ranges[unit - 1];
    if (!range || !Number.isInteger(unit) || unit < 1) return unreadable("unit_out_of_range");
    if (signal?.aborted) return unreadable("aborted");
    return { ...emptyOrText(this.content.slice(range.start, range.end)), validationText: this.content,
      locator: `${this.path}#line=${this.content.slice(0, range.start).split('\n').length}` };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class TextDocumentSource implements AgentDocumentSource {
  readonly totalUnits: number;
  private closed = false;
  constructor(readonly path: string, readonly version: string, readonly kind: 'text' | 'notebook',
    readonly unitLabel: 'lines' | 'cell', private readonly units: Array<{ text: string; locator: string }>) {
    this.totalUnits = units.length;
  }
  async readUnit(unit: number, signal?: AbortSignal): Promise<AgentDocumentUnitResult> {
    if (this.closed) return unreadable('source_closed');
    if (signal?.aborted) return unreadable('aborted');
    const value = Number.isInteger(unit) && unit >= 1 ? this.units[unit - 1] : undefined;
    return value ? { ...emptyOrText(value.text), locator: value.locator } : unreadable('unit_out_of_range');
  }
  async close(): Promise<void> { this.closed = true; }
}

function textUnits(content: string, path: string): Array<{ text: string; locator: string }> {
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [''];
  const units: Array<{ text: string; locator: string }> = [];
  for (let line = 0; line < lines.length; line += 100) {
    units.push({ text: lines.slice(line, line + 100).join(''), locator: `${path}#line=${line + 1}` });
  }
  return units;
}

class PdfDocumentSource implements AgentDocumentSource {
  readonly kind = "pdf" as const;
  readonly unitLabel = "page" as const;
  readonly totalUnits: number;
  private closed = false;
  private closePromise: Promise<void> | null = null;
  private readonly pageCache = new Map<number, string>();
  private static readonly MAX_CACHED_PAGES = 24;

  constructor(
    readonly path: string,
    readonly version: string,
    private readonly pdfDocument: { numPages: number; destroy?: () => Promise<void> | void },
  ) {
    this.totalUnits = pdfDocument.numPages;
  }

  async readUnit(unit: number, signal?: AbortSignal): Promise<AgentDocumentUnitResult> {
    if (this.closed) return unreadable("source_closed");
    if (signal?.aborted) return unreadable("aborted");
    if (!Number.isInteger(unit) || unit < 1 || unit > this.totalUnits) return unreadable("unit_out_of_range");

    try {
      let text = this.pageCache.get(unit);
      if (text === undefined) {
        throwIfAborted(signal);
        text = await getPdfPageSearchText(this.pdfDocument as never, unit);
        if (this.closed) return unreadable("source_closed");
        throwIfAborted(signal);
        this.pageCache.set(unit, text);
        while (this.pageCache.size > PdfDocumentSource.MAX_CACHED_PAGES) {
          const oldest = this.pageCache.keys().next().value as number | undefined;
          if (oldest === undefined) break;
          this.pageCache.delete(oldest);
        }
      }
      if (signal?.aborted) return unreadable("aborted");
      return { ...emptyOrText(text), locator: `${this.path}#page=${unit}` };
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        return unreadable("aborted");
      }
      return unreadable(error instanceof Error ? error.message : "page_read_failed");
    }
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.pageCache.clear();
    this.closePromise = Promise.resolve(this.pdfDocument.destroy?.()).then(() => undefined);
    return this.closePromise;
  }
}

export async function openAgentDocumentSource(
  file: File,
  path: string,
  signal?: AbortSignal,
): Promise<AgentDocumentSource> {
  if (!(file instanceof File)) {
    throw new TypeError("Agent document source requires an authorized File.");
  }
  const normalizedPath = normalizePath(path);
  if (!normalizedPath || normalizedPath.split('/').some(part => part === '..' || part === '.') || /[\u0000-\u001f]/.test(normalizedPath)) {
    throw new Error("Agent document source requires a workspace-relative path.");
  }
  throwIfAborted(signal);

  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(normalizedPath);
  const isMarkdown = /\.(?:md|mdx|markdown)$/i.test(normalizedPath) || file.type === "text/markdown";
  if (!isPdf && !isMarkdown && !isAgentDocumentPath(normalizedPath)) {
    throw new Error(`Unsupported agent document type: ${normalizedPath}`);
  }

  if (isPdf) {
    let bytes: ArrayBuffer | null = await file.arrayBuffer();
    throwIfAborted(signal);
    const version = await buildVersion(normalizedPath, file, bytes);
    throwIfAborted(signal);
    const pdfDocument = await loadPdfJsDocument({
      data: bytes,
      label: `agent-document:${normalizedPath}`,
    });
    bytes = null;
    try {
      throwIfAborted(signal);
      return new PdfDocumentSource(normalizedPath, version, pdfDocument);
    } catch (error) {
      await Promise.resolve(pdfDocument.destroy?.());
      throw error;
    }
  }

  const extension = normalizedPath.split('.').at(-1)?.toLowerCase() ?? '';
  // Markdown aliases/plain text share the text extraction branch with Markdown.
  const content = await extractSearchableTextForFile({ file, extension: /^(?:mdx|markdown|txt)$/.test(extension) ? 'md' : extension });
  throwIfAborted(signal);
  const version = await getAgentDocumentVersion(file, normalizedPath, signal);
  throwIfAborted(signal);
  if (isMarkdown) return new MarkdownDocumentSource(normalizedPath, version, content, buildMarkdownRanges(content));
  if (extension === 'ipynb') {
    const notebook = JSON.parse(await file.text()) as { cells?: Array<{ id?: string; source?: string | string[] }> };
    if (!Array.isArray(notebook.cells)) throw new Error('Notebook has no valid cells array.');
    const units = notebook.cells.map((cell, index) => ({ text: Array.isArray(cell.source) ? cell.source.join('') : cell.source ?? '',
      locator: `${normalizedPath}#cell=${encodeURIComponent(cell.id || String(index + 1))}` }));
    // Shared extraction is the validation corpus; units preserve per-cell navigation.
    if (units.map(unit => unit.text).join('\n') !== content) throw new Error('Notebook text extraction mismatch.');
    return new TextDocumentSource(normalizedPath, version, 'notebook', 'cell', units.length ? units : [{ text: '', locator: `${normalizedPath}#cell=1` }]);
  }
  return new TextDocumentSource(normalizedPath, version, 'text', 'lines', textUnits(content, normalizedPath));
}
