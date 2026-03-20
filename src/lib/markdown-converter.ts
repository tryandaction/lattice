/**
 * Unified Markdown Converter Module
 *
 * Consolidates three separate utility files into a single, well-organized converter:
 * - HTML to Markdown conversion (for legacy Tiptap files)
 * - Formula conversion (OMML/MathML → LaTeX)
 * - Content normalization (auto-detection and processing)
 *
 * Architecture:
 * - Section 1: HTML → Markdown Conversion
 * - Section 2: Formula Conversion (OMML/MathML → LaTeX)
 * - Section 3: Content Normalization (Public API)
 */


// ============================================================================
// SECTION 1: HTML TO MARKDOWN CONVERSION
// ============================================================================

/**
 * Convert HTML content (from old Tiptap saves) to clean Markdown.
 * Handles all common HTML tags and preserves structure.
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

  // Headings (H1-H6)
  markdown = markdown.replace(/<h1>(.*?)<\/h1>/g, '# $1\n');
  markdown = markdown.replace(/<h2>(.*?)<\/h2>/g, '## $1\n');
  markdown = markdown.replace(/<h3>(.*?)<\/h3>/g, '### $1\n');
  markdown = markdown.replace(/<h4>(.*?)<\/h4>/g, '#### $1\n');
  markdown = markdown.replace(/<h5>(.*?)<\/h5>/g, '##### $1\n');
  markdown = markdown.replace(/<h6>(.*?)<\/h6>/g, '###### $1\n');

  // Text formatting
  markdown = markdown.replace(/<strong>(.*?)<\/strong>/g, '**$1**');
  markdown = markdown.replace(/<b>(.*?)<\/b>/g, '**$1**');
  markdown = markdown.replace(/<em>(.*?)<\/em>/g, '*$1*');
  markdown = markdown.replace(/<i>(.*?)<\/i>/g, '*$1*');
  markdown = markdown.replace(/<s>(.*?)<\/s>/g, '~~$1~~');
  markdown = markdown.replace(/<del>(.*?)<\/del>/g, '~~$1~~');
  markdown = markdown.replace(/<code>(.*?)<\/code>/g, '`$1`');
  markdown = markdown.replace(/<mark>(.*?)<\/mark>/g, '==$1==');

  // Links and images
  markdown = markdown.replace(/<a href="(.*?)">(.*?)<\/a>/g, '[$2]($1)');
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

  // ============================================================================
  // CRITICAL: Math conversion - Process BEFORE removing other HTML tags
  // ============================================================================

  // Inline math formulas - Handle all possible attribute orderings
  markdown = markdown.replace(/<span[^>]*?latex="([^"]*)"[^>]*?data-type="inline-math"[^>]*>.*?<\/span>/gi, '$$$1$$');
  markdown = markdown.replace(/<span[^>]*?data-type="inline-math"[^>]*?latex="([^"]*)"[^>]*>.*?<\/span>/gi, '$$$1$$');
  markdown = markdown.replace(/<span[^>]*?data-latex="([^"]*)"[^>]*?data-type="inline-math"[^>]*>.*?<\/span>/gi, '$$$1$$');
  markdown = markdown.replace(/<span[^>]*?data-type="inline-math"[^>]*?data-latex="([^"]*)"[^>]*>.*?<\/span>/gi, '$$$1$$');

  // Class-based inline math nodes
  markdown = markdown.replace(/<span[^>]*?class="[^"]*inline-math[^"]*"[^>]*?latex="([^"]*)"[^>]*>.*?<\/span>/gi, '$$$1$$');
  markdown = markdown.replace(/<span[^>]*?class="[^"]*inline-math[^"]*"[^>]*?data-latex="([^"]*)"[^>]*>.*?<\/span>/gi, '$$$1$$');
  markdown = markdown.replace(/<span[^>]*?latex="([^"]*)"[^>]*?class="[^"]*inline-math[^"]*"[^>]*>.*?<\/span>/gi, '$$$1$$');
  markdown = markdown.replace(/<span[^>]*?data-latex="([^"]*)"[^>]*?class="[^"]*inline-math[^"]*"[^>]*>.*?<\/span>/gi, '$$$1$$');

  // MathLive inline nodes
  markdown = markdown.replace(/<span[^>]*?class="[^"]*inline-mathlive-node[^"]*"[^>]*?latex="([^"]*)"[^>]*>.*?<\/span>/gi, '$$$1$$');
  markdown = markdown.replace(/<span[^>]*?class="[^"]*inline-mathlive-node[^"]*"[^>]*?data-latex="([^"]*)"[^>]*>.*?<\/span>/gi, '$$$1$$');

  // Generic inline-math-node
  markdown = markdown.replace(/<span[^>]*?class="[^"]*inline-math-node[^"]*"[^>]*?latex="([^"]*)"[^>]*>.*?<\/span>/gi, '$$$1$$');
  markdown = markdown.replace(/<span[^>]*?class="[^"]*inline-math-node[^"]*"[^>]*?data-latex="([^"]*)"[^>]*>.*?<\/span>/gi, '$$$1$$');

  // Block math formulas
  markdown = markdown.replace(/<div[^>]*?data-type="block-math"[^>]*?latex="([^"]*)"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');
  markdown = markdown.replace(/<div[^>]*?latex="([^"]*)"[^>]*?data-type="block-math"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');
  markdown = markdown.replace(/<div[^>]*?data-type="block-math"[^>]*?data-latex="([^"]*)"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');
  markdown = markdown.replace(/<div[^>]*?data-latex="([^"]*)"[^>]*?data-type="block-math"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');

  // Class-based block math nodes
  markdown = markdown.replace(/<div[^>]*?class="[^"]*block-math[^"]*"[^>]*?latex="([^"]*)"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');
  markdown = markdown.replace(/<div[^>]*?class="[^"]*block-math[^"]*"[^>]*?data-latex="([^"]*)"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');
  markdown = markdown.replace(/<div[^>]*?latex="([^"]*)"[^>]*?class="[^"]*block-math[^"]*"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');
  markdown = markdown.replace(/<div[^>]*?data-latex="([^"]*)"[^>]*?class="[^"]*block-math[^"]*"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');

  // MathLive block nodes
  markdown = markdown.replace(/<div[^>]*?class="[^"]*block-mathlive-node[^"]*"[^>]*?latex="([^"]*)"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');
  markdown = markdown.replace(/<div[^>]*?class="[^"]*block-mathlive-node[^"]*"[^>]*?data-latex="([^"]*)"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');

  // Generic block-math-node
  markdown = markdown.replace(/<div[^>]*?class="[^"]*block-math-node[^"]*"[^>]*?latex="([^"]*)"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');
  markdown = markdown.replace(/<div[^>]*?class="[^"]*block-math-node[^"]*"[^>]*?data-latex="([^"]*)"[^>]*>.*?<\/div>/gis, '\n$$$$\n$1\n$$$$\n');

  // Tables
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
 * Auto-detect and convert HTML content to Markdown.
 * Enhanced detection for various HTML patterns including math nodes.
 */
