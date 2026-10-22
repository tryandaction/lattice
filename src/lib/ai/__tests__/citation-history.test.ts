import { describe, expect, it } from 'vitest';
import { prepareCitationHistory } from '../citation-history';
import { buildCitationContract } from '../citation-contract';
import type { AiMessage, EvidenceRef } from '../types';

const ref: EvidenceRef = { kind: 'pdf_page', locator: 'paper.pdf#page=4', label: 'p.4', preview: 'A uniquely verifiable experimental result.', anchor: { page: 4, snippet: 'A uniquely verifiable experimental result.' } };
const token = `citation:${buildCitationContract(ref).stableId}`;

describe('citation history request projection', () => {
  it('marks stale source ids explicitly without changing stored content or guessing pages', () => {
    const messages: AiMessage[] = [{ role: 'assistant', content: 'Claim [p.8](citation:old?quote=Prior%20quoted%20words).' }];
    const result = prepareCitationHistory(messages, [ref]);
    expect(result.hasUnverifiedCitations).toBe(true);
    expect(result.messages[0].content).toContain('p.8〔历史引文未重新核验；原引用片段："Prior quoted words"〕');
    expect(result.messages[0].content).not.toContain('citation:old');
    expect(messages[0].content).toContain('citation:old');
  });
  it('preserves currently verified citations and ordinary conversation without edits', () => {
    const messages: AiMessage[] = [{ role: 'assistant', content: `Result [p.4](${token}).\n\n[Summary][summary]\n\n[summary]: #summary` }, { role: 'user', content: '[p.4](citation:old)' }];
    expect(prepareCitationHistory(messages, [ref])).toEqual({ messages, hasUnverifiedCitations: false });
  });
  it('neutralizes reference definitions as well as references, preserving code and math', () => {
    const content = '[p.8][old]\n\n[old]: citation:old\n\n`[p.8](citation:old)` $[p.8](citation:old)$';
    const projected = String(prepareCitationHistory([{ role: 'assistant', content }], []).messages[0].content);
    expect(projected).not.toContain('[old]: citation:old');
    expect(projected).toContain('`[p.8](citation:old)` $[p.8](citation:old)$');
    expect(projected).toContain('p.8〔历史引文未重新核验');
  });
  it('neutralizes raw HTML link targets while preserving surrounding text', () => {
    const content = 'Before <a href="citation:old">p.8</a> after';
    expect(prepareCitationHistory([{ role: 'assistant', content }], []).messages[0].content).toBe('Before p.8〔历史引文未重新核验〕 after');
  });
  it('bounds old quotes to 240 characters and supports content-part messages', () => {
    const quote = 'x'.repeat(700);
    const content = [{ type: 'text' as const, text: `[p.8](citation:old?quote=${quote})` }, { type: 'image' as const, data: 'unchanged' }];
    const result = prepareCitationHistory([{ role: 'assistant', content }], []);
    expect(result.messages[0].content).toEqual([{ type: 'text', text: `p.8〔历史引文未重新核验；原引用片段："${'x'.repeat(240)}"〕` }, content[1]]);
  });
  it('uses prepared offsets for WikiLinks without modifying stored prose or hidden comments', () => {
    const content = 'Before %% hidden [p.1](citation:hidden) %% [[citation:old|p.8]] after';
    const messages: AiMessage[] = [{ role: 'assistant', content }];
    const result = prepareCitationHistory(messages, []);
    expect(result.messages[0].content).toContain('Before  p.8〔历史引文未重新核验〕 after');
    expect(result.messages[0].content).not.toContain('citation:old');
    expect(messages[0].content).toBe(content);
  });
});
