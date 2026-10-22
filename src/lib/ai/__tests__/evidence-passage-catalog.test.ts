import { describe, expect, it, vi } from 'vitest';
import { runDocumentResearch } from '../document-research';
import type { AgentDocumentSource } from '../document-source';
import type { AiMessage } from '../types';
import { estimateTokens } from '../token-estimator';

interface PromptUnit { id: string; path: string; unit: number; from: number; to: number; passages: Array<{ passageId?: string; text: string }> }
function units(messages: AiMessage[]): PromptUnit[] { return JSON.parse(String(messages.at(-1)!.content)).units; }
function source(path: string, pages: string[], version = 'v1', validationText?: string): AgentDocumentSource {
  return { path, kind: path.endsWith('.pdf') ? 'pdf' : 'markdown', unitLabel: path.endsWith('.pdf') ? 'page' : 'section', version, totalUnits: pages.length,
    readUnit: async unit => ({ status: 'text', text: pages[unit - 1], validationText }), close: async () => {} };
}
function answer(findings: unknown[]) { return { text: JSON.stringify({ summary: 'A supported research observation.', findings }) }; }
function select(unit: PromptUnit, index = 0) { return { sourceId: unit.id, passageId: unit.passages?.filter(item => item.passageId)[index]?.passageId ?? 'missing-catalog', reason: 'Direct evidence for the requested result.' }; }

