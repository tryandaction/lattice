import { describe, expect, it } from 'vitest';
import { buildAnswerMarkdown } from '../answer-markdown';
import { buildCitationContract } from '../citation-contract';
import type { ChatMessage } from '@/stores/ai-chat-store';

const message = (content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: 'answer', role: 'assistant', content, timestamp: 1, ...extra });

describe('answer Markdown export', () => {
  it('preserves source Markdown headings, table, math and literal code exactly', () => {
    const markdown = '# 讲解\n\n- item\n\n| A | B |\n|---|---|\n| x | y |\n\n$$\\int f(x) dx$$\n\n```ts\nconst ref = "citation:example";\n```';
    expect(buildAnswerMarkdown(message(markdown))).toEqual({ markdown, sourceNote: null });
  });

  it('exports verified source tokens as stable workspace links, without temporary ids', () => {
    const ref = { kind: 'file' as const, label: 'nested note', locator: 'nested/a note.md#line=3', preview: 'verified passage', anchor: { lineStart: 3 } };
    const citation = buildCitationContract(ref);
    const exported = buildAnswerMarkdown(message(`[证据](citation:${citation.stableId})`, { evidenceRefs: [ref] }));
    expect(exported.markdown).toBe('[证据](nested/a%20note.md#line=3)');
    expect(exported.sourceNote).toContain('原工作区');
    expect(exported.markdown).not.toContain('citation:');
  });

  it('removes unresolved citation destinations while making uncertainty explicit', () => {
    const exported = buildAnswerMarkdown(message('Answer [证据](citation:unknown) and citation:missing.'));
    expect(exported.markdown).not.toMatch(/\]\(citation:/);
    expect(exported.markdown).toContain('来源未验证');
  });

  it('omits only the legacy execution footer tied to this session', () => {
    const exported = buildAnswerMarkdown(message('# Answer\n\n---\n\nMore math\n\n---\nAgent session: s1\nPlan: internal', { agentResult: { sessionId: 's1' } }));
    expect(exported.markdown).toBe('# Answer\n\n---\n\nMore math');
  });

  it('extracts only explicitly typed answer text from JSON content and rejects thinking-only JSON', () => {
    const exported = buildAnswerMarkdown(message(JSON.stringify({ content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: '# Public\n\n```py\nx=1\n```' }] })));
    expect(exported.markdown).toBe('# Public\n\n```py\nx=1\n```');
    expect(() => buildAnswerMarkdown(message('{"thinking":"private"}'))).toThrow('没有可复制的回答');
  });

  it('preserves an intentional JSON answer containing an ordinary content object', () => {
    const content = '{"content":{"items":[1,2],"title":"requested JSON"}}';
    expect(buildAnswerMarkdown(message(content)).markdown).toBe(content);
  });
});
