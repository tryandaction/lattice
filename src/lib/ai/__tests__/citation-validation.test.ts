import { describe, expect, it } from 'vitest';
import { buildCitationContract } from '../citation-contract';
import { assertRepairedAnswerCitations, assertValidAnswerCitations, normalizeVerifiedCitationDestinations, validateAnswerCitations } from '../citation-validation';
import type { EvidenceRef } from '../types';

const ref: EvidenceRef = { kind: 'pdf_page', locator: 'paper.pdf#page=4', label: 'p.4', preview: 'A tradeoff exists between fidelity and success probability.', anchor: { page: 4 } };
const token = `citation:${buildCitationContract(ref).stableId}?quote=${encodeURIComponent(ref.preview!)}`;

describe('answer citation validation', () => {
  it('repairs a provider path-shaped citation only when exact path, page and quote bind to supplied evidence', () => {
    const supplied = { ...ref, locator: 'essay/Synthetic BB1 2026.pdf#page=4' };
    const malformed = `[p.4](citation:essay/Synthetic BB1 2026.pdf#page=4?quote=${encodeURIComponent(ref.preview!)})`;
    const repaired = normalizeVerifiedCitationDestinations(malformed, [supplied]);
    expect(repaired).toContain(`citation:${buildCitationContract(supplied).stableId}?quote=`);
    expect(validateAnswerCitations(repaired, [supplied])).toEqual({ validCount: 1, issues: [] });
    const partial = malformed.replace(encodeURIComponent(ref.preview!), encodeURIComponent('fidelity and success probability.'));
    expect(validateAnswerCitations(normalizeVerifiedCitationDestinations(partial, [supplied]), [supplied])).toEqual({ validCount: 1, issues: [] });
    expect(normalizeVerifiedCitationDestinations(malformed.replace('page=4', 'page=8'), [supplied])).toBe(malformed.replace('page=4', 'page=8'));
    expect(normalizeVerifiedCitationDestinations(malformed.replace('essay/', 'other/'), [supplied])).toBe(malformed.replace('essay/', 'other/'));
    const invented = malformed.replace(encodeURIComponent(ref.preview!), 'Invented%20quote');
    expect(normalizeVerifiedCitationDestinations(invented, [supplied])).toBe(invented);
    expect(normalizeVerifiedCitationDestinations('`' + malformed + '`', [supplied])).toBe('`' + malformed + '`');
  });
  it('accepts a uniquely verified exact passage', () => {
    expect(validateAnswerCitations(`A tradeoff exists. [p.4](${token})`, [ref])).toEqual({ validCount: 1, issues: [] });
  });
  it('rejects a correct quote labelled with the wrong page', () => {
    expect(validateAnswerCitations(`[p.8](${token})`, [ref]).issues[0].reason).toBe('page_label_mismatch');
  });
  it('rejects a quote from another page even when that page is supplied', () => {
    const other: EvidenceRef = { ...ref, locator: 'paper.pdf#page=8', preview: 'The logical performance improves after error correction.', anchor: { page: 8 } };
    const wrong = `citation:${buildCitationContract(other).stableId}?quote=${encodeURIComponent(ref.preview!)}`;
    expect(validateAnswerCitations(`[p.8](${wrong})`, [ref, other]).issues).toHaveLength(1);
  });
  it('rejects invented source tokens and page-only links', () => {
    expect(validateAnswerCitations('[p.3](citation:invented) [p.4](paper.pdf#page=4)', [ref]).issues).toHaveLength(2);
  });
  it('validates reference-style links while ignoring unused definitions', () => {
    expect(validateAnswerCitations(`[p.4][evidence]\n\n[evidence]: ${token}\n[unused]: citation:invented`, [ref])).toEqual({ validCount: 1, issues: [] });
  });
  it('ignores code, images, ordinary web links and internal answer anchors', () => {
    const answer = '`[p.3](citation:invented)`\n\n```md\n[p.3](citation:invented)\n```\n![picture](image.pdf) [web](https://example.org/paper.pdf) [Summary](#summary)';
    expect(validateAnswerCitations(answer, [])).toEqual({ validCount: 0, issues: [] });
  });
  it('provides an actionable failure without changing answer content', () => {
    expect(() => assertValidAnswerCitations('[p.3](citation:invented)', [])).toThrow('引文校验未通过');
  });
  it('keeps unresolved protocol tokens and encoded quote text out of user-facing validation errors', () => {
    const answer = '[p.3](citation:invented?quote=%E7%BC%96%E9%80%A0)';
    expect(() => assertValidAnswerCitations(answer, [])).toThrow('引文校验未通过');
    try { assertValidAnswerCitations(answer, []); } catch (error) {
      expect((error as Error).message).not.toMatch(/citation:|%E7|invented/);
      expect((error as Error).message).toContain('原文');
    }
    expect(answer).toContain('citation:invented');
  });
  it('checks raw HTML anchors including entity-encoded hrefs', () => {
    expect(validateAnswerCitations('<a href="citation&#58;invented">p.3</a>', []).issues).toHaveLength(1);
    expect(validateAnswerCitations(`<a href="${token}">p.4</a>`, [ref]).validCount).toBe(1);
  });
  it('checks GFM table citations but ignores links inside inline and display math', () => {
    const answer = '| Claim | Evidence |\n| --- | --- |\n| test | [p.3](citation:invented) |\n\n$[p.3](citation:invented)$\n\n$$\n[p.3](citation:invented)\n$$';
    expect(validateAnswerCitations(answer, []).issues).toHaveLength(1);
  });
  it('matches WikiLink and hidden Obsidian comment rendering', () => {
    expect(validateAnswerCitations('[[citation:invented|p.3]]', []).issues).toHaveLength(1);
    expect(validateAnswerCitations('%% [p.3](citation:invented) %%\nVisible prose.', []).issues).toHaveLength(0);
    expect(validateAnswerCitations(`[[${token}|p.4]]`, [ref]).validCount).toBe(1);
  });
  it('rejects a repair that only removes the invalid citation with unchanged claims', () => {
    expect(() => assertRepairedAnswerCitations('Experimental value is 58 G [p.3](citation:invented).', 'Experimental value is 58 G.', [ref])).toThrow('仅删除');
  });
  it('cannot use an unrelated retained valid citation to bypass removal-only repair', () => {
    const valid = `Other result [p.4](${token}).`;
    expect(() => assertRepairedAnswerCitations(`58 G [p.3](citation:invented). ${valid}`, `58 G. ${valid}`, [ref])).toThrow('仅删除');
  });
  it('allows corrected evidence or an explicit evidence-gap answer without requiring all answers to cite', () => {
    expect(() => assertRepairedAnswerCitations('A tradeoff exists [p.3](citation:invented).', `A tradeoff exists [p.4](${token}).`, [ref])).not.toThrow();
    expect(() => assertRepairedAnswerCitations('58 G [p.3](citation:invented).', '现有原文不足以核实58 G，需要相应实验参数段落。', [ref])).not.toThrow();
    expect(() => assertRepairedAnswerCitations('Hello.', 'Hello.', [])).not.toThrow();
  });
});
