import { EditorSelection, StateEffect, StateField, type Extension, type Transaction } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import type { MathfieldElement } from 'mathlive';
import { normalizeFormulaInput, wrapLatexForMarkdown } from '@/lib/formula-utils';
import { getFormulaTemplateForKey } from '@/lib/formula-templates';

export type QuantumMathEditRange = {
  from: number;
  to: number;
  latex: string;
  displayMode: boolean;
} | null;

export const setQuantumMathEditRange = StateEffect.define<QuantumMathEditRange>();

type MathfieldWithApi = MathfieldElement & {
  mathVirtualKeyboardPolicy?: 'auto' | 'manual' | 'sandboxed';
  smartFence?: boolean;
  smartMode?: boolean;
  executeCommand?: (command: unknown) => unknown;
  getValue?: (format?: string) => string;
};

function normalizeRange(range: NonNullable<QuantumMathEditRange>): NonNullable<QuantumMathEditRange> {
  return {
    ...range,
    from: Math.min(range.from, range.to),
    to: Math.max(range.from, range.to),
  };
}

function mapRange(
  range: NonNullable<QuantumMathEditRange>,
  transaction: Transaction,
): NonNullable<QuantumMathEditRange> {
  const mappedFrom = transaction.changes.mapPos(range.from, -1);
  const mappedTo = transaction.changes.mapPos(range.to, 1);
  return {
    ...range,
    from: Math.min(mappedFrom, mappedTo),
    to: Math.max(mappedFrom, mappedTo),
  };
}

export const quantumMathEditField = StateField.define<QuantumMathEditRange>({
  create: () => null,
  update(value, transaction) {
    let next = value;

    if (next && transaction.docChanged) {
      next = mapRange(next, transaction);
    }

    for (const effect of transaction.effects) {
      if (effect.is(setQuantumMathEditRange)) {
        next = effect.value ? normalizeRange(effect.value) : null;
      }
    }

    return next;
  },
});

function isNavigationKey(key: string): boolean {
  return key === 'Tab' || key === 'Escape';
}

