// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createLatticeHarnessToolRuntime } from '../harness/lattice-source-tools';
import { createAuthorizedSourceIndex } from '../source-index';
import { SourceTestDirectory, SourceTestFile } from './fixtures/source-workspace';
import { runResearchAgent } from '../research-agent';
import { buildProtocolRequest, parseProtocolResponse } from '../protocol-adapters';
import type { AiProviderProfile } from '../types';

vi.mock('@/lib/storage-adapter', () => ({ getStorageAdapter: () => ({ get: async () => null, set: async () => {}, remove: async () => {}, clear: async () => {} }) }));

// Never enters the normal QA gate. Each explicitly authorized live run is
// counted before sending; retries/repairs are refused rather than charged.
it.skipIf(process.env.LATTICE_LIVE_API_20261013 !== '1')('uses the configured API once to synthesize actual source and calculation results', async () => {
  const budgetPath = '.lattice-build/harness-live-budget-20261013.json';
  const parse = (value: string) => JSON.parse(value.replace(/^\uFEFF/u, ''));
  const state = parse(await readFile('C:/Users/XINGLUOYUNSHEN/AppData/Roaming/com.lattice.editor/settings.json', 'utf8'));
  const configured = state['lattice-ai-provider-profiles'];
  const profile: AiProviderProfile | undefined = configured?.profiles?.find((item: AiProviderProfile) => item.id === configured.activeProfileId && item.enabled);
  if (!profile) throw new Error('No configured active API profile; no request issued.');
  // Authorized credential use stays in process memory; no serialization/logging.
  const credentialStore = parse(await readFile('C:/Users/XINGLUOYUNSHEN/AppData/Roaming/com.lattice.editor/ai-keys.json', 'utf8'));
  const apiKey = credentialStore['lattice-ai-profile-key:' + profile.id];
  if (profile.authMode !== 'none' && typeof apiKey !== 'string') throw new Error('Configured credential unavailable; no request issued.');
  const root = new SourceTestDirectory('synthetic'), folder = root.add(new SourceTestDirectory('essay'));
  const body = '# Synthetic study\n\nLATTICE_API_SYNTHETIC_43. The synthetic measurement coefficient is 43.\n';
  await mkdir('.lattice-build/api-live-synthetic-20261013', { recursive: true });
  await writeFile('.lattice-build/api-live-synthetic-20261013/study.md', body);
  const file = folder.add(new SourceTestFile('study.md', await readFile('.lattice-build/api-live-synthetic-20261013/study.md', 'utf8')));
  const index = createAuthorizedSourceIndex({ rootHandle: root.handle(), workspaceKey: 'live-synthetic', selections: [{ kind: 'folder', path: 'essay' }] });
  const runtime = createLatticeHarnessToolRuntime({ kind: 'local', index, root: root.handle(), workspaceKey: 'live-synthetic' });
  let calls = 0, firstBodyMs = 0, httpStatus = 0;
  const started = performance.now();
  const model = profile.defaultModelId ?? profile.model;
  try {
    const result = await runResearchAgent({ task: 'Use the synthetic source and the real numeric tool result. State the coefficient and sqrt(9)+2 in one concise Chinese sentence with a supplied citation.',
      query: 'Give the synthetic coefficient and calculation result.', workspaceKey: 'live-synthetic',
      apiToolRuntime: runtime, sourceSelections: [{ kind: 'folder', path: 'essay' }], requireSourceDiscovery: true, maxObservationReplans: 0,
      compact: false, suggestMemory: false, requireAnswer: true,
      planSteps: [
        { id: 'context-pack', title: 'Context', description: 'Context' },
        { id: 'read', title: 'Read synthetic file', description: 'Read', toolName: 'lattice.sources.read', toolArgs: { path: 'essay/study.md', maxChars: 4000 } },
        { id: 'compute', title: 'Compute', description: 'Compute', toolName: 'lattice.compute.evaluate', toolArgs: { expression: 'sqrt(9)+2' } },
        { id: 'evidence-resolve', title: 'Evidence', description: 'Evidence' }, { id: 'synthesize-answer', title: 'Answer', description: 'Answer' },
      ], generateAnswer: async (messages) => {
        if (++calls > 1) throw new Error('Authorized single API request exhausted; repair/retry was not sent.');
        const budget = parse(await readFile(budgetPath, 'utf8'));
        if (!budget.authorized || budget.apiLimit !== 1 || budget.apiUsed !== 0) throw new Error('No remaining authorized API budget.');
        budget.apiUsed = 1; budget.apiStatus = 'sending';
        await writeFile(budgetPath, JSON.stringify(budget, null, 2));
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 300000);
        try {
          const request = buildProtocolRequest(profile.protocol, profile, apiKey ?? '', messages, { model: model ?? undefined, maxTokens: 1000, temperature: 0.1, signal: controller.signal });
          const response = await fetch(request.url, request.init);
          firstBodyMs = Math.round(performance.now() - started); httpStatus = response.status;
          if (!response.ok) throw new Error(`Authorized API returned HTTP ${response.status}; no retry.`);
          return parseProtocolResponse(profile.protocol, response, model ?? '');
        } finally { clearTimeout(timer); }
      } });
    expect(result.answer).toContain('43'); expect(result.answer).toContain('5');
    expect(file.reads).toBeGreaterThan(0);
    expect(result.toolResults.filter(item => item.status === 'completed').map(item => item.toolName)).toEqual(expect.arrayContaining(['lattice.sources.list', 'lattice.sources.read', 'lattice.compute.evaluate']));
    const report = { profile: profile.name, model, protocol: profile.protocol, calls, httpStatus, firstBodyMs, complete: true, answer: result.answer,
      tools: result.toolResults.map(item => ({ name: item.toolName, status: item.status })), syntheticFileReads: file.reads };
    await writeFile('.lattice-build/api-agent-live-20261013.json', JSON.stringify(report, null, 2));
    const budget = parse(await readFile(budgetPath, 'utf8')); budget.apiStatus = 'passed'; await writeFile(budgetPath, JSON.stringify(budget, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) {
    const budget = parse(await readFile(budgetPath, 'utf8')); budget.apiStatus = 'failed'; await writeFile(budgetPath, JSON.stringify(budget, null, 2));
    throw error;
  } finally { index.invalidate(); }
}, 360000);
