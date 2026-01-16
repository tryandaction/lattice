/**
 * Math Rendering Plugin for Live Preview
 * Renders LaTeX math expressions using KaTeX
 * 
 * Requirements: 4.1-4.6
 * 
 * This plugin provides Obsidian-like live preview for math:
 * - When cursor is NOT on a math expression line, it renders as formatted math
 * - When cursor IS on a math expression line, raw LaTeX is shown for editing
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

// KaTeX will be loaded dynamically
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let katex: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let katexLoadPromise: Promise<any> | null = null;

/**
 * Load KaTeX dynamically
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadKaTeX(): Promise<any> {
  if (katex) return katex;
  
  if (katexLoadPromise) return katexLoadPromise;
  
  katexLoadPromise = import('katex').then((module) => {
    katex = module.default || module;
    return katex;
  }).catch((err) => {
    console.error('Failed to load KaTeX:', err);
    throw err;
  });
  
  return katexLoadPromise;
}

// Pre-load KaTeX
if (typeof window !== 'undefined') {
  loadKaTeX();
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
 * Math render widget
 */
class MathWidget extends WidgetType {
  constructor(
    private latex: string,
    private isBlock: boolean,
    private from: number,
    private to: number
  ) {
    super();
  }
  
  eq(other: MathWidget) {
    return other.latex === this.latex && other.isBlock === this.isBlock;
  }
  
  toDOM(view: EditorView) {
    const container = document.createElement(this.isBlock ? 'div' : 'span');
    container.className = this.isBlock ? 'cm-math-block' : 'cm-math-inline';
    container.dataset.from = String(this.from);
    container.dataset.to = String(this.to);
    
    // Handle click to position cursor
    container.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: this.from, head: this.from },
        scrollIntoView: true,
      });
      view.focus();
    });
    
    if (katex) {
      try {
        katex.render(this.latex, container, {
          displayMode: this.isBlock,
          throwOnError: false,
          errorColor: '#ef4444',
          trust: true,
        });
      } catch (e) {
        // Show error with original LaTeX
        container.innerHTML = '';
        const errorWrapper = document.createElement('span');
        errorWrapper.className = 'cm-math-error-wrapper';
        
        const errorIndicator = document.createElement('span');
        errorIndicator.className = 'cm-math-error-indicator';
        errorIndicator.textContent = '⚠️';
        errorIndicator.title = e instanceof Error ? e.message : 'Math rendering error';
        
        const errorSource = document.createElement('span');
        errorSource.className = 'cm-math-error-source';
        errorSource.textContent = this.isBlock ? `$$${this.latex}$$` : `$${this.latex}$`;
        
        errorWrapper.appendChild(errorIndicator);
        errorWrapper.appendChild(errorSource);
        container.appendChild(errorWrapper);
        container.classList.add('cm-math-error');
      }
    } else {
      // KaTeX not loaded yet, show placeholder
      container.textContent = this.isBlock ? `$$${this.latex}$$` : `$${this.latex}$`;
      container.classList.add('cm-math-loading');
      
      // Try to render when KaTeX loads
      loadKaTeX().then((k) => {
        try {
          container.innerHTML = '';
          k.render(this.latex, container, {
            displayMode: this.isBlock,
            throwOnError: false,
            errorColor: '#ef4444',
            trust: true,
          });
          container.classList.remove('cm-math-loading');
        } catch {
          container.classList.add('cm-math-error');
        }
      }).catch(() => {
        container.classList.add('cm-math-error');
      });
    }
    
    return container;
  }
  
  ignoreEvent(e: Event) {
    return e.type !== 'mousedown';
  }
}

/**
 * Parse math expressions from text
 */
interface MathMatch {
  from: number;
  to: number;
  latex: string;
  isBlock: boolean;
  startLine: number;
  endLine: number;
}

function parseMathExpressions(doc: { toString: () => string; lineAt: (pos: number) => { number: number } }): MathMatch[] {
  const text = doc.toString();
  const matches: MathMatch[] = [];
  
  // Block math: $$...$$
  const blockRegex = /\$\$([\s\S]+?)\$\$/g;
  let match;
  while ((match = blockRegex.exec(text)) !== null) {
    const from = match.index;
    const to = match.index + match[0].length;
    matches.push({
      from,
      to,
      latex: match[1].trim(),
      isBlock: true,
      startLine: doc.lineAt(from).number,
      endLine: doc.lineAt(to).number,
    });
  }
  
  // Inline math: $...$ (not inside block math, not spanning multiple lines)
  const inlineRegex = /(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g;
  while ((match = inlineRegex.exec(text)) !== null) {
    const from = match.index;
    const to = match.index + match[0].length;
    
    // Check if this is inside a block math
    const isInsideBlock = matches.some(
      (m) => m.isBlock && from >= m.from && to <= m.to
    );
    
    if (!isInsideBlock) {
      matches.push({
        from,
        to,
        latex: match[1],
        isBlock: false,
        startLine: doc.lineAt(from).number,
        endLine: doc.lineAt(to).number,
      });
    }
  }
  
  return matches.sort((a, b) => a.from - b.from);
}

/**
 * Build math decorations
 * Uses line-based reveal logic for Obsidian-like behavior
 */
function buildMathDecorations(view: EditorView): DecorationSet {
  const decorations: DecorationEntry[] = [];
  const doc = view.state.doc;
  
  const mathExpressions = parseMathExpressions(doc);
  
  for (const expr of mathExpressions) {
    // Check if any line of the math expression should reveal syntax
    let shouldReveal = false;
    for (let lineNum = expr.startLine; lineNum <= expr.endLine; lineNum++) {
      if (shouldRevealLine(view.state, lineNum)) {
        shouldReveal = true;
        break;
      }
    }
    
    if (!shouldReveal) {
      // Render the math
      decorations.push({
        from: expr.from,
        to: expr.to,
        decoration: Decoration.replace({
          widget: new MathWidget(expr.latex, expr.isBlock, expr.from, expr.to),
        }),
      });
    } else {
      // Show source with styling
      decorations.push({
        from: expr.from,
        to: expr.to,
        decoration: Decoration.mark({
          class: expr.isBlock ? 'cm-math-source-block' : 'cm-math-source-inline',
        }),
      });
    }
  }
  
  // Sort decorations by position
  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  
  // Build the decoration set
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, decoration } of decorations) {
    try {
      builder.add(from, to, decoration);
    } catch (e) {
      console.error('[Math] Decoration rejected:', { from, to, decoration, error: e });
    }
  }
  
  return builder.finish();
}

/**
 * Math rendering view plugin
 */
export const mathPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    
    constructor(view: EditorView) {
      this.decorations = buildMathDecorations(view);
    }
    
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildMathDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
