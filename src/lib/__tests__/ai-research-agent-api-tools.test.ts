import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage-adapter', () => ({ getStorageAdapter: () => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn(), clear: vi.fn() }) }));
vi.mock('@/lib/pdf-js-document-loader', () => ({ loadPdfJsDocument: async () => ({ numPages: 3, destroy: async () => {} }) }));
vi.mock('@/lib/pdf-page-text-cache', () => ({ getPdfPageSearchText: async () => 'We implement single-qubit gates with logical 0 and 1 encoded in two metastable states.' }));

import { runResearchAgent, type ResearchAgentRunInput } from '../ai/research-agent';
import { runResearchAgentReadToolLoop } from '../ai/research-agent-tool-loop';
import { normalizeResearchAgentPlan } from '../ai/research-agent-planner';
import { LATTICE_HARNESS_TOOLS } from '../ai/harness/lattice-tool-definitions';
import { createAgentToolSession, executeAgentTool } from '../ai/agent-tool-broker';
import { createLatticeHarnessToolRuntime } from '../ai/harness/lattice-source-tools';
import { createAuthorizedSourceIndex } from '../ai/source-index';
import { SourceTestDirectory, SourceTestFile } from '../ai/__tests__/fixtures/source-workspace';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import { getMessageText, type AiMessage } from '../ai/types';
import { getWorkspaceIndex } from '../ai/workspace-indexer';

const core = ['context-pack', 'evidence-resolve', 'synthesize-answer'].map(id => ({ id, title: id, description: id }));
function fixture(activePath = 'active.txt') {
  const root = new SourceTestDirectory('workspace'), folder = root.add(new SourceTestDirectory('essay'));
  folder.add(new SourceTestFile('a-paper.pdf', '%PDF fixture'));
  for (let i = 0; i < 25; i++) folder.add(new SourceTestFile(`note-${i}.txt`, 'Unselected unrelated source.'));
  const active = root.add(new SourceTestFile('active.txt', 'Wrong active pane.'));
  const sourceSelections = [{ kind: 'folder' as const, path: 'essay' }];
  const onDraft = vi.fn(() => 'review-1');
  const runtime = createLatticeHarnessToolRuntime({ kind: 'local', root: root.handle(), workspaceKey: 'A',
    index: createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: sourceSelections }),
    getActivePath: () => activePath, onDraft });
  const execute = vi.fn(runtime.execute);
  return { root, active, onDraft, execute, input: { task: 'essay 中哪些论文实现单比特门且逻辑0/1采用亚稳态编码？', query: 'essay 中哪些论文实现单比特门？',
    apiToolRuntime: { ...runtime, execute }, sourceSelections, requireSourceDiscovery: true, workspaceKey: 'A',
    suggestMemory: false, compact: false } as ResearchAgentRunInput };
}

