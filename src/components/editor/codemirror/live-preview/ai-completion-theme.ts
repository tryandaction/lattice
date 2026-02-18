/**
 * AI Completion Ghost Text Theme
 * Styles for inline AI suggestions (semi-transparent text)
 */

import { EditorView } from '@codemirror/view';

export const aiCompletionTheme = EditorView.theme({
  '.cm-ai-ghost-text': {
    color: 'var(--muted-foreground, #888)',
    opacity: '0.5',
    fontStyle: 'italic',
    cursor: 'default',
    userSelect: 'none',
    pointerEvents: 'none',
  },
  '.cm-ai-ghost-text-hint': {
    position: 'absolute',
    right: '8px',
    bottom: '2px',
    fontSize: '10px',
    color: 'var(--muted-foreground, #888)',
    opacity: '0.6',
    pointerEvents: 'none',
    userSelect: 'none',
  },
});
