/**
 * Export Utilities - Task 10
 * 
 * Provides export functionality for markdown documents:
 * - Markdown export (raw markdown)
 * - HTML export (with rendered formulas)
 * - PDF export (via HTML)
 */

import { loadKaTeX } from '@/components/editor/codemirror/live-preview/katex-loader';
import { getKaTeXOptions } from '@/components/editor/codemirror/live-preview/katex-config';

// ============================================================================
// Types
// ============================================================================

export interface ExportOptions {
  filename?: string;
  includeStyles?: boolean;
  renderMath?: boolean;
}

export interface HTMLExportOptions extends ExportOptions {
  title?: string;
  includeCSS?: boolean;
  darkMode?: boolean;
}

export interface PDFExportOptions extends HTMLExportOptions {
  pageSize?: 'A4' | 'Letter';
  margin?: string;
}

// ============================================================================
// 1. Markdown Export (Task 10.2)
// ============================================================================

/**
 * Export raw markdown content
 * Preserves all syntax exactly as written
 */
export function exportMarkdown(content: string, options: ExportOptions = {}): void {
  const filename = options.filename || 'document.md';
  
  // Create blob and download
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  downloadBlob(blob, filename);
}

// ============================================================================
// 2. HTML Export (Task 10.3)
// ============================================================================

/**
 * Convert markdown to HTML with rendered formulas
 */
export async function exportHTML(content: string, options: HTMLExportOptions = {}): Promise<void> {
  const filename = options.filename || 'document.html';
  const title = options.title || 'Exported Document';
  const includeCSS = options.includeCSS !== false;
  const darkMode = options.darkMode || false;
  
  // Convert markdown to HTML
  const htmlContent = await markdownToHTML(content, { renderMath: true });
  
  // Build complete HTML document
  const html = buildHTMLDocument(htmlContent, {
    title,
    includeCSS,
    darkMode,
  });
  
  // Create blob and download
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  downloadBlob(blob, filename);
}

/**
 * Convert markdown to HTML
 */
async function markdownToHTML(markdown: string, options: { renderMath?: boolean } = {}): Promise<string> {
  let html = markdown;
  
  // Escape HTML entities first
  html = escapeHTML(html);
  
  // Render math formulas if requested
  if (options.renderMath) {
    html = await renderMathInHTML(html);
  }
  
  // Convert markdown syntax to HTML
  html = convertMarkdownToHTML(html);
  
  return html;
}

/**
 * Render math formulas using KaTeX
 */
async function renderMathInHTML(html: string): Promise<string> {
  try {
    const katex = await loadKaTeX();
    
    // Render block math: $$...$$
    html = html.replace(/\$\$([\s\S]+?)\$\$/g, (match, latex) => {
      try {
        return `<div class="math-block">${katex.renderToString(latex, getKaTeXOptions(true))}</div>`;
      } catch {
        return `<div class="math-error">$$${latex}$$</div>`;
      }
    });
    
    // Render inline math: $...$
    html = html.replace(/\$([^$\n]+?)\$/g, (match, latex) => {
      try {
        return `<span class="math-inline">${katex.renderToString(latex, getKaTeXOptions(false))}</span>`;
      } catch {
        return `<span class="math-error">${match}</span>`;
      }
    });
    
    return html;
  } catch (error) {
    console.error('Failed to load KaTeX for export:', error);
    return html;
  }
}

/**
 * Convert markdown syntax to HTML
 */
function convertMarkdownToHTML(markdown: string): string {
  let html = markdown;
  
  // Headings
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  
  // Bold + Italic: ***text***
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  
  // Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  
  // Italic: *text* or _text_
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');
  
  // Strikethrough: ~~text~~
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
  
  // Highlight: ==text==
  html = html.replace(/==(.+?)==/g, '<mark>$1</mark>');
  
  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Links: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  
  // Images: ![alt](url)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
  
  // Blockquotes
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');
  
  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr />');
  html = html.replace(/^\*\*\*$/gm, '<hr />');
  
  // Unordered lists
  html = html.replace(/^[-*+]\s+(.+)$/gm, '<li>$1</li>');
  
  // Ordered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
  
  // Wrap consecutive <li> in <ul> or <ol>
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
    return `<ul>${match}</ul>`;
  });
  
  // Paragraphs (lines not already wrapped in tags)
  html = html.replace(/^(?!<[hblou]|<\/|<hr|<img)(.+)$/gm, '<p>$1</p>');
  
  // Line breaks
  html = html.replace(/\n/g, '\n');
  
  return html;
}

/**
 * Build complete HTML document
 */
