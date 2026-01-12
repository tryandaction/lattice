/**
 * Advanced Block Plugin for Live Preview
 * Handles advanced markdown features:
 * - <details>/<summary> collapsible content
 * - Callouts/Admonitions (> [!NOTE], > [!WARNING], etc.)
 * - Footnotes
 * - Embedded content (![[file]])
 * 
 * Requirements: Enhanced markdown rendering
 */

import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  WidgetType,
  EditorView,
} from '@codemirror/view';
import { RangeSetBuilder, StateField, EditorState } from '@codemirror/state';
import { shouldRevealLine } from './cursor-context-plugin';

/**
 * Callout types with icons and colors
 */
const CALLOUT_TYPES: Record<string, { icon: string; color: string; bgColor: string }> = {
  note: { icon: '📝', color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.1)' },
  info: { icon: 'ℹ️', color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.1)' },
  tip: { icon: '💡', color: '#10b981', bgColor: 'rgba(16, 185, 129, 0.1)' },
  hint: { icon: '💡', color: '#10b981', bgColor: 'rgba(16, 185, 129, 0.1)' },
  important: { icon: '❗', color: '#8b5cf6', bgColor: 'rgba(139, 92, 246, 0.1)' },
  warning: { icon: '⚠️', color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.1)' },
  caution: { icon: '⚠️', color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.1)' },
  danger: { icon: '🔴', color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.1)' },
  error: { icon: '❌', color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.1)' },
  bug: { icon: '🐛', color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.1)' },
  example: { icon: '📋', color: '#8b5cf6', bgColor: 'rgba(139, 92, 246, 0.1)' },
  quote: { icon: '💬', color: '#6b7280', bgColor: 'rgba(107, 114, 128, 0.1)' },
  cite: { icon: '📖', color: '#6b7280', bgColor: 'rgba(107, 114, 128, 0.1)' },
  abstract: { icon: '📄', color: '#06b6d4', bgColor: 'rgba(6, 182, 212, 0.1)' },
  summary: { icon: '📄', color: '#06b6d4', bgColor: 'rgba(6, 182, 212, 0.1)' },
  tldr: { icon: '📄', color: '#06b6d4', bgColor: 'rgba(6, 182, 212, 0.1)' },
  success: { icon: '✅', color: '#10b981', bgColor: 'rgba(16, 185, 129, 0.1)' },
  check: { icon: '✅', color: '#10b981', bgColor: 'rgba(16, 185, 129, 0.1)' },
  done: { icon: '✅', color: '#10b981', bgColor: 'rgba(16, 185, 129, 0.1)' },
  question: { icon: '❓', color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.1)' },
  help: { icon: '❓', color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.1)' },
  faq: { icon: '❓', color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.1)' },
  failure: { icon: '❌', color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.1)' },
  fail: { icon: '❌', color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.1)' },
  missing: { icon: '❌', color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.1)' },
};


/**
 * Details/Summary collapsible widget
 */
class DetailsWidget extends WidgetType {
  constructor(
    private summaryText: string,
    private contentLines: string[],
    private isOpen: boolean,
    private from: number,
    private to: number
  ) {
    super();
  }
  
  eq(other: DetailsWidget) {
    return other.summaryText === this.summaryText && 
           other.contentLines.join('\n') === this.contentLines.join('\n') &&
           other.isOpen === this.isOpen;
  }
  
  toDOM(view: EditorView) {
    const details = document.createElement('details');
    details.className = 'cm-details-widget';
    details.open = this.isOpen;
    
    const summary = document.createElement('summary');
    summary.className = 'cm-details-summary';
    summary.textContent = this.summaryText || 'Click to expand';
    
    const content = document.createElement('div');
    content.className = 'cm-details-content';
    content.innerHTML = this.contentLines.map(line => {
      // Parse basic markdown in content
      return this.parseInlineMarkdown(line);
    }).join('<br>');
    
    details.appendChild(summary);
    details.appendChild(content);
    
    // Handle click to position cursor
    details.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: this.from, head: this.from },
        scrollIntoView: true,
      });
      view.focus();
    });
    
    return details;
  }
  
  private parseInlineMarkdown(text: string): string {
    let result = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    // Bold
    result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Code
    result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Links
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    
    return result;
  }
  
  ignoreEvent(e: Event) {
    // Allow toggle events
    return e.type !== 'dblclick';
  }
}


