import { describe, expect, it, vi } from 'vitest';

import {
  buildResearchAgentPlannerPrompt,
  parseResearchAgentPlannerOutput,
  runResearchAgentPlanner,
} from '../ai/research-agent-llm-planner';

describe('research-agent-llm-planner', () => {
  it('distinguishes priority documents from the wider authorized workspace', () => {
    const prompt = buildResearchAgentPlannerPrompt({ task: 'Compare calibration notes', query: 'Compare the experiment with the calibration note',
      filePath: 'paper.pdf', sourceSelections: [{ kind: 'file', path: 'paper.pdf' }], authorizedSourceSelections: [{ kind: 'folder', path: '.' }],
      latticeSourcePdfToolsAvailable: true });
    expect(prompt).toContain('Priority document targets: [{"kind":"file","path":"paper.pdf"}]');
    expect(prompt).toContain('Actual authorized tool scope: [{"kind":"folder","path":"."}]');
    expect(prompt).not.toContain('Authorized source selections:');
    expect(prompt).toContain('source-language keywords');
    expect(prompt).toContain('nextCursor');
  });

  it('includes bounded conversation intent and neutralizes historical citations before planning', () => {
    const history = [{ role: 'user' as const, content: 'Read paper.pdf and explain BB1.' },
      { role: 'assistant' as const, content: 'Next search the BB1 definition. [p.12](citation:old?quote=Prior%20claim)' }];
    const prompt = buildResearchAgentPlannerPrompt({ task: 'Explain the mechanism further', query: 'Why does that cancel amplitude error?', history });
    expect(prompt).toContain('Read paper.pdf and explain BB1.');
    expect(prompt).toContain('Next search the BB1 definition.');
    expect(prompt).toContain('历史引文未重新核验');
    expect(prompt).not.toContain('citation:old');
    expect(prompt).toContain('not source evidence or tool approval');
    expect(history[1].content).toContain('citation:old');
    const bounded = buildResearchAgentPlannerPrompt({ task: 'Follow up', query: 'Explain', history: [{ role: 'assistant', content: 'x'.repeat(20000) }] });
    expect(bounded).not.toContain('x'.repeat(5000));
  });
  it('retains content-free diagnostics when an empty model response falls back to a plan', async () => {
    const responseDiagnostics = { protocol: 'anthropic-messages' as const, mode: 'response' as const, blockTypes: ['thinking'], visibleCharacters: 0, stopReason: 'max_tokens' };
    const result = await runResearchAgentPlanner({ task: 'Read a source', query: 'Explain', generatePlan: async () => ({ text: '', finishReason: 'length', responseDiagnostics }) });
    expect(result.plan.source).toBe('fallback');
    expect(result.responseDiagnostics).toEqual(responseDiagnostics);
  });
  it('builds a constrained JSON-only planner prompt with supported tools and task context', () => {
    const prompt = buildResearchAgentPlannerPrompt({
      task: 'Compare source notes',
      query: 'What changed between notes?',
      contextPackId: 'pack-1',
      contextSummary: 'Two notes discuss evidence grounding.',
      memoryCount: 2,
      evidenceCount: 3,
      includeDraftStep: true,
      includeProposalStep: false,
      includeCompactionStep: true,
      continuationSummary: 'Continue from session: source-session-alpha\nCompaction: source-compaction-alpha\nSource summary: Alpha prior work.',
      observationsSummary: '1. workspace-search: workspace.search completed - Found Alpha implementation notes.',
      workflowHints: 'Workflow: Reading Note (reading-note)\nAllowed tools: evidence.resolve',
    });

    expect(prompt).toContain('Return only JSON');
    const schema = JSON.parse(prompt.slice(prompt.indexOf('Schema:\n') + 'Schema:\n'.length, prompt.indexOf('\n\nRequired step ids:')));
    expect(schema.steps[0].toolArgs).toEqual({});
    expect(prompt).toContain('never serialize toolArgs as a JSON string');
    expect(prompt).toContain('Required step ids: context-pack, evidence-resolve, synthesize-answer');
    expect(prompt).toContain('Supported tool names: workspace.search');
    expect(prompt).toContain('Allowed toolArgs: workspace.search {query, limit}');
    expect(prompt).toContain('Do not include toolArgs for workbench.createDraft');
    expect(prompt).toContain('use their resultSchema status, summary, metrics, artifacts, and diagnostics');
    expect(prompt).toContain('Avoid repeating low-value or duplicate read requests');
    expect(prompt).toContain('Task: Compare source notes');
    expect(prompt).toContain('Continuation context: Continue from session: source-session-alpha Compaction: source-compaction-alpha Source summary: Alpha prior work.');
    expect(prompt).toContain('Tool observations:');
    expect(prompt).toContain('Found Alpha implementation notes.');
    expect(prompt).toContain('Workflow hints:');
    expect(prompt).toContain('Workflow: Reading Note (reading-note)');
    expect(prompt).toContain('Draft step requested: yes');
  });

  it('parses fenced planner JSON and normalizes it through the plan schema', () => {
    const plan = parseResearchAgentPlannerOutput({
      output: [
        '```json',
        '{',
        '  "steps": [',
        '    {"id":"context-pack","title":"Collect","description":"Collect context."},',
        '    {"id":"evidence-resolve","title":"Resolve","description":"Resolve evidence.","toolName":"evidence.resolve"},',
        '    {"id":"synthesize-answer","title":"Synthesize","description":"Write answer."}',
        '  ]',
        '}',
        '```',
      ].join('\n'),
    });

    expect(plan.source).toBe('custom');
    expect(plan.warnings).toEqual([]);
    expect(plan.steps).toEqual([
      expect.objectContaining({ id: 'context-pack', status: 'pending' }),
      expect.objectContaining({ id: 'evidence-resolve', toolName: 'evidence.resolve' }),
      expect.objectContaining({ id: 'synthesize-answer' }),
    ]);
  });

  it('falls back to defaults when planner output is not parseable JSON', () => {
    const plan = parseResearchAgentPlannerOutput({
      output: 'I will inspect the workspace and then write a summary.',
      context: {
        includeDraftStep: true,
        includeCompactionStep: false,
      },
    });

    expect(plan.source).toBe('fallback');
    expect(plan.warnings).toEqual(['Planner output did not contain a JSON object.']);
    expect(plan.steps.map((step) => step.id)).toEqual([
      'context-pack',
      'evidence-resolve',
      'synthesize-answer',
      'create-draft',
    ]);
  });

  it('falls back with schema warnings when planner JSON references unsupported tools', () => {
    const plan = parseResearchAgentPlannerOutput({
      output: JSON.stringify({
        steps: [
          {
            id: 'context-pack',
            title: 'Collect',
            description: 'Collect context.',
            toolName: 'shell.run',
          },
        ],
      }),
    });

    expect(plan.source).toBe('fallback');
    expect(plan.warnings).toEqual(
      expect.arrayContaining([
        'Planner output failed schema validation.',
        expect.stringContaining('unsupported tool'),
        expect.stringContaining('evidence-resolve'),
      ]),
    );
  });

  it('runs an injected planner generator and parses the returned plan', async () => {
    const generatePlan = vi.fn(async () => ({
      text: JSON.stringify({
        steps: [
          {
            id: 'context-pack',
            title: 'Collect',
            description: 'Collect context.',
          },
          {
            id: 'evidence-resolve',
            title: 'Resolve',
            description: 'Resolve evidence.',
            toolName: 'evidence.resolve',
          },
          {
            id: 'synthesize-answer',
            title: 'Synthesize',
            description: 'Synthesize answer.',
          },
        ],
      }),
    }));

    const result = await runResearchAgentPlanner({
      task: 'Plan with a model',
      query: 'What should happen?',
      generatePlan,
      model: 'planner-model',
      temperature: 0.1,
      maxTokens: 800,
    });

    expect(generatePlan).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: 'system' }),
        expect.objectContaining({ role: 'user', content: expect.stringContaining('Plan with a model') }),
      ]),
      expect.objectContaining({
        model: 'planner-model',
        temperature: 0.1,
        maxTokens: 800,
      }),
    );
    expect(result.rawOutput).toContain('context-pack');
    expect(result.plan.source).toBe('custom');
    expect(result.plan.warnings).toEqual([]);
  });

  it('falls back when the injected planner generator fails', async () => {
    const result = await runResearchAgentPlanner({
      task: 'Plan with failure',
      query: 'What should happen?',
      generatePlan: async () => {
        throw new Error('provider unavailable');
      },
      includeDraftStep: true,
      includeCompactionStep: false,
    });

    expect(result.rawOutput).toBeNull();
    expect(result.plan.source).toBe('fallback');
    expect(result.plan.warnings).toEqual(['Planner generation failed: provider unavailable']);
    expect(result.plan.steps.map((step) => step.id)).toEqual([
      'context-pack',
      'evidence-resolve',
      'synthesize-answer',
      'create-draft',
    ]);
  });

  it('propagates AbortError from the injected planner generator', async () => {
    const abortError = new Error('planner cancelled');
    abortError.name = 'AbortError';

    await expect(
      runResearchAgentPlanner({
        task: 'Plan with cancellation',
        query: 'What should happen?',
        generatePlan: async () => {
          throw abortError;
        },
      }),
    ).rejects.toMatchObject({
      name: 'AbortError',
      message: 'planner cancelled',
    });
  });
});
