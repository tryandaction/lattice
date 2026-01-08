/**
 * Backlink Scanning Service
 * Scans files for wiki links and builds backlink index
 * 
 * Requirements: 8.6, 8.7
 */

import type { Backlink, WikiLink } from './types';

/**
 * Wiki link pattern: [[target]] or [[target|alias]] or [[target#heading]]
 */
const WIKI_LINK_PATTERN = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;

/**
 * Markdown link pattern: [text](url)
 */
const MD_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * Extract wiki links from content
 */
export function extractWikiLinks(content: string): WikiLink[] {
  const links: WikiLink[] = [];
  const lines = content.split('\n');
  let offset = 0;
  
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    let match;
    
    // Reset regex
    WIKI_LINK_PATTERN.lastIndex = 0;
    
    while ((match = WIKI_LINK_PATTERN.exec(line)) !== null) {
      const target = match[1].trim();
      const heading = match[2]?.trim();
      const alias = match[3]?.trim();
      
      links.push({
        target,
        alias,
        heading,
        from: offset + match.index,
        to: offset + match.index + match[0].length,
        exists: true, // Will be validated externally
      });
    }
    
    offset += line.length + 1; // +1 for newline
  }
  
  return links;
}

/**
 * Extract context around a link (surrounding text)
 */
function extractContext(content: string, linkFrom: number, linkTo: number, maxLength: number = 80): string {
  const lines = content.split('\n');
  let offset = 0;
  
  for (const line of lines) {
    const lineEnd = offset + line.length;
    
    if (linkFrom >= offset && linkFrom <= lineEnd) {
      // Found the line containing the link
      const trimmed = line.trim();
      if (trimmed.length <= maxLength) {
        return trimmed;
      }
      
      // Truncate around the link
      const linkInLine = linkFrom - offset;
      const start = Math.max(0, linkInLine - maxLength / 2);
      const end = Math.min(line.length, linkInLine + maxLength / 2);
      
      let context = line.slice(start, end).trim();
      if (start > 0) context = '...' + context;
      if (end < line.length) context = context + '...';
      
      return context;
    }
    
    offset = lineEnd + 1;
  }
  
  return '';
}

/**
 * Get line number for a position in content
 */
function getLineNumber(content: string, position: number): number {
  const beforePos = content.slice(0, position);
  return beforePos.split('\n').length;
}

/**
 * Normalize file path for comparison
 */
function normalizeFilePath(path: string): string {
  // Remove extension and normalize slashes
  return path
    .replace(/\\/g, '/')
    .replace(/\.md$/i, '')
    .toLowerCase();
}

/**
 * Check if a link target matches a file path
 */
function linkMatchesFile(linkTarget: string, filePath: string): boolean {
  const normalizedTarget = normalizeFilePath(linkTarget);
  const normalizedFile = normalizeFilePath(filePath);
  
  // Exact match
  if (normalizedTarget === normalizedFile) return true;
  
  // Target is just filename, file is full path
  const fileName = normalizedFile.split('/').pop() || '';
  if (normalizedTarget === fileName) return true;
  
  // Target ends with the file path
  if (normalizedFile.endsWith('/' + normalizedTarget)) return true;
  
  return false;
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
  private backlinks: Map<string, Backlink[]> = new Map();
  private fileLinks: Map<string, WikiLink[]> = new Map();
  
  /**
   * Build index from all files
   */
  build(provider: FileContentProvider): void {
    this.backlinks.clear();
    this.fileLinks.clear();
    
    const files = provider.getFiles();
    
    // First pass: extract all links
    for (const file of files) {
      const content = provider.getContent(file);
      if (!content) continue;
      
      const links = extractWikiLinks(content);
      this.fileLinks.set(file, links);
    }
    
    // Second pass: build backlink index
    for (const [sourceFile, links] of this.fileLinks) {
      const content = provider.getContent(sourceFile);
      if (!content) continue;
      
      for (const link of links) {
        // Find which file this link points to
        for (const targetFile of files) {
          if (linkMatchesFile(link.target, targetFile)) {
            const backlink: Backlink = {
              sourceFile,
              sourceLine: getLineNumber(content, link.from),
              context: extractContext(content, link.from, link.to),
              linkText: link.alias || link.target,
            };
            
            const existing = this.backlinks.get(targetFile) || [];
            existing.push(backlink);
            this.backlinks.set(targetFile, existing);
            break;
          }
        }
      }
    }
  }
  
  /**
   * Get backlinks for a file
   */
  getBacklinks(filePath: string): Backlink[] {
    return this.backlinks.get(filePath) || [];
  }
  
  /**
   * Get outgoing links from a file
   */
  getOutgoingLinks(filePath: string): WikiLink[] {
    return this.fileLinks.get(filePath) || [];
  }
  
  /**
   * Update index for a single file
   */
  updateFile(filePath: string, content: string, allFiles: string[]): void {
    // Remove old backlinks from this file
    for (const [targetFile, backlinks] of this.backlinks) {
      const filtered = backlinks.filter(b => b.sourceFile !== filePath);
      if (filtered.length > 0) {
        this.backlinks.set(targetFile, filtered);
      } else {
        this.backlinks.delete(targetFile);
      }
    }
    
    // Extract new links
    const links = extractWikiLinks(content);
    this.fileLinks.set(filePath, links);
    
    // Add new backlinks
    for (const link of links) {
      for (const targetFile of allFiles) {
        if (linkMatchesFile(link.target, targetFile)) {
          const backlink: Backlink = {
            sourceFile: filePath,
            sourceLine: getLineNumber(content, link.from),
            context: extractContext(content, link.from, link.to),
            linkText: link.alias || link.target,
          };
          
          const existing = this.backlinks.get(targetFile) || [];
          existing.push(backlink);
          this.backlinks.set(targetFile, existing);
          break;
        }
      }
    }
  }
  
  /**
   * Remove a file from the index
   */
  removeFile(filePath: string): void {
    // Remove backlinks from this file
    for (const [targetFile, backlinks] of this.backlinks) {
      const filtered = backlinks.filter(b => b.sourceFile !== filePath);
      if (filtered.length > 0) {
        this.backlinks.set(targetFile, filtered);
      } else {
        this.backlinks.delete(targetFile);
      }
    }
    
    // Remove outgoing links
    this.fileLinks.delete(filePath);
    
    // Remove backlinks to this file
    this.backlinks.delete(filePath);
  }
}

/**
 * Create a simple in-memory backlink index
 */
export function createBacklinkIndex(): BacklinkIndex {
  return new BacklinkIndex();
}
