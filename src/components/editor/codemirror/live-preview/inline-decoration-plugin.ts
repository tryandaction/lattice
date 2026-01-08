/**
 * Inline Decoration Plugin for Live Preview
 * Renders inline markdown elements with cursor-aware reveal
 * 
 * Requirements: 2.1-2.9
 * 
 * This plugin provides Obsidian-like live preview editing:
 * - When cursor is NOT on a line, markdown is rendered (syntax hidden)
 * - When cursor IS on a line, raw markdown syntax is shown for editing
 */

import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  WidgetType,
  EditorView,
} from '@codemirror/view';
import { RangeSetBuilder, RangeSet } from '@codemirror/state';
import { shouldRevealAt, shouldRevealLine } from './cursor-context-plugin';
import type { MarkdownElement } from './types';

/**
 * Empty widget to hide syntax markers
 */
class HiddenWidget extends WidgetType {
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-hidden-syntax';
    span.style.display = 'none';
    return span;
  }
  
  ignoreEvent() {
    return false;
  }
  
  eq() {
    return true;
  }
}

/**
 * Styled text widget - renders formatted text inline
 */
class StyledTextWidget extends WidgetType {
  constructor(
    private text: string,
    private className: string
  ) {
    super();
  }
  
  eq(other: StyledTextWidget) {
    return other.text === this.text && other.className === this.className;
  }
  
  toDOM() {
    const span = document.createElement('span');
    span.className = this.className;
    span.textContent = this.text;
    return span;
  }
  
  ignoreEvent() {
    return false;
  }
}

/**
 * Link widget for rendered links
 */
class LinkWidget extends WidgetType {
  constructor(
    private text: string,
    private url: string,
    private isWikiLink: boolean = false
  ) {
    super();
  }
  
  eq(other: LinkWidget) {
    return other.text === this.text && other.url === this.url && other.isWikiLink === this.isWikiLink;
  }
  
  toDOM(view: EditorView) {
    const link = document.createElement('a');
    link.className = this.isWikiLink ? 'cm-wiki-link' : 'cm-link';
    link.textContent = this.text;
    link.href = this.isWikiLink ? '#' : this.url;
    link.title = this.isWikiLink ? `Link to: ${this.url}` : this.url;
    
    // Handle Ctrl+Click
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        if (this.isWikiLink) {
          // Dispatch custom event for wiki link navigation
          view.dom.dispatchEvent(new CustomEvent('wiki-link-click', {
            detail: { target: this.url },
            bubbles: true,
          }));
        } else {
          window.open(this.url, '_blank', 'noopener,noreferrer');
        }
      }
    });
    
    return link;
  }
  
  ignoreEvent(e: Event) {
    return e.type !== 'click';
  }
}

/**
 * Image widget for rendered images
 */
class ImageWidget extends WidgetType {
  constructor(
    private alt: string,
    private url: string,
    private width?: number
  ) {
    super();
  }
  
  eq(other: ImageWidget) {
    return other.alt === this.alt && other.url === this.url && other.width === this.width;
  }
  
  toDOM() {
    const container = document.createElement('span');
    container.className = 'cm-image-container';
    
    const img = document.createElement('img');
    img.className = 'cm-image';
    img.src = this.url;
    img.alt = this.alt;
    if (this.width) {
      img.style.width = `${this.width}px`;
    }
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.display = 'inline-block';
    img.style.verticalAlign = 'middle';
    
    // Error handling
    img.onerror = () => {
      img.style.display = 'none';
      const errorSpan = document.createElement('span');
      errorSpan.className = 'cm-image-error';
      errorSpan.textContent = `[Image not found: ${this.alt}]`;
      container.appendChild(errorSpan);
    };
    
    container.appendChild(img);
    return container;
  }
  
  ignoreEvent() {
    return true;
  }
}

/**
 * Decoration entry for sorting
 */
interface DecorationEntry {
  from: number;
  to: number;
  decoration: Decoration;
}

/**
 * Parse inline elements from a line of text
 * Returns elements sorted by position
 */
