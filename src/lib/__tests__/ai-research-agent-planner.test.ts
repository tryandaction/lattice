import { describe, expect, it } from 'vitest';

import {
  buildDefaultResearchAgentPlanSteps,
  normalizeResearchAgentPlan,
  updateResearchAgentPlanStepStatus,
} from '../ai/research-agent-planner';

describe('research-agent-planner', () => {
  it('preserves a source tool attached to a reserved core id as a separate executable step', () => {
    const plan = normalizeResearchAgentPlan({ planSteps: [
      { id: 'context-pack', title: 'Locate BB1 passages', description: 'Search the captured PDF for BB1', toolName: 'lattice.sources.search', toolArgs: { query: 'BB1', maxUnits: 20, maxFiles: 1, maxChars: 40000 } },
      { id: 'evidence-resolve', title: 'Resolve evidence', description: 'Resolve original quotations', toolName: 'evidence.resolve' },
      { id: 'synthesize-answer', title: 'Answer', description: 'Explain BB1', toolName: 'evidence.resolve', toolArgs: { query: 'BB1' } },
    ] });
    expect(plan.source).toBe('custom');
    expect(plan.steps.find(step => step.id === 'context-pack')?.toolName).toBeUndefined();
    expect(plan.steps.find(step => step.id === 'synthesize-answer')?.toolName).toBeUndefined();
    expect(plan.steps.filter(step => step.toolName === 'lattice.sources.search')).toEqual([
      expect.objectContaining({ id: expect.not.stringMatching(/^(?:context-pack|evidence-resolve|synthesize-answer)$/), status: 'pending', toolArgs: { query: 'BB1', maxUnits: 20, maxFiles: 1, maxChars: 40000 } }),
    ]);
    expect(new Set(plan.steps.map(step => step.id)).size).toBe(plan.steps.length);
  });

  it('rejects an action smuggled onto a reserved core id instead of silently skipping its approval', () => {
    const plan = normalizeResearchAgentPlan({ context: { allowCodeExecution: true }, planSteps: [
      { id: 'context-pack', title: 'Run', description: 'Compute result', toolName: 'runner.runCode', toolArgs: { language: 'python', code: 'print(1)' } },
      ...buildDefaultResearchAgentPlanSteps({ includeCompactionStep: false }).filter(step => step.id !== 'context-pack'),
    ] });
    expect(plan.source).toBe('fallback');
    expect(plan.steps.some(step => step.toolName === 'runner.runCode')).toBe(false);
  });
  function planWithRunner(toolArgs: unknown, status?: string) {
    return [
      ...buildDefaultResearchAgentPlanSteps({ includeCompactionStep: false }),
      { id: 'compute-mean', title: 'Compute mean', description: 'Run the requested calculation after approval.', toolName: 'runner.runCode', toolArgs, ...(status ? { status } : {}) },
    ];
  }

  it('accepts typed computation only when the task explicitly enables code execution', () => {
    const plan = normalizeResearchAgentPlan({
      context: { allowCodeExecution: true },
      planSteps: planWithRunner({ language: 'python', code: 'print(sum([2, 4]) / 2)' }),
    });
    expect(plan.source).toBe('custom');
    expect(plan.steps.at(-1)).toMatchObject({
      id: 'compute-mean', status: 'pending', toolName: 'runner.runCode',
      toolArgs: { language: 'python', code: 'print(sum([2, 4]) / 2)' },
    });
  });

  it('does not accept model execution steps for a read-only task', () => {
    const plan = normalizeResearchAgentPlan({
      planSteps: planWithRunner({ language: 'python', code: 'print(4)' }),
    });
    expect(plan.source).toBe('fallback');
    expect(plan.steps.some((step) => step.toolName === 'runner.runCode')).toBe(false);
  });

  it.each([undefined, {}, { language: 'python', code: ' ' }, { language: 'bash', code: 'echo unsafe' }, { language: 'python', code: 4 }, { language: 'python', code: 'print(4)', approvedByUser: true }])('rejects malformed or permission-bearing computation arguments: %j', (toolArgs) => {
    const plan = normalizeResearchAgentPlan({ context: { allowCodeExecution: true }, planSteps: planWithRunner(toolArgs) });
    expect(plan.source).toBe('fallback');
    expect(plan.steps.some((step) => step.toolName === 'runner.runCode')).toBe(false);
    expect(plan.warnings.join(' ')).toContain('runner.runCode');
  });

  it('rejects a planner claim that code already completed without execution', () => {
    const plan = normalizeResearchAgentPlan({ context: { allowCodeExecution: true }, planSteps: planWithRunner({ language: 'python', code: 'print(4)' }, 'completed') });
    expect(plan.source).toBe('fallback');
  });

  it('builds the default research plan from artifact and compaction context', () => {
    const steps = buildDefaultResearchAgentPlanSteps({
      includeDraftStep: true,
      includeProposalStep: true,
      includeCompactionStep: true,
      pathIdentity: {
        filePathOrAbsolutePath: 'papers/Rydberg paper.pdf',
        fileName: 'Rydberg paper.pdf',
        kind: 'pdf',
      },
    });

    expect(steps).toEqual([
      expect.objectContaining({ id: 'context-pack', status: 'pending' }),
      expect.objectContaining({
        id: 'resolve-lattice-path-identity',
        status: 'pending',
        toolName: 'lattice.resolvePathIdentity',
        toolArgs: {
          filePathOrAbsolutePath: 'papers/Rydberg paper.pdf',
          fileName: 'Rydberg paper.pdf',
          kind: 'pdf',
        },
      }),
      expect.objectContaining({ id: 'evidence-resolve', status: 'pending', toolName: 'evidence.resolve' }),
      expect.objectContaining({ id: 'synthesize-answer', status: 'pending' }),
      expect.objectContaining({ id: 'create-draft', status: 'pending', toolName: 'workbench.createDraft' }),
      expect.objectContaining({ id: 'create-proposal', status: 'pending', toolName: 'workbench.createProposal' }),
      expect.objectContaining({ id: 'compact-session', status: 'pending' }),
    ]);
  });

  it('accepts a valid custom plan with supported tool bindings', () => {
    const plan = normalizeResearchAgentPlan({
      planSteps: [
        {
          id: 'context-pack',
          title: 'Collect context',
          description: 'Collect the task context.',
        },
        {
          id: 'evidence-resolve',
          title: 'Resolve evidence',
          description: 'Resolve citations.',
          toolName: 'evidence.resolve',
        },
        {
          id: 'synthesize-answer',
          title: 'Write synthesis',
          description: 'Write the answer.',
          status: 'running',
        },
      ],
    });

    expect(plan.source).toBe('custom');
    expect(plan.warnings).toEqual([]);
    expect(plan.steps).toEqual([
      expect.objectContaining({ id: 'context-pack', status: 'pending' }),
      expect.objectContaining({ id: 'evidence-resolve', toolName: 'evidence.resolve' }),
      expect.objectContaining({ id: 'synthesize-answer', status: 'running' }),
    ]);
  });

  it('accepts sanitized tool args for readonly planned tools', () => {
    const plan = normalizeResearchAgentPlan({
      planSteps: [
        {
          id: 'context-pack',
          title: 'Collect context',
          description: 'Collect the task context.',
        },
        {
          id: 'workspace-search',
          title: 'Search workspace',
          description: 'Find related indexed files.',
          toolName: 'workspace.search',
          toolArgs: {
            query: 'alpha evidence',
            limit: 50,
          },
        },
        {
          id: 'read-indexed-context',
          title: 'Read indexed context',
          description: 'Read selected indexed files.',
          toolName: 'workspace.readIndexedContext',
          toolArgs: {
            paths: ['notes/alpha.md'],
          },
        },
        {
          id: 'resolve-lattice-path',
          title: 'Resolve Lattice path identity',
          description: 'Resolve PDF file identity before synthesis.',
          toolName: 'lattice.resolvePathIdentity',
          toolArgs: {
            filePathOrAbsolutePath: 'atom/Categorized Papers/Rydberg paper.pdf',
            fileName: 'Rydberg paper.pdf',
            kind: 'pdf',
          },
        },
        {
          id: 'evidence-resolve',
          title: 'Resolve evidence',
          description: 'Resolve citations.',
          toolName: 'evidence.resolve',
          toolArgs: {
            maxContextTokens: 1200,
          },
        },
        {
          id: 'synthesize-answer',
          title: 'Write synthesis',
          description: 'Write the answer.',
        },
      ],
    });

    expect(plan.source).toBe('custom');
    expect(plan.warnings).toEqual([]);
    expect(plan.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'workspace-search',
          toolArgs: {
            query: 'alpha evidence',
            limit: 20,
          },
        }),
        expect.objectContaining({
          id: 'read-indexed-context',
          toolArgs: {
            paths: ['notes/alpha.md'],
          },
        }),
        expect.objectContaining({
          id: 'resolve-lattice-path',
          toolArgs: {
            filePathOrAbsolutePath: 'atom/Categorized Papers/Rydberg paper.pdf',
            fileName: 'Rydberg paper.pdf',
            kind: 'pdf',
          },
        }),
        expect.objectContaining({
          id: 'evidence-resolve',
          toolArgs: {
            maxContextTokens: 1200,
          },
        }),
      ]),
    );
  });

  it('falls back to defaults when a custom plan misses core steps or unsupported tools', () => {
    const plan = normalizeResearchAgentPlan({
      planSteps: [
        {
          id: 'context-pack',
          title: 'Collect context',
          description: 'Collect the task context.',
          toolName: 'not-a-tool',
        },
      ],
      context: {
        includeDraftStep: true,
        includeCompactionStep: false,
      },
    });

    expect(plan.source).toBe('fallback');
    expect(plan.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('unsupported tool'),
        expect.stringContaining('evidence-resolve'),
        expect.stringContaining('synthesize-answer'),
      ]),
    );
    expect(plan.steps).toEqual([
      expect.objectContaining({ id: 'context-pack' }),
      expect.objectContaining({ id: 'evidence-resolve' }),
      expect.objectContaining({ id: 'synthesize-answer' }),
      expect.objectContaining({ id: 'create-draft' }),
    ]);
    expect(plan.steps.map((step) => step.id)).not.toContain('compact-session');
  });

  it('falls back when planner output tries to attach tool args to gated tools', () => {
    const plan = normalizeResearchAgentPlan({
      planSteps: [
        {
          id: 'context-pack',
          title: 'Collect context',
          description: 'Collect the task context.',
        },
        {
          id: 'evidence-resolve',
          title: 'Resolve evidence',
          description: 'Resolve citations.',
          toolName: 'evidence.resolve',
        },
        {
          id: 'create-draft',
          title: 'Create draft',
          description: 'Create a draft.',
          toolName: 'workbench.createDraft',
          toolArgs: {
            draft: {
              title: 'Unsafe direct draft',
            },
          },
        },
        {
          id: 'synthesize-answer',
          title: 'Write synthesis',
          description: 'Write the answer.',
        },
      ],
    });

    expect(plan.source).toBe('fallback');
    expect(plan.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('workbench.createDraft toolArgs are not accepted'),
      ]),
    );
  });

  it('sanitizes scheduled task steps without allowing unsafe schedules', () => {
    const plan = normalizeResearchAgentPlan({
      planSteps: [
        { id: 'context-pack', title: 'Collect context', description: 'Collect context.' },
        { id: 'evidence-resolve', title: 'Resolve evidence', description: 'Resolve evidence.' },
        { id: 'schedule', title: 'Schedule follow-up', description: 'Schedule an approved follow-up.', toolName: 'schedule_task', toolArgs: { title: 'Daily digest', prompt: 'Summarize evidence', schedule: { kind: 'interval', everyMs: 60000 } } },
        { id: 'synthesize-answer', title: 'Write answer', description: 'Write the answer.' },
      ],
    });

    expect(plan.source).toBe('custom');
    expect(plan.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'schedule',
        toolName: 'schedule_task',
        toolArgs: { title: 'Daily digest', prompt: 'Summarize evidence', schedule: { kind: 'interval', everyMs: 60000 } },
      }),
    ]));
  });

  it('updates a single step status without mutating the original plan', () => {
    const steps = buildDefaultResearchAgentPlanSteps();
    const updated = updateResearchAgentPlanStepStatus(steps, 'evidence-resolve', 'completed');

    expect(steps.find((step) => step.id === 'evidence-resolve')?.status).toBe('pending');
    expect(updated.find((step) => step.id === 'evidence-resolve')?.status).toBe('completed');
  });
});