/**
 * Callout/Admonition widget
 * Renders > [!TYPE] callouts like Obsidian
 */
class CalloutWidget extends WidgetType {
  constructor(
    private type: string,
    private title: string,
    private contentLines: string[],
    private isFoldable: boolean,
    private isCollapsed: boolean,
    private from: number,
    private to: number
  ) {
    super();
  }
  
  eq(other: CalloutWidget) {
    return other.type === this.type && 
           other.title === this.title &&
           other.contentLines.join('\n') === this.contentLines.join('\n') &&
           other.isCollapsed === this.isCollapsed;
  }
  
  toDOM(view: EditorView) {
    const calloutInfo = CALLOUT_TYPES[this.type.toLowerCase()] || CALLOUT_TYPES.note;
    
    const container = document.createElement('div');
    container.className = `cm-callout cm-callout-${this.type.toLowerCase()}`;
    container.style.backgroundColor = calloutInfo.bgColor;
    container.style.borderLeft = `4px solid ${calloutInfo.color}`;
    container.style.borderRadius = '4px';
    container.style.padding = '12px 16px';
    container.style.margin = '8px 0';
    
    // Header with icon and title
    const header = document.createElement('div');
    header.className = 'cm-callout-header';
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.gap = '8px';
    header.style.fontWeight = '600';
    header.style.color = calloutInfo.color;
    header.style.marginBottom = this.contentLines.length > 0 ? '8px' : '0';
    
    const icon = document.createElement('span');
    icon.className = 'cm-callout-icon';
    icon.textContent = calloutInfo.icon;
    
    const titleSpan = document.createElement('span');
    titleSpan.className = 'cm-callout-title';
    titleSpan.textContent = this.title || this.type.charAt(0).toUpperCase() + this.type.slice(1);
    
    header.appendChild(icon);
    header.appendChild(titleSpan);
    
    // Fold indicator if foldable
    if (this.isFoldable) {
      const foldIcon = document.createElement('span');
      foldIcon.className = 'cm-callout-fold';
      foldIcon.textContent = this.isCollapsed ? '▶' : '▼';
      foldIcon.style.marginLeft = 'auto';
      foldIcon.style.cursor = 'pointer';
      foldIcon.style.fontSize = '0.8em';
      header.appendChild(foldIcon);
      header.style.cursor = 'pointer';
    }
    
    container.appendChild(header);
    
    // Content
    if (this.contentLines.length > 0 && !this.isCollapsed) {
      const content = document.createElement('div');
      content.className = 'cm-callout-content';
      content.style.color = 'var(--foreground, #1f2937)';
      content.innerHTML = this.contentLines.map(line => this.parseInlineMarkdown(line)).join('<br>');
      container.appendChild(content);
    }
    
    // Handle double-click to edit
    container.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: this.from, head: this.from },
        scrollIntoView: true,
      });
      view.focus();
    });
    
    return container;
  }
  
  private parseInlineMarkdown(text: string): string {
    let result = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
    result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    
    return result;
  }
  
  ignoreEvent(e: Event) {
    return e.type !== 'dblclick';
  }
}


/**
 * Footnote reference widget (inline)
 * Renders [^1] as a superscript link
 */
class FootnoteRefWidget extends WidgetType {
  constructor(
    private id: string,
    private from: number,
    private to: number
  ) {
    super();
  }
  
  eq(other: FootnoteRefWidget) {
    return other.id === this.id;
  }
  
