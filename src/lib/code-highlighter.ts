/**
 * Simple code syntax highlighter for rendered code views
 * 
 * Provides basic syntax highlighting for Python code without
 * requiring a full editor instance.
 */

// Python keywords
const PYTHON_KEYWORDS = new Set([
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
  'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from',
  'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not',
  'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
  'True', 'False', 'None',
]);

// Python built-in functions
const PYTHON_BUILTINS = new Set([
  'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict', 'set',
  'tuple', 'bool', 'type', 'isinstance', 'hasattr', 'getattr', 'setattr',
  'open', 'input', 'sum', 'min', 'max', 'abs', 'round', 'sorted', 'reversed',
  'enumerate', 'zip', 'map', 'filter', 'any', 'all', 'super', 'property',
  'staticmethod', 'classmethod', 'object', 'Exception', 'ValueError',
  'TypeError', 'KeyError', 'IndexError', 'AttributeError', 'RuntimeError',
]);

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Highlight Python code
 */
function highlightPython(code: string): string {
  const lines = code.split('\n');
  const highlightedLines: string[] = [];

  for (const line of lines) {
    let result = '';
    let i = 0;

    while (i < line.length) {
      // Comments
      if (line[i] === '#') {
        result += `<span class="hljs-comment">${escapeHtml(line.slice(i))}</span>`;
        break;
      }

      // Strings (single or double quotes, including triple quotes)
      if (line[i] === '"' || line[i] === "'") {
        const quote = line[i];
        const isTriple = line.slice(i, i + 3) === quote.repeat(3);
        const endQuote = isTriple ? quote.repeat(3) : quote;
        const startIdx = i;
        i += isTriple ? 3 : 1;

        while (i < line.length) {
          if (line[i] === '\\' && i + 1 < line.length) {
            i += 2;
            continue;
          }
          if (line.slice(i, i + endQuote.length) === endQuote) {
            i += endQuote.length;
            break;
          }
          i++;
        }

        result += `<span class="hljs-string">${escapeHtml(line.slice(startIdx, i))}</span>`;
        continue;
      }

      // Numbers
      if (/\d/.test(line[i]) && (i === 0 || !/\w/.test(line[i - 1]))) {
        const startIdx = i;
        while (i < line.length && /[\d.eExX]/.test(line[i])) {
          i++;
        }
        result += `<span class="hljs-number">${escapeHtml(line.slice(startIdx, i))}</span>`;
        continue;
      }

      // Words (keywords, builtins, identifiers)
      if (/[a-zA-Z_]/.test(line[i])) {
        const startIdx = i;
        while (i < line.length && /\w/.test(line[i])) {
          i++;
        }
        const word = line.slice(startIdx, i);

        if (PYTHON_KEYWORDS.has(word)) {
          result += `<span class="hljs-keyword">${escapeHtml(word)}</span>`;
        } else if (PYTHON_BUILTINS.has(word)) {
          result += `<span class="hljs-built_in">${escapeHtml(word)}</span>`;
        } else if (line[i] === '(') {
          result += `<span class="hljs-title function_">${escapeHtml(word)}</span>`;
        } else {
          result += escapeHtml(word);
        }
        continue;
      }

      // Operators and punctuation
      result += escapeHtml(line[i]);
      i++;
    }

    highlightedLines.push(result);
  }

  return highlightedLines.join('\n');
}

/**
 * Highlight code based on language
 */
export function highlightCode(code: string, language: string): string {
  if (!code) return '';
  
  switch (language.toLowerCase()) {
    case 'python':
    case 'py':
      return highlightPython(code);
    default:
      return escapeHtml(code);
  }
}