export function autoConvertToMarkdown(content: string): string {
  if (!content || typeof content !== 'string') return content || '';

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

  // Check for math-specific HTML patterns
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
    return htmlToMarkdown(content);
  }

  return content;
}

/**
 * Convert common inline HTML fragments inside Markdown to Markdown equivalents.
 * This avoids rendering raw HTML tags in Live Preview while keeping non-HTML text intact.
 * Code fences are preserved and skipped from conversion.
 */
export function convertInlineHtmlFragments(content: string): string {
  if (!content || typeof content !== 'string') return content || '';

  if (!/<[a-z][\s\S]*?>/i.test(content)) {
    return content;
  }

  const fences: string[] = [];
  const fenced = content.replace(/```[\s\S]*?```/g, (match) => {
    const token = `@@CODE_FENCE_${fences.length}@@`;
    fences.push(match);
    return token;
  });

  let result = fenced;

  // Paragraphs / line breaks
  result = result.replace(/<p[^>]*>/gi, '\n');
  result = result.replace(/<\/p>/gi, '\n');
  result = result.replace(/<br\s*\/?>/gi, '  \n');

  // Text formatting
  result = result.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  result = result.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  result = result.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  result = result.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');
  result = result.replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, '~~$1~~');
  result = result.replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, '~~$1~~');
  result = result.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  result = result.replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, '==$1==');

  // Links / images
  result = result.replace(
    /<a[^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi,
    '[$2]($1)'
  );
  result = result.replace(
    /<img[^>]*src=['"]([^'"]+)['"][^>]*alt=['"]([^'"]*)['"][^>]*\/?>/gi,
    '![$2]($1)'
  );
  result = result.replace(
    /<img[^>]*alt=['"]([^'"]*)['"][^>]*src=['"]([^'"]+)['"][^>]*\/?>/gi,
    '![$1]($2)'
  );
  result = result.replace(
    /<img[^>]*src=['"]([^'"]+)['"][^>]*\/?>/gi,
    '![]($1)'
  );

  // Block containers (best-effort)
  result = result.replace(/<\/?div[^>]*>/gi, '\n');

  // Restore code fences
  result = result.replace(/@@CODE_FENCE_(\d+)@@/g, (_, index) => fences[Number(index)] ?? '');

  return result;
}

