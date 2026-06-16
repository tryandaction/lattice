import { estimateTokens } from './token-estimator';
import type { FileIndex, WorkspaceIndex } from './workspace-indexer';

export interface WorkspaceSummaryCacheEntry {
  workspaceKey: string;
  indexVersion: number;
  generatedAt: number;
  summary: string;
  fileCount: number;
  sourcePaths: string[];
  tokenEstimate: number;
}

export interface WorkspaceSummaryCacheOptions {
  workspaceKey: string;
  maxFiles?: number;
  now?: number;
}

const DEFAULT_MAX_FILES = 24;
const summaryCache = new Map<string, WorkspaceSummaryCacheEntry>();

function summarizeFile(file: FileIndex): string {
  const parts = [`- ${file.path}`];
  if (file.headings?.length) {
    parts.push(`headings: ${file.headings.slice(0, 5).join(', ')}`);
  }
  if (file.exports?.length) {
    parts.push(`exports: ${file.exports.slice(0, 5).join(', ')}`);
  }
  if (file.symbols?.length) {
    parts.push(`symbols: ${file.symbols.slice(0, 5).map((symbol) => `${symbol.kind} ${symbol.name}`).join(', ')}`);
  }
  if (file.notebookCells?.length) {
    parts.push(`notebook cells: ${file.notebookCells.slice(0, 5).map((cell) => `${cell.id}(${cell.kind})`).join(', ')}`);
  }
  if (file.summary) {
    parts.push(`summary: ${file.summary}`);
  }
  return parts.join(' | ');
}

function cacheKey(workspaceKey: string): string {
  return workspaceKey.trim() || 'default-workspace';
}

export function getCachedWorkspaceSummary(
  workspaceKey: string,
  indexVersion: number,
): WorkspaceSummaryCacheEntry | null {
  const entry = summaryCache.get(cacheKey(workspaceKey));
  if (!entry || entry.indexVersion !== indexVersion) {
    return null;
  }
  return entry;
}

export function buildWorkspaceSummaryCacheEntry(
  index: WorkspaceIndex,
  options: WorkspaceSummaryCacheOptions,
): WorkspaceSummaryCacheEntry {
  const key = cacheKey(options.workspaceKey);
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const files = [...index.files.values()]
    .sort((left, right) => {
      const leftScore = (left.headings?.length ?? 0) + (left.exports?.length ?? 0) + (left.symbols?.length ?? 0);
      const rightScore = (right.headings?.length ?? 0) + (right.exports?.length ?? 0) + (right.symbols?.length ?? 0);
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      return right.lastModified - left.lastModified;
    })
    .slice(0, maxFiles);

  const summary = [
    `Workspace summary for ${key}`,
    `Indexed files: ${index.files.size}`,
    `Index version: ${index.version}`,
    '',
    ...files.map(summarizeFile),
  ].join('\n');

  return {
    workspaceKey: key,
    indexVersion: index.version,
    generatedAt: options.now ?? Date.now(),
    summary,
    fileCount: index.files.size,
    sourcePaths: files.map((file) => file.path),
    tokenEstimate: estimateTokens(summary),
  };
}

export function getOrBuildWorkspaceSummary(
  index: WorkspaceIndex,
  options: WorkspaceSummaryCacheOptions,
): WorkspaceSummaryCacheEntry {
  const key = cacheKey(options.workspaceKey);
  const cached = getCachedWorkspaceSummary(key, index.version);
  if (cached) {
    return cached;
  }
  const entry = buildWorkspaceSummaryCacheEntry(index, options);
  summaryCache.set(key, entry);
  return entry;
}

export function clearWorkspaceSummaryCache(workspaceKey?: string): void {
  if (workspaceKey) {
    summaryCache.delete(cacheKey(workspaceKey));
    return;
  }
  summaryCache.clear();
}
