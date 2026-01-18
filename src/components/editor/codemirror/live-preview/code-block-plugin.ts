/**
 * Code Block Plugin for Live Preview
 * Renders fenced code blocks with syntax highlighting
 * 
 * Requirements: 5.1-5.6
 * 
 * This plugin provides Obsidian-like live preview for code blocks:
 * - When cursor is NOT on a code block, it renders with syntax highlighting
 * - When cursor IS on a code block, raw markdown is shown for editing
 */

import {
  Decoration,
  DecorationSet,
  WidgetType,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { shouldRevealLine } from './cursor-context-plugin';

// Highlight.js will be loaded dynamically
let hljs: typeof import('highlight.js').default | null = null;
let hljsLoadPromise: Promise<typeof import('highlight.js').default> | null = null;

/**
 * Load highlight.js dynamically
 */
async function loadHighlightJS(): Promise<typeof import('highlight.js').default> {
  if (hljs) return hljs;
  
  if (hljsLoadPromise) return hljsLoadPromise;
  
  hljsLoadPromise = import('highlight.js').then((module) => {
    hljs = module.default;
    return hljs;
  }).catch((err) => {
    console.error('Failed to load highlight.js:', err);
    throw err;
  });
  
  return hljsLoadPromise;
}

// Pre-load highlight.js
if (typeof window !== 'undefined') {
  loadHighlightJS();
}

/**
 * Decoration entry for sorting
 */
interface DecorationEntry {
  from: number;
  to: number;
  decoration: Decoration;
  isLine?: boolean;
}

/**
 * Code block widget with line numbers and syntax highlighting
 */
class CodeBlockWidget extends WidgetType {
  constructor(
    private code: string,
    private language: string,
    private showLineNumbers: boolean = true,
    private from: number = 0,
    private to: number = 0
  ) {
    super();
  }
  
  eq(other: CodeBlockWidget) {
    return other.code === this.code && 
           other.language === this.language &&
           other.showLineNumbers === this.showLineNumbers;
  }
  
  toDOM(view: EditorView) {
    const container = document.createElement('div');
    container.className = 'cm-code-block-widget';
    container.dataset.from = String(this.from);
    container.dataset.to = String(this.to);
    
    // Handle click to position cursor at code block start
    container.addEventListener('mousedown', (e) => {
      // Don't intercept copy button clicks
      if ((e.target as HTMLElement).closest('.cm-code-block-copy')) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      // Position cursor at the start of the code block (after ```lang)
      const codeStart = this.from + 3 + this.language.length + 1; // ``` + lang + newline
      view.dispatch({
        selection: { anchor: codeStart, head: codeStart },
        scrollIntoView: true,
      });
      view.focus();
    });
    
    // Header with language label and copy button
    const header = document.createElement('div');
    header.className = 'cm-code-block-header';
    
    const langLabel = document.createElement('span');
    langLabel.className = 'cm-code-block-lang';
    langLabel.textContent = this.language || 'text';
    header.appendChild(langLabel);
    
    const copyBtn = document.createElement('button');
    copyBtn.className = 'cm-code-block-copy';
    copyBtn.textContent = 'Copy';
    copyBtn.title = 'Copy code';
    copyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(this.code).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
        }, 2000);
      });
    });
    header.appendChild(copyBtn);
    
    container.appendChild(header);
    
    // Code content wrapper (for line numbers + code)
    const codeWrapper = document.createElement('div');
    codeWrapper.className = 'cm-code-block-wrapper';
    
    const lines = this.code.split('\n');
    
    // Add line numbers if enabled
    if (this.showLineNumbers && lines.length > 1) {
      const lineNumbers = document.createElement('div');
      lineNumbers.className = 'cm-code-block-line-numbers';
      
      for (let i = 1; i <= lines.length; i++) {
        const lineNum = document.createElement('div');
        lineNum.className = 'cm-code-block-line-number';
        lineNum.textContent = String(i);
        lineNumbers.appendChild(lineNum);
      }
      
      codeWrapper.appendChild(lineNumbers);
    }
    
    // Code content
    const pre = document.createElement('pre');
    pre.className = 'cm-code-block-pre';
    
    const code = document.createElement('code');
    code.className = `cm-code-block-code language-${this.language}`;
    code.textContent = this.code;
    
    // Apply syntax highlighting
    if (hljs && this.language) {
      try {
        const result = hljs.highlight(this.code, { language: this.language });
        code.innerHTML = result.value;
      } catch {
        // Language not supported, use plain text
      }
    } else if (!hljs) {
      // Load and highlight when ready
      loadHighlightJS().then((h) => {
        if (this.language) {
          try {
            const result = h.highlight(this.code, { language: this.language });
            code.innerHTML = result.value;
          } catch {
            // Language not supported
          }
        }
      }).catch(() => {
        // Failed to load, keep plain text
      });
    }
    
    pre.appendChild(code);
    codeWrapper.appendChild(pre);
    container.appendChild(codeWrapper);
    
    return container;
  }
  
  ignoreEvent(e: Event) {
    return e.type === 'click';
  }
}

