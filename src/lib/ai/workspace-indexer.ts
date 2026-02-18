/**
 * Workspace Indexer
 * Indexes workspace files for AI context — extracts file summaries/structure
 * Supports incremental updates: only re-indexes changed files
 */

export interface FileIndex {
  path: string;
  name: string;
  extension: string;
  size: number;
  summary: string;       // First ~200 chars or extracted structure
  headings?: string[];   // For markdown files
  exports?: string[];    // For code files (function/class names)
  lastModified: number;
}

export interface WorkspaceIndex {
  files: Map<string, FileIndex>;
  lastFullIndex: number;
  version: number;
}

let currentIndex: WorkspaceIndex = {
  files: new Map(),
  lastFullIndex: 0,
  version: 0,
};

const indexChangeListeners = new Set<() => void>();
let indexing = false;

function notifyListeners() {
  for (const l of indexChangeListeners) { try { l(); } catch { /* */ } }
}

export function getWorkspaceIndex(): WorkspaceIndex {
  return currentIndex;
}

export function subscribeIndex(cb: () => void): () => void {
  indexChangeListeners.add(cb);
  return () => indexChangeListeners.delete(cb);
}

export function isIndexing(): boolean {
  return indexing;
}

/**
 * Extract a summary from file content based on type
 */
function extractSummary(content: string, ext: string): Partial<FileIndex> {
  const summary = content.slice(0, 200).replace(/\n/g, ' ').trim();

  if (ext === '.md' || ext === '.mdx') {
    const headings = [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => m[1].trim());
    return { summary, headings };
  }

  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
    const exports: string[] = [];
    const funcMatches = content.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/g);
    for (const m of funcMatches) exports.push(m[1]);
    return { summary, exports: exports.slice(0, 20) };
  }

  return { summary };
}

/**
 * Index a single file
 */
async function indexFile(
  rootHandle: FileSystemDirectoryHandle,
  path: string,
): Promise<FileIndex | null> {
  try {
    const parts = path.split('/').filter(Boolean);
    let dirHandle = rootHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      dirHandle = await dirHandle.getDirectoryHandle(parts[i]);
    }
    const fileHandle = await dirHandle.getFileHandle(parts[parts.length - 1]);
    const file = await fileHandle.getFile();

    const ext = '.' + (path.split('.').pop()?.toLowerCase() ?? '');
    // Skip binary/large files
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.zip', '.woff', '.woff2', '.ttf'].includes(ext)) {
      return { path, name: parts[parts.length - 1], extension: ext, size: file.size, summary: `[binary: ${ext}]`, lastModified: file.lastModified };
    }
    if (file.size > 500_000) {
      return { path, name: parts[parts.length - 1], extension: ext, size: file.size, summary: '[large file]', lastModified: file.lastModified };
    }

    const content = await file.text();
    const extracted = extractSummary(content, ext);

    return {
      path,
      name: parts[parts.length - 1],
      extension: ext,
      size: file.size,
      summary: extracted.summary ?? '',
      headings: extracted.headings,
      exports: extracted.exports,
      lastModified: file.lastModified,
    };
  } catch {
    return null;
  }
}

/**
 * Recursively collect file paths from a directory handle
 */
async function collectPaths(
  handle: FileSystemDirectoryHandle,
  prefix: string,
  paths: string[],
  maxDepth = 8,
  depth = 0,
): Promise<void> {
  if (depth > maxDepth) return;
  for await (const entry of handle.values()) {
    const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'file') {
      // Skip hidden files and node_modules
      if (!entry.name.startsWith('.')) paths.push(entryPath);
    } else if (entry.kind === 'directory') {
      if (['node_modules', '.git', '.next', 'dist', 'build', '.turbo', 'target'].includes(entry.name)) continue;
      await collectPaths(entry as FileSystemDirectoryHandle, entryPath, paths, maxDepth, depth + 1);
    }
  }
}

/**
 * Full workspace index — indexes all files
 */
export async function indexWorkspace(rootHandle: FileSystemDirectoryHandle): Promise<void> {
  if (indexing) return;
  indexing = true;
  notifyListeners();

  try {
    const paths: string[] = [];
    await collectPaths(rootHandle, '', paths);

    const newFiles = new Map<string, FileIndex>();
    // Process in batches to avoid blocking
    const BATCH_SIZE = 20;
    for (let i = 0; i < paths.length; i += BATCH_SIZE) {
      const batch = paths.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(p => indexFile(rootHandle, p)));
      for (const result of results) {
        if (result) newFiles.set(result.path, result);
      }
    }

    currentIndex = {
      files: newFiles,
      lastFullIndex: Date.now(),
      version: currentIndex.version + 1,
    };
  } finally {
    indexing = false;
    notifyListeners();
  }
}

/**
 * Incremental update — re-index only changed files
 */
export async function updateIndex(
  rootHandle: FileSystemDirectoryHandle,
  changedPaths: string[],
): Promise<void> {
  for (const path of changedPaths) {
    const result = await indexFile(rootHandle, path);
    if (result) {
      currentIndex.files.set(path, result);
    } else {
      currentIndex.files.delete(path);
    }
  }
  currentIndex.version++;
  notifyListeners();
}

/**
 * Search the index for files matching a query
 */
export function searchIndex(query: string, limit = 10): FileIndex[] {
  const q = query.toLowerCase();
  const results: FileIndex[] = [];
  for (const file of currentIndex.files.values()) {
    if (
      file.path.toLowerCase().includes(q) ||
      file.summary.toLowerCase().includes(q) ||
      file.headings?.some(h => h.toLowerCase().includes(q)) ||
      file.exports?.some(e => e.toLowerCase().includes(q))
    ) {
      results.push(file);
      if (results.length >= limit) break;
    }
  }
  return results;
}

/**
 * Build context string from indexed files for AI consumption
 */
export function buildIndexContext(relevantPaths?: string[]): string {
  const files = relevantPaths
    ? relevantPaths.map(p => currentIndex.files.get(p)).filter(Boolean) as FileIndex[]
    : [...currentIndex.files.values()];

  return files.map(f => {
    let entry = `## ${f.path} (${f.size}B)`;
    if (f.headings?.length) entry += `\nHeadings: ${f.headings.join(', ')}`;
    if (f.exports?.length) entry += `\nExports: ${f.exports.join(', ')}`;
    if (f.summary) entry += `\n${f.summary}`;
    return entry;
  }).join('\n\n');
}
