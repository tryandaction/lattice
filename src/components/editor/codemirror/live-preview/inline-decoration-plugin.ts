/**
 * Inline Decoration Plugin for Live Preview
 * Renders inline markdown elements with cursor-aware reveal
 * 
 * Requirements: 2.1-2.9
 * 
 * This plugin provides Obsidian-like live preview editing:
 * - When cursor is NOT on a line, markdown is rendered (syntax hidden)
 * - When cursor IS on a line, raw markdown syntax is shown for editing
 * 
 * Key design decisions for Obsidian-like behavior:
 * - Use atomic ranges to hide syntax markers completely
 * - Ensure cursor position accuracy by using proper decoration types
 * - Handle click events to position cursor correctly
 * 
 * Performance optimizations:
 * - Line-level parsing cache to avoid re-parsing unchanged lines
 * - Only process visible ranges (CodeMirror virtualization)
 * - Debounced updates for rapid typing
 */

import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  WidgetType,
  EditorView,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { shouldRevealLine } from './cursor-context-plugin';
import type { MarkdownElement } from './types';

/**
 * Line parsing cache for performance optimization
 * Caches parsed elements by line content hash to avoid re-parsing unchanged lines
 */
const lineParseCache = new Map<string, MarkdownElement[]>();
const MAX_CACHE_SIZE = 500;

function getCachedLineElements(lineText: string, lineFrom: number): MarkdownElement[] {
  const cacheKey = lineText;
  
  if (lineParseCache.has(cacheKey)) {
    // Return cached elements with adjusted positions
    const cached = lineParseCache.get(cacheKey)!;
    // Clone and adjust positions if lineFrom differs
    return cached.map(el => ({
      ...el,
      from: el.from - el.syntaxFrom + lineFrom + (el.syntaxFrom - el.from),
      to: el.to - el.syntaxFrom + lineFrom + (el.syntaxFrom - el.from),
      syntaxFrom: lineFrom + (el.syntaxFrom - cached[0]?.from || 0),
      syntaxTo: lineFrom + (el.syntaxTo - cached[0]?.from || 0),
      contentFrom: lineFrom + (el.contentFrom - cached[0]?.from || 0),
      contentTo: lineFrom + (el.contentTo - cached[0]?.from || 0),
    }));
  }
  
  // Parse and cache
  const elements = parseLineInlineElementsInternal(lineText, lineFrom);
  
  // Manage cache size
  if (lineParseCache.size >= MAX_CACHE_SIZE) {
    // Remove oldest entries (first 100)
    const keysToDelete = Array.from(lineParseCache.keys()).slice(0, 100);
    keysToDelete.forEach(key => lineParseCache.delete(key));
  }
  
  // Store with position 0 for reusability
  const normalizedElements = parseLineInlineElementsInternal(lineText, 0);
  lineParseCache.set(cacheKey, normalizedElements);
  
  return elements;
}

/**
 * Link widget for rendered links
 * Supports precise cursor positioning within link text
 */
class LinkWidget extends WidgetType {
  constructor(
    private text: string,
    private url: string,
    private isWikiLink: boolean = false,
    private contentFrom: number = 0,  // Link text start position
    private contentTo: number = 0,    // Link text end position
    private elementFrom: number = 0,  // Full syntax start
    private elementTo: number = 0     // Full syntax end
  ) {
    super();
  }
  
  eq(other: LinkWidget) {
    return other.text === this.text && other.url === this.url && other.isWikiLink === this.isWikiLink;
  }
  
