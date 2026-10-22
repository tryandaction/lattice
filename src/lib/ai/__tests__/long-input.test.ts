// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { estimateLongInputBudget, processLongInput, LongInputProcessingError, type LongInputCheckpoint } from '../long-input';
import type { AiGenerateOptions, AiGenerateResult, AiMessage } from '../types';

const model = { id: 'fixture-model', contextWindow: 512, maxOutputTokens: 64 };
const tokenEstimate = (text: string) => Array.from(text).length;

function fixtureProvider(options?: { failBatch?: number; failFinal?: boolean; incomplete?: boolean }) {
  const submitted: string[] = [];
  let batch = 0;
  let mergeCount = 0;
  let finalCount = 0;
  const generate = async (messages: AiMessage[], request?: AiGenerateOptions): Promise<AiGenerateResult> => {
    const payload = messages.map(message => typeof message.content === 'string' ? message.content : '').join('');
    if (tokenEstimate(payload + (request?.systemPrompt ?? '')) + (request?.maxTokens ?? 0) + messages.length * 8 > model.contextWindow) throw new Error('Fixture context limit exceeded');
    if (request?.systemPrompt?.includes('[long-input:batch]')) {
      batch += 1;
      if (batch === options?.failBatch) throw new Error('Synthetic batch failure');
      const text = messages.at(-1)?.content;
      if (typeof text !== 'string') throw new Error('Expected plain original text');
      submitted.push(text);
      return { text: `Actual fixture summary ${batch}: preserve the main content.`, model: model.id, finishReason: options?.incomplete ? 'length' : 'stop' };
    }
    if (request?.systemPrompt?.includes('[long-input:merge]')) {
      mergeCount += 1;
      return { text: `Actual fixture merged summary ${mergeCount}.`, model: model.id, finishReason: 'stop' };
    }
    finalCount += 1;
    if (options?.failFinal) throw new Error('Synthetic synthesis failure');
    return { text: '# Actual fixture answer\n\nAll supplied summaries combined.', model: model.id, finishReason: 'stop' };
  };
  return { generate, submitted, calls: () => ({ batch, mergeCount, finalCount }) };
}

