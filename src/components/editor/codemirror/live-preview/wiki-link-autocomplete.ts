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
import { slashCommandCompletions } from './markdown-smart-input';

/**
 * Effect to update available files list
 */
export const setAvailableFiles = StateEffect.define<string[]>();

export interface WikiLinkCompletionContext {
  currentFilePath?: string;
  recentFiles?: string[];
}

export const setWikiLinkCompletionContext = StateEffect.define<WikiLinkCompletionContext>();

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

export const wikiLinkCompletionContextField = StateField.define<WikiLinkCompletionContext>({
  create: () => ({}),
  update: (value, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(setWikiLinkCompletionContext)) {
        return effect.value;
      }
    }
    return value;
  },
});

/**
 * Extract filename from path
 */
export function getFileName(path: string): string {
  const parts = path.split(/[/\\]/);
  const name = parts[parts.length - 1] || path;
  // Remove .md extension for display
  return name.replace(/\.md$/i, '');
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

function getDirectory(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '';
}

export function rankWikiLinkCompletion(
  file: string,
  query: string,
  context: WikiLinkCompletionContext = {},
): number {
  const normalizedQuery = query.trim().toLowerCase();
  const fileName = getFileName(file);
  const fileNameLower = fileName.toLowerCase();
  const pathLower = normalizePath(file);
  let score = 0;

  if (!normalizedQuery) {
    score += 20;
  } else if (fileNameLower === normalizedQuery) {
    score += 1000;
  } else if (fileNameLower.startsWith(normalizedQuery)) {
    score += 700;
  } else if (fileNameLower.includes(normalizedQuery)) {
    score += 450;
  } else if (pathLower.includes(normalizedQuery)) {
    score += 240;
  }

  const currentDir = context.currentFilePath ? getDirectory(context.currentFilePath) : '';
  const fileDir = getDirectory(file);
  if (currentDir && fileDir === currentDir) {
    score += 180;
  } else if (currentDir && fileDir.startsWith(`${currentDir}/`)) {
    score += 80;
  }

  const recentIndex = (context.recentFiles ?? [])
    .map(normalizePath)
    .indexOf(pathLower);
  if (recentIndex >= 0) {
    score += Math.max(160 - recentIndex * 24, 24);
  }

  score -= Math.min(pathLower.split('/').length, 8) * 3;
  return score;
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
  const completionContext = context.state.field(wikiLinkCompletionContextField, false) || {};
  
  // Build completions
  const completions: Completion[] = [];
  
  for (const file of files) {
    const fileName = getFileName(file);
    const fileNameLower = fileName.toLowerCase();
    
    // Filter by query
    if (query && !fileNameLower.includes(query) && !file.toLowerCase().includes(query)) continue;
    
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
    const aDetail = a.detail ?? a.label;
    const bDetail = b.detail ?? b.label;
    const scoreDiff =
      rankWikiLinkCompletion(bDetail, query, completionContext) -
      rankWikiLinkCompletion(aDetail, query, completionContext);
    if (scoreDiff !== 0) return scoreDiff;
    return a.label.localeCompare(b.label);
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
  wikiLinkCompletionContextField,
  autocompletion({
    override: [wikiLinkCompletions, slashCommandCompletions],
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

export function updateWikiLinkCompletionContext(
  view: EditorView,
  context: WikiLinkCompletionContext,
): void {
  view.dispatch({
    effects: setWikiLinkCompletionContext.of(context),
  });
}
