import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiRuntimeSettings } from '../ai/types';
import type { ResearchAgentRunInput } from '../ai/research-agent';

const model = vi.hoisted(() => ({ plan: vi.fn(), answer: vi.fn() }));
vi.mock('../ai/research-agent-planner-provider', () => ({ createResearchAgentPlannerGenerate: () => ({
  generatePlan: model.plan, generateAnswer: model.answer,
  modelInfo: { providerId: 'synthetic', providerName: 'Synthetic', model: 'offline-test', source: 'cloud' },
}) }));
vi.mock('@/lib/storage-adapter', () => ({ getStorageAdapter: () => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn(), clear: vi.fn() }) }));
vi.mock('@/lib/pdf-js-document-loader', () => ({ loadPdfJsDocument: async () => ({ numPages: 3, destroy: async () => {} }) }));
vi.mock('@/lib/pdf-page-text-cache', () => ({ getPdfPageSearchText: async () => 'We implement single-qubit gates with logical 0 and 1 encoded in two metastable states.' }));

import { runResearchAgentForSurface } from '../ai/research-agent-chat-runner';
import { createLatticeHarnessToolRuntime } from '../ai/harness/lattice-source-tools';
import { createAuthorizedSourceIndex } from '../ai/source-index';
import { SourceTestDirectory, SourceTestFile } from '../ai/__tests__/fixtures/source-workspace';
import { useAgentSessionStore } from '@/stores/agent-session-store';
import { verifiedPdfAnnotationToolDeliveries } from '../ai/pdf-annotation-tool-delivery';

const settings: AiRuntimeSettings = { aiEnabled: true, providerId: 'custom', model: 'offline-test', temperature: .2, maxTokens: 4000, systemPrompt: '', preferLocal: false };
const quote = 'logical 0 and 1 encoded in two metastable states';
const core = ['context-pack', 'evidence-resolve', 'synthesize-answer'].map(id => ({ id, title: id, description: id }));
function fixture(options: { partial?: boolean; noProposal?: boolean; tamper?: (value: unknown) => unknown } = {}) {
  const root = new SourceTestDirectory('workspace');
  root.add(new SourceTestFile('paper.pdf', '%PDF synthetic fixture'));
  const sourceSelections = [{ kind: 'file' as const, path: 'paper.pdf' }];
  const onDraft = vi.fn(() => 'verified-annotation-review');
  const runtime = createLatticeHarnessToolRuntime({ kind: 'local', root: root.handle(), workspaceKey: 'synthetic',
    index: createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'synthetic', selections: sourceSelections }),
    getActivePath: () => 'paper.pdf', onDraft });
  model.plan.mockResolvedValue({ text: JSON.stringify({ steps: [...core,
    { id: 'read-page', title: 'Read original', description: 'Read original synthetic PDF', toolName: 'lattice.sources.read', toolArgs: { path: 'paper.pdf', units: [1] } },
    ...(!options.noProposal ? [{ id: 'propose', title: 'Review annotations', description: 'Prepare a verified draft', toolName: 'lattice.pdf.proposeAnnotations', toolArgs: {
      parentPath: 'paper.pdf', annotations: [{ page: 1, quote, type: 'highlight', color: 'yellow' }, ...(options.partial ? [{ page: 1, quote: 'An invented statement.', type: 'underline' }] : [])],
    } }] : []),
  ] }) });
  model.answer.mockResolvedValue({ text: '已生成经过原文校验的批注草稿，等待审阅。' });
  const input: ResearchAgentRunInput = { task: '批注本文核心', query: '批注本文核心', filePath: 'paper.pdf', workspaceKey: 'synthetic',
    apiToolRuntime: { ...runtime, sourceSelections, execute: async (name, args, signal) => {
      const value = await runtime.execute(name, args, signal);
      return name === 'lattice.pdf.proposeAnnotations' && options.tamper ? options.tamper(value) : value;
    } }, sourceSelections, includeWorkspaceSummary: false, suggestMemory: false, compact: false, maxObservationReplans: 0 };
  return { root, onDraft, input };
}

