/**
 * Academic Theme for CodeMirror 6
 * 
 * A clean, distraction-free theme designed for academic work.
 * Features:
 * - Light, transparent background
 * - JetBrains Mono / Fira Code font
 * - Subtle active line highlighting
 * - Minimalist gutters without heavy borders
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import { EditorView } from "@codemirror/view";
import { Extension } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/**
 * Academic theme color palette
 */
const colors = {
  background: "var(--code-surface)",
  backgroundAlt: "var(--code-gutter-bg)",
  foreground: "var(--code-fg)",
  foregroundMuted: "var(--code-fg-soft)",
  activeLine: "var(--code-active-line)",
  selection: "var(--code-selection)",
  selectionFocused: "var(--code-selection-focused)",
  cursor: "var(--code-cursor)",
  gutter: "var(--code-fg-soft)",
  gutterActive: "var(--code-fg-muted)",
  border: "var(--code-border)",
  borderStrong: "var(--code-border-strong)",
  keyword: "var(--code-token-keyword)",
  string: "var(--code-token-string)",
  number: "var(--code-token-number)",
  comment: "var(--code-token-comment)",
  function: "var(--code-token-function)",
  variable: "var(--code-token-variable)",
  type: "var(--code-token-type)",
  operator: "var(--code-token-operator)",
  bracket: "var(--code-token-bracket)",
  matchingBracketBg: "color-mix(in srgb, var(--code-cursor) 14%, transparent)",
  matchingBracketOutline: "color-mix(in srgb, var(--code-cursor) 48%, transparent)",
  searchMatch: "rgba(250, 204, 21, 0.18)",
  searchMatchSelected: "rgba(250, 204, 21, 0.30)",
};

/**
 * Base editor theme styles
 */
export const academicTheme = EditorView.theme({
  // Root editor styles
  "&": {
    backgroundColor: colors.background,
    fontSize: "14px",
    color: colors.foreground,
  },
  
  // Content area
  ".cm-content": {
    fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    caretColor: colors.cursor,
    padding: "8px 0",
    color: colors.foreground,
  },
  
  // Gutters (line numbers area)
  ".cm-gutters": {
    backgroundColor: colors.backgroundAlt,
    borderRight: `1px solid ${colors.border}`,
    color: colors.gutter,
  },
  
  // Line number elements
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 12px 0 8px",
    minWidth: "40px",
  },

  ".cm-foldGutter .cm-gutterElement": {
    color: colors.gutter,
  },
  
  // Remove focus outline (Requirement 3.5)
  "&.cm-focused": {
    outline: "none",
  },
  
  // Active line highlighting (Requirement 3.3)
  ".cm-activeLine": {
    backgroundColor: colors.activeLine,
  },
  
  // Active line gutter highlighting
  ".cm-activeLineGutter": {
    backgroundColor: colors.activeLine,
    color: colors.gutterActive,
  },
  
  // Selection styling
  ".cm-selectionBackground": {
    backgroundColor: colors.selection,
  },
  
  // Focused selection styling
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor: colors.selectionFocused,
  },
  
  // Cursor styling
  ".cm-cursor": {
    borderLeftColor: colors.cursor,
    borderLeftWidth: "2px",
  },
  
  // Matching bracket highlight
  ".cm-matchingBracket": {
    backgroundColor: colors.matchingBracketBg,
    outline: `1px solid ${colors.matchingBracketOutline}`,
  },
  
  // Scrollbar styling
  ".cm-scroller": {
    fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
  },
  
  // Fold gutter
  ".cm-foldGutter": {
    width: "16px",
  },
  
  // Search match highlighting
  ".cm-searchMatch": {
    backgroundColor: colors.searchMatch,
    outline: `1px solid ${colors.matchingBracketOutline}`,
  },
  
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: colors.searchMatchSelected,
  },
});

/**
 * Syntax highlighting styles for the academic theme
 */
export const academicHighlightStyle = HighlightStyle.define([
  // Keywords (if, else, for, while, etc.)
  { tag: tags.keyword, color: colors.keyword, fontWeight: "500" },
  
  // Control flow keywords
  { tag: tags.controlKeyword, color: colors.keyword, fontWeight: "500" },
  
  // Strings
  { tag: tags.string, color: colors.string },
  
  // Numbers
  { tag: tags.number, color: colors.number },
  
  // Comments
  { tag: tags.comment, color: colors.comment, fontStyle: "italic" },
  { tag: tags.lineComment, color: colors.comment, fontStyle: "italic" },
  { tag: tags.blockComment, color: colors.comment, fontStyle: "italic" },
  
  // Functions
  { tag: tags.function(tags.variableName), color: colors.function },
  { tag: tags.definition(tags.function(tags.variableName)), color: colors.function },
  
  // Variables
  { tag: tags.variableName, color: colors.variable },
  { tag: tags.definition(tags.variableName), color: colors.variable },
  
  // Types and classes
  { tag: tags.typeName, color: colors.type },
  { tag: tags.className, color: colors.type },
  { tag: tags.namespace, color: colors.type },
  
  // Operators
  { tag: tags.operator, color: colors.operator },
  { tag: tags.compareOperator, color: colors.operator },
  { tag: tags.arithmeticOperator, color: colors.operator },
  { tag: tags.logicOperator, color: colors.operator },
  
  // Brackets and punctuation
  { tag: tags.bracket, color: colors.bracket },
  { tag: tags.paren, color: colors.bracket },
  { tag: tags.squareBracket, color: colors.bracket },
  { tag: tags.brace, color: colors.bracket },
  { tag: tags.punctuation, color: colors.bracket },
  
  // Property names
  { tag: tags.propertyName, color: colors.function },
  
  // Boolean and null
  { tag: tags.bool, color: colors.number },
  { tag: tags.null, color: colors.number },
  
  // Special identifiers
  { tag: tags.self, color: colors.keyword },
  { tag: tags.special(tags.variableName), color: colors.keyword },
  
  // Decorators (Python)
  { tag: tags.meta, color: colors.keyword },
  
  // Headings (Markdown)
  { tag: tags.heading, color: colors.keyword, fontWeight: "bold" },
  { tag: tags.heading1, color: colors.keyword, fontWeight: "bold", fontSize: "1.5em" },
  { tag: tags.heading2, color: colors.keyword, fontWeight: "bold", fontSize: "1.3em" },
  { tag: tags.heading3, color: colors.keyword, fontWeight: "bold", fontSize: "1.1em" },
  
  // Links (Markdown)
  { tag: tags.link, color: colors.function, textDecoration: "underline" },
  { tag: tags.url, color: colors.function },
  
  // Emphasis (Markdown)
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  
  // Code (Markdown)
  { tag: tags.monospace, fontFamily: "'JetBrains Mono', monospace" },
]);

/**
 * Complete academic theme extension
 * Combines base theme with syntax highlighting
 */
export const academicThemeExtension: Extension = [
  academicTheme,
  syntaxHighlighting(academicHighlightStyle),
];

export default academicThemeExtension;
