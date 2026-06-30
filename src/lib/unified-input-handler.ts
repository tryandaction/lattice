/**
 * Unified Input Handler
 *
 * Provides a unified interface for inserting text/LaTeX into different input targets:
 * - CodeMirror editors (Markdown editor)
 * - MathLive math fields
 * - Standard textareas
 *
 * This enables the Quantum Keyboard to work seamlessly with all input types.
 */

import { EditorView } from '@codemirror/view';
import { findFormulaFillPosition, normalizeFormulaInput, wrapLatexForMarkdown } from '@/lib/formula-utils';

// ============================================================================
// Types
// ============================================================================

export type InputTargetType = 'codemirror' | 'mathlive' | 'textarea' | 'contenteditable';

export interface UnifiedInputTarget {
  type: InputTargetType;
  element: HTMLElement;
  insertText: (text: string) => void;
  insertLatex: (latex: string) => void;
  insertFormula?: (payload: FormulaInsertPayload) => FormulaInsertResult;
  insertMathLiveLatex?: (latex: string) => void;
  wrapSelection: (before: string, after: string) => void;
  getSelection: () => { from: number; to: number; text: string };
  focus: () => void;
}

export interface FormulaInsertPayload {
  latex: string;
  displayMode?: boolean;
  format?: 'latex' | 'markdown';
  mathLiveLatex?: string;
}

export interface FormulaInsertResult {
  handled: boolean;
  targetType: InputTargetType | null;
  from?: number;
  to?: number;
  latex?: string;
  markdown?: string;
  displayMode?: boolean;
}

type CodeMirrorContentElement = HTMLElement & {
  cmView?: { view?: EditorView };
};

type MathLiveElement = HTMLElement & {
  executeCommand?: (command: unknown) => void;
  insert?: (value: string, options?: Record<string, unknown>) => void;
  selection?: { ranges?: Array<[number, number]> };
  value?: string;
  focus?: () => void;
};

// ============================================================================
// Global State
// ============================================================================

let activeTarget: UnifiedInputTarget | null = null;
let lastActiveTarget: UnifiedInputTarget | null = null;

// Store references to CodeMirror views
const codeMirrorViews = new WeakMap<HTMLElement, EditorView>();

function toHTMLElement(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) {
    return target;
  }
  if (target instanceof Node) {
    return target.parentElement;
  }
  return null;
}

export function toMathLivePlaceholders(latex: string): string {
  return latex
    .replace(/\{\s*\}/g, "{\\placeholder{}}")
    .replace(/\[\s*\]/g, "[\\placeholder{}]")
    .replace(/\^\{\s+\}/g, "^{\\placeholder{}}")
    .replace(/_\{\s+\}/g, "_{\\placeholder{}}");
}

function insertIntoMathLive(mathField: MathLiveElement, latex: string): void {
  if (mathField.executeCommand) {
    mathField.executeCommand(['insert', latex]);
    mathField.executeCommand('moveToNextPlaceholder');
    return;
  }

  if (mathField.insert) {
    mathField.insert(latex, {
      insertionMode: 'insertAfter',
      selectionMode: 'after',
    });
  }
}

function insertTextIntoCodeMirror(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  const fillOffset = findFormulaFillPosition(text);
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + (fillOffset ?? text.length) },
  });
}

function insertFormulaIntoCodeMirror(
  view: EditorView,
  payload: FormulaInsertPayload
): FormulaInsertResult {
  const { from, to } = view.state.selection.main;
  const normalized = normalizeFormulaInput(payload.latex, { preferDisplay: payload.displayMode });
  const displayMode = payload.displayMode ?? normalized.displayMode;
  const format = payload.format ?? 'markdown';
  const markdown = format === 'markdown'
    ? wrapLatexForMarkdown(normalized.latex, displayMode)
    : normalized.latex;

  if (!markdown) {
    return { handled: false, targetType: 'codemirror' };
  }

  const insertedFrom = from;
  const insertedTo = from + markdown.length;
  const fillOffset = findFormulaFillPosition(markdown);

  view.dispatch({
    changes: { from, to, insert: markdown },
    selection: { anchor: from + (fillOffset ?? markdown.length) },
  });

  if (format === 'markdown') {
    queueMicrotask(() => {
      view.dom.dispatchEvent(new CustomEvent('quantum-formula-inserted', {
        bubbles: true,
        detail: {
          from: insertedFrom,
          to: insertedTo,
          latex: normalized.latex,
          markdown,
          displayMode,
        },
      }));
    });
  }

  return {
    handled: true,
    targetType: 'codemirror',
    from: insertedFrom,
    to: insertedTo,
    latex: normalized.latex,
    markdown,
    displayMode,
  };
}

