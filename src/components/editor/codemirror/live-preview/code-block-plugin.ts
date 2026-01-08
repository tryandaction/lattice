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
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  WidgetType,
  EditorView,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
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
 * Code block widget
 */
class CodeBlockWidget extends WidgetType {
  constructor(
    private code: string,
    private language: string
  ) {
    super();
  }
  
  eq(other: CodeBlockWidget) {
    return other.code === this.code && other.language === this.language;
  }
  
  toDOM() {
    const container = document.createElement('div');
    container.className = 'cm-code-block-widget';
    
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
    container.appendChild(pre);
    
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
 */
function buildCodeBlockDecorations(view: EditorView): DecorationSet {
  const decorations: DecorationEntry[] = [];
  const doc = view.state.doc;
  
  const codeBlocks = parseCodeBlocks(doc);
  
  for (const block of codeBlocks) {
    // Check if any line of the code block should reveal syntax
    let shouldReveal = false;
    for (let lineNum = block.startLine; lineNum <= block.endLine; lineNum++) {
      if (shouldRevealLine(view.state, lineNum)) {
        shouldReveal = true;
        break;
      }
    }
    
    if (!shouldReveal) {
      // Replace entire block with widget
      decorations.push({
        from: block.from,
        to: block.to,
        decoration: Decoration.replace({
          widget: new CodeBlockWidget(block.code, block.language),
          block: true,
        }),
      });
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
  
  // Sort decorations: line decorations first, then by position
  decorations.sort((a, b) => {
    if (a.isLine && !b.isLine) return -1;
    if (!a.isLine && b.isLine) return 1;
    return a.from - b.from || a.to - b.to;
  });
  
  // Build the decoration set
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, decoration } of decorations) {
    try {
      builder.add(from, to, decoration);
    } catch (e) {
      console.warn('Invalid code block decoration range:', from, to, e);
    }
  }
  
  return builder.finish();
}

/**
 * Code block view plugin
 */
export const codeBlockPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    
    constructor(view: EditorView) {
      this.decorations = buildCodeBlockDecorations(view);
    }
    
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildCodeBlockDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
