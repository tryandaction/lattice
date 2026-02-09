/**
 * Markdown Parser for Live Preview
 * Parses markdown content to identify elements for decoration
 */

import type {
  MarkdownElement,
  HeadingInfo,
  CodeBlockInfo,
  ListItemInfo,
  BlockquoteInfo,
} from './types';

/**
 * Parse inline markdown elements (bold, italic, code, links, etc.)
 */
export function parseInlineElements(text: string, offset: number = 0): MarkdownElement[] {
  const elements: MarkdownElement[] = [];
  
  // Bold: **text** or __text__
  const boldRegex = /(\*\*|__)(?!\s)([^*_]+?)(?<!\s)\1/g;
  let match;
  while ((match = boldRegex.exec(text)) !== null) {
    elements.push({
      type: 'bold',
      from: offset + match.index,
      to: offset + match.index + match[0].length,
      syntaxFrom: offset + match.index,
      syntaxTo: offset + match.index + match[1].length,
      contentFrom: offset + match.index + match[1].length,
      contentTo: offset + match.index + match[0].length - match[1].length,
      content: match[2],
    });
  }
  
  // Italic: *text* or _text_ (not inside bold)
  const italicRegex = /(?<!\*|_)(\*|_)(?!\s)([^*_]+?)(?<!\s)\1(?!\*|_)/g;
  while ((match = italicRegex.exec(text)) !== null) {
    elements.push({
      type: 'italic',
      from: offset + match.index,
      to: offset + match.index + match[0].length,
      syntaxFrom: offset + match.index,
      syntaxTo: offset + match.index + 1,
      contentFrom: offset + match.index + 1,
      contentTo: offset + match.index + match[0].length - 1,
      content: match[2],
    });
  }
  
  // Strikethrough: ~~text~~
  const strikeRegex = /~~([^~]+)~~/g;
  while ((match = strikeRegex.exec(text)) !== null) {
    elements.push({
      type: 'strikethrough',
      from: offset + match.index,
      to: offset + match.index + match[0].length,
      syntaxFrom: offset + match.index,
      syntaxTo: offset + match.index + 2,
      contentFrom: offset + match.index + 2,
      contentTo: offset + match.index + match[0].length - 2,
      content: match[1],
    });
  }
  
  // Highlight: ==text==
  const highlightRegex = /==([^=]+)==/g;
  while ((match = highlightRegex.exec(text)) !== null) {
    elements.push({
      type: 'highlight',
      from: offset + match.index,
      to: offset + match.index + match[0].length,
      syntaxFrom: offset + match.index,
      syntaxTo: offset + match.index + 2,
      contentFrom: offset + match.index + 2,
      contentTo: offset + match.index + match[0].length - 2,
      content: match[1],
    });
  }
  
  // Inline code: `code`
  const codeRegex = /`([^`]+)`/g;
  while ((match = codeRegex.exec(text)) !== null) {
    elements.push({
      type: 'code',
      from: offset + match.index,
      to: offset + match.index + match[0].length,
      syntaxFrom: offset + match.index,
      syntaxTo: offset + match.index + 1,
      contentFrom: offset + match.index + 1,
      contentTo: offset + match.index + match[0].length - 1,
      content: match[1],
    });
  }
  
  // Links: [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  while ((match = linkRegex.exec(text)) !== null) {
    elements.push({
      type: 'link',
      from: offset + match.index,
      to: offset + match.index + match[0].length,
      syntaxFrom: offset + match.index,
      syntaxTo: offset + match.index + match[0].length,
      contentFrom: offset + match.index + 1,
      contentTo: offset + match.index + 1 + match[1].length,
      content: match[1],
      extra: { url: match[2] },
    });
  }
  
  // Wiki links: [[target]] or [[target|alias]] or [[target#heading]]
  const wikiLinkRegex = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
  while ((match = wikiLinkRegex.exec(text)) !== null) {
    const target = match[1];
    const heading = match[2];
    const alias = match[3];
    elements.push({
      type: 'wikilink',
      from: offset + match.index,
      to: offset + match.index + match[0].length,
      syntaxFrom: offset + match.index,
      syntaxTo: offset + match.index + match[0].length,
      contentFrom: offset + match.index + 2,
      contentTo: offset + match.index + match[0].length - 2,
      content: alias || target,
      extra: { target, heading, alias },
    });
  }
  
  // Inline math: $...$
  const mathRegex = /\$([^$\n]+)\$/g;
  while ((match = mathRegex.exec(text)) !== null) {
    elements.push({
      type: 'math',
      from: offset + match.index,
      to: offset + match.index + match[0].length,
      syntaxFrom: offset + match.index,
      syntaxTo: offset + match.index + 1,
      contentFrom: offset + match.index + 1,
      contentTo: offset + match.index + match[0].length - 1,
      content: match[1],
      extra: { isBlock: false },
    });
  }
  
  // Images: ![alt](url) or ![alt|width](url)
  const imageRegex = /!\[([^\]|]*?)(?:\|(\d+))?\]\(([^)]+)\)/g;
  while ((match = imageRegex.exec(text)) !== null) {
    elements.push({
      type: 'image',
      from: offset + match.index,
      to: offset + match.index + match[0].length,
      syntaxFrom: offset + match.index,
      syntaxTo: offset + match.index + match[0].length,
      contentFrom: offset + match.index + 2,
      contentTo: offset + match.index + 2 + match[1].length,
      content: match[1],
      extra: { url: match[3], width: match[2] ? parseInt(match[2]) : undefined },
    });
  }
  
  return elements;
}

/**
 * Parse headings from document
 */
export function parseHeadings(text: string): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  const lines = text.split('\n');
  let offset = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2],
        line: i + 1,
        from: offset,
        to: offset + line.length,
        markerFrom: offset,
        markerTo: offset + match[1].length + 1, // Include space after #
      });
    }
    offset += line.length + 1; // +1 for newline
  }
  
  return headings;
}

/**
 * Parse code blocks from document
 */
export function parseCodeBlocks(text: string): CodeBlockInfo[] {
  const blocks: CodeBlockInfo[] = [];
  const regex = /^```(\w*)\n([\s\S]*?)^```$/gm;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    const fenceStart = match.index;
    const fenceStartEnd = fenceStart + 3 + match[1].length + 1; // ``` + language + newline
    const codeEnd = fenceStart + match[0].length - 4; // Before closing ```
    const fenceEndStart = codeEnd + 1;
    const fenceEndEnd = fenceStart + match[0].length;
    
    blocks.push({
      language: match[1] || 'text',
      code: match[2],
      from: fenceStart,
      to: fenceEndEnd,
      fenceStartFrom: fenceStart,
      fenceStartTo: fenceStartEnd,
      fenceEndFrom: fenceEndStart,
      fenceEndTo: fenceEndEnd,
    });
  }
  
  return blocks;
}

