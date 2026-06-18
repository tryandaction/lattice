import { describe, expect, it, vi } from 'vitest';
import {
  getInputTargetTypeFromElement,
  insertLatexAtCursor,
  isEditableElement,
  setActiveInputTargetFromElement,
} from '../unified-input-handler';

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
    expect(mathField.insert).toHaveBeenCalledWith('\\frac{\\placeholder{}}{\\placeholder{}}');

    mathField.remove();
  });
});