/**
 * Parse code blocks from document
 */
interface CodeBlockMatch {
  from: number;
  to: number;
  language: string;
  code: string;
  startLine: number;
  endLine: number;
}

function parseCodeBlocks(doc: { toString: () => string; lineAt: (pos: number) => { number: number } }): CodeBlockMatch[] {
  const text = doc.toString();
  const blocks: CodeBlockMatch[] = [];
  const lines = text.split('\n');
  let offset = 0;
  let inBlock = false;
  let blockStart = 0;
  let blockLang = '';
  let blockCode: string[] = [];
  let blockStartLine = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = offset;
    const lineEnd = offset + line.length;
    
    if (!inBlock && line.match(/^```(\w*)$/)) {
      // Start of code block
      inBlock = true;
      blockStart = lineStart;
      blockLang = line.slice(3);
      blockCode = [];
      blockStartLine = i + 1;
    } else if (inBlock && line === '```') {
      // End of code block
      blocks.push({
        from: blockStart,
        to: lineEnd,
        language: blockLang,
        code: blockCode.join('\n'),
        startLine: blockStartLine,
        endLine: i + 1,
      });
      inBlock = false;
    } else if (inBlock) {
      blockCode.push(line);
    }
    
    offset = lineEnd + 1; // +1 for newline
  }
  
  return blocks;
}

/**
 * Build code block decorations
 * Uses line-based reveal logic for Obsidian-like behavior
 * 
 * IMPORTANT: CodeMirror does not allow Decoration.replace() to span line breaks.
 * For multi-line code blocks, we use line decorations to hide content and
 * place the widget on the first line.
 */
function buildCodeBlockDecorations(state: EditorState): DecorationSet {
  const decorations: DecorationEntry[] = [];
  const doc = state.doc;
  
  const codeBlocks = parseCodeBlocks(doc);
  
  for (const block of codeBlocks) {
    // Check if any line of the code block should reveal syntax
    let shouldReveal = false;
    for (let lineNum = block.startLine; lineNum <= block.endLine; lineNum++) {
      if (shouldRevealLine(state, lineNum)) {
        shouldReveal = true;
        break;
      }
    }
    
    const isMultiLine = block.startLine !== block.endLine;
    
    if (!shouldReveal) {
      if (isMultiLine) {
        // Multi-line code block: use widget + line hiding
        const firstLine = doc.line(block.startLine);
        
        // Add widget at the start of the first line
        decorations.push({
          from: firstLine.from,
          to: firstLine.from,
          decoration: Decoration.widget({
            widget: new CodeBlockWidget(block.code, block.language, true, block.from, block.to),
            side: -1,
          }),
          isLine: true,
        });
        
        // Hide all lines of the code block
        for (let lineNum = block.startLine; lineNum <= block.endLine; lineNum++) {
          const line = doc.line(lineNum);
          decorations.push({
            from: line.from,
            to: line.from,
            decoration: Decoration.line({ class: 'cm-code-block-hidden' }),
            isLine: true,
          });
        }
      } else {
        // Single line code block (rare but possible): safe to use replace
        decorations.push({
          from: block.from,
          to: block.to,
          decoration: Decoration.replace({
            widget: new CodeBlockWidget(block.code, block.language, true, block.from, block.to),
          }),
        });
      }
    } else {
      // Add styling for code block when editing
      for (let lineNum = block.startLine; lineNum <= block.endLine; lineNum++) {
        const line = doc.line(lineNum);
        decorations.push({
          from: line.from,
          to: line.from,
          decoration: Decoration.line({ class: 'cm-code-block-line cm-code-block-editing' }),
          isLine: true,
        });
      }
    }
  }
  
  // Sort decorations by position
  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  
  // Convert to Range format
  // Line decorations (isLine=true) only need from position
  const ranges = decorations.map(d => {
    if (d.isLine) {
      return d.decoration.range(d.from);
    }
    return d.decoration.range(d.from, d.to);
  });
  
  // Decoration.set requires sorted ranges, pass true to indicate they are sorted
  return Decoration.set(ranges, true);
}

/**
 * Code block ViewPlugin - using ViewPlugin to properly handle block-level decorations
 * StateField cannot provide block decorations via plugins
 */
export const codeBlockPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    
    constructor(view: EditorView) {
      this.decorations = buildCodeBlockDecorations(view.state);
    }
    
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildCodeBlockDecorations(update.state);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
