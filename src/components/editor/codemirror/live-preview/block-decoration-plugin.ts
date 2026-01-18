/**
 * Block Decoration Plugin for Live Preview
 * Handles headings, blockquotes, lists, and horizontal rules
 * 
 * Requirements: 3.1-3.7
 * 
 * This plugin provides Obsidian-like live preview for block elements:
 * - When cursor is NOT on a line, block elements are rendered (syntax hidden)
 * - When cursor IS on a line, raw markdown syntax is shown for editing
 * 
 * Key design: Use widget replacement for complete syntax hiding
 */

import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  WidgetType,
  EditorView,
} from '@codemirror/view';
import { shouldRevealLine } from './cursor-context-plugin';
import { parseListItem, parseBlockquote } from './markdown-parser';

/**
 * Decoration entry for sorting
 */
interface DecorationEntry {
  from: number;
  to: number;
  decoration: Decoration;
  isLine?: boolean;
}

// KaTeX for inline math in headings
let katexForHeading: any = null;
import('katex').then((mod) => {
  katexForHeading = mod.default || mod;
}).catch(() => {});

/**
 * Heading content widget - renders heading text without # markers
 * Supports inline LaTeX math rendering
 */
class HeadingContentWidget extends WidgetType {
  constructor(
    private content: string,
    private level: number,
    private originalFrom: number,
    private originalTo: number
  ) {
    super();
  }
  
  eq(other: HeadingContentWidget) {
    return other.content === this.content && other.level === this.level;
  }
  
  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = `cm-heading-content cm-heading-${this.level}-content`;
    span.dataset.from = String(this.originalFrom);
    span.dataset.to = String(this.originalTo);
    
    // Render content with inline math support
    this.renderContentWithMath(span);
    
    // Handle click to position cursor
    span.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Position cursor at the start of heading content
      view.dispatch({
        selection: { anchor: this.originalFrom, head: this.originalFrom },
        scrollIntoView: true,
      });
      view.focus();
    });
    
    return span;
  }
  
  /**
   * Render content with inline math support
   */
  private renderContentWithMath(container: HTMLElement) {
    // Split content by inline math patterns $...$
    const parts = this.content.split(/(\$[^$\n]+\$)/g);
    
    for (const part of parts) {
      if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
        // This is inline math
        const latex = part.slice(1, -1);
        const mathSpan = document.createElement('span');
        mathSpan.className = 'cm-math-inline';
        
        if (katexForHeading) {
          try {
            katexForHeading.render(latex, mathSpan, {
              displayMode: false,
              throwOnError: false,
              errorColor: '#ef4444',
              trust: true,
            });
          } catch {
            mathSpan.textContent = part;
          }
        } else {
          mathSpan.textContent = part;
          // Try to render when KaTeX loads
          import('katex').then((mod) => {
            const k = mod.default || mod;
            katexForHeading = k;
            try {
              mathSpan.innerHTML = '';
              k.render(latex, mathSpan, {
                displayMode: false,
                throwOnError: false,
                errorColor: '#ef4444',
                trust: true,
              });
            } catch {
              mathSpan.textContent = part;
            }
          }).catch(() => {});
        }
        container.appendChild(mathSpan);
      } else if (part) {
        // Regular text
        container.appendChild(document.createTextNode(part));
      }
    }
  }
  
  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
  }
}

/**
 * List bullet widget - renders a styled bullet/number/checkbox
 */
class ListBulletWidget extends WidgetType {
  constructor(
    private type: 'bullet' | 'numbered' | 'task', 
    private marker: string, 
    private checked?: boolean,
    private lineFrom?: number
  ) {
    super();
  }
  
  eq(other: ListBulletWidget) {
    return other.type === this.type && 
           other.marker === this.marker && 
           other.checked === this.checked;
  }
  
  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'cm-list-marker';
    
    if (this.type === 'task') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = this.checked || false;
      checkbox.className = 'cm-task-checkbox';
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        // Toggle checkbox state in document
        if (this.lineFrom !== undefined) {
          const line = view.state.doc.lineAt(this.lineFrom);
          const lineText = line.text;
          const newText = this.checked
            ? lineText.replace(/\[x\]/i, '[ ]')
            : lineText.replace(/\[ \]/, '[x]');
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: newText },
          });
        }
      });
      span.appendChild(checkbox);
    } else if (this.type === 'bullet') {
      span.textContent = '•';
      span.style.marginRight = '0.5em';
    } else {
      // Numbered - keep the number
      span.textContent = this.marker;
    }
    
    return span;
  }
  
  ignoreEvent(e: Event) {
    return e.type !== 'click';
  }
}

/**
 * Horizontal rule widget - renders a full-width horizontal line
 */
class HorizontalRuleWidget extends WidgetType {
  constructor(private originalFrom: number, private originalTo: number) {
    super();
  }
  
  toDOM(view: EditorView) {
    // Use a container div to ensure full width
    const container = document.createElement('div');
    container.className = 'cm-horizontal-rule-container';
    container.style.width = '100%';
    container.style.padding = '1em 0';
    container.style.cursor = 'pointer';
    
    const hr = document.createElement('hr');
    hr.className = 'cm-horizontal-rule';
    hr.style.border = 'none';
    hr.style.borderTop = '2px solid var(--border, #e5e7eb)';
    hr.style.margin = '0';
    hr.style.width = '100%';
    
    container.appendChild(hr);
    
    // Handle click to position cursor
    container.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: this.originalFrom, head: this.originalFrom },
        scrollIntoView: true,
      });
      view.focus();
    });
    
    return container;
  }
  
  eq() { return true; }
  
  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
  }
}

