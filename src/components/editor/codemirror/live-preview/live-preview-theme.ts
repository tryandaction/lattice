/**
 * Live Preview Theme for CodeMirror 6
 * Obsidian-style markdown rendering theme
 */

import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import './live-preview-theme.css';

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
  
  // Gutters - fold gutter should be leftmost
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: 'none',
    color: colors.mutedForeground,
    display: 'flex',
    flexDirection: 'row',
  },
  
  // Fold gutter - leftmost position
  '.cm-gutter.cm-foldGutter': {
    order: 0,
    width: '16px',
  },
  
  // Line numbers - after fold gutter
  '.cm-gutter.cm-lineNumbers': {
    order: 1,
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
  
  // Active line - Obsidian-style subtle blue highlight
  '.cm-activeLine': {
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
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
  
  // Line wrapping with smooth transition for active line highlight
  '.cm-line': {
    padding: '0 1rem',
    transition: 'background-color 150ms ease-out',
  },

  // Vertical rhythm for paragraphs
  '.cm-line + .cm-line': {
    marginTop: '0.25em',
  },

  // Extra spacing after headings
  '.cm-heading + .cm-line:not(.cm-heading)': {
    marginTop: '0.75em',
  },

  // List item spacing
  '.cm-list-item + .cm-list-item': {
    marginTop: '0.25em',
  },

  // Block spacing - blockquote styles are defined below in === Blockquotes === section

  // Improved reading width
  '.cm-formatted-content': {
    maxWidth: '65ch',
    lineHeight: '1.75',
  },
  
  // === Inline Styles ===
  
  '.cm-bold': {
    fontWeight: 'bold',
    cursor: 'text',
  },
  
  '.cm-italic': {
    fontStyle: 'italic',
    cursor: 'text',
  },
  
  '.cm-strikethrough': {
    textDecoration: 'line-through',
    color: colors.mutedForeground,
    cursor: 'text',
  },
  
  '.cm-highlight': {
    backgroundColor: colors.highlight,
    borderRadius: '2px',
    padding: '0 2px',
    cursor: 'text',
  },
  
  '.cm-inline-code': {
    backgroundColor: colors.codeBackground,
    borderRadius: '4px',
    padding: '2px 6px',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: '0.9em',
    cursor: 'text',
  },
  
  // === Links ===
  
  '.cm-link': {
    color: colors.primary,
    textDecoration: 'underline',
    textDecorationColor: `${colors.primary}60`,
    cursor: 'pointer',
    transition: 'text-decoration-color 150ms ease, color 150ms ease',
    '&:hover': {
      textDecorationColor: colors.primary,
      color: `${colors.primary}`,
    },
  },
  
  '.cm-wiki-link': {
    color: colors.accent,
    backgroundColor: `${colors.accent}15`,
    padding: '0 4px',
    borderRadius: '4px',
    cursor: 'pointer',
    textDecoration: 'none',
    transition: 'background-color 150ms ease, color 150ms ease',
    '&:hover': {
      backgroundColor: `${colors.accent}25`,
      color: colors.accent,
    },
  },
  
  '.cm-wiki-link.broken': {
    color: colors.destructive,
    textDecoration: 'line-through',
  },
  
  // === Annotation Links ===
  
  '.cm-annotation-link': {
    color: '#f59e0b',  // Amber color for annotations
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    padding: '1px 6px',
    borderRadius: '4px',
    cursor: 'pointer',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2px',
    transition: 'background-color 150ms ease, color 150ms ease, transform 150ms ease',
    '&:hover': {
      backgroundColor: 'rgba(245, 158, 11, 0.25)',
      color: '#d97706',
      transform: 'translateY(-1px)',
    },
  },
  
  '.cm-annotation-link-icon': {
    fontSize: '0.85em',
    lineHeight: '1',
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
  
  // Heading content widgets (rendered without # markers)
  '.cm-heading-content': {
    display: 'inline',
    cursor: 'text',
  },
  
  '.cm-heading-1-content': {
    fontSize: '2em',
    fontWeight: 'bold',
    lineHeight: '1.3',
  },
  
  '.cm-heading-2-content': {
    fontSize: '1.5em',
    fontWeight: 'bold',
    lineHeight: '1.35',
  },
  
  '.cm-heading-3-content': {
    fontSize: '1.25em',
    fontWeight: 'bold',
    lineHeight: '1.4',
  },
  
  '.cm-heading-4-content': {
    fontSize: '1.1em',
    fontWeight: 'bold',
  },
  
  '.cm-heading-5-content': {
    fontSize: '1em',
    fontWeight: 'bold',
  },
  
  '.cm-heading-6-content': {
    fontSize: '0.9em',
    fontWeight: 'bold',
    color: colors.mutedForeground,
  },
  
  // Blockquote content widget
  '.cm-blockquote-content': {
    display: 'inline',
    cursor: 'text',
    fontStyle: 'italic',
    color: colors.mutedForeground,
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
    marginTop: '0.5em',
    marginBottom: '0.5em',
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
  
  '.cm-horizontal-rule-container': {
    display: 'block',
    width: '100%',
    padding: '1em 0',
    cursor: 'pointer',
  },
  
  '.cm-horizontal-rule': {
    border: 'none',
    borderTop: `2px solid ${colors.border}`,
    margin: '0',
    width: '100%',
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
    transition: 'background-color 150ms ease, color 150ms ease',
    '&:hover': {
      backgroundColor: colors.border,
      color: colors.foreground,
    },
  },
  
  '.cm-code-block-wrapper': {
    display: 'flex',
    overflow: 'auto',
  },
  
  '.cm-code-block-line-numbers': {
    display: 'flex',
    flexDirection: 'column',
    padding: '12px 0',
    backgroundColor: `${colors.border}30`,
    borderRight: `1px solid ${colors.border}`,
    userSelect: 'none',
  },
  
  '.cm-code-block-line-number': {
    padding: '0 12px',
    fontSize: '14px',
    lineHeight: '1.5',
    color: colors.mutedForeground,
    textAlign: 'right',
    minWidth: '32px',
  },
  
  '.cm-code-block-pre': {
    margin: '0',
    padding: '12px 16px',
    overflow: 'auto',
    flex: '1',
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
  
  // Hidden lines for multi-line code blocks (when not editing)
  '.cm-code-block-hidden': {
    display: 'none !important',
    height: '0 !important',
    overflow: 'hidden !important',
    margin: '0 !important',
    padding: '0 !important',
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
    padding: '0.5em',
    cursor: 'text',
    width: '100%',
  },
  
  '.cm-widgetBuffer + .cm-math-block, .cm-widgetBuffer + .cm-code-block-widget, .cm-widgetBuffer + .cm-table-widget': {
    display: 'block',
  },
  
  '.cm-math-error': {
    color: colors.destructive,
    fontStyle: 'italic',
    border: `1px solid ${colors.destructive}`,
    borderRadius: '4px',
    padding: '2px 6px',
    backgroundColor: `${colors.destructive}10`,
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: '0.9em',
  },
  
  '.cm-math-error-wrapper': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
  },
  
  '.cm-math-error-indicator': {
    color: colors.destructive,
    fontSize: '0.9em',
    cursor: 'help',
  },
  
  '.cm-math-error-source': {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: '0.9em',
    color: colors.mutedForeground,
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
  
  // Hidden lines for multi-line block math (when not editing)
  '.cm-math-block-hidden': {
    display: 'none !important',
    height: '0 !important',
    overflow: 'hidden !important',
    margin: '0 !important',
    padding: '0 !important',
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
  
  // Table inline formatting styles
  '.cm-table-widget strong': {
    fontWeight: 'bold',
  },
  
  '.cm-table-widget em': {
    fontStyle: 'italic',
  },
  
  '.cm-table-widget del': {
    textDecoration: 'line-through',
    color: colors.mutedForeground,
  },
  
  '.cm-table-widget mark': {
    backgroundColor: colors.highlight,
    borderRadius: '2px',
    padding: '0 2px',
  },
  
  '.cm-table-widget code': {
    backgroundColor: colors.codeBackground,
    borderRadius: '4px',
    padding: '2px 6px',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: '0.9em',
  },
  
  '.cm-wiki-link-table': {
    color: colors.accent,
    backgroundColor: `${colors.accent}15`,
    padding: '0 4px',
    borderRadius: '4px',
    cursor: 'pointer',
    textDecoration: 'none',
    transition: 'background-color 150ms ease',
    '&:hover': {
      backgroundColor: `${colors.accent}25`,
    },
  },
  
  '.cm-link-table': {
    color: colors.primary,
    textDecoration: 'underline',
    textDecorationColor: `${colors.primary}60`,
    '&:hover': {
      textDecorationColor: colors.primary,
    },
  },
  
  '.cm-math-inline-table': {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: '0.9em',
    color: colors.accent,
    backgroundColor: `${colors.accent}10`,
    padding: '0 4px',
    borderRadius: '4px',
  },
  
  '.cm-table-line': {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: '14px',
  },
  
  // Hidden lines for multi-line tables (when not editing)
  '.cm-table-hidden': {
    display: 'none !important',
    height: '0 !important',
    overflow: 'hidden !important',
    margin: '0 !important',
    padding: '0 !important',
  },
  
  // === Images ===
  
  '.cm-image-container': {
    display: 'inline-block',
    maxWidth: '100%',
    cursor: 'pointer',
    transition: 'transform 150ms ease',
    '&:hover': {
      transform: 'scale(1.01)',
    },
  },
  
  '.cm-image': {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    transition: 'box-shadow 150ms ease',
  },
  
  '.cm-image-container:hover .cm-image': {
    boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
  },
  
  '.cm-image-error': {
    color: colors.destructive,
    fontStyle: 'italic',
    padding: '8px',
    backgroundColor: `${colors.destructive}10`,
    borderRadius: '4px',
    border: `1px dashed ${colors.destructive}40`,
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
  
  // === Syntax Transitions (Obsidian-like smooth reveal/hide) ===
  
  '.cm-syntax-transition': {
    transition: 'opacity 150ms ease-out, transform 150ms ease-out',
  },
  
  '.cm-formatted-widget': {
    cursor: 'text',
    // Smooth appearance animation
    animation: 'cm-fade-in 150ms ease-out',
  },
  
  // Keyframes for smooth animations
  '@keyframes cm-fade-in': {
    from: { opacity: '0', transform: 'translateY(-2px)' },
    to: { opacity: '1', transform: 'translateY(0)' },
  },
  
  '@keyframes cm-fade-out': {
    from: { opacity: '1', transform: 'translateY(0)' },
    to: { opacity: '0', transform: 'translateY(2px)' },
  },
  
  // Source mode syntax markers (shown when editing) - with smooth reveal
  '.cm-bold-source, .cm-italic-source, .cm-bolditalic-source, .cm-strikethrough-source, .cm-highlight-source, .cm-code-source': {
    color: 'var(--muted-foreground, #6b7280)',
    opacity: '0.7',
    transition: 'opacity 150ms ease-out, color 150ms ease-out',
  },
  
  // Smooth transition for link source markers
  '.cm-link-source, .cm-wikilink-source, .cm-image-source': {
    color: 'var(--muted-foreground, #6b7280)',
    opacity: '0.7',
    transition: 'opacity 150ms ease-out',
  },
  
  // === Search ===
  
  '.cm-searchMatch': {
    backgroundColor: colors.highlight,
    outline: `1px solid ${colors.primary}40`,
  },
  
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: `${colors.primary}40`,
  },
  
  // === Superscript & Subscript ===
  
  '.cm-superscript': {
    verticalAlign: 'super',
    fontSize: '0.8em',
    cursor: 'text',
  },
  
  '.cm-subscript': {
    verticalAlign: 'sub',
    fontSize: '0.8em',
    cursor: 'text',
  },
  
  // === Keyboard Keys ===
  
  '.cm-kbd': {
    display: 'inline-block',
    padding: '2px 6px',
    fontSize: '0.85em',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    lineHeight: '1.4',
    color: colors.foreground,
    backgroundColor: colors.muted,
    border: `1px solid ${colors.border}`,
    borderRadius: '4px',
    boxShadow: `0 1px 0 ${colors.border}, inset 0 0 0 1px rgba(255,255,255,0.5)`,
    cursor: 'text',
  },
  
  // === Footnotes ===
  
  '.cm-footnote-ref': {
    verticalAlign: 'super',
    fontSize: '0.8em',
    lineHeight: '1',
  },
  
  '.cm-footnote-ref-link': {
    color: colors.primary,
    textDecoration: 'none',
    cursor: 'pointer',
    padding: '0 2px',
    borderRadius: '2px',
    transition: 'background-color 150ms ease',
    '&:hover': {
      backgroundColor: `${colors.primary}20`,
      textDecoration: 'underline',
    },
  },
  
  '.cm-footnote-def': {
    display: 'block',
    padding: '8px 12px',
    margin: '8px 0',
    backgroundColor: `${colors.muted}50`,
    borderLeft: `3px solid ${colors.primary}`,
    borderRadius: '0 4px 4px 0',
    fontSize: '0.9em',
  },
  
  '.cm-footnote-def-label': {
    fontWeight: '600',
    color: colors.primary,
    marginRight: '8px',
  },
  
  '.cm-footnote-def-content': {
    color: colors.foreground,
  },
  
  '.cm-footnote-backlink': {
    color: colors.mutedForeground,
    textDecoration: 'none',
    marginLeft: '4px',
    cursor: 'pointer',
    '&:hover': {
      color: colors.primary,
    },
  },
  
  // === Embeds ===
  
  '.cm-embed': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    backgroundColor: `${colors.accent}15`,
    border: `1px solid ${colors.accent}30`,
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'background-color 150ms ease, border-color 150ms ease',
    '&:hover': {
      backgroundColor: `${colors.accent}25`,
      borderColor: `${colors.accent}50`,
    },
  },
  
  '.cm-embed-icon': {
    fontSize: '0.9em',
  },
  
  '.cm-embed-text': {
    color: colors.accent,
    fontSize: '0.9em',
  },
  
  '.cm-embed-widget': {
    display: 'block',
    margin: '12px 0',
    padding: '12px 16px',
    backgroundColor: `${colors.muted}50`,
    border: `1px solid ${colors.border}`,
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'border-color 150ms ease, box-shadow 150ms ease',
    '&:hover': {
      borderColor: colors.accent,
      boxShadow: `0 2px 8px ${colors.accent}20`,
    },
  },
  
  '.cm-embed-header': {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
  },
  
  '.cm-embed-title': {
    fontWeight: '500',
    color: colors.accent,
  },
  
  '.cm-embed-content': {
    color: colors.mutedForeground,
    fontSize: '0.9em',
  },
  
  '.cm-embed-open': {
    display: 'inline-block',
    marginTop: '8px',
    color: colors.primary,
    fontSize: '0.85em',
    textDecoration: 'none',
    '&:hover': {
      textDecoration: 'underline',
    },
  },
  
  // === Details/Summary (Collapsible) ===
  
  '.cm-details-widget': {
    display: 'block',
    margin: '8px 0',
    padding: '0',
    border: `1px solid ${colors.border}`,
    borderRadius: '8px',
    overflow: 'hidden',
  },
  
  '.cm-details-summary': {
    padding: '12px 16px',
    backgroundColor: colors.muted,
    cursor: 'pointer',
    fontWeight: '500',
    userSelect: 'none',
    listStyle: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    '&::-webkit-details-marker': {
      display: 'none',
    },
    '&::before': {
      content: '"▶"',
      fontSize: '0.8em',
      transition: 'transform 150ms ease',
    },
  },
  
  '.cm-details-widget[open] .cm-details-summary::before': {
    transform: 'rotate(90deg)',
  },
  
  '.cm-details-content': {
    padding: '12px 16px',
    borderTop: `1px solid ${colors.border}`,
  },
  
  '.cm-details-source': {
    backgroundColor: `${colors.muted}30`,
  },
  
  // === Callouts/Admonitions ===
  
  '.cm-callout': {
    display: 'block',
    margin: '12px 0',
    padding: '12px 16px',
    borderRadius: '4px',
  },
  
  '.cm-callout-header': {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontWeight: '600',
  },
  
  '.cm-callout-icon': {
    fontSize: '1.1em',
  },
  
  '.cm-callout-title': {
    flex: '1',
  },
  
  '.cm-callout-fold': {
    cursor: 'pointer',
    opacity: '0.7',
    transition: 'opacity 150ms ease',
    '&:hover': {
      opacity: '1',
    },
  },
  
  '.cm-callout-content': {
    marginTop: '8px',
    lineHeight: '1.6',
  },
  
  '.cm-callout-source': {
    backgroundColor: `${colors.muted}30`,
    borderLeft: `3px solid ${colors.mutedForeground}`,
    paddingLeft: '12px',
  },
  
  // Hidden lines for multi-line advanced blocks (details/callout when not editing)
  '.cm-advanced-block-hidden': {
    display: 'none !important',
    height: '0 !important',
    overflow: 'hidden !important',
    margin: '0 !important',
    padding: '0 !important',
  },
  
  // Source mode for new elements
  '.cm-superscript-source, .cm-subscript-source, .cm-kbd-source, .cm-footnoteref-source, .cm-embed-source, .cm-mark-source': {
    color: 'var(--muted-foreground, #6b7280)',
    opacity: '0.6',
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
