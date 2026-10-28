import { describe, expect, it } from 'vitest';
import { buildCitationContract } from '@/lib/ai/citation-contract';
import { preparePdfAnnotationProposal } from '@/lib/ai/pdf-annotation-agent';
import type { EvidenceRef } from '@/lib/ai/types';

const evidence: EvidenceRef = {
  kind: 'pdf_page', locator: 'papers/readout.pdf#page=3', label: 'Readout p.3',
  preview: 'The magnetic field is 58 G. The atoms survive repeated readout.', anchor: { page: 3 },
};
const sourceId = buildCitationContract(evidence).stableId;
const proposal = (overrides = {}) => ({ sourceId, page: 3, quote: 'The magnetic field is 58 G.', reason: '实验复现所需的磁场参数。', ...overrides });
const answer = (annotations: unknown[]) => `建议高亮实验参数。\n\n\`\`\`lattice-annotations\n${JSON.stringify({ annotations })}\n\`\`\``;

describe('evidence-verified PDF annotation proposals', () => {
  it('accepts one verified passage identifier without requiring the model to duplicate it', () => {
    const verified = { ...evidence, anchor: { page: 3, snippet: proposal().quote } };
    const id = buildCitationContract(verified).stableId;
    expect(preparePdfAnnotationProposal(answer([{ passageId: id, reason: '复现实验条件。' }]), [verified]).annotations).toHaveLength(1);
  });
  it.each(['json', 'JSON', 'lattice-annotations'])('accepts a typed annotations envelope in a %s fence without relaxing evidence checks', (label) => {
    const result = preparePdfAnnotationProposal(`正文\n\n\`\`\`${label}\n${JSON.stringify({ annotations: [proposal(), proposal({ sourceId: 'invented' })] })}\n\`\`\``, [evidence]);
    expect(result.text).toBe('正文');
    expect(result.annotations).toHaveLength(1);
    expect(result.rejectedCount).toBe(1);
  });
  it('keeps unrelated JSON examples in the narrative', () => {
    const text = '```json\n{"experiment":"example"}\n```';
    expect(preparePdfAnnotationProposal(text, [evidence]).text).toBe(text);
  });
  it('does not leak a malformed typed JSON proposal into narrative', () => {
    expect(preparePdfAnnotationProposal('```json\n{"annotations": [broken}\n```', [evidence])).toMatchObject({ text: '', rejectedCount: 1, annotations: [] });
  });
  it.each(['passageId', 'quoteId'])('hydrates a verified mathematical passage selected by %s', (field) => {
    const quote = 'Ωₙ = ⟨ψ|Ĥ|ψ⟩ − ε²; multi-\nphoton ﬁdelity reaches 0.99 [3–7].';
    const verified = { ...evidence, preview: quote, anchor: { page: 3, snippet: quote } };
    const id = buildCitationContract(verified).stableId;
    const result = preparePdfAnnotationProposal(answer([{ sourceId: id, [field]: id, reason: '保留可复现的公式与条件。' }]), [verified]);
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0]).toMatchObject({ quote, page: 3, rects: [] });
    expect(result.rejectedCount).toBe(0);
  });
  it('keeps a valid shorter quote inside a verified passage instead of selecting trailing prose', () => {
    const passage = 'The matrix is positive definite for every 0 < p < 1. This following explanation must not be selected.';
    const verified = { ...evidence, preview: passage, anchor: { page: 3, snippet: passage } };
    const id = buildCitationContract(verified).stableId;
    const result = preparePdfAnnotationProposal(answer([{ sourceId: id, passageId: id,
      quote: 'The matrix is positive definite for every 0 < p < 1.', reason: '完整矩阵结论。' }]), [verified]);
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0].quote).toBe('The matrix is positive definite for every 0 < p < 1.');
    expect(result.annotations[0].quote).not.toContain('following explanation');
    expect(result.annotations[0].source.anchor?.snippet).toBe(result.annotations[0].quote);
  });
  it('rejects a passage-id quote that is outside the verified passage window', () => {
    const passage = 'The matrix is positive definite.';
    const verified = { ...evidence, preview: passage, anchor: { page: 3, snippet: passage } };
    const id = buildCitationContract(verified).stableId;
    const result = preparePdfAnnotationProposal(answer([{ sourceId: id, passageId: id,
      quote: 'A different unverified result.', reason: '不应通过。' }]), [verified]);
    expect(result.annotations).toEqual([]);
    expect(result.rejectedCount).toBe(1);
  });
  it('rejects mismatched selection IDs instead of falling back to a supplied valid quote', () => {
    const verified = { ...evidence, anchor: { page: 3, snippet: proposal().quote } };
    const id = buildCitationContract(verified).stableId;
    const result = preparePdfAnnotationProposal(answer([{ ...proposal(), sourceId: id, passageId: 'another-passage' }]), [verified]);
    expect(result.annotations).toEqual([]);
    expect(result.rejectedCount).toBe(1);
  });
  it('does not turn an unanchored page ID into a full-page highlight', () => {
    const result = preparePdfAnnotationProposal(answer([{ sourceId, passageId: sourceId, reason: 'Read page.' }]), [evidence]);
    expect(result.annotations).toEqual([]);
    expect(result.rejectedCount).toBe(1);
  });
  it('retains only selected exact quotes and removes the machine payload from prose', () => {
    const result = preparePdfAnnotationProposal(answer([proposal()]), [evidence]);
    expect(result.text).toBe('建议高亮实验参数。');
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0]).toMatchObject({ page: 3, quote: proposal().quote, reason: proposal().reason, rects: [] });
    expect(result.annotations[0].quote).not.toBe(evidence.preview);
  });
  it.each([
    { quote: 'The magnetic field is 85 G.' }, { page: 12 }, { sourceId: 'invented' },
    { reason: '' }, { quote: 'Highlight the important measurements.' },
  ])('rejects unsupported or malformed proposals %j', (overrides) => {
    const result = preparePdfAnnotationProposal(answer([proposal(overrides)]), [evidence]);
    expect(result.annotations).toEqual([]);
    expect(result.rejectedCount).toBe(1);
  });
  it('rejects ambiguous quotes and malformed JSON without exposing the payload', () => {
    const repeated = { ...evidence, preview: `${evidence.preview} ${evidence.preview}` };
    expect(preparePdfAnnotationProposal(answer([proposal()]), [repeated]).annotations).toEqual([]);
    expect(preparePdfAnnotationProposal('```lattice-annotations\ninvalid\n```', [evidence])).toMatchObject({ text: '', rejectedCount: 1 });
  });
  it('does not propose all supplied contexts or duplicate the same quote', () => {
    expect(preparePdfAnnotationProposal('没有足够证据。', [evidence]).annotations).toEqual([]);
    expect(preparePdfAnnotationProposal(answer([proposal(), proposal()]), [evidence]).annotations).toHaveLength(1);
  });
});
