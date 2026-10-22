import { describe, expect, it, vi } from 'vitest';
import { buildDocumentSynthesisContext, runDocumentResearch, type DocumentResearchCheckpoint } from '../document-research';
import type { AgentDocumentSource } from '../document-source';
import type { AiMessage, AiGenerateResult } from '../types';
import { estimateTokens } from '../token-estimator';
import { buildCitationContract } from '../citation-contract';
import { buildCitationPromptReferences } from '../citation-prompt';

function source(path: string, pages: string[], version = 'version-1'): AgentDocumentSource {
  return { path, version, kind: path.endsWith('.pdf') ? 'pdf' : 'markdown', unitLabel: path.endsWith('.pdf') ? 'page' : 'section', totalUnits: pages.length,
    readUnit: vi.fn(async unit => ({ status: 'text' as const, text: pages[unit - 1] })), close: vi.fn(async () => {}) };
}
function reply(messages: AiMessage[]) {
  const input = JSON.parse(String(messages.at(-1)!.content)) as { units: Array<{ id: string; passages: Array<{ text: string }> }> };
  return { text: JSON.stringify({ summary: 'Source-grounded observations from this batch.', findings: input.units.flatMap(unit => {
    const quote = unit.passages.map(passage => passage.text).join('').match(/Important finding [^.]+\./)?.[0];
    return quote ? [{ sourceId: unit.id, quote, reason: 'A concrete result supporting the requested analysis.', importance: 3 }] : [];
  }) }) };
}
describe('document research loop', () => {
  it('keeps verified partial findings if the JSON repair returns an empty length response', async () => {
    const generate=vi.fn(async(messages:AiMessage[]):Promise<AiGenerateResult>=>{
      const result=JSON.parse(reply(messages).text);
      result.findings.push({sourceId:'invented-id',quote:'Unsupported invented finding.',reason:'Invalid',importance:3});
      return {text:JSON.stringify(result),model:'synthetic-model',finishReason:'stop'};
    }).mockImplementationOnce(async(messages:AiMessage[])=>{
      const result=JSON.parse(reply(messages).text);
      result.findings.push({sourceId:'invented-id',quote:'Unsupported invented finding.',reason:'Invalid',importance:3});
      return {text:JSON.stringify(result),model:'synthetic-model',finishReason:'stop'};
    }).mockImplementationOnce(async()=>({text:'',model:'synthetic-model',finishReason:'length'}));
    const result=await runDocumentResearch({sources:[{source:source('paper.pdf',['Important finding one.'])}],
      task:'read',query:'read',generate,maxOutputTokens:8192});
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].quote).toBe('Important finding one.');
    expect(result.evidenceIssues).toHaveLength(1);
    expect(result.evidenceComplete).toBe(false);
    expect(result.coverage[0].readUnits).toEqual([1]);
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('retains unread coverage and does not repeat a length-limited empty batch as JSON repair', async () => {
    const checkpoints:DocumentResearchCheckpoint[]=[];
    const generate=vi.fn(async()=>({text:'',finishReason:'length' as const}));
    await expect(runDocumentResearch({sources:[{source:source('paper.pdf',['Important finding one.'])}],
      task:'read',query:'read',generate,maxOutputTokens:8192,onCheckpoint:checkpoint=>{checkpoints.push(checkpoint);}}))
      .rejects.toThrow(/8192/);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(checkpoints.at(-1)?.coverage[0].readUnits).toEqual([]);
    expect(checkpoints.at(-1)?.coverage[0].pendingUnits).toEqual([1]);
    expect(checkpoints.at(-1)?.completedBatches).toBe(0);
  });
  it('preserves the actual Notebook cell and code line locators in synthesized verified citations', async () => {
    for (const [path, locator, kind, unitLabel] of [
      ['analysis.ipynb', 'analysis.ipynb#cell=stable-tail', 'notebook', 'cell'],
      ['scripts/run.py', 'scripts/run.py#line=101', 'text', 'lines'],
    ] as const) {
      const doc: AgentDocumentSource = { path, version: 'rev-1', kind, unitLabel, totalUnits: 1,
        readUnit: async () => ({ text: 'Important finding at the tail.', status: 'text', locator }), close: async () => {} };
      const result = await runDocumentResearch({ sources: [{ source: doc }], task: 'read', query: 'read', generate: async messages => reply(messages) });
      expect(result.findings[0].evidenceRef.locator).toContain(locator);
      expect(result.context.evidenceRefs[0].locator).toContain(locator);
      expect(result.findings[0].citation?.navigationTarget?.type).toBe(kind === 'notebook' ? 'notebook_cell' : 'code_line');
    }
  });
  it('bounds the complete synthesis input and represents the tail of all batches and page ranges', () => {
    const checkpoint = completeCheckpoint(['paper.pdf'], 40);
    const countInput = (context: ReturnType<typeof buildDocumentSynthesisContext>) => estimateTokens(
      'Application instructions. '.repeat(80) + context.prompt + buildCitationPromptReferences(context.evidenceRefs),
    );
    const context = buildDocumentSynthesisContext(checkpoint, { maxInputTokens: 7000, estimateInputTokens: countInput });
    expect(countInput(context)).toBeLessThanOrEqual(7000);
    for (let batch = 1; batch <= 40; batch++) expect(context.prompt).toContain(`Batch ${batch}:`);
    expect(context.evidenceRefs.some(ref => ref.anchor?.page === 40)).toBe(true);
    expect(context.evidenceRefs.some(ref => ref.anchor?.page === 1)).toBe(true);
    expect(context.evidenceRefs.some(ref => (ref.anchor?.page ?? 0) > 10 && (ref.anchor?.page ?? 0) < 30)).toBe(true);
    expect(context.prompt).toContain('excerpts');
    expect(context.evidenceRefs.length).toBeLessThan(checkpoint.findings.length);
    for (const ref of context.evidenceRefs) {
      const original = checkpoint.findings.find(finding => buildCitationContract(finding.evidenceRef).stableId === buildCitationContract(ref).stableId)!;
      expect(ref.anchor?.snippet).toBe(original.quote);
      expect(buildCitationContract(ref).navigationTarget).toEqual(buildCitationContract(original.evidenceRef).navigationTarget);
    }
    expect(checkpoint.findings).toHaveLength(40);
    expect(checkpoint.summaries).toHaveLength(40);
  });

  it('balances files and page ranges without discarding higher-priority evidence', () => {
    const checkpoint = completeCheckpoint(['a.pdf', 'b.pdf', 'notes.md'], 9);
    checkpoint.findings.find(item => item.sourcePath === 'a.pdf' && item.unit === 5)!.importance = 3;
    const context = buildDocumentSynthesisContext(checkpoint, { maxInputTokens: 6500 });
    const chosen = context.evidenceRefs.map(ref => buildCitationContract(ref));
    expect(new Set(chosen.map(ref => ref.canonicalPath))).toEqual(new Set(['a.pdf', 'b.pdf', 'notes.md']));
    expect(chosen.some(ref => ref.canonicalPath === 'a.pdf' && ref.page === 5)).toBe(true);
    expect(context.prompt).toContain('Batch 27:');
  });

  it('counts the supplied message envelope rather than budgeting the context string alone', () => {
    const checkpoint = completeCheckpoint(['paper.pdf'], 12);
    const overhead = '系统指令'.repeat(750);
    const estimateInputTokens = (context: ReturnType<typeof buildDocumentSynthesisContext>) => estimateTokens(overhead + context.prompt + buildCitationPromptReferences(context.evidenceRefs));
    const context = buildDocumentSynthesisContext(checkpoint, { maxInputTokens: 6500, estimateInputTokens });
    expect(estimateInputTokens(context)).toBeLessThanOrEqual(6500);
    expect(context.evidenceRefs.length).toBeGreaterThan(0);
    expect(context.prompt).toContain('Batch 12:');
  });

  it('uses the application synthesis estimator when returning a budget-paused reading result', async () => {
    const estimateSynthesisTokens = vi.fn((context: ReturnType<typeof buildDocumentSynthesisContext>) => estimateTokens(
      'Application envelope '.repeat(100) + context.prompt + buildCitationPromptReferences(context.evidenceRefs),
    ));
    const doc = source('paper.pdf', Array.from({ length: 8 }, (_, i) => `Important finding ${i + 1}. ` + 'Long supporting content. '.repeat(80)));
    const result = await runDocumentResearch({ sources: [{ source: doc }], task: 'Read all', query: 'Read all', generate: async messages => reply(messages), maxCalls: 1, maxInputTokens: 1500, maxSynthesisInputTokens: 2400, estimateSynthesisTokens });
    expect(result.resumable).toBe(true);
    expect(estimateSynthesisTokens).toHaveBeenCalled();
    expect(estimateSynthesisTokens(result.context)).toBeLessThanOrEqual(2400);
    expect(result.checkpoint.findings).toEqual(result.findings.map(({ citation: _citation, ...finding }) => finding));
  });

  it('covers all 27 pages and retains later-page evidence without claiming a truncated header as coverage', async () => {
    const doc = source('paper.pdf', Array.from({ length: 27 }, (_, i) => `Important finding ${i + 1}. ` + 'Evidence text. '.repeat(55)));
    const generate = vi.fn(async (messages: AiMessage[]) => reply(messages));
    const checkpoints: DocumentResearchCheckpoint[] = [];
    const result = await runDocumentResearch({ sources: [{ source: doc }], task: 'Read all', query: 'Read all', generate, maxInputTokens: 2400, onCheckpoint: checkpoint => { checkpoints.push(checkpoint); } });
    expect(result.complete).toBe(true);
    expect(result.coverage[0].readUnits).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
    expect(result.coverage[0].pendingUnits).toEqual([]);
    expect(result.findings.some(item => item.citation?.page === 27 && item.quote === 'Important finding 27.')).toBe(true);
    expect(checkpoints.length).toBeGreaterThan(1);
    for (const call of generate.mock.calls) expect(estimateTokens(call[0].map(message => message.content).join('\n'))).toBeLessThanOrEqual(2400);
    expect(doc.close).toHaveBeenCalledTimes(1);
  });
  it('preserves the long-page tail and completes a one-call document exactly at its budget', async () => {
    const long = source('long.pdf', ['正文。'.repeat(2600) + ' Important finding at the tail.']);
    const result = await runDocumentResearch({ sources: [{ source: long }], task: 'Read all', query: 'tail', generate: async messages => reply(messages), maxInputTokens: 1500 });
    expect(result.complete).toBe(true);
    expect(result.findings.some(item => item.quote === 'Important finding at the tail.')).toBe(true);
    const one = await runDocumentResearch({ sources: [{ source: source('one.pdf', ['Important finding one.']) }], task: 'read', query: 'read', generate: async messages => reply(messages), maxCalls: 1 });
    expect(one.complete).toBe(true);
  });
  it('resumes after the exact completed fragments, preserving citations and rejecting changed files', async () => {
    const pages = Array.from({ length: 6 }, (_, i) => `Important finding ${i}. ` + 'Long supporting data. '.repeat(70));
    const first = await runDocumentResearch({ sources: [{ source: source('p.pdf', pages) }], task: 'read', query: 'read', generate: async messages => reply(messages), maxInputTokens: 1600, maxCalls: 1 });
    expect(first.resumable).toBe(true);
    expect(first.complete).toBe(false);
    const resumed = source('p.pdf', pages);
    const next = await runDocumentResearch({ sources: [{ source: resumed }], task: 'read', query: 'read', generate: async messages => reply(messages), checkpoint: first.checkpoint, maxInputTokens: 1600 });
    for (const page of first.coverage[0].readUnits) expect(resumed.readUnit).not.toHaveBeenCalledWith(page, expect.anything());
    expect(next.coverage[0].readUnits).toHaveLength(6);
    expect(next.findings.every(item => item.citation?.navigationTarget)).toBe(true);
    await expect(runDocumentResearch({ sources: [{ source: source('p.pdf', pages, 'changed') }], task: 'read', query: 'read', generate: async messages => reply(messages), checkpoint: first.checkpoint })).rejects.toThrow(/changed|版本/i);
  });
  it('rejects duplicate coverage and corrupt offsets without generating or claiming new coverage', async () => {
    const pages = Array.from({ length: 6 }, (_, i) => `Important finding ${i}. ` + 'Long supporting data. '.repeat(90));
    const first = await runDocumentResearch({ sources: [{ source: source('p.pdf', pages) }], task: 'read', query: 'read', generate: async messages => reply(messages), maxInputTokens: 1500, maxCalls: 1 });
    const invalidCases = [
      (checkpoint: DocumentResearchCheckpoint) => { checkpoint.coverage[0].pendingUnits.push(checkpoint.coverage[0].pendingUnits[0]); },
      (checkpoint: DocumentResearchCheckpoint) => { checkpoint.coverage[0].emptyUnits.push(checkpoint.coverage[0].pendingUnits[0]); },
      (checkpoint: DocumentResearchCheckpoint) => { checkpoint.sources[0].offsets[String(checkpoint.coverage[0].pendingUnits[0])] = -1; },
      (checkpoint: DocumentResearchCheckpoint) => { checkpoint.sources[0].offsets[String(checkpoint.coverage[0].pendingUnits[0])] = pages[0].length * 10; },
      (checkpoint: DocumentResearchCheckpoint) => { checkpoint.sources[0].offsets['0'] = 10; },
    ];
    for (const mutate of invalidCases) {
      const checkpoint = structuredClone(first.checkpoint); mutate(checkpoint);
      const doc = source('p.pdf', pages);
      const generate = vi.fn(async (messages: AiMessage[]) => reply(messages));
      await expect(runDocumentResearch({ sources: [{ source: doc }], task: 'read', query: 'read', checkpoint, generate })).rejects.toThrow(/checkpoint/i);
      expect(generate).not.toHaveBeenCalled();
      expect(doc.close).toHaveBeenCalledTimes(1);
    }
  });
  it('resumes PDF and Markdown by source identity after their input order changes', async () => {
    const pdfPages = Array.from({ length: 5 }, (_, i) => `Important finding PDF ${i}. ` + 'PDF supporting data. '.repeat(55));
    const mdSections = Array.from({ length: 5 }, (_, i) => `Important finding Markdown ${i}. ` + 'Markdown supporting data. '.repeat(55));
    const first = await runDocumentResearch({ sources: [{ source: source('p.pdf', pdfPages) }, { source: source('notes.md', mdSections) }], task: 'read', query: 'read', generate: async messages => reply(messages), maxInputTokens: 1500, maxCalls: 1 });
    const pdf = source('p.pdf', pdfPages), md = source('notes.md', mdSections);
    const resumed = await runDocumentResearch({ sources: [{ source: md }, { source: pdf }], task: 'read', query: 'read', checkpoint: first.checkpoint, generate: async messages => reply(messages), maxInputTokens: 1500 });
    expect(resumed.complete).toBe(true);
    expect(resumed.coverage.map(item => item.path)).toEqual(['notes.md', 'p.pdf']);
    for (const doc of [pdf, md]) {
      const completed = first.coverage.find(item => item.path === doc.path)!.readUnits;
      for (const unit of completed) expect(doc.readUnit).not.toHaveBeenCalledWith(unit, expect.anything());
      expect(resumed.coverage.find(item => item.path === doc.path)!.readUnits).toEqual([1, 2, 3, 4, 5]);
    }
    expect(resumed.findings.some(item => item.sourcePath === 'p.pdf' && item.unit === 5 && item.citation?.page === 5)).toBe(true);
    expect(resumed.findings.some(item => item.sourcePath === 'notes.md' && item.unit === 5 && item.citation?.navigationTarget?.type === 'workspace_text')).toBe(true);
  });
  it('repairs malformed evidence once and never marks unsupported quotes consumed', async () => {
    const generate = vi.fn().mockResolvedValueOnce({ text: 'not json' }).mockImplementationOnce(async (messages: AiMessage[]) => reply(messages));
    const result = await runDocumentResearch({ sources: [{ source: source('p.pdf', ['Important finding 1.']) }], task: 'read', query: 'read', generate });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.complete).toBe(true);
    const invalid = vi.fn(async () => ({ text: JSON.stringify({ summary: 'Fake', findings: [{ sourceId: 'invented', quote: 'Invented evidence.', reason: 'none' }] }) }));
    let last: DocumentResearchCheckpoint | undefined;
    await expect(runDocumentResearch({ sources: [{ source: source('p.pdf', ['Important finding 1.']) }], task: 'read', query: 'read', generate: invalid, onCheckpoint: checkpoint => { last = checkpoint; } })).rejects.toThrow(/valid|校验/i);
    expect(last?.coverage[0].readUnits).toEqual([]);
    expect(invalid).toHaveBeenCalledTimes(2);
  });
  it('keeps cancelled progress and distinguishes unreadable pages from analyzed text', async () => {
    const controller = new AbortController(); let checkpoint: DocumentResearchCheckpoint | undefined;
    const doc = source('p.pdf', Array.from({ length: 8 }, (_, i) => `Important finding ${i}. ` + 'source '.repeat(150)));
    await expect(runDocumentResearch({ sources: [{ source: doc }], task: 'read', query: 'read', generate: async messages => reply(messages), signal: controller.signal, maxInputTokens: 1500,
      onCheckpoint: value => { checkpoint = value; if (value.coverage[0].readUnits.length) controller.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(checkpoint!.coverage[0].readUnits.length).toBeGreaterThan(0);
    expect(checkpoint!.coverage[0].pendingUnits.length).toBeGreaterThan(0);
    const empty = source('scan.pdf', ['']);
    const gaps = await runDocumentResearch({ sources: [{ source: empty }], task: 'read', query: 'read', generate: async messages => reply(messages) });
    expect(gaps.coverage[0].readUnits).toEqual([]);
    expect(gaps.complete).toBe(false);
  });
});

function completeCheckpoint(paths: string[], units: number): DocumentResearchCheckpoint {
  const sources = paths.map(path => ({ path, version: 'v1', totalUnits: units, completedUnits: Array.from({ length: units }, (_, i) => i + 1), offsets: {} }));
  const findings = paths.flatMap(path => Array.from({ length: units }, (_, index) => {
    const unit = index + 1;
    const quote = `${path} unique original result ${unit}: ` + '研究科学实验材料'.repeat(48);
    const evidenceRef = { kind: path.endsWith('.pdf') ? 'pdf_page' as const : 'file' as const, label: path, locator: `${path}#${path.endsWith('.pdf') ? `page=${unit}&` : ''}text=${encodeURIComponent(quote)}`, preview: quote, anchor: { ...(path.endsWith('.pdf') ? { page: unit } : {}), snippet: quote } };
    return { sourceId: buildCitationContract(evidenceRef).stableId, sourcePath: path, unit, quote, reason: '该证据直接涉及材料的核心结果和方法'.repeat(38), importance: 2, evidenceRef };
  }));
  return { version: 1, queryKey: '["read","read"]', sources, findings, completedBatches: paths.length * units,
    summaries: findings.map((finding, index) => `Batch insight ${index + 1}: ${finding.sourcePath} unit ${finding.unit}. ` + '重要结果与科学方法。'.repeat(75) + ` Concluding result ${index + 1}.`),
    coverage: sources.map(item => ({ path: item.path, kind: item.path.endsWith('.pdf') ? 'pdf' : 'markdown', unitLabel: item.path.endsWith('.pdf') ? 'page' : 'section', totalUnits: units, readUnits: item.completedUnits, pendingUnits: [], emptyUnits: [], unreadableUnits: [] })),
  };
}
