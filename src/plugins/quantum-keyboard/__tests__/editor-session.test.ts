import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { syncPlugins } from '@/lib/plugins/runtime';
import { createPluginEditorExtensions } from '@/components/editor/codemirror/plugin-extensions';
import { queueQuantumMathInput } from '@/lib/quantum-input-session';

vi.mock('mathlive', () => {
  class TestMathfield extends HTMLElement {
    constructor() { super(); this.tabIndex = 0; }
    value = '';
    position = 0;
    setValue(value: string) { this.value = value; }
    getValue() { return this.value; }
    insert(value: string, options?: { focus?: boolean }) {
      this.value += value;
      if (options?.focus) this.focus();
      this.dispatchEvent(new Event('input'));
    }
    executeCommand(command: string) {
      if (command === 'moveToMathfieldStart') this.position = 0;
      return true;
    }
    getOffsetFromPoint(x: number, y: number) { return x === 91 && y === 37 ? 7 : 0; }
  }
  customElements.define('math-field', TestMathfield);
  return { MathfieldElement: TestMathfield };
});

beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
});

afterEach(async () => { await syncPlugins({ pluginsEnabled: false, enabledPluginIds: [] }); });

async function createEditingView() {
  await syncPlugins({ pluginsEnabled: true, enabledPluginIds: ['quantum-keyboard'] });
  return new EditorView({
    parent: document.body,
    state: EditorState.create({ doc: '$x+y$', extensions: createPluginEditorExtensions() }),
  });
}