function parseLineInlineElements(lineText: string, lineFrom: number): MarkdownElement[] {
  const elements: MarkdownElement[] = [];
  
  // Skip if line starts with code fence
  if (lineText.startsWith('```')) return elements;
  
  // Bold: **text** or __text__
  const boldRegex = /(\*\*|__)(.+?)\1/g;
  let match;
  while ((match = boldRegex.exec(lineText)) !== null) {
    const markerLen = match[1].length;
    elements.push({
      type: 'bold',
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      syntaxFrom: lineFrom + match.index,
      syntaxTo: lineFrom + match.index + markerLen,
      contentFrom: lineFrom + match.index + markerLen,
      contentTo: lineFrom + match.index + match[0].length - markerLen,
      content: match[2],
    });
  }
  
  // Italic: *text* or _text_ (not inside bold markers)
  // Use negative lookbehind/lookahead to avoid matching bold markers
  const italicRegex = /(?<![*_])([*_])(?![*_])(.+?)(?<![*_])\1(?![*_])/g;
  while ((match = italicRegex.exec(lineText)) !== null) {
    const from = lineFrom + match.index;
    const to = lineFrom + match.index + match[0].length;
    // Check if this overlaps with any bold element
    const overlapsWithBold = elements.some(e => 
      e.type === 'bold' && from >= e.from && to <= e.to
    );
    if (!overlapsWithBold) {
      elements.push({
        type: 'italic',
        from,
        to,
        syntaxFrom: from,
        syntaxTo: from + 1,
        contentFrom: from + 1,
        contentTo: to - 1,
        content: match[2],
      });
    }
  }
  
  // Strikethrough: ~~text~~
  const strikeRegex = /~~(.+?)~~/g;
  while ((match = strikeRegex.exec(lineText)) !== null) {
    elements.push({
      type: 'strikethrough',
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      syntaxFrom: lineFrom + match.index,
      syntaxTo: lineFrom + match.index + 2,
      contentFrom: lineFrom + match.index + 2,
      contentTo: lineFrom + match.index + match[0].length - 2,
      content: match[1],
    });
  }
  
  // Highlight: ==text==
  const highlightRegex = /==(.+?)==/g;
  while ((match = highlightRegex.exec(lineText)) !== null) {
    elements.push({
      type: 'highlight',
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      syntaxFrom: lineFrom + match.index,
      syntaxTo: lineFrom + match.index + 2,
      contentFrom: lineFrom + match.index + 2,
      contentTo: lineFrom + match.index + match[0].length - 2,
      content: match[1],
    });
  }
  
  // Inline code: `code` (but not ```)
  const codeRegex = /(?<!`)`(?!`)([^`]+)`(?!`)/g;
  while ((match = codeRegex.exec(lineText)) !== null) {
    elements.push({
      type: 'code',
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      syntaxFrom: lineFrom + match.index,
      syntaxTo: lineFrom + match.index + 1,
      contentFrom: lineFrom + match.index + 1,
      contentTo: lineFrom + match.index + match[0].length - 1,
      content: match[1],
    });
  }
  
  // Links: [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  while ((match = linkRegex.exec(lineText)) !== null) {
    elements.push({
      type: 'link',
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      syntaxFrom: lineFrom + match.index,
      syntaxTo: lineFrom + match.index + match[0].length,
      contentFrom: lineFrom + match.index + 1,
      contentTo: lineFrom + match.index + 1 + match[1].length,
      content: match[1],
      extra: { url: match[2] },
    });
  }
  
  // Wiki links: [[target]] or [[target|alias]] or [[target#heading]]
  const wikiLinkRegex = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
  while ((match = wikiLinkRegex.exec(lineText)) !== null) {
    const target = match[1];
    const heading = match[2];
    const alias = match[3];
    elements.push({
      type: 'wikilink',
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      syntaxFrom: lineFrom + match.index,
      syntaxTo: lineFrom + match.index + match[0].length,
      contentFrom: lineFrom + match.index + 2,
      contentTo: lineFrom + match.index + match[0].length - 2,
      content: alias || target,
      extra: { target, heading, alias },
    });
  }
  
  // Images: ![alt](url) or ![alt|width](url)
  const imageRegex = /!\[([^\]|]*?)(?:\|(\d+))?\]\(([^)]+)\)/g;
  while ((match = imageRegex.exec(lineText)) !== null) {
    elements.push({
      type: 'image',
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
      syntaxFrom: lineFrom + match.index,
      syntaxTo: lineFrom + match.index + match[0].length,
      contentFrom: lineFrom + match.index + 2,
      contentTo: lineFrom + match.index + 2 + match[1].length,
      content: match[1],
      extra: { url: match[3], width: match[2] ? parseInt(match[2]) : undefined },
    });
  }
  
  // Sort by position
  return elements.sort((a, b) => a.from - b.from);
}

/**
 * Build decorations for inline elements
 * Uses line-based reveal logic for Obsidian-like behavior
 */
function buildInlineDecorations(view: EditorView): DecorationSet {
  const decorations: DecorationEntry[] = [];
  const doc = view.state.doc;
  
  // Process visible ranges for performance
  for (const { from, to } of view.visibleRanges) {
    const startLine = doc.lineAt(from);
    const endLine = doc.lineAt(to);
    
    for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
      const line = doc.line(lineNum);
      const lineText = line.text;
      
      // Skip empty lines
      if (!lineText.trim()) continue;
      
      // Check if this line should reveal syntax (cursor is on this line)
      const lineRevealed = shouldRevealLine(view.state, lineNum);
      
      // Parse inline elements for this line
      const elements = parseLineInlineElements(lineText, line.from);
      
      for (const element of elements) {
        if (lineRevealed) {
          // Line is being edited - show raw markdown with subtle styling
          // Just add a subtle background to indicate it's a markdown element
          decorations.push({
            from: element.from,
            to: element.to,
            decoration: Decoration.mark({ class: `cm-${element.type}-source` }),
          });
        } else {
          // Line is not being edited - render the formatted content
          addRenderedDecoration(decorations, element);
        }
      }
    }
  }
  
  // Sort decorations by position (required by CodeMirror)
  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  
  // Build the decoration set
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, decoration } of decorations) {
    try {
      builder.add(from, to, decoration);
    } catch (e) {
      // Skip invalid ranges
      console.warn('Invalid decoration range:', from, to, e);
    }
  }
  
  return builder.finish();
}

