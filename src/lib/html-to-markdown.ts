/**
 * HTML to Markdown Converter
 * Converts HTML content (from old Tiptap saves) back to clean Markdown
 */

/**
 * Convert HTML to Markdown
 * Handles common HTML tags from Tiptap editor
 */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return '';

  // If it doesn't look like HTML, return as-is
  if (!html.trim().startsWith('<')) {
    return html;
  }

  let markdown = html;

  // Remove wrapping <p> tags
  markdown = markdown.replace(/<\/?p>/g, '\n');

  // Headings
  markdown = markdown.replace(/<h1>(.*?)<\/h1>/g, '# $1\n');
  markdown = markdown.replace(/<h2>(.*?)<\/h2>/g, '## $1\n');
  markdown = markdown.replace(/<h3>(.*?)<\/h3>/g, '### $1\n');
  markdown = markdown.replace(/<h4>(.*?)<\/h4>/g, '#### $1\n');
  markdown = markdown.replace(/<h5>(.*?)<\/h5>/g, '##### $1\n');
  markdown = markdown.replace(/<h6>(.*?)<\/h6>/g, '###### $1\n');

  // Bold and italic
  markdown = markdown.replace(/<strong>(.*?)<\/strong>/g, '**$1**');
  markdown = markdown.replace(/<b>(.*?)<\/b>/g, '**$1**');
  markdown = markdown.replace(/<em>(.*?)<\/em>/g, '*$1*');
  markdown = markdown.replace(/<i>(.*?)<\/i>/g, '*$1*');

  // Strikethrough
  markdown = markdown.replace(/<s>(.*?)<\/s>/g, '~~$1~~');
  markdown = markdown.replace(/<del>(.*?)<\/del>/g, '~~$1~~');

  // Code
  markdown = markdown.replace(/<code>(.*?)<\/code>/g, '`$1`');

  // Highlight (from Tiptap)
  markdown = markdown.replace(/<mark>(.*?)<\/mark>/g, '==$1==');

  // Links
  markdown = markdown.replace(/<a href="(.*?)">(.*?)<\/a>/g, '[$2]($1)');

  // Images
  markdown = markdown.replace(/<img src="(.*?)" alt="(.*?)">/g, '![$2]($1)');
  markdown = markdown.replace(/<img src="(.*?)">/g, '![]($1)');

  // Blockquotes
  markdown = markdown.replace(/<blockquote>(.*?)<\/blockquote>/gs, (_, content) => {
    return content.split('\n').map((line: string) => '> ' + line.trim()).join('\n') + '\n';
  });

  // Lists
  markdown = markdown.replace(/<ul>(.*?)<\/ul>/gs, '$1\n');
  markdown = markdown.replace(/<ol>(.*?)<\/ol>/gs, (_, content) => {
    const items = content.match(/<li>(.*?)<\/li>/g) || [];
    return items.map((item: string, index: number) => {
      const text = item.replace(/<\/?li>/g, '').trim();
      return `${index + 1}. ${text}`;
    }).join('\n') + '\n';
  });
  markdown = markdown.replace(/<li>(.*?)<\/li>/g, '- $1\n');

  // Task lists (Tiptap format)
  markdown = markdown.replace(/<li data-checked="true">(.*?)<\/li>/g, '- [x] $1\n');
  markdown = markdown.replace(/<li data-checked="false">(.*?)<\/li>/g, '- [ ] $1\n');

  // Code blocks
  markdown = markdown.replace(/<pre><code class="language-(.*?)">(.*?)<\/code><\/pre>/gs, '```$1\n$2\n```\n');
  markdown = markdown.replace(/<pre><code>(.*?)<\/code><\/pre>/gs, '```\n$1\n```\n');

  // Horizontal rule
  markdown = markdown.replace(/<hr\s*\/?>/g, '\n---\n');

  // Line breaks
  markdown = markdown.replace(/<br\s*\/?>/g, '  \n');

  // Math (Tiptap custom format) - Handle various attribute orders and formats
  // IMPORTANT: Process math tags BEFORE removing other HTML tags
  
  // Inline math: <span latex="..." data-type="inline-math"> or <span data-type="inline-math" latex="...">
  // Handle all possible attribute orderings
  markdown = markdown.replace(/<span[^>]*?latex="([^"]*)"[^>]*?data-type="inline-math"[^>]*>.*?<\/span>/gi, '$$$1$$');
  markdown = markdown.replace(/<span[^>]*?data-type="inline-math"[^>]*?latex="([^"]*)"[^>]*>.*?<\/span>/gi, '$$$1$$');
  markdown = markdown.replace(/<span[^>]*?data-latex="([^"]*)"[^>]*?data-type="inline-math"[^>]*>.*?<\/span>/gi, '$$$1$$');
  markdown = markdown.replace(/<span[^>]*?data-type="inline-math"[^>]*?data-latex="([^"]*)"[^>]*>.*?<\/span>/gi, '$$$1$$');
  
  // Handle class-based inline math nodes
  markdown = markdown.replace(/<span[^>]*?class="[^"]*inline-math[^"]*"[^>]*?latex="([^"]*)"[^>]*>.*?<\/span>/gi, '$$$1$$');
  markdown = markdown.replace(/<span[^>]*?class="[^"]*inline-math[^"]*"[^>]*?data-latex="([^"]*)"[^>]*>.*?<\/span>/gi, '$$$1$$');
  markdown = markdown.replace(/<span[^>]*?latex="([^"]*)"[^>]*?class="[^"]*inline-math[^"]*"[^>]*>.*?<\/span>/gi, '$$$1$$');
  markdown = markdown.replace(/<span[^>]*?data-latex="([^"]*)"[^>]*?class="[^"]*inline-math[^"]*"[^>]*>.*?<\/span>/gi, '$$$1$$');
  
  // Handle inline-mathlive-node class
  markdown = markdown.replace(/<span[^>]*?class="[^"]*inline-mathlive-node[^"]*"[^>]*?latex="([^"]*)"[^>]*>.*?<\/span>/gi, '$$$1$$');
  markdown = markdown.replace(/<span[^>]*?class="[^"]*inline-mathlive-node[^"]*"[^>]*?data-latex="([^"]*)"[^>]*>.*?<\/span>/gi, '$$$1$$');
  
  // Handle inline-math-node class (generic)
  markdown = markdown.replace(/<span[^>]*?class="[^"]*inline-math-node[^"]*"[^>]*?latex="([^"]*)"[^>]*>.*?<\/span>/gi, '$$$1$$');
  markdown = markdown.replace(/<span[^>]*?class="[^"]*inline-math-node[^"]*"[^>]*?data-latex="([^"]*)"[^>]*>.*?<\/span>/gi, '$$$1$$');

  // Block math: <div data-type="block-math" latex="..."> or <div latex="..." data-type="block-math">
  markdown = markdown.replace(/<div[^>]*?data-type="block-math"[^>]*?latex="([^"]*)"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');
  markdown = markdown.replace(/<div[^>]*?latex="([^"]*)"[^>]*?data-type="block-math"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');
  markdown = markdown.replace(/<div[^>]*?data-type="block-math"[^>]*?data-latex="([^"]*)"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');
  markdown = markdown.replace(/<div[^>]*?data-latex="([^"]*)"[^>]*?data-type="block-math"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');
  
  // Handle class-based block math nodes
  markdown = markdown.replace(/<div[^>]*?class="[^"]*block-math[^"]*"[^>]*?latex="([^"]*)"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');
  markdown = markdown.replace(/<div[^>]*?class="[^"]*block-math[^"]*"[^>]*?data-latex="([^"]*)"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');
  markdown = markdown.replace(/<div[^>]*?latex="([^"]*)"[^>]*?class="[^"]*block-math[^"]*"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');
  markdown = markdown.replace(/<div[^>]*?data-latex="([^"]*)"[^>]*?class="[^"]*block-math[^"]*"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');
  
  // Handle block-mathlive-node class
  markdown = markdown.replace(/<div[^>]*?class="[^"]*block-mathlive-node[^"]*"[^>]*?latex="([^"]*)"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');
  markdown = markdown.replace(/<div[^>]*?class="[^"]*block-mathlive-node[^"]*"[^>]*?data-latex="([^"]*)"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');
  
  // Handle block-math-node class (generic)
  markdown = markdown.replace(/<div[^>]*?class="[^"]*block-math-node[^"]*"[^>]*?latex="([^"]*)"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');
  markdown = markdown.replace(/<div[^>]*?class="[^"]*block-math-node[^"]*"[^>]*?data-latex="([^"]*)"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');

  // Tables (simple conversion)
  markdown = markdown.replace(/<table>(.*?)<\/table>/gs, convertTableToMarkdown);

  // Remove remaining HTML tags
  markdown = markdown.replace(/<\/?[^>]+(>|$)/g, '');

  // Decode HTML entities
  markdown = markdown.replace(/&nbsp;/g, ' ');
  markdown = markdown.replace(/&lt;/g, '<');
  markdown = markdown.replace(/&gt;/g, '>');
  markdown = markdown.replace(/&amp;/g, '&');
  markdown = markdown.replace(/&quot;/g, '"');
  markdown = markdown.replace(/&#39;/g, "'");

  // Clean up extra whitespace
  markdown = markdown.replace(/\n{3,}/g, '\n\n');
  markdown = markdown.trim();

  return markdown;
}

