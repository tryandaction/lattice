import { describe, expect, it } from 'vitest';
import {
  buildLatticeProposalPlannedWrites,
  getApprovedPlannedWriteTargets,
} from '../ai/lattice-skills/proposal-planned-writes';
import type { AiTaskProposalStep, EvidenceRef } from '../ai/types';

const steps: AiTaskProposalStep[] = [
  {
    id: 'step-1',
    title: 'Review related notes',
    description: 'Inspect the current evidence and identify safe write targets.',
  },
];

const evidenceRefs: EvidenceRef[] = [
  {
    kind: 'heading',
    label: 'notes/alpha.md#Results',
    locator: 'notes/alpha.md#Results',
  },
];

describe('proposal planned writes planner', () => {
  it('keeps valid model planned writes and fills missing content previews from evidence', () => {
    const writes = buildLatticeProposalPlannedWrites({
      requestedWrites: [
        {
          targetPath: './Research//alpha-plan.md',
          mode: 'append',
        },
      ],
      prompt: 'Organize Alpha notes',
      summary: 'Alpha organization plan',
      steps,
      evidenceRefs,
    });

    expect(writes).toEqual([
      {
        targetPath: 'Research/alpha-plan.md',
        mode: 'append',
        contentPreview: expect.stringContaining('Proposal: Alpha organization plan'),
      },
    ]);
    expect(writes[0]?.contentPreview).toContain('notes/alpha.md#Results');
  });

  it('filters unsafe planned write targets and falls back to an AI Drafts proposal plan', () => {
    const writes = buildLatticeProposalPlannedWrites({
      requestedWrites: [
        {
          targetPath: 'C:/Users/me/notes.md',
          mode: 'update',
          contentPreview: 'unsafe absolute path',
        },
        {
          targetPath: '../escape.md',
          mode: 'create',
          contentPreview: 'unsafe traversal',
        },
      ],
      prompt: 'Organize unsafe targets',
      summary: 'Unsafe target review',
      steps,
      evidenceRefs,
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      targetPath: 'AI Drafts/Unsafe target review Plan.md',
      mode: 'create',
    });
    expect(writes[0]?.contentPreview).toContain('Planned review steps:');
  });

  it('builds approved write targets from normalized writes', () => {
    const writes = buildLatticeProposalPlannedWrites({
      requestedWrites: [
        {
          targetPath: 'Research/alpha.md',
          mode: 'create',
          contentPreview: 'Create Alpha note.',
        },
        {
          targetPath: 'Research/beta.md',
          mode: 'append',
          contentPreview: 'Append Beta note.',
        },
      ],
      prompt: 'Create notes',
      summary: 'Create notes',
      steps,
      evidenceRefs,
    });

    expect(getApprovedPlannedWriteTargets(writes)).toEqual([
      'Research/alpha.md',
      'Research/beta.md',
    ]);
  });
});