/**
 * Blockquote content widget - renders quote content without > marker
 */
class BlockquoteContentWidget extends WidgetType {
  constructor(
    private content: string,
    private originalFrom: number,
    private originalTo: number
  ) {
    super();
  }
  
  eq(other: BlockquoteContentWidget) {
    return other.content === this.content;
  }
  
  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'cm-blockquote-content';
    span.textContent = this.content;
    span.dataset.from = String(this.originalFrom);
    span.dataset.to = String(this.originalTo);
    
    // Handle click to position cursor
    span.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const rect = span.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const textWidth = rect.width;
      const textLength = this.content.length;
      
      let charOffset = Math.round((clickX / textWidth) * textLength);
      charOffset = Math.max(0, Math.min(charOffset, textLength));
      
      const pos = this.originalFrom + charOffset;
      
      view.dispatch({
        selection: { anchor: pos, head: pos },
        scrollIntoView: true,
      });
      view.focus();
    });
    
    return span;
  }
  
  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
  }
}

/**
 * Build block decorations
 * Uses line-based reveal logic for Obsidian-like behavior
 */
function buildBlockDecorations(view: EditorView): DecorationSet {
  const decorations: DecorationEntry[] = [];
  const doc = view.state.doc;

  // Process ALL lines (not just viewport) to ensure decorations persist
  // Viewport-only optimization causes decorations to disappear when scrolling
  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    const line = doc.line(lineNum);
    const lineText = line.text;

    // Skip empty lines
    if (!lineText.trim()) continue;

    // Check if this line should reveal syntax
    const lineRevealed = shouldRevealLine(view.state, lineNum);

    // Headings: # ## ### etc.
    const headingMatch = lineText.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const markerEnd = line.from + headingMatch[1].length + 1; // +1 for space

      // Always add heading style to the line
      decorations.push({
        from: line.from,
        to: line.from,
        decoration: Decoration.line({ class: `cm-heading cm-heading-${level}` }),
        isLine: true,
      });
      
      // Hide # markers when not revealed - replace with content widget
      if (!lineRevealed && content) {
        // Replace the entire line content with a heading widget
        decorations.push({
          from: line.from,
          to: line.to,
          decoration: Decoration.replace({
            widget: new HeadingContentWidget(content, level, markerEnd, line.to),
          }),
        });
      }
      continue;
    }
    
    // Horizontal rules: --- or *** or ___
    if (/^([-*_])\1{2,}\s*$/.test(lineText)) {
      if (!lineRevealed) {
        decorations.push({
          from: line.from,
          to: line.to,
          decoration: Decoration.replace({ 
            widget: new HorizontalRuleWidget(line.from, line.to) 
          }),
        });
      }
      continue;
    }
    
    // Blockquotes: > text
    const blockquote = parseBlockquote(lineText, line.from);
    if (blockquote) {
      // Always add blockquote style
      decorations.push({
        from: line.from,
        to: line.from,
        decoration: Decoration.line({ class: 'cm-blockquote' }),
        isLine: true,
      });
      
      // Hide > marker when not revealed - replace with content widget
      if (!lineRevealed) {
        const content = lineText.slice(blockquote.markerTo - line.from);
        if (content) {
          decorations.push({
            from: line.from,
            to: line.to,
            decoration: Decoration.replace({
              widget: new BlockquoteContentWidget(content, blockquote.markerTo, line.to),
            }),
          });
        }
      }
      continue;
    }
    
    // Lists: - * + or 1. or - [ ]
    const listItem = parseListItem(lineText, line.from);
    if (listItem) {
      // Always add list item style
      decorations.push({
        from: line.from,
        to: line.from,
        decoration: Decoration.line({ 
          class: `cm-list-item cm-list-${listItem.type}`,
          attributes: { 'data-indent': String(listItem.indent) },
        }),
        isLine: true,
      });
      
      // Replace marker with styled widget when not revealed
      if (!lineRevealed) {
        decorations.push({
          from: listItem.markerFrom,
          to: listItem.markerTo,
          decoration: Decoration.replace({
            widget: new ListBulletWidget(
              listItem.type, 
              listItem.marker, 
              listItem.checked,
              line.from
            ),
          }),
        });
      }
    }
  }

  // Sort decorations: line decorations first at same position, then by from/to
  decorations.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    // Line decorations (point decorations) come before range decorations at same position
    if (a.isLine && !b.isLine) return -1;
    if (!a.isLine && b.isLine) return 1;
    return a.to - b.to;
  });
  
  // Convert to Range format
  // Line decorations (isLine=true) only need from position
  // Replace/Mark decorations need both from and to
  const ranges = decorations.map(d => {
    if (d.isLine) {
      return d.decoration.range(d.from);
    }
    return d.decoration.range(d.from, d.to);
  });
  
  // Decoration.set requires sorted ranges, pass true to indicate they are sorted
  return Decoration.set(ranges, true);
}

/**
 * Block decoration view plugin
 */
export const blockDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    
    constructor(view: EditorView) {
      this.decorations = buildBlockDecorations(view);
    }

    update(update: ViewUpdate) {
      // Rebuild decorations when:
      // 1. Document changes (text edited)
      // 2. Selection changes (cursor moved - affects which lines reveal syntax)
      // 3. Viewport changes (scrolling)
      // Note: cursor context plugin calls requestMeasure() which triggers update
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildBlockDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