/**
 * Convert HTML table to Markdown table
 */
function convertTableToMarkdown(tableHtml: string): string {
  const rows: string[][] = [];

  // Extract rows
  const rowMatches = tableHtml.match(/<tr>(.*?)<\/tr>/gs) || [];

  for (const rowHtml of rowMatches) {
    const cells: string[] = [];
    const cellMatches = rowHtml.match(/<t[hd]>(.*?)<\/t[hd]>/g) || [];

    for (const cellHtml of cellMatches) {
      const cellText = cellHtml.replace(/<\/?t[hd]>/g, '').trim();
      cells.push(cellText);
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  if (rows.length === 0) return '';

  // Build markdown table
  const colCount = Math.max(...rows.map(row => row.length));
  let result = '';

  // Header row
  const headerRow = rows[0] || [];
  result += '| ' + headerRow.join(' | ') + ' |\n';

  // Separator
  result += '|' + ' --- |'.repeat(colCount) + '\n';

  // Data rows
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    result += '| ' + row.join(' | ') + ' |\n';
  }

  return '\n' + result + '\n';
}

/**
 * Auto-detect and convert HTML content to Markdown
 * Enhanced detection for various HTML patterns including math nodes
 */
export function autoConvertToMarkdown(content: string): string {
  if (!content || typeof content !== 'string') return content || '';
  
  // Check if content looks like HTML
  const trimmed = content.trim();
  
  // Check for common HTML patterns
  const hasHtmlTags = trimmed.startsWith('<') && (
    trimmed.includes('<p>') ||
    trimmed.includes('<h1>') ||
    trimmed.includes('<h2>') ||
    trimmed.includes('<h3>') ||
    trimmed.includes('<div>') ||
    trimmed.includes('<span') ||
    trimmed.includes('<table') ||
    trimmed.includes('<ul>') ||
    trimmed.includes('<ol>') ||
    trimmed.includes('<blockquote')
  );
  
  // Check for math-specific HTML patterns (even if not starting with <)
  const hasMathHtml = 
    content.includes('data-type="inline-math"') ||
    content.includes('data-type="block-math"') ||
    content.includes('class="inline-math') ||
    content.includes('class="block-math') ||
    content.includes('class="inline-mathlive') ||
    content.includes('class="block-mathlive') ||
    (content.includes('latex="') && content.includes('<span')) ||
    (content.includes('data-latex="') && content.includes('<span'));
  
  if (hasHtmlTags || hasMathHtml) {
    console.log('[HTML Detected] Converting to Markdown...');
    return htmlToMarkdown(content);
  }

  // Already markdown or plain text
  return content;
}
