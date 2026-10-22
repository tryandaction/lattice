import { describe, expect, it } from 'vitest';
import type { AgentToolExecutionResult } from '../agent-tool-broker';
import type { AgentSourceRead } from '../source-index';
import { resolveResearchContinuation } from '../conversation-task-context';
import { boundedSourceRecoveryStep, researchConceptTerm, targetedSourceSearchPlan } from '../research-source-recovery';
import type { ResearchAgentPlanStep } from '../research-agent-planner';

const path = 'essay/paper.pdf';
const snapshot = { path, version: 'revision-A', workspaceKey: 'A', sourceId: 'source-A', kind: 'pdf' as const, totalUnits: 20, unitLabel: 'page' as const };
const history = [
  { role: 'user' as const, content: 'BB1是什么？请解释原理。' },
  { role: 'assistant' as const, content: '下一步：继续解释复合脉冲为什么补偿幅度误差。第17–20页尚未读取，需要核查。' },
];
function read(units: number[]): AgentSourceRead {
  return { snapshot, chunks: units.map(unit => ({ path, sourceId: snapshot.sourceId, version: snapshot.version, unit,
    locator: `${path}#page=${unit}`, text: 'General instrument setup only.', startOffset: 0, endOffset: 30, completeUnit: true })),
    readUnits: units, pendingUnits: Array.from({ length: 20 }, (_, index) => index + 1).filter(unit => !units.includes(unit)),
    unreadableUnits: [], complete: false, scannedChars: units.length * 30 };
}
const results = [{ status: 'completed', toolName: 'lattice.sources.search' }] as AgentToolExecutionResult[];

describe('targeted source search planning boundaries', () => {
  const orientation: ResearchAgentPlanStep = { id: 'intro', title: 'Read', description: 'Read', status: 'pending', toolName: 'lattice.sources.read',
    toolArgs: { path, maxUnits: 2, maxChars: 6000 } };
  const base = { query: 'What is BB1 in this paper?', filePath: path, selections: [{ kind: 'file' as const, path }], steps: [orientation] };

  it('replaces the orientation in place and fixes the exact target path', () => {
    const steps = targetedSourceSearchPlan(base);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ id: 'intro', status: 'pending', toolName: 'lattice.sources.search', toolArgs: { query: 'BB1', paths: [path], maxFiles: 1 } });
  });

  it.each([['本文单比特门实现方案', '单比特门'], ['鲁棒性如何实现', '鲁棒性'], ['请解释本文的鲁棒性如何实现', '鲁棒性']])('extracts a literal Chinese target: %s', (query, term) => {
    expect(researchConceptTerm(query)).toBe(term);
    expect(targetedSourceSearchPlan({ ...base, query })[0]).toMatchObject({ toolName: 'lattice.sources.search', toolArgs: { query: term, paths: [path] } });
  });

  it.each([{ units: [2] }, { offsets: { '2': 500 } }, { expectedVersion: 'revision-A' }])('preserves explicit planned constraints %j', args => {
    const explicit = { ...orientation, toolArgs: { ...orientation.toolArgs, ...args } };
    expect(targetedSourceSearchPlan({ ...base, steps: [explicit] })).toEqual([explicit]);
  });

  it('preserves an explicit active-source unit bound', () => {
    const active = { ...orientation, toolName: 'lattice.sources.active' as const, toolArgs: { units: [17], maxUnits: 1 } };
    expect(targetedSourceSearchPlan({ ...base, steps: [active] })).toEqual([active]);
  });

  it.each(['What is BB1 on page 2?', '只根据第2页解释BB1', 'Explain BB1 in this selection', '阅读全文解释BB1', 'Summarize this paper'])('keeps a restricted or overview task unchanged: %s', query => {
    expect(targetedSourceSearchPlan({ ...base, query })).toEqual([orientation]);
  });

  it('does not search extra selected files, folders, or a mismatched target', () => {
    for (const selections of [[{ kind: 'folder' as const, path: '.' }], [{ kind: 'file' as const, path: 'other.pdf' }],
      [{ kind: 'file' as const, path }, { kind: 'file' as const, path: 'other.pdf' }]]) {
      expect(targetedSourceSearchPlan({ ...base, selections })).toEqual([orientation]);
    }
  });
});

