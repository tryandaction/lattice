import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { evaluateAiUsagePolicy } from '../ai/usage-policy';

describe('ai usage policy', () => {
  it('blocks all AI usage when the global AI switch is disabled', () => {
    const decision = evaluateAiUsagePolicy({
      category: 'manual-chat',
      settings: DEFAULT_SETTINGS,
      inputText: 'hello',
      maxOutputTokens: 100,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('AI is disabled');
    expect(decision.estimate.totalTokens).toBeGreaterThan(0);
  });

  it('blocks automatic inline completion unless explicitly enabled', () => {
    const decision = evaluateAiUsagePolicy({
      category: 'automatic-inline-completion',
      settings: {
        ...DEFAULT_SETTINGS,
        aiEnabled: true,
        aiInlineCompletionEnabled: false,
      },
      inputText: 'The next sentence should',
      maxOutputTokens: 150,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('Inline AI completion');
  });

  it('blocks Agent omitted-context model summaries unless explicitly enabled', () => {
    const decision = evaluateAiUsagePolicy({
      category: 'automatic-agent-omitted-summary',
      settings: {
        ...DEFAULT_SETTINGS,
        aiEnabled: true,
        aiAgentOmittedSummaryEnabled: false,
      },
      inputText: 'omitted context preview',
      maxOutputTokens: 700,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('omitted-context model summary');
  });

  it('allows automatic usage only when the matching feature switch is enabled', () => {
    const inlineDecision = evaluateAiUsagePolicy({
      category: 'automatic-inline-completion',
      settings: {
        ...DEFAULT_SETTINGS,
        aiEnabled: true,
        aiInlineCompletionEnabled: true,
      },
      inputText: 'Continue this',
      maxOutputTokens: 150,
    });
    const omittedSummaryDecision = evaluateAiUsagePolicy({
      category: 'automatic-agent-omitted-summary',
      settings: {
        ...DEFAULT_SETTINGS,
        aiEnabled: true,
        aiAgentOmittedSummaryEnabled: true,
      },
      inputText: 'omitted context preview',
      maxOutputTokens: 700,
    });

    expect(inlineDecision.allowed).toBe(true);
    expect(omittedSummaryDecision.allowed).toBe(true);
  });
});