describe('long input sequential processing', () => {
  it('uses the known context limit and output reserve without truncating input or guessing an unknown model limit', () => {
    const input = '中'.repeat(500);
    const budget = estimateLongInputBudget({ input, model, outputReserveTokens: 64, estimateTokens: tokenEstimate });
    expect(budget.estimatedInputTokens).toBe(500);
    expect(budget.requiresBatching).toBe(true);
    expect(budget.availableInputTokens).toBeLessThan(448);
    expect(input.length).toBe(500);
    expect(estimateLongInputBudget({ input, model: { ...model, contextWindow: 0 }, estimateTokens: tokenEstimate }).contextWindow).toBeNull();
    expect(estimateLongInputBudget({ input, model: { ...model, contextWindow: 0 }, estimateTokens: tokenEstimate }).requiresBatching).toBe(false);
  });

  it('submits every UTF-16 range exactly once without splitting surrogate pairs and uses bounded model summaries for synthesis', async () => {
    const input = ('中 English 🧑‍🔬 $\\alpha$\n\n').repeat(3000).slice(0, 50000);
    expect(input.length).toBe(50000);
    const provider = fixtureProvider();
    const checkpoints: LongInputCheckpoint[] = [];
    const result = await processLongInput({ input, instruction: '总结', model, generate: provider.generate, estimateTokens: tokenEstimate, outputReserveTokens: 64, summaryTokens: 64, onCheckpoint: checkpoint => { checkpoints.push(checkpoint); } });
    expect(provider.submitted.join('') === input).toBe(true);
    expect(provider.submitted.every(text => !/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/u.test(text))).toBe(true);
    expect(result.checkpoint.completed[0]?.start).toBe(0);
    expect(result.checkpoint.completed.at(-1)?.end).toBe(input.length);
    expect(result.checkpoint.completed.every((range, index, ranges) => index === 0 || range.start === ranges[index - 1].end)).toBe(true);
    expect(result.checkpoint.status).toBe('completed');
    expect(result.checkpoint.input.revision).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.text).toContain('# Actual fixture answer');
    expect(result.text).toMatch(/分批|摘要/u);
    expect(provider.calls().mergeCount).toBeGreaterThan(0);
    expect(checkpoints[0].completed).toEqual([]);
  });

  it('retains only completed ranges on cancellation and resumes without resubmitting them', async () => {
    const input = '🧪中 English '.repeat(130);
    const first = fixtureProvider();
    const controller = new AbortController();
    let retained: LongInputCheckpoint | undefined;
    const processing = processLongInput({ input, instruction: '总结', model, generate: first.generate, estimateTokens: tokenEstimate, outputReserveTokens: 64, summaryTokens: 64, signal: controller.signal, onCheckpoint: checkpoint => {
      retained = checkpoint;
      if (checkpoint.completed.length === 1) controller.abort();
    } });
    await expect(processing).rejects.toBeInstanceOf(LongInputProcessingError);
    expect(retained?.status).toBe('interrupted');
    expect(retained?.completed).toHaveLength(1);
    const second = fixtureProvider();
    const resumed = await processLongInput({ input, instruction: '总结', model, generate: second.generate, estimateTokens: tokenEstimate, outputReserveTokens: 64, summaryTokens: 64, checkpoint: retained });
    expect(first.submitted.join('') + second.submitted.join('') === input).toBe(true);
    expect(resumed.checkpoint.completed.length).toBeGreaterThan(1);
  });

  it('retains completed summaries after a failed batch and rejects a changed original before generating', async () => {
    const input = '正文 detail '.repeat(150);
    const provider = fixtureProvider({ failBatch: 2 });
    let checkpoint: LongInputCheckpoint | undefined;
    try { await processLongInput({ input, instruction: '总结', model, generate: provider.generate, estimateTokens: tokenEstimate, outputReserveTokens: 64, summaryTokens: 64 }); }
    catch (error) { expect(error).toBeInstanceOf(LongInputProcessingError); checkpoint = (error as LongInputProcessingError).checkpoint; }
    expect(checkpoint?.status).toBe('failed');
    expect(checkpoint?.completed).toHaveLength(1);
    const changed = fixtureProvider();
    await expect(processLongInput({ input: input + 'Changed', instruction: '总结', model, generate: changed.generate, estimateTokens: tokenEstimate, outputReserveTokens: 64, summaryTokens: 64, checkpoint })).rejects.toThrow(/changed|revision/u);
    expect(changed.calls().batch).toBe(0);
    const resumed = fixtureProvider();
    await processLongInput({ input, instruction: '总结', model, generate: resumed.generate, estimateTokens: tokenEstimate, outputReserveTokens: 64, summaryTokens: 64, checkpoint });
    expect(provider.submitted.join('') + resumed.submitted.join('') === input).toBe(true);
  });

  it('distinguishes changed UTF-16 input even when UTF-8 encoding replaces an unpaired surrogate', async () => {
    const input = '中'.repeat(800) + '\uD800';
    const first = fixtureProvider({ failBatch: 2 });
    let checkpoint: LongInputCheckpoint | undefined;
    try { await processLongInput({ input, instruction: '总结', model, generate: first.generate, estimateTokens: tokenEstimate, outputReserveTokens: 64, summaryTokens: 64 }); }
    catch (error) { checkpoint = (error as LongInputProcessingError).checkpoint; }
    const second = fixtureProvider();
    await expect(processLongInput({ input: '中'.repeat(800) + '\uD801', instruction: '总结', model, generate: second.generate, estimateTokens: tokenEstimate, outputReserveTokens: 64, summaryTokens: 64, checkpoint })).rejects.toThrow(/changed|revision/u);
    expect(second.calls().batch).toBe(0);
  });

  it('does not mark an incomplete provider result as a completed input range', async () => {
    const provider = fixtureProvider({ incomplete: true });
    let retained: LongInputCheckpoint | undefined;
    try { await processLongInput({ input: '中'.repeat(800), instruction: '总结', model, generate: provider.generate, estimateTokens: tokenEstimate, outputReserveTokens: 64, summaryTokens: 64 }); }
    catch (error) { retained = (error as LongInputProcessingError).checkpoint; }
    expect(retained?.status).toBe('failed');
    expect(retained?.completed).toEqual([]);
  });

  it('resumes a failed final synthesis from saved summaries without reading the original again', async () => {
    const input = '正文 detail '.repeat(160);
    const first = fixtureProvider({ failFinal: true });
    let checkpoint: LongInputCheckpoint | undefined;
    try { await processLongInput({ input, instruction: '总结', model, generate: first.generate, estimateTokens: tokenEstimate, outputReserveTokens: 64, summaryTokens: 64 }); }
    catch (error) { checkpoint = (error as LongInputProcessingError).checkpoint; }
    expect(checkpoint?.completed.at(-1)?.end).toBe(input.length);
    const second = fixtureProvider();
    const result = await processLongInput({ input, instruction: '总结', model, generate: second.generate, estimateTokens: tokenEstimate, outputReserveTokens: 64, summaryTokens: 64, checkpoint });
    expect(second.submitted).toEqual([]);
    expect(result.checkpoint.status).toBe('completed');
  });

  it('cancels a provider that ignores AbortSignal without marking a late result as completed', async () => {
    const controller = new AbortController();
    let resolveProvider!: (result: AiGenerateResult) => void;
    let started!: () => void;
    const providerStarted = new Promise<void>(resolve => { started = resolve; });
    const generate = async (): Promise<AiGenerateResult> => { started(); return new Promise(resolve => { resolveProvider = resolve; }); };
    let retained: LongInputCheckpoint | undefined;
    const processing = processLongInput({ input: '中'.repeat(800), instruction: '总结', model, generate, estimateTokens: tokenEstimate, outputReserveTokens: 64, summaryTokens: 64, signal: controller.signal, onCheckpoint: checkpoint => { retained = checkpoint; } });
    await providerStarted;
    const interrupted = expect(processing).rejects.toBeInstanceOf(LongInputProcessingError);
    controller.abort();
    // Resolve later to verify that cancellation is the terminal result, while
    // the abort race must settle before the underlying provider is allowed to.
    const settledBeforeProvider = await Promise.race([processing.then(() => false, () => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 100))]);
    resolveProvider({ text: 'Late summary', model: model.id, finishReason: 'stop' });
    await interrupted;
    expect(settledBeforeProvider).toBe(true);
    expect(retained?.status).toBe('interrupted');
    expect(retained?.completed).toEqual([]);
  });
});
