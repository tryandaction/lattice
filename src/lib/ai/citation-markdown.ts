import { unified } from 'unified';
import remarkParse from 'remark-parse';

interface MarkdownNode {
  type: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: MarkdownNode[];
}

const parser = unified().use(remarkParse);
const bareCitation = /citation:[a-z0-9-]+(?:\?\s*quote=(?:%[a-f0-9]{2}|[a-z0-9_~.!'*-])*)?/gi;

/** Provider-written source tokens are links, never visible protocol/percent-encoded text. */
export function linkifyBareCitationTokens(markdown: string): string {
  if (!markdown.includes('citation:')) return markdown;
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const walk = (node: MarkdownNode) => {
    // Preserve literal examples, existing destinations and raw HTML.
    if (['link', 'image', 'definition', 'code', 'inlineCode', 'html'].includes(node.type)) return;
    if (node.type === 'text') {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      const source = markdown.slice(start, end);
      for (const match of source.matchAll(bareCitation)) {
        const token = match[0].replace(/\?\s*quote=/, '?quote=');
        replacements.push({ start: start + match.index!, end: start + match.index! + match[0].length, value: `[来源](${token})` });
      }
      return;
    }
    node.children?.forEach(walk);
  };
  walk(parser.parse(markdown) as MarkdownNode);
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    markdown = markdown.slice(0, replacement.start) + replacement.value + markdown.slice(replacement.end);
  }
  return markdown;
}