// ============================================================================
// SECTION 2: FORMULA CONVERSION (OMML/MathML → LaTeX)
// ============================================================================

/**
 * Greek letter mapping (includes Unicode Mathematical Italic variants from PPTX)
 */
const GREEK_LETTERS: Record<string, string> = {
  // Lowercase regular
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta',
  'ε': '\\epsilon', 'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta',
  'ι': '\\iota', 'κ': '\\kappa', 'λ': '\\lambda', 'μ': '\\mu',
  'ν': '\\nu', 'ξ': '\\xi', 'ο': 'o', 'π': '\\pi',
  'ρ': '\\rho', 'σ': '\\sigma', 'τ': '\\tau', 'υ': '\\upsilon',
  'φ': '\\phi', 'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega',
  'ϵ': '\\varepsilon', 'ϑ': '\\vartheta', 'ϕ': '\\varphi',
  'ϱ': '\\varrho', 'ς': '\\varsigma',
  // Uppercase regular
  'Α': 'A', 'Β': 'B', 'Γ': '\\Gamma', 'Δ': '\\Delta',
  'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Θ': '\\Theta',
  'Ι': 'I', 'Κ': 'K', 'Λ': '\\Lambda', 'Μ': 'M',
  'Ν': 'N', 'Ξ': '\\Xi', 'Ο': 'O', 'Π': '\\Pi',
  'Ρ': 'P', 'Σ': '\\Sigma', 'Τ': 'T', 'Υ': '\\Upsilon',
  'Φ': '\\Phi', 'Χ': 'X', 'Ψ': '\\Psi', 'Ω': '\\Omega',
  // Mathematical Italic Greek (U+1D6FC-U+1D71B)
  '𝛼': '\\alpha', '𝛽': '\\beta', '𝛾': '\\gamma', '𝛿': '\\delta',
  '𝜀': '\\epsilon', '𝜁': '\\zeta', '𝜂': '\\eta', '𝜃': '\\theta',
  '𝜄': '\\iota', '𝜅': '\\kappa', '𝜆': '\\lambda', '𝜇': '\\mu',
  '𝜈': '\\nu', '𝜉': '\\xi', '𝜊': 'o', '𝜋': '\\pi',
  '𝜌': '\\rho', '𝜍': '\\varsigma', '𝜎': '\\sigma', '𝜏': '\\tau',
  '𝜐': '\\upsilon', '𝜑': '\\phi', '𝜒': '\\chi', '𝜓': '\\psi', '𝜔': '\\omega',
  '𝜕': '\\partial', '𝜖': '\\varepsilon', '𝜗': '\\vartheta', '𝜘': '\\varkappa',
  '𝜙': '\\varphi', '𝜚': '\\varrho', '𝜛': '\\varpi',
  // Mathematical Italic Uppercase Greek
  '𝛢': 'A', '𝛣': 'B', '𝛤': '\\Gamma', '𝛥': '\\Delta',
  '𝛦': 'E', '𝛧': 'Z', '𝛨': 'H', '𝛩': '\\Theta',
  '𝛪': 'I', '𝛫': 'K', '𝛬': '\\Lambda', '𝛭': 'M',
  '𝛮': 'N', '𝛯': '\\Xi', '𝛰': 'O', '𝛱': '\\Pi',
  '𝛲': 'P', '𝛳': '\\Theta', '𝛴': '\\Sigma', '𝛵': 'T',
  '𝛶': '\\Upsilon', '𝛷': '\\Phi', '𝛸': 'X', '𝛹': '\\Psi', '𝛺': '\\Omega',
};

/**
 * Mathematical operators and symbols mapping
 */
