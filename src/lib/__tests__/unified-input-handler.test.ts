import { describe, expect, it, vi } from 'vitest';
import {
  getInputTargetTypeFromElement,
  insertFormulaAtCursor,
  insertLatexAtCursor,
  isEditableElement,
  registerCodeMirrorView,
  setActiveInputTargetFromElement,
} from '../unified-input-handler';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

describe('unified-input-handler editable detection', () => {
  it('detects CodeMirror targets from nested elements', () => {
    const editor = document.createElement('div');
    editor.className = 'cm-editor';
    const content = document.createElement('div');
    content.className = 'cm-content';
    editor.appendChild(content);
    document.body.appendChild(editor);

    expect(getInputTargetTypeFromElement(content)).toBe('codemirror');
    expect(isEditableElement(content)).toBe(true);

    editor.remove();
  });

  it('detects mathlive, textarea, and contenteditable targets', () => {
    const mathField = document.createElement('math-field');
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');

    document.body.appendChild(mathField);
    document.body.appendChild(textarea);
    document.body.appendChild(editable);

    expect(getInputTargetTypeFromElement(mathField)).toBe('mathlive');
    expect(getInputTargetTypeFromElement(textarea)).toBe('textarea');
    expect(getInputTargetTypeFromElement(editable)).toBe('contenteditable');

    expect(isEditableElement(mathField)).toBe(true);
    expect(isEditableElement(textarea)).toBe(true);
    expect(isEditableElement(editable)).toBe(true);

    mathField.remove();
    textarea.remove();
    editable.remove();
  });

  it('treats native input controls as editable and plain div as non-editable', () => {
    const input = document.createElement('input');
    const select = document.createElement('select');
    const plain = document.createElement('div');

    document.body.appendChild(input);
    document.body.appendChild(select);
    document.body.appendChild(plain);

    expect(isEditableElement(input)).toBe(true);
    expect(isEditableElement(select)).toBe(true);
    expect(isEditableElement(plain)).toBe(false);

    input.remove();
    select.remove();
    plain.remove();
  });

  it('uses explicit MathLive placeholder latex when provided', () => {
    const mathField = document.createElement('math-field') as HTMLElement & {
      insert: ReturnType<typeof vi.fn>;
    };
    mathField.insert = vi.fn();
    document.body.appendChild(mathField);
    setActiveInputTargetFromElement(mathField);

    const inserted = insertLatexAtCursor('\\frac{}{}', {
      mathLiveLatex: '\\frac{\\placeholder{}}{\\placeholder{}}',
    });

    expect(inserted).toBe(true);
    expect(mathField.insert).toHaveBeenCalledWith('\\frac{\\placeholder{}}{\\placeholder{}}', {
      insertionMode: 'insertAfter',
      selectionMode: 'after',
    });

    mathField.remove();
  });

  it('places the textarea cursor in the first formula slot after insertion', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'f=';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    setActiveInputTargetFromElement(textarea);

    const inserted = insertLatexAtCursor('\\frac{}{}');

    expect(inserted).toBe(true);
    expect(textarea.value).toBe('f=$\\frac{}{}$');
    expect(textarea.selectionStart).toBe('f=$\\frac{'.length);
    expect(textarea.selectionEnd).toBe(textarea.selectionStart);

    textarea.remove();
  });

  it('returns CodeMirror formula range and emits activation event', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({ doc: 'f=' }),
      parent: host,
    });

    registerCodeMirrorView(view.dom, view);
    view.dispatch({ selection: { anchor: 2 } });
    setActiveInputTargetFromElement(view.dom);

    const eventPromise = new Promise<CustomEvent>((resolve) => {
      view.dom.addEventListener('quantum-formula-inserted', (event) => {
        resolve(event as CustomEvent);
      }, { once: true });
    });

    const result = insertFormulaAtCursor({ latex: '\\frac{}{}' });
    const event = await eventPromise;

    expect(result).toMatchObject({
      handled: true,
      targetType: 'codemirror',
      from: 2,
      to: 13,
      latex: '\\frac{}{}',
      markdown: '$\\frac{}{}$',
      displayMode: false,
    });
    expect(event.detail).toMatchObject({
      from: 2,
      to: 13,
      latex: '\\frac{}{}',
      markdown: '$\\frac{}{}$',
      displayMode: false,
    });
    expect(view.state.doc.toString()).toBe('f=$\\frac{}{}$');

    view.destroy();
    host.remove();
  });

  it('places the textarea cursor in the first matrix cell for display formulas', () => {
    const textarea = document.createElement('textarea');
    textarea.value = '';
    document.body.appendChild(textarea);
    textarea.focus();
    setActiveInputTargetFromElement(textarea);

    const inserted = insertLatexAtCursor('\\begin{pmatrix}{}&{}\\\\{}&{}\\end{pmatrix}', {
      displayMode: true,
    });

    expect(inserted).toBe(true);
    expect(textarea.value).toContain('$$\\begin{pmatrix}{}&{}');
    expect(textarea.selectionStart).toBe('$$\\begin{pmatrix}{'.length);

    textarea.remove();
  });
});