/**
 * Parse list items from a line
 */
export function parseListItem(line: string, lineFrom: number): ListItemInfo | null {
  // Task list: - [ ] or - [x]
  const taskMatch = line.match(/^(\s*)([-*+])\s+\[([ xX])\]\s/);
  if (taskMatch) {
    return {
      type: 'task',
      marker: taskMatch[2],
      from: lineFrom,
      to: lineFrom + line.length,
      markerFrom: lineFrom + taskMatch[1].length,
      markerTo: lineFrom + taskMatch[0].length,
      checked: taskMatch[3].toLowerCase() === 'x',
      indent: taskMatch[1].length,
    };
  }
  
  // Bullet list: - or * or +
  const bulletMatch = line.match(/^(\s*)([-*+])\s/);
  if (bulletMatch) {
    return {
      type: 'bullet',
      marker: bulletMatch[2],
      from: lineFrom,
      to: lineFrom + line.length,
      markerFrom: lineFrom + bulletMatch[1].length,
      markerTo: lineFrom + bulletMatch[0].length,
      indent: bulletMatch[1].length,
    };
  }
  
  // Numbered list: 1. or 1)
  const numberedMatch = line.match(/^(\s*)(\d+[.)]\s)/);
  if (numberedMatch) {
    return {
      type: 'numbered',
      marker: numberedMatch[2],
      from: lineFrom,
      to: lineFrom + line.length,
      markerFrom: lineFrom + numberedMatch[1].length,
      markerTo: lineFrom + numberedMatch[0].length,
      indent: numberedMatch[1].length,
    };
  }
  
  return null;
}

/**
 * Parse blockquote from a line
 */
export function parseBlockquote(line: string, lineFrom: number): BlockquoteInfo | null {
  const match = line.match(/^(>\s?)/);
  if (match) {
    return {
      from: lineFrom,
      to: lineFrom + line.length,
      markerFrom: lineFrom,
      markerTo: lineFrom + match[0].length,
      content: line.slice(match[0].length),
    };
  }
  return null;
}

/**
 * Parse block math: $$...$$
 */
export function parseBlockMath(text: string): MarkdownElement[] {
  const elements: MarkdownElement[] = [];
  const regex = /\$\$([\s\S]+?)\$\$/g;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    elements.push({
      type: 'math',
      from: match.index,
      to: match.index + match[0].length,
      syntaxFrom: match.index,
      syntaxTo: match.index + 2,
      contentFrom: match.index + 2,
      contentTo: match.index + match[0].length - 2,
      content: match[1],
      extra: { isBlock: true },
    });
  }
  
  return elements;
}

/**
 * Check if position is inside a code block
 */
export function isInsideCodeBlock(pos: number, codeBlocks: CodeBlockInfo[]): boolean {
  return codeBlocks.some(block => pos >= block.from && pos <= block.to);
}

/**
 * Build outline tree from headings
 */
export function buildOutlineTree(headings: HeadingInfo[]): import('./types').OutlineItem[] {
  const root: import('./types').OutlineItem[] = [];
  const stack: import('./types').OutlineItem[] = [];
  
  for (const heading of headings) {
    const item: import('./types').OutlineItem = {
      level: heading.level,
      text: heading.text,
      line: heading.line,
      from: heading.from,
      to: heading.to,
      children: [],
    };
    
    // Find parent
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    
    if (stack.length === 0) {
      root.push(item);
    } else {
      stack[stack.length - 1].children.push(item);
    }
    
    stack.push(item);
  }
  
  return root;
}