const MATH_SYMBOLS: Record<string, string> = {
  // Operators
  '∑': '\\sum', '∏': '\\prod', '∐': '\\coprod',
  '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint',
  '∯': '\\oiint', '∰': '\\oiiint',
  '∂': '\\partial', '∇': '\\nabla', '√': '\\sqrt',
  '∞': '\\infty', '±': '\\pm', '∓': '\\mp',
  '×': '\\times', '÷': '\\div', '·': '\\cdot', '∘': '\\circ',
  '⊕': '\\oplus', '⊗': '\\otimes', '⊖': '\\ominus',
  '†': '\\dagger', '‡': '\\ddagger', '★': '\\star',
  '∗': '\\ast', '⋆': '\\star',
  // Relations
  '≤': '\\leq', '≥': '\\geq', '≠': '\\neq', '≈': '\\approx',
  '≡': '\\equiv', '≅': '\\cong', '∼': '\\sim', '≃': '\\simeq',
  '∝': '\\propto', '≪': '\\ll', '≫': '\\gg',
  // Set theory
  '∈': '\\in', '∉': '\\notin', '∋': '\\ni', '∌': '\\notni',
  '⊂': '\\subset', '⊃': '\\supset', '⊆': '\\subseteq', '⊇': '\\supseteq',
  '∪': '\\cup', '∩': '\\cap', '∅': '\\emptyset', '∖': '\\setminus',
  // Logic
  '∀': '\\forall', '∃': '\\exists', '∄': '\\nexists',
  '¬': '\\neg', '∧': '\\land', '∨': '\\lor',
  // Arrows
  '→': '\\rightarrow', '←': '\\leftarrow', '↔': '\\leftrightarrow',
  '⇒': '\\Rightarrow', '⇐': '\\Leftarrow', '⇔': '\\Leftrightarrow',
  '↦': '\\mapsto', '↑': '\\uparrow', '↓': '\\downarrow',
  '⟶': '\\longrightarrow', '⟵': '\\longleftarrow',
  '⟹': '\\Longrightarrow', '⟸': '\\Longleftarrow',
  // Misc
  '…': '\\ldots', '⋯': '\\cdots', '⋮': '\\vdots', '⋱': '\\ddots',
  '′': "'", '″': "''", '‴': "'''",
  '°': '^\\circ', 'ℏ': '\\hbar', 'ℓ': '\\ell',
  '⟨': '\\langle', '⟩': '\\rangle',
  '⌊': '\\lfloor', '⌋': '\\rfloor',
  '⌈': '\\lceil', '⌉': '\\rceil',
  '∆': '\\Delta', // INCREMENT symbol (U+2206)
  '−': '-', // Minus sign
  // Mathematical Italic letters (U+1D400)
  '𝑎': 'a', '𝑏': 'b', '𝑐': 'c', '𝑑': 'd', '𝑒': 'e', '𝑓': 'f', '𝑔': 'g',
  '𝑕': 'h', '𝑖': 'i', '𝑗': 'j', '𝑘': 'k', '𝑙': 'l', '𝑚': 'm', '𝑛': 'n',
  '𝑜': 'o', '𝑝': 'p', '𝑞': 'q', '𝑟': 'r', '𝑠': 's', '𝑡': 't', '𝑢': 'u',
  '𝑣': 'v', '𝑤': 'w', '𝑥': 'x', '𝑦': 'y', '𝑧': 'z',
  '𝐴': 'A', '𝐵': 'B', '𝐶': 'C', '𝐷': 'D', '𝐸': 'E', '𝐹': 'F', '𝐺': 'G',
  '𝐻': 'H', '𝐼': 'I', '𝐽': 'J', '𝐾': 'K', '𝐿': 'L', '𝑀': 'M', '𝑁': 'N',
  '𝑂': 'O', '𝑃': 'P', '𝑄': 'Q', '𝑅': 'R', '𝑆': 'S', '𝑇': 'T', '𝑈': 'U',
  '𝑉': 'V', '𝑊': 'W', '𝑋': 'X', '𝑌': 'Y', '𝑍': 'Z',
  // Mathematical double-struck (blackboard bold)
  'ℕ': '\\mathbb{N}', 'ℤ': '\\mathbb{Z}', 'ℚ': '\\mathbb{Q}',
  'ℝ': '\\mathbb{R}', 'ℂ': '\\mathbb{C}', 'ℙ': '\\mathbb{P}',
};

/**
 * Convert a single character to LaTeX if it's a special symbol
 */
export function convertCharToLatex(char: string): string {
  if (GREEK_LETTERS[char]) return GREEK_LETTERS[char];
  if (MATH_SYMBOLS[char]) return MATH_SYMBOLS[char];
  return char;
}

/**
 * Convert text with special characters to LaTeX
 */
export function convertTextToLatex(text: string): string {
  let result = '';
  for (const char of text) {
    result += convertCharToLatex(char);
  }
  return result;
}

/**
 * Convert OMML (Office Math Markup Language) to LaTeX.
 * Used for formulas from Microsoft Office documents (PPTX, DOCX).
 */