describe('source recovery for an accepted conversational next step', () => {
  it('searches for missing evidence after the model has completed a small planned range in an unrestricted question', () => {
    const step = boundedSourceRecoveryStep({ query: 'What is BB1?', filePath: path, selections: [{ kind: 'file', path }], reads: [read([1, 2])],
      results: [{ status: 'completed', toolName: 'lattice.sources.read' }] as AgentToolExecutionResult[], requireRead: true,
      steps: [{ id: 'read-first', title: 'Read', description: 'Orientation chosen by planner', status: 'completed', toolName: 'lattice.sources.read', toolArgs: { path, units: [1, 2] } }] });
    expect(step).toMatchObject({ toolName: 'lattice.sources.search', toolArgs: { query: 'BB1', paths: [path], maxFiles: 1 } });
  });

  it('keeps the same small range when the user explicitly restricts the pages', () => {
    expect(boundedSourceRecoveryStep({ query: 'What is BB1 on pages 1-2?', sourceIntentQuery: 'What is BB1 on pages 1-2?', filePath: path,
      selections: [{ kind: 'file', path }], reads: [read([1, 2])], results: [{ status: 'completed', toolName: 'lattice.sources.read' }] as AgentToolExecutionResult[], requireRead: true,
      steps: [{ id: 'read-first', title: 'Read', description: 'Explicit pages', status: 'completed', toolName: 'lattice.sources.read', toolArgs: { path, units: [1, 2] } }] })).toBeUndefined();
  });
  it.each([
    ['只根据第十七页解释BB1', [17]], ['Explain BB1 #page=17', [17]],
    ['解释第十七到十九页BB1', [17, 18, 19]], ['Explain BB1 pages 17–19', [17, 18, 19]],
    ['只解释第17页和第19页', [17, 19]],
  ])('recovers only exact requested pages: %s', (query, units) => {
    expect(boundedSourceRecoveryStep({ query, sourceIntentQuery: query, filePath: path, selections: [{ kind: 'file', path }],
      reads: [], results: [], requireRead: true })?.toolArgs).toMatchObject({ path, units, maxUnits: units.length });
  });

  it.each(['第0页解释BB1', 'Explain BB1 #page=0', '只读第1到99999页解释BB1', '解释这段选区BB1'])('does not guess default pages for invalid or unbounded restriction: %s', query => {
    expect(boundedSourceRecoveryStep({ query, sourceIntentQuery: query, filePath: path, selections: [{ kind: 'file', path }],
      reads: [], results: [], requireRead: true })).toBeUndefined();
  });
  it('continues the same bounded search cursor without reading unrelated pending pages', () => {
    const step = boundedSourceRecoveryStep({ query: 'What is BB1?', filePath: path, selections: [{ kind: 'file', path }],
      reads: [], requireRead: true, results: [{ toolName: 'lattice.sources.search', status: 'completed', result: {
        hits: [], reads: [], complete: false, nextCursor: 37, coverage: [{ path, version: 'revision-A', scannedUnits: [1, 2], pendingUnits: [3, 4], complete: false }],
      } }] as AgentToolExecutionResult[], steps: [{ id: 'initial-search', status: 'completed', title: 'Search', description: 'Search', toolName: 'lattice.sources.search',
        toolArgs: { query: 'BB1', paths: [path], maxUnits: 2, maxFiles: 1, maxScanChars: 6000, maxChars: 1200 } }] });
    expect(step?.toolName).toBe('lattice.sources.search');
    expect(step?.toolArgs).toMatchObject({ query: 'BB1', paths: [path], cursor: 37, maxUnits: 2, maxScanChars: 6000, maxChars: 1200 });
  });

  it('never searches a different target than the one explicit file selection', () => {
    expect(boundedSourceRecoveryStep({ query: 'What is BB1?', filePath: path, selections: [{ kind: 'file', path: 'essay/other.pdf' }],
      reads: [], results: [], requireRead: true })).toBeUndefined();
  });

  it('does not restart a completed zero-hit bounded search', () => {
    expect(boundedSourceRecoveryStep({ query: 'What is BB1?', filePath: path, selections: [{ kind: 'file', path }],
      reads: [], requireRead: true, results: [{ toolName: 'lattice.sources.search', status: 'completed', result: {
        hits: [], reads: [], complete: true, coverage: [{ path, complete: true }],
      } }] as AgentToolExecutionResult[], steps: [{ id: 'search', title: 'Search', description: 'Search', toolName: 'lattice.sources.search',
        toolArgs: { query: 'BB1', paths: [path] }, status: 'completed' }] })).toBeUndefined();
  });
  it('does not treat a page mentioned in the old assistant proposal as a new user page restriction', () => {
    const next = resolveResearchContinuation('做', history)!;
    const step = boundedSourceRecoveryStep({ query: next.query, sourceIntentQuery: next.sourceIntentQuery, filePath: path, selections: [{ kind: 'file', path }],
      reads: [read([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), read([17, 18, 19, 20])], results, requireRead: true });
    expect(step?.toolName).toBe('lattice.sources.read');
    expect(step?.toolArgs).toMatchObject({ path, expectedVersion: 'revision-A', units: [11, 12, 13, 14, 15, 16], maxUnits: 6 });
  });

  it('preserves an explicit page restriction from the original user when accepting the next step', () => {
    const next = resolveResearchContinuation('做', [
      { role: 'user', content: '只根据第17页解释BB1，不读取其他页。' },
      { role: 'assistant', content: '下一步：继续解释机制。' },
    ])!;
    expect(next.sourceIntentQuery).toContain('只根据第17页');
    expect(boundedSourceRecoveryStep({ query: next.query, sourceIntentQuery: next.sourceIntentQuery, filePath: path,
      selections: [{ kind: 'file', path }], reads: [read([17])], results, requireRead: true })).toBeUndefined();
  });

  it('still respects an actual current request limited to one page', () => {
    expect(boundedSourceRecoveryStep({ query: 'BB1是什么？只解释第17页。', sourceIntentQuery: 'BB1是什么？只解释第17页。',
      filePath: path, selections: [{ kind: 'file', path }], reads: [read([17])], results, requireRead: true })).toBeUndefined();
  });

  it('never broadens an accepted folder or multi-file scope through the single-source fallback', () => {
    expect(boundedSourceRecoveryStep({ query: resolveResearchContinuation('做', history)!.query, sourceIntentQuery: '做',
      filePath: path, selections: [{ kind: 'folder', path: 'essay' }], reads: [read([1])], results, requireRead: true })).toBeUndefined();
  });
});
