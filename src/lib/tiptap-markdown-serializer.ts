/**
 * Tiptap to Markdown Serializer
 * Converts Tiptap's JSON format to clean Markdown
 */

import type { Editor } from '@tiptap/react';

/**
 * Serialize Tiptap JSON to Markdown
 */
export function serializeToMarkdown(editor: Editor): string {
  const json = editor.getJSON();
  return jsonToMarkdown(json);
}

/**
 * Convert Tiptap JSON node to Markdown
 */
function jsonToMarkdown(node: any): string {
  if (!node) return '';

  const { type, content, attrs, marks } = node;

  // Handle different node types
  switch (type) {
    case 'doc':
      return content?.map((child: any) => jsonToMarkdown(child)).join('\n') || '';

    case 'paragraph':
      const paraContent = content?.map((child: any) => jsonToMarkdown(child)).join('') || '';
      return paraContent ? paraContent + '\n' : '\n';

    case 'heading':
      const level = attrs?.level || 1;
      const headingContent = content?.map((child: any) => jsonToMarkdown(child)).join('') || '';
      return '#'.repeat(level) + ' ' + headingContent + '\n';

    case 'bulletList':
      return content?.map((item: any) => jsonToMarkdown(item)).join('') || '';

    case 'orderedList':
      const start = attrs?.start || 1;
      return content?.map((item: any, index: number) => {
        const itemContent = item.content?.map((child: any) => jsonToMarkdown(child)).join('') || '';
        return `${start + index}. ${itemContent}`;
      }).join('') || '';

    case 'listItem':
      const isTaskList = content?.[0]?.type === 'taskList';
      if (isTaskList) {
        return content?.map((child: any) => jsonToMarkdown(child)).join('') || '';
      }
      const itemText = content?.map((child: any) => jsonToMarkdown(child)).join('') || '';
      return '- ' + itemText;

    case 'taskList':
      return content?.map((child: any) => jsonToMarkdown(child)).join('') || '';

    case 'taskItem':
      const checked = attrs?.checked || false;
      const taskContent = content?.map((child: any) => jsonToMarkdown(child)).join('') || '';
      return `- [${checked ? 'x' : ' '}] ${taskContent}`;

    case 'codeBlock':
      const language = attrs?.language || '';
      const code = content?.[0]?.text || '';
      return '```' + language + '\n' + code + '\n```\n';

    case 'blockquote':
      const quoteContent = content?.map((child: any) => jsonToMarkdown(child)).join('') || '';
      return quoteContent.split('\n').map((line: string) => '> ' + line).join('\n') + '\n';

    case 'horizontalRule':
      return '---\n';

    case 'hardBreak':
      return '  \n';

    case 'table':
      return serializeTable(content);

    case 'tableRow':
    case 'tableHeader':
    case 'tableCell':
      // Handled by serializeTable
      return '';

    case 'text':
      let text = node.text || '';

      // Apply marks (bold, italic, etc.)
      if (marks && marks.length > 0) {
        for (const mark of marks) {
          switch (mark.type) {
            case 'bold':
              text = `**${text}**`;
              break;
            case 'italic':
              text = `*${text}*`;
              break;
            case 'strike':
              text = `~~${text}~~`;
              break;
            case 'code':
              text = `\`${text}\``;
              break;
            case 'highlight':
              text = `==${text}==`;
              break;
            case 'link':
              const href = mark.attrs?.href || '';
              text = `[${text}](${href})`;
              break;
          }
        }
      }

      return text;

    case 'image':
      const src = attrs?.src || '';
      const alt = attrs?.alt || '';
      const title = attrs?.title || '';
      return title ? `![${alt}](${src} "${title}")\n` : `![${alt}](${src})\n`;

    // Math nodes (custom extensions)
    case 'inlineMath':
    case 'mathInline':
      return `$${attrs?.latex || ''}$`;

    case 'blockMath':
    case 'mathDisplay':
      return `$$\n${attrs?.latex || ''}\n$$\n`;

    default:
      // Unknown node type - try to process children
      if (content) {
        return content.map((child: any) => jsonToMarkdown(child)).join('');
      }
      return '';
  }
}

/**
 * Serialize table to Markdown
 */
function serializeTable(rows: any[]): string {
  if (!rows || rows.length === 0) return '';

  const tableData: string[][] = [];

  // Extract cell data
  for (const row of rows) {
    if (row.type !== 'tableRow') continue;

    const rowData: string[] = [];
    for (const cell of row.content || []) {
      if (cell.type === 'tableCell' || cell.type === 'tableHeader') {
        const cellContent = cell.content?.map((child: any) => jsonToMarkdown(child)).join('').trim() || '';
        rowData.push(cellContent);
      }
    }
    tableData.push(rowData);
  }

  if (tableData.length === 0) return '';

  // Build markdown table
  const colCount = Math.max(...tableData.map(row => row.length));
  let result = '';

  // Header row
  const headerRow = tableData[0] || [];
  result += '| ' + headerRow.map(cell => cell || ' ').join(' | ') + ' |\n';

  // Separator
  result += '|' + ' --- |'.repeat(colCount) + '\n';

  // Data rows
  for (let i = 1; i < tableData.length; i++) {
    const row = tableData[i];
    result += '| ' + row.map(cell => cell || ' ').join(' | ') + ' |\n';
  }

  return result + '\n';
}

/**
 * Get Markdown from Tiptap editor
 * Fallback to getText if serialization fails
 */
export function getMarkdownFromEditor(editor: Editor): string {
  try {
    return serializeToMarkdown(editor);
  } catch (error) {
    console.error('Failed to serialize to Markdown:', error);
    // Fallback to plain text
    return editor.getText();
  }
}