export function convertOmmlToLatex(ommlXml: string): string {
  try {
    // Normalize namespace prefixes for easier parsing
    const cleanedXml = ommlXml
      .replace(/xmlns:[a-zA-Z0-9]+="[^"]*"/g, '')
      .replace(/xmlns="[^"]*"/g, '')
      // Remove namespace prefixes from attributes first
      .replace(/\s([a-zA-Z0-9]+):([a-zA-Z0-9]+)=/g, ' $2=')
      // Normalize element prefixes
      .replace(/<m:/g, '<')
      .replace(/<\/m:/g, '</')
      .replace(/<a14:/g, '<')
      .replace(/<\/a14:/g, '</')
      .replace(/<([a-zA-Z0-9]+):/g, '<')
      .replace(/<\/([a-zA-Z0-9]+):/g, '</');

    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanedXml, 'text/xml');

    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      console.warn('[OMML] Parse error, using manual parser');
      return parseOmmlManually(ommlXml);
    }

    const mathElement = doc.querySelector('oMath') || doc.querySelector('oMathPara');
    if (!mathElement) {
      return parseOmmlManually(ommlXml);
    }

    const result = processOmmlElement(mathElement);
    return result && result.trim() ? result : parseOmmlManually(ommlXml);
  } catch (error) {
    console.warn('[OMML] Conversion error:', error);
    return parseOmmlManually(ommlXml);
  }
}

/**
 * Manual OMML parsing using regex - fallback when DOM parsing fails
 */
function parseOmmlManually(ommlXml: string): string {
  let xml = ommlXml
    .replace(/\s([a-zA-Z0-9]+):([a-zA-Z0-9]+)=/g, ' $2=')
    .replace(/<m:/g, '<')
    .replace(/<\/m:/g, '</')
    .replace(/<([a-zA-Z0-9]+):/g, '<')
    .replace(/<\/([a-zA-Z0-9]+):/g, '</');

  let maxIterations = 20;
  let changed = true;

  while (changed && maxIterations > 0) {
    changed = false;
    maxIterations--;
    const prevXml = xml;

    // Fractions
    xml = xml.replace(/<f[^>]*>[\s\S]*?<num[^>]*>([\s\S]*?)<\/num>[\s\S]*?<den[^>]*>([\s\S]*?)<\/den>[\s\S]*?<\/f>/gi,
      (match, num, den) => `\\frac{${extractInnerText(num)}}{${extractInnerText(den)}}`);

    // Subscripts
    xml = xml.replace(/<sSub[^>]*>[\s\S]*?<e[^>]*>([\s\S]*?)<\/e>[\s\S]*?<sub[^>]*>([\s\S]*?)<\/sub>[\s\S]*?<\/sSub>/gi,
      (match, base, sub) => `{${extractInnerText(base)}}_{${extractInnerText(sub)}}`);

    // Superscripts
    xml = xml.replace(/<sSup[^>]*>[\s\S]*?<e[^>]*>([\s\S]*?)<\/e>[\s\S]*?<sup[^>]*>([\s\S]*?)<\/sup>[\s\S]*?<\/sSup>/gi,
      (match, base, sup) => `{${extractInnerText(base)}}^{${extractInnerText(sup)}}`);

    // Radicals (square roots)
    xml = xml.replace(/<rad[^>]*>([\s\S]*?)<\/rad>/gi, (match, innerContent) => {
      const degMatch = innerContent.match(/<deg[^>]*>([\s\S]*?)<\/deg>/i);
      const degText = degMatch ? extractInnerText(degMatch[1]).trim() : '';

      const withoutDeg = innerContent.replace(/<deg[^>]*>[\s\S]*?<\/deg>/gi, '');
      const withoutRadPr = withoutDeg.replace(/<radPr[^>]*>[\s\S]*?<\/radPr>/gi, '').replace(/<radPr[^>]*\/>/gi, '');

      const eMatch = withoutRadPr.match(/<e[^>]*>([\s\S]*?)<\/e>/i);
      const contentText = eMatch ? extractInnerText(eMatch[1]).trim() : extractInnerText(withoutRadPr).trim();

      if (degText && degText !== '2') {
        return `\\sqrt[${degText}]{${contentText}}`;
      }
      return `\\sqrt{${contentText}}`;
    });

    // Text runs
    xml = xml.replace(/<r[^>]*>[\s\S]*?<t[^>]*>([^<]*)<\/t>[\s\S]*?<\/r>/gi,
      (match, text) => convertTextToLatex(text));

    xml = xml.replace(/<t[^>]*>([^<]*)<\/t>/gi,
      (match, text) => convertTextToLatex(text));

    if (xml !== prevXml) {
      changed = true;
    }
  }

  let result = xml.replace(/<[^>]+>/g, '');
  result = result.replace(/\s+/g, ' ').trim();
  return result;
}

/**
 * Extract inner text from XML fragment
 */
