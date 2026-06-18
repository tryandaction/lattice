import { describe, expect, it } from 'vitest';
import { buildCodingProposalViewModel } from '../ai/coding-proposal-view-model';
import type { AiTaskProposal } from '../ai/types';

function proposalWithPreview(contentPreview: string): AiTaskProposal {
  return {
    id: 'proposal-coding',
    summary: 'Coding proposal: panel state patch',
    steps: [
      {
        id: 'review',
        title: 'Review target component',
        description: 'Inspect the component before drafting a patch.',
      },
    ],
    requiredApprovals: ['Review patch preview'],
    plannedWrites: [
      {
        targetPath: 'AI Drafts/Panel state patch Code Review Plan.md',
        mode: 'create',
        contentPreview,
      },
    ],
    sourceRefs: [],
    status: 'pending',
    confirmedApprovals: [],
    approvedWrites: [],
    generatedDraftTargets: [],
    createdAt: 100,
  };
}

describe('coding proposal view model', () => {
  it('derives coding review sections from a planned write preview', () => {
    const view = buildCodingProposalViewModel(proposalWithPreview([
      'Coding proposal: panel state patch',
      '',
      'Target files:',
      '- src/components/panel.tsx',
      '- src/lib/panel-state.ts',
      '',
      'Patch preview:',
      '- Draft a minimal diff against panel-state.',
      '',
      'Risks:',
      '- Check API contract changes.',
      '',
      'Test plan:',
      'Allowed QA commands:',
      '- npm run typecheck',
      '  - Status: allowed',
      '',
      'Suggested QA commands:',
      '- npm run qa:agent-smoke -- --unit-only',
      '',
      'Rejected / deferred commands:',
      '- npm run typecheck && git reset --hard',
      '',
      'Execution boundary:',
      '- These are approval-gated command plans only.',
      '',
      'Evidence:',
      '- src/components/panel.tsx',
      '',
      'Approval path:',
      '- Review this Workbench proposal.',
    ].join('\n')));

    expect(view).toMatchObject({
      targetFiles: ['src/components/panel.tsx', 'src/lib/panel-state.ts'],
      patchPreview: ['Draft a minimal diff against panel-state.'],
      risks: ['Check API contract changes.'],
      hasRejectedQaCommands: true,
    });
    expect(view?.qa.allowed).toEqual(['npm run typecheck']);
    expect(view?.qa.suggested).toEqual(['npm run qa:agent-smoke -- --unit-only']);
    expect(view?.qa.rejected).toEqual(['npm run typecheck && git reset --hard']);
    expect(view?.qa.executionBoundary).toEqual(['These are approval-gated command plans only.']);
    expect(view?.approvalPath).toEqual(['Review this Workbench proposal.']);
  });

  it('ignores ordinary non-coding workbench proposals', () => {
    const view = buildCodingProposalViewModel({
      ...proposalWithPreview([
        'Proposal: organize Alpha notes',
        '',
        'Planned review steps:',
        '- Review related notes.',
      ].join('\n')),
      summary: 'Alpha note organization',
      plannedWrites: [
        {
          targetPath: 'AI Drafts/Alpha Plan.md',
          mode: 'create',
          contentPreview: 'Proposal: organize Alpha notes',
        },
      ],
    });

    expect(view).toBeNull();
  });

  it('can identify requested source-file update proposals without full generated sections', () => {
    const view = buildCodingProposalViewModel({
      ...proposalWithPreview('Patch preview for panel-state.'),
      summary: 'Panel state update',
      plannedWrites: [
        {
          targetPath: 'src/lib/panel-state.ts',
          mode: 'update',
          contentPreview: 'Patch preview for panel-state.',
        },
      ],
    });

    expect(view?.targetFiles).toEqual(['src/lib/panel-state.ts']);
    expect(view?.patchPreview).toEqual(['Patch preview for panel-state.']);
  });
});