  toDOM(view: EditorView) {
    const link = document.createElement('a');
    link.className = `${this.isWikiLink ? 'cm-wiki-link' : 'cm-link'} cm-formatted-widget cm-syntax-transition`;
    link.textContent = this.text;
    link.href = this.isWikiLink ? '#' : this.url;
    link.title = this.isWikiLink ? `Link to: ${this.url}` : this.url;
    
    // Store positions for cursor placement
    link.dataset.contentFrom = String(this.contentFrom);
    link.dataset.contentTo = String(this.contentTo);
    link.dataset.elementFrom = String(this.elementFrom);
    link.dataset.elementTo = String(this.elementTo);
    
    // Handle click - position cursor precisely within link text
    link.addEventListener('mousedown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+Click for navigation
        e.preventDefault();
        e.stopPropagation();
        if (this.isWikiLink) {
          view.dom.dispatchEvent(new CustomEvent('wiki-link-click', {
            detail: { target: this.url },
            bubbles: true,
          }));
        } else {
          window.open(this.url, '_blank', 'noopener,noreferrer');
        }
      } else {
        // Normal click - position cursor precisely within link text
        e.preventDefault();
        e.stopPropagation();
        
        // Calculate character position based on click location
        const rect = link.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const textWidth = rect.width;
        const textLength = this.text.length;
        
        let charOffset: number;
        if (textWidth > 0 && textLength > 0) {
          const avgCharWidth = textWidth / textLength;
          charOffset = Math.round(clickX / avgCharWidth);
          charOffset = Math.max(0, Math.min(charOffset, textLength));
        } else {
          charOffset = 0;
        }
        
        // Position cursor within the link text content
        const pos = this.contentFrom + charOffset;
        
        view.dispatch({
          selection: { anchor: pos, head: pos },
          scrollIntoView: true,
        });
        view.focus();
      }
    });
    
    return link;
  }
  
  ignoreEvent(e: Event) {
    // Let mousedown through for cursor positioning
    return e.type !== 'mousedown';
  }
}

/**
 * Annotation Link Widget for rendered annotation references
 * Supports [[file.pdf#ann-uuid]] syntax for linking to PDF annotations
 * 
 * Requirements: 10.2, 10.4
 */
class AnnotationLinkWidget extends WidgetType {
  constructor(
    private displayText: string,
    private filePath: string,
    private annotationId: string,
    private contentFrom: number = 0,
    private contentTo: number = 0,
    private elementFrom: number = 0,
    private elementTo: number = 0
  ) {
    super();
  }
  
  eq(other: AnnotationLinkWidget) {
    return other.filePath === this.filePath && 
           other.annotationId === this.annotationId &&
           other.displayText === this.displayText;
  }
  
  toDOM(view: EditorView) {
    const link = document.createElement('a');
    link.className = 'cm-annotation-link cm-formatted-widget cm-syntax-transition';
    link.href = '#';
    link.title = `批注: ${this.filePath}#${this.annotationId}`;
    
    // Icon for annotation
    const icon = document.createElement('span');
    icon.className = 'cm-annotation-link-icon';
    icon.innerHTML = '📌';
    icon.style.marginRight = '2px';
    icon.style.fontSize = '0.85em';
    
    // Text content
    const text = document.createElement('span');
    text.textContent = this.displayText;
    
    link.appendChild(icon);
    link.appendChild(text);
    
    // Store positions for cursor placement
    link.dataset.contentFrom = String(this.contentFrom);
    link.dataset.contentTo = String(this.contentTo);
    link.dataset.elementFrom = String(this.elementFrom);
    link.dataset.elementTo = String(this.elementTo);
    link.dataset.filePath = this.filePath;
    link.dataset.annotationId = this.annotationId;
    
    // Handle click - navigate to annotation
    link.addEventListener('mousedown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+Click for navigation to annotation
        e.preventDefault();
        e.stopPropagation();
        view.dom.dispatchEvent(new CustomEvent('annotation-link-click', {
          detail: { 
            filePath: this.filePath, 
            annotationId: this.annotationId 
          },
          bubbles: true,
        }));
      } else {
        // Normal click - position cursor
        e.preventDefault();
        e.stopPropagation();
        
        const rect = link.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const textWidth = rect.width;
        const textLength = this.displayText.length;
        
        let charOffset: number;
        if (textWidth > 0 && textLength > 0) {
          const avgCharWidth = textWidth / textLength;
          charOffset = Math.round(clickX / avgCharWidth);
          charOffset = Math.max(0, Math.min(charOffset, textLength));
        } else {
          charOffset = 0;
        }
        
        const pos = this.contentFrom + charOffset;
        view.dispatch({
          selection: { anchor: pos, head: pos },
          scrollIntoView: true,
        });
        view.focus();
      }
    });
    
    return link;
  }
  
  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
  }
}