function extractInnerText(xml: string): string {
  if (!xml) return '';

  if (xml.includes('\\frac') || xml.includes('\\sqrt') || xml.includes('_{') || xml.includes('^{')) {
    return xml.replace(/<[^>]+>/g, '').trim();
  }

  const textPattern = /<t[^>]*>([^<]*)<\/t>/gi;
  let text = '';
  let match;
  while ((match = textPattern.exec(xml)) !== null) {
    text += match[1];
  }

  if (text) {
    return convertTextToLatex(text);
  }

  const stripped = xml.replace(/<[^>]+>/g, '').trim();
  return convertTextToLatex(stripped);
}

/**
 * Process an OMML element (DOM-based)
 */
function processOmmlElement(element: Element): string {
  const localName = element.localName || element.nodeName.replace(/^m:/, '');

  switch (localName) {
    case 'oMath':
    case 'oMathPara':
      return processChildren(element);
    case 'r':
      return processRun(element);
    case 'f':
      return processFraction(element);
    case 'rad':
      return processRadical(element);
    case 'sSub':
      return processSubscript(element);
    case 'sSup':
      return processSuperscript(element);
    case 'sSubSup':
      return processSubSup(element);
    case 't':
      return convertTextToLatex(element.textContent || '');
    default:
      return processChildren(element);
  }
}

function processChildren(element: Element): string {
  let result = '';
  for (const child of Array.from(element.children)) {
    result += processOmmlElement(child);
  }
  return result;
}

function findChild(element: Element, localName: string): Element | null {
  for (const child of Array.from(element.children)) {
    const childLocalName = child.localName || child.nodeName.replace(/^m:/, '');
    if (childLocalName === localName) {
      return child;
    }
  }
  return null;
}

function processRun(element: Element): string {
  const textElement = findChild(element, 't');
  if (textElement) {
    return convertTextToLatex(textElement.textContent || '');
  }
  return processChildren(element);
}

function processFraction(element: Element): string {
  const num = findChild(element, 'num');
  const den = findChild(element, 'den');
  const numLatex = num ? processChildren(num) : '';
  const denLatex = den ? processChildren(den) : '';
  return `\\frac{${numLatex}}{${denLatex}}`;
}

function processRadical(element: Element): string {
  const deg = findChild(element, 'deg');
  const e = findChild(element, 'e');

  let eLatex = '';
  if (e) {
    eLatex = processChildren(e);
  } else {
    for (const child of Array.from(element.children)) {
      const childName = child.localName || child.nodeName.replace(/^m:/, '');
      if (childName !== 'deg' && childName !== 'radPr') {
        eLatex += processOmmlElement(child);
      }
    }
  }

  eLatex = eLatex.trim();

  if (deg) {
    const degLatex = processChildren(deg).trim();
    if (degLatex && degLatex !== '2') {
      return `\\sqrt[${degLatex}]{${eLatex}}`;
    }
  }

  return `\\sqrt{${eLatex}}`;
}

function processSubscript(element: Element): string {
  const base = findChild(element, 'e');
  const sub = findChild(element, 'sub');
  const baseLatex = base ? processChildren(base) : '';
  const subLatex = sub ? processChildren(sub) : '';
  if (!subLatex) return baseLatex;
  return `{${baseLatex}}_{${subLatex}}`;
}

function processSuperscript(element: Element): string {
  const base = findChild(element, 'e');
  const sup = findChild(element, 'sup');
  const baseLatex = base ? processChildren(base) : '';
  const supLatex = sup ? processChildren(sup) : '';
  if (!supLatex) return baseLatex;
  return `{${baseLatex}}^{${supLatex}}`;
}

function processSubSup(element: Element): string {
  const base = findChild(element, 'e');
  const sub = findChild(element, 'sub');
  const sup = findChild(element, 'sup');
  const baseLatex = base ? processChildren(base) : '';
  const subLatex = sub ? processChildren(sub) : '';
  const supLatex = sup ? processChildren(sup) : '';
  if (!subLatex && !supLatex) return baseLatex;
  if (!supLatex) return `{${baseLatex}}_{${subLatex}}`;
  if (!subLatex) return `{${baseLatex}}^{${supLatex}}`;
  return `{${baseLatex}}_{${subLatex}}^{${supLatex}}`;
}

/**
 * Convert MathML to LaTeX (simplified converter)
 */
export function convertMathmlToLatex(mathmlXml: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(mathmlXml, 'text/xml');

    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      return mathmlXml.replace(/<[^>]+>/g, ' ').trim();
    }

    const mathElement = doc.querySelector('math');
    return mathElement ? processMathmlElement(mathElement) : '';
  } catch (error) {
    console.warn('MathML conversion error:', error);
    return mathmlXml.replace(/<[^>]+>/g, ' ').trim();
  }
}

