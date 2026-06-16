import type { AgentContextPackBudget } from './agent-context-pack';

export type AgentContextBudgetProfileId =
  | 'chat'
  | 'research'
  | 'notebook'
  | 'code'
  | 'knowledge-organization';

export interface AgentContextBudgetProfile {
  id: AgentContextBudgetProfileId;
  title: string;
  description: string;
  budget: AgentContextPackBudget;
}

export const AGENT_CONTEXT_BUDGET_PROFILES: Record<AgentContextBudgetProfileId, AgentContextBudgetProfile> = {
  chat: {
    id: 'chat',
    title: 'Chat',
    description: 'Short interactive answers with local evidence and restrained memory.',
    budget: {
      maxTokens: 3200,
      bySource: {
        explicit_evidence: 800,
        selection: 900,
        active_file: 900,
        workspace_chunk: 700,
        memory: 500,
        heavy_input: 500,
      },
    },
  },
  research: {
    id: 'research',
    title: 'Research',
    description: 'Evidence-backed research synthesis with the current stable production budget.',
    budget: {
      maxTokens: 4000,
      bySource: {
        explicit_evidence: 700,
        selection: 900,
        active_file: 1200,
        workspace_chunk: 1200,
        memory: 900,
        heavy_input: 800,
      },
    },
  },
  notebook: {
    id: 'notebook',
    title: 'Notebook',
    description: 'Notebook interpretation with more room for cells, outputs, and experiment context.',
    budget: {
      maxTokens: 5200,
      bySource: {
        explicit_evidence: 800,
        selection: 1000,
        active_file: 1500,
        workspace_chunk: 1700,
        memory: 800,
        heavy_input: 1400,
      },
    },
  },
  code: {
    id: 'code',
    title: 'Code',
    description: 'Implementation-oriented context that prioritizes active files and nearby indexed code.',
    budget: {
      maxTokens: 5000,
      bySource: {
        explicit_evidence: 600,
        selection: 900,
        active_file: 1800,
        workspace_chunk: 1800,
        memory: 600,
        heavy_input: 1200,
      },
    },
  },
  'knowledge-organization': {
    id: 'knowledge-organization',
    title: 'Knowledge Organization',
    description: 'Workspace organization and literature comparison with broader index and memory context.',
    budget: {
      maxTokens: 6000,
      bySource: {
        explicit_evidence: 900,
        selection: 1000,
        active_file: 1400,
        workspace_chunk: 2400,
        memory: 1200,
        heavy_input: 1000,
      },
    },
  },
};

export function getAgentContextBudgetProfile(
  id: AgentContextBudgetProfileId = 'research',
): AgentContextBudgetProfile {
  return AGENT_CONTEXT_BUDGET_PROFILES[id] ?? AGENT_CONTEXT_BUDGET_PROFILES.research;
}

export function resolveAgentContextBudget(input: {
  profileId?: AgentContextBudgetProfileId;
  override?: AgentContextPackBudget;
} = {}): AgentContextPackBudget {
  return input.override ?? getAgentContextBudgetProfile(input.profileId).budget;
}