/**
 * Register a CodeMirror view for unified input handling
 */
export function registerCodeMirrorView(element: HTMLElement, view: EditorView): void {
  codeMirrorViews.set(element, view);
}

/**
 * Unregister a CodeMirror view
 */
export function unregisterCodeMirrorView(element: HTMLElement): void {
  codeMirrorViews.delete(element);
}

// ============================================================================
// Input Target Detection
// ============================================================================

/**
 * Detect the type of input element
 */
function detectInputType(element: HTMLElement): InputTargetType | null {
  // Check for MathLive math-field
  if (element.tagName?.toLowerCase() === 'math-field') {
    return 'mathlive';
  }

  // Check for CodeMirror
  if (element.classList?.contains('cm-content') || element.closest('.cm-editor')) {
    return 'codemirror';
  }

  // Check for textarea
  if (element.tagName?.toLowerCase() === 'textarea') {
    return 'textarea';
  }

  // Check for contenteditable
  if (element.getAttribute('contenteditable') === 'true') {
    return 'contenteditable';
  }

  return null;
}

export function getInputTargetTypeFromElement(target: EventTarget | null): InputTargetType | null {
  const element = toHTMLElement(target);
  if (!element) return null;

  const directType = detectInputType(element);
  if (directType) {
    return directType;
  }

  if (element.closest('math-field')) {
    return 'mathlive';
  }
  if (element.closest('.cm-editor')) {
    return 'codemirror';
  }

  return null;
}

export function isEditableElement(target: EventTarget | null): boolean {
  const element = toHTMLElement(target);
  if (!element) return false;

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return true;
  }

  if (element.isContentEditable || element.closest('[contenteditable="true"]')) {
    return true;
  }

  return getInputTargetTypeFromElement(element) !== null;
}

/**
 * Create a unified input target from an element
 */
function createInputTarget(element: HTMLElement, type: InputTargetType): UnifiedInputTarget | null {
  switch (type) {
    case 'codemirror':
      return createCodeMirrorTarget(element);
    case 'mathlive':
      return createMathLiveTarget(element);
    case 'textarea':
      return createTextareaTarget(element as HTMLTextAreaElement);
    case 'contenteditable':
      return createContentEditableTarget(element);
    default:
      return null;
  }
}

// ============================================================================
// CodeMirror Target
// ============================================================================

function createCodeMirrorTarget(element: HTMLElement): UnifiedInputTarget | null {
  // Find the CodeMirror editor element
  const editorElement = element.closest('.cm-editor') as HTMLElement;
  if (!editorElement) return null;

  // Get the EditorView from our registry
  const view = codeMirrorViews.get(editorElement);
  if (!view) {
    // Try to find view from DOM
    const cmContent = editorElement.querySelector('.cm-content');
    if (cmContent) {
      const viewFromDom = (cmContent as CodeMirrorContentElement).cmView?.view;
      if (viewFromDom) {
        return createCodeMirrorTargetFromView(editorElement, viewFromDom);
      }
    }
    return null;
  }

  return createCodeMirrorTargetFromView(editorElement, view);
}

