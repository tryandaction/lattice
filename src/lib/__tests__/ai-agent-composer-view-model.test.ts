import { describe, expect, it } from 'vitest';
import {
  buildAgentComposerViewModel,
  getAgentComposerEffortConfig,
} from '@/lib/ai/agent-composer-view-model';

describe('agent composer view model', () => {
  it('maps effort levels to bounded Research Agent runtime controls', () => {
    expect(getAgentComposerEffortConfig('low')).toEqual({
      maxObservationReplans: 0,
      maxReadToolSteps: 3,
      contextBudgetProfileId: 'chat',
    });
    expect(getAgentComposerEffortConfig('medium')).toEqual({
      maxObservationReplans: 1,
      maxReadToolSteps: 5,
    });
    expect(getAgentComposerEffortConfig('high')).toEqual({
      maxObservationReplans: 2,
      maxReadToolSteps: 8,
      contextBudgetProfileId: 'research',
    });
    expect(getAgentComposerEffortConfig('high', true)).toEqual({
      maxObservationReplans: 2,
      maxReadToolSteps: 8,
    });
  });

  it('builds compact chat-mode state without exposing agent-only advanced controls', () => {
    const view = buildAgentComposerViewModel({
      mode: 'chat',
      effort: 'medium',
      inputText: ' Explain Alpha ',
      isGenerating: false,
      selectedWorkflowLabel: null,
      providerId: null,
      modelId: null,
      autoModelLabel: 'Auto model',
      autoWorkflowLabel: 'Auto',
      advancedOpen: true,
      suggestMemory: true,
    });

    expect(view).toMatchObject({
      isAgentMode: false,
      canSubmit: true,
      submitIntent: 'chat',
      modelLabel: 'Auto model',
      workflowLabel: 'Auto',
      workflowSelectionMode: 'auto',
      canClearWorkflow: false,
      advancedOpen: false,
    });
  });

  it('builds agent-mode state with explicit model, workflow, and submit gating', () => {
    const view = buildAgentComposerViewModel({
      mode: 'agent',
      effort: 'high',
      inputText: 'Organize notes',
      isGenerating: false,
      selectedWorkflowLabel: 'Knowledge Organization',
      providerId: 'openai',
      modelId: 'gpt-test',
      autoModelLabel: 'Auto model',
      autoWorkflowLabel: 'Auto',
      advancedOpen: true,
      suggestMemory: false,
    });

    expect(view).toMatchObject({
      isAgentMode: true,
      canSubmit: true,
      submitIntent: 'agent',
      modelLabel: 'openai / gpt-test',
      workflowLabel: 'Knowledge Organization',
      workflowSelectionMode: 'explicit',
      canClearWorkflow: true,
      advancedOpen: true,
      suggestMemory: false,
      effortConfig: {
        maxObservationReplans: 2,
        maxReadToolSteps: 8,
      },
    });
  });

  it('disables submit for empty input or active generation', () => {
    expect(buildAgentComposerViewModel({
      mode: 'agent',
      effort: 'medium',
      inputText: '   ',
      isGenerating: false,
      selectedWorkflowLabel: null,
      providerId: 'openai',
      modelId: null,
      autoModelLabel: 'Auto model',
      autoWorkflowLabel: 'Auto',
      advancedOpen: false,
      suggestMemory: true,
    }).canSubmit).toBe(false);

    expect(buildAgentComposerViewModel({
      mode: 'agent',
      effort: 'medium',
      inputText: 'Explain',
      isGenerating: true,
      selectedWorkflowLabel: null,
      providerId: 'openai',
      modelId: null,
      autoModelLabel: 'Auto model',
      autoWorkflowLabel: 'Auto',
      advancedOpen: false,
      suggestMemory: true,
    }).canSubmit).toBe(false);
  });
});