/**
 * Image widget for rendered images
 * Clicking on image positions cursor at the alt text
 */
class ImageWidget extends WidgetType {
  constructor(
    private alt: string,
    private url: string,
    private width?: number,
    private contentFrom: number = 0,  // Alt text start position
    private contentTo: number = 0,    // Alt text end position
    private elementFrom: number = 0,  // Full syntax start
    private elementTo: number = 0     // Full syntax end
  ) {
    super();
  }
  
  eq(other: ImageWidget) {
    return other.alt === this.alt && other.url === this.url && other.width === this.width;
  }
  
  toDOM(view: EditorView) {
    const container = document.createElement('span');
    container.className = 'cm-image-container cm-formatted-widget cm-syntax-transition';
    container.dataset.contentFrom = String(this.contentFrom);
    container.dataset.contentTo = String(this.contentTo);
    container.dataset.elementFrom = String(this.elementFrom);
    container.dataset.elementTo = String(this.elementTo);
    
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
    
    // Handle click to position cursor at alt text start
    container.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Position cursor at the start of alt text for editing
      const pos = this.contentFrom;
      view.dispatch({
        selection: { anchor: pos, head: pos },
        scrollIntoView: true,
      });
      view.focus();
    });
    
    container.appendChild(img);
    return container;
  }
  
  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
  }
}

/**
 * Formatted text widget - renders styled content with click handling
 * Used for bold, italic, strikethrough, highlight, inline code
 * 
 * Key design for Obsidian-like cursor positioning:
 * - contentFrom: position where actual content starts (after opening syntax markers)
 * - contentTo: position where actual content ends (before closing syntax markers)
 * - Click position is mapped to content range, not the full element range
 */
class FormattedTextWidget extends WidgetType {
  constructor(
    private content: string,
    private className: string,
    private contentFrom: number,  // Content start position (after opening syntax)
    private contentTo: number,    // Content end position (before closing syntax)
    private elementFrom: number,  // Full element start (including syntax)
    private elementTo: number     // Full element end (including syntax)
  ) {
    super();
  }
  
  eq(other: FormattedTextWidget) {
    return other.content === this.content && 
           other.className === this.className &&
           other.contentFrom === this.contentFrom;
  }
  
  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = `${this.className} cm-formatted-widget cm-syntax-transition`;
    span.textContent = this.content;
    span.dataset.contentFrom = String(this.contentFrom);
    span.dataset.contentTo = String(this.contentTo);
    span.dataset.elementFrom = String(this.elementFrom);
    span.dataset.elementTo = String(this.elementTo);
    
    // Handle click to position cursor correctly within content
    span.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Calculate precise character position based on click location
      const rect = span.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const textWidth = rect.width;
      const textLength = this.content.length;
      
      // Use more precise calculation with character width estimation
      // Account for variable-width fonts by using ratio-based positioning
      let charOffset: number;
      if (textWidth > 0 && textLength > 0) {
        // Calculate average character width
        const avgCharWidth = textWidth / textLength;
        // Estimate character position, rounding to nearest character
        charOffset = Math.round(clickX / avgCharWidth);
        // Clamp to valid range
        charOffset = Math.max(0, Math.min(charOffset, textLength));
      } else {
        charOffset = 0;
      }
      