describe('PDF annotation surface → real engine → real offline tools', () => {
  beforeEach(() => { vi.clearAllMocks(); useAgentSessionStore.setState({ sessions: [], activeSessionId: null }); });

  it('delivers the already published review draft without requiring a duplicate fenced proposal', async () => {
    const state = fixture();
    const result = await runResearchAgentForSurface({ ...state.input, settings, workflowId: 'pdf-annotation', responseMode: 'conversation' });
    expect(result.result.session.status).toBe('completed');
    expect(state.onDraft).toHaveBeenCalledTimes(1);
    expect(model.answer).toHaveBeenCalledTimes(1);
    expect(result.annotationProposal).toBeUndefined();
    expect(result.chatText).toContain('AI 工作台');
    expect(result.chatText).toContain('尚未写入 PDF');
    expect(result.agentResult.deliveryStatus).toBe('ready_for_review');
  });

  it('retains the valid review draft and explains partial quote exclusions', async () => {
    const state = fixture({ partial: true });
    const result = await runResearchAgentForSurface({ ...state.input, settings, workflowId: 'pdf-annotation' });
    expect(state.onDraft).toHaveBeenCalledTimes(1);
    expect(result.annotationProposal).toBeUndefined();
    expect(result.chatText).toContain('1 条未能定位');
    expect(result.agentResult.deliveryStatus).toBe('partial');
  });

  it('uses English for the new review completion notice when requested', async () => {
    const state = fixture();
    model.answer.mockResolvedValue({ text: 'Verified annotation drafts are ready for review.' });
    const result = await runResearchAgentForSurface({ ...state.input, settings, workflowId: 'pdf-annotation', noteConfigOverrides: { language: 'en-US' } });
    expect(result.chatText).toContain('AI Workbench');
    expect(result.chatText).toContain('no annotations have been written');
    expect(result.chatText).not.toContain('尚未写入');
  });

  it('does not treat matching missing cloud identity fields as a verified parent binding', async () => {
    const state = fixture();
    const result = await runResearchAgentForSurface({ ...state.input, settings, workflowId: 'pdf-annotation' });
    const receipts = structuredClone(result.result.toolResults);
    const value = receipts.find(receipt => receipt.toolName === 'lattice.pdf.proposeAnnotations')!.result as Record<string, unknown>;
    (value.verifiedSourceRead as { snapshot: { cloudIdentity: unknown } }).snapshot.cloudIdentity = {};
    const draft = value.draft as Record<string, unknown>;
    delete draft.pdfChildTarget;
    draft.cloudPdfChildProposal = { parent: {} };
    expect(verifiedPdfAnnotationToolDeliveries(receipts)).toEqual([]);
  });

  it.each(['missing-draft', 'wrong-target', 'wrong-version', 'zero-accepted'])('does not trust a malformed or unrelated runtime receipt: %s', async failure => {
    const state = fixture({ tamper: value => {
      const result = structuredClone(value) as Record<string, unknown>;
      if (failure === 'missing-draft') delete result.draft;
      if (failure === 'wrong-target') (result.verifiedSourceRead as { snapshot: { path: string } }).snapshot.path = 'another.pdf';
      if (failure === 'wrong-version') ((result.draft as { pdfChildTarget: { parentVersion: string } }).pdfChildTarget).parentVersion = 'another-version';
      if (failure === 'zero-accepted') (result.annotationValidation as { acceptedCount: number }).acceptedCount = 0;
      return result;
    } });
    await expect(runResearchAgentForSurface({ ...state.input, settings, workflowId: 'pdf-annotation' })).rejects.toThrow(/提案未通过原文或结构校验/);
  });

  it('does not accept a textual success claim when no annotation tool produced a review draft', async () => {
    const state = fixture({ noProposal: true });
    await expect(runResearchAgentForSurface({ ...state.input, settings, workflowId: 'pdf-annotation' })).rejects.toThrow(/提案未通过原文或结构校验/);
    expect(state.onDraft).not.toHaveBeenCalled();
  });

  it('still requires the independently requested Markdown body after an annotation tool succeeds', async () => {
    const state = fixture();
    model.answer.mockResolvedValue({ text: '```lattice-annotations\n{"annotations":[]}\n```' });
    await expect(runResearchAgentForSurface({ ...state.input, settings, workflowId: 'pdf-annotation', task: '批注本文核心，并生成一个md子文档详细讲解本文' })).rejects.toThrow(/缺少用户要求的 Markdown 讲解正文/);
    expect(state.onDraft).toHaveBeenCalledTimes(1);
  });
});
