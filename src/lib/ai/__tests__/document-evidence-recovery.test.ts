import { expect, it, vi } from 'vitest';
import { runDocumentResearch } from '../document-research';
import type { AgentDocumentSource } from '../document-source';
import type { AiMessage } from '../types';

function source(path: string, text: string, validationText = text): AgentDocumentSource {
  return { path, version: 'synthetic-v1', kind: path.endsWith('.pdf') ? 'pdf' : 'markdown', unitLabel: path.endsWith('.pdf') ? 'page' : 'section', totalUnits: 1,
    readUnit: async () => ({ status: 'text', text, validationText }), close: async () => {} };
}
function units(messages: AiMessage[]): Array<{ id: string; path: string; passages: Array<{ passageId?: string; text: string }> }> {
  return JSON.parse(String(messages.at(-1)!.content)).units;
}
const response = (findings: unknown[]) => ({ text: JSON.stringify({ summary: 'Only source-grounded findings are retained.', findings }) });

it('accepts a PDF passage that the catalogue already verified through real line-break hyphenation', async () => {
  const text = 'The multiphoton excitation remains stable after calibration.';
  const generate = vi.fn(async (messages: AiMessage[]) => {
    const unit = units(messages)[0];
    const passage = unit.passages.find(item => item.passageId)!;
    expect(passage).toBeTruthy();
    return response([{ sourceId: unit.id, passageId: passage.passageId, reason: 'Observed source result.' }]);
  });
  const result = await runDocumentResearch({ sources: [{ source: source('paper.pdf', text, 'The multi-\nphoton excitation remains stable after calibration.') }], task: 'read', query: 'read', generate });
  expect(result.findings).toHaveLength(1);
  expect(result.evidenceIssues).toEqual([]);
  expect(result.evidenceComplete).toBe(true);
  expect(generate).toHaveBeenCalledTimes(1);
});

it('does not reinterpret line-break hyphenation in non-PDF sources', async () => {
  const generate = vi.fn(async (messages: AiMessage[]) => response([{ sourceId: units(messages)[0].id, quote: 'The multiphoton excitation remains stable after calibration.', reason: 'Requested result.' }]));
  await expect(runDocumentResearch({ sources: [{ source: source('note.md', 'The multiphoton excitation remains stable after calibration.', 'The multi-\nphoton excitation remains stable after calibration.') }], task: 'read', query: 'read', generate })).rejects.toThrow(/validation failed/i);
  expect(generate).toHaveBeenCalledTimes(2);
});

const textA = 'The existing verified result remains stable. A second verified result concerns pulse shaping. A third verified result concerns optical control.';
const textB = 'The distinct verified result concerns the other apparatus.';
function recovery(repairOtherSource: boolean) {
  let calls = 0;
  return vi.fn(async (messages: AiMessage[]) => {
    const batch = units(messages), a = batch.find(unit => unit.path === 'a.pdf')!, b = batch.find(unit => unit.path === 'b.pdf')!;
    calls += 1;
    if (calls === 1) return response([
      { sourceId: a.id, quote: 'The existing verified result remains stable.', reason: 'Already verified.' },
      { sourceId: a.id, quote: 'An invented source A result.', reason: 'Must be repaired.' },
      { sourceId: b.id, quote: 'An invented source B result.', reason: 'Must be repaired separately.' },
    ]);
    return response([
      { sourceId: a.id, quote: 'A second verified result concerns pulse shaping.', reason: 'Correct replacement for source A.' },
      repairOtherSource ? { sourceId: b.id, quote: textB, reason: 'Correct replacement for source B.' }
        : { sourceId: a.id, quote: 'A third verified result concerns optical control.', reason: 'Another result from source A cannot replace source B.' },
    ]);
  });
}

it('does not clear a rejected source B finding merely because repair selected two new findings from source A', async () => {
  const generate = recovery(false);
  const result = await runDocumentResearch({ sources: [{ source: source('a.pdf', textA) }, { source: source('b.pdf', textB) }], task: 'read both', query: 'read both', generate });
  expect(result.findings).toHaveLength(3);
  expect(result.findings.some(item => item.quote === 'The existing verified result remains stable.')).toBe(true);
  expect(result.evidenceIssues).toHaveLength(1);
  expect(result.evidenceIssues[0].sourcePath).toBe('b.pdf');
  expect(result.evidenceComplete).toBe(false);
  expect(generate).toHaveBeenCalledTimes(2);
});

it('repairs invalid findings within their actual source and keeps earlier valid findings without extra calls', async () => {
  const generate = recovery(true);
  const result = await runDocumentResearch({ sources: [{ source: source('a.pdf', textA) }, { source: source('b.pdf', textB) }], task: 'read both', query: 'read both', generate });
  expect(result.findings).toHaveLength(3);
  expect(result.findings.some(item => item.sourcePath === 'b.pdf' && item.quote === textB)).toBe(true);
  expect(result.evidenceIssues).toEqual([]);
  expect(result.evidenceComplete).toBe(true);
  expect(generate).toHaveBeenCalledTimes(2);
});

it('does not count a repeated replacement twice when two rejected findings share one page', async () => {
  let calls = 0;
  const generate = vi.fn(async (messages: AiMessage[]) => {
    const id = units(messages)[0].id;
    if (++calls === 1) return response([
      { sourceId: id, quote: 'The existing verified result remains stable.', reason: 'Keep this.' },
      { sourceId: id, quote: 'Invented first result.', reason: 'Repair one.' },
      { sourceId: id, quote: 'Invented second result.', reason: 'Repair two.' },
    ]);
    const replacement = { sourceId: id, quote: 'A second verified result concerns pulse shaping.', reason: 'Only one distinct replacement.' };
    return response([replacement, replacement]);
  });
  const result = await runDocumentResearch({ sources: [{ source: source('a.pdf', textA) }], task: 'read', query: 'read', generate });
  expect(result.findings).toHaveLength(2);
  expect(result.evidenceIssues).toHaveLength(1);
  expect(result.evidenceComplete).toBe(false);
  expect(generate).toHaveBeenCalledTimes(2);
});
