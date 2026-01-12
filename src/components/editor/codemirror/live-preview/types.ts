/**
 * Types for Live Preview Editor
 * Obsidian-style markdown editing with cursor-based syntax reveal
 */

export type ViewMode = 'live' | 'source' | 'reading';

export interface OutlineItem {
  level: number;
  text: string;
  line: number;
  from: number;
  to: number;
  children: OutlineItem[];
}

export interface Backlink {
  sourceFile: string;
  sourceLine: number;
  context: string;
  linkText: string;
}

export interface WikiLink {
  target: string;
  alias?: string;
  heading?: string;
  from: number;
  to: number;
  exists: boolean;
}

export interface LivePreviewConfig {
  mode: ViewMode;
  showLineNumbers: boolean;
  showFoldGutter: boolean;
  enableWikiLinks: boolean;
  enableBacklinks: boolean;
  availableFiles?: string[];
  onNavigateToFile?: (filename: string) => void;
  onOpenExternalLink?: (url: string) => void;
}

export interface FoldState {
  foldedRanges: Array<{ from: number; to: number }>;
}

export interface MarkdownElement {
  type: 'bold' | 'italic' | 'bolditalic' | 'strikethrough' | 'highlight' | 'code' | 'link' | 'wikilink' | 'annotationlink' | 'math' | 'image';
  from: number;
  to: number;
  syntaxFrom: number;
  syntaxTo: number;
  contentFrom: number;
  contentTo: number;
  content: string;
  extra?: Record<string, unknown>;
}

export interface HeadingInfo {
  level: number;
  text: string;
  line: number;
  from: number;
  to: number;
  markerFrom: number;
  markerTo: number;
}

export interface CodeBlockInfo {
  language: string;
  code: string;
  from: number;
  to: number;
  fenceStartFrom: number;
  fenceStartTo: number;
  fenceEndFrom: number;
  fenceEndTo: number;
}

export interface ListItemInfo {
  type: 'bullet' | 'numbered' | 'task';
  marker: string;
  from: number;
  to: number;
  markerFrom: number;
  markerTo: number;
  checked?: boolean;
  indent: number;
}

export interface BlockquoteInfo {
  from: number;
  to: number;
  markerFrom: number;
  markerTo: number;
  content: string;
}

export interface TableInfo {
  from: number;
  to: number;
  rows: TableRow[];
}

export interface TableRow {
  cells: TableCell[];
  from: number;
  to: number;
}

export interface TableCell {
  content: string;
  from: number;
  to: number;
}
