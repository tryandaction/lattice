export type AgentComposerMode = 'chat' | 'agent';
export type AgentComposerEffort = 'low' | 'medium' | 'high';
export type AgentComposerContextBudgetProfileId = 'chat' | 'research';

export interface AgentComposerEffortConfig {
  maxObservationReplans: number;
  maxReadToolSteps: number;
  contextBudgetProfileId?: AgentComposerContextBudgetProfileId;
}

export interface AgentComposerViewModelInput {
  mode: AgentComposerMode;
  effort: AgentComposerEffort;
  inputText: string;
  isGenerating: boolean;
  selectedWorkflowLabel?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  autoModelLabel: string;
  autoWorkflowLabel: string;
  advancedOpen: boolean;
  suggestMemory: boolean;
}

export interface AgentComposerViewModel {
  mode: AgentComposerMode;
  isAgentMode: boolean;
  canSubmit: boolean;
  submitIntent: 'chat' | 'agent';
  modelLabel: string;
  workflowLabel: string;
  workflowSelectionMode: 'auto' | 'explicit';
  canClearWorkflow: boolean;
  advancedOpen: boolean;
  suggestMemory: boolean;
  effort: AgentComposerEffort;
  effortConfig: AgentComposerEffortConfig;
}

export function getAgentComposerEffortConfig(
  effort: AgentComposerEffort,
  hasExplicitWorkflow = false,
): AgentComposerEffortConfig {
  switch (effort) {
    case 'low':
      return {
        maxObservationReplans: 0,
        maxReadToolSteps: 3,
        contextBudgetProfileId: 'chat',
      };
    case 'high':
      return {
        maxObservationReplans: 2,
        maxReadToolSteps: 8,
        ...(hasExplicitWorkflow ? {} : { contextBudgetProfileId: 'research' as const }),
      };
    default:
      return {
        maxObservationReplans: 1,
        maxReadToolSteps: 5,
      };
  }
}

export function buildAgentComposerViewModel(input: AgentComposerViewModelInput): AgentComposerViewModel {
  const trimmedInput = input.inputText.trim();
  const isAgentMode = input.mode === 'agent';
  const selectedWorkflowLabel = input.selectedWorkflowLabel?.trim() || '';
  const modelLabel = [
    input.providerId?.trim() || input.autoModelLabel,
    input.modelId?.trim() || null,
  ].filter(Boolean).join(' / ');

  return {
    mode: input.mode,
    isAgentMode,
    canSubmit: Boolean(trimmedInput) && !input.isGenerating,
    submitIntent: isAgentMode ? 'agent' : 'chat',
    modelLabel,
    workflowLabel: selectedWorkflowLabel || input.autoWorkflowLabel,
    workflowSelectionMode: selectedWorkflowLabel ? 'explicit' : 'auto',
    canClearWorkflow: Boolean(selectedWorkflowLabel),
    advancedOpen: isAgentMode && input.advancedOpen,
    suggestMemory: input.suggestMemory,
    effort: input.effort,
    effortConfig: getAgentComposerEffortConfig(input.effort, Boolean(selectedWorkflowLabel)),
  };
}
