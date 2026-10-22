// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { SourceTestDirectory, SourceTestFile } from './fixtures/source-workspace';
import { createAuthorizedSourceIndex } from '../source-index';
import { createLatticeHarnessToolRuntime } from '../harness/lattice-source-tools';
import { bindConversationSources } from '../conversation-source-binding';
import { conversationDocumentPaths } from '../conversation-documents';
import { resolveConversationSourceTargets } from '../conversation-source-targeting';
import { runResearchAgent } from '../research-agent';
import { buildProtocolRequest, parseProtocolResponse } from '../protocol-adapters';
import type { AiProviderProfile } from '../types';
import type { ChatMessage } from '@/stores/ai-chat-store';

vi.mock('@/lib/storage-adapter', () => ({ getStorageAdapter: () => ({ get: async () => null, set: async () => {}, remove: async () => {}, clear: async () => {} }) }));

// Explicit authorization: at most two external requests. Normal QA always skips.
it.skipIf(process.env.LATTICE_LIVE_PAPER_FOLLOWUP_20261013 !== '1')('rereads the original paper after focus changes using exactly two configured model requests', async () => {
  const budgetPath = '.lattice-build/paper-followup-live-budget-20261013.json';
  const parse = (value: string) => JSON.parse(value.replace(/^\uFEFF/u, ''));
  const state = parse(await readFile('C:/Users/XINGLUOYUNSHEN/AppData/Roaming/com.lattice.editor/settings.json', 'utf8'));
  const configured = state['lattice-ai-provider-profiles'];
  const profile: AiProviderProfile | undefined = configured?.profiles?.find((item: AiProviderProfile) => item.id === configured.activeProfileId && item.enabled);
  if (!profile) throw new Error('No configured API profile; no request issued.');
  const credentials = parse(await readFile('C:/Users/XINGLUOYUNSHEN/AppData/Roaming/com.lattice.editor/ai-keys.json', 'utf8'));
  const apiKey = credentials['lattice-ai-profile-key:' + profile.id];
  if (profile.authMode !== 'none' && typeof apiKey !== 'string') throw new Error('No configured credential; no request issued.');
  const model = profile.defaultModelId ?? profile.model;
  const root = new SourceTestDirectory('synthetic');
  const paper = root.add(new SourceTestDirectory('papers')).add(new SourceTestFile('synthetic-paper.md', '# Synthetic single-qubit study\n\nThis is a synthetic fixture, not a real scientific result. The experimental gate uses a microwave pulse on a logical qubit encoded in two metastable levels.\n\n## Exact synthetic parameters\n\nThe microwave frequency is 73.4 MHz. The pulse duration is 8.2 microseconds. The synthetic measured fidelity is 99.91 percent.\n'));
  const rules = root.add(new SourceTestFile('AGENTS.md', 'Unrelated workspace rules. No scientific evidence.'));
  const note = root.add(new SourceTestFile('cz-note.md', '# Unrelated CZ note\nThe unrelated CZ parameter is 1.7 MHz.'));
  const messages: ChatMessage[] = [];
  const rounds: Array<Record<string, unknown>> = [];
  let actualCalls = 0, failure: string | undefined;
  const initialBudget = parse(await readFile(budgetPath, 'utf8'));
  const resumeFollowup = initialBudget.used === 1;
  const previousAttempt = resumeFollowup ? parse(await readFile('.lattice-build/paper-followup-live-20261013.json', 'utf8')) : undefined;
  if (resumeFollowup) messages.push(
    { id: 'seed-user', role: 'user', content: '请讲解 papers/synthetic-paper.md。', timestamp: 1 },
    { id: 'seed-legacy', role: 'assistant', content: 'Legacy synthetic conversation identity; prior prose is not current evidence.', timestamp: 2,
      evidenceRefs: [{ kind: 'file', label: 'synthetic paper', locator: 'papers/synthetic-paper.md' }] },
  );
  try {
    const queries = ['请概括 papers/synthetic-paper.md 的单比特门实验设置，一句话并引用来源。', '本文单比特门用的频率、脉冲时长和保真度是多少？只列这三项并引用来源。'];
    for (let turn = resumeFollowup ? 1 : 0; turn < queries.length; turn++) {
      const query = queries[turn];
      const activePath = turn ? 'AGENTS.md' : 'papers/synthetic-paper.md';
      const binding = bindConversationSources({ query, messages, localWorkspaceKey: 'synthetic-live', legacyWorkspaceKey: 'synthetic-live', activeCloud: false, activeLocalPath: activePath });
      const targets = await resolveConversationSourceTargets({ query, knownPaths: conversationDocumentPaths(messages, 'synthetic-live'), referentPaths: binding.referentPaths, relocateReferents: binding.relocateReferents, activePath, rootHandle: root.handle(), workspaceKey: 'synthetic-live' });
      expect(targets.paths).toEqual(['papers/synthetic-paper.md']);
      if (!targets.selections?.length) throw new Error('The synthetic paper must have an explicit authorized selection.');
      const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'synthetic-live', selections: targets.selections });
      const runtime = createLatticeHarnessToolRuntime({ kind: 'local', index, root: root.handle(), workspaceKey: 'synthetic-live' });
      let callsThisTurn = 0, status = 0, firstResponseMs = 0;
      let responseMetadata: Record<string, unknown> | undefined;
      try {
        const result = await runResearchAgent({ task: query, query, workspaceKey: 'synthetic-live', apiToolRuntime: runtime, sourceSelections: targets.selections,
          requireSourceDiscovery: true, maxObservationReplans: 0, compact: false, suggestMemory: false, requireAnswer: true,
          history: messages.map(message => ({ role: message.role, content: message.content })), answerMaxTokens: 8192,
          planSteps: [{ id: 'context-pack', title: 'Context', description: 'Context' },
            { id: 'read-paper', title: 'Reread current paper', description: 'Read actual synthetic source', toolName: 'lattice.sources.read', toolArgs: { path: targets.paths[0], maxChars: 4000 } },
            { id: 'evidence-resolve', title: 'Evidence', description: 'Evidence' }, { id: 'synthesize-answer', title: 'Answer', description: 'Answer' }],
          generateAnswer: async prompt => {
            if (callsThisTurn >= 1) throw new Error('This turn single-request budget exhausted; no repair/retry sent.');
            const budget = parse(await readFile(budgetPath, 'utf8'));
            if (!budget.authorized || budget.limit !== 2 || budget.used >= 2) throw new Error('No authorized paper-followup budget remaining.');
            budget.used++; budget.status = 'sending'; await writeFile(budgetPath, JSON.stringify(budget, null, 2)); callsThisTurn++; actualCalls++;
            const started = performance.now();
            const request = buildProtocolRequest(profile.protocol, profile, apiKey ?? '', prompt, { model: model ?? undefined, maxTokens: 8192, temperature: 0.1, signal: AbortSignal.timeout(300000) });
            const response = await fetch(request.url, request.init); status = response.status; firstResponseMs = Math.round(performance.now() - started);
            if (!response.ok) throw new Error(`Configured model HTTP ${response.status}; no retry.`);
            const parsed = await parseProtocolResponse(profile.protocol, response, model ?? '');
            responseMetadata = { httpStatus: status, firstResponseMs, finishReason: parsed.finishReason, visibleCharacters: parsed.text.length, usage: parsed.usage };
            await writeFile('.lattice-build/paper-followup-live-response-20261013.json', JSON.stringify(responseMetadata, null, 2));
            return parsed;
          },
        });
        expect(result.answer.trim()).not.toBe('');
        if (turn) { expect(result.answer).toContain('73.4'); expect(result.answer).toContain('8.2'); expect(result.answer).toContain('99.91'); expect(result.answer).not.toContain('1.7'); }
        rounds.push({ turn: turn + 1, activePath, resolvedPaths: targets.paths, binding, calls: callsThisTurn, responseMetadata, answer: result.answer, toolResults: result.toolResults.map(tool => ({ tool: tool.toolName, status: tool.status })) });
        messages.push({ id: `user-${turn}`, role: 'user', content: query, timestamp: turn * 2 + 1 },
          { id: `assistant-${turn}`, role: 'assistant', content: result.answer, timestamp: turn * 2 + 2, evidenceRefs: result.promptContext.evidenceRefs, promptContext: result.promptContext });
      } finally { index.invalidate(); }
    }
    expect(actualCalls).toBe(resumeFollowup ? 1 : 2); expect(paper.reads).toBeGreaterThanOrEqual(2); expect(rules.reads).toBe(0); expect(note.reads).toBe(0);
  } catch (error) { failure = error instanceof Error ? error.message : 'Failed'; throw error; }
  finally {
    const budget = parse(await readFile(budgetPath, 'utf8')); budget.status = failure ? 'failed' : 'passed'; await writeFile(budgetPath, JSON.stringify(budget, null, 2));
    const report = { checkedAt: new Date().toISOString(), profile: profile.name, model, protocol: profile.protocol, calls: budget.used, currentRunCalls: actualCalls, status: failure ? 'failed' : resumeFollowup ? 'followup-passed-initial-request-failed' : 'passed', ...(failure ? { failure } : {}), previousAttempt, rounds, paperReads: paper.reads, rulesReads: rules.reads, unrelatedNoteReads: note.reads, syntheticOnly: true, limitation: resumeFollowup ? 'First request produced no visible answer; second request uses seeded legacy source identity and actual reread. Fixed plan, no paid UI or autonomous-planner evaluation.' : 'Source binding and real tool-read/synthesis; fixed plan, no paid UI or autonomous-planner evaluation.' };
    await writeFile('.lattice-build/paper-followup-live-20261013.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  }
}, 660000);
