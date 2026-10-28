import { EditorSelection, StateEffect, StateField, type Extension, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type ViewUpdate } from "@codemirror/view";
import type { MathfieldElement } from "mathlive";
import { normalizeFormulaInput, wrapLatexForMarkdown } from "@/lib/formula-utils";
import { getFormulaTemplateForKey } from "@/lib/formula-templates";
import { toMathLivePlaceholders } from "@/lib/unified-input-handler";
import { beginQuantumMathInput, cancelQuantumMathInput, flushQuantumMathInput } from "@/lib/quantum-input-session";
import { MATRIX_SIZE_LIMITS } from "@/plugins/quantum-keyboard/matrix-size";
import { activeMathEditorRange } from "@/components/editor/codemirror/live-preview/math-editor-range";
import { subscribeToLocaleChanges } from "@/lib/i18n";

export type QuantumMathEditRange = { from: number; to: number; latex: string; displayMode: boolean; caretPoint?: { x: number; y: number } } | null;
export const setQuantumMathEditRange = StateEffect.define<QuantumMathEditRange>();
export const quantumMathEditField = StateField.define<QuantumMathEditRange>({
  create: () => null,
  provide: field => activeMathEditorRange.from(field),
  update(value, transaction: Transaction) {
    let next = value;
    if (next && transaction.docChanged) {
      next = { ...next, from: transaction.changes.mapPos(next.from, -1), to: transaction.changes.mapPos(next.to, 1) };
    }
    for (const effect of transaction.effects) {
      if (effect.is(setQuantumMathEditRange)) next = effect.value
        ? { ...effect.value, from: Math.min(effect.value.from, effect.value.to), to: Math.max(effect.value.from, effect.value.to) } : null;
    }
    return next;
  },
});
export function shouldInsertNestedQuantumTemplate(event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean {
  return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

/** The document owns an anchor; the mathfield stays outside CodeMirror's managed DOM.
 * Replacing source text must never disconnect MathLive: that resets focus and undo.
 */
class QuantumMathAnchor extends WidgetType {
  constructor(readonly displayMode: boolean) { super(); }
  eq(other: QuantumMathAnchor) { return other.displayMode === this.displayMode; }
  toDOM(): HTMLElement {
    const anchor = document.createElement(this.displayMode ? "div" : "span");
    anchor.className = "cm-quantum-math-anchor";
    anchor.setAttribute("aria-hidden", "true");
    Object.assign(anchor.style, { display: this.displayMode ? "block" : "inline-block", width: "72px", height: "40px", verticalAlign: "middle" });
    return anchor;
  }
  ignoreEvent() { return true; }
}
const quantumMathEditDecorations = EditorView.decorations.compute([quantumMathEditField], state => {
  const range = state.field(quantumMathEditField, false);
  if (!range) return Decoration.none;
  return Decoration.set([Decoration.replace({ widget: new QuantumMathAnchor(range.displayMode), block: range.displayMode }).range(range.from, range.to)]);
});

const sessions = new Set<QuantumMathSession>();
export function finishQuantumMathEdits(): void {
  for (const session of sessions) session.finish(false);
}

class QuantumMathSession {
  private field: MathfieldElement | null = null;
  private overlay: HTMLDivElement | null = null;
  private observer: ResizeObserver | null = null;
  private loading = false;
  private disposed = false;
  private applying = false;
  private generation = 0;
  private savedPaddingBottom = '';
  private savedPaddingTop = '';
  private savedEditorHeight = '';
  private savedEditorPaddingTop = '';
  private openKeyboardTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCaretPoint: { x: number; y: number } | undefined;
  private unsubscribeLocale: (() => void) | null = null;
  constructor(private view: EditorView) {
    sessions.add(this);
    this.savedEditorHeight = this.view.dom.style.height;
    this.savedEditorPaddingTop = this.view.dom.style.paddingTop;
    this.savedPaddingBottom = this.view.contentDOM.style.paddingBottom;
    this.savedPaddingTop = this.view.contentDOM.style.paddingTop;
    this.view.dom.addEventListener('quantum-edit-formula', this.editAtCursor);
    this.view.dom.addEventListener('quantum-formula-inserted', this.editInsertedFormula);
    this.view.dom.addEventListener('mousedown', this.handleFormulaMouseDown, true);
    this.view.dom.addEventListener('dblclick', this.handleFormulaDoubleClick, true);
    this.sync();
  }
  private editAtCursor = (event: Event) => {
    const detail = (event as CustomEvent<{ from?: number; to?: number; latex?: string; isBlock?: boolean }>).detail;
    if (
      detail &&
      Number.isFinite(detail.from) &&
      Number.isFinite(detail.to) &&
      detail.latex
    ) {
      activateQuantumMathEdit(this.view, {
        from: Number(detail.from),
        to: Number(detail.to),
        latex: detail.latex,
        displayMode: Boolean(detail.isBlock),
      });
      event.preventDefault();
      return;
    }
    const pos = this.view.state.selection.main.head;
    const formula = Array.from(this.view.dom.querySelectorAll<HTMLElement>('.cm-math-inline, .cm-math-block')).find(element => Number(element.dataset.from) <= pos && Number(element.dataset.to) >= pos);
    if (!formula?.dataset.latex) return;
    event.preventDefault();
    activateQuantumMathEdit(this.view, { from: Number(formula.dataset.from), to: Number(formula.dataset.to), latex: formula.dataset.latex, displayMode: formula.classList.contains('cm-math-block') });
  };
  private editInsertedFormula = (event: Event) => {
    const detail = (event as CustomEvent<NonNullable<QuantumMathEditRange>>).detail;
    if (!detail || !Number.isFinite(detail.from) || !Number.isFinite(detail.to) || !detail.latex) return;
    activateQuantumMathEdit(this.view, detail);
  };
  private formulaAtTarget(event: MouseEvent): NonNullable<QuantumMathEditRange> | null {
    if (this.view.state.readOnly) return null;
    const formula = event.target instanceof Element ? event.target.closest<HTMLElement>('.cm-math-inline, .cm-math-block') : null;
    if (!formula?.dataset.latex) return null;
    const from = Number(formula.dataset.from), to = Number(formula.dataset.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    return { from, to, latex: formula.dataset.latex, displayMode: formula.classList.contains('cm-math-block'), caretPoint: { x: event.clientX, y: event.clientY } };
  }
  private handleFormulaMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || !this.formulaAtTarget(event)) return;
    // Keep the rendered formula stable until the browser delivers dblclick.
    event.preventDefault();
    event.stopPropagation();
  };
  private handleFormulaDoubleClick = (event: MouseEvent) => {
    const range = this.formulaAtTarget(event);
    if (!range) return;
    event.preventDefault();
    event.stopPropagation();
    activateQuantumMathEdit(this.view, range);
    this.openKeyboard();
  };
  openKeyboard() {
    if (this.openKeyboardTimer !== null) clearTimeout(this.openKeyboardTimer);
    this.openKeyboardTimer = setTimeout(() => {
      this.openKeyboardTimer = null;
      if (!this.disposed) window.dispatchEvent(new CustomEvent("lattice-open-quantum-keyboard"));
    }, 0);
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.transactions.some(transaction => transaction.effects.some(effect => effect.is(setQuantumMathEditRange)))) this.sync();
    if (this.field && (update.geometryChanged || update.viewportChanged || update.docChanged)) this.measure();
  }
  private sync() {
    const range = this.view.state.field(quantumMathEditField, false);
    if (!range) { this.removeField(); return; }
    if (this.field) {
      if (!this.applying && this.field.getValue("latex-without-placeholders") !== range.latex) {
        this.field.setValue(toMathLivePlaceholders(range.latex), { silenceNotifications: true, selectionMode: "after" });
      }
      this.measure();
      if (range.caretPoint && range.caretPoint !== this.lastCaretPoint) this.focusField(this.field, range.caretPoint);
      return;
    }
    if (this.loading) return;
    this.loading = true;
    const generation = ++this.generation;
    const focusOrigin = document.activeElement;
    const focusOriginWasPlugin = focusOrigin instanceof HTMLElement && Boolean(focusOrigin.closest("[data-quantum-keyboard]"));
    void import("mathlive").then(module => {
      if (this.disposed || generation !== this.generation) return;
      this.loading = false;
      const current = this.view.state.field(quantumMathEditField, false);
      if (!current) return;
      const overlay = document.createElement("div");
      overlay.className = "cm-quantum-math-editor " + (current.displayMode ? "cm-quantum-math-editor-block" : "cm-quantum-math-editor-inline");
      Object.assign(overlay.style, { position: "absolute", zIndex: "5", margin: "0", visibility: "hidden" });
      const field = new module.MathfieldElement();
      field.mathVirtualKeyboardPolicy = "manual";
      field.smartFence = true;
      field.smartMode = false;
      field.maxMatrixCols = MATRIX_SIZE_LIMITS.max;
      field.className = "cm-quantum-math-field";
      const setMathfieldLabel = () => field.setAttribute(
        "aria-label",
        document.documentElement.lang.startsWith("zh") ? "编辑数学公式" : "Edit math formula",
      );
      setMathfieldLabel();
      this.unsubscribeLocale = subscribeToLocaleChanges(setMathfieldLabel);
      field.setValue(toMathLivePlaceholders(current.latex), { selectionMode: "placeholder" });
      this.field = field;
      this.overlay = overlay;
      overlay.append(field);
      this.view.dom.append(overlay);
      field.addEventListener("focusin", () => flushQuantumMathInput(this.view.dom, field), { once: true });
      field.addEventListener("input", this.commit);
      field.addEventListener("quantum-finish-formula", this.handleFinish);
      field.addEventListener("keydown", this.handleKey);
      field.addEventListener("blur", this.handleBlur);
      this.observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => this.measure());
      this.observer?.observe(field);
      this.measure();
      requestAnimationFrame(() => {
        if (!field.isConnected || this.disposed) return;
        const active = document.activeElement;
        // Lookup inputs disappear after insertion. An explicit new focus target wins.
        const lookupWasRemoved = active === document.body && focusOriginWasPlugin && !focusOrigin?.isConnected;
        if (active !== focusOrigin && active !== field && !this.view.dom.contains(active) && !lookupWasRemoved) {
          this.finish(false);
          return;
        }
        this.focusField(field, current.caretPoint);
        this.measure();
      });
    }).catch(error => { this.loading = false; console.error("[QuantumKeyboard] Could not load formula editor", error); });
  }
  private focusField(field: MathfieldElement, point?: { x: number; y: number }) {
    if (point) {
      this.lastCaretPoint = point;
      field.position = field.getOffsetFromPoint(point.x, point.y);
    } else {
      field.executeCommand("moveToMathfieldStart");
      field.executeCommand("moveToNextPlaceholder");
    }
    // focusin flushes queued physical input; position first so it keeps that caret.
    field.focus();
  }
  private commit = () => {
    const field = this.field;
    const range = this.view.state.field(quantumMathEditField, false);
    if (!field || !range || this.applying) return;
    const latex = field.getValue("latex-without-placeholders") || "{}";
    const normalized = normalizeFormulaInput(latex, { preferDisplay: range.displayMode });
    const markdown = wrapLatexForMarkdown(normalized.latex, range.displayMode);
    if (this.view.state.sliceDoc(range.from, range.to) === markdown) return;
    this.applying = true;
    try {
      this.view.dispatch({
        changes: { from: range.from, to: range.to, insert: markdown },
        effects: setQuantumMathEditRange.of({ from: range.from, to: range.from + markdown.length, latex: normalized.latex, displayMode: range.displayMode }),
      });
    } finally { this.applying = false; }
    this.measure();
  };
  finish = (restoreFocus = true) => {
    const focusTarget = document.activeElement;
    const field = this.field;
    if (field) {
      // Drain all accepted input before closing; queued finish commands must wait.
      field.removeEventListener("quantum-finish-formula", this.handleFinish);
      flushQuantumMathInput(this.view.dom, field);
    }
    this.commit();
    const range = this.view.state.field(quantumMathEditField, false);
    if (!range) return;
    this.view.dispatch({ effects: setQuantumMathEditRange.of(null), selection: EditorSelection.cursor(range.to) });
    if (restoreFocus) this.view.focus();
    else if (focusTarget instanceof HTMLElement && focusTarget !== field && focusTarget.isConnected && document.activeElement !== focusTarget) {
      focusTarget.focus();
    }
  };
  private handleFinish = () => this.finish();
  private handleKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
      event.preventDefault(); this.finish(); return;
    }
    if (event.ctrlKey || event.metaKey) return;
    if (event.key === "Tab") {
      event.preventDefault();
      this.field?.executeCommand(event.shiftKey ? "moveToPreviousPlaceholder" : "moveToNextPlaceholder");
      return;
    }
    const template = getFormulaTemplateForKey(event.code);
    if (template && shouldInsertNestedQuantumTemplate(event)) {
      event.preventDefault();
      this.field?.insert(template.mathLiveLatex, { insertionMode: "replaceSelection", selectionMode: "placeholder", focus: true });
      this.commit();
    }
  };
  private handleBlur = (event: FocusEvent) => {
    if (this.applying || this.disposed) return;
    if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest("[data-quantum-keyboard]")) return;
    queueMicrotask(() => {
      if (!this.field?.isConnected || this.disposed) return;
      const active = document.activeElement;
      if (active === this.field || (active instanceof HTMLElement && active.closest("[data-quantum-keyboard]"))) return;
      this.finish(false);
    });
  };
  private measure() {
    if (!this.overlay || !this.field || this.disposed) return;
    this.view.requestMeasure({
      key: this,
      read: view => {
        const anchor = view.dom.querySelector<HTMLElement>(".cm-quantum-math-anchor");
        if (!anchor || !this.field || !this.overlay) return null;
        return { anchor, rect: anchor.getBoundingClientRect(), host: view.dom.getBoundingClientRect(), field: this.field.getBoundingClientRect(), scrollLeft: view.dom.scrollLeft, scrollTop: view.dom.scrollTop, scroller: view.scrollDOM.getBoundingClientRect(), keyboard: document.querySelector<HTMLElement>('[data-quantum-keyboard]')?.getBoundingClientRect() };
      },
      write: size => {
        if (!size || !this.overlay) return;
        const width = Math.max(48, Math.ceil(size.field.width));
        const height = Math.max(32, Math.ceil(size.field.height));
        if (size.anchor.style.width !== width + "px") size.anchor.style.width = width + "px";
        if (size.anchor.style.height !== height + "px") size.anchor.style.height = height + "px";
        this.overlay.style.left = size.rect.left - size.host.left + size.scrollLeft + "px";
        this.overlay.style.top = size.rect.top - size.host.top + size.scrollTop + "px";
        this.overlay.style.visibility = "visible";
        const keyboard = size.keyboard;
        if (keyboard) {
          let changed = false;
          this.view.contentDOM.style.paddingBottom = this.savedPaddingBottom;
          this.view.contentDOM.style.paddingTop = this.savedPaddingTop;
          if (keyboard.top > 30 && keyboard.top < size.host.bottom) {
            const available = Math.max(100, keyboard.top - size.host.top - 12);
            const nextHeight = Math.floor(available) + 'px';
            if (this.view.dom.style.height !== nextHeight) { this.view.dom.style.height = nextHeight; changed = true; }
            const overlap = size.rect.top + height + 12 - keyboard.top;
            if (overlap > 0) this.view.scrollDOM.scrollTop += overlap;
          } else if (keyboard.top <= 30 && keyboard.bottom > size.host.top) {
            const nextPadding = Math.max(0, Math.ceil(keyboard.bottom - size.host.top + 12)) + 'px';
            const nextHeight = Math.max(120, window.innerHeight - size.host.top - 12) + 'px';
            if (this.view.dom.style.paddingTop !== nextPadding) { this.view.dom.style.paddingTop = nextPadding; changed = true; }
            if (this.view.dom.style.height !== nextHeight) { this.view.dom.style.height = nextHeight; changed = true; }
          }
          if (changed) requestAnimationFrame(() => this.measure());
        }
      },
    });
  }
  private removeField() {
    this.view.dom.style.height = this.savedEditorHeight;
    this.view.dom.style.paddingTop = this.savedEditorPaddingTop;
    this.view.contentDOM.style.paddingBottom = this.savedPaddingBottom;
    this.view.contentDOM.style.paddingTop = this.savedPaddingTop;
    cancelQuantumMathInput(this.view.dom);
    this.generation++;
    this.loading = false;
    this.observer?.disconnect();
    this.observer = null;
    const field = this.field;
    this.field = null;
    this.lastCaretPoint = undefined;
    if (field) {
      this.unsubscribeLocale?.();
      this.unsubscribeLocale = null;
      field.removeEventListener("input", this.commit);
      field.removeEventListener("quantum-finish-formula", this.handleFinish);
      field.removeEventListener("keydown", this.handleKey);
      field.removeEventListener("blur", this.handleBlur);
    }
    this.overlay?.remove();
    this.overlay = null;
  }
  destroy() {
    this.disposed = true;
    sessions.delete(this);
    if (this.openKeyboardTimer !== null) clearTimeout(this.openKeyboardTimer);
    this.view.dom.removeEventListener('quantum-edit-formula', this.editAtCursor);
    this.view.dom.removeEventListener('quantum-formula-inserted', this.editInsertedFormula);
    this.view.dom.removeEventListener('mousedown', this.handleFormulaMouseDown, true);
    this.view.dom.removeEventListener('dblclick', this.handleFormulaDoubleClick, true);
    this.removeField();
  }
}
export function activateQuantumMathEdit(view: EditorView, range: NonNullable<QuantumMathEditRange>): void {
  if (view.state.field(quantumMathEditField, false) === undefined || view.state.readOnly) return;
  if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || Math.min(range.from, range.to) < 0 || Math.max(range.from, range.to) > view.state.doc.length) return;
  beginQuantumMathInput(view.dom);
  const normalized = normalizeFormulaInput(range.latex, { preferDisplay: range.displayMode });
  view.dispatch({ effects: setQuantumMathEditRange.of({ ...range, latex: normalized.latex }), selection: EditorSelection.cursor(range.from), scrollIntoView: true });
}
export const quantumMathEditingExtension: Extension = [
  quantumMathEditField, quantumMathEditDecorations, ViewPlugin.fromClass(QuantumMathSession),
];