function createCodeMirrorTargetFromView(element: HTMLElement, view: EditorView): UnifiedInputTarget {
  return {
    type: 'codemirror',
    element,
    insertText: (text: string) => {
      insertTextIntoCodeMirror(view, text);
    },
    insertLatex: (latex: string) => {
      // For CodeMirror, wrap LaTeX in $ delimiters
      const { from, to } = view.state.selection.main;
      const wrappedLatex = `$${latex}$`;
      const fillOffset = findFormulaFillPosition(wrappedLatex);
      view.dispatch({
        changes: { from, to, insert: wrappedLatex },
        selection: { anchor: from + (fillOffset ?? wrappedLatex.length) },
      });
    },
    insertFormula: (payload: FormulaInsertPayload) => insertFormulaIntoCodeMirror(view, payload),
    wrapSelection: (before: string, after: string) => {
      const { from, to } = view.state.selection.main;
      const selectedText = view.state.sliceDoc(from, to);
      const newText = before + selectedText + after;
      view.dispatch({
        changes: { from, to, insert: newText },
        selection: { anchor: from + before.length, head: from + before.length + selectedText.length },
      });
    },
    getSelection: () => {
      const { from, to } = view.state.selection.main;
      return {
        from,
        to,
        text: view.state.sliceDoc(from, to),
      };
    },
    focus: () => view.focus(),
  };
}

// ============================================================================
// MathLive Target
// ============================================================================

function createMathLiveTarget(element: HTMLElement): UnifiedInputTarget {
  const mathField = element as MathLiveElement; // MathLive math-field element

  return {
    type: 'mathlive',
    element,
    insertText: (text: string) => {
      // For MathLive, insert as text command
      if (mathField.executeCommand) {
        mathField.executeCommand(['insert', text]);
      } else if (mathField.insert) {
        mathField.insert(text);
      }
    },
    insertLatex: (latex: string) => {
      // For MathLive, insert LaTeX directly
      const mathLiveLatex = toMathLivePlaceholders(latex);
      insertIntoMathLive(mathField, mathLiveLatex);
    },
    insertFormula: (payload: FormulaInsertPayload) => {
      const normalized = normalizeFormulaInput(payload.latex, { preferDisplay: payload.displayMode });
      insertIntoMathLive(mathField, payload.mathLiveLatex ?? toMathLivePlaceholders(normalized.latex));
      return {
        handled: true,
        targetType: 'mathlive',
        latex: normalized.latex,
        displayMode: payload.displayMode ?? normalized.displayMode,
      };
    },
    insertMathLiveLatex: (latex: string) => {
      if (mathField.executeCommand) {
        mathField.executeCommand(['insert', latex]);
        mathField.executeCommand('moveToNextPlaceholder');
      } else if (mathField.insert) {
        mathField.insert(latex);
      }
    },
    wrapSelection: (before: string, after: string) => {
      // MathLive doesn't have a direct wrap API, so we get selection and replace
      const selection = mathField.selection;
      if (selection && mathField.executeCommand) {
        mathField.executeCommand(['insert', before + after]);
      }
    },
    getSelection: () => {
      const value = mathField.value || '';
      const selection = mathField.selection || { ranges: [[0, 0]] };
      const range = selection.ranges?.[0] || [0, 0];
      return {
        from: range[0],
        to: range[1],
        text: value.slice(range[0], range[1]),
      };
    },
    focus: () => mathField.focus?.(),
  };
}

// ============================================================================
// Textarea Target
// ============================================================================

