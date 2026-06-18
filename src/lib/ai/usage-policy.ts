import type { AppSettings } from '@/types/settings';
import { estimateCost, estimateTokens } from './token-estimator';
import type { AiMessage } from './types';

export type AiUsageCategory =
  | 'manual-chat'
  | 'manual-selection'
  | 'manual-agent'
  | 'automatic-inline-completion'
  | 'automatic-agent-omitted-summary'
  | 'plugin-initiated';

export interface AiUsageEstimate {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedUsd: number;
}

export interface AiUsageDecision {
  allowed: boolean;
  reason: string | null;
  estimate: AiUsageEstimate;
}

export interface AiUsagePolicyInput {
  category: AiUsageCategory;
  settings: Pick<AppSettings, 'aiEnabled' | 'aiInlineCompletionEnabled' | 'aiAgentOmittedSummaryEnabled' | 'aiModel'>;
  inputText?: string;
  messages?: AiMessage[];
  maxOutputTokens?: number;
}

function messageToText(message: AiMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n');
}

export function estimateAiUsage(input: {
  inputText?: string;
  messages?: AiMessage[];
  maxOutputTokens?: number;
  model?: string | null;
}): AiUsageEstimate {
  const text = [
    input.inputText,
    ...(input.messages ?? []).map(messageToText),
  ].filter((value): value is string => Boolean(value)).join('\n\n');
  const inputTokens = estimateTokens(text, input.model ?? undefined);
  const outputTokens = Math.max(0, input.maxOutputTokens ?? 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedUsd: estimateCost(inputTokens, outputTokens, input.model ?? 'gpt-4.1-mini'),
  };
}

export function evaluateAiUsagePolicy(input: AiUsagePolicyInput): AiUsageDecision {
  const estimate = estimateAiUsage({
    inputText: input.inputText,
    messages: input.messages,
    maxOutputTokens: input.maxOutputTokens,
    model: input.settings.aiModel,
  });

  if (!input.settings.aiEnabled) {
    return { allowed: false, reason: 'AI is disabled in settings.', estimate };
  }

  if (input.category === 'automatic-inline-completion' && !input.settings.aiInlineCompletionEnabled) {
    return { allowed: false, reason: 'Inline AI completion is disabled in settings.', estimate };
  }

  if (input.category === 'automatic-agent-omitted-summary' && !input.settings.aiAgentOmittedSummaryEnabled) {
    return { allowed: false, reason: 'Agent omitted-context model summary is disabled in settings.', estimate };
  }

  return { allowed: true, reason: null, estimate };
}

