/**
 * Mention Resolver
 * Parses @mentions from chat messages and resolves them to workspace content.
 */

import { normalizeSource } from '@/lib/notebook-utils';
import { getFileExtension, isBinaryFile } from '@/lib/file-utils';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { DirectoryNode, TreeNode } from '@/types/file-system';
import type { LayoutNode } from '@/types/layout';
import type { EvidenceRef } from './types';

export interface Mention {
  type: 'file' | 'selection';
  raw: string;
  target: string;
  path?: string;
  fragment?: string;
  resolved?: string;
  evidenceRef?: EvidenceRef;
}

interface WorkspaceFileEntry {
  path: string;
  name: string;
}

export interface MentionSuggestion {
  type:
    | 'selection'
    | 'file'
    | 'heading'
    | 'code_line'
    | 'notebook_cell'
    | 'pdf_page'
    | 'pdf_annotation';
  label: string;
  value: string;
  description?: string;
}

function collectAllTabs(node: LayoutNode): Array<{ filePath: string }> {
  if (node.type === 'pane') return node.tabs;
  return node.children.flatMap((child) => collectAllTabs(child));
}

function collectTreeFiles(node: TreeNode): WorkspaceFileEntry[] {
  if (node.kind === 'file') {
    return [{
      path: node.path,
      name: node.name,
    }];
  }

  return node.children.flatMap((child) => collectTreeFiles(child));
}

function dedupeFiles(files: WorkspaceFileEntry[]): WorkspaceFileEntry[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    if (seen.has(file.path)) {
      return false;
    }
    seen.add(file.path);
    return true;
  });
}

function splitMentionTarget(target: string): { path: string; fragment?: string } {
  const [rawPath, rawFragment] = target.split('#', 2);
  return {
    path: decodeURI(rawPath),
    fragment: rawFragment ? decodeURIComponent(rawFragment) : undefined,
  };
}

function buildMentionValue(path: string, fragment?: string): string {
  if (!fragment) {
    return `@${encodeURI(path)}`;
  }
  return `@${encodeURI(path)}#${encodeURIComponent(fragment)}`;
}

function normalizeHeadingToken(value: string): string {
  return decodeURIComponent(value)
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

function extractMarkdownHeadingSection(content: string, fragment: string): string | null {
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const matches = [...content.matchAll(headingRegex)];
  if (matches.length === 0) {
    return null;
  }

  const targetToken = normalizeHeadingToken(fragment);
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const level = match[1].length;
    const title = match[2].trim();

    if (normalizeHeadingToken(title) !== targetToken) {
      continue;
    }

    const start = match.index ?? 0;
    let end = content.length;
    for (let nextIndex = index + 1; nextIndex < matches.length; nextIndex += 1) {
      const next = matches[nextIndex];
      if (next[1].length <= level) {
        end = next.index ?? content.length;
        break;
      }
    }

    return content.slice(start, end).trim();
  }

  return null;
}

function extractLineContext(content: string, lineNumber: number): string | null {
  const lines = content.split(/\r?\n/);
  if (lineNumber < 1 || lineNumber > lines.length) {
    return null;
  }

  const start = Math.max(0, lineNumber - 3);
  const end = Math.min(lines.length, lineNumber + 2);
  return lines
    .slice(start, end)
    .map((line, index) => {
      const currentLine = start + index + 1;
      return `${currentLine.toString().padStart(4, ' ')} | ${line}`;
    })
    .join('\n');
}

function extractNotebookCellContext(content: string, fragmentValue: string): { preview: string; locator: string } | null {
  try {
    const parsed = JSON.parse(content) as {
      cells?: Array<{ id?: string; cell_type?: string; source?: string | string[] }>;
    };
    const cells = parsed.cells ?? [];
    if (cells.length === 0) {
      return null;
    }

    const numericIndex = Number(fragmentValue);
    if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= cells.length) {
      const cell = cells[numericIndex - 1];
      return {
        locator: `cell=${numericIndex}`,
        preview: `Cell ${numericIndex} (${cell.cell_type ?? 'code'})\n${normalizeSource(cell.source ?? '')}`.trim(),
      };
    }

    const matchedIndex = cells.findIndex((cell) => cell.id === fragmentValue);
    if (matchedIndex >= 0) {
      const cell = cells[matchedIndex];
      return {
        locator: `cell=${fragmentValue}`,
        preview: `Cell ${matchedIndex + 1} (${cell.cell_type ?? 'code'})\n${normalizeSource(cell.source ?? '')}`.trim(),
      };
    }
  } catch {
    return null;
  }

  return null;
}

