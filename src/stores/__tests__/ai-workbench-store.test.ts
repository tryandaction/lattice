import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = {
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
};

vi.mock('@/lib/storage-adapter', () => ({
  getStorageAdapter: () => storage,
}));

import { useAiWorkbenchStore } from '../ai-workbench-store';
import type { AiTaskProposal } from '@/lib/ai/types';

function waitForSave(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 700));
}

function createProposal(overrides: Partial<AiTaskProposal> = {}): AiTaskProposal {
  return {
    id: 'proposal-1',
    summary: '整理实验结论',
    steps: [
      { id: 'step-1', title: 'Review notes', description: 'Inspect this week notes.' },
    ],
    requiredApprovals: ['Confirm target path'],
    plannedWrites: [
      {
        targetPath: 'Research/weekly.md',
        mode: 'append',
        contentPreview: 'Append the weekly summary.',
      },
    ],
    sourceRefs: [],
    status: 'pending',
    confirmedApprovals: [],
    approvedWrites: ['Research/weekly.md'],
    generatedDraftTargets: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('ai-workbench-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAiWorkbenchStore.setState({
      drafts: [],
      proposals: [],
    });
  });

  it('stores proposals with normalized approval defaults', () => {
    useAiWorkbenchStore.getState().addProposal(createProposal({
      approvedWrites: [],
      confirmedApprovals: [],
    }));

    const proposal = useAiWorkbenchStore.getState().getProposal('proposal-1');
    expect(proposal?.status).toBe('pending');
    expect(proposal?.approvedWrites).toEqual([]);
  });

  it('toggles proposal approvals and write selections', () => {
    useAiWorkbenchStore.getState().addProposal(createProposal());

    useAiWorkbenchStore.getState().toggleProposalApproval('proposal-1', 'Confirm target path');
    useAiWorkbenchStore.getState().toggleProposalWriteSelection('proposal-1', 'Research/weekly.md');

    const proposal = useAiWorkbenchStore.getState().getProposal('proposal-1');
    expect(proposal?.confirmedApprovals).toEqual(['Confirm target path']);
    expect(proposal?.approvedWrites).toEqual([]);
  });

  it('tracks generated draft targets for a proposal', () => {
    useAiWorkbenchStore.getState().addProposal(createProposal());

    useAiWorkbenchStore.getState().markProposalDraftTargets('proposal-1', [
      'Research/weekly.md',
      'Research/weekly.md',
    ]);

    const proposal = useAiWorkbenchStore.getState().getProposal('proposal-1');
    expect(proposal?.generatedDraftTargets).toEqual(['Research/weekly.md']);
  });

  it('persists drafts and proposals through storage adapter', async () => {
    storage.get.mockResolvedValue(null);

    useAiWorkbenchStore.getState().createDraft({
      type: 'task_plan',
      title: 'Plan Draft',
      sourceRefs: [],
      content: 'Plan content',
      writeMode: 'create',
    });
    useAiWorkbenchStore.getState().addProposal(createProposal());

    await waitForSave();

    expect(storage.set).toHaveBeenCalledWith(
      'lattice-ai-workbench',
      expect.objectContaining({
        drafts: expect.arrayContaining([
          expect.objectContaining({ title: 'Plan Draft' }),
        ]),
        proposals: expect.arrayContaining([
          expect.objectContaining({ id: 'proposal-1' }),
        ]),
      }),
    );
  });

  it('loads persisted workbench state from storage', async () => {
    storage.get.mockResolvedValue({
      drafts: [
        {
          id: 'draft-1',
          type: 'task_plan',
          title: 'Loaded Draft',
          sourceRefs: [],
          content: 'Loaded content',
          status: 'draft',
          createdAt: 1,
          writeMode: 'create',
        },
      ],
      proposals: [
        createProposal({
          id: 'proposal-loaded',
          confirmedApprovals: [],
          approvedWrites: [],
        }),
      ],
    });

    await useAiWorkbenchStore.getState().loadWorkbench();

    expect(useAiWorkbenchStore.getState().drafts).toHaveLength(1);
    expect(useAiWorkbenchStore.getState().proposals[0]?.id).toBe('proposal-loaded');
  });
});
