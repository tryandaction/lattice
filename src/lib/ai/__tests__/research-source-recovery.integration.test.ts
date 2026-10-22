// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import { useAgentMemoryStore } from '@/stores/agent-memory-store';
import { SourceTestDirectory, SourceTestFile } from './fixtures/source-workspace';
import { createAuthorizedSourceIndex } from '../source-index';
import { createLatticeSourcePdfToolRuntime } from '../lattice-skills/source-pdf-tool-runtime';
import { runResearchAgent } from '../research-agent';
import { runResearchAgentReadToolLoop } from '../research-agent-tool-loop';
import { createAgentToolSession } from '../agent-tool-broker';
import type { AgentSourceSelection } from '../source-index';

// Keep real PDF parsing and the real source runtime. Node uses PDF.js' supported
// legacy entry point; the browser-only worker constructor is the sole adapter.
vi.mock('@/lib/pdf-js-document-loader', () => ({
  loadPdfJsDocument: async ({ data }: { data: ArrayBuffer }) => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise;
  },
}));

const sourcePath = 'essay/forty-page-study.pdf';

async function makeSyntheticPaper(longPages = false) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= 40; page++) {
    const targetPage = longPages ? 39 : 23;
    const text = (longPages ? 'Bounded background text for extraction without the requested concept. '.repeat(100) : '') + (page === targetPage
      ? 'QubitKey_SOURCE_SENTINEL: the logical transition couples two metastable states at 73 MHz.'
      : page === 20 ? 'METHODS_EVIDENCE: robustness is achieved by phase-cycling.'
      : 'Page ' + page + ': unrelated synthetic background with no requested concept.');
    const sheet = pdf.addPage();
    text.match(/.{1,95}/g)!.forEach((line, index) => sheet.drawText(line, { x: 28, y: 760 - index * 8, size: 7, font }));
  }
  return await pdf.save();
}

async function sourceFixture(selections: AgentSourceSelection[] = [{ kind: 'file', path: sourcePath }], longPages = false) {
  const root = new SourceTestDirectory('workspace');
  const paper = root.add(new SourceTestDirectory('essay')).add(new SourceTestFile(sourcePath.split('/').at(-1)!, ''));
  const unrelated = root.add(new SourceTestFile('unrelated.txt', 'QubitKey_UNRELATED_FILE_MUST_STAY_UNREAD'));
  const bytes = await makeSyntheticPaper(longPages);
  paper.getFile = async () => new File([new Uint8Array(bytes).buffer], paper.name, { type: 'application/pdf', lastModified: 1 });
  const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'synthetic-reading', selections });
  const actualRuntime = createLatticeSourcePdfToolRuntime({ index, root: root.handle(), workspaceKey: 'synthetic-reading' });
  const calls: Array<{ name: string; args: unknown }> = [];
  const runtime = { async execute(name: string, args: unknown, signal?: AbortSignal) {
    calls.push({ name, args });
    return actualRuntime.execute(name, args, signal);
  } };
  return { index, calls, runtime, unrelated };
}

beforeEach(() => {
  useAgentSessionStore.setState({ sessions: [], activeSessionId: null });
  useAgentMemoryStore.setState({ entries: [], loaded: true, persistenceError: null });
});