function createTextareaTarget(element: HTMLTextAreaElement): UnifiedInputTarget {
  return {
    type: 'textarea',
    element,
    insertText: (text: string) => {
      const start = element.selectionStart;
      const end = element.selectionEnd;
      const value = element.value;
      const fillOffset = findFormulaFillPosition(text);
      element.value = value.slice(0, start) + text + value.slice(end);
      element.selectionStart = element.selectionEnd = start + (fillOffset ?? text.length);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    },
    insertLatex: (latex: string) => {
      // For textarea, wrap LaTeX in $ delimiters
      const wrappedLatex = `$${latex}$`;
      const fillOffset = findFormulaFillPosition(wrappedLatex);
      const start = element.selectionStart;
      const end = element.selectionEnd;
      const value = element.value;
      element.value = value.slice(0, start) + wrappedLatex + value.slice(end);
      element.selectionStart = element.selectionEnd = start + (fillOffset ?? wrappedLatex.length);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    },
    insertFormula: (payload: FormulaInsertPayload) => {
      const normalized = normalizeFormulaInput(payload.latex, { preferDisplay: payload.displayMode });
      const displayMode = payload.displayMode ?? normalized.displayMode;
      const format = payload.format ?? 'markdown';
      const text = format === 'markdown'
        ? wrapLatexForMarkdown(normalized.latex, displayMode)
        : normalized.latex;
      if (!text) return { handled: false, targetType: 'textarea' };

      const start = element.selectionStart;
      const end = element.selectionEnd;
      const value = element.value;
      const fillOffset = findFormulaFillPosition(text);
      element.value = value.slice(0, start) + text + value.slice(end);
      element.selectionStart = element.selectionEnd = start + (fillOffset ?? text.length);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        handled: true,
        targetType: 'textarea',
        from: start,
        to: start + text.length,
        latex: normalized.latex,
        markdown: text,
        displayMode,
      };
    },
    wrapSelection: (before: string, after: string) => {
      const start = element.selectionStart;
      const end = element.selectionEnd;
      const value = element.value;
      const selectedText = value.slice(start, end);
      const newText = before + selectedText + after;
      element.value = value.slice(0, start) + newText + value.slice(end);
      element.selectionStart = start + before.length;
      element.selectionEnd = start + before.length + selectedText.length;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    },
    getSelection: () => ({
      from: element.selectionStart,
      to: element.selectionEnd,
      text: element.value.slice(element.selectionStart, element.selectionEnd),
    }),
    focus: () => element.focus(),
  };
}

// ============================================================================
// ContentEditable Target
// ============================================================================

function createContentEditableTarget(element: HTMLElement): UnifiedInputTarget {
  return {
    type: 'contenteditable',
    element,
    insertText: (text: string) => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    },
    insertLatex: (latex: string) => {
      // For contenteditable, wrap LaTeX in $ delimiters
      const wrappedLatex = `$${latex}$`;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(wrappedLatex));
      range.collapse(false);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    },
    insertFormula: (payload: FormulaInsertPayload) => {
      const normalized = normalizeFormulaInput(payload.latex, { preferDisplay: payload.displayMode });
      const displayMode = payload.displayMode ?? normalized.displayMode;
      const format = payload.format ?? 'markdown';
      const text = format === 'markdown'
        ? wrapLatexForMarkdown(normalized.latex, displayMode)
        : normalized.latex;
      if (!text) return { handled: false, targetType: 'contenteditable' };

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return { handled: false, targetType: 'contenteditable' };
      }

      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        handled: true,
        targetType: 'contenteditable',
        latex: normalized.latex,
        markdown: text,
        displayMode,
      };
    },
    wrapSelection: (before: string, after: string) => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const selectedText = range.toString();
      range.deleteContents();
      range.insertNode(document.createTextNode(before + selectedText + after));
      element.dispatchEvent(new Event('input', { bubbles: true }));
    },
    getSelection: () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return { from: 0, to: 0, text: '' };
      }
      const range = selection.getRangeAt(0);
      return {
        from: 0, // ContentEditable doesn't have simple offsets
        to: 0,
        text: range.toString(),
      };
    },
    focus: () => element.focus(),
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the currently active input target
 * Detects the focused element and creates a unified interface
 */
export function getActiveInputTarget(): UnifiedInputTarget | null {
  // Return cached active target if still valid
  if (activeTarget && document.activeElement === activeTarget.element) {
    return activeTarget;
  }

  const focused = document.activeElement as HTMLElement;
  if (!focused) return lastActiveTarget;

  const type = detectInputType(focused);
  if (!type) {
    // Check if we're inside a known input container
    const mathField = focused.closest('math-field') as HTMLElement;
    if (mathField) {
      activeTarget = createInputTarget(mathField, 'mathlive');
      if (activeTarget) lastActiveTarget = activeTarget;
      return activeTarget;
    }

    const cmEditor = focused.closest('.cm-editor') as HTMLElement;
    if (cmEditor) {
      activeTarget = createInputTarget(cmEditor, 'codemirror');
      if (activeTarget) lastActiveTarget = activeTarget;
      return activeTarget;
    }

    return lastActiveTarget;
  }

  activeTarget = createInputTarget(focused, type);
  if (activeTarget) lastActiveTarget = activeTarget;
  return activeTarget;
}

