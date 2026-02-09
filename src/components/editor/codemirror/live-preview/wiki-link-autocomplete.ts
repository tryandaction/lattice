/**
 * Wiki Link Autocomplete Plugin
 * Provides autocomplete suggestions when typing [[
 * 
 * Requirements: 22.4
 */

import {
  autocompletion,
  CompletionContext,
  CompletionResult,
  Completion,
} from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';

/**
 * Effect to update available files list
 */
export const setAvailableFiles = StateEffect.define<string[]>();

/**
 * State field to store available files
 */
export const availableFilesField = StateField.define<string[]>({
  create: () => [],
  update: (value, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(setAvailableFiles)) {
        return effect.value;
      }
    }
    return value;
  },
});

/**
 * Extract filename from path
 */
function getFileName(path: string): string {
  const parts = path.split(/[/\\]/);
  const name = parts[parts.length - 1] || path;
  // Remove .md extension for display
  return name.replace(/\.md$/i, '');
}

/**
 * Wiki link completion source
 */
function wikiLinkCompletions(context: CompletionContext): CompletionResult | null {
  // Check if we're typing a wiki link
  const before = context.matchBefore(/\[\[[^\]]*$/);
  if (!before) return null;
  
  // Get the text after [[
  const query = before.text.slice(2).toLowerCase();
  
  // Get available files from state
  const files = context.state.field(availableFilesField, false) || [];
  
  // Build completions
  const completions: Completion[] = [];
  
  for (const file of files) {
    const fileName = getFileName(file);
    const fileNameLower = fileName.toLowerCase();
    
    // Filter by query
    if (query && !fileNameLower.includes(query)) continue;
    
    completions.push({
      label: fileName,
      detail: file !== fileName ? file : undefined,
      type: 'file',
      apply: (view, completion, from, to) => {
        // Insert the file name and close the brackets
        const insert = `${fileName}]]`;
        view.dispatch({
          changes: { from: before.from + 2, to, insert },
        });
      },
    });
  }
  
  // Sort by relevance
  completions.sort((a, b) => {
    const aLower = a.label.toLowerCase();
    const bLower = b.label.toLowerCase();
    
    // Exact prefix match first
    if (aLower.startsWith(query) && !bLower.startsWith(query)) return -1;
    if (bLower.startsWith(query) && !aLower.startsWith(query)) return 1;
    
    // Then alphabetical
    return aLower.localeCompare(bLower);
  });
  
  if (completions.length === 0) return null;
  
  return {
    from: before.from + 2, // After [[
    options: completions,
    validFor: /^[^\]]*$/,
  };
}

/**
 * Wiki link autocomplete extension
 */
export const wikiLinkAutocomplete = [
  availableFilesField,
  autocompletion({
    override: [wikiLinkCompletions],
    activateOnTyping: true,
    maxRenderedOptions: 20,
    icons: true,
  }),
];

/**
 * Update available files in the editor
 */
export function updateAvailableFiles(view: EditorView, files: string[]): void {
  view.dispatch({
    effects: setAvailableFiles.of(files),
  });
}
