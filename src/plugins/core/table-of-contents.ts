import type { PluginModule, PluginContext } from '@/lib/plugins/types';

export const tableOfContentsPlugin: PluginModule = {
  manifest: {
    id: 'core.table-of-contents',
    name: 'Table of Contents',
    version: '1.0.0',
    description: 'Shows a navigable heading outline in the sidebar for the active markdown file.',
    author: 'Lattice',
    permissions: ['file:read', 'ui:sidebar', 'ui:panels'],
    ui: {
      panels: [
        {
          id: 'core.table-of-contents.panel',
          title: 'Table of Contents',
          icon: 'list-tree',
          schema: {
            type: 'list',
            title: 'Document Outline',
            description: 'Headings from the active markdown file',
          },
        },
      ],
    },
  },

  activate(ctx: PluginContext) {
    interface Heading {
      level: number;
      text: string;
      line: number;
    }

    let headings: Heading[] = [];

    function parseHeadings(content: string): Heading[] {
      const result: Heading[] = [];
      const lines = content.split('\n');
      let inCodeBlock = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trimStart().startsWith('```')) {
          inCodeBlock = !inCodeBlock;
          continue;
        }
        if (inCodeBlock) continue;

        const match = line.match(/^(#{1,6})\s+(.+)/);
        if (match) {
          result.push({
            level: match[1].length,
            text: match[2].replace(/\s*#+\s*$/, '').trim(),
            line: i + 1,
          });
        }
      }
      return result;
    }

    function formatOutline(): string {
      if (headings.length === 0) return 'No headings found';
      return headings
        .map((h) => {
          const indent = '  '.repeat(h.level - 1);
          return `${indent}${h.text}`;
        })
        .join('\n');
    }

    async function refresh(path: string | null) {
      if (!path || !path.toLowerCase().endsWith('.md')) {
        headings = [];
      } else {
        try {
          const content = await ctx.workspace.readFile(path);
          headings = parseHeadings(content);
        } catch {
          headings = [];
        }
      }

      ctx.sidebar.register({
        id: 'toc',
        title: 'Outline',
        icon: 'list-tree',
        position: 'top',
        render: () => ({
          type: 'text',
          props: { content: formatOutline() },
        }),
      });
    }

    ctx.events.onActiveFileChange(refresh);
    ctx.events.onFileSave((path) => refresh(path));

    // Initialize
    refresh(null);
  },
};