  toDOM(view: EditorView) {
    const sup = document.createElement('sup');
    sup.className = 'cm-footnote-ref';
    
    const link = document.createElement('a');
    link.href = `#fn-${this.id}`;
    link.className = 'cm-footnote-ref-link';
    link.textContent = this.id;
    link.title = `Jump to footnote ${this.id}`;
    
    // Handle click to jump to footnote definition
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Find footnote definition in document
      const doc = view.state.doc;
      const text = doc.toString();
      const defPattern = new RegExp(`^\\[\\^${this.id}\\]:`, 'm');
      const match = text.match(defPattern);
      
      if (match && match.index !== undefined) {
        view.dispatch({
          selection: { anchor: match.index, head: match.index },
          scrollIntoView: true,
        });
        view.focus();
      }
    });
    
    sup.appendChild(link);
    return sup;
  }
  
  ignoreEvent(e: Event) {
    return e.type !== 'click';
  }
}

/**
 * Footnote definition widget
 * Renders [^1]: content as a styled footnote block
 */
class FootnoteDefWidget extends WidgetType {
  constructor(
    private id: string,
    private content: string,
    private from: number,
    private to: number
  ) {
    super();
  }
  
  eq(other: FootnoteDefWidget) {
    return other.id === this.id && other.content === this.content;
  }
  
  toDOM(view: EditorView) {
    const container = document.createElement('div');
    container.className = 'cm-footnote-def';
    container.id = `fn-${this.id}`;
    
    const label = document.createElement('span');
    label.className = 'cm-footnote-def-label';
    label.textContent = `${this.id}.`;
    
    const content = document.createElement('span');
    content.className = 'cm-footnote-def-content';
    content.innerHTML = this.parseInlineMarkdown(this.content);
    
    // Back link
    const backLink = document.createElement('a');
    backLink.className = 'cm-footnote-backlink';
    backLink.href = '#';
    backLink.textContent = ' ↩';
    backLink.title = 'Back to reference';
    backLink.addEventListener('click', (e) => {
      e.preventDefault();
      // Find reference in document
      const doc = view.state.doc;
      const text = doc.toString();
      const refPattern = new RegExp(`\\[\\^${this.id}\\](?!:)`);
      const match = text.match(refPattern);
      
      if (match && match.index !== undefined) {
        view.dispatch({
          selection: { anchor: match.index, head: match.index },
          scrollIntoView: true,
        });
        view.focus();
      }
    });
    
    container.appendChild(label);
    container.appendChild(content);
    container.appendChild(backLink);
    
    // Double-click to edit
    container.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: this.from, head: this.from },
        scrollIntoView: true,
      });
      view.focus();
    });
    
    return container;
  }
  
  private parseInlineMarkdown(text: string): string {
    let result = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
    result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    
    return result;
  }
  
  ignoreEvent(e: Event) {
    return e.type !== 'dblclick' && e.type !== 'click';
  }
}


/**
 * Embed widget for ![[file]] syntax
 * Shows embedded content preview
 */
class EmbedWidget extends WidgetType {
  constructor(
    private target: string,
    private heading?: string,
    private from: number = 0,
    private to: number = 0
  ) {
    super();
  }
  
  eq(other: EmbedWidget) {
    return other.target === this.target && other.heading === this.heading;
  }
  