function processMathmlElement(element: Element): string {
  const tagName = element.tagName.toLowerCase().replace('m:', '');

  switch (tagName) {
    case 'math':
    case 'mrow':
      return processMathmlChildren(element);
    case 'mi':
    case 'mn':
    case 'mo':
      return convertCharToLatex(element.textContent || '');
    case 'mfrac':
      const [num, den] = Array.from(element.children);
      return `\\frac{${processMathmlElement(num)}}{${processMathmlElement(den)}}`;
    case 'msqrt':
      return `\\sqrt{${processMathmlChildren(element)}}`;
    case 'msub': {
      const [base, sub] = Array.from(element.children);
      return `{${processMathmlElement(base)}}_{${processMathmlElement(sub)}}`;
    }
    case 'msup': {
      const [base, sup] = Array.from(element.children);
      return `{${processMathmlElement(base)}}^{${processMathmlElement(sup)}}`;
    }
    case 'msubsup': {
      const [base, sub, sup] = Array.from(element.children);
      return `{${processMathmlElement(base)}}_{${processMathmlElement(sub)}}^{${processMathmlElement(sup)}}`;
    }
    default:
      return processMathmlChildren(element);
  }
}

function processMathmlChildren(element: Element): string {
  return Array.from(element.children)
    .map(child => processMathmlElement(child))
    .join('');
}

// ============================================================================
// SECTION 3: CONTENT NORMALIZATION (Public API)
// ============================================================================

/**
 * LaTeX patterns that indicate mathematical content
 */
