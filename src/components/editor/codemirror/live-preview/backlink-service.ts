/**
 * Backlink Scanning Service
 * Scans files for wiki links and builds backlink index
 * 
 * Requirements: 8.6, 8.7
 */

import {
  buildMarkdownLinkIndex,
  getMarkdownBacklinks,
  type MarkdownIndexNote,
  type MarkdownLinkIndex,
} from '@/lib/markdown/link-index';
import { extractMarkdownDocument } from '@/lib/markdown/extract';
import { normalizeWorkspacePath } from '@/lib/link-router/path-utils';
import type { Backlink, WikiLink } from './types';

function createEmptyMarkdownLinkIndex(): MarkdownLinkIndex {
  return buildMarkdownLinkIndex([]);
}

/**
 * Extract wiki links from content
 */
export function extractWikiLinks(content: string): WikiLink[] {
  const document = extractMarkdownDocument(content);
  return document.links
    .filter((link) => link.kind === 'wiki' && !link.embedded)
    .map((link) => {
      const [target, heading] = link.target.split('#', 2);
      return {
        target: target.trim(),
        alias: link.label,
        heading: heading?.trim() || undefined,
        from: link.range.start.offset,
        to: link.range.end.offset,
        exists: true,
      };
    });
}

/**
 * File content provider interface
 */
export interface FileContentProvider {
  /** Get list of all markdown files */
  getFiles(): string[];
  /** Get content of a file */
  getContent(filePath: string): string | null;
}

/**
 * Backlink index for efficient lookups
 */
export class BacklinkIndex {
  private markdownIndex: MarkdownLinkIndex = createEmptyMarkdownLinkIndex();
  private fileLinks: Map<string, WikiLink[]> = new Map();
  private contentByFile: Map<string, string> = new Map();
  
  /**
   * Build index from all files
   */
  build(provider: FileContentProvider): void {
    this.fileLinks.clear();
    this.contentByFile.clear();

    const notes: MarkdownIndexNote[] = [];
    const files = provider.getFiles();

    for (const file of files) {
      const content = provider.getContent(file);
      if (content == null) continue;

      const normalizedFile = normalizeWorkspacePath(file);
      this.contentByFile.set(normalizedFile, content);
      const links = extractWikiLinks(content);
      this.fileLinks.set(normalizedFile, links);
      notes.push({ path: normalizedFile, content });
    }

    this.markdownIndex = buildMarkdownLinkIndex(notes);
  }
  
  /**
   * Get backlinks for a file
   */
  getBacklinks(filePath: string): Backlink[] {
    return getMarkdownBacklinks(this.markdownIndex, filePath).map((backlink) => ({
      sourceFile: backlink.sourceFile,
      sourceLine: backlink.sourceLine,
      context: backlink.context,
      linkText: backlink.displayText || backlink.rawTarget,
    }));
  }
  
  /**
   * Get outgoing links from a file
   */
  getOutgoingLinks(filePath: string): WikiLink[] {
    return this.fileLinks.get(normalizeWorkspacePath(filePath)) || [];
  }
  
  /**
   * Update index for a single file
   */
  updateFile(filePath: string, content: string, allFiles: string[]): void {
    const normalizedFilePath = normalizeWorkspacePath(filePath);
    this.contentByFile.set(normalizedFilePath, content);
    this.rebuildFromKnownFiles(allFiles.map((file) => normalizeWorkspacePath(file)));
  }
  
  /**
   * Remove a file from the index
   */
  removeFile(filePath: string): void {
    const normalizedFilePath = normalizeWorkspacePath(filePath);
    this.contentByFile.delete(normalizedFilePath);
    this.fileLinks.delete(normalizedFilePath);
    this.rebuildFromKnownFiles(Array.from(this.contentByFile.keys()));
  }

  private rebuildFromKnownFiles(allFiles: string[]): void {
    this.fileLinks.clear();
    const knownFiles = new Set([
      ...allFiles.map((file) => normalizeWorkspacePath(file)),
      ...this.contentByFile.keys(),
    ]);

    const notes: MarkdownIndexNote[] = Array.from(knownFiles).map((path) => {
      const content = this.contentByFile.get(path) ?? '';
      this.fileLinks.set(path, extractWikiLinks(content));
      return { path, content };
    });

    this.markdownIndex = buildMarkdownLinkIndex(notes);
  }
}

/**
 * Create a simple in-memory backlink index
 */
export function createBacklinkIndex(): BacklinkIndex {
  return new BacklinkIndex();
}
