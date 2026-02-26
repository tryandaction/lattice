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

    // Register sidebar once — render() reads from closure
    let headings: Heading[] = [];
    let sidebarRegistered = false;

    function registerSidebarOnce() {
      if (sidebarRegistered) return;
      sidebarRegistered = true;
      ctx.sidebar.register({
        id: 'toc',
        title: 'Outline',
        icon: 'list-tree',
        position: 'top',
        render: () => {
          if (headings.length === 0) {
            return { type: 'text', props: { content: 'No headings found' } };
          }
          return {
            type: 'list',
            props: {
              items: headings.map((h) => ({
                title: '  '.repeat(h.level - 1) + h.text,
                meta: `Line ${h.line}`,
              })),
            },
          };
        },
      });
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

      registerSidebarOnce();

      // Push live data to the panel
      ctx.panels.update('core.table-of-contents.panel', {
        items: headings.map((h) => ({
          title: '  '.repeat(h.level - 1) + h.text,
          description: `h${h.level}`,
          meta: `Line ${h.line}`,
        })),
      });
    }

    ctx.events.onActiveFileChange(refresh);
    ctx.events.onFileSave((path) => refresh(path));

    // Initialize
    refresh(null);
  },
};