describe('single-source targeted reading recovery', () => {
  it('uses one real tool call to search for the question before the default two-page read', async () => {
    const { index, calls, runtime, unrelated } = await sourceFixture();
    try {
      const result = await runResearchAgent({
        task: 'Explain QubitKey in the selected paper.',
        query: 'What is QubitKey in this paper?',
        sourceIntentQuery: 'What is QubitKey in this paper?',
        workspaceKey: 'synthetic-reading',
        filePath: sourcePath,
        sourceSelections: [{ kind: 'file', path: sourcePath }],
        latticeSourcePdfRuntime: runtime,
        planSteps: [
          { id: 'context-pack', title: 'Context', description: 'Context' },
          { id: 'read-intro', title: 'Read initial pages', description: 'Only initial pages were planned.', toolName: 'lattice.sources.read',
            toolArgs: { path: sourcePath, maxUnits: 2, maxChars: 4000 } },
          { id: 'evidence-resolve', title: 'Evidence', description: 'Resolve evidence' },
          { id: 'synthesize-answer', title: 'Answer', description: 'Answer the question' },
        ],
        maxObservationReplans: 0,
        maxReadToolSteps: 1,
        compact: false,
        suggestMemory: false,
        requireAnswer: true,
        generateAnswer: async messages => {
          const prompt = messages.map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
          expect(prompt).toContain('QubitKey_SOURCE_SENTINEL');
          return { text: 'The synthetic paper identifies QubitKey on page 23.' };
        },
      });
      expect(calls.map(call => call.name)).toEqual(['lattice.sources.search']);
      expect(calls[0].args).toMatchObject({ query: 'QubitKey', paths: [sourcePath], maxFiles: 1 });
      expect(result.promptContext.evidenceRefs.some(reference => reference.locator.endsWith('#page=23'))).toBe(true);
      expect(result.answer).toContain('page 23');
      expect(result.documentReading).toBeUndefined();
      expect(unrelated.reads).toBe(0);
    } finally { index.invalidate(); }
  });

  it.each([
    { query: 'What is QubitKey on page 2?', args: { path: sourcePath, units: [2], maxUnits: 1, maxChars: 4000 } },
    { query: 'What is QubitKey in this paper?', args: { path: sourcePath, units: [1, 2], maxUnits: 2, maxChars: 4000 } },
  ])('preserves actual explicit-page tool arguments: $query', async ({ query, args }) => {
    const { index, calls, runtime, unrelated } = await sourceFixture();
    try {
      const sessionId = createAgentToolSession({ profile: 'research', task: query });
      const result = await runResearchAgentReadToolLoop({ sessionId, query, sourceIntentQuery: query, filePath: sourcePath,
        sourceSelections: [{ kind: 'file', path: sourcePath }], latticeSourcePdfRuntime: runtime,
        planSteps: [{ id: 'explicit-pages', title: 'Read requested pages', description: 'Keep explicit pages', status: 'pending', toolName: 'lattice.sources.read', toolArgs: args }],
        now: 100, maxReadToolSteps: 1 });
      expect(calls).toEqual([{ name: 'lattice.sources.read', args }]);
      expect(result.toolResults[0].status).toBe('completed');
      expect(JSON.stringify(result.toolResults[0].result)).not.toContain('QubitKey_SOURCE_SENTINEL');
      expect(unrelated.reads).toBe(0);
    } finally { index.invalidate(); }
  });

  it.each(['只根据第十七页解释QubitKey', 'Explain QubitKey #page=17'])('recovers the exact originally requested page through the real source tools: %s', async query => {
    const { index, calls, runtime } = await sourceFixture();
    try {
      await runResearchAgent({ task: query, query, sourceIntentQuery: query, filePath: sourcePath,
        sourceSelections: [{ kind: 'file', path: sourcePath }], latticeSourcePdfRuntime: runtime, workspaceKey: 'synthetic-reading',
        planSteps: ['context-pack', 'evidence-resolve', 'synthesize-answer'].map(id => ({ id, title: id, description: id })),
        maxObservationReplans: 0, maxReadToolSteps: 1, compact: false, suggestMemory: false, requireAnswer: true,
        generateAnswer: async messages => {
          const prompt = messages.map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
          expect(prompt).toContain('Page 17: unrelated synthetic background');
          expect(prompt).not.toContain('QubitKey_SOURCE_SENTINEL');
          return { text: '仅第17页尚不足以解释该词，未据此推断其他页。' };
        } });
      expect(calls).toEqual([{ name: 'lattice.sources.read', args: { path: sourcePath, units: [17], maxUnits: 1, maxChars: 6000 } }]);
    } finally { index.invalidate(); }
  });

  it('targets only the priority paper even when the index permits the whole workspace', async () => {
    const { index, calls, runtime, unrelated } = await sourceFixture([{ kind: 'folder', path: '.' }]);
    try {
      const sessionId = createAgentToolSession({ profile: 'research', task: 'What is QubitKey?' });
      const result = await runResearchAgentReadToolLoop({ sessionId, query: 'What is QubitKey?', filePath: sourcePath,
        sourceSelections: [{ kind: 'file', path: sourcePath }], latticeSourcePdfRuntime: runtime,
        planSteps: [{ id: 'orientation', title: 'Read', description: 'Read initial pages', status: 'pending', toolName: 'lattice.sources.read', toolArgs: { path: sourcePath, maxUnits: 2 } }],
        now: 100, maxReadToolSteps: 1 });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ name: 'lattice.sources.search', args: { paths: [sourcePath] } });
      expect(JSON.stringify(result.toolResults[0].result)).toContain('QubitKey_SOURCE_SENTINEL');
      expect(JSON.stringify(result.toolResults[0].result)).not.toContain('QubitKey_UNRELATED_FILE');
      expect(unrelated.reads).toBe(0);
    } finally { index.invalidate(); }
  });

  it.each([{ maxReadToolSteps: 0 }, { requireSourceRead: false }])('does not force automatic tools after supplied text or with no budget: %j', async options => {
    const execute = vi.fn();
    const sessionId = createAgentToolSession({ profile: 'research', task: 'What is QubitKey?' });
    const result = await runResearchAgentReadToolLoop({ sessionId, query: 'What is QubitKey?', filePath: sourcePath,
      sourceSelections: [{ kind: 'file', path: sourcePath }], latticeSourcePdfRuntime: { execute },
      planSteps: [{ id: 'synthesize-answer', title: 'Answer', description: 'Answer from supplied content', status: 'pending' }], now: 100, ...options });
    expect(execute).not.toHaveBeenCalled();
    expect(result.toolResults).toEqual([]);
  });

  it('uses distinct bounded continuation cursors to reach page 39 within three calls', async () => {
    const { index, calls, runtime, unrelated } = await sourceFixture(undefined, true);
    try {
      const result = await runResearchAgent({ task: 'Explain QubitKey', query: 'What is QubitKey in this paper?', filePath: sourcePath,
        workspaceKey: 'synthetic-reading', sourceSelections: [{ kind: 'file', path: sourcePath }], latticeSourcePdfRuntime: runtime,
        planSteps: [
          { id: 'context-pack', title: 'Context', description: 'Context' },
          { id: 'intro', title: 'Read', description: 'Initial preview', toolName: 'lattice.sources.read', toolArgs: { path: sourcePath, maxUnits: 2 } },
          { id: 'evidence-resolve', title: 'Evidence', description: 'Evidence' },
          { id: 'synthesize-answer', title: 'Answer', description: 'Answer' },
        ], maxObservationReplans: 0, maxReadToolSteps: 3, compact: false, suggestMemory: false, requireAnswer: true,
        generateAnswer: async messages => {
          const prompt = messages.map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
          expect(prompt).toContain('QubitKey_SOURCE_SENTINEL');
          expect(prompt).not.toContain('Page 2: unrelated synthetic background');
          return { text: 'QubitKey is supported by the actual page 39 excerpt.' };
        } });
      expect(calls.map(call => call.name)).toEqual(['lattice.sources.search', 'lattice.sources.search', 'lattice.sources.search']);
      const args = calls.map(call => call.args as Record<string, unknown>);
      expect(args[0].cursor).toBeUndefined();
      expect(args[1].cursor).toEqual(expect.any(Number));
      expect(args[2].cursor).toEqual(expect.any(Number));
      expect(args[1].cursor).not.toBe(args[2].cursor);
      expect(args.every(item => JSON.stringify(item.paths) === JSON.stringify([sourcePath]) && item.query === 'QubitKey')).toBe(true);
      expect(result.promptContext.evidenceRefs.some(reference => reference.locator.endsWith('#page=39'))).toBe(true);
      expect(unrelated.reads).toBe(0);
    } finally { index.invalidate(); }
  }, 30000);

  it.each([false, true])('recovers bounded distributed English evidence after literal Chinese zero hits, complete claim=%s', async completeClaim => {
    const { index, calls, runtime } = await sourceFixture();
    try {
      let prompt = '';
      const execution = runResearchAgent({ task: '解释鲁棒性如何实现', query: '鲁棒性如何实现', filePath: sourcePath,
        workspaceKey: 'synthetic-reading', sourceSelections: [{ kind: 'file', path: sourcePath }], latticeSourcePdfRuntime: runtime,
        planSteps: [
          { id: 'context-pack', title: 'Context', description: 'Context' },
          { id: 'intro', title: 'Read', description: 'Preview', toolName: 'lattice.sources.read', toolArgs: { path: sourcePath, maxUnits: 2 } },
          { id: 'evidence-resolve', title: 'Evidence', description: 'Evidence' },
          { id: 'synthesize-answer', title: 'Answer', description: 'Answer' },
        ], maxObservationReplans: 0, maxReadToolSteps: 3, compact: false, suggestMemory: false, requireAnswer: true,
        generateAnswer: async messages => {
          prompt = messages.map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
          expect(prompt).toContain('METHODS_EVIDENCE');
          expect(prompt).not.toContain('Page 2: unrelated synthetic background');
          return { text: completeClaim ? '我已通读全文，鲁棒性通过相位循环实现。' : '已核查的第20页说明相位循环机制；其他页面尚未逐页阅读。' };
        } });
      if (completeClaim) await expect(execution).rejects.toThrow(/阅读覆盖范围/);
      else {
        const result = await execution;
        expect(result.promptContext.evidenceRefs.some(reference => reference.locator.endsWith('#page=20'))).toBe(true);
      }
      expect(calls.map(call => call.name)).toEqual(['lattice.sources.search', 'lattice.sources.search', 'lattice.sources.read']);
      expect(calls[2].args).toMatchObject({ path: sourcePath, units: [20, 40, 1], maxUnits: 3, maxChars: 6000, expectedVersion: expect.any(String) });
    } finally { index.invalidate(); }
  });
});