function collectMarkdownHeadingSuggestions(path: string, content: string): MentionSuggestion[] {
  return [...content.matchAll(/^#{1,6}\s+(.+)$/gm)]
    .slice(0, 20)
    .map((match) => {
      const heading = match[1].trim();
      return {
        type: 'heading' as const,
        label: heading,
        value: buildMentionValue(path, heading),
        description: `Heading · ${path}`,
      };
    });
}

function collectNotebookCellSuggestions(path: string, content: string): MentionSuggestion[] {
  try {
    const parsed = JSON.parse(content) as {
      cells?: Array<{ cell_type?: string; source?: string | string[] }>;
    };
    const cells = parsed.cells ?? [];
    return cells.slice(0, 20).map((cell, index) => {
      const preview = normalizeSource(cell.source ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
      return {
        type: 'notebook_cell' as const,
        label: `Cell ${index + 1}`,
        value: buildMentionValue(path, `cell=${index + 1}`),
        description: `${cell.cell_type ?? 'code'} · ${preview || 'Empty cell'}`,
      };
    });
  } catch {
    return [];
  }
}

function collectCodeLineSuggestions(path: string, content: string): MentionSuggestion[] {
  return content
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .slice(0, 20)
    .map(({ line, lineNumber }) => ({
      type: 'code_line' as const,
      label: `Line ${lineNumber}`,
      value: buildMentionValue(path, `line=${lineNumber}`),
      description: line.trim().slice(0, 100),
    }));
}

function collectPdfSuggestions(
  path: string,
  options?: {
    pdfPageCandidates?: number[];
    pdfAnnotationCandidates?: string[];
  },
): MentionSuggestion[] {
  const pageCandidates = options?.pdfPageCandidates?.length
    ? [...new Set(options.pdfPageCandidates)].sort((left, right) => left - right)
    : [1];

  const pageSuggestions = pageCandidates.slice(0, 10).map((page) => ({
    type: 'pdf_page' as const,
    label: `Page ${page}`,
    value: buildMentionValue(path, `page=${page}`),
    description: `PDF page · ${path}`,
  }));

  const annotationSuggestions = (options?.pdfAnnotationCandidates ?? [])
    .slice(0, 10)
    .map((annotationId) => ({
      type: 'pdf_annotation' as const,
      label: annotationId,
      value: buildMentionValue(path, annotationId),
      description: `PDF annotation · ${path}`,
    }));

  return [...pageSuggestions, ...annotationSuggestions];
}

function filterSuggestionsByQuery(
  suggestions: MentionSuggestion[],
  fragmentQuery?: string,
): MentionSuggestion[] {
  const normalizedQuery = fragmentQuery?.trim().toLowerCase();
  if (!normalizedQuery) {
    return suggestions;
  }

  return suggestions.filter((suggestion) =>
    suggestion.label.toLowerCase().includes(normalizedQuery) ||
    suggestion.description?.toLowerCase().includes(normalizedQuery)
  );
}

function buildBinaryReference(path: string, fragment?: string): { content: string; evidenceRef: EvidenceRef } {
  const ext = getFileExtension(path).toLowerCase();

  if (ext === 'pdf' && fragment?.startsWith('page=')) {
    const page = Number(fragment.slice('page='.length));
    return {
      content: `PDF reference: ${path}, page ${page}.`,
      evidenceRef: {
        kind: 'pdf_page',
        label: `${path} page ${page}`,
        locator: `${path}#page=${page}`,
        preview: `Referenced PDF page ${page}.`,
      },
    };
  }

  if (ext === 'pdf' && (fragment?.startsWith('ann-') || fragment?.startsWith('ann=') || fragment?.startsWith('annotation='))) {
    const annotationId = fragment.startsWith('ann-')
      ? fragment
      : `ann-${fragment.split('=').pop() ?? ''}`;
    return {
      content: `PDF annotation reference: ${path}, ${annotationId}.`,
      evidenceRef: {
        kind: 'pdf_annotation',
        label: `${path} ${annotationId}`,
        locator: `${path}#${annotationId}`,
        preview: `Referenced PDF annotation ${annotationId}.`,
      },
    };
  }

  return {
    content: `Binary file reference: ${fragment ? `${path}#${fragment}` : path}.`,
    evidenceRef: {
      kind: 'file',
      label: path,
      locator: fragment ? `${path}#${fragment}` : path,
      preview: `Referenced binary file ${path}.`,
    },
  };
}

function buildTextReference(path: string, content: string, fragment?: string): { content: string; evidenceRef: EvidenceRef } {
  if (!fragment) {
    return {
      content,
      evidenceRef: {
        kind: 'file',
        label: path,
        locator: path,
        preview: content.replace(/\s+/g, ' ').trim().slice(0, 180),
      },
    };
  }

  if (fragment.startsWith('line=')) {
    const lineNumber = Number(fragment.slice('line='.length));
    const preview = extractLineContext(content, lineNumber);
    if (preview) {
      return {
        content: preview,
        evidenceRef: {
          kind: 'code_line',
          label: `${path} line ${lineNumber}`,
          locator: `${path}#line=${lineNumber}`,
          preview: preview.replace(/\s+/g, ' ').trim().slice(0, 180),
        },
      };
    }
  }

  if (fragment.startsWith('cell=')) {
    const cellRef = fragment.slice('cell='.length);
    const preview = extractNotebookCellContext(content, cellRef);
    if (preview) {
      return {
        content: preview.preview,
        evidenceRef: {
          kind: 'notebook_cell',
          label: `${path} ${preview.locator}`,
          locator: `${path}#${preview.locator}`,
          preview: preview.preview.replace(/\s+/g, ' ').trim().slice(0, 180),
        },
      };
    }
  }

  const section = extractMarkdownHeadingSection(content, fragment);
  if (section) {
    const normalizedFragment = decodeURIComponent(fragment).replace(/^#+/, '').trim();
    return {
      content: section,
      evidenceRef: {
        kind: 'heading',
        label: `${path}#${normalizedFragment}`,
        locator: `${path}#${normalizedFragment}`,
        preview: section.replace(/\s+/g, ' ').trim().slice(0, 180),
      },
    };
  }

  return {
    content,
    evidenceRef: {
      kind: 'file',
      label: path,
      locator: `${path}#${fragment}`,
      preview: content.replace(/\s+/g, ' ').trim().slice(0, 180),
    },
  };
}

export function resolveWorkspaceFilePath(targetPath: string): string {
  const state = useWorkspaceStore.getState();
  const files = getAvailableFiles();

  const exactMatch = files.find((file) => file.path === targetPath);
  if (exactMatch) {
    return exactMatch.path;
  }

  const decodedTarget = decodeURI(targetPath);
  const exactDecodedMatch = files.find((file) => file.path === decodedTarget);
  if (exactDecodedMatch) {
    return exactDecodedMatch.path;
  }

  const suffixMatches = files.filter((file) => file.path.endsWith(decodedTarget));
  if (suffixMatches.length === 1) {
    return suffixMatches[0].path;
  }

  const tabs = collectAllTabs(state.layout.root);
  const tabMatch = tabs.find((tab) => tab.filePath === decodedTarget || tab.filePath.endsWith(decodedTarget));
  return tabMatch?.filePath ?? decodedTarget;
}

export async function getMentionFragmentSuggestions(
  filePath: string,
  options?: {
    readFile?: (path: string) => Promise<string>;
    fragmentQuery?: string;
    pdfPageCandidates?: number[];
    pdfAnnotationCandidates?: string[];
  },
): Promise<MentionSuggestion[]> {
  const extension = getFileExtension(filePath).toLowerCase();

  if (extension === 'pdf') {
    return filterSuggestionsByQuery(
      collectPdfSuggestions(filePath, options),
      options?.fragmentQuery,
    );
  }

  if (isBinaryFile(extension)) {
    return [];
  }

  if (!options?.readFile) {
    return [];
  }

  try {
    const content = await options.readFile(filePath);
    let suggestions: MentionSuggestion[] = [];

    if (extension === 'md' || extension === 'mdx') {
      suggestions = collectMarkdownHeadingSuggestions(filePath, content);
    } else if (extension === 'ipynb') {
      suggestions = collectNotebookCellSuggestions(filePath, content);
    } else {
      suggestions = collectCodeLineSuggestions(filePath, content);
    }

    return filterSuggestionsByQuery(suggestions, options?.fragmentQuery);
  } catch {
    return [];
  }
}

function formatMentionContext(mention: Mention): string {
  if (mention.type === 'selection') {
    return `## Current Selection\n${mention.resolved ?? '[No text selected]'}`;
  }

  const header = mention.fragment
    ? `## Reference: ${mention.path}#${mention.fragment}`
    : `## File: ${mention.path ?? mention.target}`;
  return `${header}\n${mention.resolved ?? ''}`;
}

export function parseMentions(text: string): Mention[] {
  const mentions: Mention[] = [];
  const regex = /@(selection|[^\s@]+\.\w+(?:#[^\s@]+)?)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const target = match[1];
    if (target === 'selection') {
      mentions.push({
        type: 'selection',
        raw: match[0],
        target,
      });
      continue;
    }

    const split = splitMentionTarget(target);
    mentions.push({
      type: 'file',
      raw: match[0],
      target,
      path: split.path,
      fragment: split.fragment,
    });
  }

  return mentions;
}

export async function resolveMentions(
  mentions: Mention[],
  options?: {
    currentSelection?: string;
    readFile?: (path: string) => Promise<string>;
  }
): Promise<Mention[]> {
  const resolved: Mention[] = [];

  for (const mention of mentions) {
    if (mention.type === 'selection') {
      resolved.push({
        ...mention,
        resolved: options?.currentSelection?.trim() || '[No text selected]',
      });
      continue;
    }

    const resolvedPath = resolveWorkspaceFilePath(mention.path ?? mention.target);
    const extension = getFileExtension(resolvedPath).toLowerCase();

    if (isBinaryFile(extension) || extension === 'pdf') {
      const binaryReference = buildBinaryReference(resolvedPath, mention.fragment);
      resolved.push({
        ...mention,
        path: resolvedPath,
        resolved: binaryReference.content,
        evidenceRef: binaryReference.evidenceRef,
      });
      continue;
    }

    try {
      let content: string;
      if (options?.readFile) {
        content = await options.readFile(resolvedPath);
      } else {
        content = `[File: ${resolvedPath}]`;
      }

      const reference = buildTextReference(resolvedPath, content, mention.fragment);
      resolved.push({
        ...mention,
        path: resolvedPath,
        resolved: reference.content,
        evidenceRef: reference.evidenceRef,
      });
    } catch {
      resolved.push({
        ...mention,
        path: resolvedPath,
        resolved: `[Error reading: ${resolvedPath}]`,
      });
    }
  }

  return resolved;
}

export async function buildMentionContext(text: string): Promise<string> {
  const mentions = parseMentions(text);
  if (mentions.length === 0) return '';
  const resolved = await resolveMentions(mentions);
  return resolved
    .filter((mention) => mention.resolved)
    .map((mention) => formatMentionContext(mention))
    .join('\n\n');
}

export function stripMentions(text: string): string {
  return text.replace(/@(selection|[^\s@]+\.\w+(?:#[^\s@]+)?)/g, '').trim();
}

export function getAvailableFiles(): WorkspaceFileEntry[] {
  try {
    const state = useWorkspaceStore.getState();
    const treeFiles = state.fileTree.root ? collectTreeFiles(state.fileTree.root as DirectoryNode) : [];
    const fallbackFiles = collectAllTabs(state.layout.root).map((tab) => ({
      path: tab.filePath,
      name: tab.filePath.split('/').pop() ?? tab.filePath,
    }));

    return dedupeFiles(treeFiles.length > 0 ? treeFiles : fallbackFiles)
      .sort((left, right) => left.path.localeCompare(right.path));
  } catch {
    return [];
  }
}
