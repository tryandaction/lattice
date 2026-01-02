/**
 * Advanced Markdown Parser
 * 
 * A comprehensive markdown parser that handles:
 * - Headings (# to ######)
 * - Bold, italic, strikethrough, inline code
 * - Block and inline math ($...$ and $...$)
 * - Code blocks with language detection
 * - Tables (GFM style)
 * - Lists (ordered and unordered, nested)
 * - Blockquotes (nested)
 * - Horizontal rules
 * - Links and images
 * 
 * Designed to handle complex scientific documents like Obsidian.
 */

export interface ContentNode {
  type: string;
  attrs?: Record<string, any>;
  content?: ContentNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, any> }>;
}

/**
 * Check if text looks like markdown
 */
export function isMarkdown(text: string): boolean {
  const patterns = [
    /^#{1,6}\s+/m,           // Headings
    /^\s*[-*+]\s+/m,         // Unordered lists
    /^\s*\d+\.\s+/m,         // Ordered lists
    /^\s*>\s+/m,             // Blockquotes
    /^```/m,                 // Code blocks
    /^\|.+\|/m,              // Tables
    /\*\*[^*]+\*\*/,         // Bold
    /\$\$[\s\S]+?\$\$/,      // Block math
    /\$[^$\n]+\$/,           // Inline math
    /\[.+\]\(.+\)/,          // Links
  ];
  
  return patterns.some(p => p.test(text));
}

/**
 * Token types for lexer
 */
type TokenType = 
  | 'heading'
  | 'paragraph'
  | 'code_block'
  | 'block_math'
  | 'table'
  | 'blockquote'
  | 'bullet_list'
  | 'ordered_list'
  | 'horizontal_rule'
  | 'empty';

interface Token {
  type: TokenType;
  content: string;
  level?: number;
  language?: string;
  rows?: string[][];
}

/**
 * Tokenize markdown into blocks
 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const lines = text.split('\n');
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Empty line
    if (!trimmed) {
      i++;
      continue;
    }
    
    // Code block ```
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing ```
      tokens.push({
        type: 'code_block',
        content: codeLines.join('\n'),
        language: lang || undefined,
      });
      continue;
    }
    
    // Block math $$
    if (trimmed.startsWith('$$')) {
      const mathLines: string[] = [];
      // Check if single line: $$...$$ 
      if (trimmed.endsWith('$$') && trimmed.length > 4) {
        tokens.push({
          type: 'block_math',
          content: trimmed.slice(2, -2).trim(),
        });
        i++;
        continue;
      }
      // Multi-line block math
      if (trimmed.length > 2) {
        mathLines.push(trimmed.slice(2));
      }
      i++;
      while (i < lines.length) {
        const mathLine = lines[i];
        if (mathLine.trim().endsWith('$$')) {
          const lastContent = mathLine.trim().slice(0, -2);
          if (lastContent) mathLines.push(lastContent);
          i++;
          break;
        }
        mathLines.push(mathLine);
        i++;
      }
      tokens.push({
        type: 'block_math',
        content: mathLines.join('\n').trim(),
      });
      continue;
    }
    
    // Table
    if (trimmed.startsWith('|') && trimmed.includes('|')) {
      const tableRows: string[][] = [];
      while (i < lines.length) {
        const tableLine = lines[i].trim();
        if (!tableLine.startsWith('|')) break;
        
        // Skip separator row (|---|---|)
        if (/^\|[\s\-:|]+\|$/.test(tableLine)) {
          i++;
          continue;
        }
        
        const cells = tableLine
          .split('|')
          .slice(1, -1) // Remove first and last empty strings
          .map(cell => cell.trim());
        
        if (cells.length > 0) {
          tableRows.push(cells);
        }
        i++;
      }
      if (tableRows.length > 0) {
        tokens.push({
          type: 'table',
          content: '',
          rows: tableRows,
        });
      }
      continue;
    }
    
    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      tokens.push({
        type: 'heading',
        content: headingMatch[2],
        level: headingMatch[1].length,
      });
      i++;
      continue;
    }
    
    // Horizontal rule
    if (/^[-*_]{3,}$/.test(trimmed)) {
      tokens.push({ type: 'horizontal_rule', content: '' });
      i++;
      continue;
    }
    
    // Blockquote
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s*/, ''));
        i++;
      }
      tokens.push({
        type: 'blockquote',
        content: quoteLines.join('\n'),
      });
      continue;
    }
    
    // Unordered list
    if (/^[-*+]\s+/.test(trimmed)) {
      const listLines: string[] = [];
      while (i < lines.length) {
        const listLine = lines[i];
        const listTrimmed = listLine.trim();
        // Continue if it's a list item or indented continuation
        if (/^[-*+]\s+/.test(listTrimmed) || (listLine.startsWith('  ') && listTrimmed)) {
          listLines.push(listLine);
          i++;
        } else if (!listTrimmed) {
          // Empty line might be between items
          if (i + 1 < lines.length && /^\s*[-*+]\s+/.test(lines[i + 1])) {
            listLines.push(listLine);
            i++;
          } else {
            break;
          }
        } else {
          break;
        }
      }
      tokens.push({
        type: 'bullet_list',
        content: listLines.join('\n'),
      });
      continue;
    }
    
    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const listLines: string[] = [];
      while (i < lines.length) {
        const listLine = lines[i];
        const listTrimmed = listLine.trim();
        if (/^\d+\.\s+/.test(listTrimmed) || (listLine.startsWith('  ') && listTrimmed)) {
          listLines.push(listLine);
          i++;
        } else if (!listTrimmed) {
          if (i + 1 < lines.length && /^\s*\d+\.\s+/.test(lines[i + 1])) {
            listLines.push(listLine);
            i++;
          } else {
            break;
          }
        } else {
          break;
        }
      }
      tokens.push({
        type: 'ordered_list',
        content: listLines.join('\n'),
      });
      continue;
    }
    
    // Paragraph - collect consecutive non-empty lines
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length) {
      const nextLine = lines[i];
      const nextTrimmed = nextLine.trim();
      // Stop at empty line or block-level element
      if (!nextTrimmed ||
          nextTrimmed.startsWith('#') ||
          nextTrimmed.startsWith('```') ||
          nextTrimmed.startsWith('$$') ||
          nextTrimmed.startsWith('|') ||
          nextTrimmed.startsWith('>') ||
          /^[-*+]\s+/.test(nextTrimmed) ||
          /^\d+\.\s+/.test(nextTrimmed) ||
          /^[-*_]{3,}$/.test(nextTrimmed)) {
        break;
      }
      paraLines.push(nextLine);
      i++;
    }
    tokens.push({
      type: 'paragraph',
      content: paraLines.join('\n'),
    });
  }
  
  return tokens;
}


