import type { PaneId } from '@/types/layout';
import type {
  EvidenceAnchor,
  EvidenceAnchorRect,
  EvidenceRef,
  SelectionAiMode,
  SelectionSourceKind,
} from './types';

export type { SelectionAiMode, SelectionSourceKind } from './types';

export interface SelectionContext {
  sourceKind: SelectionSourceKind;
  paneId: PaneId;
  fileName: string;
  filePath?: string;
  selectedText: string;
  contextText?: string;
  contextSummary?: string;
  sourceLabel: string;
  anchor?: EvidenceAnchor;
  evidenceRefs: EvidenceRef[];
}

interface SelectionRangeInput {
  start: number;
  end: number;
  lineStart?: number;
  lineEnd?: number;
}

interface CreateSelectionContextInput {
  sourceKind: SelectionSourceKind;
  paneId: PaneId;
  fileName: string;
  filePath?: string;
  selectedText: string;
  documentText?: string;
  contextText?: string;
  contextSummary?: string;
  anchor?: EvidenceAnchor;
  selectionRange?: SelectionRangeInput;
  notebookCellId?: string;
  notebookCellIndex?: number;
  pdfPage?: number;
  pdfRects?: EvidenceAnchorRect[];
  blockLabel?: string;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function summarizeSelectionPreview(text: string, maxLength = 96): string {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildFallbackOffsets(content: string, selectedText: string): { start: number; end: number } | null {
  const index = content.indexOf(selectedText);
  if (index < 0) {
    return null;
  }
  return {
    start: index,
    end: index + selectedText.length,
  };
}

function buildLineRangeFromOffsets(content: string, start: number, end: number): { lineStart: number; lineEnd: number } {
  const safeStart = Math.max(0, Math.min(start, content.length));
  const safeEnd = Math.max(safeStart, Math.min(end, content.length));
  const lineStart = content.slice(0, safeStart).split(/\r?\n/).length;
  const lineEnd = content.slice(0, safeEnd).split(/\r?\n/).length;
  return { lineStart, lineEnd };
}

function buildContextSliceByOffsets(content: string, start: number, end: number, radius = 220): string | undefined {
  const safeStart = Math.max(0, start - radius);
  const safeEnd = Math.min(content.length, end + radius);
  const slice = content.slice(safeStart, safeEnd).trim();
  return slice || undefined;
}

function buildContextSliceByLines(content: string, lineStart: number, lineEnd: number, radius = 3): string | undefined {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) {
    return undefined;
  }

  const safeStart = Math.max(1, lineStart);
  const safeEnd = Math.max(safeStart, lineEnd);
  const fromIndex = Math.max(0, safeStart - 1 - radius);
  const toIndex = Math.min(lines.length, safeEnd + radius);
  const slice = lines.slice(fromIndex, toIndex).join('\n').trim();
  return slice || undefined;
}

function joinRangeLabel(prefix: string, start: number, end: number): string {
  if (start === end) {
    return `${prefix}${start}`;
  }
  return `${prefix}${start}-${end}`;
}

function buildAnchor(input: CreateSelectionContextInput, selectedText: string): EvidenceAnchor | undefined {
  const anchor: EvidenceAnchor = {
    ...(input.anchor ?? {}),
  };

  if (input.selectionRange) {
    anchor.offsets = { start: input.selectionRange.start, end: input.selectionRange.end };
    if (input.selectionRange.lineStart !== undefined) {
      anchor.lineStart = input.selectionRange.lineStart;
    }
    if (input.selectionRange.lineEnd !== undefined) {
      anchor.lineEnd = input.selectionRange.lineEnd;
    }
  }

  if (input.notebookCellId) {
    anchor.cellId = input.notebookCellId;
  }

  if (typeof input.notebookCellIndex === 'number') {
    anchor.cellIndex = input.notebookCellIndex;
  }

  if (input.pdfPage !== undefined) {
    anchor.page = input.pdfPage;
  }

  if (input.pdfRects?.length) {
    anchor.rects = input.pdfRects;
  }

  if (input.blockLabel) {
    anchor.blockLabel = input.blockLabel;
  }

  if (!anchor.snippet) {
    anchor.snippet = summarizeSelectionPreview(selectedText, 180);
  }

  return Object.keys(anchor).length > 0 ? anchor : undefined;
}

function completeAnchor(
  sourceKind: SelectionSourceKind,
  documentText: string | undefined,
  selectedText: string,
  anchor: EvidenceAnchor | undefined,
): EvidenceAnchor | undefined {
  if (!anchor && !documentText) {
    return undefined;
  }

  const next = {
    ...(anchor ?? {}),
  } satisfies EvidenceAnchor;

  if (documentText) {
    const offsets = next.offsets ?? buildFallbackOffsets(documentText, selectedText) ?? undefined;
    if (offsets) {
      next.offsets = offsets;
      if (sourceKind === 'code' && (next.lineStart === undefined || next.lineEnd === undefined)) {
        const lines = buildLineRangeFromOffsets(documentText, offsets.start, offsets.end);
        next.lineStart = next.lineStart ?? lines.lineStart;
        next.lineEnd = next.lineEnd ?? lines.lineEnd;
      }
    }
  }

  if (!next.snippet) {
    next.snippet = summarizeSelectionPreview(selectedText, 180);
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function buildContextText(
  sourceKind: SelectionSourceKind,
  documentText: string | undefined,
  explicitContext: string | undefined,
  anchor: EvidenceAnchor | undefined,
): string | undefined {
  if (explicitContext?.trim()) {
    return explicitContext.trim();
  }

  if (!documentText) {
    return undefined;
  }

  if (sourceKind === 'code' && anchor?.lineStart !== undefined && anchor.lineEnd !== undefined) {
    return buildContextSliceByLines(documentText, anchor.lineStart, anchor.lineEnd, 3);
  }

  if (anchor?.offsets) {
    return buildContextSliceByOffsets(documentText, anchor.offsets.start, anchor.offsets.end, 220);
  }

  return undefined;
}

function buildSourceLabel(
  input: CreateSelectionContextInput,
  anchor: EvidenceAnchor | undefined,
): string {
  switch (input.sourceKind) {
    case 'code':
      if (anchor?.lineStart !== undefined && anchor.lineEnd !== undefined) {
        return `${input.fileName} · 第 ${joinRangeLabel('', anchor.lineStart, anchor.lineEnd)} 行`;
      }
      return `${input.fileName} · 代码选区`;
    case 'notebook': {
      const parts = [input.fileName];
      if (typeof anchor?.cellIndex === 'number') {
        parts.push(`Cell ${anchor.cellIndex + 1}`);
      }
      if (anchor?.cellId) {
        parts.push(anchor.cellId);
      }
      return parts.join(' · ');
    }
    case 'pdf':
      if (anchor?.page !== undefined) {
        return `${input.fileName} · 第 ${anchor.page} 页`;
      }
      return `${input.fileName} · PDF 选区`;
    case 'html':
    case 'word':
      return anchor?.blockLabel ? `${input.fileName} · ${anchor.blockLabel}` : `${input.fileName} · 选区`;
    default:
      return input.filePath ? `${input.fileName} · 选区` : input.fileName;
  }
}

function buildContextSummary(
  input: CreateSelectionContextInput,
  anchor: EvidenceAnchor | undefined,
  explicitSummary: string | undefined,
): string | undefined {
  if (explicitSummary?.trim()) {
    return explicitSummary.trim();
  }

  switch (input.sourceKind) {
    case 'code':
      if (anchor?.lineStart !== undefined && anchor.lineEnd !== undefined) {
        return `代码选区 · 第 ${joinRangeLabel('', anchor.lineStart, anchor.lineEnd)} 行 · 上下文前后各 3 行`;
      }
      return '代码选区 · 自动截取附近上下文';
    case 'notebook': {
      const parts = ['Notebook 选区'];
      if (typeof anchor?.cellIndex === 'number') {
        parts.push(`Cell ${anchor.cellIndex + 1}`);
      }
      if (anchor?.cellId) {
        parts.push(anchor.cellId);
      }
      return parts.join(' · ');
    }
    case 'pdf':
      return anchor?.page !== undefined
        ? `PDF 选区 · 第 ${anchor.page} 页${anchor.rects?.length ? ' · 已捕获区域锚点' : ''}`
        : 'PDF 选区';
    case 'html':
      return anchor?.blockLabel ? `HTML 块级选区 · ${anchor.blockLabel}` : 'HTML 块级选区';
    case 'word':
      return anchor?.blockLabel ? `Word 块级选区 · ${anchor.blockLabel}` : 'Word 块级选区';
    default:
      return '选区上下文';
  }
}

function buildEvidenceRef(
  input: CreateSelectionContextInput,
  selectedText: string,
  anchor: EvidenceAnchor | undefined,
): EvidenceRef {
  const baseLocator = input.filePath || input.fileName;
  const preview = summarizeSelectionPreview(selectedText, 180);

  switch (input.sourceKind) {
    case 'code': {
      const lineStart = anchor?.lineStart;
      const lineEnd = anchor?.lineEnd;
      const locator = lineStart !== undefined && lineEnd !== undefined
        ? `${baseLocator}#line=${lineStart}${lineEnd !== lineStart ? `-${lineEnd}` : ''}`
        : baseLocator;
      return {
        kind: 'code_line',
        label: lineStart !== undefined && lineEnd !== undefined
          ? `${baseLocator} line ${lineStart}${lineEnd !== lineStart ? `-${lineEnd}` : ''}`
          : `${baseLocator} code selection`,
        locator,
        preview,
        anchor,
      };
    }
    case 'notebook': {
      const cellLabel = anchor?.cellId
        ? anchor.cellId
        : typeof anchor?.cellIndex === 'number'
          ? `index-${anchor.cellIndex}`
          : 'selection';
      return {
        kind: 'notebook_cell',
        label: `${baseLocator} cell ${cellLabel}`,
        locator: `${baseLocator}#cell=${cellLabel}`,
        preview,
        anchor,
      };
    }
    case 'pdf':
      return {
        kind: 'pdf_page',
        label: anchor?.page !== undefined ? `${baseLocator} page ${anchor.page}` : `${baseLocator} pdf selection`,
        locator: anchor?.page !== undefined ? `${baseLocator}#page=${anchor.page}` : baseLocator,
        preview,
        anchor,
      };
    case 'html':
    case 'word':
    case 'markdown':
      return {
        kind: 'file',
        label: anchor?.blockLabel ? `${baseLocator} · ${anchor.blockLabel}` : baseLocator,
        locator: baseLocator,
        preview,
        anchor,
      };
    default:
      return {
        kind: 'file',
        label: baseLocator,
        locator: baseLocator,
        preview,
        anchor,
      };
  }
}

export function createSelectionContext(input: CreateSelectionContextInput): SelectionContext {
  const selectedText = input.selectedText.trim();
  const anchor = completeAnchor(input.sourceKind, input.documentText, selectedText, buildAnchor(input, selectedText));
  const contextText = buildContextText(input.sourceKind, input.documentText, input.contextText, anchor);
  const contextSummary = buildContextSummary(input, anchor, input.contextSummary);
  const sourceLabel = buildSourceLabel(input, anchor);

  return {
    sourceKind: input.sourceKind,
    paneId: input.paneId,
    fileName: input.fileName,
    filePath: input.filePath,
    selectedText,
    contextText,
    contextSummary,
    sourceLabel,
    anchor,
    evidenceRefs: [buildEvidenceRef(input, selectedText, anchor)],
  };
}

export function defaultPromptForSelectionMode(mode: SelectionAiMode, context: SelectionContext): string {
  switch (mode) {
    case 'agent':
      return `请像研究助理一样深入分析这段来自“${context.sourceLabel}”的内容，输出 Conclusion / Evidence / Next Actions。`;
    case 'plan':
      return `请基于这段来自“${context.sourceLabel}”的内容生成可执行整理计划，明确目标草稿与写入建议。`;
    default:
      return `请围绕这段来自“${context.sourceLabel}”的内容快速回答，并指出最关键的证据。`;
  }
}