describe('Quantum Keyboard editing session', () => {
  it('keeps focus in another input when it changes before formula creation resolves', async () => {
    const view = await createEditingView();
    const other = document.createElement('textarea');
    document.body.append(other);
    try {
      view.focus();
      view.dom.dispatchEvent(new CustomEvent('quantum-formula-inserted', {
        detail: { from: 0, to: 5, latex: 'x+y', displayMode: false },
      }));
      queueQuantumMathInput(view.dom, field => field.insert('+z', { focus: true }));
      other.focus();
      await vi.dynamicImportSettled();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      expect(document.activeElement).toBe(other);
      expect(view.state.doc.toString()).toBe('$x+y+z$');
      expect(view.dom.querySelector('math-field')).toBeNull();
      expect(queueQuantumMathInput(view.dom, field => field.insert('lost'))).toBe(false);
    } finally { view.destroy(); other.remove(); }
  });

  it('keeps focus in another input when it changes before the first animation frame', async () => {
    const view = await createEditingView();
    const other = document.createElement('textarea');
    document.body.append(other);
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      view.focus();
      view.dom.dispatchEvent(new CustomEvent('quantum-formula-inserted', {
        detail: { from: 0, to: 5, latex: 'x+y', displayMode: false },
      }));
      await vi.dynamicImportSettled();
      expect(view.dom.querySelector('math-field')).not.toBeNull();
      queueQuantumMathInput(view.dom, field => field.insert('+z', { focus: true }));
      other.focus();
      vi.advanceTimersToNextFrame();
      expect(document.activeElement).toBe(other);
      expect(view.state.doc.toString()).toBe('$x+y+z$');
      expect(view.dom.querySelector('math-field')).toBeNull();
      expect(queueQuantumMathInput(view.dom, field => field.insert('lost'))).toBe(false);
    } finally { view.destroy(); other.remove(); vi.useRealTimers(); }
  });

  it('commits on blur without moving focus back from another input', async () => {
    const view = await createEditingView();
    const other = document.createElement('textarea');
    document.body.append(other);
    try {
      view.focus();
      view.dom.dispatchEvent(new CustomEvent('quantum-formula-inserted', {
        detail: { from: 0, to: 5, latex: 'x+y', displayMode: false },
      }));
      await vi.waitFor(() => expect(document.activeElement?.tagName).toBe('MATH-FIELD'));
      (view.dom.querySelector('math-field') as HTMLElement & { value: string }).value = 'x+z';
      other.focus();
      await Promise.resolve();
      expect(view.state.doc.toString()).toBe('$x+z$');
      expect(view.dom.querySelector('math-field')).toBeNull();
      expect(document.activeElement).toBe(other);
    } finally { view.destroy(); other.remove(); }
  });

  it('focuses the formula when insertion removes the originating lookup control', async () => {
    const view = await createEditingView();
    const controls = document.createElement('div');
    controls.setAttribute('data-quantum-keyboard', '');
    const lookup = document.createElement('div');
    const search = document.createElement('input');
    lookup.append(search);
    controls.append(lookup);
    document.body.append(controls);
    try {
      search.focus();
      view.dom.dispatchEvent(new CustomEvent('quantum-formula-inserted', {
        detail: { from: 0, to: 5, latex: 'x+y', displayMode: false },
      }));
      lookup.remove();
      await vi.dynamicImportSettled();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      expect(document.activeElement).toBe(view.dom.querySelector('math-field'));
    } finally { view.destroy(); controls.remove(); }
  });

  it('restores editor focus when Ctrl+Enter explicitly finishes formula editing', async () => {
    const view = await createEditingView();
    try {
      view.focus();
      view.dom.dispatchEvent(new CustomEvent('quantum-formula-inserted', {
        detail: { from: 0, to: 5, latex: 'x+y', displayMode: false },
      }));
      await vi.waitFor(() => expect(document.activeElement?.tagName).toBe('MATH-FIELD'));
      const field = view.dom.querySelector('math-field') as HTMLElement & { value: string };
      field.value = 'x+z';
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
      expect(view.state.doc.toString()).toBe('$x+z$');
      expect(view.dom.querySelector('math-field')).toBeNull();
      expect(document.activeElement).toBe(view.contentDOM);
    } finally { view.destroy(); }
  });

  it('positions the template before focus flushes the first queued input', async () => {
    const view = await createEditingView();
    try {
      view.dom.dispatchEvent(new CustomEvent('quantum-formula-inserted', {
        detail: { from: 0, to: 5, latex: 'x+y', displayMode: false },
      }));
      queueQuantumMathInput(view.dom, field => {
        field.setValue('z');
        field.position = 1;
      });
      await vi.waitFor(() => expect((view.dom.querySelector('math-field') as HTMLElement & { value: string })?.value).toBe('z'));
      expect((view.dom.querySelector('math-field') as HTMLElement & { position: number }).position).toBe(1);
    } finally { view.destroy(); }
  });

  it('commits pending formula input and restores editor layout when disabled', async () => {
    const view = await createEditingView();
    try {
      view.dom.dispatchEvent(new CustomEvent('quantum-formula-inserted', {
        detail: { from: 0, to: 5, latex: 'x+y', displayMode: false },
      }));
      await vi.waitFor(() => expect(view.dom.querySelector('math-field')).not.toBeNull());
      const field = view.dom.querySelector('math-field') as HTMLElement & { value: string };
      field.value = 'x+z'; // MathLive has changed before delivering its input notification.
      view.dom.style.height = '123px';
      view.contentDOM.style.paddingBottom = '80px';
      await syncPlugins({ pluginsEnabled: false, enabledPluginIds: [] });
      expect(view.state.doc.toString()).toBe('$x+z$');
      expect(view.dom.querySelector('math-field')).toBeNull();
      expect(view.dom.style.height).toBe('');
      expect(view.contentDOM.style.paddingBottom).toBe('');
    } finally { view.destroy(); }
  });

  it('preserves settings focus while disabling an active formula session', async () => {
    const view = await createEditingView();
    const settings = document.createElement('div');
    settings.setAttribute('data-quantum-keyboard', '');
    const input = document.createElement('textarea');
    settings.append(input);
    document.body.append(settings);
    try {
      view.focus();
      view.dom.dispatchEvent(new CustomEvent('quantum-formula-inserted', {
        detail: { from: 0, to: 5, latex: 'x+y', displayMode: false },
      }));
      await vi.waitFor(() => expect(document.activeElement?.tagName).toBe('MATH-FIELD'));
      (view.dom.querySelector('math-field') as HTMLElement & { value: string }).value = 'x+z';
      input.focus();
      await syncPlugins({ pluginsEnabled: false, enabledPluginIds: [] });
      expect(view.state.doc.toString()).toBe('$x+z$');
      expect(view.dom.querySelector('math-field')).toBeNull();
      expect(document.activeElement).toBe(input);
    } finally { view.destroy(); settings.remove(); }
  });

  it('places the formula caret at the double-clicked point', async () => {
    const view = await createEditingView();
    try {
      const rendered = document.createElement('span');
      rendered.className = 'cm-math-inline';
      Object.assign(rendered.dataset, { from: '0', to: '5', latex: 'x+y' });
      view.contentDOM.append(rendered);
      rendered.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 91, clientY: 37 }));
      await vi.waitFor(() => {
        const field = view.dom.querySelector('math-field') as (HTMLElement & { position: number }) | null;
        expect(field?.position).toBe(7);
      });
    } finally { view.destroy(); }
  });
});
