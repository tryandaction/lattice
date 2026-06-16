import type { AgentToolName } from './agent-tool-broker';

export type AgentErrorCategory =
  | 'planner'
  | 'context'
  | 'tool'
  | 'approval'
  | 'provider'
  | 'policy'
  | 'storage'
  | 'cancelled'
  | 'unknown';

export interface AgentErrorDiagnostic {
  category: AgentErrorCategory;
  stage: string;
  message: string;
  recoveryHint: string;
  toolName?: AgentToolName | string;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || 'Unknown agent error.');
}

export function classifyAgentError(input: {
  error: unknown;
  stage: string;
  toolName?: AgentToolName | string;
  category?: AgentErrorCategory;
}): AgentErrorDiagnostic {
  const message = normalizeErrorMessage(input.error);
  const text = `${input.stage} ${input.toolName ?? ''} ${message}`.toLowerCase();
  let category: AgentErrorCategory = input.category ?? 'unknown';

  if (!input.category) {
    if (/abort|cancel/.test(text)) {
      category = 'cancelled';
    } else if (/approval|requires user approval|rejected/.test(text)) {
      category = 'approval';
    } else if (/denied|policy|capability/.test(text)) {
      category = 'policy';
    } else if (/provider|model|llm|offline|rate limit|timeout|api/.test(text)) {
      category = 'provider';
    } else if (/planner|plan|json|schema/.test(text)) {
      category = 'planner';
    } else if (/context|evidence|index|readindexedcontext|workspace\.search|omitted/.test(text)) {
      category = 'context';
    } else if (/storage|persist|indexeddb|localstorage|save|write/.test(text)) {
      category = 'storage';
    } else if (input.toolName || /tool|runner|code|workbench|memory\.write/.test(text)) {
      category = 'tool';
    }
  }

  return {
    category,
    stage: input.stage,
    message,
    recoveryHint: recoveryHintForCategory(category),
    toolName: input.toolName,
  };
}

export function agentErrorMetadata(diagnostic: AgentErrorDiagnostic): Record<string, string | null> {
  return {
    errorCategory: diagnostic.category,
    errorStage: diagnostic.stage,
    errorToolName: diagnostic.toolName ?? null,
    errorRecoveryHint: diagnostic.recoveryHint,
  };
}

function recoveryHintForCategory(category: AgentErrorCategory): string {
  switch (category) {
    case 'planner':
      return 'Use the fallback plan, simplify the task, or inspect planner prompt and raw output.';
    case 'context':
      return 'Check context pack sources, evidence refs, workspace index, and omitted-context recovery hints.';
    case 'tool':
      return 'Inspect the tool contract, arguments, result preview, and retry with narrower inputs.';
    case 'approval':
      return 'Review pending approval status and resume only after the gated request is completed.';
    case 'provider':
      return 'Check AI provider availability, model routing, credentials, and retry with fallback generation.';
    case 'policy':
      return 'Confirm the agent profile allows this capability or route through an approval-gated workflow.';
    case 'storage':
      return 'Check local persistence, Workbench or Memory store state, and retry after saving workspace state.';
    case 'cancelled':
      return 'The run was cancelled; start a new focused run when ready.';
    case 'unknown':
      return 'Inspect trace metadata and logs, then retry with a narrower task.';
  }
}
