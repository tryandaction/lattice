import { describe, expect, it } from 'vitest';

import {
  AGENT_CONTEXT_BUDGET_PROFILES,
  getAgentContextBudgetProfile,
  resolveAgentContextBudget,
} from '../ai/agent-context-budget-profiles';

describe('agent-context-budget-profiles', () => {
  it('defines bounded profiles for the primary agent task modes', () => {
    expect(Object.keys(AGENT_CONTEXT_BUDGET_PROFILES)).toEqual([
      'chat',
      'research',
      'notebook',
      'code',
      'knowledge-organization',
    ]);

    expect(AGENT_CONTEXT_BUDGET_PROFILES.research.budget).toMatchObject({
      maxTokens: 4000,
      bySource: {
        explicit_evidence: 700,
        selection: 900,
        active_file: 1200,
        workspace_chunk: 1200,
        memory: 900,
      },
    });
    expect(AGENT_CONTEXT_BUDGET_PROFILES.notebook.budget.maxTokens).toBeGreaterThan(
      AGENT_CONTEXT_BUDGET_PROFILES.research.budget.maxTokens,
    );
    expect(AGENT_CONTEXT_BUDGET_PROFILES['knowledge-organization'].budget.bySource.workspace_chunk)
      .toBeGreaterThan(AGENT_CONTEXT_BUDGET_PROFILES.research.budget.bySource.workspace_chunk ?? 0);
  });

  it('resolves profile budgets and preserves explicit overrides', () => {
    expect(getAgentContextBudgetProfile().id).toBe('research');
    expect(resolveAgentContextBudget({ profileId: 'chat' })).toBe(AGENT_CONTEXT_BUDGET_PROFILES.chat.budget);

    const override = {
      maxTokens: 1234,
      bySource: {
        memory: 321,
      },
    };
    expect(resolveAgentContextBudget({ profileId: 'notebook', override })).toBe(override);
  });
});
