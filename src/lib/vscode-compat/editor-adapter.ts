import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { autocompletion, completeFromList, snippetCompletion } from "@codemirror/autocomplete";
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { closeBrackets } from "@codemirror/autocomplete";
import type { VSCodeSnippetDefinition, VSCodeTask, VSCodeWorkbenchSettings } from "./types";

export interface VSCodeEditorCompartments {
  keymap: Compartment;
  autocomplete: Compartment;
  tabSize: Compartment;
  wordWrap: Compartment;
  theme: Compartment;
}

export function createVSCodeEditorCompartments(): VSCodeEditorCompartments {
  return {
    keymap: new Compartment(),
    autocomplete: new Compartment(),
    tabSize: new Compartment(),
    wordWrap: new Compartment(),
    theme: new Compartment(),
  };
}

export function buildVSCodeSnippetExtensions(snippets: VSCodeSnippetDefinition[]): Extension[] {
  if (snippets.length === 0) return [];
  const completions = snippets.flatMap((snippet) =>
    snippet.prefix.map((prefix) =>
      snippetCompletion(snippet.body, {
        label: prefix,
        detail: snippet.description,
        type: "keyword",
      }),
    ),
  );
  return [
    autocompletion({
      override: [completeFromList(completions)],
    }),
  ];
}

export function buildVSCodeTaskSummary(tasks: VSCodeTask[]): string[] {
  return tasks.map((task) => `${task.label} :: ${task.command}${task.args.length > 0 ? ` ${task.args.join(" ")}` : ""}`);
}

export function buildVSCodeEditorExtensions(settings: VSCodeWorkbenchSettings, snippets: VSCodeSnippetDefinition[]): Extension[] {
  const extensions: Extension[] = [
    EditorState.tabSize.of(settings.tabSize),
    EditorView.lineWrapping,
    lineNumbers(),
    search({ top: true }),
    highlightSelectionMatches(),
    bracketMatching(),
    indentOnInput(),
    closeBrackets(),
    keymap.of(searchKeymap),
  ];

  if (snippets.length > 0) {
    extensions.push(...buildVSCodeSnippetExtensions(snippets));
  }

  return extensions;
}