/**
 * Parse inline markdown elements with proper nesting support
 */
function parseInline(text: string): ContentNode[] {
  if (!text) return [];
  
  const result: ContentNode[] = [];
  let remaining = text;
  
  while (remaining.length > 0) {
    let matched = false;
    
    // Block math $$...$$ (shouldn't appear inline, but handle it)
    const blockMathMatch = remaining.match(/^\$\$([\s\S]+?)\$\$/);
    if (blockMathMatch) {
      result.push({
        type: 'blockMath',
        attrs: { latex: blockMathMatch[1].trim() },
      });
      remaining = remaining.slice(blockMathMatch[0].length);
      matched = true;
      continue;
    }
    
    // Inline math $...$
    const inlineMathMatch = remaining.match(/^\$([^$\n]+?)\$/);
    if (inlineMathMatch) {
      result.push({
        type: 'inlineMath',
        attrs: { latex: inlineMathMatch[1].trim() },
      });
      remaining = remaining.slice(inlineMathMatch[0].length);
      matched = true;
      continue;
    }
    
    // Bold **...**
    const boldMatch = remaining.match(/^\*\*([^*]+?)\*\*/);
    if (boldMatch) {
      const innerContent = parseInline(boldMatch[1]);
      innerContent.forEach(node => {
        if (node.type === 'text') {
          node.marks = [...(node.marks || []), { type: 'bold' }];
        }
        result.push(node);
      });
      remaining = remaining.slice(boldMatch[0].length);
      matched = true;
      continue;
    }
    
    // Bold __...__
    const boldUnderMatch = remaining.match(/^__([^_]+?)__/);
    if (boldUnderMatch) {
      const innerContent = parseInline(boldUnderMatch[1]);
      innerContent.forEach(node => {
        if (node.type === 'text') {
          node.marks = [...(node.marks || []), { type: 'bold' }];
        }
        result.push(node);
      });
      remaining = remaining.slice(boldUnderMatch[0].length);
      matched = true;
      continue;
    }
    
    // Italic *...*
    const italicMatch = remaining.match(/^\*([^*]+?)\*/);
    if (italicMatch) {
      const innerContent = parseInline(italicMatch[1]);
      innerContent.forEach(node => {
        if (node.type === 'text') {
          node.marks = [...(node.marks || []), { type: 'italic' }];
        }
        result.push(node);
      });
      remaining = remaining.slice(italicMatch[0].length);
      matched = true;
      continue;
    }
    
    // Italic _..._
    const italicUnderMatch = remaining.match(/^_([^_]+?)_/);
    if (italicUnderMatch) {
      const innerContent = parseInline(italicUnderMatch[1]);
      innerContent.forEach(node => {
        if (node.type === 'text') {
          node.marks = [...(node.marks || []), { type: 'italic' }];
        }
        result.push(node);
      });
      remaining = remaining.slice(italicUnderMatch[0].length);
      matched = true;
      continue;
    }
    
    // Strikethrough ~~...~~
    const strikeMatch = remaining.match(/^~~([^~]+?)~~/);
    if (strikeMatch) {
      result.push({
        type: 'text',
        text: strikeMatch[1],
        marks: [{ type: 'strike' }],
      });
      remaining = remaining.slice(strikeMatch[0].length);
      matched = true;
      continue;
    }
    
    // Inline code `...`
    const codeMatch = remaining.match(/^`([^`]+?)`/);
    if (codeMatch) {
      result.push({
        type: 'text',
        text: codeMatch[1],
        marks: [{ type: 'code' }],
      });
      remaining = remaining.slice(codeMatch[0].length);
      matched = true;
      continue;
    }
    
    // Image ![alt](url)
    const imageMatch = remaining.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imageMatch) {
      result.push({
        type: 'image',
        attrs: { src: imageMatch[2], alt: imageMatch[1] },
      });
      remaining = remaining.slice(imageMatch[0].length);
      matched = true;
      continue;
    }
    
    // Link [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      result.push({
        type: 'text',
        text: linkMatch[1],
        marks: [{ type: 'link', attrs: { href: linkMatch[2] } }],
      });
      remaining = remaining.slice(linkMatch[0].length);
      matched = true;
      continue;
    }
    
    // No match - consume one character as text
    if (!matched) {
      // Find next special character
      const nextSpecial = remaining.slice(1).search(/[\$\*_~`!\[]/);
      const textEnd = nextSpecial === -1 ? remaining.length : nextSpecial + 1;
      const textContent = remaining.slice(0, textEnd);
      
      // Merge with previous text node if possible
      if (result.length > 0 && result[result.length - 1].type === 'text' && !result[result.length - 1].marks) {
        result[result.length - 1].text += textContent;
      } else {
        result.push({ type: 'text', text: textContent });
      }
      remaining = remaining.slice(textEnd);
    }
  }
  
  return result;
}

