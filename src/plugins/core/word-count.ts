import type { PluginModule, PluginContext } from '@/lib/plugins/types';

export const wordCountPlugin: PluginModule = {
  manifest: {
    id: 'core.word-count',
    name: 'Word Count',
    version: '1.0.0',
    description: 'Displays word and character count in the status bar for the active file.',
    author: 'Lattice',
    permissions: ['file:read', 'ui:statusbar'],
    settings: [
      {
        id: 'showCharacters',
        type: 'boolean',
        label: 'Show character count',
        default: true,
      },
      {
        id: 'showReadingTime',
        type: 'boolean',
        label: 'Show estimated reading time',
        default: false,
      },
    ],
  },

  activate(ctx: PluginContext) {
    let currentText = '';
    let disposeFileOpen: (() => void) | null = null;
    let disposeActiveChange: (() => void) | null = null;

    function countWords(text: string): number {
      const trimmed = text.trim();
      if (!trimmed) return 0;
      // Handle CJK characters as individual words
      const cjk = trimmed.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g);
      const cjkCount = cjk ? cjk.length : 0;
      // Remove CJK chars, then count space-separated words
      const nonCjk = trimmed.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, ' ').trim();
      const wordCount = nonCjk ? nonCjk.split(/\s+/).filter(Boolean).length : 0;
      return wordCount + cjkCount;
    }

    function updateStatusBar() {
      const words = countWords(currentText);
      const chars = currentText.length;
      const showChars = ctx.settings.get('showCharacters') ?? true;
      const showReading = ctx.settings.get('showReadingTime') ?? false;

      let text = `${words} words`;
      if (showChars) text += ` · ${chars} chars`;
      if (showReading) {
        const minutes = Math.max(1, Math.ceil(words / 200));
        text += ` · ${minutes} min read`;
      }

      ctx.statusBar.register({
        id: 'word-count',
        text,
        tooltip: `${words} words, ${chars} characters`,
        position: 'right',
      });
    }

    async function loadFileContent(path: string | null) {
      if (!path) {
        currentText = '';
        updateStatusBar();
        return;
      }
      try {
        currentText = await ctx.workspace.readFile(path);
      } catch {
        currentText = '';
      }
      updateStatusBar();
    }

    disposeActiveChange = ctx.events.onActiveFileChange((path) => {
      loadFileContent(path);
    });

    disposeFileOpen = ctx.events.onFileSave((path) => {
      loadFileContent(path);
    });

    ctx.settings.onChange('showCharacters', () => updateStatusBar());
    ctx.settings.onChange('showReadingTime', () => updateStatusBar());

    // Initialize with empty state
    updateStatusBar();
  },
};
