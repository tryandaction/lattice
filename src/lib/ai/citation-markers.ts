import { classifyStrictAiLink, type CitationContract } from './citation-contract';

interface MarkdownNode {
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
}

/** Number only verified links that actually appear in this rendered answer. */
export function rehypeCitationMarkers(options: { contracts: CitationContract[] }) {
  return (tree: MarkdownNode) => {
    const numbers = new Map<string, number>();
    const visit = (node: MarkdownNode) => {
      if (node.tagName === 'a' && typeof node.properties?.href === 'string') {
        const target = classifyStrictAiLink(node.properties.href, options.contracts);
        if ('citation' in target) {
          const key = target.citation.stableId;
          if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
          node.properties['data-ai-citation-number'] = numbers.get(key);
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
