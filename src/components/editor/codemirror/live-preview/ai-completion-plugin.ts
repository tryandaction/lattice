/**
 * AI Inline Completion Plugin (Ghost Text)
 * CodeMirror ViewPlugin that shows semi-transparent AI suggestions
 * - Detects typing pause (500ms) → sends context → renders ghost text
 * - Tab to accept, Escape to dismiss, continue typing to update
 */

import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
  keymap,
} from '@codemirror/view';
import { StateField, StateEffect, Extension } from '@codemirror/state';
import { requestCompletion } from '@/lib/ai/completion-provider';
import { aiCompletionTheme } from './ai-completion-theme';

// --- State Effects ---
const setSuggestion = StateEffect.define<string | null>();

// --- Ghost Text Widget ---
class GhostTextWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-ai-ghost-text';
    span.textContent = this.text;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  eq(other: GhostTextWidget): boolean {
    return this.text === other.text;
  }
}

// --- State Field for current suggestion ---
const suggestionField = StateField.define<string | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSuggestion)) return effect.value;
    }
    // Clear on any doc change (user typed something)
    if (tr.docChanged) return null;
    return value;
  },
});

// --- Decoration from suggestion field ---
const suggestionDecoration = EditorView.decorations.compute(
  [suggestionField],
  (state) => {
    const text = state.field(suggestionField);
    if (!text) return Decoration.none;
    const pos = state.selection.main.head;
    const deco = Decoration.widget({
      widget: new GhostTextWidget(text),
      side: 1,
    });
    return Decoration.set([deco.range(pos)]);
  }
);

// --- ViewPlugin: triggers completion requests on typing pause ---
const completionRequester = ViewPlugin.fromClass(
  class {
    private timeout: ReturnType<typeof setTimeout> | null = null;
    private abortController: AbortController | null = null;
    private fileName = '';

    constructor(private view: EditorView) {}

    setFileName(name: string) {
      this.fileName = name;
    }

    update(update: ViewUpdate) {
      if (!update.docChanged) return;
      this.cancel();
      // Debounce: wait 500ms after last keystroke
      this.timeout = setTimeout(() => this.requestSuggestion(), 500);
    }

    private async requestSuggestion() {
      const state = this.view.state;
      const pos = state.selection.main.head;
      const doc = state.doc.toString();
      const prefix = doc.slice(0, pos);
      const suffix = doc.slice(pos);

      // Don't suggest if cursor is at very start or line is empty
      if (prefix.length < 5) return;

      this.abortController = new AbortController();
      try {
        const suggestion = await requestCompletion(
          prefix,
          suffix,
          this.fileName || 'untitled.md',
          this.abortController.signal
        );
        if (suggestion && this.view.state.selection.main.head === pos) {
          this.view.dispatch({
            effects: setSuggestion.of(suggestion),
          });
        }
      } catch {
        // Silently ignore
      }
    }

    cancel() {
      if (this.timeout) {
        clearTimeout(this.timeout);
        this.timeout = null;
      }
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
    }

    destroy() {
      this.cancel();
    }
  }
);

// --- Keymap: Tab to accept, Escape to dismiss ---
const completionKeymap = keymap.of([
  {
    key: 'Tab',
    run(view) {
      const suggestion = view.state.field(suggestionField);
      if (!suggestion) return false;
      // Accept: insert the suggestion text at cursor
      const pos = view.state.selection.main.head;
      view.dispatch({
        changes: { from: pos, insert: suggestion },
        selection: { anchor: pos + suggestion.length },
        effects: setSuggestion.of(null),
      });
      return true;
    },
  },
  {
    key: 'Escape',
    run(view) {
      const suggestion = view.state.field(suggestionField);
      if (!suggestion) return false;
      view.dispatch({ effects: setSuggestion.of(null) });
      return true;
    },
  },
]);

/**
 * Create the AI inline completion extension bundle
 * @param enabled - whether completions are enabled
 */
export function aiCompletionExtension(enabled = true): Extension {
  if (!enabled) return [];
  return [
    suggestionField,
    suggestionDecoration,
    completionRequester,
    completionKeymap,
    aiCompletionTheme,
  ];
}

/**
 * Dismiss any active suggestion
 */
export function dismissSuggestion(view: EditorView): void {
  view.dispatch({ effects: setSuggestion.of(null) });
}