const LATEX_PATTERNS = [
  /\\frac\{/, /\\sum/, /\\int/, /\\prod/, /\\lim/, /\\sqrt/, /\\partial/, /\\infty/,
  /\\alpha/, /\\beta/, /\\gamma/, /\\delta/, /\\epsilon/, /\\theta/, /\\lambda/, /\\mu/,
  /\\pi/, /\\sigma/, /\\omega/, /\\nabla/, /\\mathbb\{/, /\\mathcal\{/, /\\mathrm\{/,
  /\\text\{/, /\\left/, /\\right/, /\\cdot/, /\\times/, /\\leq/, /\\geq/, /\\neq/,
  /\\approx/, /\\equiv/, /\\rightarrow/, /\\leftarrow/, /\\Rightarrow/, /\\Leftarrow/,
];

/**
 * Detect if a string contains LaTeX math patterns
 */
export function detectLatexPatterns(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  return LATEX_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Convert various LaTeX math delimiters to standard format:
 * - \\(...\\) → $...$
 * - \\[...\\] → $$...$$
 * - \\begin{equation}...\\end{equation} → $$...$$
 */
function normalizeMathDelimiters(content: string): string {
  if (!content || typeof content !== 'string') return content || '';

  let result = content;

  // Inline math: \(...\) → $...$
  result = result.replace(/\\\((.+?)\\\)/gs, (_, math) => `$${math}$`);

  // Block math: \[...\] → $$...$$
  result = result.replace(/\\\[(.+?)\\\]/gs, (_, math) => `$$${math}$$`);

  // Equation environments → $$...$$
  result = result.replace(/\\begin\{equation\*?\}(.+?)\\end\{equation\*?\}/gs, (_, math) => `$$${math.trim()}$$`);
  result = result.replace(/\\begin\{align\*?\}(.+?)\\end\{align\*?\}/gs, (_, math) => `$$${math.trim()}$$`);

  return result;
}

/**
 * Ensure tables have proper newlines for remark-gfm detection
 */
function normalizeTableWhitespace(content: string): string {
  if (!content || typeof content !== 'string') return content || '';

  const splitTableRow = (line: string): string[] | null => {
    if (!line || !line.includes('|')) return null;
    const trimmed = line.trim();
    if (!trimmed) return null;

    const isEscaped = (source: string, index: number): boolean => {
      let backslashes = 0;
      for (let i = index - 1; i >= 0 && source[i] === '\\'; i--) {
        backslashes++;
      }
      return backslashes % 2 === 1;
    };

    let working = trimmed;
    if (working.startsWith('|')) {
      working = working.slice(1);
    }
    if (working.endsWith('|') && !isEscaped(working, working.length - 1)) {
      working = working.slice(0, -1);
    }

    const cells: string[] = [];
    let current = '';
    let inCode = false;
    let codeFence = '';
    let i = 0;

    while (i < working.length) {
      const ch = working[i];

      if (ch === '\\' && i + 1 < working.length && working[i + 1] === '|') {
        current += '|';
        i += 2;
        continue;
      }

      if (ch === '`') {
        let j = i;
        while (j < working.length && working[j] === '`') j++;
        const fence = working.slice(i, j);
        if (!inCode) {
          inCode = true;
          codeFence = fence;
        } else if (fence === codeFence) {
          inCode = false;
          codeFence = '';
        }
        current += fence;
        i = j;
        continue;
      }

      if (ch === '|' && !inCode) {
        cells.push(current.trim());
        current = '';
        i += 1;
        continue;
      }

      current += ch;
      i += 1;
    }

    cells.push(current.trim());
    return cells.length > 0 ? cells : null;
  };

  const isSeparatorRow = (line: string): boolean => {
    const cells = splitTableRow(line);
    if (!cells) return false;
    return cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()));
  };

  const lines = content.split('\n');
  const result: string[] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    const rowCells = splitTableRow(trimmedLine);
    const startsTable = !inTable && rowCells && lines[i + 1] && isSeparatorRow(lines[i + 1].trim());
    const isTableLine = inTable ? !!rowCells : startsTable;

    if (startsTable) {
      inTable = true;
      if (result.length > 0 && result[result.length - 1].trim() !== '') {
        result.push('');
      }
      result.push(line);
    } else if (isTableLine && inTable) {
      result.push(line);
    } else if (!isTableLine && inTable) {
      inTable = false;
      if (trimmedLine !== '') {
        result.push('');
      }
      result.push(line);
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}

/**
 * Tolerant formula detection - finds formulas even with missing delimiters
 */
export function detectFormulasTolerantly(text: string): Array<{
  start: number;
  end: number;
  latex: string;
  isBlock: boolean;
}> {
  if (!text || typeof text !== 'string') return [];

  const formulas: Array<{
    start: number;
    end: number;
    latex: string;
    isBlock: boolean;
  }> = [];

  // Block math: $$...$$
  const blockMathRegex = /\$\$([^$]+)\$\$/g;
  let match;
  while ((match = blockMathRegex.exec(text)) !== null) {
    formulas.push({
      start: match.index,
      end: match.index + match[0].length,
      latex: match[1].trim(),
      isBlock: true,
    });
  }

  // Inline math: $...$
  const inlineMathRegex = /(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g;
  while ((match = inlineMathRegex.exec(text)) !== null) {
    formulas.push({
      start: match.index,
      end: match.index + match[0].length,
      latex: match[1].trim(),
      isBlock: false,
    });
  }

  return formulas;
}

/**
 * Main normalization function - the public API.
 * Auto-converts HTML to Markdown if detected, then normalizes math delimiters and tables.
 */
export function normalizeScientificText(rawContent: string): string {
  if (!rawContent || typeof rawContent !== 'string') return rawContent || '';

  let result = rawContent;

  // Step 0: Auto-convert HTML to Markdown (for legacy files)
  result = autoConvertToMarkdown(result);

  // Step 0.5: Convert inline HTML fragments inside Markdown (best-effort)
  result = convertInlineHtmlFragments(result);

  // Step 1: Normalize math delimiters (convert \(...\) to $...$, etc.)
  result = normalizeMathDelimiters(result);

  // Step 2: Normalize table whitespace
  result = normalizeTableWhitespace(result);

  return result;
}

// Export individual functions for testing
export {
  normalizeMathDelimiters,
  normalizeTableWhitespace,
};

/**
 * Detected formula with position and type
 */
export interface DetectedFormula {
  latex: string;
  displayMode: boolean;
  start: number;
  end: number;
  original: string;
}

/**
 * Detect all LaTeX formulas in text
 */
export function detectLatexInText(text: string): DetectedFormula[] {
  const formulas: DetectedFormula[] = [];

  // Block math $$...$$
  let match: RegExpExecArray | null;
  const blockDollarRegex = /\$\$([^$]+)\$\$/g;
  while ((match = blockDollarRegex.exec(text)) !== null) {
    formulas.push({
      latex: match[1].trim(),
      displayMode: true,
      start: match.index,
      end: match.index + match[0].length,
      original: match[0],
    });
  }

  // Inline math $...$
  const inlineDollarRegex = /(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g;
  while ((match = inlineDollarRegex.exec(text)) !== null) {
    const overlaps = formulas.some(
      f => (match!.index >= f.start && match!.index < f.end) ||
           (match!.index + match![0].length > f.start && match!.index + match![0].length <= f.end)
    );
    if (!overlaps) {
      formulas.push({
        latex: match[1].trim(),
        displayMode: false,
        start: match.index,
        end: match.index + match[0].length,
        original: match[0],
      });
    }
  }

  formulas.sort((a, b) => a.start - b.start);
  return formulas;
}