describe('API agent shared tools and required source reading', () => {
  beforeEach(() => useAgentSessionStore.setState({ sessions: [], activeSessionId: null }));

  function singlePaper() {
    const root = new SourceTestDirectory('workspace');
    const paper = root.add(new SourceTestFile('Senoo.pdf', '%PDF fixture'));
    const unrelated = root.add(new SourceTestFile('unrelated.md', 'Unrelated active tab.'));
    const sourceSelections = [{ kind: 'file' as const, path: 'Senoo.pdf' }];
    const runtime = createLatticeHarnessToolRuntime({ kind: 'local', root: root.handle(), workspaceKey: 'A',
      index: createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'A', selections: sourceSelections }),
      getActivePath: () => 'Senoo.pdf' });
    const execute = vi.fn(runtime.execute);
    return { paper, unrelated, execute, input: { task: '单比特门如何实现？', query: '单比特门如何实现？',
      filePath: 'Senoo.pdf', apiToolRuntime: { ...runtime, execute, sourceSelections },
      workspaceKey: 'A', includeWorkspaceSummary: false, suggestMemory: false, compact: false } as ResearchAgentRunInput };
  }

  it('searches the captured PDF before asking the planner to recover zero-hit literal evidence', async () => {
    const state = singlePaper();
    const prompts: string[] = [];
    const generatePlan = vi.fn(async (messages: AiMessage[]) => {
      prompts.push(messages.map(message => getMessageText(message.content)).join('\n'));
      return { text: JSON.stringify({ steps: generatePlan.mock.calls.length === 1 ? core : [...core,
        { id: 'read-selected-page', title: 'Read the relevant page', description: 'Read bounded original evidence',
          toolName: 'lattice.sources.read', toolArgs: { path: 'Senoo.pdf', units: [1], maxChars: 4000, maxUnits: 1 } }] }) };
    });
    let synthesisPrompt = '';
    const result = await runResearchAgent({ ...state.input, generatePlan, requireAnswer: true,
      generateAnswer: async messages => {
        synthesisPrompt = messages.map(message => getMessageText(message.content)).join('\n');
        return { text: '逻辑0/1编码在两个亚稳态中。' };
      } });
    expect(prompts[0]).toContain('Current source path: Senoo.pdf');
    expect(state.execute.mock.calls.map(call => call[0])).toEqual(['lattice.sources.search', 'lattice.sources.read']);
    expect(state.execute.mock.calls[0][1]).toMatchObject({ query: '单比特门', paths: ['Senoo.pdf'], maxFiles: 1 });
    expect(state.execute.mock.calls[1][1]).toMatchObject({ path: 'Senoo.pdf', units: [1], maxUnits: 1 });
    expect(synthesisPrompt).toContain('two metastable states');
    expect(synthesisPrompt).not.toContain('research/current-note.md');
    expect(synthesisPrompt).not.toContain('Ask the user to select a page');
    expect(result.promptContext.evidenceRefs).toContainEqual(expect.objectContaining({ locator: expect.stringContaining('Senoo.pdf#page=1') }));
    expect(result.documentReading).toBeUndefined();
    expect(state.unrelated.reads).toBe(0);
  });

  it('does not complete a source-backed question when the total read budget is exhausted', async () => {
    const state = singlePaper(), generateAnswer = vi.fn(async () => ({ text: '请粘贴论文。' }));
    await expect(runResearchAgent({ ...state.input, generatePlan: async () => ({ text: JSON.stringify({ steps: core }) }),
      generateAnswer, requireAnswer: true, maxReadToolSteps: 0 })).rejects.toThrow(/未完成.*正文|正文.*未完成/);
    expect(generateAnswer).not.toHaveBeenCalled();
    expect(state.paper.reads).toBe(0);
    expect(useAgentSessionStore.getState().sessions[0].status).toBe('failed');
  });

  it('does not count a prior unrelated reference as reading the captured PDF', async () => {
    const state = singlePaper(), generateAnswer = vi.fn(async () => ({ text: 'Unrelated material.' }));
    await expect(runResearchAgent({ ...state.input,
      references: [{ path: 'unrelated.md', content: 'A previous document passage.' }],
      explicitEvidenceRefs: [{ kind: 'file', locator: 'unrelated.md', label: 'Prior document', preview: 'A previous document passage.' }],
      generatePlan: async () => ({ text: JSON.stringify({ steps: core }) }), generateAnswer, requireAnswer: true, maxReadToolSteps: 0,
    })).rejects.toThrow(/未完成.*正文|正文.*未完成/);
    expect(generateAnswer).not.toHaveBeenCalled();
  });

  it('keeps unrelated global index summaries out of a selected-source answer', async () => {
    const state = singlePaper(), index = getWorkspaceIndex();
    index.files.set('unselected.md', { path: 'unselected.md', name: 'unselected.md', extension: '.md', size: 100,
      summary: 'leaked-term UNAUTHORIZED_INDEX_CONTENT', headings: [], lastModified: 1 });
    try {
      const result = await runResearchAgent({ ...state.input, task: 'leaked-term', query: 'leaked-term',
        generatePlan: async () => ({ text: JSON.stringify({ steps: [...core,
          { id: 'read-selected-page', title: 'Read source', description: 'Read bounded evidence', toolName: 'lattice.sources.read',
            toolArgs: { path: 'Senoo.pdf', units: [1], maxUnits: 1, maxChars: 4000 } }] }) }),
      });
      expect(result.promptContext.prompt).not.toContain('UNAUTHORIZED_INDEX_CONTENT');
      expect(result.promptContext.evidenceRefs.some(ref => ref.locator === 'unselected.md')).toBe(false);
    } finally { index.files.delete('unselected.md'); }
  });

  it('uses supplied page text without forcing another read or whole-document analysis', async () => {
    const state = singlePaper();
    const result = await runResearchAgent({ ...state.input, content: '--- Page 2 ---\nVerified supplied source passage: 单比特门 uses two metastable states.',
      generatePlan: async () => ({ text: JSON.stringify({ steps: core }) }),
      generateAnswer: async () => ({ text: '结论依据已提供的第二页。' }), requireAnswer: true });
    expect(state.execute).not.toHaveBeenCalled();
    expect(result.promptContext.prompt).toContain('Verified supplied source passage: 单比特门 uses two metastable states.');
    expect(result.documentReading).toBeUndefined();
  });

  it('does not fabricate a current document when no source path was supplied', async () => {
    let prompt = '';
    const result = await runResearchAgent({ task: '你好', requireAnswer: true, suggestMemory: false, compact: false,
      generateAnswer: async messages => { prompt = messages.map(message => getMessageText(message.content)).join('\n'); return { text: '你好。' }; } });
    expect(prompt).not.toContain('Current file:');
    expect(prompt).not.toContain('research/current-note.md');
    expect(result.promptContext.evidenceRefs).toEqual([]);
  });

  it('preserves pathless supplied text without claiming that it came from a workspace file', async () => {
    const result = await runResearchAgent({ task: '解释这段文字', content: 'User supplied passage without file identity.',
      suggestMemory: false, compact: false });
    expect(result.contextPack.prompt).toContain('User supplied passage');
    expect(result.contextPack.prompt).not.toContain('research/current-note.md');
    expect(result.promptContext.prompt).toContain('User supplied passage');
    expect(result.promptContext.prompt).not.toContain('Current file:');
    expect(result.promptContext.nodes).toContainEqual(expect.objectContaining({ id: 'supplied-content' }));
    expect(result.promptContext.evidenceRefs).toEqual([]);
  });

  it('recovers an omitted read by listing only bounded metadata, replanning and citing real PDF text', async () => {
    const state = fixture();
    const generatePlan = vi.fn(async (messages: AiMessage[]) => {
      if (generatePlan.mock.calls.length === 1) return { text: JSON.stringify({ steps: core }) };
      const prompt = messages.map(message => getMessageText(message.content)).join('\n');
      expect(prompt).toContain('essay/a-paper.pdf');
      expect(prompt).toContain('nextCursor');
      expect(prompt).not.toContain('Wrong active pane.');
      return { text: JSON.stringify({ steps: [...core, { id: 'read-paper', title: 'Read the paper', description: 'Read actual PDF text',
        toolName: 'lattice.sources.read', toolArgs: { path: 'essay/a-paper.pdf', units: [1], maxChars: 4000, maxUnits: 1 } }] }) };
    });
    const generateAnswer = vi.fn(async (messages: AiMessage[]) => {
      const prompt = messages.map(message => getMessageText(message.content)).join('\n');
      expect(prompt).toContain('two metastable states');
      const token = prompt.match(/\[p\.1\]\((citation:[^)]+)\)/)?.[1];
      expect(token).toBeTruthy();
      return { text: `该论文以两个亚稳态编码逻辑0/1并实现单比特门。[p.1](${token}) 本次只读取第1页。` };
    });
    const result = await runResearchAgent({ ...state.input, generatePlan, generateAnswer, requireAnswer: true });
    expect(state.execute.mock.calls.map(call => call[0])).toEqual(['lattice.sources.list', 'lattice.sources.read']);
    expect(state.execute.mock.calls[0][1]).toMatchObject({ limit: 20 });
    expect(result.promptContext.evidenceRefs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'pdf_page', anchor: expect.objectContaining({ page: 1 }), locator: expect.stringContaining('essay/a-paper.pdf') })]));
    expect(result.toolObservations.find(item => item.toolName === 'lattice.sources.read')?.output).toContain('two metastable states');
    expect(result.session.trace.some(event => event.kind === 'tool_result' && event.tool?.toolName === 'lattice.sources.read')).toBe(true);
    expect(result.session.status).toBe('completed');
    expect(result.answer).toContain('[p.1](citation:');
    expect(state.active.reads).toBe(0);
  });

  it.each(['missing', 'invalid', 'unsupported'])('never completes without a real read when the planner is %s', async variant => {
    const state = fixture(), generateAnswer = vi.fn(async () => ({ text: '请粘贴论文。' }));
    const output = variant === 'invalid' ? 'not JSON' : JSON.stringify({ steps: variant === 'unsupported' ? [...core,
      { id: 'fake', title: 'fake', description: 'fake', toolName: 'fs.readFile', toolArgs: {} }] : core });
    await expect(runResearchAgent({ ...state.input, generatePlan: async () => ({ text: output }), generateAnswer, requireAnswer: true })).rejects.toThrow(/未完成.*正文|正文.*未完成/);
    expect(state.execute.mock.calls.map(call => call[0])).toEqual(['lattice.sources.list']);
    expect(generateAnswer).not.toHaveBeenCalled();
    expect(state.active.reads).toBe(0);
    expect(useAgentSessionStore.getState().sessions[0].status).toBe('failed');
  });

  it('executes shared skills and bounded math and publishes writes only as review drafts', async () => {
    const state = fixture(), sessionId = createAgentToolSession({ profile: 'research', task: 'Prepare a note' });
    const options = { sessionId, apiToolRuntime: state.input.apiToolRuntime };
    const listed = await executeAgentTool({ name: 'lattice.skills.list', args: {} }, options);
    expect(listed.status).toBe('completed');
    expect(JSON.stringify(listed.result)).toContain('pdf-annotation');
    expect(await executeAgentTool({ name: 'lattice.skills.get', args: { id: 'notebook-analysis' } }, options)).toMatchObject({ status: 'completed' });
    expect(await executeAgentTool({ name: 'lattice.compute.evaluate', args: { expression: 'sqrt(9) + 2' } }, options)).toMatchObject({ status: 'completed', result: { value: 5 } });
    expect(await executeAgentTool({ name: 'lattice.workspace.proposeWrite', args: { targetPath: 'essay/new.md', content: '# Verified note', mode: 'create' } }, options)).toMatchObject({ status: 'completed', result: { status: 'pending-review', artifactId: 'review-1' } });
    expect(state.onDraft).toHaveBeenCalledTimes(1);
    expect((state.root.entries.get('essay') as SourceTestDirectory).entries.has('new.md')).toBe(false);
    expect(useAgentSessionStore.getState().getSession(sessionId)?.pendingApprovals).toHaveLength(0);
  });

  it('normalizes and executes all twelve shared tools through the planned tool loop without applying proposals', async () => {
    const state = fixture('essay/a-paper.pdf'), sessionId = createAgentToolSession({ profile: 'research', task: 'Prepare reviewed analysis' });
    const calls = [
      ['lattice.skills.list', {}], ['lattice.skills.get', { id: 'pdf-annotation' }],
      ['lattice.sources.list', { limit: 1 }], ['lattice.sources.search', { query: 'metastable', maxFiles: 1, maxUnits: 1 }],
      ['lattice.sources.read', { path: 'essay/a-paper.pdf', units: [1], maxUnits: 1 }], ['lattice.sources.active', { units: [1], maxUnits: 1 }],
      ['lattice.pdf.listChildren', { parentPath: 'essay/a-paper.pdf' }], ['lattice.pdf.readAnnotations', { parentPath: 'essay/a-paper.pdf' }],
      ['lattice.pdf.proposeAnnotations', { parentPath: 'essay/a-paper.pdf', annotations: [{ page: 1, quote: 'logical 0 and 1 encoded in two metastable states', type: 'highlight' }] }],
      ['lattice.pdf.proposeChild', { parentPath: 'essay/a-paper.pdf', fileName: 'note.md', content: '# Source analysis', mode: 'create' }],
      ['lattice.workspace.proposeWrite', { targetPath: 'essay/new.md', content: '# Reviewed analysis', mode: 'create' }],
      ['lattice.compute.evaluate', { expression: '2 * pi' }],
    ] as const;
    const plan = normalizeResearchAgentPlan({ planSteps: [...core, ...calls.map(([toolName, toolArgs], index) => ({ id: `tool-${index}`, title: toolName, description: toolName,
      toolName, toolArgs, status: 'completed' }))] });
    expect(plan.warnings).toEqual([]);
    expect(plan.steps.filter(step => step.toolName).every(step => step.status === 'pending')).toBe(true);
    const result = await runResearchAgentReadToolLoop({ sessionId, apiToolRuntime: state.input.apiToolRuntime,
      query: 'Prepare reviewed analysis', now: 100, planSteps: plan.steps, maxReadToolSteps: 12 });
    expect(result.blocked).toBe(false);
    expect(result.toolResults).toHaveLength(LATTICE_HARNESS_TOOLS.length);
    expect(result.toolResults.every(tool => tool.status === 'completed')).toBe(true);
    expect(state.execute.mock.calls.map(call => call[0]).sort()).toEqual(LATTICE_HARNESS_TOOLS.map(tool => tool.name).sort());
    expect(state.onDraft).toHaveBeenCalledTimes(3);
    expect(state.root.entries.has('.lattice')).toBe(false);
    expect((state.root.entries.get('essay') as SourceTestDirectory).entries.has('new.md')).toBe(false);
  });
});
