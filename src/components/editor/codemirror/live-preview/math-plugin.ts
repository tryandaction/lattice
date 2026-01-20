/**
 * Math Rendering Plugin for Live Preview
 * Renders LaTeX math expressions using KaTeX
 *
 * Requirements: 4.1-4.6
 *
 * This plugin provides Obsidian-like live preview for math:
 * - When cursor is NOT on a math expression line, it renders as formatted math
 * - When cursor IS on a math expression line, raw LaTeX is shown for editing
 *
 * Uses shared KaTeX loader to prevent duplicate loading
 */

import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  WidgetType,
  EditorView,
} from '@codemirror/view';
import { shouldRevealLine } from './cursor-context-plugin';
import { loadKaTeX } from './katex-loader';

// KaTeX instance (loaded via shared loader)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let katex: any = null;

// Pre-load KaTeX
if (typeof window !== 'undefined') {
  loadKaTeX().then(k => { katex = k; });
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
    container.dataset.latex = this.latex; // Store LaTeX for copy functionality
    container.title = `${this.isBlock ? 'Block' : 'Inline'} formula: Click to edit, Right-click to copy LaTeX`;

    // Handle click to position cursor at formula start (reveals source)
    container.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: this.from, head: this.from },
        scrollIntoView: true,
      });
      view.focus();
    });

    // Handle double-click to select entire formula for editing
    container.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: this.from, head: this.to },
        scrollIntoView: true,
      });
      view.focus();
    });

    // Handle right-click to copy LaTeX source
    container.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const latexSource = this.isBlock ? `$$${this.latex}$$` : `$${this.latex}$`;

      try {
        await navigator.clipboard.writeText(latexSource);

        // Visual feedback
        const originalTitle = container.title;
        container.title = '✓ LaTeX copied to clipboard!';
        container.style.backgroundColor = 'rgba(34, 197, 94, 0.1)'; // green tint

        setTimeout(() => {
          container.title = originalTitle;
          container.style.backgroundColor = '';
        }, 1500);
      } catch (err) {
        console.error('Failed to copy LaTeX:', err);
        container.title = '✗ Failed to copy';
        setTimeout(() => {
          container.title = `${this.isBlock ? 'Block' : 'Inline'} formula: Click to edit, Right-click to copy LaTeX`;
        }, 1500);
      }
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
  
  // Inline math: $...$ (not inside block math)
  // IMPROVED regex to handle all contexts:
  // - Formulas in bold: **text with $E=mc^2$ formula**
  // - Formulas in tables: | cell with $x=1$ |
  // - Formulas in headings: # Title with $\alpha$
  // - Complex LaTeX with all symbols
  //
  // Pattern: (?<!\$)\$(?!\$)(.+?)\$(?!\$)
  // - Allows ALL content except we manually filter newlines later
  // - Non-greedy to match smallest possible formula
  const inlineRegex = /(?<!\$)\$(?!\$)(.+?)\$(?!\$)/gs; // 's' flag allows . to match newlines
  while ((match = inlineRegex.exec(text)) !== null) {
    const from = match.index;
    const to = match.index + match[0].length;
    const latex = match[1];

    // Skip if contains newlines (should use $$ for multi-line formulas)
    if (latex.includes('\n')) {
      continue;
    }

    // Check if this is inside a block math
    const isInsideBlock = matches.some(
      (m) => m.isBlock && from >= m.from && to <= m.to
    );

    if (!isInsideBlock) {
      matches.push({
        from,
        to,
        latex: latex,
        isBlock: false,
        startLine: doc.lineAt(from).number,
        endLine: doc.lineAt(to).number,
      });
    }
  }
  
  return matches.sort((a, b) => a.from - b.from);
}

/**
 * Decoration entry with line flag for proper sorting
 */
interface ExtendedDecorationEntry extends DecorationEntry {
  isLine?: boolean;
}

/**
 * Build math decorations
 * Uses line-based reveal logic for Obsidian-like behavior
 * 
 * IMPORTANT: CodeMirror does not allow Decoration.replace() to span line breaks.
 * For multi-line block math, we use line decorations to hide content and
 * place the widget on the first line.
 */
function buildMathDecorations(view: EditorView): DecorationSet {
  const decorations: ExtendedDecorationEntry[] = [];
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
    
    const isMultiLine = expr.startLine !== expr.endLine;
    
    if (!shouldReveal) {
      if (isMultiLine && expr.isBlock) {
        // Multi-line block math: use line decorations to hide content
        // and place widget on the first line
        const firstLine = doc.line(expr.startLine);
        
        // Add widget at the start of the first line (as a line decoration widget)
        decorations.push({
          from: firstLine.from,
          to: firstLine.from,
          decoration: Decoration.widget({
            widget: new MathWidget(expr.latex, true, expr.from, expr.to),
            side: -1, // Before line content
          }),
          isLine: true,
        });
        
        // Hide all lines of the block math using line class
        for (let lineNum = expr.startLine; lineNum <= expr.endLine; lineNum++) {
          const line = doc.line(lineNum);
          decorations.push({
            from: line.from,
            to: line.from,
            decoration: Decoration.line({ class: 'cm-math-block-hidden' }),
            isLine: true,
          });
        }
      } else {
        // Single-line math (inline or block): safe to use replace
        decorations.push({
          from: expr.from,
          to: expr.to,
          decoration: Decoration.replace({
            widget: new MathWidget(expr.latex, expr.isBlock, expr.from, expr.to),
          }),
        });
      }
    } else {
      // Show source with styling - use mark for single line, line decoration for multi-line
      if (isMultiLine) {
        for (let lineNum = expr.startLine; lineNum <= expr.endLine; lineNum++) {
          const line = doc.line(lineNum);
          decorations.push({
            from: line.from,
            to: line.from,
            decoration: Decoration.line({ class: 'cm-math-source-block' }),
            isLine: true,
          });
        }
      } else {
        decorations.push({
          from: expr.from,
          to: expr.to,
          decoration: Decoration.mark({
            class: expr.isBlock ? 'cm-math-source-block' : 'cm-math-source-inline',
          }),
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
