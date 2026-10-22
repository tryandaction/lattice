import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { ChatMessage } from '@/stores/ai-chat-store';
import { buildCitationContracts, classifyStrictAiLink } from './citation-contract';
import { buildAgentResultSections } from './agent-result-view-model';
import { linkifyBareCitationTokens } from './citation-markdown';
import { extractProviderText } from './provider-response';

interface MarkdownNode {
  type: string;
  url?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: MarkdownNode[];
}

const parser = unified().use(remarkParse);

/** Export the answer source, preserving Markdown syntax and excluding execution metadata. */
export function buildAnswerMarkdown(message: ChatMessage): { markdown: string; sourceNote: string | null } {
  let markdown = buildAgentResultSections(message)?.[0]?.content ?? message.content;
  const trimmed = markdown.trim();
  if (message.editedAt === undefined && trimmed.startsWith('{')) {
    let envelope: Record<string, unknown> | null = null;
    try { envelope = JSON.parse(trimmed) as Record<string, unknown>; } catch { /* Incomplete streaming text is still a checkpoint. */ }
    const typedContent = envelope && Array.isArray(envelope.content) && envelope.content.some(part => part && typeof part === 'object' && ['text', 'thinking', 'reasoning'].includes(String(part.type)));
    if (envelope && ('thinking' in envelope || 'reasoning' in envelope || typedContent)) {
      markdown = extractProviderText(envelope.content);
      if (!markdown.trim()) throw new Error('没有可复制的回答 Markdown；内部思考或执行记录不会导出。');
    }
  }
  markdown = linkifyBareCitationTokens(markdown);
  const contracts = buildCitationContracts(message.evidenceRefs ?? message.promptContext?.evidenceRefs ?? []);
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  let hasWorkspaceLinks = false;
  let hasCloudLinks = false;
  const walk = (node: MarkdownNode) => {
    if (['code', 'inlineCode', 'html', 'image'].includes(node.type)) return;
    if ((node.type === 'link' || node.type === 'definition') && node.url && /^(?:citation:|unresolved:)/i.test(node.url)) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      const source = markdown.slice(start, end);
      const classified = classifyStrictAiLink(node.url, contracts);
      if (classified.kind === 'citation' || classified.kind === 'workspace_file') {
        const urlOffset = source.lastIndexOf(node.url);
        if (urlOffset < 0) return;
        replacements.push({ start: start + urlOffset, end: start + urlOffset + node.url.length, value: classified.href });
        if (classified.citation.evidenceRef.cloudIdentity) hasCloudLinks = true;
        else hasWorkspaceLinks = true;
      } else {
        const childStart = node.children?.[0]?.position?.start.offset;
        const childEnd = node.children?.at(-1)?.position?.end.offset;
        const label = childStart !== undefined && childEnd !== undefined ? markdown.slice(childStart, childEnd) : '来源';
        replacements.push({ start, end, value: `${label}（来源未验证）` });
      }
      return;
    }
    node.children?.forEach(walk);
  };
  walk(parser.parse(markdown) as MarkdownNode);
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    markdown = markdown.slice(0, replacement.start) + replacement.value + markdown.slice(replacement.end);
  }
  return { markdown, sourceNote: [hasWorkspaceLinks ? '来源链接使用原工作区的文件路径与定位；在 Lattice 原工作区中打开，复制到其他位置后需保留源文件路径。' : '', hasCloudLinks ? '云来源链接使用稳定库与文件身份；在 Lattice 原云库连接中打开，并重新核验访问权限与版本。' : ''].filter(Boolean).join(' ') || null };
}
