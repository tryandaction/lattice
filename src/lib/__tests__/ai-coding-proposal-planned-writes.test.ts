import { describe, expect, it } from 'vitest';
import {
  buildLatticeCodingProposalPlannedWrites,
  isLikelyCodingProposal,
} from '../ai/lattice-skills/coding-proposal-planned-writes';
import type { AiTaskProposalStep, EvidenceRef } from '../ai/types';

const steps: AiTaskProposalStep[] = [
  {
    id: 'step-1',
    title: 'Review target component',
    description: 'Inspect the component and identify the smallest safe patch.',
  },
];

const evidenceRefs: EvidenceRef[] = [
  {
    kind: 'code_line',
    label: 'src/components/panel.tsx:42',
    locator: 'src/components/panel.tsx#L42',
    preview: 'const state = buildPanelState(input);',
  },
];

describe('coding proposal planned writes', () => {
  it('builds a code review fallback artifact with target files, risks, tests, and approval path', () => {
    const writes = buildLatticeCodingProposalPlannedWrites({
      prompt: 'Create a code review patch plan for src/components/panel.tsx',
      summary: 'Panel state patch',
      steps,
      evidenceRefs,
      filePath: 'src/components/panel.tsx',
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      targetPath: 'AI Drafts/Panel state patch Code Review Plan.md',
      mode: 'create',
    });
    expect(writes[0]?.contentPreview).toContain('Target files:');
    expect(writes[0]?.contentPreview).toContain('- src/components/panel.tsx');
    expect(writes[0]?.contentPreview).toContain('Patch preview:');
    expect(writes[0]?.contentPreview).toContain('Risks:');
    expect(writes[0]?.contentPreview).toContain('Test plan:');
    expect(writes[0]?.contentPreview).toContain('Allowed QA commands:');
    expect(writes[0]?.contentPreview).toContain('Suggested QA commands:');
    expect(writes[0]?.contentPreview).toContain('npm run typecheck');
    expect(writes[0]?.contentPreview).toContain('Approval path:');
    expect(writes[0]?.contentPreview).toContain('src/components/panel.tsx#L42');
  });

  it('keeps safe requested patch targets and filters unsafe paths', () => {
    const writes = buildLatticeCodingProposalPlannedWrites({
      requestedWrites: [
        {
          targetPath: 'src/lib/panel-state.ts',
          mode: 'update',
          contentPreview: 'Patch preview for panel-state.',
        },
        {
          targetPath: 'C:/Users/me/secret.ts',
          mode: 'update',
          contentPreview: 'unsafe absolute path',
        },
        {
          targetPath: '../escape.ts',
          mode: 'create',
          contentPreview: 'unsafe traversal',
        },
      ],
      prompt: 'Plan a patch',
      summary: 'Panel state patch',
      steps,
      evidenceRefs,
    });

    expect(writes).toEqual([
      {
        targetPath: 'src/lib/panel-state.ts',
        mode: 'update',
        contentPreview: 'Patch preview for panel-state.',
      },
    ]);
  });

  it('detects coding proposals from workflow cues, paths, and code-review language', () => {
    expect(isLikelyCodingProposal({
      prompt: 'Workflow: Code Change Plan\nReview this patch',
      summary: 'Patch plan',
    })).toBe(true);
    expect(isLikelyCodingProposal({
      prompt: 'Organize notes',
      summary: 'Knowledge organization',
      filePath: 'src/lib/agent.ts',
    })).toBe(true);
    expect(isLikelyCodingProposal({
      prompt: 'Organize research notes',
      summary: 'Knowledge organization',
      filePath: 'notes/alpha.md',
    })).toBe(false);
  });

  it('keeps dangerous requested commands in the rejected QA plan', () => {
    const writes = buildLatticeCodingProposalPlannedWrites({
      prompt: [
        'Review src/lib/agent.ts.',
        'Requested verification: npm run typecheck',
        'Also run git reset --hard',
      ].join('\n'),
      summary: 'Agent patch review',
      steps,
      evidenceRefs,
      filePath: 'src/lib/agent.ts',
    });

    expect(writes[0]?.contentPreview).toContain('Allowed QA commands:');
    expect(writes[0]?.contentPreview).toContain('- npm run typecheck');
    expect(writes[0]?.contentPreview).toContain('Rejected / deferred commands:');
    expect(writes[0]?.contentPreview).toContain('- git reset --hard');
    expect(writes[0]?.contentPreview).toContain('outside the coding QA allowlist');
  });

  it('rejects chained QA command lines without allowing the safe-looking prefix', () => {
    const writes = buildLatticeCodingProposalPlannedWrites({
      prompt: [
        'Review src/lib/agent.ts.',
        'Verification: npm run typecheck && git reset --hard',
      ].join('\n'),
      summary: 'Agent chained command review',
      steps,
      evidenceRefs,
      filePath: 'src/lib/agent.ts',
    });

    const preview = writes[0]?.contentPreview ?? '';

    expect(preview).toContain('Allowed QA commands:');
    expect(preview).toContain('- No user-requested QA commands matched the allowlist.');
    expect(preview).toContain('Rejected / deferred commands:');
    expect(preview).toContain('- npm run typecheck && git reset --hard');
    expect(preview).toContain('outside the coding QA allowlist');
  });
});
