"use client";

/**
 * Backlink Panel Component
 * Displays files that link to the current document
 * 
 * Requirements: 8.6, 8.7
 */

import { memo, useMemo } from 'react';
import { Link2, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Backlink } from './types';

interface BacklinkPanelProps {
  /** Current file path */
  currentFile: string;
  /** All backlinks to this file */
  backlinks: Backlink[];
  /** Navigate to a file and line */
  onNavigate: (file: string, line: number) => void;
  /** Additional class name */
  className?: string;
}

/**
 * Group backlinks by source file
 */
function groupBacklinksByFile(backlinks: Backlink[]): Map<string, Backlink[]> {
  const grouped = new Map<string, Backlink[]>();
  
  for (const backlink of backlinks) {
    const existing = grouped.get(backlink.sourceFile) || [];
    existing.push(backlink);
    grouped.set(backlink.sourceFile, existing);
  }
  
  return grouped;
}

/**
 * Extract filename from path
 */
function getFileName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/**
 * Single backlink item
 */
function BacklinkItem({
  backlink,
  onNavigate,
}: {
  backlink: Backlink;
  onNavigate: (file: string, line: number) => void;
}) {
  return (
    <button
      onClick={() => onNavigate(backlink.sourceFile, backlink.sourceLine)}
      className={cn(
        'w-full text-left px-3 py-1.5 text-sm transition-colors',
        'hover:bg-accent/50 focus:outline-none focus:ring-1 focus:ring-primary/50',
        'flex items-start gap-2 rounded'
      )}
    >
      <span className="text-muted-foreground text-xs mt-0.5 shrink-0">
        L{backlink.sourceLine}
      </span>
      <span className="text-muted-foreground truncate flex-1">
        {backlink.context}
      </span>
    </button>
  );
}

/**
 * Backlink file group
 */
function BacklinkFileGroup({
  sourceFile,
  backlinks,
  onNavigate,
}: {
  sourceFile: string;
  backlinks: Backlink[];
  onNavigate: (file: string, line: number) => void;
}) {
  const fileName = getFileName(sourceFile);
  
  return (
    <div className="backlink-file-group mb-2">
      <button
        onClick={() => onNavigate(sourceFile, backlinks[0]?.sourceLine || 1)}
        className={cn(
          'w-full text-left px-2 py-1 text-sm font-medium transition-colors',
          'hover:bg-accent/30 focus:outline-none focus:ring-1 focus:ring-primary/50',
          'flex items-center gap-2 rounded'
        )}
      >
        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="truncate">{fileName}</span>
        <span className="text-xs text-muted-foreground ml-auto">
          {backlinks.length}
        </span>
      </button>
      <div className="ml-2 border-l border-border/50 pl-1">
        {backlinks.map((backlink, index) => (
          <BacklinkItem
            key={`${backlink.sourceLine}-${index}`}
            backlink={backlink}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Backlink Panel
 */
function BacklinkPanelComponent({
  currentFile: _currentFile,
  backlinks,
  onNavigate,
  className,
}: BacklinkPanelProps) {
  const groupedBacklinks = useMemo(
    () => groupBacklinksByFile(backlinks),
    [backlinks]
  );
  
  const fileCount = groupedBacklinks.size;
  const totalCount = backlinks.length;
  
  if (backlinks.length === 0) {
    return (
      <div className={cn('p-4 text-center text-muted-foreground text-sm', className)}>
        <Link2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No backlinks found</p>
        <p className="text-xs mt-1">
          Other files linking to this document will appear here
        </p>
      </div>
    );
  }
  
  return (
    <div className={cn('backlink-panel py-2', className)}>
      <div className="px-3 py-1 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Backlinks
        </span>
        <span className="text-xs text-muted-foreground">
          {totalCount} in {fileCount} {fileCount === 1 ? 'file' : 'files'}
        </span>
      </div>
      <nav className="mt-1 px-1">
        {Array.from(groupedBacklinks.entries()).map(([sourceFile, links]) => (
          <BacklinkFileGroup
            key={sourceFile}
            sourceFile={sourceFile}
            backlinks={links}
            onNavigate={onNavigate}
          />
        ))}
      </nav>
    </div>
  );
}

export const BacklinkPanel = memo(BacklinkPanelComponent);
BacklinkPanel.displayName = 'BacklinkPanel';

export default BacklinkPanel;