      // Position cursor within the content range (not including syntax markers)
      // contentFrom points to the first character of actual content
      const pos = this.contentFrom + charOffset;
      
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
 * Decoration entry for sorting
 */
interface DecorationEntry {
  from: number;
  to: number;
  decoration: Decoration;
}

/**
 * Parse inline elements from a line of text (internal implementation)
 * Returns elements sorted by position
 * 
 * Supports nested formatting like:
 * - ***bold italic*** (粗斜体)
 * - **bold *italic* bold** (粗体中的斜体)
 * 
 * Priority: bolditalic > bold > italic (to handle *** correctly)
 */
function parseLineInlineElementsInternal(lineText: string, lineFrom: number): MarkdownElement[] {
  const elements: MarkdownElement[] = [];
  
  // Skip if line starts with code fence
  if (lineText.startsWith('```')) return elements;
  
  // Track matched ranges to avoid overlapping
  const matchedRanges: Array<{ from: number; to: number }> = [];
  
  const isOverlapping = (from: number, to: number): boolean => {
    return matchedRanges.some(range => 
      (from >= range.from && from < range.to) || 
      (to > range.from && to <= range.to) ||
      (from <= range.from && to >= range.to)
    );
  };
  
  const addMatchedRange = (from: number, to: number) => {
    matchedRanges.push({ from, to });
  };
  
  // 1. Bold Italic: ***text*** or ___text___ (highest priority)
  const boldItalicRegex = /(\*\*\*|___)(.+?)\1/g;
  let match;
  while ((match = boldItalicRegex.exec(lineText)) !== null) {
    const from = lineFrom + match.index;
    const to = lineFrom + match.index + match[0].length;
    if (!isOverlapping(from, to)) {
      elements.push({
        type: 'bolditalic',
        from,
        to,
        syntaxFrom: from,
        syntaxTo: from + 3,
        contentFrom: from + 3,
        contentTo: to - 3,
        content: match[2],
      });
      addMatchedRange(from, to);
    }
  }
  
  // 2. Bold: **text** or __text__
  const boldRegex = /(\*\*|__)(.+?)\1/g;
  while ((match = boldRegex.exec(lineText)) !== null) {
    const from = lineFrom + match.index;
    const to = lineFrom + match.index + match[0].length;
    if (!isOverlapping(from, to)) {
      elements.push({
        type: 'bold',
        from,
        to,
        syntaxFrom: from,
        syntaxTo: from + 2,
        contentFrom: from + 2,
        contentTo: to - 2,
        content: match[2],
      });
      addMatchedRange(from, to);
    }
  }
  
  // 3. Italic: *text* or _text_ (avoid matching inside bold/bolditalic)
  const italicRegex = /(?<![*_])([*_])(?![*_])(.+?)(?<![*_])\1(?![*_])/g;
  while ((match = italicRegex.exec(lineText)) !== null) {
    const from = lineFrom + match.index;
    const to = lineFrom + match.index + match[0].length;
    if (!isOverlapping(from, to)) {
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
      addMatchedRange(from, to);
    }
  }
  
  // 4. Strikethrough: ~~text~~
  const strikeRegex = /~~(.+?)~~/g;
  while ((match = strikeRegex.exec(lineText)) !== null) {
    const from = lineFrom + match.index;
    const to = lineFrom + match.index + match[0].length;
    if (!isOverlapping(from, to)) {
      elements.push({
        type: 'strikethrough',
        from,
        to,
        syntaxFrom: from,
        syntaxTo: from + 2,
        contentFrom: from + 2,
        contentTo: to - 2,
        content: match[1],
      });
      addMatchedRange(from, to);
    }
  }
  
  // 5. Highlight: ==text==
  const highlightRegex = /==(.+?)==/g;
  while ((match = highlightRegex.exec(lineText)) !== null) {
    const from = lineFrom + match.index;
    const to = lineFrom + match.index + match[0].length;
    if (!isOverlapping(from, to)) {
      elements.push({
        type: 'highlight',
        from,
        to,
        syntaxFrom: from,
        syntaxTo: from + 2,
        contentFrom: from + 2,
        contentTo: to - 2,
        content: match[1],
      });
      addMatchedRange(from, to);
    }
  }
  
  // 6. Inline code: `code` (but not ```)
  const codeRegex = /(?<!`)`(?!`)([^`]+)`(?!`)/g;
  while ((match = codeRegex.exec(lineText)) !== null) {
    const from = lineFrom + match.index;
    const to = lineFrom + match.index + match[0].length;
    if (!isOverlapping(from, to)) {
      elements.push({
        type: 'code',
        from,
        to,
        syntaxFrom: from,
        syntaxTo: from + 1,
        contentFrom: from + 1,
        contentTo: to - 1,
        content: match[1],
      });
      addMatchedRange(from, to);
    }
  }
  
