import type { PluginModule, PluginContext } from '@/lib/plugins/types';

interface BibEntry {
  key: string;
  type: string;
  title: string;
  author: string;
  year: string;
  journal?: string;
  volume?: string;
  pages?: string;
  doi?: string;
  url?: string;
  [field: string]: string | undefined;
}

function parseBibTeX(bibtex: string): BibEntry[] {
  const entries: BibEntry[] = [];
  // Match @type{key, ... }
  const entryRegex = /@(\w+)\s*\{\s*([^,]+)\s*,([\s\S]*?)(?=\n@|\n*$)/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(bibtex)) !== null) {
    const type = match[1].toLowerCase();
    const key = match[2].trim();
    const body = match[3];

    if (type === 'comment' || type === 'preamble' || type === 'string') continue;

    const entry: BibEntry = { key, type, title: '', author: '', year: '' };

    // Parse fields: field = {value} or field = "value"
    const fieldRegex = /(\w+)\s*=\s*[{"]([\s\S]*?)[}"]/g;
    let fieldMatch: RegExpExecArray | null;
    while ((fieldMatch = fieldRegex.exec(body)) !== null) {
      const fieldName = fieldMatch[1].toLowerCase();
      const fieldValue = fieldMatch[2].trim();
      entry[fieldName] = fieldValue;
    }

    entries.push(entry);
  }

  return entries;
}

function formatCitation(entry: BibEntry, style: string): string {
  const authors = entry.author || 'Unknown';
  const year = entry.year || 'n.d.';
  const title = entry.title || 'Untitled';

  if (style === 'apa') {
    const journal = entry.journal ? `. *${entry.journal}*` : '';
    const vol = entry.volume ? `, ${entry.volume}` : '';
    const pages = entry.pages ? `, ${entry.pages}` : '';
    return `${authors} (${year}). ${title}${journal}${vol}${pages}.`;
  }

  // Default: simple format
  return `[${entry.key}] ${authors}, "${title}", ${year}.`;
}

function formatReference(entry: BibEntry, style: string): string {
  return formatCitation(entry, style);
}

export const citationManagerPlugin: PluginModule = {
  manifest: {
    id: 'core.citation-manager',
    name: 'Citation Manager',
    version: '1.0.0',
    description: 'Manages BibTeX references, inserts citations, and generates bibliographies.',
    author: 'Lattice',
    permissions: ['file:read', 'file:write', 'ui:commands', 'ui:panels', 'storage'],
    settings: [
      {
        id: 'citationStyle',
        type: 'select',
        label: 'Citation style',
        default: 'apa',
        options: [
          { label: 'APA', value: 'apa' },
          { label: 'Simple', value: 'simple' },
        ],
      },
      {
        id: 'bibFile',
        type: 'string',
        label: 'BibTeX file path',
        default: 'references.bib',
      },
    ],
    ui: {
      panels: [
        {
          id: 'core.citation-manager.library',
          title: 'References',
          icon: 'book-open',
          schema: {
            type: 'list',
            title: 'Citation Library',
            description: 'BibTeX references from your workspace',
          },
        },
      ],
    },
  },

  activate(ctx: PluginContext) {
    let entries: BibEntry[] = [];

    async function loadBibFile() {
      const bibPath = (ctx.settings.get('bibFile') as string) || 'references.bib';
      try {
        const content = await ctx.workspace.readFile(bibPath);
        entries = parseBibTeX(content);
        ctx.log(`Loaded ${entries.length} references from ${bibPath}`);
      } catch {
        entries = [];
        ctx.log(`No BibTeX file found at ${bibPath}`);
      }
    }

    ctx.commands.register({
      id: 'core.citation-manager.reload',
      title: 'Reload References',
      run: loadBibFile,
    });

    ctx.commands.register({
      id: 'core.citation-manager.list',
      title: 'List References',
      run: async () => {
        if (entries.length === 0) {
          await loadBibFile();
        }
        if (entries.length === 0) {
          ctx.log('No references loaded');
          return;
        }
        const style = (ctx.settings.get('citationStyle') as string) || 'apa';
        const list = entries.map((e) => formatReference(e, style));
        ctx.log(`References (${entries.length}):\n${list.join('\n')}`);
      },
    });

    ctx.commands.register({
      id: 'core.citation-manager.generate-bibliography',
      title: 'Generate Bibliography',
      run: async () => {
        const activePath = await ctx.obsidian?.app.workspace.getActiveFile();
        if (!activePath) {
          ctx.log('No active file');
          return;
        }

        if (entries.length === 0) await loadBibFile();
        if (entries.length === 0) {
          ctx.log('No references to generate bibliography from');
          return;
        }

        const content = await ctx.workspace.readFile(activePath);
        const style = (ctx.settings.get('citationStyle') as string) || 'apa';

        // Find cited keys in the document: [@key] or @key
        const citedKeys = new Set<string>();
        const citeRegex = /\[@?([a-zA-Z0-9_.-]+)\]/g;
        let m: RegExpExecArray | null;
        while ((m = citeRegex.exec(content)) !== null) {
          citedKeys.add(m[1]);
        }

        const cited = entries.filter((e) => citedKeys.has(e.key));
        if (cited.length === 0) {
          ctx.log('No citations found in document');
          return;
        }

        const bib = cited
          .sort((a, b) => a.author.localeCompare(b.author))
          .map((e) => `- ${formatReference(e, style)}`)
          .join('\n');

        const bibSection = `\n\n## References\n\n${bib}\n`;

        // Append or replace references section
        const refIndex = content.indexOf('## References');
        let newContent: string;
        if (refIndex >= 0) {
          // Replace from ## References to end or next ## heading
          const afterRef = content.slice(refIndex);
          const nextHeading = afterRef.indexOf('\n## ', 1);
          if (nextHeading >= 0) {
            newContent = content.slice(0, refIndex) + bibSection.trim() + '\n\n' + afterRef.slice(nextHeading + 1);
          } else {
            newContent = content.slice(0, refIndex) + bibSection.trim() + '\n';
          }
        } else {
          newContent = content + bibSection;
        }

        await ctx.workspace.writeFile(activePath, newContent);
        ctx.log(`Generated bibliography with ${cited.length} references`);
      },
    });

    // Auto-load on workspace open
    ctx.events.onWorkspaceOpen(() => loadBibFile());
    loadBibFile();
  },
};
