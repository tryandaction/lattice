import { create } from 'zustand';
import type {
  AiDraftArtifact,
  AiDraftArtifactStatus,
  AiDraftWriteMode,
  AiTaskProposal,
  AiTaskProposalStatus,
} from '@/lib/ai/types';
import { getStorageAdapter } from '@/lib/storage-adapter';

const AI_WORKBENCH_STORAGE_KEY = 'lattice-ai-workbench';

interface AiWorkbenchState {
  drafts: AiDraftArtifact[];
  proposals: AiTaskProposal[];
  highlightedProposalId: string | null;
}

interface AiWorkbenchActions {
  createDraft: (draft: Omit<AiDraftArtifact, 'id' | 'createdAt' | 'status'>) => string;
  updateDraftStatus: (draftId: string, status: AiDraftArtifactStatus) => void;
  updateDraftWriteConfig: (
    draftId: string,
    config: { targetPath?: string; writeMode?: AiDraftWriteMode }
  ) => void;
  markDraftApplied: (draftId: string, targetPath: string, writeMode?: AiDraftWriteMode) => void;
  addProposal: (proposal: AiTaskProposal) => void;
  updateProposalStatus: (proposalId: string, status: AiTaskProposalStatus) => void;
  toggleProposalApproval: (proposalId: string, approval: string) => void;
  toggleProposalWriteSelection: (proposalId: string, targetPath: string) => void;
  markProposalDraftTargets: (proposalId: string, targetPaths: string[]) => void;
  clearProposal: (proposalId: string) => void;
  clearHighlightedProposal: () => void;
  getDraft: (draftId: string) => AiDraftArtifact | null;
  getProposal: (proposalId: string) => AiTaskProposal | null;
  getDraftsForProposal: (proposalId: string) => AiDraftArtifact[];
  getStandaloneDrafts: () => AiDraftArtifact[];
  loadWorkbench: () => Promise<void>;
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function normalizeProposal(proposal: AiTaskProposal): AiTaskProposal {
  return {
    ...proposal,
    sourceRefs: proposal.sourceRefs ?? [],
    status: proposal.status ?? 'pending',
    confirmedApprovals: proposal.confirmedApprovals ?? [],
    approvedWrites: proposal.approvedWrites ?? proposal.plannedWrites.map((write) => write.targetPath),
    generatedDraftTargets: proposal.generatedDraftTargets ?? [],
  };
}

function debouncedSave(state: Pick<AiWorkbenchState, 'drafts' | 'proposals'>) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const storage = getStorageAdapter();
      await storage.set(AI_WORKBENCH_STORAGE_KEY, {
        drafts: state.drafts,
        proposals: state.proposals,
      });
    } catch (error) {
      console.error('Failed to save AI workbench state:', error);
    }
  }, 500);
}