function buildHTMLDocument(content: string, options: {
  title: string;
  includeCSS: boolean;
  darkMode: boolean;
}): string {
  const css = options.includeCSS ? getExportCSS(options.darkMode) : '';
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(options.title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  ${css ? `<style>${css}</style>` : ''}
</head>
<body>
  <div class="container">
    ${content}
  </div>
</body>
</html>`;
}

/**
 * Get CSS for exported HTML
 */
function getExportCSS(darkMode: boolean): string {
  const bgColor = darkMode ? '#1a1a1a' : '#ffffff';
  const textColor = darkMode ? '#e5e5e5' : '#1a1a1a';
  const borderColor = darkMode ? '#404040' : '#e5e5e5';
  const codeBackground = darkMode ? '#2a2a2a' : '#f5f5f5';
  
  return `
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      font-size: 16px;
      line-height: 1.6;
      color: ${textColor};
      background-color: ${bgColor};
      padding: 2rem;
    }
    
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
    
    h1, h2, h3, h4, h5, h6 {
      font-weight: 600;
      line-height: 1.3;
      margin-top: 1em;
      margin-bottom: 0.5em;
    }
    
    h1 { font-size: 2em; }
    h2 { font-size: 1.5em; }
    h3 { font-size: 1.25em; }
    h4 { font-size: 1.1em; }
    h5 { font-size: 1em; }
    h6 { font-size: 0.9em; opacity: 0.8; }
    
    p {
      margin-bottom: 1em;
    }
    
    strong {
      font-weight: 600;
    }
    
    em {
      font-style: italic;
    }
    
    del {
      text-decoration: line-through;
      opacity: 0.7;
    }
    
    mark {
      background-color: #fef08a;
      padding: 0 2px;
      border-radius: 2px;
    }
    
    code {
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 0.9em;
      background-color: ${codeBackground};
      padding: 0.1em 0.3em;
      border-radius: 3px;
    }
    
    a {
      color: #3b82f6;
      text-decoration: none;
    }
    
    a:hover {
      text-decoration: underline;
    }
    
    img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 1em 0;
    }
    
    blockquote {
      border-left: 3px solid ${borderColor};
      padding-left: 1em;
      margin: 1em 0;
      color: ${darkMode ? '#9ca3af' : '#6b7280'};
      font-style: italic;
    }
    
    hr {
      border: none;
      border-top: 2px solid ${borderColor};
      margin: 1.5em 0;
      opacity: 0.6;
    }
    
    ul, ol {
      margin: 1em 0;
      padding-left: 2em;
    }
    
    li {
      margin-bottom: 0.5em;
    }
    
    .math-block {
      display: block;
      text-align: center;
      padding: 1em 0;
      margin: 0.5em 0;
    }
    
    .math-inline {
      display: inline-block;
      vertical-align: middle;
      padding: 0 0.2em;
    }
    
    .math-error {
      color: #ef4444;
      background-color: rgba(239, 68, 68, 0.1);
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-family: monospace;
    }
    
    @media print {
      body {
        padding: 0;
      }
      
      .container {
        max-width: 100%;
      }
    }
  `;
}

// ============================================================================
// 3. PDF Export (Task 10.4)
// ============================================================================

/**
 * Export as PDF (using browser print functionality)
 * Note: For true PDF generation, would need a library like jsPDF or html2pdf
 */
export async function exportPDF(content: string, options: PDFExportOptions = {}): Promise<void> {
  // Generate HTML first
  const htmlContent = await markdownToHTML(content, { renderMath: true });
  const html = buildHTMLDocument(htmlContent, {
    title: options.title || 'Exported Document',
    includeCSS: true,
    darkMode: false, // PDFs typically use light mode
  });
  
  // Open in new window and trigger print dialog
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    
    // Wait for content to load, then print
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
      }, 500);
    };
  } else {
    throw new Error('Failed to open print window. Please allow popups for this site.');
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Escape HTML entities
 */
function escapeHTML(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Download blob as file
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ============================================================================
// Export All Functions
// ============================================================================

export const ExportUtils = {
  exportMarkdown,
  exportHTML,
  exportPDF,
  exportLatex,
  copyToClipboard,
  copyAsFormat,
};

// ============================================================================
// 4. LaTeX Export
// ============================================================================

/**
 * Convert markdown to LaTeX
 */
export function exportLatex(content: string, options: ExportOptions = {}): void {
  const filename = options.filename || 'document.tex';
  const latexContent = convertMarkdownToLatex(content);

  // Create blob and download
  const blob = new Blob([latexContent], { type: 'application/x-latex;charset=utf-8' });
  downloadBlob(blob, filename);
}

/**
 * Convert markdown syntax to LaTeX
 */
function convertMarkdownToLatex(markdown: string): string {
  let latex = markdown;

  // Remove frontmatter
  latex = latex.replace(/^---\n[\s\S]*?\n---\n/, '');

  // Convert headings
  latex = latex.replace(/^######\s+(.*)$/gm, '\\subparagraph{$1}');
  latex = latex.replace(/^#####\s+(.*)$/gm, '\\paragraph{$1}');
  latex = latex.replace(/^####\s+(.*)$/gm, '\\subsubsection{$1}');
  latex = latex.replace(/^###\s+(.*)$/gm, '\\subsection{$1}');
  latex = latex.replace(/^##\s+(.*)$/gm, '\\section{$1}');
  latex = latex.replace(/^#\s+(.*)$/gm, '\\chapter{$1}');

  // Convert bold and italic
  latex = latex.replace(/\*\*\*(.+?)\*\*\*/g, '\\textbf{\\textit{$1}}');
  latex = latex.replace(/\*\*(.+?)\*\*/g, '\\textbf{$1}');
  latex = latex.replace(/\*(.+?)\*/g, '\\textit{$1}');
  latex = latex.replace(/_(.+?)_/g, '\\textit{$1}');

  // Convert strikethrough (requires ulem package)
  latex = latex.replace(/~~(.+?)~~/g, '\\sout{$1}');

  // Convert inline code
  latex = latex.replace(/`([^`]+)`/g, '\\texttt{$1}');

  // Convert code blocks
  latex = latex.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const language = lang || 'text';
    return `\\begin{lstlisting}[language=${language}]\n${code}\\end{lstlisting}`;
  });

  // Convert block quotes
  latex = latex.replace(/^>\s+(.*)$/gm, '\\begin{quote}\n$1\n\\end{quote}');

  // Convert links
  latex = latex.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '\\href{$2}{$1}');

  // Convert wiki links
  latex = latex.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, target, alias) => {
    const displayText = alias || target;
    return `\\hyperref[${target}]{${displayText}}`;
  });

  // Convert images
  latex = latex.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
    return `\\begin{figure}[h]\n\\centering\n\\includegraphics{${url}}\n\\caption{${alt}}\n\\end{figure}`;
  });

  // Convert horizontal rules
  latex = latex.replace(/^[-*_]{3,}$/gm, '\\hrulefill');

  // Convert block math: $$...$$ -> \[...\]
  latex = latex.replace(/\$\$\n?([\s\S]*?)\n?\$\$/g, '\\[\n$1\n\\]');

  // Escape special LaTeX characters (except in math mode and already converted)
  // This is simplified - a full implementation would track context
  latex = latex.replace(/(?<!\\)&(?![a-z]+;)/g, '\\&');
  latex = latex.replace(/(?<!\\)%/g, '\\%');

  // Wrap in document structure
  return `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{hyperref}
\\usepackage{graphicx}
\\usepackage{listings}
\\usepackage[normalem]{ulem}

\\begin{document}

${latex}

\\end{document}`;
}