  // 7. Links: [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  while ((match = linkRegex.exec(lineText)) !== null) {
    const from = lineFrom + match.index;
    const to = lineFrom + match.index + match[0].length;
    if (!isOverlapping(from, to)) {
      elements.push({
        type: 'link',
        from,
        to,
        syntaxFrom: from,
        syntaxTo: to,
        contentFrom: from + 1,
        contentTo: from + 1 + match[1].length,
        content: match[1],
        extra: { url: match[2] },
      });
      addMatchedRange(from, to);
    }
  }
  
  // 8. Wiki links: [[target]] or [[target|alias]] or [[target#heading]]
  // First check for annotation links: [[file.pdf#ann-uuid]] or [[file.pdf#ann-uuid|alias]]
  const annotationLinkRegex = /\[\[([^\]|#]+\.pdf)#(ann-[a-f0-9-]+)(?:\|([^\]]+))?\]\]/gi;
  while ((match = annotationLinkRegex.exec(lineText)) !== null) {
    const from = lineFrom + match.index;
    const to = lineFrom + match.index + match[0].length;
    if (!isOverlapping(from, to)) {
      const filePath = match[1];
      const annotationId = match[2];
      const alias = match[3];
      elements.push({
        type: 'annotationlink',
        from,
        to,
        syntaxFrom: from,
        syntaxTo: to,
        contentFrom: from + 2,
        contentTo: to - 2,
        content: alias || `${filePath}#${annotationId}`,
        extra: { filePath, annotationId, alias },
      });
      addMatchedRange(from, to);
    }
  }
  
  // Regular wiki links: [[target]] or [[target|alias]] or [[target#heading]]
  const wikiLinkRegex = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
  while ((match = wikiLinkRegex.exec(lineText)) !== null) {
    const from = lineFrom + match.index;
    const to = lineFrom + match.index + match[0].length;
    if (!isOverlapping(from, to)) {
      const target = match[1];
      const heading = match[2];
      const alias = match[3];
      elements.push({
        type: 'wikilink',
        from,
        to,
        syntaxFrom: from,
        syntaxTo: to,
        contentFrom: from + 2,
        contentTo: to - 2,
        content: alias || target,
        extra: { target, heading, alias },
      });
      addMatchedRange(from, to);
    }
  }
  
  // 9. Images: ![alt](url) or ![alt|width](url)
  const imageRegex = /!\[([^\]|]*?)(?:\|(\d+))?\]\(([^)]+)\)/g;
  while ((match = imageRegex.exec(lineText)) !== null) {
    const from = lineFrom + match.index;
    const to = lineFrom + match.index + match[0].length;
    if (!isOverlapping(from, to)) {
      elements.push({
        type: 'image',
        from,
        to,
        syntaxFrom: from,
        syntaxTo: to,
        contentFrom: from + 2,
        contentTo: from + 2 + match[1].length,
        content: match[1],
        extra: { url: match[3], width: match[2] ? parseInt(match[2]) : undefined },
      });
      addMatchedRange(from, to);
    }
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
      
      // Parse inline elements for this line (using cache for performance)
      const elements = getCachedLineElements(lineText, line.from);
      
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
 * Uses widget replacement for complete syntax hiding and proper cursor handling
 * 
 * Key: Pass both content range (for cursor positioning) and element range (for replacement)
 */
function addRenderedDecoration(
  decorations: DecorationEntry[],
  element: MarkdownElement
) {
  switch (element.type) {
    case 'bolditalic':
      // Replace entire bold-italic syntax with formatted widget
      // ***text*** renders as both bold and italic
      decorations.push({
        from: element.from,
        to: element.to,
        decoration: Decoration.replace({
          widget: new FormattedTextWidget(
            element.content,
            'cm-bold cm-italic',  // Apply both styles
            element.contentFrom,
            element.contentTo,
            element.from,
            element.to
          ),
        }),
      });
      break;
      
    case 'bold':
      // Replace entire bold syntax with formatted widget
      // contentFrom/To point to the actual text content (excluding ** markers)
      decorations.push({
        from: element.from,
        to: element.to,
        decoration: Decoration.replace({
          widget: new FormattedTextWidget(
            element.content,
            'cm-bold',
            element.contentFrom,  // Content start (after **)
            element.contentTo,    // Content end (before **)
            element.from,         // Element start (including **)
            element.to            // Element end (including **)
          ),
        }),
      });
      break;
      
    case 'italic':
      // Replace entire italic syntax with formatted widget
      decorations.push({
        from: element.from,
        to: element.to,
        decoration: Decoration.replace({
          widget: new FormattedTextWidget(
            element.content,
            'cm-italic',
            element.contentFrom,
            element.contentTo,
            element.from,
            element.to
          ),
        }),
      });
      break;
      
    case 'strikethrough':
      // Replace entire strikethrough syntax with formatted widget
      decorations.push({
        from: element.from,
        to: element.to,
        decoration: Decoration.replace({
          widget: new FormattedTextWidget(
            element.content,
            'cm-strikethrough',
            element.contentFrom,
            element.contentTo,
            element.from,
            element.to
          ),
        }),
      });
      break;
      
    case 'highlight':
      // Replace entire highlight syntax with formatted widget
      decorations.push({
        from: element.from,
        to: element.to,
        decoration: Decoration.replace({
          widget: new FormattedTextWidget(
            element.content,
            'cm-highlight',
            element.contentFrom,
            element.contentTo,
            element.from,
            element.to
          ),
        }),
      });
      break;
      
    case 'code':
      // Replace entire inline code syntax with formatted widget
      decorations.push({
        from: element.from,
        to: element.to,
        decoration: Decoration.replace({
          widget: new FormattedTextWidget(
            element.content,
            'cm-inline-code',
            element.contentFrom,
            element.contentTo,
            element.from,
            element.to
          ),
        }),
      });
      break;
      
    case 'link':
      // Replace entire link with widget
      // For links, content is the link text, contentFrom/To point to it
      decorations.push({
        from: element.from,
        to: element.to,
        decoration: Decoration.replace({
          widget: new LinkWidget(
            element.content,
            (element.extra?.url as string) || '#',
            false,
            element.contentFrom,  // Link text start
            element.contentTo,    // Link text end
            element.from,         // Full syntax start
            element.to            // Full syntax end
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
            true,
            element.contentFrom,
            element.contentTo,
            element.from,
            element.to
          ),
        }),
      });
      break;
      
    case 'annotationlink':
      // Replace entire annotation link with widget
      decorations.push({
        from: element.from,
        to: element.to,
        decoration: Decoration.replace({
          widget: new AnnotationLinkWidget(
            element.content,
            (element.extra?.filePath as string) || '',
            (element.extra?.annotationId as string) || '',
            element.contentFrom,
            element.contentTo,
            element.from,
            element.to
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
            element.extra?.width as number | undefined,
            element.contentFrom,
            element.contentTo,
            element.from,
            element.to
          ),
        }),
      });
      break;
  }
}

/**
 * Inline decoration view plugin with debounced updates
 * Debouncing prevents excessive re-renders during rapid typing
 */
export const inlineDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private pendingUpdate: ReturnType<typeof setTimeout> | null = null;
    private readonly debounceMs = 16; // ~60fps, minimal delay for smooth typing
    
    constructor(view: EditorView) {
      this.decorations = buildInlineDecorations(view);
    }
    
    update(update: ViewUpdate) {
      // Rebuild decorations on any change that might affect rendering
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        // For selection changes, update immediately for responsive cursor feedback
        if (update.selectionSet && !update.docChanged) {
          this.decorations = buildInlineDecorations(update.view);
        } else {
          // For document changes, use minimal debounce to batch rapid updates
          if (this.pendingUpdate) {
            clearTimeout(this.pendingUpdate);
          }
          
          // Capture view reference for closure
          const view = update.view;
          this.pendingUpdate = setTimeout(() => {
            this.decorations = buildInlineDecorations(view);
            this.pendingUpdate = null;
            // Request a re-render
            view.requestMeasure();
          }, this.debounceMs);
          
          // Also update immediately for visual feedback
          this.decorations = buildInlineDecorations(update.view);
        }
      }
    }
    
    destroy() {
      if (this.pendingUpdate) {
        clearTimeout(this.pendingUpdate);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

/**
 * Public API for parsing inline elements (uses cache)
 */
function parseLineInlineElements(lineText: string, lineFrom: number): MarkdownElement[] {
  return getCachedLineElements(lineText, lineFrom);
}

export { parseLineInlineElements };