export function shouldInsertNestedQuantumTemplate(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): boolean {
  return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

class QuantumMathEditWidget extends WidgetType {
  constructor(
    private readonly range: NonNullable<QuantumMathEditRange>,
  ) {
    super();
  }

  eq(other: QuantumMathEditWidget): boolean {
    return (
      other.range.from === this.range.from &&
      other.range.to === this.range.to &&
      other.range.latex === this.range.latex &&
      other.range.displayMode === this.range.displayMode
    );
  }

  updateDOM(dom: HTMLElement): boolean {
    dom.dataset.from = String(this.range.from);
    dom.dataset.to = String(this.range.to);
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement(this.range.displayMode ? 'div' : 'span');
    wrapper.className = this.range.displayMode
      ? 'cm-quantum-math-editor cm-quantum-math-editor-block'
      : 'cm-quantum-math-editor cm-quantum-math-editor-inline';
    wrapper.dataset.from = String(this.range.from);
    wrapper.dataset.to = String(this.range.to);

    void import('mathlive').then((module) => {
      if (!wrapper.isConnected || wrapper.querySelector('math-field')) return;

      const mathfield = new module.MathfieldElement() as MathfieldWithApi;
      mathfield.value = this.range.latex;
      mathfield.mathVirtualKeyboardPolicy = 'manual';
      mathfield.smartFence = true;
      mathfield.smartMode = true;
      mathfield.className = 'cm-quantum-math-field';
      mathfield.setAttribute('aria-label', '编辑数学公式');

      let applyingRemoteChange = false;

      const commitValue = () => {
        if (applyingRemoteChange) return;

        const rawLatex = typeof mathfield.getValue === 'function'
          ? mathfield.getValue('latex')
          : mathfield.value;
        const normalized = normalizeFormulaInput(rawLatex, { preferDisplay: this.range.displayMode });
        const markdown = wrapLatexForMarkdown(normalized.latex, this.range.displayMode);
        if (!markdown) return;

        const activeRange = view.state.field(quantumMathEditField, false);
        if (!activeRange) return;

        applyingRemoteChange = true;
        view.dispatch({
          changes: { from: activeRange.from, to: activeRange.to, insert: markdown },
          effects: setQuantumMathEditRange.of({
            from: activeRange.from,
            to: activeRange.from + markdown.length,
            latex: normalized.latex,
            displayMode: this.range.displayMode,
          }),
        });
        applyingRemoteChange = false;
      };

      mathfield.addEventListener('input', commitValue);
      mathfield.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.ctrlKey || event.metaKey) return;

        if (event.key === 'Escape') {
          event.preventDefault();
          view.dispatch({ effects: setQuantumMathEditRange.of(null) });
          view.focus();
          return;
        }

        if (event.key === 'Tab') {
          event.preventDefault();
          mathfield.executeCommand?.(
            event.shiftKey ? 'moveToPreviousPlaceholder' : 'moveToNextPlaceholder'
          );
          return;
        }

        const template = getFormulaTemplateForKey(event.code);
        if (template && shouldInsertNestedQuantumTemplate(event)) {
          event.preventDefault();
          if (typeof mathfield.insert === 'function') {
            mathfield.insert(template.mathLiveLatex, {
              insertionMode: 'insertAfter',
              selectionMode: 'after',
            });
          } else {
            mathfield.executeCommand?.(['insert', template.mathLiveLatex]);
          }
          mathfield.executeCommand?.('moveToNextPlaceholder');
          commitValue();
        }
      });
      mathfield.addEventListener('blur', () => {
        const active = document.activeElement;
        if (active && wrapper.contains(active)) return;
        view.dispatch({ effects: setQuantumMathEditRange.of(null) });
      });

      wrapper.appendChild(mathfield);
      requestAnimationFrame(() => {
        mathfield.focus();
        mathfield.executeCommand?.('moveToNextPlaceholder');
        view.requestMeasure();
      });
    });

    return wrapper;
  }

  ignoreEvent(event: Event): boolean {
    if (event instanceof KeyboardEvent && isNavigationKey(event.key)) {
      return true;
    }
    return true;
  }
}

const quantumMathEditDecorations = EditorView.decorations.compute(
  [quantumMathEditField],
  (state): DecorationSet => {
    const range = state.field(quantumMathEditField, false);
    if (!range) return Decoration.none;

    const decoration = Decoration.replace({
      widget: new QuantumMathEditWidget(range),
      block: range.displayMode,
    });

    return Decoration.set([decoration.range(range.from, range.to)]);
  }
);

export function activateQuantumMathEdit(
  view: EditorView,
  range: NonNullable<QuantumMathEditRange>
): void {
  const normalized = normalizeFormulaInput(range.latex, { preferDisplay: range.displayMode });
  view.dispatch({
    effects: setQuantumMathEditRange.of({
      from: range.from,
      to: range.to,
      latex: normalized.latex,
      displayMode: range.displayMode,
    }),
    selection: EditorSelection.cursor(range.from),
    scrollIntoView: true,
  });
}

export const quantumMathEditingExtension: Extension = [
  quantumMathEditField,
  quantumMathEditDecorations,
  EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target as HTMLElement | null;
      const formula = target?.closest?.('.cm-math-inline, .cm-math-block') as HTMLElement | null;
      if (!formula) return false;

      const from = Number(formula.dataset.from);
      const to = Number(formula.dataset.to);
      const latex = formula.dataset.latex;
      if (!Number.isFinite(from) || !Number.isFinite(to) || !latex) return false;

      event.preventDefault();
      activateQuantumMathEdit(view, {
        from,
        to,
        latex,
        displayMode: formula.classList.contains('cm-math-block'),
      });
      return true;
    },
  }),
];