  toDOM(view: EditorView) {
    const container = document.createElement('div');
    container.className = 'cm-embed-widget';
    
    // Header with file info
    const header = document.createElement('div');
    header.className = 'cm-embed-header';
    
    const icon = document.createElement('span');
    icon.className = 'cm-embed-icon';
    icon.textContent = this.getFileIcon();
    
    const title = document.createElement('span');
    title.className = 'cm-embed-title';
    title.textContent = this.heading ? `${this.target}#${this.heading}` : this.target;
    
    header.appendChild(icon);
    header.appendChild(title);
    
    // Placeholder content
    const content = document.createElement('div');
    content.className = 'cm-embed-content';
    content.textContent = `Embedded: ${this.target}`;
    
    // Open link
    const openLink = document.createElement('a');
    openLink.className = 'cm-embed-open';
    openLink.href = '#';
    openLink.textContent = 'Open →';
    openLink.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dom.dispatchEvent(new CustomEvent('wiki-link-click', {
        detail: { target: this.target, heading: this.heading },
        bubbles: true,
      }));
    });
    
    container.appendChild(header);
    container.appendChild(content);
    container.appendChild(openLink);
    
    // Double-click to edit
    container.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: this.from, head: this.from },
        scrollIntoView: true,
      });
      view.focus();
    });
    
    return container;
  }
  
  private getFileIcon(): string {
    const ext = this.target.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'md': return '📄';
      case 'pdf': return '📕';
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'webp': return '🖼️';
      case 'mp3':
      case 'wav':
      case 'ogg': return '🎵';
      case 'mp4':
      case 'webm': return '🎬';
      default: return '📎';
    }
  }
  
  ignoreEvent(e: Event) {
    return e.type !== 'dblclick' && e.type !== 'click';
  }
}

interface DecorationEntry {
  from: number;
  to: number;
  decoration: Decoration;
  isLine?: boolean;
}


/**
 * Parse details/summary blocks
 */
interface DetailsBlock {
  from: number;
  to: number;
  summaryText: string;
  contentLines: string[];
  isOpen: boolean;
}

function parseDetailsBlocks(text: string): DetailsBlock[] {
  const blocks: DetailsBlock[] = [];
  const lines = text.split('\n');
  let offset = 0;
  let inDetails = false;
  let detailsStart = 0;
  let summaryText = '';
  let contentLines: string[] = [];
  let isOpen = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = offset;
    
    if (!inDetails) {
      // Check for <details> or <details open>
      const detailsMatch = line.match(/^\s*<details(\s+open)?>/i);
      if (detailsMatch) {
        inDetails = true;
        detailsStart = lineStart;
        isOpen = !!detailsMatch[1];
        summaryText = '';
        contentLines = [];
      }
    } else {
      // Check for </details>
      if (line.match(/^\s*<\/details>/i)) {
        blocks.push({
          from: detailsStart,
          to: offset + line.length,
          summaryText,
          contentLines,
          isOpen,
        });
        inDetails = false;
      } else {
        // Check for <summary>
        const summaryMatch = line.match(/<summary>(.+?)<\/summary>/i);
        if (summaryMatch) {
          summaryText = summaryMatch[1];
        } else if (!line.match(/<\/?summary>/i)) {
          // Regular content line
          const trimmed = line.trim();
          if (trimmed) {
            contentLines.push(trimmed);
          }
        }
      }
    }
    
    offset += line.length + 1;
  }
  
  return blocks;
}

/**
 * Parse callout blocks
 * Format: > [!TYPE] Title
 *         > Content line 1
 *         > Content line 2
 */
interface CalloutBlock {
  from: number;
  to: number;
  type: string;
  title: string;
  contentLines: string[];
  isFoldable: boolean;
  isCollapsed: boolean;
}