export const useAiWorkbenchStore = create<AiWorkbenchState & AiWorkbenchActions>((set, get) => ({
  drafts: [],
  proposals: [],
  highlightedProposalId: null,

  createDraft: (draft) => {
    const id = generateId('draft');
    set((state) => ({
      drafts: [
        {
          ...draft,
          id,
          createdAt: Date.now(),
          status: 'draft',
          writeMode: draft.writeMode ?? 'create',
        },
        ...state.drafts,
      ],
    }));
    debouncedSave({
      drafts: get().drafts,
      proposals: get().proposals,
    });
    return id;
  },

  updateDraftStatus: (draftId, status) => {
    set((state) => ({
      drafts: state.drafts.map((draft) =>
        draft.id === draftId ? { ...draft, status } : draft
      ),
    }));
    debouncedSave({
      drafts: get().drafts,
      proposals: get().proposals,
    });
  },

  updateDraftWriteConfig: (draftId, config) => {
    set((state) => ({
      drafts: state.drafts.map((draft) =>
        draft.id === draftId
          ? {
              ...draft,
              ...(config.targetPath !== undefined ? { targetPath: config.targetPath } : {}),
              ...(config.writeMode !== undefined ? { writeMode: config.writeMode } : {}),
            }
          : draft
      ),
    }));
    debouncedSave({
      drafts: get().drafts,
      proposals: get().proposals,
    });
  },

  markDraftApplied: (draftId, targetPath, writeMode = 'create') => {
    set((state) => ({
      drafts: state.drafts.map((draft) =>
        draft.id === draftId
          ? { ...draft, status: 'applied', targetPath, writeMode }
          : draft
      ),
    }));
    debouncedSave({
      drafts: get().drafts,
      proposals: get().proposals,
    });
  },

  addProposal: (proposal) => {
    const normalized = normalizeProposal(proposal);
    set((state) => ({
      proposals: [normalized, ...state.proposals.filter((item) => item.id !== normalized.id)],
      highlightedProposalId: normalized.origin?.kind === 'selection-ai' && normalized.origin.mode === 'plan'
        ? normalized.id
        : state.highlightedProposalId,
    }));
    debouncedSave({
      drafts: get().drafts,
      proposals: get().proposals,
    });
  },

  updateProposalStatus: (proposalId, status) => {
    set((state) => ({
      proposals: state.proposals.map((proposal) =>
        proposal.id === proposalId ? { ...proposal, status } : proposal
      ),
    }));
    debouncedSave({
      drafts: get().drafts,
      proposals: get().proposals,
    });
  },

  toggleProposalApproval: (proposalId, approval) => {
    set((state) => ({
      proposals: state.proposals.map((proposal) => {
        if (proposal.id !== proposalId) {
          return proposal;
        }
        const exists = proposal.confirmedApprovals.includes(approval);
        return {
          ...proposal,
          confirmedApprovals: exists
            ? proposal.confirmedApprovals.filter((item) => item !== approval)
            : [...proposal.confirmedApprovals, approval],
        };
      }),
    }));
    debouncedSave({
      drafts: get().drafts,
      proposals: get().proposals,
    });
  },

  toggleProposalWriteSelection: (proposalId, targetPath) => {
    set((state) => ({
      proposals: state.proposals.map((proposal) => {
        if (proposal.id !== proposalId) {
          return proposal;
        }
        const exists = proposal.approvedWrites.includes(targetPath);
        return {
          ...proposal,
          approvedWrites: exists
            ? proposal.approvedWrites.filter((item) => item !== targetPath)
            : [...proposal.approvedWrites, targetPath],
        };
      }),
    }));
    debouncedSave({
      drafts: get().drafts,
      proposals: get().proposals,
    });
  },

  markProposalDraftTargets: (proposalId, targetPaths) => {
    set((state) => ({
      proposals: state.proposals.map((proposal) => {
        if (proposal.id !== proposalId) {
          return proposal;
        }
        const mergedTargets = new Set([
          ...proposal.generatedDraftTargets,
          ...targetPaths,
        ]);
        return {
          ...proposal,
          generatedDraftTargets: Array.from(mergedTargets),
        };
      }),
    }));
    debouncedSave({
      drafts: get().drafts,
      proposals: get().proposals,
    });
  },

  clearProposal: (proposalId) => {
    set((state) => ({
      proposals: state.proposals.filter((proposal) => proposal.id !== proposalId),
      highlightedProposalId: state.highlightedProposalId === proposalId ? null : state.highlightedProposalId,
    }));
    debouncedSave({
      drafts: get().drafts,
      proposals: get().proposals,
    });
  },

  clearHighlightedProposal: () => {
    set({ highlightedProposalId: null });
  },

  getDraft: (draftId) => get().drafts.find((draft) => draft.id === draftId) ?? null,

  getProposal: (proposalId) => get().proposals.find((proposal) => proposal.id === proposalId) ?? null,

  getDraftsForProposal: (proposalId) =>
    get().drafts.filter((draft) => draft.originProposalId === proposalId),

  getStandaloneDrafts: () =>
    get().drafts.filter((draft) => !draft.originProposalId),

  loadWorkbench: async () => {
    try {
      const storage = getStorageAdapter();
      const saved = await storage.get<AiWorkbenchState>(AI_WORKBENCH_STORAGE_KEY);
      if (!saved) {
        return;
      }
      set({
        drafts: saved.drafts ?? [],
        proposals: (saved.proposals ?? []).map(normalizeProposal),
        highlightedProposalId: null,
      });
    } catch (error) {
      console.error('Failed to load AI workbench state:', error);
    }
  },
}));
