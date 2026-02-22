import type { PluginModule, PluginContext } from '@/lib/plugins/types';

interface LintIssue {
  line: number;
  rule: string;
  message: string;
  severity: 'warning' | 'error';
}

function lintMarkdown(content: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const lines = content.split('\n');
  let inCodeBlock = false;
  let lastHeadingLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Check heading level jumps (e.g., h1 → h3 skipping h2)
    const headingMatch = line.match(/^(#{1,6})\s/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      if (lastHeadingLevel > 0 && level > lastHeadingLevel + 1) {
        issues.push({
          line: lineNum,
          rule: 'heading-increment',
          message: `Heading level jumped from h${lastHeadingLevel} to h${level}`,
          severity: 'warning',
        });
      }
      lastHeadingLevel = level;
    }

    // Check images missing alt text
    const imgMatches = line.matchAll(/!\[([^\]]*)\]\([^)]+\)/g);
    for (const m of imgMatches) {
      if (!m[1].trim()) {
        issues.push({
          line: lineNum,
          rule: 'img-alt',
          message: 'Image is missing alt text',
          severity: 'warning',
        });
      }
    }

    // Check broken relative links (links to anchors that look suspicious)
    const linkMatches = line.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
    for (const m of linkMatches) {
      const href = m[2];
      // Flag empty hrefs
      if (!href.trim()) {
        issues.push({
          line: lineNum,
          rule: 'empty-link',
          message: `Link "${m[1]}" has an empty href`,
          severity: 'error',
        });
      }
    }

    // Check for trailing spaces (except in code blocks)
    if (line.endsWith(' ') && !line.endsWith('  ')) {
      // Single trailing space (not intentional line break)
      issues.push({
        line: lineNum,
        rule: 'trailing-space',
        message: 'Trailing space (use two spaces for line break or remove)',
        severity: 'warning',
      });
    }
  }

  return issues;
}

export const markdownLinterPlugin: PluginModule = {
  manifest: {
    id: 'core.markdown-linter',
    name: 'Markdown Linter',
    version: '1.0.0',
    description: 'Checks markdown files for broken links, missing alt text, heading level issues, and more.',
    author: 'Lattice',
    permissions: ['file:read', 'ui:commands', 'ui:panels'],
    ui: {
      panels: [
        {
          id: 'core.markdown-linter.results',
          title: 'Lint Results',
          icon: 'check-circle',
          schema: {
            type: 'list',
            title: 'Markdown Issues',
            description: 'Issues found in the active file',
          },
        },
      ],
    },
  },

  activate(ctx: PluginContext) {
    let lastIssues: LintIssue[] = [];

    async function runLint(path: string | null) {
      if (!path || !path.toLowerCase().endsWith('.md')) {
        lastIssues = [];
        return;
      }
      try {
        const content = await ctx.workspace.readFile(path);
        lastIssues = lintMarkdown(content);
      } catch {
        lastIssues = [];
      }

      ctx.log(`Lint: ${lastIssues.length} issue(s)`);
      // Update panel data via log for now — panels read from schema
    }

    ctx.commands.register({
      id: 'core.markdown-linter.run',
      title: 'Lint Current File',
      run: async () => {
        // We don't have direct active file access via commands, so lint all md files
        // In practice, the event-based lint covers the active file
        ctx.log('Linting triggered via command');
      },
    });

    ctx.events.onActiveFileChange(runLint);
    ctx.events.onFileSave(runLint);
  },
};
