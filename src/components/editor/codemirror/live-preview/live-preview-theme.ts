/**
 * Live Preview Theme for CodeMirror 6
 * Obsidian-style markdown rendering theme
 */

import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * Theme colors
 */
const colors = {
  background: 'transparent',
  foreground: 'var(--foreground, #1f2937)',
  muted: 'var(--muted, #f3f4f6)',
  mutedForeground: 'var(--muted-foreground, #6b7280)',
  primary: 'var(--primary, #3b82f6)',
  primaryLight: 'var(--primary-light, #dbeafe)',
  accent: 'var(--accent, #8b5cf6)',
  destructive: 'var(--destructive, #ef4444)',
  border: 'var(--border, #e5e7eb)',
  selection: '#bfdbfe',
  cursor: '#374151',
  highlight: '#fef08a',
  codeBackground: 'var(--muted, #f3f4f6)',
};

/**
 * Base editor theme
 */
export const livePreviewTheme = EditorView.theme({
  // Root
  '&': {
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: '16px',
    lineHeight: '1.75',
  },
  
  // Content
  '.cm-content': {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    padding: '1rem 0',
    caretColor: colors.cursor,
  },
  
  // Gutters
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: 'none',
    color: colors.mutedForeground,
  },
  
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 12px 0 8px',
    minWidth: '40px',
    fontSize: '14px',
  },
  
  // Focus
  '&.cm-focused': {
    outline: 'none',
  },
  
  // Active line
  '.cm-activeLine': {
    backgroundColor: `${colors.selection}20`,
  },
  
  // Selection
  '.cm-selectionBackground': {
    backgroundColor: colors.selection,
  },
  
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: colors.selection,
  },
  
  // Cursor
  '.cm-cursor': {
    borderLeftColor: colors.cursor,
    borderLeftWidth: '2px',
  },
  
  // Line wrapping
  '.cm-line': {
    padding: '0 1rem',
  },
  
  // === Inline Styles ===
  
  '.cm-bold': {
    fontWeight: 'bold',
  },
  
  '.cm-italic': {
    fontStyle: 'italic',
  },
  
  '.cm-strikethrough': {
    textDecoration: 'line-through',
    color: colors.mutedForeground,
  },
  
  '.cm-highlight': {
    backgroundColor: colors.highlight,
    borderRadius: '2px',
    padding: '0 2px',
  },
  
  '.cm-inline-code': {
    backgroundColor: colors.codeBackground,
    borderRadius: '4px',
    padding: '2px 6px',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: '0.9em',
  },
  
  // === Links ===
  
  '.cm-link': {
    color: colors.primary,
    textDecoration: 'underline',
    textDecorationColor: `${colors.primary}60`,
    cursor: 'pointer',
    '&:hover': {
      textDecorationColor: colors.primary,
    },
  },
  
  '.cm-wiki-link': {
    color: colors.accent,
    backgroundColor: `${colors.accent}15`,
    padding: '0 4px',
    borderRadius: '4px',
    cursor: 'pointer',
    textDecoration: 'none',
    '&:hover': {
      backgroundColor: `${colors.accent}25`,
    },
  },
  
  '.cm-wiki-link.broken': {
    color: colors.destructive,
    textDecoration: 'line-through',
  },
  
  // === Headings ===
  
  '.cm-heading': {
    fontWeight: 'bold',
    color: colors.foreground,
  },
  
  '.cm-heading-1': {
    fontSize: '2em',
    lineHeight: '1.3',
    marginTop: '1em',
    marginBottom: '0.5em',
    borderBottom: `1px solid ${colors.border}`,
    paddingBottom: '0.3em',
  },
  
  '.cm-heading-2': {
    fontSize: '1.5em',
    lineHeight: '1.35',
    marginTop: '0.8em',
    marginBottom: '0.4em',
  },
  
  '.cm-heading-3': {
    fontSize: '1.25em',
    lineHeight: '1.4',
    marginTop: '0.6em',
    marginBottom: '0.3em',
  },
  
  '.cm-heading-4': {
    fontSize: '1.1em',
    lineHeight: '1.45',
  },
  
  '.cm-heading-5': {
    fontSize: '1em',
    lineHeight: '1.5',
  },
  
  '.cm-heading-6': {
    fontSize: '0.9em',
    lineHeight: '1.5',
    color: colors.mutedForeground,
  },
  
  // === Blockquotes ===
  
  '.cm-blockquote': {
    borderLeft: `4px solid ${colors.primary}`,
    paddingLeft: '1em',
    marginLeft: '0',
    color: colors.mutedForeground,
    fontStyle: 'italic',
  },
  
  // === Lists ===
  
  '.cm-list-item': {
    paddingLeft: '0.5em',
  },
  
  '.cm-list-marker': {
    color: colors.primary,
    fontWeight: 'bold',
  },
  
  '.cm-task-checkbox': {
    width: '16px',
    height: '16px',
    marginRight: '8px',
    cursor: 'pointer',
    accentColor: colors.primary,
  },
  
  // === Horizontal Rule ===
  
  '.cm-horizontal-rule': {
    border: 'none',
    borderTop: `2px solid ${colors.border}`,
    margin: '1.5em 0',
  },
  
  // === Code Blocks ===
  
  '.cm-code-block-widget': {
    backgroundColor: colors.codeBackground,
    borderRadius: '8px',
    margin: '1em 0',
    overflow: 'hidden',
  },
  
  '.cm-code-block-header': {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    backgroundColor: `${colors.border}50`,
    borderBottom: `1px solid ${colors.border}`,
  },
  
  '.cm-code-block-lang': {
    fontSize: '12px',
    fontWeight: '500',
    color: colors.mutedForeground,
    textTransform: 'uppercase',
  },
  
  '.cm-code-block-copy': {
    fontSize: '12px',
    padding: '4px 8px',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: 'transparent',
    color: colors.mutedForeground,
    cursor: 'pointer',
    '&:hover': {
      backgroundColor: colors.border,
    },
  },
  
  '.cm-code-block-pre': {
    margin: '0',
    padding: '12px 16px',
    overflow: 'auto',
  },
  
  '.cm-code-block-code': {
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: '14px',
    lineHeight: '1.5',
  },
  
  '.cm-code-block-line': {
    backgroundColor: `${colors.codeBackground}80`,
  },
  
  '.cm-code-block-editing': {
    backgroundColor: colors.codeBackground,
  },
  
  // === Math ===
  
  '.cm-math-inline': {
    display: 'inline-block',
    verticalAlign: 'middle',
    padding: '0 2px',
  },
  
  '.cm-math-block': {
    display: 'block',
    textAlign: 'center',
    margin: '1em 0',
    padding: '1em',
    backgroundColor: `${colors.muted}50`,
    borderRadius: '8px',
  },
  
  '.cm-math-error': {
    color: colors.destructive,
    fontStyle: 'italic',
  },
  
  '.cm-math-loading': {
    color: colors.mutedForeground,
    fontStyle: 'italic',
  },
  
  '.cm-math-source-inline': {
    backgroundColor: `${colors.primary}15`,
    borderRadius: '4px',
    padding: '0 4px',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: '0.9em',
  },
  
  '.cm-math-source-block': {
    backgroundColor: `${colors.primary}10`,
    borderRadius: '8px',
    padding: '8px 12px',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: '0.9em',
    display: 'block',
    margin: '0.5em 0',
  },
  
  // === Tables ===
  
  '.cm-table-widget': {
    width: '100%',
    borderCollapse: 'collapse',
    margin: '1em 0',
    fontSize: '14px',
  },
  
  '.cm-table-widget th, .cm-table-widget td': {
    border: `1px solid ${colors.border}`,
    padding: '8px 12px',
    textAlign: 'left',
  },
  
  '.cm-table-widget th': {
    backgroundColor: colors.muted,
    fontWeight: '600',
  },
  
  '.cm-table-widget tr:nth-child(even)': {
    backgroundColor: `${colors.muted}50`,
  },
  
  '.cm-table-line': {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: '14px',
  },
  
  // === Images ===
  
  '.cm-image-container': {
    display: 'inline-block',
    maxWidth: '100%',
  },
  
  '.cm-image': {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  },
  
  '.cm-image-error': {
    color: colors.destructive,
    fontStyle: 'italic',
    padding: '8px',
    backgroundColor: `${colors.destructive}10`,
    borderRadius: '4px',
  },
  
  // === Folding ===
  
  '.cm-fold-marker': {
    cursor: 'pointer',
    color: colors.mutedForeground,
    fontSize: '12px',
    padding: '0 4px',
    userSelect: 'none',
    '&:hover': {
      color: colors.foreground,
    },
  },
  
  '.cm-fold-open': {
    opacity: '0.5',
  },
  
  '.cm-fold-closed': {
    opacity: '1',
  },
  
  // === Hidden Syntax ===
  
  '.cm-hidden-syntax': {
    display: 'none',
  },
  
  // === Search ===
  
  '.cm-searchMatch': {
    backgroundColor: colors.highlight,
    outline: `1px solid ${colors.primary}40`,
  },
  
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: `${colors.primary}40`,
  },
});

/**
 * Syntax highlighting for markdown source
 */
export const livePreviewHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, fontWeight: 'bold' },
  { tag: tags.heading1, fontSize: '1.5em' },
  { tag: tags.heading2, fontSize: '1.3em' },
  { tag: tags.heading3, fontSize: '1.1em' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.link, color: colors.primary, textDecoration: 'underline' },
  { tag: tags.url, color: colors.primary },
  { tag: tags.monospace, fontFamily: '"JetBrains Mono", monospace' },
  { tag: tags.comment, color: colors.mutedForeground, fontStyle: 'italic' },
  { tag: tags.meta, color: colors.mutedForeground },
  { tag: tags.processingInstruction, color: colors.accent },
]);

/**
 * Complete theme extension
 */
export const livePreviewThemeExtension: Extension = [
  livePreviewTheme,
  syntaxHighlighting(livePreviewHighlightStyle),
];