/**
 * Add rendered decoration for a markdown element
 * Hides syntax markers and applies formatting
 */
function addRenderedDecoration(
  decorations: DecorationEntry[],
  element: MarkdownElement
) {
  switch (element.type) {
    case 'bold':
      // Hide opening markers **
      decorations.push({
        from: element.from,
        to: element.contentFrom,
        decoration: Decoration.replace({ widget: new HiddenWidget() }),
      });
      // Style content as bold
      decorations.push({
        from: element.contentFrom,
        to: element.contentTo,
        decoration: Decoration.mark({ class: 'cm-bold' }),
      });
      // Hide closing markers **
      decorations.push({
        from: element.contentTo,
        to: element.to,
        decoration: Decoration.replace({ widget: new HiddenWidget() }),
      });
      break;
      
    case 'italic':
      // Hide opening marker *
      decorations.push({
        from: element.from,
        to: element.contentFrom,
        decoration: Decoration.replace({ widget: new HiddenWidget() }),
      });
      // Style content as italic
      decorations.push({
        from: element.contentFrom,
        to: element.contentTo,
        decoration: Decoration.mark({ class: 'cm-italic' }),
      });
      // Hide closing marker *
      decorations.push({
        from: element.contentTo,
        to: element.to,
        decoration: Decoration.replace({ widget: new HiddenWidget() }),
      });
      break;
      
    case 'strikethrough':
      // Hide opening markers ~~
      decorations.push({
        from: element.from,
        to: element.contentFrom,
        decoration: Decoration.replace({ widget: new HiddenWidget() }),
      });
      // Style content as strikethrough
      decorations.push({
        from: element.contentFrom,
        to: element.contentTo,
        decoration: Decoration.mark({ class: 'cm-strikethrough' }),
      });
      // Hide closing markers ~~
      decorations.push({
        from: element.contentTo,
        to: element.to,
        decoration: Decoration.replace({ widget: new HiddenWidget() }),
      });
      break;
      
    case 'highlight':
      // Hide opening markers ==
      decorations.push({
        from: element.from,
        to: element.contentFrom,
        decoration: Decoration.replace({ widget: new HiddenWidget() }),
      });
      // Style content as highlight
      decorations.push({
        from: element.contentFrom,
        to: element.contentTo,
        decoration: Decoration.mark({ class: 'cm-highlight' }),
      });
      // Hide closing markers ==
      decorations.push({
        from: element.contentTo,
        to: element.to,
        decoration: Decoration.replace({ widget: new HiddenWidget() }),
      });
      break;
      
    case 'code':
      // Hide opening backtick
      decorations.push({
        from: element.from,
        to: element.contentFrom,
        decoration: Decoration.replace({ widget: new HiddenWidget() }),
      });
      // Style content as inline code
      decorations.push({
        from: element.contentFrom,
        to: element.contentTo,
        decoration: Decoration.mark({ class: 'cm-inline-code' }),
      });
      // Hide closing backtick
      decorations.push({
        from: element.contentTo,
        to: element.to,
        decoration: Decoration.replace({ widget: new HiddenWidget() }),
      });
      break;
      
    case 'link':
      // Replace entire link with widget
      decorations.push({
        from: element.from,
        to: element.to,
        decoration: Decoration.replace({
          widget: new LinkWidget(
            element.content,
            (element.extra?.url as string) || '#',
            false
          ),
        }),
      });
      break;
      
    case 'wikilink':
      // Replace entire wiki link with widget
      decorations.push({
        from: element.from,
        to: element.to,
        decoration: Decoration.replace({
          widget: new LinkWidget(
            element.content,
            (element.extra?.target as string) || '',
            true
          ),
        }),
      });
      break;
      
    case 'image':
      // Replace entire image syntax with widget
      decorations.push({
        from: element.from,
        to: element.to,
        decoration: Decoration.replace({
          widget: new ImageWidget(
            element.content,
            (element.extra?.url as string) || '',
            element.extra?.width as number | undefined
          ),
        }),
      });
      break;
  }
}

/**
 * Inline decoration view plugin
 */
export const inlineDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    
    constructor(view: EditorView) {
      this.decorations = buildInlineDecorations(view);
    }
    
    update(update: ViewUpdate) {
      // Rebuild decorations on any change that might affect rendering
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildInlineDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

export { parseLineInlineElements };