// ============================================================================
// 5. Clipboard Utilities
// ============================================================================

/**
 * Copy content to clipboard
 */
export async function copyToClipboard(content: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(content);
    return true;
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);

    // Fallback for older browsers
    try {
      const textarea = document.createElement('textarea');
      textarea.value = content;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Copy content in a specific format
 */
export async function copyAsFormat(
  content: string,
  format: 'markdown' | 'latex' | 'html' | 'plaintext'
): Promise<boolean> {
  let exportedContent: string;

  switch (format) {
    case 'markdown':
      exportedContent = content;
      break;
    case 'latex':
      exportedContent = convertMarkdownToLatex(content);
      break;
    case 'html':
      exportedContent = convertMarkdownToHTML(content);
      break;
    case 'plaintext':
      exportedContent = convertMarkdownToPlainText(content);
      break;
    default:
      exportedContent = content;
  }

  return copyToClipboard(exportedContent);
}

/**
 * Convert markdown to plain text
 */
function convertMarkdownToPlainText(markdown: string): string {
  let text = markdown;

  // Remove frontmatter
  text = text.replace(/^---\n[\s\S]*?\n---\n/, '');

  // Remove heading markers
  text = text.replace(/^#{1,6}\s+/gm, '');

  // Remove bold/italic markers
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
  text = text.replace(/\*\*(.+?)\*\*/g, '$1');
  text = text.replace(/\*(.+?)\*/g, '$1');
  text = text.replace(/_(.+?)_/g, '$1');

  // Remove strikethrough
  text = text.replace(/~~(.+?)~~/g, '$1');

  // Remove highlight
  text = text.replace(/==(.+?)==/g, '$1');

  // Remove inline code markers
  text = text.replace(/`([^`]+)`/g, '$1');

  // Remove code block markers
  text = text.replace(/```\w*\n([\s\S]*?)```/g, '$1');

  // Remove block quote markers
  text = text.replace(/^>\s+/gm, '');

  // Convert links to text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Convert wiki links to text
  text = text.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, target, alias) => {
    return alias || target;
  });

  // Remove images
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '[$1]');

  // Remove math delimiters
  text = text.replace(/\$\$\n?([\s\S]*?)\n?\$\$/g, '$1');
  text = text.replace(/\$([^$]+)\$/g, '$1');

  return text;
}
