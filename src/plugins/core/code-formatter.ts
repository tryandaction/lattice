import type { PluginModule, PluginContext } from '@/lib/plugins/types';

/**
 * Simple code formatter for markdown code blocks.
 * Normalizes indentation and trims trailing whitespace.
 */
function formatCodeBlock(code: string, language: string): string {
  const lines = code.split('\n');

  // Trim trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  // Trim leading empty lines
  while (lines.length > 0 && lines[0].trim() === '') {
    lines.shift();
  }

  // Find minimum indentation (ignoring empty lines)
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    minIndent = Math.min(minIndent, indent);
  }
  if (!isFinite(minIndent)) minIndent = 0;

  // Normalize: remove common indent, trim trailing whitespace per line
  return lines
    .map((line) => {
      if (line.trim().length === 0) return '';
      return line.slice(minIndent).trimEnd();
    })
    .join('\n');
}

export const codeFormatterPlugin: PluginModule = {
  manifest: {
    id: 'core.code-formatter',
    name: 'Code Formatter',
    version: '1.0.0',
    description: 'Formats code blocks in markdown files by normalizing indentation and trimming whitespace.',
    author: 'Lattice',
    permissions: ['file:read', 'file:write', 'ui:commands'],
  },

  activate(ctx: PluginContext) {
    ctx.commands.register({
      id: 'core.code-formatter.format',
      title: 'Format Code Blocks',
      run: async () => {
        const files = await ctx.workspace.listFiles();
        // Find active markdown file by reading all — in practice, we'd use active file
        // For now, provide a command that formats a specific file
        ctx.log('Code formatter: use format-file command with a path');
      },
    });

    ctx.commands.register({
      id: 'core.code-formatter.format-active',
      title: 'Format Code Blocks in Active File',
      run: async () => {
        // Read active file via obsidian compat
        const activePath = await ctx.obsidian?.app.workspace.getActiveFile();
        if (!activePath) {
          ctx.log('No active file');
          return;
        }
        if (!activePath.toLowerCase().endsWith('.md')) {
          ctx.log('Active file is not markdown');
          return;
        }

        const content = await ctx.workspace.readFile(activePath);
        const formatted = formatMarkdownCodeBlocks(content);

        if (formatted === content) {
          ctx.log('No formatting changes needed');
          return;
        }

        await ctx.workspace.writeFile(activePath, formatted);
        ctx.log('Code blocks formatted');
      },
    });
  },
};

function formatMarkdownCodeBlocks(content: string): string {
  // Match fenced code blocks: ```lang\n...\n```
  return content.replace(
    /^(```(\w*)\n)([\s\S]*?)(^```\s*$)/gm,
    (_match, opening: string, lang: string, code: string, closing: string) => {
      const formatted = formatCodeBlock(code, lang);
      return `${opening}${formatted}\n${closing}`;
    }
  );
}