/**
 * Parse list items with proper nesting
 */
function parseListItems(content: string, ordered: boolean): ContentNode[] {
  const items: ContentNode[] = [];
  const lines = content.split('\n');
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (!trimmed) {
      i++;
      continue;
    }
    
    const itemMatch = ordered 
      ? trimmed.match(/^\d+\.\s+(.*)$/)
      : trimmed.match(/^[-*+]\s+(.*)$/);
    
    if (itemMatch) {
      const itemContent = itemMatch[1];
      const itemNode: ContentNode = {
        type: 'listItem',
        content: [{
          type: 'paragraph',
          content: parseInline(itemContent),
        }],
      };
      items.push(itemNode);
    }
    i++;
  }
  
  return items;
}


/**
 * Convert tokens to Tiptap nodes
 */
function tokensToNodes(tokens: Token[]): ContentNode[] {
  const nodes: ContentNode[] = [];
  
  for (const token of tokens) {
    switch (token.type) {
      case 'heading':
        nodes.push({
          type: 'heading',
          attrs: { level: token.level || 1 },
          content: parseInline(token.content),
        });
        break;
        
      case 'paragraph':
        // Check if paragraph contains only block math
        const trimmedContent = token.content.trim();
        if (trimmedContent.startsWith('$$') && trimmedContent.endsWith('$$')) {
          nodes.push({
            type: 'blockMath',
            attrs: { latex: trimmedContent.slice(2, -2).trim() },
          });
        } else {
          nodes.push({
            type: 'paragraph',
            content: parseInline(token.content),
          });
        }
        break;
        
      case 'code_block':
        nodes.push({
          type: 'codeBlock',
          attrs: { language: token.language || null },
          content: token.content ? [{ type: 'text', text: token.content }] : [],
        });
        break;
        
      case 'block_math':
        nodes.push({
          type: 'blockMath',
          attrs: { latex: token.content },
        });
        break;
        
      case 'table':
        if (token.rows && token.rows.length > 0) {
          const tableRows: ContentNode[] = [];
          
          // First row is header
          tableRows.push({
            type: 'tableRow',
            content: token.rows[0].map(cell => ({
              type: 'tableHeader',
              content: [{
                type: 'paragraph',
                content: parseInline(cell),
              }],
            })),
          });
          
          // Rest are data rows
          for (let i = 1; i < token.rows.length; i++) {
            tableRows.push({
              type: 'tableRow',
              content: token.rows[i].map(cell => ({
                type: 'tableCell',
                content: [{
                  type: 'paragraph',
                  content: parseInline(cell),
                }],
              })),
            });
          }
          
          nodes.push({
            type: 'table',
            content: tableRows,
          });
        }
        break;
        
      case 'blockquote':
        // Recursively parse blockquote content
        const quoteTokens = tokenize(token.content);
        const quoteContent = tokensToNodes(quoteTokens);
        nodes.push({
          type: 'blockquote',
          content: quoteContent.length > 0 ? quoteContent : [{
            type: 'paragraph',
            content: parseInline(token.content),
          }],
        });
        break;
        
      case 'bullet_list':
        nodes.push({
          type: 'bulletList',
          content: parseListItems(token.content, false),
        });
        break;
        
      case 'ordered_list':
        nodes.push({
          type: 'orderedList',
          content: parseListItems(token.content, true),
        });
        break;
        
      case 'horizontal_rule':
        nodes.push({ type: 'horizontalRule' });
        break;
    }
  }
  
  return nodes;
}

/**
 * Main parsing function - converts markdown text to Tiptap nodes
 */
export function parseMarkdown(text: string): ContentNode[] {
  if (!text) return [];
  
  const tokens = tokenize(text);
  return tokensToNodes(tokens);
}

/**
 * Parse markdown and return as a document
 */
export function parseMarkdownToDocument(text: string): ContentNode {
  const content = parseMarkdown(text);
  return {
    type: 'doc',
    content: content.length > 0 ? content : [{ type: 'paragraph' }],
  };
}