describe('deterministic document evidence passages', () => {
  it('hydrates exact mathematical and hyphenated PDF text from a selected passage ID', async () => {
    const text = 'Equation (17): Ωₙ = ⟨ψ|Ĥ|ψ⟩ − ε²; ﬁdelity > 0.99. Multi-\nphoton devi- ations remain measurable [3–7].';
    const result = await runDocumentResearch({ sources: [{ source: source('paper.pdf', [text]) }], task: 'read', query: 'equation', generate: async messages => answer([select(units(messages)[0])]) });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].quote).toBe(text);
    expect(result.findings[0].evidenceRef.anchor?.snippet).toBe(text);
    expect(result.complete).toBe(true);
  });

  it('does not advertise repeated passages when the whole validation document is ambiguous', async () => {
    const repeated = 'The same sentence appears in both sections.';
    let available: PromptUnit[] = [];
    await runDocumentResearch({ sources: [{ source: source('notes.md', [repeated], 'v1', repeated + '\n\n' + repeated) }], task: 'read', query: 'read', generate: async messages => { available = units(messages); return answer([]); } });
    expect(available[0].passages).toBeDefined();
    expect(available[0].passages.filter(item => item.passageId)).toEqual([]);
    expect(available[0].passages.map(item => item.text).join('')).toBe(repeated);
  });

  it('rejects a real passage ID paired with another source even when the supplied quote looks valid', async () => {
    await expect(runDocumentResearch({ sources: [{ source: source('a.pdf', ['A distinct result about pulse shaping.']) }, { source: source('b.pdf', ['B distinct result about field stability.']) }], task: 'read', query: 'compare', generate: async messages => {
      const batch = units(messages);
      return answer([{ ...select(batch[0]), sourceId: batch[1].id, quote: 'B distinct result about field stability.' }]);
    } })).rejects.toThrow(/validation failed/i);
  });

  it('binds IDs to source version and original passage position', async () => {
    const captured: string[][] = [];
    for (const [path, version, prefix] of [['a.pdf', 'v1', ''], ['a.pdf', 'v2', ''], ['b.pdf', 'v1', ''], ['a.pdf', 'v1', 'New introduction. ']]) {
      await runDocumentResearch({ sources: [{ source: source(path, [prefix + 'Unique original conclusion about coherent pulses.'], version) }], task: 'read', query: 'read', generate: async messages => { captured.push(units(messages).flatMap(unit => unit.passages?.flatMap(item => item.passageId ? [item.passageId] : []) ?? [])); return answer([]); } });
    }
    expect(captured.every(ids => ids.length > 0)).toBe(true);
    expect(new Set(captured.map(ids => ids[0])).size).toBe(4);
  });

  it('rejects a stale passage even if the source path and supplied quote are unchanged', async () => {
    let oldId: string | undefined;
    const text = 'A distinct verified conclusion about spin readout.';
    await runDocumentResearch({ sources: [{ source: source('paper.pdf', [text], 'v1') }], task: 'read', query: 'read', generate: async messages => { oldId = select(units(messages)[0]).passageId; return answer([]); } });
    await expect(runDocumentResearch({ sources: [{ source: source('paper.pdf', [text], 'v2') }], task: 'read', query: 'read', generate: async messages => answer([{ ...select(units(messages)[0]), passageId: oldId, quote: text }]) })).rejects.toThrow(/validation failed/i);
  });

  it('hydrates multiple selected passages on the same page and accepts the quoteId alias', async () => {
    const text = Array.from({ length: 20 }, (_, i) => `Result ${i} gives a different coherent pulse value Ω = ${i}. `).join('');
    let selected: string[] = [];
    const result = await runDocumentResearch({ sources: [{ source: source('paper.pdf', [text]) }], task: 'read', query: 'read', generate: async messages => {
      const unit = units(messages)[0];
      const passages = unit.passages.filter(passage => passage.passageId);
      selected = [passages[0].text.trim(), passages[1].text.trim()];
      return answer([{ sourceId: unit.id, quoteId: passages[0].passageId, reason: 'First result.' }, { sourceId: unit.id, passageId: passages[1].passageId, reason: 'Second result.' }]);
    } });
    expect(result.findings.map(finding => finding.quote)).toEqual(selected);
    expect(new Set(result.findings.map(finding => finding.sourceId)).size).toBe(2);
    expect(result.findings.every(finding => finding.unit === 1 && finding.citation?.page === 1)).toBe(true);
  });

  it('uses whole-document validation without sending unauthorized units into the batch prompt', async () => {
    const current = 'The authorized section contains a unique measured outcome.';
    const outside = 'Unrequested distant section: do not send this text in the batch.';
    const result = await runDocumentResearch({ sources: [{ source: source('notes.md', [current], 'v1', current + '\n\n' + outside) }], task: 'read', query: 'read', generate: async messages => {
      expect(messages.map(message => message.content).join('')).not.toContain(outside);
      return answer([select(units(messages)[0])]);
    } });
    expect(result.findings[0].quote).toBe(current);
  });

  it('sends text only once and counts catalogue overhead for multiple fragments of one page', async () => {
    const text = Array.from({ length: 100 }, (_, i) => `Experiment ${i} measures a distinct value Ω = ${i} with controlled coherent pulses. `).join('');
    const seen: PromptUnit[] = [];
    const generate = vi.fn(async (messages: AiMessage[]) => {
      expect(estimateTokens(messages.map(message => message.content).join('\n'))).toBeLessThanOrEqual(1500);
      const batch = units(messages); seen.push(...batch);
      return answer(batch.flatMap(unit => unit.passages?.some(item => item.passageId) ? [select(unit)] : []));
    });
    const result = await runDocumentResearch({ sources: [{ source: source('long.pdf', [text]) }], task: 'read', query: 'read', generate, maxInputTokens: 1500 });
    expect(result.complete).toBe(true);
    expect(result.findings.length).toBeGreaterThan(1);
    expect(seen.length).toBeGreaterThan(1);
    for (const unit of seen) {
      expect(unit).not.toHaveProperty('text');
      expect(unit.passages.map(item => item.text).join('')).toBe(text.slice(Math.max(0, unit.from - 160), unit.to));
    }
  });

  it('does not consume the start of a unique passage when the remaining batch budget cannot fit its ID range', async () => {
    const pages = Array.from({ length: 40 }, (_, index) => `第${index + 1}页的唯一实验结果：${'测量误差经过独立校准后保持稳定。'.repeat(23)}`);
    const result = await runDocumentResearch({ sources: [{ source: source('中文论文.pdf', pages) }], task: '阅读全文', query: '阅读全文', maxInputTokens: 3600, generate: async messages => answer(units(messages).flatMap(unit => {
      const passage = unit.passages.find(item => item.passageId && item.text.includes('唯一实验结果'));
      return passage ? [{ sourceId: unit.id, passageId: passage.passageId, reason: '本页唯一结果。' }] : [];
    })) });
    expect(result.coverage[0].readUnits).toHaveLength(40);
    expect(result.findings).toHaveLength(40);
    expect(new Set(result.findings.map(finding => finding.unit)).size).toBe(40);
  });

  it('retains good evidence after one repair, records gaps, and continues later pages', async () => {
    const generate = vi.fn(async (messages: AiMessage[]) => answer([{ ...select(units(messages)[0]) }, { sourceId: 'invented', quote: 'No source contains this.', reason: 'Unsupported.' }]));
    const result = await runDocumentResearch({ sources: [{ source: source('paper.pdf', ['A unique supported observation about coherent dynamics.']) }], task: 'read', query: 'read', generate });
    expect(result.findings).toHaveLength(1);
    expect(result.checkpoint.completedBatches).toBe(1);
    expect(result.coverage[0].readUnits).toEqual([1]);
    expect(result.evidenceComplete).toBe(false);
    expect(result.evidenceIssues).toHaveLength(1);
    expect(result.context.prompt).toMatch(/evidence gaps/i);
    expect(result.context.prompt).not.toContain('No source contains this.');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('does not erase all-invalid evidence by returning an empty repair', async () => {
    let call = 0;
    await expect(runDocumentResearch({ sources: [{ source: source('paper.pdf', ['A real unique result.']) }], task: 'read', query: 'read',
      generate: async () => ++call === 1 ? answer([{ sourceId: 'invented', quote: 'Fabricated evidence.', reason: 'Unsupported.' }]) : answer([]),
    })).rejects.toThrow(/validation failed/i);
  });

  it('keeps a rejected finding as a disclosed gap when repair merely repeats the already valid finding', async () => {
    let call = 0;
    const result = await runDocumentResearch({ sources: [{ source: source('paper.pdf', ['A real unique result.']) }], task: 'read', query: 'read', generate: async messages => {
      const valid = select(units(messages)[0]);
      return answer(++call === 1 ? [valid, { sourceId: 'invented', quote: 'Fabricated evidence.', reason: 'Unsupported.' }] : [valid]);
    } });
    expect(result.findings).toHaveLength(1);
    expect(result.evidenceComplete).toBe(false);
    expect(result.evidenceIssues).toHaveLength(1);
  });

  it('preserves evidence gaps across cancellation-free checkpoint resume and reads through page 22', async () => {
    const pages = Array.from({ length: 22 }, (_, index) => `Page ${index + 1} gives a distinct measured Ω value of ${index + 1}. ` + 'Supporting discussion. '.repeat(30));
    const generate = async (messages: AiMessage[]) => answer([...units(messages).slice(0, 3).map(unit => select(unit)), { sourceId: 'invented', quote: 'Fabricated evidence.', reason: 'Unsupported.' }]);
    const first = await runDocumentResearch({ sources: [{ source: source('paper.pdf', pages) }], task: 'read', query: 'read', generate, maxCalls: 1, maxInputTokens: 1500 });
    expect(first.resumable).toBe(true);
    expect(first.findings.length).toBeGreaterThan(0);
    expect(first.evidenceIssues.length).toBeGreaterThan(0);
    const resumed = await runDocumentResearch({ sources: [{ source: source('paper.pdf', pages) }], task: 'read', query: 'read', generate, checkpoint: first.checkpoint, maxInputTokens: 1500 });
    expect(resumed.coverage[0].readUnits).toHaveLength(22);
    expect(resumed.findings.some(finding => finding.unit === 22)).toBe(true);
    expect(resumed.evidenceComplete).toBe(false);
    expect(resumed.checkpoint.evidenceIssues?.slice(0, first.evidenceIssues.length)).toEqual(first.evidenceIssues);
  });
});