function parseCalloutBlocks(text: string): CalloutBlock[] {
  const blocks: CalloutBlock[] = [];
  const lines = text.split('\n');
  let offset = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = offset;
    
    // Check for callout start: > [!TYPE] or > [!TYPE]- or > [!TYPE]+
    const calloutMatch = line.match(/^>\s*\[!(\w+)\]([-+])?\s*(.*)?$/);
    if (calloutMatch) {
      const type = calloutMatch[1];
      const foldIndicator = calloutMatch[2];
      const title = calloutMatch[3] || '';
      const isFoldable = !!foldIndicator;
      const isCollapsed = foldIndicator === '-';
      const contentLines: string[] = [];
      
      // Collect continuation lines
      let j = i + 1;
      let blockEnd = lineStart + line.length;
      
      while (j < lines.length) {
        const nextLine = lines[j];
        // Check if it's a continuation (starts with >)
        if (nextLine.match(/^>\s?/)) {
          const content = nextLine.replace(/^>\s?/, '').trim();
          if (content) {
            contentLines.push(content);
          }
          blockEnd += nextLine.length + 1;
          j++;
        } else {
          break;
        }
      }
      
      blocks.push({
        from: lineStart,
        to: blockEnd,
        type,
        title,
        contentLines,
        isFoldable,
        isCollapsed,
      });
      
      // Skip processed lines
      i = j - 1;
    }
    
    offset += line.length + 1;
  }
  
  return blocks;
}


/**
 * Build advanced block decorations
 */
function buildAdvancedBlockDecorations(state: EditorState): DecorationSet {
  const decorations: DecorationEntry[] = [];
  const doc = state.doc;
  const text = doc.toString();
  
  // Parse details blocks
  const detailsBlocks = parseDetailsBlocks(text);
  for (const block of detailsBlocks) {
    const startLine = doc.lineAt(block.from).number;
    const endLine = doc.lineAt(block.to).number;
    
    // Check if any line is being edited
    let shouldReveal = false;
    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      if (shouldRevealLine(state, lineNum)) {
        shouldReveal = true;
        break;
      }
    }
    
    if (!shouldReveal) {
      decorations.push({
        from: block.from,
        to: block.to,
        decoration: Decoration.replace({
          widget: new DetailsWidget(
            block.summaryText,
            block.contentLines,
            block.isOpen,
            block.from,
            block.to
          ),
        }),
      });
    } else {
      // Add styling for editing mode
      for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
        const line = doc.line(lineNum);
        decorations.push({
          from: line.from,
          to: line.from,
          decoration: Decoration.line({ class: 'cm-details-source' }),
          isLine: true,
        });
      }
    }
  }
  
  // Parse callout blocks
  const calloutBlocks = parseCalloutBlocks(text);
  for (const block of calloutBlocks) {
    const startLine = doc.lineAt(block.from).number;
    const endLine = doc.lineAt(Math.min(block.to, doc.length - 1)).number;
    
    let shouldReveal = false;
    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      if (shouldRevealLine(state, lineNum)) {
        shouldReveal = true;
        break;
      }
    }
    
    if (!shouldReveal) {
      decorations.push({
        from: block.from,
        to: Math.min(block.to, doc.length),
        decoration: Decoration.replace({
          widget: new CalloutWidget(
            block.type,
            block.title,
            block.contentLines,
            block.isFoldable,
            block.isCollapsed,
            block.from,
            block.to
          ),
        }),
      });
    } else {
      // Add styling for editing mode
      for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
        const line = doc.line(lineNum);
        decorations.push({
          from: line.from,
          to: line.from,
          decoration: Decoration.line({ class: `cm-callout-source cm-callout-${block.type.toLowerCase()}-source` }),
          isLine: true,
        });
      }
    }
  }
  
  // Sort decorations
  decorations.sort((a, b) => {
    if (a.isLine && !b.isLine) return -1;
    if (!a.isLine && b.isLine) return 1;
    return a.from - b.from || a.to - b.to;
  });
  
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, decoration } of decorations) {
    try {
      builder.add(from, to, decoration);
    } catch (e) {
      console.warn('Invalid advanced block decoration range:', from, to, e);
    }
  }
  
  return builder.finish();
}

/**
 * Advanced block StateField
 */
const advancedBlockStateField = StateField.define<DecorationSet>({
  create(state) {
    return buildAdvancedBlockDecorations(state);
  },
  update(decorations, tr) {
    if (tr.docChanged || tr.selection) {
      return buildAdvancedBlockDecorations(tr.state);
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const advancedBlockPlugin = advancedBlockStateField;