/**
 * Get the last active input target (useful when keyboard steals focus)
 */
export function getLastActiveInputTarget(): UnifiedInputTarget | null {
  return lastActiveTarget;
}

/**
 * Set the active input target manually
 */
export function setActiveInputTarget(target: UnifiedInputTarget | null): void {
  activeTarget = target;
  if (target) lastActiveTarget = target;
}

/**
 * Set active input target from a specific element
 * Useful when focus is managed externally (e.g., HUD input focus)
 */
export function setActiveInputTargetFromElement(element: HTMLElement): UnifiedInputTarget | null {
  if (!element) return null;

  const type = detectInputType(element);
  if (!type) {
    const mathField = element.closest('math-field') as HTMLElement | null;
    if (mathField) {
      return setActiveInputTargetFromElement(mathField);
    }
    const cmEditor = element.closest('.cm-editor') as HTMLElement | null;
    if (cmEditor) {
      return setActiveInputTargetFromElement(cmEditor);
    }
    return null;
  }

  const target = createInputTarget(element, type);
  setActiveInputTarget(target);
  return target;
}

/**
 * Insert text at the current cursor position in the active input
 */
export function insertTextAtCursor(text: string): boolean {
  const target = getActiveInputTarget() || getLastActiveInputTarget();
  if (!target) return false;

  target.insertText(text);
  return true;
}

/**
 * Insert LaTeX at the current cursor position in the active input
 */
export function insertLatexAtCursor(
  latex: string,
  options: { displayMode?: boolean; format?: 'latex' | 'markdown'; mathLiveLatex?: string } = {}
): boolean {
  return insertFormulaAtCursor({ latex, ...options }).handled;
}

/**
 * Insert a formula and return metadata about where it landed.
 */
export function insertFormulaAtCursor(payload: FormulaInsertPayload): FormulaInsertResult {
  const target = getActiveInputTarget() || getLastActiveInputTarget();
  if (!target) return { handled: false, targetType: null };

  if (target.insertFormula) {
    return target.insertFormula(payload);
  }

  if (target.type === 'mathlive') {
    const normalized = normalizeFormulaInput(payload.latex, { preferDisplay: payload.displayMode });
    if (payload.mathLiveLatex && target.insertMathLiveLatex) {
      target.insertMathLiveLatex(payload.mathLiveLatex);
    } else {
      target.insertLatex(normalized.latex);
    }
    return {
      handled: true,
      targetType: 'mathlive',
      latex: normalized.latex,
      displayMode: payload.displayMode ?? normalized.displayMode,
    };
  }

  const normalized = normalizeFormulaInput(payload.latex, { preferDisplay: payload.displayMode });
  const displayMode = payload.displayMode ?? normalized.displayMode;
  const format = payload.format ?? 'markdown';
  if (format === 'markdown') {
    const wrapped = wrapLatexForMarkdown(normalized.latex, displayMode);
    if (!wrapped) return { handled: false, targetType: target.type };
    target.insertText(wrapped);
    return {
      handled: true,
      targetType: target.type,
      latex: normalized.latex,
      markdown: wrapped,
      displayMode,
    };
  }

  target.insertText(normalized.latex);
  return {
    handled: true,
    targetType: target.type,
    latex: normalized.latex,
    markdown: normalized.latex,
    displayMode,
  };
}

/**
 * Wrap the current selection with before/after strings
 */
export function wrapSelectionWith(before: string, after: string): boolean {
  const target = getActiveInputTarget() || getLastActiveInputTarget();
  if (!target) return false;

  target.wrapSelection(before, after);
  return true;
}

/**
 * Check if there's an active input target
 */
export function hasActiveInputTarget(): boolean {
  return getActiveInputTarget() !== null || getLastActiveInputTarget() !== null;
}
